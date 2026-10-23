import { createHash } from "node:crypto";
import { z } from "zod";

export const mobileSubmissionIdentity = z.object({
  changeoutSubmissionId: z.string().uuid(),
  changeoutAssignmentVersion: z.number().int().nonnegative(),
});
export type MobileSubmissionKind = "complete" | "trouble";
export type MobileSubmission = {
  id: string; assignmentVersion: number; fingerprint: string;
  projectId: number; workOrderId: number; actorId: string; kind: MobileSubmissionKind;
};

const aliases: Record<string, string> = {
  oldModuleRead: "oldModuleReading", newModuleRead: "newModuleReading",
  old_module_read: "oldModuleReading", new_module_read: "newModuleReading",
  newGps: "gpsCoordinates", new_gps: "gpsCoordinates",
};
const transportFields = new Set(["id", "workOrderId", "clientUpdatedAt", "clientTimestamp",
  "clientSyncTimestamp", "forceOverwrite", "changeoutSubmissionId", "changeoutAssignmentVersion"]);
const stable = (value: any): any => {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stable(value[key])]));
  return value;
};

export function submissionBody(req: { body?: any }): Record<string, any> {
  let body = req.body;
  if (typeof req.body?.data === "string") {
    const { data, ...outer } = req.body;
    const inner = JSON.parse(data);
    if (!inner || typeof inner !== "object" || Array.isArray(inner)) throw new Error("Invalid submission body.");
    for (const key of Object.keys(outer))
      if (Object.hasOwn(inner, key) && JSON.stringify(inner[key]) !== JSON.stringify(outer[key]))
        throw new Error("Conflicting multipart metadata.");
    body = { ...outer, ...inner };
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid submission body.");
  return body;
}

/** New clients must not receive a media acknowledgement for fields a route ignores. */
export function validateSubmissionMedia(body: Record<string, any>, route: "complete" | "trouble" | "auto") {
  if (route === "auto" && body.photoTypes !== undefined &&
      (!Array.isArray(body.photoTypes) || body.photoTypes.some((type: any) =>
        typeof type !== "string" || !type.trim() || type.length > 100 ||
        [".", ".."].includes(type.trim()) || /[/\\\x00-\x1f]/.test(type))))
    throw new Error("Invalid photo type.");
  const base64 = (value: any) => {
    if (typeof value !== "string") throw new Error("Media must contain base64 bytes.");
    const encoded = value.replace(/^data:[^,]*;base64,/, "");
    if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) ||
        Buffer.from(encoded, "base64").toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, ""))
      throw new Error("Invalid media bytes.");
  };
  for (const [camel, snake] of [["photos", "photos"], ["beforePhotos", "before_photos"], ["afterPhotos", "after_photos"]]) {
    const value = body[camel] ?? body[snake];
    if (value == null) continue;
    if (!Array.isArray(value)) throw new Error("Photos must be an array.");
    const supported = route === "complete" ? camel !== "photos" : route === "trouble" ? camel === "photos" : false;
    if (value.length && !supported) throw new Error("This route does not accept that photo field.");
    for (const photo of value) base64(photo?.base64);
  }
  const signature = body.signatureData ?? body.signature_data;
  if (signature) {
    if (route === "trouble" || route === "auto" && body.signature_data !== undefined)
      throw new Error("This route does not accept that signature field.");
    base64(signature);
  }
}

/** Bind an immutable logical request, never the generated report timestamp or saved file path. */
export function mobileSubmissionFingerprint(body: Record<string, any>, kind: MobileSubmissionKind,
  assignmentVersion: number, files: readonly any[] = []) {
  const payload: Record<string, any> = Object.create(null);
  for (const [key, value] of Object.entries(body)) {
    if (transportFields.has(key)) continue;
    const camel = key.replace(/_([a-z])/g, (_match, letter) => letter.toUpperCase());
    const name = aliases[key] ?? aliases[camel] ?? camel;
    const normalized = name === "inventoryUsage" && typeof value === "string" ? JSON.parse(value) : value;
    if (Object.hasOwn(payload, name) && JSON.stringify(stable(payload[name])) !== JSON.stringify(stable(normalized)))
      throw new Error(`Conflicting submission values for ${name}.`);
    payload[name] = normalized;
  }
  const media = files.map(file => ({
    field: file.fieldname, type: file.mimetype,
    digest: createHash("sha256").update(file.buffer).digest("hex"),
  }));
  return createHash("sha256").update(JSON.stringify(stable({ kind, assignmentVersion, payload, media }))).digest("hex");
}
