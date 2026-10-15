import { z } from "zod";
import type { InventoryOrder, InventoryState, StockLine } from "./inventory";

const identifier = z.string().trim().min(1).max(100);
export const damageLineSchema = z.object({
  itemId: identifier, quantity: z.number().int().positive().max(1000000),
  serials: z.array(identifier).max(10000).default([]),
  unidentifiedQuantity: z.number().int().nonnegative().max(1000000).default(0),
  expectedSerials: z.array(identifier).max(10000).default([]),
  reason: z.string().trim().min(1).max(1000),
}).strict();
export type DamageLine = z.infer<typeof damageLineSchema>;
export type HoldOutcome = "released" | "returned" | "scrapped";
export type HoldDisposition = {
  operationId: string; actor: string; occurredAt: string; reason: string; reference: string;
  outcome: HoldOutcome; quantity: number; serials: string[]; unidentifiedQuantity: number;
  expectedSerials: string[]; verifiedSerials: string[];
};
export type ShipmentHold = DamageLine & {
  id: string; orderId: string; receiptId: string; warehouseId: string;
  actor: string; occurredAt: string; status: "held" | HoldOutcome | "resolved";
  resolution?: { operationId: string; actor: string; occurredAt: string; reason: string; reference: string; verifiedSerials: string[] };
  dispositions?: HoldDisposition[];
};
// Old whole-batch snapshots remain readable without rewriting their receipts.
export function holdDispositions(hold: ShipmentHold): HoldDisposition[] {
  if (hold.dispositions) return hold.dispositions;
  if (!hold.resolution || hold.status === "held" || hold.status === "resolved") return [];
  return [{ ...hold.resolution, outcome: hold.status, quantity: hold.quantity,
    serials: hold.serials, unidentifiedQuantity: hold.unidentifiedQuantity, expectedSerials: hold.expectedSerials }];
}
export function remainingHold(hold: ShipmentHold) {
  const events = holdDispositions(hold);
  const known = new Set(events.flatMap(event => event.serials));
  const expected = new Set(events.flatMap(event => event.expectedSerials));
  return {
    quantity: hold.quantity - events.reduce((total, event) => total + event.quantity, 0),
    serials: hold.serials.filter(serial => !known.has(serial)),
    unidentifiedQuantity: hold.unidentifiedQuantity - events.reduce((total, event) => total + event.unidentifiedQuantity, 0),
    expectedSerials: hold.expectedSerials.filter(serial => !expected.has(serial)),
  };
}
export function holdStatus(hold: ShipmentHold): ShipmentHold["status"] {
  if (remainingHold(hold).quantity > 0) return "held";
  const outcomes = new Set(holdDispositions(hold).map(event => event.outcome));
  return outcomes.size === 1 ? [...outcomes][0] : "resolved";
}
export type OrderClosure = {
  actor: string; occurredAt: string; reason: string; operationId: string;
  unfulfilled: StockLine[];
};
export const shipmentTotal = (lines: StockLine[], itemId: string) =>
  lines.filter(line => line.itemId === itemId).reduce((sum, line) => sum + line.quantity, 0);
export const settledLines = (order: InventoryOrder) => [...order.received, ...(order.losses ?? [])];
export function orderLineProgress(state: InventoryState, order: InventoryOrder, itemId: string) {
  const ordered = shipmentTotal(order.lines, itemId), dispatched = shipmentTotal(order.dispatched, itemId);
  const received = shipmentTotal(order.received, itemId), lost = shipmentTotal(order.losses ?? [], itemId);
  const holds = (state.shipmentHolds ?? []).filter(h => h.orderId === order.id && h.itemId === itemId);
  const damaged = holds.reduce((sum, h) => sum + h.quantity, 0);
  const held = holds.reduce((sum, h) => sum + remainingHold(h).quantity, 0);
  const released = holds.reduce((sum, h) => sum + holdDispositions(h).filter(event => event.outcome === "released")
    .reduce((quantity, event) => quantity + event.quantity, 0), 0);
  const closedShort = shipmentTotal(order.closure?.unfulfilled ?? [], itemId);
  return { ordered, dispatched, received, damaged, held, usable: received - damaged + released, lost, closedShort,
    inTransit: order.type === "transfer" ? dispatched - received - lost : 0,
    remaining: order.closure ? 0 : ordered - received - lost };
}
export function shipmentStatus(state: InventoryState, order: InventoryOrder): InventoryOrder["status"] {
  if (order.closure) return "closed";
  const unresolved = (state.shipmentHolds ?? []).some(h => h.orderId === order.id &&
    (remainingHold(h).quantity > 0 || holdDispositions(h).some(event => event.outcome !== "released")));
  return !unresolved && !(order.losses?.length) && order.lines.every(l => shipmentTotal(order.received, l.itemId) === l.quantity)
    ? "completed" : "partial";
}
