import type { InventoryReceipt, InventoryState } from "../shared/inventory";
import { inventoryReceiptLabel } from "../shared/inventory-display-labels";
import { receiptSerialSummary } from "./inventoryReceiptSerials";

const escape = (v: unknown) => String(v ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function inventoryKitPrint(receipt: InventoryReceipt, state: InventoryState) {
  if (!["assemble", "disassemble", "resolveKitHold"].includes(receipt.action)) return "";
  const itemName = (itemId: string) => {
    const item = state.items.find(i => i.id === itemId);
    return `${item?.sku ?? "Unavailable product"} · ${item?.name ?? ""}`;
  };
  if (receipt.action === "assemble") return `<h2>Stock conversion</h2><p>Finished kits added to usable stock above. Components deducted:</p>
    <table><thead><tr><th>Component</th><th>Consumed quantity</th><th>Serial evidence</th></tr></thead><tbody>
    ${(receipt.components ?? []).map(c => `<tr><td>${escape(itemName(c.itemId))}</td><td>${c.quantity}</td><td>${receiptSerialSummary(c)}</td></tr>`).join("")}</tbody></table>`;
  if (receipt.kitConversion) return `<h2>Stock conversion</h2><p>Finished kits above were removed, not received.
    Original assembly: <strong>${escape(inventoryReceiptLabel(state.receipts, receipt.kitConversion.assemblyId))}</strong>.
    Only usable recovered quantities below were added to stock; damaged quantities are held for inspection and missing quantities are not stock.</p>
    <table><thead><tr><th>Component</th><th>Usable returned</th><th>Damaged / held</th><th>Missing</th><th>Condition / reason</th></tr></thead><tbody>
    ${receipt.kitConversion.recovered.map(c => `<tr><td>${escape(itemName(c.itemId))}</td><td>${c.usableQuantity}</td>
      <td>${c.damagedQuantity}</td><td>${c.missingQuantity}</td><td>${escape(c.reason)}</td></tr>`).join("")}</tbody></table>`;
  const hold = state.kitHolds?.find(h => h.id === receipt.kitHoldId);
  return `<h2>Kit component inspection</h2><p>${escape(itemName(hold?.itemId ?? receipt.reference))}:
    ${escape(receipt.resolution)}. ${receipt.resolution === "released" ? "Inspected components added to usable stock." : "Scrapped components were not added to usable stock."}
    Selected quantity: ${receipt.kitInspection?.quantity ?? hold?.quantity ?? 0}.
    ${hold ? `Original assembly: ${escape(inventoryReceiptLabel(state.receipts, hold.assemblyId))}. Original held quantity: ${hold.quantity}.` : ""}
    Unselected components remain in their existing custody.</p>`;
}
