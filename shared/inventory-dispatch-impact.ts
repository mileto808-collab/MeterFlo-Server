import type { InventoryState, WorkRequirements } from "./inventory";

const materialLines = (state: InventoryState, lines: WorkRequirements["lines"]) =>
  lines.filter(line => state.items.some(item => item.id === line.itemId && item.active && item.kind !== "labor"))
    .map(line => ({ itemId: line.itemId, quantity: line.quantity })).sort((a, b) => a.itemId.localeCompare(b.itemId));

/** Only planning may change automatically. Physical movement always needs an explicit command. */
export function reconcileDispatchRequirements(
  state: InventoryState, prior: WorkRequirements | undefined, next: WorkRequirements,
): { error?: string } {
  const batches = (state.fulfillmentBatches ?? []).filter(batch =>
    batch.status !== "cancelled" && batch.workOrders.some(work => work.workOrderId === next.workOrderId));
  if (!batches.length) return {};
  const previous = materialLines(state, prior?.lines ?? batches.flatMap(batch =>
    batch.lines.filter(line => line.workOrderId === next.workOrderId)));
  const desired = materialLines(state, next.lines);
  if (JSON.stringify(previous) === JSON.stringify(desired) && !next.missing.length) return {};
  const batch = batches[0];
  const posted = batches.some(value => value.lines.some(line => line.stagedQuantity > 0 || line.deliveredQuantity > 0) ||
    state.receipts.some(receipt => receipt.reference === value.id &&
      ["fulfillmentMove", "fulfillmentCorrect", "fulfillmentInvestigate"].includes(receipt.action)));
  if (batches.length !== 1 || posted || next.missing.length || !desired.length) {
    return { error: `Work order ${next.workOrderId} has changed material requirements in batch "${batch.name}". ` +
      (posted ? "Stock has already moved. In Fulfill / Stage, correct the physical stock and release the unfinished demand before changing these requirements. No stock was automatically returned or transferred."
        : "Review or delete the unposted batch in Resume saved batch before removing demand, changing covered work, or using unmapped items.") };
  }
  // A single, never-posted batch has no physical custody to reverse.
  batch.lines = [...batch.lines.filter(line => line.workOrderId !== next.workOrderId),
    ...desired.map(line => ({ ...line, workOrderId: next.workOrderId,
      stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }))];
  batch.revision++;
  return {};
}
