import type { InventoryState } from "./inventory";
import type { FulfillmentBatch } from "./inventory-fulfillment";

export type FulfillmentScanLine = { itemId: string; serials: string[] };
export type FulfillmentScanProblem = { itemId: string; serial: string; reason: string };

/** Read-only preflight; posting still rechecks custody atomically. Never reserves stock. */
export function checkFulfillmentSerials(state: InventoryState, batch: FulfillmentBatch,
  phase: "stage" | "vehicle", lines: FulfillmentScanLine[]): FulfillmentScanProblem[] {
  const from = phase === "stage" ? batch.sourceId : batch.stagingId;
  const problems: FulfillmentScanProblem[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    const item = state.items.find(item => item.id === line.itemId && item.active && item.tracking === "serialized");
    const stock = new Set(state.stock.filter(row => row.warehouseId === from && row.itemId === line.itemId).flatMap(row => row.serials));
    const reservations = state.allocations.filter(allocation => allocation.status === "reserved")
      .flatMap(allocation => allocation.lines.filter(row => row.warehouseId === from && row.itemId === line.itemId)
        .map(row => ({ workOrderId: allocation.workOrderId, serials: row.serials })));
    const held = new Set<string>();
    for (const other of state.fulfillmentBatches ?? []) {
      if (other.status !== "active" || other.mode !== "crew" || other.stagingId !== from ||
        (phase === "vehicle" && other.id === batch.id)) continue;
      for (const row of other.lines.filter(row => row.itemId === line.itemId))
        for (const serial of row.stagedSerials) if (!row.deliveredSerials.includes(serial)) held.add(serial);
    }
    const custody = new Set(batch.lines.filter(row => row.itemId === line.itemId)
      .flatMap(row => row.stagedSerials.filter(serial => !row.deliveredSerials.includes(serial))));
    const rows = batch.lines.filter(row => row.itemId === line.itemId);
    let offset = 0;
    for (const [index, serial] of line.serials.entries()) {
      // Match the posting engine's deterministic demand-row distribution.
      if (phase === "stage") offset = index;
      const demandRow = phase === "vehicle"
        ? rows.find(row => row.stagedSerials.includes(serial) && !row.deliveredSerials.includes(serial))
        : rows.find(row => {
          const capacity = row.quantity - row.stagedQuantity;
          if (offset < capacity) return true;
          offset -= capacity;
          return false;
        });
      const reservedElsewhere = reservations.some(reservation => reservation.serials.includes(serial) &&
        !(batch.mode === "scheduled" && reservation.workOrderId === demandRow?.workOrderId));
      const reason = seen.has(serial) ? "Already scanned in this move."
        : !item || !batch.lines.some(row => row.itemId === line.itemId) ? "This item is not required by this batch."
        : phase === "vehicle" && !custody.has(serial) ? "Not in this batch's staged stock awaiting handoff."
        : !stock.has(serial) ? `Not available for this item at ${phase === "stage" ? "the selected source location" : "Staging"}. Check the serial, item and location.`
        : held.has(serial) || reservedElsewhere ? "Reserved for other work or held by another batch."
        : "";
      seen.add(serial);
      if (reason) problems.push({ itemId: line.itemId, serial, reason });
    }
  }
  return problems;
}
