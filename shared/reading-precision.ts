import { z } from "zod";

export const readingDecimalPlacesSchema = z.number().int().min(0).max(6);
export const readingPrecisionKeys = ["systemReadingDecimalPlaces", "moduleReadingDecimalPlaces"] as const;
export const readingPrecisionPermission = "projects.readingPrecision";
export type ReadingPrecision = { systemReadingDecimalPlaces: number; moduleReadingDecimalPlaces: number };
type PrecisionSource = Partial<{ [K in keyof ReadingPrecision]: number | null }>;

export function getReadingPrecision(project?: PrecisionSource | null): ReadingPrecision {
  return {
    systemReadingDecimalPlaces: project?.systemReadingDecimalPlaces ?? 3,
    moduleReadingDecimalPlaces: project?.moduleReadingDecimalPlaces ?? 3,
  };
}

/** Normalize keyboard decimal separators, never round/truncate a captured value. */
export function normalizeReadingInput(value: string): string {
  return value.replace(/,/g, ".");
}

/** Accept editable numeric text, including empty/trailing-dot states, without truncating it. */
export function getReadingInputValue(value: string, decimalPlaces: number): string | null {
  const normalized = normalizeReadingInput(value);
  const pattern = decimalPlaces === 0 ? /^\d*$/ : /^\d*(?:\.\d*)?$/;
  if (!pattern.test(normalized) || (normalized.split(".")[1]?.length ?? 0) > decimalPlaces) {
    return null;
  }
  return normalized;
}

export function isValidReading(value: unknown, decimalPlaces: number): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const text = String(value).trim();
  return /^\d+(?:\.\d+)?$/.test(text) &&
    (text.split(".")[1]?.length ?? 0) <= decimalPlaces;
}

export function readingLimitMessage(label: string, decimalPlaces: number): string {
  return decimalPlaces === 0
    ? `${label} must be a non-negative whole number (0 decimal places).`
    : `${label} must be a non-negative number with at most ${decimalPlaces} decimal places.`;
}

export function hasReadingPrecisionSettings(body: Record<string, unknown>): boolean {
  return readingPrecisionKeys.some(key => Object.hasOwn(body, key));
}

/** PATCH has no defaults: omitted fields must not reset a project's policy. */
export const readingPrecisionPatchSchema = z.object({
  systemReadingDecimalPlaces: readingDecimalPlacesSchema.optional(),
  moduleReadingDecimalPlaces: readingDecimalPlacesSchema.optional(),
});

const readingFields = [
  { keys: ["oldSystemReading", "old_system_reading"], label: "Old system reading", kind: "system" },
  { keys: ["newSystemReading", "new_system_reading"], label: "New system reading", kind: "system" },
  { keys: ["oldModuleRead", "oldModuleReading", "old_module_read", "old_module_reading"], label: "Old module reading", kind: "module" },
  { keys: ["newModuleRead", "newModuleReading", "new_module_read", "new_module_reading"], label: "New module reading", kind: "module" },
] as const;

export type ReadingValidationError = { field: string; decimalPlaces: number; message: string };

export function readingValidationResponse(errors: ReadingValidationError[]) {
  return { code: "READING_PRECISION", message: errors.map(error => error.message).join(" "), errors };
}

/**
 * Validate only supplied, nonempty, changed readings. Imported/historical values
 * echoed in an unrelated edit/sync are not recaptured and must remain untouched.
 * Required-field checks remain the responsibility of each workflow.
 */
export function validateCapturedReadings(
  payload: Record<string, unknown>,
  project: PrecisionSource,
  existing?: object | null,
): ReadingValidationError[] {
  const precision = getReadingPrecision(project);
  const baseline = existing as Record<string, unknown> | undefined;
  const errors: ReadingValidationError[] = [];
  for (const { keys, label, kind } of readingFields) {
    const limit = kind === "system" ? precision.systemReadingDecimalPlaces : precision.moduleReadingDecimalPlaces;
    const original = keys.map(key => baseline?.[key]).find(value => value !== null && value !== undefined);
    for (const field of keys) {
      if (!Object.hasOwn(payload, field)) continue;
      const value = payload[field];
      if (value === null || value === undefined || value === "") continue;
      if (original !== undefined && String(value).trim() === String(original).trim()) continue;
      if (!isValidReading(value, limit)) {
        errors.push({ field, decimalPlaces: limit, message: readingLimitMessage(label, limit) });
      }
    }
  }
  return errors;
}
