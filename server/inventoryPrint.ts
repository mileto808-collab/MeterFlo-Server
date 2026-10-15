import type { InventoryState } from "../shared/inventory";
import { inventoryCountReference } from "../shared/inventory-count-reference";
import { inventoryActorLabel, inventoryReceiptLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import { orderLabel, orderReference as customerOrderReference } from "../shared/inventory-order-labels";
import { inventoryBarcode } from "./inventoryBarcode";
import { shipmentPrint } from "./inventoryShipmentPrint";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function inventoryPrint(kind: string, record: any, state: InventoryState, project: string, actors: readonly InventoryActorLabel[] = []) {
  const lineList = record.lines || record.snapshot?.map((b: any) => ({ ...b, quantity: b.quantity })) || [];
  const warehouse = (id: string) => state.warehouses.find(w => w.id === id)?.name || id || "";
  const reference = kind === "count" ? inventoryCountReference(state.counts, record.id) :
    kind === "order" ? orderLabel(record) : inventoryReceiptLabel(state.receipts, record.id);
  const linkedOrder = kind === "order" ? record : kind === "receipt" ? state.orders.find(order => order.id === record.reference) : undefined;
  const orderReference = linkedOrder ? `${orderLabel(linkedOrder)}${customerOrderReference(linkedOrder) ? ` · Reference: ${customerOrderReference(linkedOrder)}` : ""}` : undefined;
  const actorLabel = (id: string) => inventoryActorLabel(id, actors);
  const origin = linkedOrder || record;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(reference)}</title><style>
    body{font:14px Arial;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #bbb;padding:8px;text-align:left}button{padding:10px}
    .internal-barcode{margin:12px 0;break-inside:avoid;page-break-inside:avoid}.internal-barcode figcaption{font-size:12px;font-weight:bold;margin-bottom:4px}.internal-barcode svg{display:block;width:135mm;max-width:100%;height:auto}
    @media print{button{display:none}.internal-barcode{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head>
    <body><button onclick="window.print()">Print / Save PDF</button><h1>${escape(project)} — ${escape(kind)}</h1>
    <p>${escape(reference)} · Status: ${escape(record.status || record.action)}</p>
    ${orderReference ? `<p><strong>Order number / reference: ${escape(orderReference)}</strong></p>` :
      kind === "receipt" && record.reference ? `<p>Operation reference: ${escape(record.reference)}</p>` : ""}
    <p>Date: ${escape(record.createdAt || record.occurredAt)} · Actor: ${escape(actorLabel(record.actor))}</p>
    <p>From: ${escape(warehouse(origin.sourceId))} · To: ${escape(warehouse(origin.destinationId || record.warehouseId))}</p>
    <p>Vendor: ${escape(state.vendors.find(v => v.id === origin.vendorId)?.name)} · ${escape(record.reason || record.notes)}</p>
    ${kind === "receipt" ? inventoryBarcode(record.id, "Internal receipt ID") : ""}
    ${linkedOrder ? inventoryBarcode(linkedOrder.id, "Internal order ID") : ""}
    <table><thead><tr><th>SKU</th><th>Item</th><th>Quantity</th><th>Serials</th><th>Dispatched</th><th>Received</th></tr></thead><tbody>
    ${lineList.map((l: any) => `<tr><td>${escape(state.items.find(i => i.id === l.itemId)?.sku)}</td><td>${escape(state.items.find(i => i.id === l.itemId)?.name)}</td>
    <td>${escape(l.quantity)}</td><td>${escape((l.serials || []).join(", "))}</td><td>${escape((record.dispatched || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td>
    <td>${escape((record.received || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td></tr>`).join("")}</tbody></table>
    ${shipmentPrint(kind, record, state, actorLabel)}
    ${record.components ? `<h2>Components</h2><p>${escape(record.components.map((l: any) => `${l.itemId}: ${l.quantity} (${l.serials.join(", ")})`).join("; "))}</p>` : ""}</body></html>`;
}
