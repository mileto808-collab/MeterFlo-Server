import { z } from "zod";
import type { InventoryState, StockLine } from "./inventory";
import { stockLineSchema } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { isStagingType, warehouseAccessible } from "./inventory-location-types";

export type FulfillmentResumeStatus = { resumable: boolean; nextStep: "stage" | "vehicle"; reason?: string };
/** Discovery mirrors movement rules without promising that stock is still available at posting time. */
export function fulfillmentResumeStatus(state: InventoryState, batch: FulfillmentBatch,
  orders: readonly Pick<FulfillmentCandidate, "workOrderId" | "assignmentVersion" | "status" | "eligible">[],
  actor: string, admin: boolean): FulfillmentResumeStatus {
  const unstaged = batch.lines.some(line => line.quantity > line.stagedQuantity);
  const staged = batch.lines.some(line => line.stagedQuantity > line.deliveredQuantity);
  const nextStep = unstaged ? "stage" as const : "vehicle" as const;
  const invalid = (reason: string): FulfillmentResumeStatus => ({ resumable: false, nextStep, reason });
  if (batch.status !== "active") return invalid("This batch is no longer active.");
  if (!unstaged && !staged) return invalid("There is no unfinished stock movement.");
  if (batch.lines.some(line => line.quantity > line.deliveredQuantity &&
    !state.items.some(item => item.id === line.itemId && item.active && item.kind !== "labor")))
    return invalid("A required inventory item is inactive or unavailable; warehouse review is required.");
  if ([batch.sourceId, batch.stagingId, batch.vehicleId].some(id =>
    !warehouseAccessible(state, state.warehouses.find(location => location.id === id), actor, admin)))
    return invalid("A batch location is inactive, unavailable, or no longer accessible.");
  const current = batch.workOrders.map(saved => ({ saved, order: orders.find(order => order.workOrderId === saved.workOrderId) }));
  if (current.some(({ order }) => !order)) return invalid("Work-order access changed; warehouse review is required.");
  const changed = current.some(({ saved, order }) => order!.assignmentVersion !== saved.assignmentVersion ||
    !["open", "scheduled"].includes(order!.status.toLowerCase()));
  if (batch.mode === "scheduled" && (changed || current.some(({ order }) => !order!.eligible || order!.status.toLowerCase() !== "scheduled")))
    return invalid("Scheduled work or its assignment changed after this batch was prepared. Use Review reassignment to confirm the current installer and vehicle before handoff.");
  if (changed && unstaged) return staged && batch.mode === "crew"
    ? { resumable: true, nextStep: "vehicle", reason: "Only already-staged stock can be handed off; release the unpulled remainder." }
    : invalid("Work or assignments changed; release the unfinished remainder and review current work.");
  return { resumable: true, nextStep };
}

