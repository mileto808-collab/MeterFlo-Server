import type { InventoryState } from "../shared/inventory";
import { inventoryCountReference } from "../shared/inventory-count-reference";
import { inventoryActorLabel, inventoryReceiptLabel, type InventoryActorLabel } from "../shared/inventory-display-labels";
import { orderLabel, orderReference as customerOrderReference } from "../shared/inventory-order-labels";
import { inventoryBarcode } from "./inventoryBarcode";
import { shipmentPrint } from "./inventoryShipmentPrint";
import { receiptSerialAppendix, receiptSerialSummary } from "./inventoryReceiptSerials";
import { inventoryKitPrint } from "./inventoryKitPrint";
import { inventoryDateTime } from "../shared/inventory-date-time";
import { inventoryRemovedEquipmentPrint } from "./inventoryRemovedEquipmentPrint";
import { inventoryCustomerHandoffPrint } from "./inventoryCustomerHandoffPrint";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";
import { removalActivityIndex, removalActivityDisplay } from "../shared/inventory-removal-display";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function inventoryPrint(kind: string, record: any, state: InventoryState, project: string, actors: readonly InventoryActorLabel[] = [], timezone = "UTC", workOrderLabels: InventoryWorkOrderLabels = {}) {
  if (kind === "return") return inventoryRemovedEquipmentPrint(record, state, project, actors, timezone, workOrderLabels);
  if (kind === "customer-handoff") return inventoryCustomerHandoffPrint(record, state, project, actors, timezone, workOrderLabels);
  if (kind === "receipt" && record.action === "returnCustomerBatch") {
    const handoff = state.customerHandoffs?.find(handoff => handoff.id === record.reference);
    if (!handoff) throw new Error("Customer handoff manifest is unavailable.");
    return inventoryCustomerHandoffPrint(handoff, state, project, actors, timezone, workOrderLabels);
  }
  const removal = kind === "receipt" ? removalActivityDisplay(state, removalActivityIndex(state).get(record.id) ?? []) : undefined;
  const lineList = record.lines || record.snapshot?.map((b: any) => ({ ...b, quantity: b.quantity })) || [];
  const warehouse = (id: string) => state.warehouses.find(w => w.id === id)?.name || id || "";
  const reference = kind === "count" ? inventoryCountReference(state.counts, record.id) :
    kind === "order" ? orderLabel(record) : inventoryReceiptLabel(state.receipts, record.id);
  const linkedOrder = kind === "order" ? record : kind === "receipt" ? state.orders.find(order => order.id === record.reference) : undefined;
  const orderReference = linkedOrder ? `${orderLabel(linkedOrder)}${customerOrderReference(linkedOrder) ? ` · Reference: ${customerOrderReference(linkedOrder)}` : ""}` : undefined;
  const actorLabel = (id: string) => inventoryActorLabel(id, actors);
  const origin = linkedOrder || record;
  const kitReceipt = kind === "receipt" && ["assemble", "verifyVendorKit", "disassemble", "resolveKitHold"].includes(record.action);
  const kitItem = kitReceipt ? state.items.find(i => i.id === record.reference) : undefined;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(reference)}</title><style>
     body{font:14px Arial;margin:30px;color:#111}table{border-collapse:collapse;width:100%;margin-top:20px}th,td{border:1px solid #bbb;padding:8px;text-align:left}button{padding:10px}
    .internal-barcode{margin:12px 0;break-inside:avoid;page-break-inside:avoid}.internal-barcode figcaption{font-size:12px;font-weight:bold;margin-bottom:4px}.internal-barcode svg{display:block;width:135mm;max-width:100%;height:auto}
     .serial-details{margin-top:2rem}.serial-details>h2{margin-top:0}.serial-evidence-group{table-layout:fixed;break-inside:auto;page-break-inside:auto;margin-top:1rem}
     .serial-evidence-group thead{display:table-header-group}.serial-evidence-group tr{break-inside:avoid;page-break-inside:avoid}
     .serial-number-column{width:3.5rem}.serial-evidence-group td{vertical-align:top}.serial-evidence-group .serial-text{overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap}
     .serial-identification th{font-size:12px}.serial-evidence-group .unidentified td{font-style:italic}
     @media print{button{display:none}.internal-barcode{-webkit-print-color-adjust:exact;print-color-adjust:exact}.serial-details{break-before:page;page-break-before:always}
       .serial-evidence-group{font-size:10pt}.serial-evidence-group th,.serial-evidence-group td{padding:5px}}
     ${kind === "receipt" ? "@page{size:auto;margin:12mm}" : ""}</style></head>
    <body><button onclick="window.print()">Print / Save PDF</button><h1>${escape(project)} — ${escape(kind)}</h1>
    <p>${escape(reference)} · Status: ${escape(record.status || record.action)}</p>
    ${orderReference ? `<p><strong>Order number / reference: ${escape(orderReference)}</strong></p>` :
      kitReceipt ? `<p>Kit / component: ${escape(kitItem ? `${kitItem.sku} · ${kitItem.name}` : "Unavailable product")}</p>` :
      kind === "receipt" && record.reference ? `<p>Operation reference: ${escape(record.reference)}</p>` : ""}
    <p>Date: ${escape(inventoryDateTime(record.createdAt || record.occurredAt, timezone))} · Actor: ${escape(actorLabel(record.actor))}</p>
    <p>From: ${escape(warehouse(origin.sourceId))} · To: ${escape(warehouse(origin.destinationId || record.warehouseId))}</p>
    <p>Vendor: ${escape(state.vendors.find(v => v.id === origin.vendorId)?.name)} · ${escape(record.reason || record.notes)}</p>
    ${kind === "receipt" ? inventoryBarcode(record.id, "Internal receipt ID", reference) : ""}
    ${linkedOrder ? inventoryBarcode(linkedOrder.id, "Internal order ID", orderLabel(linkedOrder)) : ""}
    <table><thead><tr><th>SKU</th><th>Item</th><th>Quantity</th><th>Serials</th><th>Dispatched</th><th>Received</th></tr></thead><tbody>
     ${lineList.map((l: any) => `<tr><td>${escape(state.items.find(i => i.id === l.itemId)?.sku)}</td><td>${escape(state.items.find(i => i.id === l.itemId)?.name)}</td>
     <td>${escape(l.quantity)}</td><td>${kind === "receipt" ? receiptSerialSummary(l) : escape((l.serials || []).join(", "))}</td><td>${escape((record.dispatched || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td>
    <td>${escape((record.received || []).filter((x: any) => x.itemId === l.itemId).reduce((n: number, x: any) => n + x.quantity, 0))}</td></tr>`).join("")}</tbody></table>
    ${record.labor?.length ? `<h2>Labor pricing snapshot</h2><p>Configured labor allowance at assembly time. No physical stock was consumed or recovered for labor. This is not an invoice or time entry.</p>
      <table><thead><tr><th>SKU</th><th>Labor</th><th>Units</th><th>Unit</th><th>Unit cost</th><th>Billing rate</th><th>Cost estimate</th><th>Billed estimate</th></tr></thead><tbody>
      ${record.labor.map((line: any) => `<tr><td>${escape(line.sku)}</td><td>${escape(line.name)}</td><td>${escape(line.quantity)}</td><td>${escape(line.unit)}</td>
        <td>${escape(Number(line.cost).toFixed(2))}</td><td>${escape(Number(line.billingRate).toFixed(2))}</td><td>${escape((line.quantity * line.cost).toFixed(2))}</td><td>${escape((line.quantity * line.billingRate).toFixed(2))}</td></tr>`).join("")}</tbody></table>` : ""}
    ${shipmentPrint(kind, record, state, actorLabel, timezone)}
      ${kitReceipt ? inventoryKitPrint(record, state) : record.components ? `<h2>Components</h2><p>${kind === "receipt" ? record.components.map((l: any) => `${escape(l.itemId)}: ${escape(l.quantity)} (${receiptSerialSummary(l)})`).join("; ") : escape(record.components.map((l: any) => `${l.itemId}: ${l.quantity} (${(l.serials || []).join(", ")})`).join("; "))}</p>` : ""}
     ${removal?.fieldLabel ? `<p>Field disposition: ${escape(removal.fieldLabel)}</p>` : ""}
     ${removal?.decisionLabel ? `<p>Warehouse decision: ${escape(removal.decisionLabel)}</p>` : ""}
     ${removal?.custodyLabel ? `<p>Custody event: ${escape(removal.custodyLabel)}</p>` : ""}
     ${kind === "receipt" ? receiptSerialAppendix(record, state, project) : ""}</body></html>`;
}
