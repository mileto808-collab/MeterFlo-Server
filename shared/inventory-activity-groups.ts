import type { InventoryReceipt, InventoryState } from "./inventory";
import { inventoryReceiptContexts, inventoryReceiptOperationReference } from "./inventory-receipt-context";
import { inventoryWorkOrderLabel, type InventoryWorkOrderLabels } from "./inventory-work-order-labels";
import { orderLabel } from "./inventory-order-labels";
import { inventoryCountReference } from "./inventory-count-reference";
import { inventoryReceiptLabel } from "./inventory-display-labels";

export type InventoryActivityGroup = {
  id: string; title: string; receipts: InventoryReceipt[]; returnIds: string[];
  workOrderIds: number[]; batch: boolean; latestSequence: number;
};

export function inventoryActivityActionLabel(action: string): string {
  const labels: Record<string, string> = {
    complete: "Work order completed", returnAccept: "Accepted into quarantine",
    returnDecide: "Warehouse decision", returnCustomerBatch: "Customer handoff",
    returnCorrectDecision: "Warehouse decision corrected",
    fieldUseShortage: "Field usage · stock discrepancy",
    resolveStockDiscrepancy: "Stock discrepancy resolved",
  };
  return labels[action] ?? action.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, letter => letter.toUpperCase());
}

/** Connected business operations, not matching catalog IDs, serials, notes, or locations.
 * Batch receipts join all their equipment histories into one summary. Only the supplied
 * (already authorized) state participates; no hidden history is fetched here.
 */
export function inventoryActivityGroups(state: InventoryState, labels: InventoryWorkOrderLabels = {}): InventoryActivityGroup[] {
  const contexts = inventoryReceiptContexts(state);
  const orders = new Map(state.orders.map(order => [order.id, order]));
  const counts = new Set(state.counts.map(count => count.id));
  const handoffs = new Map((state.customerHandoffs ?? []).map(handoff => [handoff.id, handoff]));
  const holds = new Map((state.shipmentHolds ?? []).map(hold => [hold.id, hold]));
  const kitHolds = new Map((state.kitHolds ?? []).map(hold => [hold.id, hold]));
  const parent = state.receipts.map((_, index) => index);
  const root = (index: number): number => {
    let current = index;
    while (parent[current] !== current) current = parent[current];
    while (parent[index] !== index) { const next = parent[index]; parent[index] = current; index = next; }
    return current;
  };
  const owners = new Map<string, number>();
  state.receipts.forEach((receipt, index) => {
    const keys = [`receipt:${receipt.id}`, ...(contexts.get(receipt.id)?.removed ?? []).map(record => `return:${record.id}`)];
    const order = orders.get(receipt.reference);
    if (order) {
      keys.push(`order:${order.id}`);
      if (order.replacementFor) keys.push(`order:${order.replacementFor}`);
    }
    if (counts.has(receipt.reference) && receipt.action.startsWith("count")) keys.push(`count:${receipt.reference}`);
    const handoff = receipt.action === "returnCustomerBatch" ? handoffs.get(receipt.reference) : undefined;
    if (handoff) keys.push(`handoff:${handoff.id}`, ...handoff.lines.map(line => `return:${line.returnId}`));
    if (receipt.sourceReceiptId) keys.push(`receipt:${receipt.sourceReceiptId}`);
    if (receipt.kitConversion) keys.push(`receipt:${receipt.kitConversion.assemblyId}`);
    if (receipt.kitHoldId) {
      keys.push(`kit-hold:${receipt.kitHoldId}`);
      const hold = kitHolds.get(receipt.kitHoldId);
      if (hold) keys.push(`receipt:${hold.assemblyId}`);
    }
    if (receipt.holdId) {
      keys.push(`hold:${receipt.holdId}`);
      const hold = holds.get(receipt.holdId);
      if (hold) keys.push(`receipt:${hold.receiptId}`, `order:${hold.orderId}`);
    }
    for (const key of keys) {
      const previous = owners.get(key);
      if (previous !== undefined) parent[root(index)] = root(previous);
      else owners.set(key, index);
    }
  });
  const components = new Map<number, number[]>();
  state.receipts.forEach((_, index) => {
    const key = root(index);
    const entries = components.get(key) ?? [];
    entries.push(index); components.set(key, entries);
  });
  return [...components.values()].map(indices => {
    const receipts = indices.map(index => state.receipts[index]).sort((a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    const removed = [...new Map(receipts.flatMap(receipt => contexts.get(receipt.id)?.removed ?? []).map(record => [record.id, record])).values()];
    const workOrderIds = [...new Set(receipts.flatMap(receipt => contexts.get(receipt.id)?.workOrderIds ?? []))];
    const batch = removed.length > 1 || receipts.some(receipt => receipt.lines.reduce((total, line) => total + line.quantity, 0) > 1);
    const handoff = receipts.map(receipt => receipt.action === "returnCustomerBatch" ? handoffs.get(receipt.reference) : undefined).find(Boolean);
    const order = receipts.map(receipt => orders.get(receipt.reference)).find(Boolean);
    const count = receipts.find(receipt => counts.has(receipt.reference) && receipt.action.startsWith("count"));
    const kitReceipt = receipts.find(receipt => ["assemble", "disassemble", "verifyVendorKit", "resolveKitHold"].includes(receipt.action));
    const kitItem = kitReceipt ? state.items.find(item => item.id === kitReceipt.reference) : undefined;
    const workOrders = workOrderIds.length === 1 ? `Work order ${inventoryWorkOrderLabel(workOrderIds[0], labels)}` : `${workOrderIds.length} work orders`;
    const title = handoff ? `Customer return batch · ${handoff.lines.length} equipment ${handoff.reference ? `· ${handoff.reference}` : ""}` :
      removed.length ? `${removed.length === 1 ? `Removed ${removed[0].equipment} · ${removed[0].serial}` : `Removed equipment batch · ${removed.length} items`} · ${workOrders}` :
      order ? `${orderLabel(order)} · ${order.type}` :
      count ? inventoryCountReference(state.counts, count.reference) :
      kitReceipt ? `${inventoryActivityActionLabel(kitReceipt.action)} · ${kitItem ? `${kitItem.sku} — ${kitItem.name}` : "Kit (product unavailable)"} · ${inventoryReceiptLabel(state.receipts, kitReceipt.id)}` :
      `${inventoryActivityActionLabel(receipts[0].action)} · ${inventoryReceiptOperationReference(receipts[0], contexts.get(receipts[0].id), labels)}`;
    return { id: state.receipts[indices[0]].id, title, receipts, returnIds: removed.map(record => record.id),
      workOrderIds, batch: batch || !!handoff, latestSequence: indices[indices.length - 1] + 1 };
  });
}
