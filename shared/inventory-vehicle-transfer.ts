import { z } from "zod";
import { stockLineSchema, type InventoryState, type StockLine } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { pickupNeedsReview } from "./inventory-staging-corrections";

export const vehicleTransferSchema = z.object({
  mode: z.enum(["stock", "work"]), revision: z.number().int().nonnegative(),
  sourceId: z.string().min(1).max(100), destinationId: z.string().min(1).max(100),
  batchId: z.string().uuid().optional(), batchRevision: z.number().int().positive().optional(),
  workOrders: z.array(z.object({ workOrderId: z.number().int().positive(),
    assignmentVersion: z.number().int().nonnegative() }).strict()).max(500),
  installerId: z.string().min(1).max(100).nullable().optional(),
  lines: z.array(stockLineSchema).min(1).max(500),
  reason: z.string().trim().min(10).max(1000), physicallyConfirmed: z.literal(true),
  draftId: z.string().uuid().optional(), draftRevision: z.number().int().positive().optional(),
}).strict().superRefine((input, context) => {
  if (!!input.draftId !== (input.draftRevision !== undefined))
    context.addIssue({ code: "custom", message: "A saved handover requires both draft identity and revision." });
  if (input.sourceId === input.destinationId)
    context.addIssue({ code: "custom", message: "Choose two different vehicles." });
  if (input.mode === "work" ? !input.batchId || !input.batchRevision || !input.workOrders.length :
      !!input.batchId || !!input.batchRevision || !!input.workOrders.length || !!input.installerId)
    context.addIssue({ code: "custom", message: "Choose outstanding work for a work takeover, or use stock-only without dispatch changes." });
  if (new Set(input.workOrders.map(row => row.workOrderId)).size !== input.workOrders.length)
    context.addIssue({ code: "custom", message: "Choose each work order only once." });
});
export type VehicleTransfer = z.infer<typeof vehicleTransferSchema>;
const check: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new InventoryError(message);
};
export function vehicleTransferDemand(state: InventoryState, input: VehicleTransfer) {
  const batch = state.fulfillmentBatches?.find(batch => batch.id === input.batchId);
  check(batch && batch.status !== "cancelled", "Choose an existing, non-cancelled fulfillment batch.");
  check(batch.revision === input.batchRevision, "The batch changed. Refresh the transfer review; no stock moved.");
  check(!pickupNeedsReview(batch), "Resolve this batch's pickup issues before transferring its work.");
  const demand = new Map<string, number>();
  for (const selected of input.workOrders) {
    const saved = batch.workOrders.find(work => work.workOrderId === selected.workOrderId);
    check(saved && (saved.vehicleId ?? batch.vehicleId) === input.sourceId,
      "Selected work is no longer dispatched to the source vehicle. Refresh the review.");
    const lines = batch.lines.filter(line => line.workOrderId === selected.workOrderId);
    check(lines.length && lines.every(line => line.deliveredQuantity === line.quantity),
      "Finish the selected work's recorded vehicle handoff before transferring it.");
    for (const line of lines) demand.set(line.itemId, (demand.get(line.itemId) ?? 0) + line.quantity);
    const allocation = state.allocations.find(allocation => allocation.workOrderId === selected.workOrderId);
    check(!allocation || allocation.status !== "consumed" &&
      !allocation.used.length && !allocation.dispositions.length,
    "Work with recorded or prepared installation use cannot be transferred. Resolve the field work first.");
    check(!allocation || allocation.status !== "reserved" ||
      allocation.lines.every(line => line.warehouseId === input.sourceId),
    "This work has reservations at another location. Resolve those reservations before transferring the work.");
  }
  return { batch, demand };
}

