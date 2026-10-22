import type { EquipmentReturn, InventoryReceipt, InventoryState } from "./inventory";
import { removalActivityIndex } from "./inventory-removal-display";
import { inventoryWorkOrderLabel, type InventoryWorkOrderLabels } from "./inventory-work-order-labels";

export type InventoryReceiptContext = { workOrderIds: number[]; removed: EquipmentReturn[]; serials: string[] };

/** Follow exact return/history identities, never group records by a shared serial. */
export function inventoryReceiptContexts(state: InventoryState): Map<string, InventoryReceiptContext> {
  const history = removalActivityIndex(state);
  const returns = new Map(state.returns.map(record => [record.id, record]));
  const handoffs = new Map((state.customerHandoffs ?? []).map(record => [record.id, record]));
  return new Map(state.receipts.map(receipt => {
    const direct = returns.get(receipt.reference);
    const removed = [...new Map([...(history.get(receipt.id) ?? []).map(entry => entry.record), ...(direct ? [direct] : [])]
      .map(record => [record.id, record])).values()];
    const handoff = receipt.action === "returnCustomerBatch" ? handoffs.get(receipt.reference) : undefined;
    const workOrderIds = new Set([...removed.map(record => record.workOrderId), ...(handoff?.lines.map(line => line.workOrderId) ?? [])]);
    const stagedWork = receipt.action === "stageWorkOrder" && /^wo-(\d+)$/.exec(receipt.reference);
    if (stagedWork) workOrderIds.add(Number(stagedWork[1]));
    if (receipt.action === "vehicleTransfer")
      for (const id of receipt.workOrderIds ?? []) workOrderIds.add(id);
    if (receipt.action.startsWith("fulfillment"))
      for (const work of state.fulfillmentBatches?.find(batch => batch.id === receipt.reference)?.workOrders ?? [])
        workOrderIds.add(work.workOrderId);
    // This is the documented reference emitted by the reconciliation command.
    const reconciliation = ["reconcileWorkOrder", "fieldUseShortage"].includes(receipt.action) ? /^work-order-([1-9]\d*)$/.exec(receipt.reference) : null;
    if (reconciliation && Number.isSafeInteger(Number(reconciliation[1]))) workOrderIds.add(Number(reconciliation[1]));
    const discrepancy = receipt.action === "resolveStockDiscrepancy" ? state.stockDiscrepancies?.find(value => value.id === receipt.reference) : undefined;
    if (discrepancy) workOrderIds.add(discrepancy.workOrderId);
    return [receipt.id, { workOrderIds: [...workOrderIds], removed,
      serials: [...new Set([...removed.map(record => record.serial),
        ...(handoff?.lines.map(line => line.serial) ?? []),
        ...receipt.lines.flatMap(line => line.serials),
        ...(receipt.components ?? []).flatMap(line => line.serials),
        ...(receipt.kitInspection?.serials ?? [])].filter(Boolean))] }];
  }));
}

export function inventoryReceiptOperationReference(receipt: InventoryReceipt, context: InventoryReceiptContext | undefined,
  labels: InventoryWorkOrderLabels = {}): string {
  if (!context?.workOrderIds.length) return receipt.reference;
  const equipment = context.removed.map(record => `${record.equipment === "system" ? "System" : "Module"} ${record.serial}`);
  return `Work order${context.workOrderIds.length > 1 ? "s" : ""} ${context.workOrderIds.map(id => inventoryWorkOrderLabel(id, labels)).join(", ")}${equipment.length ? ` · ${equipment.join("; ")}` : ""}`;
}
