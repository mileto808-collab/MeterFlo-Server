import { inventoryDateTime } from "./inventory-date-time";

export function historyFieldLabel(field: string): string {
  const labels: Record<string, string> = { workOrderId: "Work order", work_order_id: "Work order",
    system_work_order_id: "Work order", customer_wo_id: "Customer work-order ID", customerWoId: "Customer work-order ID",
    itemId: "Item", warehouseId: "Location", ruleId: "Removal rule", ruleName: "Removal rule",
    assigned_user_id: "Assigned installer", assigned_group_id: "Assigned group",
    used: "Installed items", lines: "Reserved items", dispositions: "Removed equipment", reserved: "Reserved quantity",
    serials: "Serials", mode: "Work type", workOrderIds: "Work orders", policyRevision: "Policy version",
    source: "Source", gps_source: "GPS source", revision: "Record version" };
  return labels[field] ?? field.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_.-]+/g, " ")
    .replace(/\bwo\b/gi, "work order").replace(/\bid\b/gi, "ID").replace(/^./, c => c.toUpperCase());
}

export function historyActionLabel(action: string): string {
  const labels: Record<string, string> = {
    "workOrder.close": "Work order closed", "workOrder.autoClose": "Automatically closed after review",
    "workOrder.reopen": "Work order reopened", "workOrder.closingPolicyChanged": "Closing policy changed",
    "workOrder.changeBlocked": "Change blocked: work order closed", "workOrder.evidenceAdded": "Evidence added",
    "workOrder.evidenceRemoved": "Evidence removed", created: "Work order created", updated: "Work order updated",
    "workOrder.completionAccepted": "Work-order completion accepted",
    "workOrder.close.started": "Bulk work-order closing started",
    "workOrder.close.finished": "Bulk work-order closing completed",
    deleted: "Work order deleted", "operation.started": "Operation started", "operation.finished": "Operation finished",
    "inventory.workOrderCompleted": "Work order completed · Inventory recorded",
    "inventory.WorkOrderCompleted": "Work order completed · Inventory recorded",
    "inventory.workOrderChanged": "Work-order inventory updated", "inventory.WorkOrderChanged": "Work-order inventory updated",
  };
  return labels[action] ?? historyFieldLabel(action);
}

/** Human-readable detail text, not JSON. Reference resolution is project-scoped on the server. */
export function historyDisplayText(value: unknown, key = "", timezone = "UTC"): string {
  const formatted = workOrderHistoryValue(value, key, timezone);
  if (formatted == null || formatted === "") return "—";
  if (typeof formatted === "boolean") return formatted ? "Yes" : "No";
  if (Array.isArray(formatted)) {
    if (!formatted.length) return "None";
    return formatted.map(entry => historyDisplayText(entry, key, timezone)).join("\n");
  }
  if (typeof formatted === "object") {
    const entries = Object.entries(formatted as Record<string, unknown>);
    if (!entries.length) return "None";
    return entries.map(([field, entry]) => `${historyFieldLabel(field)}: ${historyDisplayText(entry, field, timezone)}`).join("\n");
  }
  const labels: Record<string, string> = { consumed: "Consumed", reserved: "Reserved", returned: "Returned",
    changeout: "Changeout", reading: "Reading", success: "Successful", failed: "Failed", partial: "Partial",
    reused_old: "Reused from old equipment" };
  return labels[String(formatted)] ?? String(formatted);
}
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
