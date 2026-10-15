import { z } from "zod";
import { InventoryError } from "./inventory-errors";
import { stockLineSchema, type InventoryCommand, type InventoryState, type InventoryReceipt, type StockLine } from "./inventory";
import { damageLineSchema, settledLines, shipmentStatus, shipmentTotal } from "./inventory-shipment-model";

const assert: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new InventoryError(message);
};
const id = z.string().trim().min(1).max(100);
const reason = z.string().trim().min(1).max(1000);
const lines = z.array(stockLineSchema).max(500);
type Context = {
  access: (id: string) => unknown;
  move: (warehouseId: string, lines: StockLine[], sign: 1 | -1) => void;
  validate: (lines: StockLine[]) => void;
  within: (lines: StockLine[], expected: StockLine[], previous: StockLine[]) => void;
};
export const shipmentActions = ["receive", "dispatch", "accept", "closeOrder", "resolveTransit", "resolveHold"];

// A single availability boundary is shared with receiving, counting and returns.
export function assertNotHeld(state: InventoryState, itemId: string, serial: string) {
  assert(!(state.shipmentHolds ?? []).some(h => h.status === "held" &&
    (h.serials.includes(serial) || h.expectedSerials.includes(serial))),
  "Serial is quarantined; inspect and resolve the shipment hold first.");
}
export function applyShipmentCommand(
  s: InventoryState, command: InventoryCommand, actor: string, now: string, ctx: Context,
) {
  const { action, operationId, data } = command;
  s.shipmentHolds ??= [];
  const receipt = (reference: string, warehouseId: string, input: StockLine[], why: string,
    extra: Partial<InventoryReceipt> = {}) =>
    s.receipts.push({ id: operationId, action, reference, warehouseId, lines: input, actor, occurredAt: now, reason: why, ...extra });
  if (action === "resolveHold") {
    const d = z.object({ id, outcome: z.enum(["released", "returned", "scrapped"]), reason,
      reference: z.string().trim().max(500).default(""), verifiedSerials: z.array(id).max(10000).default([]) }).strict().parse(data);
    const hold = s.shipmentHolds.find(h => h.id === d.id);
    assert(hold && hold.status === "held", "Open shipment hold required.");
    ctx.access(hold.warehouseId);
    const item = s.items.find(i => i.id === hold.itemId);
    assert(item?.active, "Choose an active item in this project.");
    assert(d.outcome !== "returned" || d.reference, "Return destination and shipment/reference are required.");
    let serials = [...hold.serials];
    if (d.outcome === "released") {
      serials = d.verifiedSerials;
      ctx.validate([{ itemId: hold.itemId, quantity: hold.quantity, serials }]);
      assert(hold.serials.every(x => serials.includes(x)), "Keep every already verified serial.");
      assert(!hold.expectedSerials.length || hold.expectedSerials.every(x => serials.includes(x)),
        "Verified identities must match the unverified dispatched identities; investigate any mismatch before release.");
    } else {
      assert(!d.verifiedSerials.length, "Verified serials are supplied only when releasing to usable stock.");
    }
    // Mark resolved before moving: the same hold must not block its own identities.
    hold.status = d.outcome;
    hold.resolution = { operationId, actor, occurredAt: now, reason: d.reason, reference: d.reference, verifiedSerials: serials };
    const moved = [{ itemId: hold.itemId, quantity: hold.quantity, serials }];
    if (d.outcome === "released") ctx.move(hold.warehouseId, moved, 1);
    if (d.outcome === "scrapped") for (const serial of [...hold.serials, ...hold.expectedSerials])
      s.serialOccupancy!.push({ itemId: hold.itemId, serial, workOrderId: null });
    receipt(hold.orderId, hold.warehouseId, moved, d.reason, {
      holdId: hold.id, resolution: d.outcome, externalReference: d.reference,
    });
    const order = s.orders.find(o => o.id === hold.orderId);
    if (order && ["partial", "completed"].includes(order.status)) order.status = shipmentStatus(s, order);
    return;
  }
  const orderId = id.parse(data.orderId), order = s.orders.find(o => o.id === orderId);
  assert(order && ["released", "partial"].includes(order.status), "Release an open order before posting.");
  ctx.access(action === "dispatch" ? order.sourceId! : order.destinationId);
  const close = (why: string) => {
    assert(order.type !== "transfer" || order.lines.every(l =>
      shipmentTotal(order.dispatched, l.itemId) === shipmentTotal(settledLines(order), l.itemId)),
    "Resolve all dispatched stock still in transit before closing. Closing an unshipped remainder cannot erase transit.");
    const unfulfilled = order.lines.flatMap(l => {
      const quantity = l.quantity - shipmentTotal(order.received, l.itemId);
      return quantity ? [{ itemId: l.itemId, quantity, serials: [] }] : [];
    });
    order.closure = { actor, occurredAt: now, reason: why, operationId, unfulfilled };
    order.status = "closed";
    return unfulfilled;
  };
  if (action === "closeOrder") {
    const d = z.object({ orderId: id, reason }).strict().parse(data);
    const short = close(d.reason);
    receipt(order.id, order.destinationId, [], d.reason, { closedShort: short, resolution: "closed with exceptions" });
    return;
  }
  if (action === "resolveTransit") {
    const d = z.object({ orderId: id, lines: lines.min(1), reason }).strict().parse(data);
    assert(order.type === "transfer", "Transfer order required.");
    ctx.validate(d.lines);
    const expected = order.lines.map(l => ({ ...l, quantity: shipmentTotal(order.dispatched, l.itemId),
      serials: order.dispatched.filter(x => x.itemId === l.itemId).flatMap(x => x.serials) }));
    ctx.within(d.lines, expected, settledLines(order));
    order.losses ??= [];
    order.losses.push(...d.lines);
    for (const l of d.lines) for (const serial of l.serials)
      s.serialOccupancy!.push({ itemId: l.itemId, serial, workOrderId: null });
    order.status = "partial";
    receipt(order.id, order.destinationId, d.lines, d.reason, { resolution: "confirmed transit loss" });
    return;
  }
  const d = z.object({
    orderId: id, lines, damaged: z.array(damageLineSchema).max(500).default([]),
    reason: z.string().max(1000).default(""), closeRemainder: z.boolean().default(false),
  }).strict().parse(data);
  assert(d.lines.length || d.damaged.length || d.closeRemainder, "Enter a quantity or choose an authorized closure.");
  assert(!d.closeRemainder || d.reason.trim(), "Closing an order requires a reason.");
  ctx.validate(d.lines);
  assert(action !== "dispatch" || !d.damaged.length, "Dispatch only usable stock; record transit damage at arrival.");
  assert(new Set(d.damaged.map(l => l.itemId)).size === d.damaged.length, "Combine damaged item lines.");
  for (const l of d.damaged) {
    const item = s.items.find(i => i.id === l.itemId && i.active);
    assert(item, "Choose an active item in this project.");
    assert(item.tracking === "serialized"
      ? l.serials.length + l.unidentifiedQuantity === l.quantity
      : !l.serials.length && !l.unidentifiedQuantity && !l.expectedSerials.length,
    "Damaged serial counts plus explicitly unidentified units must equal damaged quantity.");
    assert(item.tracking !== "serialized" || (action === "accept"
      ? l.expectedSerials.length === l.unidentifiedQuantity : !l.expectedSerials.length),
    "Unidentified arrivals require exactly one unverified dispatched identity per unidentified unit; purchases do not use dispatch references.");
  }
  const physical = new Map<string, StockLine>();
  for (const l of [...d.lines, ...d.damaged.map(l => ({
    itemId: l.itemId, quantity: l.quantity, serials: [...l.serials, ...l.expectedSerials],
  }))]) {
    const old = physical.get(l.itemId);
    if (old) { old.quantity += l.quantity; old.serials.push(...l.serials); }
    else physical.set(l.itemId, structuredClone(l));
  }
  const input = [...physical.values()];
  for (const l of input) {
    assert(l.quantity <= 1000000 && l.serials.length <= 10000, "Combined item quantity/serial limit exceeded.");
    assert(new Set(l.serials).size === l.serials.length, "Duplicate serial scanned across good, damaged or unidentified units.");
  }
  assert(input.length <= 500, "A movement supports at most 500 item lines.");
  if (action === "dispatch") {
    assert(order.type === "transfer" && order.sourceId, "Transfer order required.");
    ctx.within(input, order.lines, order.dispatched);
    ctx.move(order.sourceId, input, -1); order.dispatched.push(...input);
  } else {
    assert((action === "receive") === (order.type === "purchase"), "Choose purchase receiving or transfer arrival for this order.");
    const expected = action === "receive" ? order.lines : order.lines.map(l => ({ ...l,
      quantity: shipmentTotal(order.dispatched, l.itemId),
      serials: order.dispatched.filter(x => x.itemId === l.itemId).flatMap(x => x.serials) }));
    ctx.within(input, expected, settledLines(order));
    // Check damage identities before changing custody, while the originating transit
    // is still visible. Foreign transit, installed units and active holds are forbidden.
    for (const l of d.damaged) for (const serial of [...l.serials, ...l.expectedSerials]) {
      assertNotHeld(s, l.itemId, serial);
      assert(!s.stock.some(b => b.serials.includes(serial)), "Damaged serial already in inventory.");
      assert(!s.serialOccupancy?.some(x => x.serial === serial), "Damaged serial already installed or disposed.");
      assert(!s.returns.some(r => r.status !== "released" && r.serial === serial), "Serial is pending removed-equipment review.");
      assert(!s.orders.some(o => o.id !== order.id && o.type === "transfer" &&
        o.dispatched.some(x => x.serials.includes(serial)) && !settledLines(o).some(x => x.serials.includes(serial))),
      "Serial is in transit on another order.");
    }
    order.received.push(...input);
    ctx.move(order.destinationId, d.lines, 1);
    d.damaged.forEach((l, index) => s.shipmentHolds!.push({
      ...l, id: `${operationId}-${index}`, orderId: order.id, receiptId: operationId,
      warehouseId: order.destinationId, actor, occurredAt: now, status: "held",
    }));
  }
  order.status = shipmentStatus(s, order);
  const short = d.closeRemainder ? close(d.reason.trim()) : undefined;
  receipt(order.id, action === "dispatch" ? order.sourceId! : order.destinationId, d.lines, d.reason, {
    ...(d.damaged.length ? { damaged: d.damaged } : {}), ...(short ? { closedShort: short } : {}),
  });
}