/** A confirmed, direct handover. In-transit shipping uses transfer orders instead. */
export function applyVehicleTransfer(state: InventoryState, data: unknown, operationId: string, tools: {
  access: (id: string) => void;
  move: (id: string, lines: StockLine[], sign: 1 | -1, transferId: string) => void;
  receipt: (reference: string, warehouseId: string, lines: StockLine[], reason: string) => void;
}) {
  const input = vehicleTransferSchema.parse(data);
  if (input.revision !== state.revision)
    throw Object.assign(new InventoryError("Inventory changed. Refresh the vehicle transfer review; no stock moved."), { status: 409 });
  for (const id of [input.sourceId, input.destinationId]) {
    tools.access(id);
    check(state.warehouses.some(vehicle => vehicle.id === id && vehicle.active && vehicle.type === "vehicle"),
      "Choose two active vehicle locations in this project.");
  }
  check(new Set(input.lines.map(line => line.itemId)).size === input.lines.length, "Combine duplicate item lines.");
  const serials = input.lines.flatMap(line => line.serials);
  check(new Set(serials).size === serials.length, "Each serial may be transferred only once.");
  for (const line of input.lines) {
    const item = state.items.find(item => item.id === line.itemId && item.active && item.kind !== "labor");
    check(item, "Choose active stock items, not labor.");
    check(item.tracking === "serialized" ? line.serials.length === line.quantity : !line.serials.length,
      "Scan exactly one unique serial per serialized unit.");
  }
  if (input.mode === "work") {
    const { batch, demand } = vehicleTransferDemand(state, input);
    check(input.lines.length === demand.size && input.lines.every(line => demand.get(line.itemId) === line.quantity),
      "Transfer the complete picked quantities for the selected work. Extra supplies use stock-only transfer.");
    const destination = state.warehouses.find(vehicle => vehicle.id === input.destinationId)!;
    check(batch.mode !== "scheduled" || input.installerId, "Choose the receiving installer for scheduled work.");
    check(!input.installerId || [destination.assignedUserId, ...destination.userIds].includes(input.installerId),
      "Choose an installer assigned to the receiving vehicle.");
    const transferredHolds = new Map<string, number>();
    for (const selected of input.workOrders) {
      const saved = batch.workOrders.find(work => work.workOrderId === selected.workOrderId)!;
      const allocation = state.allocations.find(allocation => allocation.workOrderId === selected.workOrderId && allocation.status === "reserved");
      if (allocation) {
        for (const line of allocation.lines) {
          const moved = input.lines.find(moved => moved.itemId === line.itemId);
          check(moved && moved.quantity >= line.quantity && line.serials.every(serial => moved.serials.includes(serial)),
            "Include the selected work's reserved quantities and exact reserved serials in this handover.");
          transferredHolds.set(line.itemId, (transferredHolds.get(line.itemId) ?? 0) + line.quantity);
          line.warehouseId = input.destinationId;
        }
        allocation.revision++;
      }
      saved.vehicleId = input.destinationId;
      saved.installerId = input.installerId ?? null;
      saved.installer = "";
    }
    check([...transferredHolds].every(([itemId, quantity]) =>
      quantity <= (input.lines.find(line => line.itemId === itemId)?.quantity ?? 0)),
    "This work has additional reserved demand beyond its picked stock. Resolve those holds before taking over the work.");
    batch.revision++;
  }
  // Reservations belonging to selected work now follow the receiving vehicle;
  // other work's holds remain protected by the ordinary stock/serial engine.
  tools.move(input.sourceId, input.lines, -1, operationId);
  tools.move(input.destinationId, input.lines, 1, operationId);
  const from = state.warehouses.find(vehicle => vehicle.id === input.sourceId)!;
  const to = state.warehouses.find(vehicle => vehicle.id === input.destinationId)!;
  tools.receipt(input.batchId ?? operationId, input.destinationId, input.lines,
    `Confirmed vehicle handover: ${from.name} (${from.id}) → ${to.name} (${to.id}). ` +
    (input.mode === "work" ? `Outstanding work: ${input.workOrders.map(work =>
      state.fulfillmentBatches!.find(batch => batch.id === input.batchId)!.workOrders.find(saved => saved.workOrderId === work.workOrderId)!.label).join(", ")}. ` :
      "Stock only; work dispatch and assignments unchanged. ") + input.reason);
  const receipt = state.receipts.find(receipt => receipt.id === operationId);
  if (receipt) {
    receipt.sourceId = input.sourceId;
    if (input.mode === "work") receipt.workOrderIds = input.workOrders.map(work => work.workOrderId);
  }
}