const id = z.string().min(1).max(100);
export const fulfillmentCreateSchema = z.object({
  id: z.string().uuid(), name: z.string().trim().min(1).max(200), mode: z.enum(["crew", "scheduled"]),
  sourceId: id, stagingId: id, vehicleId: id,
  workOrders: z.array(z.object({ workOrderId: z.number().int().positive(),
    assignmentVersion: z.number().int().nonnegative() }).strict()).min(1).max(500),
}).strict();
export const fulfillmentMoveSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), phase: z.enum(["stage", "vehicle"]),
  lines: z.array(stockLineSchema).min(1).max(500), reason: z.string().trim().min(10).max(1000),
  physicallyConfirmed: z.literal(true),
}).strict();
export const fulfillmentCloseSchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), reason: z.string().trim().min(10).max(1000),
}).strict();
export const fulfillmentReadySchema = z.object({
  id: z.string().uuid(), revision: z.number().int().positive(), ready: z.boolean(),
}).strict();
export const fulfillmentBatchSchema = fulfillmentCreateSchema.omit({ workOrders: true }).extend({
  status: z.enum(["active", "completed", "cancelled"]), revision: z.number().int().positive(),
  pickupReady: z.boolean().optional(),
  createdBy: id, createdAt: z.string().datetime(),
  workOrders: z.array(z.object({ workOrderId: z.number().int().positive(),
    assignmentVersion: z.number().int().nonnegative(), label: z.string().min(1).max(500),
    installerId: id.nullable().optional(), installer: z.string().max(500).optional(),
    scheduledDate: z.string().optional(),
  }).strict()).min(1).max(500),
  lines: z.array(z.object({ workOrderId: z.number().int().positive(), itemId: id,
    quantity: z.number().int().positive().max(1000000),
    stagedQuantity: z.number().int().nonnegative(), deliveredQuantity: z.number().int().nonnegative(),
    stagedSerials: z.array(z.string()), deliveredSerials: z.array(z.string()),
  }).strict()).max(25000),
}).strict();
export type FulfillmentBatch = z.infer<typeof fulfillmentBatchSchema>;
export type FulfillmentCandidate = {
  workOrderId: number; label: string; status: string; group: string;
  installerId: string | null; installer: string; scheduledDate: string; route: string; zone: string;
  assignmentVersion: number; lines: { itemId: string; quantity: number }[];
  missing: { equipment: "system" | "module"; typeId: string }[]; eligible: boolean;
};
/** Demand coverage is independent of physical custody and installed-serial identity. */
export function fulfillmentOutstanding(state: InventoryState, workOrderId: number,
  demand: { itemId: string; quantity: number }[]) {
  const allocation = state.allocations.find(a => a.workOrderId === workOrderId && a.status === "reserved");
  return demand.map(line => {
    const covered = (state.fulfillmentBatches ?? []).flatMap(b => b.lines.filter(l => l.workOrderId === workOrderId)
      .map(l => ({ ...l, coverage: b.status === "cancelled" ? l.deliveredQuantity : l.quantity })))
      .filter(l => l.itemId === line.itemId).reduce((sum, l) => sum + l.coverage, 0);
    // Scheduled batch reservations are already counted by their batch; never count twice.
    const held = allocation?.lines.filter(l => l.itemId === line.itemId && state.warehouses.some(w => w.id === l.warehouseId &&
      (w.type === "vehicle" || state.locationTypes?.some(type => type.id === w.locationTypeId && isStagingType(type)) ||
        state.receipts.some(receipt => receipt.action === "stageWorkOrder" && receipt.reference === `wo-${workOrderId}` && receipt.warehouseId === w.id))))
      .reduce((sum, l) => sum + l.quantity, 0) ?? 0;
    const scheduledCovered = (state.fulfillmentBatches ?? []).filter(b => b.mode === "scheduled")
      .flatMap(b => b.lines).filter(l => l.workOrderId === workOrderId && l.itemId === line.itemId)
      .reduce((sum, l) => sum + l.stagedQuantity, 0);
    return { ...line, quantity: Math.max(0, line.quantity - covered - Math.max(0, held - scheduledCovered)) };
  }).filter(l => l.quantity > 0 && state.items.some(i => i.id === l.itemId && i.active && i.kind !== "labor"));
}
export function fulfillmentReserved(state: InventoryState, warehouseId: string, itemId: string) {
  return (state.fulfillmentBatches ?? []).filter(b => b.status === "active" && b.mode === "crew" && b.stagingId === warehouseId)
    .flatMap(b => b.lines).filter(l => l.itemId === itemId)
    .reduce((sum, l) => sum + l.stagedQuantity - l.deliveredQuantity, 0);
}
const ensure: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) throw new InventoryError(message);
};
type Tools = {
  access: (id: string) => void;
  move: (warehouseId: string, lines: StockLine[], sign: 1 | -1, transitId: string) => void;
  receipt: (reference: string, warehouseId: string, lines: StockLine[], reason: string) => void;
};
/** Physical movement shares the inventory transaction, stock checks and kit-custody engine. */
export function applyFulfillmentMove(state: InventoryState, action: "fulfillmentMove" | "fulfillmentClose",
  data: Record<string, unknown>, operationId: string, tools: Tools) {
  const input = action === "fulfillmentMove" ? fulfillmentMoveSchema.parse(data) : fulfillmentCloseSchema.parse(data);
  const batch = state.fulfillmentBatches?.find(b => b.id === input.id);
  ensure(batch && batch.status === "active", "Choose an active fulfillment batch.");
  if (batch.revision !== input.revision) throw Object.assign(new InventoryError("This batch changed. Reload its latest progress; no stock moved."), { status: 409 });
  tools.access(batch.sourceId); tools.access(batch.stagingId); tools.access(batch.vehicleId);
  if (action === "fulfillmentClose") {
    // Release only this batch's staged quantity holds. This is NOT a physical return.
    if (batch.mode === "scheduled") for (const line of batch.lines) {
      const allocation = state.allocations.find(a => a.workOrderId === line.workOrderId && a.status === "reserved");
      const hold = allocation?.lines.find(l => l.warehouseId === batch.stagingId && l.itemId === line.itemId && l.reservationMode === "quantity");
      if (hold) {
        hold.quantity = Math.max(0, hold.quantity - (line.stagedQuantity - line.deliveredQuantity));
        allocation!.lines = allocation!.lines.filter(l => l.quantity > 0); allocation!.revision++;
      }
    }
    batch.status = "cancelled"; batch.revision++;
    tools.receipt(batch.id, batch.stagingId, [], `Batch remainder released; stock stays at its recorded physical location. ${input.reason}`);
    return;
  }
  const move = fulfillmentMoveSchema.parse(input);
  const from = move.phase === "stage" ? batch.sourceId : batch.stagingId;
  const to = move.phase === "stage" ? batch.stagingId : batch.vehicleId;
  ensure(new Set(move.lines.map(l => l.itemId)).size === move.lines.length, "Combine duplicate item lines.");
  // Distribute actual custody across demand rows deterministically. This is NOT an installed-serial assignment.
  for (const line of move.lines) {
    let remaining = line.quantity, serialOffset = 0;
    const item = state.items.find(i => i.id === line.itemId && i.active && i.kind !== "labor");
    ensure(item, "Choose an active physical inventory item.");
    ensure(item.tracking === "serialized" ? line.serials.length === line.quantity &&
      new Set(line.serials).size === line.serials.length : line.serials.length === 0, "Enter one unique custody serial per serialized unit.");
    const rows = batch.lines.filter(l => l.itemId === line.itemId);
    const available = rows.reduce((sum, l) => sum + (move.phase === "stage" ?
      l.quantity - l.stagedQuantity : l.stagedQuantity - l.deliveredQuantity), 0);
    ensure(remaining <= available, "Quantity exceeds this batch's remaining demand or staged stock.");
    const custody = rows.flatMap(l => l.stagedSerials.filter(serial => !l.deliveredSerials.includes(serial)));
    if (move.phase === "vehicle") ensure(line.serials.every(serial => custody.includes(serial)), "Scan serials physically staged for this batch.");
    for (const row of rows) {
      const capacity = move.phase === "stage" ? row.quantity - row.stagedQuantity : row.stagedQuantity - row.deliveredQuantity;
      // For a serialized handoff, distribute by physical serial custody, not arbitrary row order.
      const serials = move.phase === "vehicle" && item.tracking === "serialized"
        ? line.serials.filter(serial => row.stagedSerials.includes(serial) && !row.deliveredSerials.includes(serial))
        : line.serials.slice(serialOffset, serialOffset + Math.min(remaining, capacity));
      const quantity = move.phase === "vehicle" && item.tracking === "serialized" ? serials.length : Math.min(remaining, capacity);
      if (!quantity) continue;
      const part = { itemId: line.itemId, quantity, serials };
      if (batch.mode === "scheduled") {
        relocateReservation(state, row.workOrderId, from, to, part);
        state.allocations.find(a => a.workOrderId === row.workOrderId)!.assignmentVersion =
          batch.workOrders.find(w => w.workOrderId === row.workOrderId)!.assignmentVersion;
      }
      // Crew pool holds must be released before removing the same physical units.
      if (move.phase === "stage") { row.stagedQuantity += quantity; row.stagedSerials.push(...serials); }
      else { row.deliveredQuantity += quantity; row.deliveredSerials.push(...serials); }
      tools.move(from, [part], -1, operationId);
      tools.move(to, [part], 1, operationId);
      remaining -= quantity; serialOffset += quantity;
    }
    ensure(remaining === 0, "Could not match the physical move to this batch.");
  }
  batch.revision++;
  if (batch.lines.every(l => l.quantity === l.deliveredQuantity)) batch.status = "completed";
  tools.receipt(batch.id, to, move.lines,
    `${move.phase === "stage" ? "Warehouse → Staging" : "Staging → Vehicle"} · ${batch.name} · ${move.reason}`);
}
function relocateReservation(state: InventoryState, workOrderId: number, from: string, to: string, part: StockLine) {
  let allocation = state.allocations.find(a => a.workOrderId === workOrderId);
  ensure(allocation?.status !== "consumed", "This work order has completed. Review the batch before moving its stock.");
  if (!allocation) {
    allocation = { workOrderId, status: "reserved", revision: 0, mode: null, lines: [], used: [], dispositions: [] };
    state.allocations.push(allocation);
  }
  if (allocation.status !== "reserved") allocation.lines = [];
  const sourceHold = allocation.lines.find(l => l.warehouseId === from && l.itemId === part.itemId);
  if (sourceHold) {
    const exact = sourceHold.reservationMode !== "quantity" && sourceHold.serials.length > 0;
    const released = exact ? sourceHold.serials.filter(serial => part.serials.includes(serial)).length : Math.min(part.quantity, sourceHold.quantity);
    sourceHold.quantity -= released;
    if (exact) sourceHold.serials = sourceHold.serials.filter(serial => !part.serials.includes(serial));
  }
  const target = allocation.lines.find(l => l.warehouseId === to && l.itemId === part.itemId);
  ensure(!target?.serials.length, "Convert the destination's exact-serial hold to a quantity hold before staging.");
  if (target) { target.quantity += part.quantity; target.reservationMode = "quantity"; }
  else allocation.lines.push({ ...part, serials: [], warehouseId: to, reservationMode: "quantity" });
  allocation.lines = allocation.lines.filter(l => l.quantity > 0);
  allocation.status = "reserved"; allocation.revision++;
}
