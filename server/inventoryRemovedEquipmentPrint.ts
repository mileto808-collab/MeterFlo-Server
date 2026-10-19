import type { EquipmentReturn, InventoryState } from "../shared/inventory";
import { inventoryDateTime } from "../shared/inventory-date-time";
import { inventoryActorLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import { inventoryWorkOrderLabel, type InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";
import { removalDispositionDisplay, removalHistoryLabel, warehouseRemovalDecision } from "../shared/inventory-removal-display";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g,
  char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function inventoryRemovedEquipmentPrint(record: EquipmentReturn, state: InventoryState, project: string,
  actors: readonly InventoryActorLabel[], timezone: string, workOrderLabels: InventoryWorkOrderLabels) {
  const item = state.items.find(item => item.id === record.itemId);
  const location = state.warehouses.find(warehouse => warehouse.id === record.warehouseId);
  const decision = warehouseRemovalDecision(record);
  return `<!doctype html><html><head><meta charset="utf-8"><title>Removed equipment — ${escape(record.serial)}</title>
  <style>body{font:14px Arial,sans-serif;margin:24px;color:#111}h1{font-size:24px}dt{font-weight:bold}dd{margin:4px 0 14px;overflow-wrap:anywhere}
  table{border-collapse:collapse;width:100%;table-layout:fixed}th,td{border:1px solid #bbb;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}
  thead{display:table-header-group}tr{break-inside:avoid}button{padding:10px}@page{margin:15mm}@media print{button{display:none}body{margin:0}}</style></head>
  <body><button onclick="window.print()">Print / Save PDF</button><h1>Removed Equipment</h1><h2>${escape(project)}</h2>
  <dl><dt>Equipment</dt><dd>${record.equipment === "system" ? "System" : "Module"}</dd>
  <dt>Serial</dt><dd>${escape(record.serial)}</dd><dt>Work order</dt><dd>${escape(inventoryWorkOrderLabel(record.workOrderId, workOrderLabels))}</dd>
  <dt>Status</dt><dd>${escape(record.status)}</dd><dt>Field disposition</dt><dd>${escape(removalDispositionDisplay(state, record, "field").label)}</dd>
  <dt>Warehouse decision</dt><dd>${escape(decision ? removalDispositionDisplay(state, decision, "warehouse").label :
    record.disposition === "returned" ? "No warehouse decision recorded" : "Not applicable")}</dd>
  <dt>Return location</dt><dd>${escape(location?.name ?? "Location unavailable")}</dd>
  ${item ? `<dt>Released item</dt><dd>${escape(item.sku)} · ${escape(item.name)}</dd>` : ""}</dl>
  <h2>Custody &amp; decision history</h2><p>Timezone: ${escape(timezone)} · Disposition names below are shown as recorded.</p>
  ${record.history?.length ? `<table><thead><tr><th>Date &amp; time</th><th>Disposition / outcome</th><th>Reason</th><th>User</th></tr></thead><tbody>
  ${record.history.map(event => `<tr><td>${escape(inventoryDateTime(event.occurredAt, timezone))}</td>
  <td>${escape(removalHistoryLabel(state, record, event))}</td><td>${escape(event.reason)}</td><td>${escape(inventoryActorLabel(event.actor, actors))}</td></tr>`).join("")}
  </tbody></table>` : "<p>No custody or decision history was recorded.</p>"}</body></html>`;
}
