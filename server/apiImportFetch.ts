import { importFields, type ApiImportSettings, type ImportField } from "../shared/customer-api-import";
import { inventoryImportSchema } from "../shared/inventory";
import { customerAuthHeaders } from "./customerApiPayload";

export class ImportFetchError extends Error {
  constructor(message: string, public transient = false, public retryAfter: string | null = null) { super(message); }
}
export function property(value: unknown, path: string): unknown {
  if (!path) return value;
  return path.split(".").reduce<unknown>((current, key) =>
    current && typeof current === "object" && Object.hasOwn(current, key)
      && !["__proto__", "prototype", "constructor"].includes(key)
      ? (current as Record<string, unknown>)[key] : undefined, value);
}
export function importAuth(config: ApiImportSettings) {
  return {
    ...customerAuthHeaders({
      customer_api_auth_type: config.authType,
      customer_api_secret_env_var: config.secretEnvVar,
      customer_api_key_header: config.keyHeader,
    }, process.env),
    Accept: "application/json",
  };
}
export function redactImportMessage(message: string, config: ApiImportSettings): string {
  const secret = config.authType === "none" ? null : process.env[config.secretEnvVar];
  if (secret) for (const value of [secret, Buffer.from(secret).toString("base64"), ...secret.split(":").filter(Boolean)]) {
    message = message.split(value).join("[redacted]");
  }
  return message.slice(0, 500);
}
export function firstImportUrl(config: ApiImportSettings, checkpoint: { cursor?: string | null; watermark?: string | null }) {
  const url = new URL(config.endpoint);
  for (const [key, value] of Object.entries(config.queryParams)) url.searchParams.set(key, value);
  if (config.pagination !== "none") url.searchParams.set(config.pageSizeParam, String(config.pageSize));
  if (config.pagination === "page") url.searchParams.set(config.pageParam, String(config.startPage));
  if (config.resumeCursor && checkpoint.cursor) url.searchParams.set(config.cursorParam, checkpoint.cursor);
  if (config.watermarkParam && checkpoint.watermark) url.searchParams.set(config.watermarkParam, checkpoint.watermark);
  return url.toString();
}
export function trustedImportUrl(value: string, config: ApiImportSettings, base = config.endpoint) {
  const url = new URL(value, base);
  if (url.origin !== new URL(config.endpoint).origin || url.username || url.password || url.hash) {
    throw new ImportFetchError("Pagination URL must stay on the configured origin without embedded credentials/fragments");
  }
  return url.toString();
}
export async function fetchImportPage(config: ApiImportSettings, requestUrl: string, signal?: AbortSignal) {
  const url = trustedImportUrl(requestUrl, config);
  // Resolve credentials before doing any network IO; never fall back to anonymous requests.
  const headers = importAuth(config);
  const timeout = AbortSignal.timeout(30_000);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try { response = await fetch(url, { method: "GET", headers, redirect: "error", signal: combined }); }
  catch { throw new ImportFetchError("Customer API connection failed or timed out (redirects are not followed)", true); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new ImportFetchError(`Customer API returned HTTP ${response.status}`, response.status === 408 || response.status === 429 || response.status >= 500, response.headers.get("retry-after"));
  }
  const reader = response.body?.getReader();
  if (!reader) throw new ImportFetchError("Customer API returned an empty response");
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 5 * 1024 * 1024) {
        await reader.cancel();
        throw new ImportFetchError("Customer API response exceeds the 5 MiB per-page limit");
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof ImportFetchError) throw error;
    throw new ImportFetchError("Customer API response was interrupted or timed out", true);
  } finally { reader.releaseLock(); }
  let body: unknown;
  try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ImportFetchError("Customer API response must be valid JSON"); }
  const records = property(body, config.recordsPath);
  if (!Array.isArray(records)) throw new ImportFetchError("The configured records path must resolve to a JSON array");
  if (records.length > 1000) throw new ImportFetchError("Customer API returned more than 1,000 records on one page");
  return { body, records: records as unknown[] };
}
export function nextImportPage(config: ApiImportSettings, body: unknown, records: unknown[], current: string, pageValue: number) {
  if (config.pagination === "none") return { url: null, cursor: null };
  if (config.pagination === "page") {
    if (records.length < config.pageSize) return { url: null, cursor: null };
    const url = new URL(current);
    url.searchParams.set(config.pageParam, String(pageValue + 1));
    return { url: url.toString(), cursor: null };
  }
  const next = property(body, config.nextPath);
  if (next == null || next === "") return { url: null, cursor: null };
  if (typeof next !== "string" && !(config.pagination === "cursor" && typeof next === "number" && Number.isSafeInteger(next))) {
    throw new ImportFetchError("Next-page value must be a URL string or scalar cursor");
  }
  if (String(next).length > 2000) throw new ImportFetchError("Next-page value is too long");
  if (config.pagination === "next_url") return { url: trustedImportUrl(String(next), config, current), cursor: null };
  const url = new URL(current);
  url.searchParams.set(config.cursorParam, String(next));
  return { url: url.toString(), cursor: String(next) };
}

