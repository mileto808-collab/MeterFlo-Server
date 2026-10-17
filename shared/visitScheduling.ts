import { z } from "zod";

export const serviceDurationSchema = z.number().int().min(1).max(480).nullable().optional();
export const appointmentToleranceSchema = z.number().int().min(0).max(240).nullable().optional();
export const windowTimestampSchema = z.string().datetime({ offset: true }).nullable().optional();
export const visitSchedulingSchema = z.object({
  serviceDurationMinutes: serviceDurationSchema,
  appointmentWindowStart: windowTimestampSchema,
  appointmentWindowEnd: windowTimestampSchema,
}).superRefine((value, ctx) => {
  const start = value.appointmentWindowStart, end = value.appointmentWindowEnd;
  if (!!start !== !!end || (start && end && Date.parse(end) < Date.parse(start))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["appointmentWindowEnd"],
      message: "Provide both appointment window endpoints, with end at or after start." });
  }
});

/** Validate merged state, not a partial update in isolation. */
export function validateVisitScheduling(value: unknown) {
  return visitSchedulingSchema.parse(value);
}

export function schedulingDto(row: Record<string, any>) {
  const iso = (value: unknown) => value == null ? null : new Date(value as string).toISOString();
  return {
    serviceDurationMinutes: row.service_duration_minutes ?? null,
    appointmentWindowStart: iso(row.appointment_window_start),
    appointmentWindowEnd: iso(row.appointment_window_end),
  };
}

export const schedulingDefaultsSchema = z.object({
  defaultServiceMinutes: serviceDurationSchema,
  defaultAppointmentToleranceMinutes: appointmentToleranceSchema,
}).strict();

export const visitSchedulingKeys = ["serviceDurationMinutes", "appointmentWindowStart", "appointmentWindowEnd"] as const;

/** CSV/SQL/API imports may supply numeric text; interactive writers stay strict. */
export function importedVisitScheduling(row: Record<string, any>) {
  const fields: Record<string, unknown> = {};
  for (const [key, snake] of [
    ["serviceDurationMinutes", "service_duration_minutes"],
    ["appointmentWindowStart", "appointment_window_start"],
    ["appointmentWindowEnd", "appointment_window_end"],
  ]) {
    const value = row[key] !== undefined ? row[key] : row[snake];
    if (value !== undefined) fields[key] = value === "" ? null :
      key === "serviceDurationMinutes" && value !== null ? Number(value) :
      value instanceof Date ? value.toISOString() : value;
  }
  return validateVisitScheduling(fields);
}

/** SQL import mappings use source-column -> work-order-field names. */
export function mapSqlImportRow(row: Record<string, unknown>, mapping: Record<string, string>): Record<string, any> {
  const mapped: Record<string, any> = {};
  for (const [source, target] of Object.entries(mapping)) {
    if (target && row[source] !== undefined) mapped[target] = row[source];
  }
  return { ...mapped, ...importedVisitScheduling(mapped) };
}
