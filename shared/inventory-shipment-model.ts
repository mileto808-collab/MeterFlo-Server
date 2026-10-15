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
export type ShipmentHold = DamageLine & {
  id: string; orderId: string; receiptId: string; warehouseId: string;
  actor: string; occurredAt: string; status: "held" | "released" | "returned" | "scrapped";
  resolution?: { operationId: string; actor: string; occurredAt: string; reason: string; reference: string; verifiedSerials: string[] };
};
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
  const held = holds.filter(h => h.status === "held").reduce((sum, h) => sum + h.quantity, 0);
  const released = holds.filter(h => h.status === "released").reduce((sum, h) => sum + h.quantity, 0);
  const closedShort = shipmentTotal(order.closure?.unfulfilled ?? [], itemId);
  return { ordered, dispatched, received, damaged, held, usable: received - damaged + released, lost, closedShort,
    inTransit: order.type === "transfer" ? dispatched - received - lost : 0,
    remaining: order.closure ? 0 : ordered - received - lost };
}
export function shipmentStatus(state: InventoryState, order: InventoryOrder): InventoryOrder["status"] {
  if (order.closure) return "closed";
  const unresolved = (state.shipmentHolds ?? []).some(h => h.orderId === order.id && h.status !== "released");
  return !unresolved && !(order.losses?.length) && order.lines.every(l => shipmentTotal(order.received, l.itemId) === l.quantity)
    ? "completed" : "partial";
}
