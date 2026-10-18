import { useEffect, useState } from "react";
import { useWatch, useFormState, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatProjectTimestamp, isoFromZonedInput, localInputForTimezone } from "@/lib/project-scheduling-time";

type PlanningDefaults = { defaultServiceMinutes?: number | null; defaultAppointmentToleranceMinutes?: number | null };
type Props = PlanningDefaults & { form: UseFormReturn<any>; timezone: string; disabled?: boolean };

export function WorkOrderPlanningSummary({ timezone, defaultServiceMinutes, defaultAppointmentToleranceMinutes,
  serviceDurationMinutes, appointmentWindowStart, appointmentWindowEnd, scheduledAt }: PlanningDefaults & {
    timezone: string; serviceDurationMinutes?: number | null; appointmentWindowStart?: string | null;
    appointmentWindowEnd?: string | null; scheduledAt?: string | Date | null;
  }) {
  const tolerance = defaultAppointmentToleranceMinutes ?? 10;
  const explicit = !!appointmentWindowStart && !!appointmentWindowEnd;
  const incomplete = !!appointmentWindowStart !== !!appointmentWindowEnd;
  const scheduled = scheduledAt ? new Date(scheduledAt instanceof Date ? scheduledAt.getTime() : scheduledAt) : null;
  const scheduledIso = scheduled && Number.isFinite(scheduled.getTime()) ? scheduled.toISOString() : null;
  const start = explicit ? appointmentWindowStart : scheduledIso;
  const end = explicit ? appointmentWindowEnd : scheduledIso ? new Date(Date.parse(scheduledIso) + tolerance * 60000).toISOString() : null;
  return <div className="min-w-0 space-y-3 break-words" data-testid="planning-inherited-values">
    <dl className="grid min-w-0 gap-3 text-sm sm:grid-cols-2">
      <div><dt className="text-xs text-muted-foreground">Project timezone</dt><dd>{timezone}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Service duration</dt><dd>{serviceDurationMinutes ?? defaultServiceMinutes ?? 45} min · {serviceDurationMinutes != null ? "Work-order override" : defaultServiceMinutes != null ? "Project default" : "Legacy routing fallback"}</dd>
        {serviceDurationMinutes != null && <dd className="text-xs text-muted-foreground">{defaultServiceMinutes ?? 45} min · {defaultServiceMinutes != null ? "Project default" : "Legacy routing fallback"}</dd>}
        {serviceDurationMinutes == null && <dd className="text-xs text-muted-foreground">Route setup can override this default.</dd>}</div>
      <div><dt className="text-xs text-muted-foreground">Appointment tolerance</dt><dd>{tolerance} min · {defaultAppointmentToleranceMinutes != null ? "Project default" : "Legacy routing fallback"}</dd>
        {explicit && <dd className="text-xs text-muted-foreground">Not added to an explicit service-start window.</dd>}</div>
      <div><dt className="text-xs text-muted-foreground">Service-start window · {timezone}</dt>
        <dd>{incomplete ? "Incomplete override: set or clear both endpoints." : start && end ? `${formatProjectTimestamp(start, timezone)} – ${formatProjectTimestamp(end, timezone)}` : "Not scheduled"}</dd>
        <dd className="text-xs text-muted-foreground">{explicit ? "Work-order window override" : scheduledIso ? "Scheduled appointment plus inherited tolerance; route setup can override tolerance." : "Set Scheduled At or enter both window endpoints."}</dd></div>
    </dl>
  </div>;
}

