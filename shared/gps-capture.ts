import { z } from "zod";

export const gpsAccuracyLimitSchema = z.number().finite().positive().max(100000).nullable();
export const gpsFixSchema = z.object({
  coordinates: z.string().max(100),
  source: z.enum(["native", "browser", "manual", "existing", "geocode"]),
  accuracy: z.number().finite().nonnegative().nullable(),
  capturedAt: z.string().datetime({ offset: true }).nullable(),
  receiver: z.enum(["internal", "external", "unknown"]),
}).strict();
export type GpsFix = z.infer<typeof gpsFixSchema>;
export type GpsCaptureStatus = "idle" | "capturing" | "success" | "error";
export function coordinateText(value: number): string {
  // Plain decimals, including near the equator/prime meridian; never round to
  // four places or emit exponent syntax rejected by existing coordinate fields.
  return value.toLocaleString("en-US", { useGrouping: false, maximumSignificantDigits: 21 });
}

export function parseCoordinates(value: unknown): [number, number] | null {
  if (typeof value !== "string" || value.length > 100 ||
      !/^-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
  const [lat, lng] = value.split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? [lat, lng] : null;
}

export function sameCoordinates(left: unknown, right: unknown): boolean {
  const a = parseCoordinates(left), b = parseCoordinates(right);
  return !!a && !!b && a[0] === b[0] && a[1] === b[1];
}

/** An untouched/echoed coordinate must not erase earlier capture provenance. */
export function gpsMetadataUpdate(previous: Record<string, unknown>, updates: { newGps?: string | null; gpsCapture?: unknown }) {
  const coordinates = updates.newGps === undefined ? previous.new_gps : updates.newGps;
  const changed = updates.newGps !== undefined && updates.newGps !== previous.new_gps &&
    !sameCoordinates(updates.newGps, previous.new_gps);
  const fix = validateGpsFix(updates.gpsCapture, coordinates);
  return { changed, fix, write: updates.gpsCapture != null || changed };
}

export function gpsAccuracyError(fix: GpsFix | null | undefined, limit?: number | null): string | null {
  if (limit == null) return null;
  if (!fix || !["native", "browser"].includes(fix.source) || !fix.capturedAt || fix.accuracy == null)
    return `This project requires a captured location with reported accuracy of ${limit} m or better. Retry location capture.`;
  if (fix.accuracy > limit)
    return `Reported location accuracy is ${fix.accuracy} m; this project requires ${limit} m or better. Retry location capture.`;
  return null;
}

export function validateGpsFix(value: unknown, coordinates: unknown): GpsFix | null {
  if (value == null) return null;
  const fix = gpsFixSchema.parse(value);
  if (!sameCoordinates(fix.coordinates, coordinates)) throw new Error("GPS metadata does not match the submitted coordinates.");
  if (["native", "browser"].includes(fix.source) && !fix.capturedAt)
    throw new Error("A captured device or browser position must include its capture time.");
  if (!["native", "browser"].includes(fix.source) && (fix.accuracy !== null || fix.capturedAt !== null))
    throw new Error("Saved, manual and address coordinates cannot claim a fresh device fix.");
  if (fix.source === "browser" && fix.receiver !== "unknown")
    throw new Error("Browser location cannot establish the receiver identity.");
  if (fix.capturedAt && Date.parse(fix.capturedAt) > Date.now() + 60000)
    throw new Error("GPS fix time is in the future.");
  return fix;
}

/** Validate web/mobile payloads before writing photos or completing work. */
export function completionGpsFix(coordinates: unknown, metadata: unknown,
  previous?: { newGps?: string | null; gpsCapture?: GpsFix | null }): GpsFix | null {
  const actualCoordinates = coordinates === undefined ? previous?.newGps : coordinates;
  const incoming = validateGpsFix(metadata, actualCoordinates);
  if (incoming) return incoming;
  // This is already-recorded capture evidence for THIS order, not an address or
  // an unproven saved coordinate. Preserve its original timestamp/provenance.
  if (previous?.gpsCapture && sameCoordinates(actualCoordinates, previous.newGps))
    return validateGpsFix(previous.gpsCapture, actualCoordinates);
  return null;
}

/** Validate web/mobile payloads before writing photos or completing work. */
export function gpsSubmissionProblem(
  policy: { wizardGpsMode?: string | null; wizardGpsMaxAccuracyMetres?: number | null },
  coordinates: unknown, metadata: unknown,
  previous?: { newGps?: string | null; gpsCapture?: GpsFix | null },
): { message: string; code: string } | null {
  if (policy.wizardGpsMode === "disabled") return null;
  try {
    const message = gpsAccuracyError(completionGpsFix(coordinates, metadata, previous), policy.wizardGpsMaxAccuracyMetres);
    return message ? { message, code: "GPS_ACCURACY" } : null;
  } catch (error) {
    return { message: error instanceof Error ? error.message : "Invalid GPS capture.", code: "GPS_CAPTURE" };
  }
}

/** Relational columns are returned through one consistent web/native DTO. */
export function gpsFixDto(row: Record<string, any>): { gpsCapture: GpsFix | null } {
  const source = row.gps_source;
  if (!source || !row.new_gps) return { gpsCapture: null };
  const parsed = gpsFixSchema.safeParse({
    coordinates: row.new_gps, source,
    accuracy: row.gps_accuracy == null ? null : Number(row.gps_accuracy),
    capturedAt: row.gps_captured_at ? new Date(row.gps_captured_at).toISOString() : null,
    receiver: row.gps_receiver ?? "unknown",
  });
  return { gpsCapture: parsed.success ? parsed.data : null };
}
