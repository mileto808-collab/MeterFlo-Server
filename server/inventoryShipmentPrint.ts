import type { InventoryReceipt, InventoryState, InventoryOrder, StockLine } from "../shared/inventory";
import { orderLineProgress, remainingHold, holdDispositions } from "../shared/inventory-shipment-model";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function shipmentPrint(kind: string, record: InventoryOrder | InventoryReceipt, state: InventoryState) {
  if (kind !== "order" && kind !== "receipt") return "";
  const labels = (l: StockLine) => `${state.items.find(i => i.id === l.itemId)?.sku || l.itemId} — ${state.items.find(i => i.id === l.itemId)?.name || ""}`;
  if (kind === "order") {
    const order = record as InventoryOrder;
    const holds = (state.shipmentHolds ?? []).filter(h => h.orderId === order.id);
    return `<h2>Fulfillment / custody</h2>${order.replacementFor ? `<p>Replacement for order: ${escape(order.replacementFor)}</p>` : ""}
      <table><thead><tr><th>Product</th><th>Ordered</th><th>Dispatched</th><th>Physically received</th><th>Usable accepted</th><th>Damaged total</th><th>Quarantined now</th><th>Transit loss</th><th>Still in transit</th><th>Still expected</th><th>Closed short</th></tr></thead><tbody>
      ${order.lines.map(l => { const p = orderLineProgress(state, order, l.itemId); return `<tr><td>${escape(labels(l))}</td>${[p.ordered, p.dispatched, p.received, p.usable, p.damaged, p.held, p.lost, p.inTransit, p.remaining, p.closedShort].map(n => `<td>${n}</td>`).join("")}</tr>`; }).join("")}
      </tbody></table><p>Usable accepted is historical acceptance/release, not current warehouse availability. Damaged goods may later be returned or scrapped.</p>
      ${order.closure ? `<p>Closed with exceptions by ${escape(order.closure.actor)} at ${escape(order.closure.occurredAt)}. Reason: ${escape(order.closure.reason)}. Closure receipt: ${escape(order.closure.operationId)}</p>` : ""}
      ${holds.map(h => `<p>Hold ${escape(h.id)} · Receipt ${escape(h.receiptId)} · ${escape(labels(h))}: originally ${h.quantity}, ${escape(h.status)}; ${escape(h.reason)}. Original known serials: ${escape(h.serials.join(", "))}; unidentified: ${h.unidentifiedQuantity}; unverified dispatch references: ${escape(h.expectedSerials.join(", "))}.
      Remaining quarantined: ${remainingHold(h).quantity}; known serials: ${escape(remainingHold(h).serials.join(", "))}; unidentified: ${remainingHold(h).unidentifiedQuantity}; dispatch references: ${escape(remainingHold(h).expectedSerials.join(", "))}.
      ${holdDispositions(h).map(event => `<br>Disposition receipt ${escape(event.operationId)} · ${escape(event.outcome)} · ${event.quantity} units · ${escape(event.actor)} · ${escape(event.occurredAt)} · ${escape(event.reason)} · ${escape(event.reference)} · known identities ${escape(event.serials.join(", "))} · unidentified ${event.unidentifiedQuantity} · dispatch references ${escape(event.expectedSerials.join(", "))} · verified identities ${escape(event.verifiedSerials.join(", "))}`).join("")}</p>`).join("")}
      <p>Replacement shipments require an explicitly linked new order; no increase to the original ordered quantities is implied.</p>`;
  }
  const r = record as InventoryReceipt;
  return `${r.resolution ? `<p>Disposition: ${escape(r.resolution)}. ${r.resolution === "confirmed transit loss" ? "These units were written off in transit, not physically received at the destination." : ""}</p>` : ""}
    ${r.holdId ? `<p>Shipment hold: ${escape(r.holdId)}</p>` : ""}
    ${r.holdDisposition ? `<p>This disposition covers ${r.holdDisposition.quantity} units only; it does not rewrite the original physical receipt. Unidentified units selected: ${r.holdDisposition.unidentifiedQuantity}. Known identities: ${escape(r.holdDisposition.serials.join(", "))}. Dispatch references: ${escape(r.holdDisposition.expectedSerials.join(", "))}. Verified release identities: ${escape(r.holdDisposition.verifiedSerials.join(", "))}.</p>` : ""}
    ${r.externalReference ? `<p>Return / external reference: ${escape(r.externalReference)}</p>` : ""}
    ${(r.damaged ?? []).map(l => `<p><strong>Damaged / quarantined:</strong> ${escape(labels(l))} × ${l.quantity}. Serial identities: ${escape(l.serials.join(", "))}; unidentified: ${l.unidentifiedQuantity}; unverified dispatch references: ${escape(l.expectedSerials.join(", "))}. Reason: ${escape(l.reason)}</p>`).join("")}
    ${r.closedShort ? `<h2>Approved closed-short quantities (not received)</h2>${r.closedShort.map(l => `<p>${escape(labels(l))} × ${l.quantity}</p>`).join("")}<p>Original ordered quantities were preserved. Reason: ${escape(r.reason)}</p>` : ""}`;
}