export function WorkOrderPlanningFields({ form, timezone, defaultServiceMinutes, defaultAppointmentToleranceMinutes, disabled = false }: Props) {
  const duration = useWatch({ control: form.control, name: "serviceDurationMinutes" });
  const { errors } = useFormState({ control: form.control });
  const start = useWatch({ control: form.control, name: "appointmentWindowStart" });
  const end = useWatch({ control: form.control, name: "appointmentWindowEnd" });
  const scheduledAt = useWatch({ control: form.control, name: "scheduledAt" });
  const [error, setError] = useState("");
  const [startLocal, setStartLocal] = useState("");
  const [endLocal, setEndLocal] = useState("");

  useEffect(() => {
    setStartLocal(localInputForTimezone(start, timezone));
    setEndLocal(localInputForTimezone(end, timezone));
  }, [start, end, timezone]);

  const changeTime = (field: "appointmentWindowStart" | "appointmentWindowEnd", value: string) => {
    const setLocal = field === "appointmentWindowStart" ? setStartLocal : setEndLocal;
    setLocal(value);
    setError("");
    form.clearErrors(field);
    if (!value) {
      form.setValue(field, null, { shouldDirty: true, shouldValidate: true });
      return;
    }
    try {
      const iso = isoFromZonedInput(value, timezone);
      const other = field === "appointmentWindowStart" ? end : start;
      if (other && (field === "appointmentWindowStart" ? Date.parse(iso) > Date.parse(other) : Date.parse(iso) < Date.parse(other))) {
        throw new Error("Appointment window end must be at or after its start.");
      }
      form.setValue(field, iso, { shouldDirty: true, shouldValidate: true });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Choose a valid time.";
      form.setValue(field, value, { shouldDirty: true, shouldValidate: true });
      setError(message);
      form.setError(field, { type: "manual", message });
    }
  };

  return <section className="space-y-3 rounded-lg border bg-muted/20 p-3 sm:p-4" aria-label="Planning appointment details">
    <div>
      <h3 className="text-sm font-semibold">Route planning details</h3>
      <p className="mt-1 text-xs text-muted-foreground">Planning-only overrides. These never change the customer appointment.</p>
    </div>
    <WorkOrderPlanningSummary timezone={timezone} defaultServiceMinutes={defaultServiceMinutes}
      defaultAppointmentToleranceMinutes={defaultAppointmentToleranceMinutes} serviceDurationMinutes={duration}
      appointmentWindowStart={start} appointmentWindowEnd={end} scheduledAt={scheduledAt} />
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="service-duration-minutes">Service duration (minutes)</Label>
        <Input id="service-duration-minutes" type="number" min="1" max="480" step="1" value={duration ?? ""} disabled={disabled}
          onChange={event => form.setValue("serviceDurationMinutes", event.target.value === "" ? null : Number(event.target.value), { shouldDirty: true, shouldValidate: true })}
          data-testid="input-service-duration-minutes" placeholder={`${defaultServiceMinutes ?? 45} min (${defaultServiceMinutes != null ? "project default" : "routing fallback"})`} />
        <p className="text-xs text-muted-foreground">Leave empty to inherit the route setup or project default (1–480).</p>
        {errors.serviceDurationMinutes?.message && <p className="text-sm text-destructive" role="alert">{String(errors.serviceDurationMinutes.message)}</p>}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="appointment-window-start">Appointment window start ({timezone})</Label>
        <Input id="appointment-window-start" type="datetime-local" value={startLocal} disabled={disabled} onChange={event => changeTime("appointmentWindowStart", event.target.value)} data-testid="input-appointment-window-start" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="appointment-window-end">Appointment window end ({timezone})</Label>
        <Input id="appointment-window-end" type="datetime-local" value={endLocal} disabled={disabled} onChange={event => changeTime("appointmentWindowEnd", event.target.value)} data-testid="input-appointment-window-end" />
      </div>
    </div>
    {(start || end) && <p className="text-xs text-muted-foreground">Saved window: {formatProjectTimestamp(start, timezone)} – {formatProjectTimestamp(end, timezone)}</p>}
    {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    {((errors.appointmentWindowStart?.message || errors.appointmentWindowEnd?.message) && <p className="text-sm text-destructive" role="alert">{String(errors.appointmentWindowStart?.message || errors.appointmentWindowEnd?.message)}</p>)}
    {!!start !== !!end && <p className="text-sm text-destructive" role="alert">Set both window endpoints, or clear both.</p>}
  </section>;
}
