import { z } from "zod";
import type { InventoryState } from "../shared/inventory";
import { stockLineSchema } from "../shared/inventory";
import { damageLineSchema, remainingHold, holdStatus, settledLines, shipmentTotal, type ShipmentHold } from "../shared/inventory-shipment-model";
import { selectHoldDisposition } from "../shared/inventory-hold-disposition";
import { canonicalInventoryJson } from "../shared/inventory-engine";

const id = z.string().min(1).max(100);
const dispositionSchema = z.object({
  operationId: id, actor: id, occurredAt: z.string().datetime(),
  outcome: z.enum(["released", "returned", "scrapped"]),
  quantity: z.number().int().positive().max(1000000),
  serials: z.array(id).max(10000), unidentifiedQuantity: z.number().int().nonnegative().max(1000000),
  expectedSerials: z.array(id).max(10000), verifiedSerials: z.array(id).max(10000),
  reason: z.string().trim().min(1).max(1000), reference: z.string().max(500),
}).strict();
const holdSchema = damageLineSchema.extend({
  id, orderId: id, receiptId: id, warehouseId: id, actor: id, occurredAt: z.string().datetime(),
  status: z.enum(["held", "released", "returned", "scrapped", "resolved"]),
  resolution: z.object({ operationId: id, actor: id, occurredAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(1000), reference: z.string().max(500),
    verifiedSerials: z.array(id).max(10000) }).strict().optional(),
  dispositions: z.array(dispositionSchema).max(1000000).optional(),
});
const closureSchema = z.object({ actor: id, occurredAt: z.string().datetime(), operationId: id,
  reason: z.string().trim().min(1).max(1000), unfulfilled: z.array(stockLineSchema).max(500) }).strict();
