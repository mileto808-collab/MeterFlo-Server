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
  reassignmentBatchId?: string;
  reassignmentVehicleId?: string;
  reassignmentReason?: string;
};
export type FulfillmentDraftActivity = SavedFulfillmentInputs & {
  name: string;
  sourceId: string;
  stagingId: string;
  vehicleId: string;
};

/** Opening or filtering the wizard is not a saved workflow; a selection, capture or posting identity is. */
export function hasMeaningfulFulfillmentWork(draft: FulfillmentDraftActivity): boolean {
  return Boolean(draft.pending || draft.createAttempt || draft.batchId || draft.selectedIds.length ||
    draft.name.trim() || draft.sourceId || draft.stagingId || draft.vehicleId ||
    Object.values(draft.quantities ?? {}).some(value => value.trim() !== "" && Number(value) !== 0) ||
    Object.values(draft.serialText ?? {}).some(value => value.trim() !== "") ||
    draft.reason.trim() || draft.physicallyConfirmed || draft.closeReason.trim() ||
    !!draft.reassignmentVehicleId?.trim() || !!draft.reassignmentReason?.trim());
}
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
  const targetBatchId = draft.reassignmentBatchId || draft.batchId;
  if (targetBatchId) {
    const batch = batches.find(batch => batch.id === targetBatchId);
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
    !!draft.reason.trim() || draft.physicallyConfirmed || !!draft.closeReason.trim() ||
    !!draft.reassignmentVehicleId?.trim() || !!draft.reassignmentReason?.trim();
  return { kind: captures ? "review" : "clear", status };
}
