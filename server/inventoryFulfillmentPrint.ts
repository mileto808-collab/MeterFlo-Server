import type { InventoryState } from "../shared/inventory";
import type { FulfillmentBatch } from "../shared/inventory-fulfillment";
import { inventoryActorLabel, inventoryReceiptLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import { inventoryDateTime } from "../shared/inventory-date-time";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";

const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]!));

export function inventoryFulfillmentPrint(batch: FulfillmentBatch, state: InventoryState, project: string,
  actors: readonly InventoryActorLabel[] = [], timezone = "UTC", workOrderLabels: InventoryWorkOrderLabels = {}) {
  const location = (id: string | null) => state.warehouses.find(row => row.id === id)?.name ?? "Unavailable location";
  const product = (id: string) => {
    const item = state.items.find(row => row.id === id);
    return item ? `${item.sku} · ${item.name}` : "Unavailable item";
  };
  const movements = state.receipts.filter(receipt => receipt.reference === batch.id &&
    ["fulfillmentMove", "fulfillmentClose"].includes(receipt.action))
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const reviews = state.receipts.filter(receipt => receipt.reference === batch.id && receipt.action === "fulfillmentReassign")
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  const totals = new Map<string, { planned: number; staged: number; handedOff: number }>();
  for (const line of batch.lines) {
    const row = totals.get(line.itemId) ?? { planned: 0, staged: 0, handedOff: 0 };
    row.planned += line.quantity; row.staged += line.stagedQuantity; row.handedOff += line.deliveredQuantity;
    totals.set(line.itemId, row);
  }
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escape(batch.name)} — Combined fulfillment receipt</title><style>
      body{font:14px Arial,sans-serif;color:#111;margin:24px;overflow-wrap:anywhere}
      h1{font-size:24px}h2{font-size:18px;margin-top:28px}h3{font-size:16px}
      table{width:100%;border-collapse:collapse;margin:14px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}
      thead{display:table-header-group}button{padding:10px}.table-scroll{overflow-x:auto}.muted{color:#444}.serials{overflow-wrap:anywhere}
      @media print{button{display:none}body{margin:0;font-size:11px}.table-scroll{overflow:visible}h2,h3{break-after:avoid}thead{display:table-header-group}}
      @page{margin:12mm}
    </style></head><body>
    <button onclick="window.print()">Print / Save PDF</button>
    <h1>Combined fulfillment receipt</h1>
    <p><strong>${escape(project)} · ${escape(batch.name)}</strong></p>
    <p>Status: ${escape(batch.status)} · ${batch.mode === "crew" ? "Shared crew pool" : "Individually scheduled work"}</p>
    <p>Created: ${escape(inventoryDateTime(batch.createdAt, timezone))} · ${escape(inventoryActorLabel(batch.createdBy, actors))}</p>
    <p>Timezone: ${escape(timezone)}</p>
    <p>Warehouse: ${escape(location(batch.sourceId))} → Staging: ${escape(location(batch.stagingId))} → Vehicle: ${escape(location(batch.vehicleId))}</p>
    <p>Work orders: ${batch.workOrders.map(work => escape(workOrderLabels[String(work.workOrderId)] || work.label)).join(", ")}</p>
    <p class="muted">Complete recorded batch history, including partial pulls and handoffs. Physical custody only; these serials are not installed-equipment assignments.
    Quantities in separate transfers are not added together as newly received stock.</p>
    <h2>Batch quantities</h2><div class="table-scroll"><table><thead><tr><th>Item / SKU</th><th>Planned</th><th>Pulled to staging</th><th>Handed to vehicle</th><th>Still at staging</th><th>Not pulled</th></tr></thead><tbody>
    ${[...totals].map(([id, row]) => `<tr><td>${escape(product(id))}</td><td>${row.planned}</td><td>${row.staged}</td><td>${row.handedOff}</td><td>${row.staged - row.handedOff}</td><td>${row.planned - row.staged}</td></tr>`).join("")}
    </tbody></table></div>
    <h2>Recorded movements</h2>
    ${movements.length ? movements.map((receipt, index) => {
      const released = receipt.action === "fulfillmentClose";
      const phase = released ? "Unfinished remainder released" : receipt.warehouseId === batch.stagingId
        ? "Warehouse → Staging" : receipt.warehouseId === batch.vehicleId ? "Staging → Vehicle" : "Stock movement";
      return `<section><h3>${index + 1}. ${escape(phase)}</h3>
        <p>${escape(inventoryReceiptLabel(state.receipts, receipt.id))} · ${escape(inventoryDateTime(receipt.occurredAt, timezone))} · ${escape(inventoryActorLabel(receipt.actor, actors))}</p>
        <p>${escape(receipt.reason || "")}</p>
        ${released ? "<p>Release only: no physical return or stock transfer was recorded by this action.</p>" :
          `<div class="table-scroll"><table><thead><tr><th>Item / SKU</th><th>Quantity</th><th>Custody serials</th></tr></thead><tbody>
          ${receipt.lines.map(line => `<tr><td>${escape(product(line.itemId))}</td><td>${line.quantity}</td><td class="serials">${line.serials.length ? line.serials.map(escape).join(", ") : "Not serialized"}</td></tr>`).join("")}
          </tbody></table></div>`}</section>`;
    }).join("") : "<p>No physical stock movements have been recorded for this batch.</p>"}
    ${reviews.length ? `<h2>Reassignment reviews — no stock movement</h2>${reviews.map(receipt =>
      `<section><p>${escape(inventoryDateTime(receipt.occurredAt, timezone))} · ${escape(inventoryActorLabel(receipt.actor, actors))}</p>
      <p>${escape(receipt.reason || "")}</p></section>`).join("")}` : ""}
    </body></html>`;
}
