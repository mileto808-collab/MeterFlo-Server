export type SavedFulfillmentInputs = {
  batchId: string;
  selectedIds: number[];
  pending: unknown;
  createAttempt: unknown;
  quantities: Record<string, string>;
  serialText: Record<string, string>;
  reason: string;
  physicallyConfirmed: boolean;
  closeReason: string;
};
type Batch = { id: string; status: string; workOrders: { workOrderId: number }[] };
type Order = { workOrderId: number; missing: unknown[]; lines: unknown[] };
export type FulfillmentDraftOutcome =
  | { kind: "keep" }
  | { kind: "clear" | "review"; status: "completed" | "cancelled" };

/** Use only a successfully refreshed snapshot; a terminal batch is not proof of an unknown command's outcome. */
export function reconcileFulfillmentDraft(
  draft: SavedFulfillmentInputs, batches: Batch[], orders: Order[],
): FulfillmentDraftOutcome {
  if (draft.pending || draft.createAttempt) return { kind: "keep" };
  let status: "completed" | "cancelled" | undefined;
  if (draft.batchId) {
    const batch = batches.find(batch => batch.id === draft.batchId);
    if (batch?.status === "completed" || batch?.status === "cancelled") status = batch.status;
  } else if (draft.selectedIds.length) {
    const completed = new Set(batches.filter(batch => batch.status === "completed")
      .flatMap(batch => batch.workOrders.map(work => work.workOrderId)));
    const current = new Map(orders.map(order => [order.workOrderId, order]));
    if (draft.selectedIds.every(id => {
      const order = current.get(id);
      return completed.has(id) && (!order || (!order.lines.length && !order.missing.length));
    })) status = "completed";
  }
  if (!status) return { kind: "keep" };
  const captures = Object.values(draft.quantities).some(value => value.trim() !== "" && Number(value) !== 0) ||
    Object.values(draft.serialText).some(value => value.trim() !== "") ||
    !!draft.reason.trim() || draft.physicallyConfirmed || !!draft.closeReason.trim();
  return { kind: captures ? "review" : "clear", status };
}