export function validateShipmentBackup(s: InventoryState) {
  const fail = (message: string): never => { throw new Error(`Invalid shipment backup: ${message}`); };
  const holds = z.array(holdSchema).parse(s.shipmentHolds ?? []);
  if (new Set(holds.map(h => h.id)).size !== holds.length) fail("duplicate hold.");
  const unique = new Set<string>();
  const dispositionIds = new Set<string>();
  for (const hold of holds) {
    const order = s.orders.find(o => o.id === hold.orderId);
    const origin = s.receipts.find(r => r.id === hold.receiptId && r.reference === hold.orderId);
    const item = s.items.find(i => i.id === hold.itemId);
    if (!order || !origin || !item || order.destinationId !== hold.warehouseId ||
      !s.warehouses.some(w => w.id === hold.warehouseId)) fail("hold relationship missing.");
    const source = origin!.damaged?.find(l => l.itemId === hold.itemId);
    if (!source || source.quantity !== hold.quantity || JSON.stringify(source.serials) !== JSON.stringify(hold.serials) ||
      source.unidentifiedQuantity !== hold.unidentifiedQuantity || JSON.stringify(source.expectedSerials) !== JSON.stringify(hold.expectedSerials))
      fail("hold differs from its original damaged receipt.");
    if (item!.tracking === "serialized" ? hold.serials.length + hold.unidentifiedQuantity !== hold.quantity :
      !!(hold.serials.length || hold.expectedSerials.length || hold.unidentifiedQuantity)) fail("hold identity/quantity mismatch.");
    if (order!.type === "transfer" ? hold.expectedSerials.length !== hold.unidentifiedQuantity : !!hold.expectedSerials.length)
      fail("unverified transfer references mismatch.");
    if (new Set([...hold.serials, ...hold.expectedSerials]).size !== hold.serials.length + hold.expectedSerials.length)
      fail("duplicate held identity.");
    if (hold.dispositions !== undefined) {
      if (hold.resolution) fail("hold mixes legacy and partial disposition history.");
      const replay: ShipmentHold = { ...hold, status: "held", dispositions: [] };
      for (const event of hold.dispositions) {
        if (dispositionIds.has(event.operationId)) fail("duplicate disposition operation.");
        dispositionIds.add(event.operationId);
        try {
          selectHoldDisposition(replay, item!.tracking === "serialized", { ...event, id: hold.id });
        } catch (error) { fail(error instanceof Error ? error.message : "invalid partial disposition."); }
        const record = s.receipts.find(r => r.id === event.operationId);
        const serials = event.outcome === "released" ? event.verifiedSerials : [...event.serials, ...event.expectedSerials];
        if (!record || record.action !== "resolveHold" || record.holdId !== hold.id || record.reference !== hold.orderId ||
          record.warehouseId !== hold.warehouseId || record.resolution !== event.outcome || record.actor !== event.actor ||
          record.occurredAt !== event.occurredAt || record.reason !== event.reason || record.externalReference !== event.reference ||
          canonicalInventoryJson(record.holdDisposition) !== canonicalInventoryJson(event) ||
          canonicalInventoryJson(record.lines) !== canonicalInventoryJson([{ itemId: hold.itemId, quantity: event.quantity, serials }]))
          fail("partial disposition differs from its receipt.");
        if (event.outcome === "scrapped" && serials.some(serial =>
          !s.serialOccupancy?.some(x => x.itemId === hold.itemId && x.serial === serial && x.workOrderId === null)))
          fail("written-off hold identity is not blocked.");
        replay.dispositions!.push(event);
      }
      if (hold.status !== holdStatus(replay)) fail("partial hold status/totals mismatch.");
    } else {
      if (hold.status === "resolved" || (hold.status === "held") === !!hold.resolution) fail("hold resolution/status mismatch.");
    }
    if (hold.resolution) {
      const resolution = s.receipts.find(r => r.id === hold.resolution!.operationId && r.holdId === hold.id &&
        r.reference === hold.orderId && r.resolution === hold.status);
      if (!resolution) fail("resolution receipt missing.");
      if (hold.status === "returned" && !hold.resolution.reference.trim()) fail("return destination missing.");
      if (hold.status === "released" && (item!.tracking === "serialized"
        ? hold.resolution.verifiedSerials.length !== hold.quantity || new Set(hold.resolution.verifiedSerials).size !== hold.quantity ||
          ![...hold.serials, ...hold.expectedSerials].every(x => hold.resolution!.verifiedSerials.includes(x))
        : !!hold.resolution.verifiedSerials.length)) fail("released hold identities invalid.");
    }
    if (hold.status === "held") for (const serial of [...remainingHold(hold).serials, ...remainingHold(hold).expectedSerials]) {
      // These identities are quarantined rather than in the usable stock mirrors.
      const key = JSON.stringify([hold.itemId, serial]);
      if (unique.has(key) || s.stock.some(b => b.itemId === hold.itemId && b.serials.includes(serial)) ||
        s.serialOccupancy?.some(x => x.itemId === hold.itemId && x.serial === serial)) fail("held identity also usable/occupied.");
      unique.add(key);
    }
  }
  for (const receipt of s.receipts) if (receipt.holdDisposition && !dispositionIds.has(receipt.id))
    fail("orphan partial disposition receipt.");
  for (const order of s.orders) {
    if (order.replacementFor && (!s.orders.some(o => o.id === order.replacementFor && !o.replacementFor) ||
      order.id === order.replacementFor)) fail("replacement order reference invalid.");
    if (order.closure) {
      const closure = closureSchema.parse(order.closure);
      if (order.status !== "closed" || !s.receipts.some(r => r.id === closure.operationId && r.reference === order.id))
        fail("closed order has no closure receipt.");
      if (new Set(closure.unfulfilled.map(l => l.itemId)).size !== closure.unfulfilled.length ||
        closure.unfulfilled.some(l => !order.lines.some(x => x.itemId === l.itemId) || l.serials.length))
        fail("invalid closed-short lines.");
      for (const l of order.lines) if (shipmentTotal(closure.unfulfilled, l.itemId) !== l.quantity - shipmentTotal(order.received, l.itemId))
        fail("closed-short totals do not reconcile.");
    } else if (order.status === "closed") fail("closed order has no closure metadata.");
    if (order.losses) {
      z.array(stockLineSchema).parse(order.losses);
      if (order.type !== "transfer") fail("purchase has in-transit losses.");
      for (const l of order.losses) {
        const item = s.items.find(i => i.id === l.itemId);
        if (!item || (item.tracking === "serialized" ? l.quantity !== l.serials.length : !!l.serials.length))
          fail("loss identity/quantity mismatch.");
        for (const serial of l.serials) if (!s.serialOccupancy?.some(x => x.itemId === l.itemId && x.serial === serial))
          fail("written-off transit identity is not blocked.");
      }
    }
    for (const l of order.lines) {
      const got = shipmentTotal(order.received, l.itemId), sent = shipmentTotal(order.dispatched, l.itemId);
      const settled = shipmentTotal(settledLines(order), l.itemId);
      if (got > l.quantity || sent > l.quantity || order.type === "transfer" && settled > sent) fail("order exceeds remaining quantity.");
      if (order.type === "transfer" && order.closure && settled !== sent) fail("closed transfer still has unresolved transit.");
      const serials = settledLines(order).filter(x => x.itemId === l.itemId).flatMap(x => x.serials);
      if (new Set(serials).size !== serials.length) fail("received/lost identity repeated.");
    }
  }
  for (const r of s.receipts) if (r.damaged) z.array(damageLineSchema).max(500).parse(r.damaged);
}
