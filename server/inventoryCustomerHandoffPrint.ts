import type { InventoryState } from "../shared/inventory";
import type { CustomerHandoff } from "../shared/inventory-customer-handoffs";
import { inventoryDateTime } from "../shared/inventory-date-time";
import { inventoryActorLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function inventoryCustomerHandoffPrint(record: CustomerHandoff, state: InventoryState, project: string,
  actors: readonly InventoryActorLabel[], timezone: string, workOrderLabels: InventoryWorkOrderLabels) {
  const verification = record.verification === "scan" ? "Every serial scanned" : "Every serial visually inspected";
  const location = state.warehouses.find(warehouse => warehouse.id === record.warehouseId);
  const heading = `<p>${escape(project)} · ${escape(location?.name ?? record.warehouseId)}</p>
    <p>Manifest: ${escape(record.id)} · ${escape(inventoryDateTime(record.occurredAt, timezone))}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>Customer return manifest</title><style>
    body{font:14px Arial,sans-serif;color:#111;margin:24px}table{border-collapse:collapse;width:100%;margin-top:16px;table-layout:fixed}
    th,td{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
    thead{display:table-header-group}tr{break-inside:avoid}p{overflow-wrap:anywhere}.serials{margin-top:32px}
    @page{size:auto;margin:12mm}@media print{button{display:none}.serials{break-before:page;page-break-before:always;margin-top:0}}
    </style></head><body><button onclick="window.print()">Print / Save PDF</button>
    <h1>Customer return manifest</h1>${heading}
    <p><strong>Customer recipient / collected by:</strong> ${escape(record.recipient)}</p>
    <p><strong>Handoff / shipping reference:</strong> ${escape(record.reference || "Not provided")}</p>
    <p><strong>Handed off by:</strong> ${escape(inventoryActorLabel(record.actor, actors))}</p>
    <p><strong>Verification:</strong> ${verification}</p><p><strong>Notes:</strong> ${escape(record.reason)}</p>
    <table><thead><tr><th>Equipment</th><th>Quantity handed off</th></tr></thead><tbody>
    ${(["system", "module"] as const).map(equipment => `<tr><td>${equipment === "system" ? "Systems" : "Modules"}</td>
    <td>${record.lines.filter(line => line.equipment === equipment).length}</td></tr>`).join("")}
    <tr><th>Total</th><td>${record.lines.length}</td></tr></tbody></table>
    <p>This manifest records an actual customer handoff. Equipment was not released to usable stock.</p>
    <section class="serials"><h1>Customer return serials</h1>${heading}<p>${verification}.
    ${record.verification === "scan" ? "Serials below were scanned for this handoff, in scan order." : "Serials below are the previously collected equipment serials, visually verified at handoff."}</p>
    <table><thead><tr><th style="width:5%">#</th><th>Serial</th><th>Equipment</th><th>Customer work order</th></tr></thead><tbody>
    ${record.lines.map((line, index) => `<tr><td>${index + 1}</td><td>${escape(record.verification === "scan" ? line.verifiedSerial : line.serial)}</td>
      <td>${line.equipment === "system" ? "System" : "Module"}</td><td>${escape(workOrderLabels[String(line.workOrderId)] ?? line.workOrderId)}</td></tr>`).join("")}
    </tbody></table></section></body></html>`;
}
