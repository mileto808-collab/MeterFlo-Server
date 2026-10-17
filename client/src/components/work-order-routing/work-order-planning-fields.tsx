import { useEffect, useState } from "react";
import { useWatch, useFormState, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatProjectTimestamp, isoFromZonedInput, localInputForTimezone } from "@/lib/project-scheduling-time";

type Props = { form: UseFormReturn<any>; timezone: string; disabled?: boolean };

export function WorkOrderPlanningFields({ form, timezone, disabled = false }: Props) {
  const duration = useWatch({ control: form.control, name: "serviceDurationMinutes" });
  const { errors } = useFormState({ control: form.control });
  const start = useWatch({ control: form.control, name: "appointmentWindowStart" });
  const end = useWatch({ control: form.control, name: "appointmentWindowEnd" });
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
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5">
        <Label htmlFor="service-duration-minutes">Service duration (minutes)</Label>
        <Input id="service-duration-minutes" type="number" min="1" max="480" step="1" value={duration ?? ""} disabled={disabled}
          onChange={event => form.setValue("serviceDurationMinutes", event.target.value === "" ? null : Number(event.target.value), { shouldDirty: true, shouldValidate: true })}
          data-testid="input-service-duration-minutes" placeholder="Use project / route default" />
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