export type ImportRules = { services: string[]; statuses: string[]; systems: string[]; modules: string[]; openStatus: string };
export function mapImportRecord(record: unknown, config: ApiImportSettings, rules: ImportRules) {
  const mapped: Record<string, any> = {};
  const errors: string[] = [];
  if (!record || typeof record !== "object" || Array.isArray(record)) return { mapped, errors: ["Record must be a JSON object"] };
  for (const [source, field] of Object.entries(config.fieldMapping)) {
    const raw = property(record, source);
    if (raw === undefined) continue;
    if (field === "inventoryItems") {
      if (JSON.stringify(raw).length > importFields.inventoryItems) { errors.push("inventoryItems: value exceeds the field length"); continue; }
      const parsed = inventoryImportSchema.safeParse(raw === null || raw === "" ? [] : raw);
      if (!parsed.success) errors.push("inventoryItems: expected item, warehouse, quantity and matching serial assignments");
      else mapped[field] = parsed.data;
      continue;
    }
    if (raw === null || raw === "") { mapped[field] = null; continue; }
    if (typeof raw !== "string" && typeof raw !== "number") { errors.push(`${field}: expected text or a number`); continue; }
    if (typeof raw === "number" && (!Number.isFinite(raw) || Math.abs(raw) > Number.MAX_SAFE_INTEGER || (!["oldSystemReading", "oldModuleRead"].includes(field) && !Number.isSafeInteger(raw)))) {
      errors.push(`${field}: send large identifiers as strings`); continue;
    }
    const value = String(raw).trim();
    if (value.length > importFields[field as ImportField]) errors.push(`${field}: value exceeds the field length`);
    if (["oldSystemReading", "oldModuleRead"].includes(field) && !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) errors.push(`${field}: use an exact decimal string`);
    mapped[field] = value;
  }
  for (const field of ["customerWoId", "customerId", "customerName", "address", "serviceType"]) {
    if (!mapped[field]) errors.push(`${field}: required source value is missing`);
  }
  if (mapped.customerWoId && (/[\\/]/.test(mapped.customerWoId) || [".", ".."].includes(mapped.customerWoId))) errors.push("customerWoId: unsafe work-order folder identifier");
  if (mapped.serviceType && !rules.services.includes(mapped.serviceType)) errors.push("serviceType: not configured for this project");
  if (mapped.status && !rules.statuses.includes(mapped.status)) errors.push("status: unknown status code");
  if (mapped.status && mapped.status !== rules.openStatus) errors.push("status: API imports only create Open work orders");
  if (mapped.oldSystemType && !rules.systems.includes(mapped.oldSystemType)) errors.push("oldSystemType: not configured for this project");
  if (mapped.oldModuleType && !rules.modules.includes(mapped.oldModuleType)) errors.push("oldModuleType: not configured for this project");
  if (mapped.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mapped.email)) errors.push("email: invalid email address");
  if (mapped.oldGps) {
    const parts = String(mapped.oldGps).split(",").map(value => value.trim());
    const [lat, lng] = parts.map(Number);
    if (parts.length !== 2 || parts.some(part => !part) || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) errors.push("oldGps: expected latitude,longitude");
  }
  mapped.status ||= rules.openStatus;
  return { mapped, errors };
}
