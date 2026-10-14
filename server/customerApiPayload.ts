import { promises as fs } from "fs";
import path from "path";
import { withExactReadings } from "../shared/exact-readings";

const get = (row: Record<string, any>, camel: string, snake: string = camel) =>
  row[camel] ?? row[snake] ?? null;
const reading = (value: unknown) => value == null ? null : String(value);
const iso = (value: any) => value instanceof Date ? value.toISOString() : value ?? null;

/** Additive contract: retain the original meter-named keys for existing receivers. */
export function buildCustomerPayload(row: Record<string, any>, project: { id: number; name: string }, deliveryId: string) {
  row = withExactReadings(row);
  const oldSystemId = get(row, "oldSystemId", "old_system_id");
  const newSystemId = get(row, "newSystemId", "new_system_id");
  const oldReading = reading(get(row, "oldSystemReading", "old_system_reading"));
  const newReading = reading(get(row, "newSystemReading", "new_system_reading"));
  const oldGps = get(row, "oldGps", "old_gps");
  const newGps = get(row, "newGps", "new_gps");
  const coordinates = String(newGps || oldGps || "").split(",").map(s => s.trim());
  return {
    schemaVersion: 2, deliveryId, projectId: project.id, projectName: project.name,
    workOrderId: row.id, customerWoId: get(row, "customerWoId", "customer_wo_id") ?? "",
    customerId: get(row, "customerId", "customer_id"),
    customerName: get(row, "customerName", "customer_name"),
    status: row.status, oldMeterNumber: oldSystemId, newMeterNumber: newSystemId,
    oldMeterReading: oldReading, newMeterReading: newReading,
    oldSystemId, newSystemId, oldSystemReading: oldReading, newSystemReading: newReading,
    oldSystemType: get(row, "oldSystemType", "old_system_type"),
    newSystemType: get(row, "newSystemType", "new_system_type"),
    meterType: get(row, "newSystemType", "new_system_type") ?? get(row, "oldSystemType", "old_system_type"),
    oldModuleId: get(row, "oldModuleId", "old_module_id"),
    newModuleId: get(row, "newModuleId", "new_module_id"),
    oldModuleReading: reading(get(row, "oldModuleRead", "old_module_read") ?? row.oldModuleReading ?? row.old_module_reading),
    newModuleReading: reading(get(row, "newModuleRead", "new_module_read") ?? row.newModuleReading ?? row.new_module_reading),
    oldModuleType: get(row, "oldModuleType", "old_module_type"),
    newModuleType: get(row, "newModuleType", "new_module_type"),
    oldGps, newGps, latitude: coordinates[0] || null, longitude: coordinates[1] || null,
    gpsAccuracy: get(row, "gpsAccuracy", "gps_accuracy"),
    serviceAddress: row.address ?? row.serviceAddress ?? null,
    serviceCity: row.city ?? row.serviceCity ?? null,
    serviceState: row.state ?? row.serviceState ?? null,
    serviceZip: row.zip ?? row.serviceZip ?? null,
    phone: row.phone ?? null, email: row.email ?? null, route: row.route ?? null, zone: row.zone ?? null,
    serviceType: get(row, "serviceType", "service_type"), notes: row.notes ?? null,
    troubleCode: row.trouble ?? row.troubleCode ?? null,
    signatureName: get(row, "signatureName", "signature_name"),
    assignedUserId: get(row, "assignedUserId", "assigned_user_id"),
    assignedGroupId: get(row, "assignedGroupId", "assigned_group_id"),
    completedBy: get(row, "completedBy", "completed_by"),
    scheduledBy: get(row, "scheduledBy", "scheduled_by"),
    createdBy: get(row, "createdBy", "created_by"), updatedBy: get(row, "updatedBy", "updated_by"),
    createdAt: iso(get(row, "createdAt", "created_at")),
    updatedAt: iso(get(row, "updatedAt", "updated_at")),
    scheduledAt: iso(get(row, "scheduledAt", "scheduled_at")),
    completedAt: iso(get(row, "completedAt", "completed_at")),
    attachments: row.attachments ?? [],
  };
}

export interface DeliveryPhoto { filename: string; type: string; contentType: string; data: string }
const types: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff" };

/** Read every image, not only the first before/after image. Never follow symlinks. */
export async function readDeliveryPhotos(folder: string): Promise<DeliveryPhoto[]> {
  let entries;
  try { entries = await fs.readdir(folder, { withFileTypes: true }); }
  catch (error: any) { if (error.code === "ENOENT") return []; throw error; }
  const photos: DeliveryPhoto[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const children = await readDeliveryPhotos(absolute);
      photos.push(...children.map(photo => ({ ...photo, filename: `${entry.name}/${photo.filename}`,
        type: ["before", "after", "trouble", "signature"].includes(entry.name) ? entry.name : photo.type })));
    } else if (entry.isFile() && types[path.extname(entry.name).toLowerCase()]) {
      const type = ["signature", "trouble", "before", "after"].find(t =>
        new RegExp(`(^|[-_])${t}([_.-]|$)`, "i").test(entry.name)) ?? "photo";
      photos.push({ filename: entry.name, type, contentType: types[path.extname(entry.name).toLowerCase()],
        data: (await fs.readFile(absolute)).toString("base64") });
    }
  }
  return photos;
}

export function customerAuthHeaders(config: Record<string, any>, secrets: Record<string, string | undefined>): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const type = config.customer_api_auth_type || "none";
  if (type === "none") return headers;
  if (!["api_key", "bearer_token", "basic_auth"].includes(type)) throw new Error("Unsupported customer API authentication type");
  const secret = secrets[config.customer_api_secret_env_var];
  if (!secret) throw new Error("Customer API authentication secret is not configured on the server");
  if (type === "api_key") {
    const name = config.customer_api_key_header || "X-API-Key";
    if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || ["content-type", "idempotency-key", "x-meterflo-delivery-id"].includes(name.toLowerCase())) {
      throw new Error("Invalid or reserved customer API key header name");
    }
    headers[name] = secret;
  }
  if (type === "bearer_token") headers.Authorization = `Bearer ${secret}`;
  if (type === "basic_auth") headers.Authorization = `Basic ${Buffer.from(secret).toString("base64")}`;
  return headers;
}

export const RETRY_DELAYS = [60_000, 300_000, 900_000, 3_600_000];
export function retryDelay(attempt: number, retryAfter: string | null = null, now = Date.now()) {
  const standard = RETRY_DELAYS[Math.min(attempt - 1, RETRY_DELAYS.length - 1)];
  if (!retryAfter) return standard;
  const seconds = Number(retryAfter);
  const hint = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now;
  return Number.isFinite(hint) && hint > 0 ? Math.min(86_400_000, Math.max(standard, hint)) : standard;
}
