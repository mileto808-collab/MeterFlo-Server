import { z } from "zod";
import { stockLineSchema, type InventoryState } from "../shared/inventory";
import { kitRecoverySchema, kitDisassemblyContents, selectKitHold, remainingKitHold, kitHoldStatus, type KitHold } from "../shared/inventory-kits";

const id = z.string().min(1).max(250);
const quantity = z.number().int().positive().max(1000000);
const serials = z.array(z.string().min(1).max(100)).max(10000);
const positionSchema = z.object({
  kind: z.enum(["stock", "transit", "work", "assembly", "hold", "retired"]), id, quantity, serials,
}).strict();
const assemblySchema = z.object({
  id, itemId: id, quantity, serials, components: z.array(stockLineSchema).min(1).max(100),
  warehouseId: id, occurredAt: z.string().datetime(), positions: z.array(positionSchema),
  disassembledQuantity: z.number().int().nonnegative(), disassembledSerials: serials,
}).strict();
const holdSchema = z.object({
  id, assemblyId: id, receiptId: id, itemId: id, warehouseId: id, quantity, serials,
  reason: z.string().trim().min(1).max(1000), status: z.enum(["held", "released", "scrapped", "resolved"]),
  actor: id, occurredAt: z.string().datetime(),
  resolution: z.object({ operationId: id, actor: id, occurredAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(1000) }).strict().optional(),
  dispositions: z.array(z.object({ operationId: id, actor: id, occurredAt: z.string().datetime(),
    reason: z.string().trim().min(1).max(1000), outcome: z.enum(["released", "scrapped"]), quantity, serials }).strict()).optional(),
}).strict();
const fail: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) throw new Error(`Invalid kit backup: ${message}`);
};
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
export function validateKitBackup(state: InventoryState) {
  const assemblies = z.array(assemblySchema).parse(state.kitAssemblies ?? []);
  const holds = z.array(holdSchema).parse(state.kitHolds ?? []);
  fail(new Set(assemblies.map(a => a.id)).size === assemblies.length, "duplicate assemblies");
  fail(new Set(holds.map(h => h.id)).size === holds.length, "duplicate inspection holds");
  for (const assembly of assemblies) {
    const receipt = state.receipts.find(r => r.id === assembly.id), item = state.items.find(i => i.id === assembly.itemId);
    fail(receipt?.action === "assemble" && item && receipt.warehouseId === assembly.warehouseId &&
      receipt.lines.length === 1 && equal(receipt.components, assembly.components) &&
      equal(receipt.lines[0], { itemId: assembly.itemId, quantity: assembly.quantity, serials: assembly.serials }), "assembly evidence differs from its receipt");
    fail(new Set(assembly.components.map(c => c.itemId)).size === assembly.components.length &&
      assembly.components.every(c => state.items.some(i => i.id === c.itemId)), "invalid original component relationship");
    fail(assembly.positions.reduce((n, p) => n + p.quantity, 0) + assembly.disassembledQuantity === assembly.quantity, "unbalanced assembly positions");
    fail(assembly.disassembledQuantity <= assembly.quantity &&
      new Set(assembly.disassembledSerials).size === assembly.disassembledSerials.length, "invalid disassembled output");
    const positionedSerials = assembly.positions.flatMap(p => p.serials);
    fail(item.tracking === "serialized" ? assembly.serials.length === assembly.quantity &&
      new Set(assembly.serials).size === assembly.serials.length &&
      positionedSerials.length + assembly.disassembledSerials.length === assembly.quantity &&
      new Set([...positionedSerials, ...assembly.disassembledSerials]).size === assembly.quantity &&
      [...positionedSerials, ...assembly.disassembledSerials].every(serial => assembly.serials.includes(serial)) :
      !assembly.serials.length && !positionedSerials.length && !assembly.disassembledSerials.length, "invalid assembly serial identities");
    for (const position of assembly.positions) {
      fail(item.tracking !== "serialized" || position.serials.length === position.quantity, "position serial quantity mismatch");
      if (position.kind === "stock") {
        const stock = state.stock.find(b => b.itemId === assembly.itemId && b.warehouseId === position.id);
        fail(stock && position.quantity <= stock.quantity && position.serials.every(serial => stock.serials.includes(serial)), "assembly position is not in stock");
      } else if (position.kind === "assembly") fail(assemblies.some(a => a.id === position.id), "missing parent assembly");
      else if (position.kind === "hold") fail(holds.some(h => h.id === position.id && h.status === "held") ||
        state.shipmentHolds?.some(h => h.id === position.id && h.status === "held"), "missing inspection custody");
      else if (position.kind === "transit") fail(state.orders.some(o => o.id === position.id && o.type === "transfer"), "missing transfer");
      else if (position.kind === "work") fail(state.allocations.some(a => String(a.workOrderId) === position.id &&
        (a.status === "consumed" || a.status === "released" && a.used.length > 0)), "missing consumed work allocation");
    }
    const disassemblies = state.receipts.filter(r => r.action === "disassemble" && r.kitConversion?.assemblyId === assembly.id);
    fail(disassemblies.reduce((n, r) => n + (r.lines[0]?.quantity ?? 0), 0) === assembly.disassembledQuantity, "disassembly history differs from remaining quantity");
    const removedSerials = disassemblies.flatMap(r => r.lines.flatMap(l => l.serials));
    fail(removedSerials.length === new Set(removedSerials).size &&
      equal([...removedSerials].sort(), [...assembly.disassembledSerials].sort()), "disassembled identities differ from receipts");
    for (const receipt of disassemblies) {
      const output = receipt.lines[0];
      fail(receipt.lines.length === 1 && output.itemId === assembly.itemId, "invalid disassembly output");
      const originalState = structuredClone(state);
      const original = originalState.kitAssemblies!.find(a => a.id === assembly.id)!;
      original.disassembledQuantity = 0; original.disassembledSerials = [];
      const expected = kitDisassemblyContents(originalState, assembly.id, output.quantity, output.serials);
      const recoveries = z.array(kitRecoverySchema).parse(receipt.kitConversion!.recovered);
      fail(new Set(recoveries.map(c => c.itemId)).size === recoveries.length && recoveries.length === expected.length,
        "incomplete component dispositions");
      for (const component of expected) {
        const recovery = recoveries.find(c => c.itemId === component.itemId);
        fail(recovery && recovery.usableQuantity + recovery.damagedQuantity + recovery.missingQuantity === component.quantity &&
          (!(recovery.damagedQuantity + recovery.missingQuantity) || recovery.reason), "unbalanced component dispositions");
        const captured = [...recovery.usableSerials, ...recovery.damagedSerials, ...recovery.missingSerials];
        fail(component.serials.length ? recovery.usableSerials.length === recovery.usableQuantity &&
          recovery.damagedSerials.length === recovery.damagedQuantity && recovery.missingSerials.length === recovery.missingQuantity &&
          new Set(captured).size === component.serials.length && captured.length === component.serials.length &&
          captured.every(serial => component.serials.includes(serial)) : !captured.length, "invalid recovered serials");
        if (recovery.damagedQuantity) fail(holds.some(h => h.receiptId === receipt.id && h.itemId === component.itemId &&
          h.quantity === recovery.damagedQuantity && equal(h.serials, recovery.damagedSerials)), "missing damaged component custody");
      }
      const usable = recoveries.filter(c => c.usableQuantity).map(c =>
        ({ itemId: c.itemId, quantity: c.usableQuantity, serials: c.usableSerials }));
      fail(equal(receipt.components, usable), "usable component evidence differs");
    }
  }
  const dispositionIds = new Set<string>();
  for (const hold of holds) {
    fail(assemblies.some(a => a.id === hold.assemblyId) &&
      state.receipts.some(r => r.id === hold.receiptId && r.kitConversion?.assemblyId === hold.assemblyId) &&
      state.warehouses.some(w => w.id === hold.warehouseId) && state.items.some(i => i.id === hold.itemId), "invalid hold relationship");
    const item = state.items.find(i => i.id === hold.itemId)!;
    fail(item.tracking === "serialized" ? hold.serials.length === hold.quantity &&
      new Set(hold.serials).size === hold.quantity : !hold.serials.length, "invalid held component identities");
    const original = state.receipts.find(r => r.id === hold.receiptId)?.kitConversion?.recovered.find(c => c.itemId === hold.itemId);
    fail(original && original.damagedQuantity === hold.quantity && equal(original.damagedSerials, hold.serials) &&
      original.reason === hold.reason, "hold differs from original damaged components");
    if (hold.dispositions !== undefined) {
      fail(!hold.resolution, "mixed legacy and partial inspection history");
      const replay: KitHold = { ...hold, status: "held", dispositions: [] };
      for (const event of hold.dispositions) {
        fail(!dispositionIds.has(event.operationId), "duplicate inspection disposition");
        dispositionIds.add(event.operationId);
        selectKitHold(replay, item.tracking === "serialized", { ...event, id: hold.id });
        const receipt = state.receipts.find(r => r.id === event.operationId);
        const selected = { itemId: hold.itemId, quantity: event.quantity, serials: event.serials };
        fail(receipt?.action === "resolveKitHold" && receipt.kitHoldId === hold.id &&
          receipt.reference === hold.itemId && receipt.warehouseId === hold.warehouseId &&
          receipt.actor === event.actor && receipt.occurredAt === event.occurredAt &&
          receipt.reason === event.reason && receipt.resolution === event.outcome &&
          equal(receipt.kitInspection, selected) &&
          equal(receipt.lines, event.outcome === "released" ? [selected] : []), "inspection disposition differs from receipt");
        replay.dispositions!.push(event);
        replay.status = kitHoldStatus(replay);
      }
      fail(hold.status === kitHoldStatus(replay), "inspection status differs from remaining custody");
    } else fail(hold.status === "held" ? !hold.resolution : hold.resolution &&
      state.receipts.some(r => r.id === hold.resolution!.operationId && r.kitHoldId === hold.id && r.resolution === hold.status),
      "inspection resolution differs from receipt");
    const resolution = state.receipts.find(r => r.id === hold.resolution?.operationId);
    if (resolution?.kitInspection) fail(resolution.kitInspection.itemId === hold.itemId &&
      resolution.kitInspection.quantity === hold.quantity && equal(resolution.kitInspection.serials, hold.serials),
      "inspection receipt differs from original held components");
    const blocked = hold.dispositions !== undefined
      ? [...remainingKitHold(hold).serials, ...hold.dispositions.filter(e => e.outcome === "scrapped").flatMap(e => e.serials)]
      : hold.status === "released" ? [] : hold.serials;
    for (const serial of blocked) fail(
      !state.stock.some(b => b.itemId === hold.itemId && b.serials.includes(serial)) &&
      state.serialOccupancy?.some(o => o.itemId === hold.itemId && o.serial === serial), "held/scrapped component identity became usable");
  }
  for (const receipt of state.receipts.filter(r => r.action === "resolveKitHold")) fail(
    dispositionIds.has(receipt.id) || holds.some(h => h.resolution?.operationId === receipt.id),
    "orphan inspection receipt");
  for (const stock of state.stock) {
    const positioned = assemblies.flatMap(a => a.itemId === stock.itemId ? a.positions.filter(p =>
      p.kind === "stock" && p.id === stock.warehouseId) : []);
    fail(positioned.reduce((n, p) => n + p.quantity, 0) <= stock.quantity &&
      new Set(positioned.flatMap(p => p.serials)).size === positioned.flatMap(p => p.serials).length, "overlapping assembly stock");
  }
}
