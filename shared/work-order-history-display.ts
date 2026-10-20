import { inventoryDateTime } from "./inventory-date-time";
/** Display enrichment only. The append-only audit values are never rewritten. */
export function workOrderHistoryValue(value: unknown, key: string, timezone: string): unknown {
  if (["source", "gpsSource", "gps_source"].includes(key) && value === "reused_old")
    return "Reused from old equipment";
  if (Array.isArray(value)) return value.map(v => workOrderHistoryValue(v, key, timezone));
  if (value && typeof value === "object") {
    const row = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(row).map(([k, v]) => [k,
      workOrderHistoryValue(v, (k === "before" || k === "after") && typeof row.field === "string" ? row.field : k, timezone)]));
  }
  if (typeof value === "string" && /(?:_at|At|_time|Time|_window_start|_window_end)$/.test(key) &&
      /^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(value))
    return inventoryDateTime(value, timezone);
  return value;
}
