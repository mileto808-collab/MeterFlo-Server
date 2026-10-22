import type { InventoryState, InventoryReceipt } from "./inventory";
import type { FulfillmentBatch } from "./inventory-fulfillment";

export type FulfillmentDeletionStatus = { allowed: boolean; reason?: string };

/** Read-only custody verification. Removing a batch never performs an implicit stock return. */
export function fulfillmentDeletionStatus(state: InventoryState, batch: FulfillmentBatch): FulfillmentDeletionStatus {
  const blocked = (reason: string): FulfillmentDeletionStatus => ({ allowed: false, reason });
  const location = (id: string) => state.warehouses.find(value => value.id === id)?.name ?? id;
  const itemName = (id: string) => state.items.find(value => value.id === id)?.name ?? id;
  const history = state.receipts.filter(receipt => receipt.reference === batch.id);
  if (!history.some(receipt => receipt.action === "fulfillmentCreate"))
    return blocked("The original batch record is unavailable. Ask an inventory manager to reconcile its history before deleting it.");
  const issue = batch.issues?.find(value => value.status !== "resolved");
  if (issue) return blocked(`Resolve the ${issue.category.replaceAll("_", " ")} issue for ${itemName(issue.itemId)} before deleting this batch.`);
  const hadPostedCustody = history.some(receipt => receipt.action === "fulfillmentMove" ||
      receipt.stagingCorrection?.before.some(line => line.quantity > 0) ||
      receipt.stagingCorrection?.after.some(line => line.quantity > 0)) ||
    batch.lines.some(line => line.stagedQuantity || line.deliveredQuantity || line.stagedSerials.length || line.deliveredSerials.length);
  if (!hadPostedCustody) return { allowed: true };

  const items = [...new Set(batch.lines.map(line => line.itemId))];
  for (const itemId of items) {
    const held = state.allocations.find(allocation => allocation.status === "reserved" &&
      batch.workOrders.some(work => work.workOrderId === allocation.workOrderId) &&
      allocation.lines.some(line => line.itemId === itemId && line.quantity > 0 &&
        [batch.sourceId, batch.stagingId, batch.vehicleId].includes(line.warehouseId)));
    if (held) return blocked(`Release the remaining ${itemName(itemId)} reservation for work order ${batch.workOrders.find(work => work.workOrderId === held.workOrderId)?.label ?? held.workOrderId} before deleting this batch.`);
  }

  // Each source debit needs a later source credit. Current balances alone cannot establish a reversal.
  const serialDebits = new Map<string, Map<string, number>>();
  const returnedAt = new Map<string, Map<string, number>>();
  const quantityOutstanding = new Map<string, number>();
  const remember = (target: Map<string, Map<string, number>>, item: string, serial: string, index: number) => {
    let rows = target.get(item);
    if (!rows) { rows = new Map(); target.set(item, rows); }
    rows.set(serial, index);
  };
  const debit = (line: { itemId: string; quantity: number; serials: string[] }, index: number) => {
    quantityOutstanding.set(line.itemId, (quantityOutstanding.get(line.itemId) ?? 0) + line.quantity);
    for (const serial of line.serials) remember(serialDebits, line.itemId, serial, index);
  };
  const credit = (line: { itemId: string; quantity: number; serials: string[] }, index: number) => {
    quantityOutstanding.set(line.itemId, (quantityOutstanding.get(line.itemId) ?? 0) - line.quantity);
    for (const serial of line.serials) remember(returnedAt, line.itemId, serial, index);
  };
  for (const [index, receipt] of state.receipts.entries()) {
    if (receipt.reference !== batch.id) continue;
    if (receipt.action === "fulfillmentMove" && receipt.warehouseId === batch.stagingId)
      for (const line of receipt.lines) debit(line, index);
    if (receipt.stagingCorrection) {
      const evidence = receipt.stagingCorrection;
      for (const before of evidence.before) {
        const after = evidence.after.find(line => line.itemId === before.itemId);
        if (!after) return blocked("A stock correction has incomplete reversal evidence. Ask an inventory manager to reconcile this batch.");
        const serialized = state.items.find(item => item.id === before.itemId)?.tracking === "serialized";
        const removed = before.serials.filter(serial => !after.serials.includes(serial));
        const added = after.serials.filter(serial => !before.serials.includes(serial));
        const removedQuantity = serialized ? removed.length : Math.max(0, before.quantity - after.quantity);
        const addedQuantity = serialized ? added.length : Math.max(0, after.quantity - before.quantity);
        if (removedQuantity && evidence.mode !== "missing")
          credit({ itemId: before.itemId, quantity: removedQuantity, serials: removed }, index);
        if (addedQuantity) debit({ itemId: before.itemId, quantity: addedQuantity, serials: added }, index);
      }
    }
    if (receipt.action === "fulfillmentInvestigate" && receipt.warehouseId === batch.sourceId)
      for (const line of receipt.lines) credit(line, index);
  }
  // A received transfer proves the identity of returned serialized units, even if it was outside
  // the wizard. Quantity-only transfers cannot safely be attributed to one of several crew batches.
  const receivedTransfer = (receipt: InventoryReceipt) => receipt.action === "accept" &&
    receipt.warehouseId === batch.sourceId && state.orders.some(order => order.id === receipt.reference &&
      order.type === "transfer" && order.destinationId === batch.sourceId);
  for (const [index, receipt] of state.receipts.entries()) {
    if (!receivedTransfer(receipt)) continue;
    const order = state.orders.find(value => value.id === receipt.reference)!;
    if (![batch.stagingId, batch.vehicleId].includes(order.sourceId ?? "")) continue;
    for (const line of receipt.lines) for (const serial of line.serials) {
      const debitIndex = serialDebits.get(line.itemId)?.get(serial);
      if (debitIndex !== undefined && index > debitIndex)
        remember(returnedAt, line.itemId, serial, index);
    }
  }
  for (const itemId of items) {
    const item = state.items.find(value => value.id === itemId);
    if (!item) return blocked(`The item ${itemId} is unavailable. Reconcile its stock before deleting this batch.`);
    if (item.tracking === "serialized") {
      const source = state.stock.find(row => row.itemId === itemId && row.warehouseId === batch.sourceId);
      for (const [serial, lastDebit] of serialDebits.get(itemId) ?? []) {
        const lastReturn = returnedAt.get(itemId)?.get(serial);
        const occupied = state.serialOccupancy?.find(row => row.itemId === itemId && row.serial === serial);
        const otherBatch = state.fulfillmentBatches?.find(value => value.id !== batch.id && value.status === "active" &&
          value.lines.some(line => line.itemId === itemId && line.stagedSerials.includes(serial)));
        if (otherBatch)
          return blocked(`${item.name} serial ${serial} is associated with active batch ${otherBatch.name}. Resolve its custody before deleting this batch.`);
        if (occupied)
          return blocked(`${item.name} serial ${serial} is still assigned or under investigation. Resolve that custody before deleting this batch.`);
        if (lastReturn === undefined || lastReturn < lastDebit || !source?.serials.includes(serial) || occupied) {
          const current = state.stock.find(row => row.itemId === itemId && row.serials.includes(serial));
          if (current?.warehouseId === batch.sourceId)
            return blocked(`${item.name} serial ${serial} is at ${location(batch.sourceId)}, but its verified return history is incomplete. Reconcile that return before deleting this batch; do not move the stock twice.`);
          return blocked(`Return ${item.name} serial ${serial}${current ? ` from ${location(current.warehouseId)}` : ""} to ${location(batch.sourceId)} and record its return before deleting this batch.`);
        }
      }
      // No serial debit evidence is not proof of reversal when the batch reports existing custody.
      const custody = batch.lines.filter(line => line.itemId === itemId);
      if (!serialDebits.get(itemId)?.size && (custody.some(line => line.stagedQuantity || line.deliveredQuantity) ||
          history.some(receipt => receipt.action === "fulfillmentMove" && receipt.lines.some(line => line.itemId === itemId && line.quantity > 0))))
        return blocked(`Reconcile the recorded ${item.name} serial custody before deleting this batch.`);
    } else {
      const outstanding = quantityOutstanding.get(itemId) ?? 0;
      if (!quantityOutstanding.has(itemId) && (batch.lines.some(line => line.itemId === itemId && line.stagedQuantity) ||
          history.some(receipt => receipt.action === "fulfillmentMove" && receipt.lines.some(line => line.itemId === itemId && line.quantity > 0))))
        return blocked(`Reconcile the recorded ${item.name} quantities before deleting this batch; its return history is incomplete.`);
      if (outstanding !== 0) {
        const delivered = batch.lines.filter(line => line.itemId === itemId).reduce((sum, line) => sum + line.deliveredQuantity, 0);
        return blocked(outstanding > 0
          ? `Record the return of ${outstanding} ${item.name} from ${location(delivered ? batch.vehicleId : batch.stagingId)} to ${location(batch.sourceId)} against this batch before deleting it. Unlinked quantity transfers are not proof of a batch reversal.`
          : `The ${item.name} reversal quantities do not reconcile. Ask an inventory manager to review this batch.`);
      }
    }
  }
  return { allowed: true };
}
