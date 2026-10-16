import { z } from "zod";
import type { InventoryState, StockLine } from "./inventory";
import { InventoryError } from "./inventory-errors";

export type KitOwner = { kind: "stock" | "transit" | "work" | "assembly" | "hold" | "retired"; id: string };
export type KitPosition = KitOwner & { quantity: number; serials: string[] };
export type KitAssembly = {
  id: string; itemId: string; quantity: number; serials: string[]; components: StockLine[];
  warehouseId: string; occurredAt: string; positions: KitPosition[];
  disassembledQuantity: number; disassembledSerials: string[];
};
export type KitHold = {
  id: string; assemblyId: string; receiptId: string; itemId: string; warehouseId: string;
  quantity: number; serials: string[]; reason: string; status: "held" | "released" | "scrapped";
  actor: string; occurredAt: string;
  resolution?: { operationId: string; actor: string; occurredAt: string; reason: string };
};
export type KitFlow = { from?: KitOwner | null; to?: KitOwner | null; assemblyId?: string };
const fail: (condition: unknown, message: string) => asserts condition = (condition, message) => {
  if (!condition) throw new InventoryError(message);
};
const ownerIs = (position: KitOwner, owner: KitOwner) => position.kind === owner.kind && position.id === owner.id;
const stockOwner = (id: string): KitOwner => ({ kind: "stock", id });
const line = (itemId: string, quantity: number, serials: string[] = []): StockLine => ({ itemId, quantity, serials });

export function kitAvailable(state: InventoryState, warehouseId: string, itemId: string) {
  const held = state.allocations.filter(a => a.status === "reserved").flatMap(a => a.lines)
    .filter(l => l.warehouseId === warehouseId && l.itemId === itemId).reduce((n, l) => n + l.quantity, 0);
  return Math.max(0, (state.stock.find(b => b.warehouseId === warehouseId && b.itemId === itemId)?.quantity ?? 0) - held);
}

// A repeated serial label is not proof of uninterrupted ownership. Replay only
// exact transfer custody; counts, replacement receipts, nesting, and inspection
// with incomplete historical identity evidence invalidate this legacy inference.
function legacySerialLocation(state: InventoryState, receiptIndex: number, itemId: string, serial: string, initialWarehouse: string) {
  let warehouse: string | undefined = initialWarehouse;
  let transfer: string | undefined;
  for (const receipt of state.receipts.slice(receiptIndex + 1)) {
    if (receipt.components?.some(l => l.itemId === itemId && l.serials.includes(serial)) ||
      receipt.damaged?.some(l => l.itemId === itemId && (l.serials.includes(serial) || l.expectedSerials?.includes(serial)))) return;
    for (const entry of receipt.lines.filter(l => l.itemId === itemId)) {
      if (receipt.action === "countPost") return; // Removed serials are absent from count target rows.
      if (!entry.serials.includes(serial)) continue;
      const order = state.orders.find(o => o.id === receipt.reference && o.type === "transfer");
      if (receipt.action === "dispatch" && order && !transfer && warehouse === order.sourceId &&
        receipt.warehouseId === order.sourceId) {
        warehouse = undefined; transfer = order.id;
      } else if (receipt.action === "accept" && order && transfer === order.id && receipt.warehouseId === order.destinationId) {
        warehouse = order.destinationId; transfer = undefined;
      } else return; // Receive/import/return/count adjustment is not the original assembly.
    }
  }
  return transfer ? undefined : warehouse;
}

// Historical serial receipts need continuous custody. Quantity-only legacy receipts
// are admitted only if no later stock-changing evidence makes their location ambiguous.
export function ensureKitProvenance(state: InventoryState) {
  state.kitAssemblies ??= [];
  state.kitHolds ??= [];
  for (const [index, receipt] of state.receipts.entries()) {
    if (receipt.action !== "assemble" || !receipt.components?.length || receipt.lines.length !== 1 ||
        state.kitAssemblies.some(a => a.id === receipt.id)) continue;
    const output = receipt.lines[0], item = state.items.find(i => i.id === output.itemId);
    if (!item || !receipt.warehouseId || !Number.isInteger(output.quantity) || output.quantity <= 0) continue;
    const positions: KitPosition[] = [];
    if (item.tracking === "serialized") {
      if (output.serials.length !== output.quantity || new Set(output.serials).size !== output.quantity) continue;
      // A reused label belongs to its newest assembly, not every historical receipt.
      const current = output.serials.filter(serial => !state.receipts.slice(index + 1).some(r =>
        r.action === "assemble" && r.lines.some(l => l.itemId === output.itemId && l.serials.includes(serial))));
      for (const stock of state.stock.filter(b => b.itemId === output.itemId)) {
        const serials = stock.serials.filter(serial => current.includes(serial) &&
          legacySerialLocation(state, index, output.itemId, serial, receipt.warehouseId!) === stock.warehouseId);
        if (serials.length) positions.push({ ...stockOwner(stock.warehouseId), quantity: serials.length, serials });
      }
      const unavailable = current.filter(serial => !positions.some(p => p.serials.includes(serial)));
      if (unavailable.length) positions.push({ kind: "retired", id: "legacy-unlocated", quantity: unavailable.length, serials: unavailable });
    } else {
      const later = state.receipts.slice(index + 1).some(r => r.lines.some(l => l.itemId === output.itemId) ||
        r.components?.some(l => l.itemId === output.itemId));
      const total = state.stock.filter(b => b.itemId === output.itemId).reduce((n, b) => n + b.quantity, 0);
      const earlier = state.receipts.slice(0, index).some(r => r.lines.some(l => l.itemId === output.itemId));
      if (later || earlier || total !== output.quantity ||
          state.stock.find(b => b.itemId === output.itemId && b.warehouseId === receipt.warehouseId)?.quantity !== output.quantity ||
          state.allocations.some(a => [...a.lines, ...a.used].some(l => l.itemId === output.itemId))) continue;
      positions.push({ ...stockOwner(receipt.warehouseId), quantity: output.quantity, serials: [] });
    }
    const positioned = positions.reduce((n, p) => n + p.quantity, 0);
    if (positioned < output.quantity) positions.push({ kind: "retired", id: "legacy-superseded",
      quantity: output.quantity - positioned, serials: output.serials.filter(serial => !positions.some(p => p.serials.includes(serial))) });
    state.kitAssemblies.push({ id: receipt.id, itemId: output.itemId, quantity: output.quantity,
      serials: [...output.serials], components: structuredClone(receipt.components), warehouseId: receipt.warehouseId,
      occurredAt: receipt.occurredAt, positions, disassembledQuantity: 0, disassembledSerials: [] });
  }
}

export function moveKitProvenance(state: InventoryState, warehouseId: string, lines: StockLine[], sign: 1 | -1, flow: KitFlow = {}) {
  const from = flow.from === undefined ? sign < 0 ? stockOwner(warehouseId) : null : flow.from;
  const to = flow.to === undefined ? sign > 0 ? stockOwner(warehouseId) : { kind: "retired" as const, id: "stock-removed" } : flow.to;
  if (!from) return; // Receiving/counting unidentified stock must never fabricate lineage.
  for (const input of lines) {
    let remaining = input.quantity;
    const serialSet = new Set(input.serials);
    for (const assembly of state.kitAssemblies ?? []) {
      if (assembly.itemId !== input.itemId || flow.assemblyId && assembly.id !== flow.assemblyId) continue;
      for (const position of [...assembly.positions]) {
        if (!ownerIs(position, from) || remaining <= 0) continue;
        const serials = position.serials.filter(serial => serialSet.has(serial));
        const quantity = input.serials.length ? serials.length : Math.min(remaining, position.quantity);
        if (!quantity) continue;
        position.quantity -= quantity;
        position.serials = position.serials.filter(serial => !serials.includes(serial));
        if (to) {
          let destination = assembly.positions.find(p => ownerIs(p, to));
          if (!destination) { destination = { ...to, quantity: 0, serials: [] }; assembly.positions.push(destination); }
          destination.quantity += quantity; destination.serials.push(...serials);
        }
        remaining -= quantity;
      }
      assembly.positions = assembly.positions.filter(p => p.quantity > 0);
    }
    if (flow.assemblyId) fail(remaining === 0, "Selected assembly stock is no longer available. Refresh before posting.");
  }
}

export function recordKitAssembly(state: InventoryState, id: string, warehouseId: string, output: StockLine, components: StockLine[], occurredAt: string) {
  state.kitAssemblies!.push({ id, itemId: output.itemId, quantity: output.quantity, serials: [...output.serials],
    components: structuredClone(components), warehouseId, occurredAt,
    positions: [{ ...stockOwner(warehouseId), quantity: output.quantity, serials: [...output.serials] }],
    disassembledQuantity: 0, disassembledSerials: [] });
}

export function kitSerialContents(state: InventoryState, itemId: string, serial: string): StockLine[] {
  const assembly = [...(state.kitAssemblies ?? [])].reverse().find(a => a.itemId === itemId && a.serials.includes(serial));
  if (assembly) return assembly.disassembledSerials.includes(serial) ? [] :
    assembly.components.map(c => line(c.itemId, c.quantity / assembly.quantity, [...c.serials]));
  return [...state.receipts].reverse().find(r => r.action === "assemble" &&
    r.lines.some(l => l.itemId === itemId && l.serials.includes(serial)))?.components ?? [];
}

export function kitAssemblyOptions(input: InventoryState, warehouseId: string, itemId: string) {
  const state = structuredClone(input); ensureKitProvenance(state);
  const reserved = state.allocations.filter(a => a.status === "reserved").flatMap(a => a.lines)
    .filter(l => l.warehouseId === warehouseId && l.itemId === itemId).flatMap(l => l.serials);
  const stockSerials = state.stock.find(b => b.warehouseId === warehouseId && b.itemId === itemId)?.serials ?? [];
  return state.kitAssemblies!.filter(a => a.itemId === itemId).flatMap(assembly => {
    const position = assembly.positions.find(p => ownerIs(p, stockOwner(warehouseId)));
    if (!position) return [];
    const serials = position.serials.filter(serial => stockSerials.includes(serial) && !reserved.includes(serial));
    const availableQuantity = Math.min(kitAvailable(state, warehouseId, itemId),
      assembly.serials.length ? serials.length : position.quantity);
    return availableQuantity > 0 ? [{ assemblyId: assembly.id,
      label: `Assembly #${state.receipts.findIndex(r => r.id === assembly.id) + 1} · ${assembly.occurredAt.slice(0, 10)}`,
      availableQuantity, serials, components: structuredClone(assembly.components) }] : [];
  });
}

export function kitDisassemblyContents(input: InventoryState, assemblyId: string, quantity: number, serials: string[]): StockLine[] {
  const state = structuredClone(input); ensureKitProvenance(state);
  const assembly = state.kitAssemblies!.find(a => a.id === assemblyId);
  fail(assembly, "No trustworthy original assembly was found for this kit.");
  fail(Number.isInteger(quantity) && quantity > 0 && quantity <= assembly.quantity - assembly.disassembledQuantity, "Quantity exceeds the remaining assembled output.");
  fail(assembly.serials.length ? serials.length === quantity && new Set(serials).size === quantity &&
    serials.every(serial => assembly.serials.includes(serial) && !assembly.disassembledSerials.includes(serial)) : !serials.length,
    "Scan the exact finished-kit serials from this assembly.");
  return assembly.components.map(component => {
    const componentQuantity = component.quantity * quantity / assembly.quantity;
    fail(Number.isSafeInteger(componentQuantity) && componentQuantity > 0 &&
      (!component.serials.length || quantity === assembly.quantity), "Original component identities cannot be safely split across this assembly.");
    return line(component.itemId, componentQuantity, [...component.serials]);
  });
}

const identifier = z.string().trim().min(1).max(100);
const qty = z.number().int().nonnegative().max(1000000);
const serialsSchema = z.array(identifier).max(10000).default([]);
export const kitRecoverySchema = z.object({
  itemId: identifier, usableQuantity: qty, damagedQuantity: qty, missingQuantity: qty,
  usableSerials: serialsSchema, damagedSerials: serialsSchema, missingSerials: serialsSchema,
  reason: z.string().trim().max(1000).default(""),
}).strict();
export type KitRecovery = z.infer<typeof kitRecoverySchema>;
export const kitDisassemblySchema = z.object({
  warehouseId: identifier, assemblyId: identifier, quantity: qty.refine(n => n > 0),
  serials: serialsSchema, components: z.array(kitRecoverySchema).min(1).max(100),
  reason: z.string().trim().max(1000).default(""),
}).strict();
type Hooks = {
  access: (warehouseId: string) => unknown;
  move: (warehouseId: string, lines: StockLine[], sign: 1 | -1, flow?: KitFlow) => void;
};
export function applyKitDisassembly(state: InventoryState, raw: unknown, operationId: string, actor: string, now: string, hooks: Hooks) {
  const data = kitDisassemblySchema.parse(raw);
  hooks.access(data.warehouseId);
  const assembly = state.kitAssemblies!.find(a => a.id === data.assemblyId);
  fail(assembly, "No trustworthy original assembly was found for this kit.");
  const expected = kitDisassemblyContents(state, assembly.id, data.quantity, data.serials);
  fail(new Set(data.components.map(c => c.itemId)).size === data.components.length &&
    data.components.length === expected.length, "Account for every original component exactly once.");
  const usable: StockLine[] = [], damaged: StockLine[] = [], missing: StockLine[] = [];
  for (const component of expected) {
    const recovery = data.components.find(c => c.itemId === component.itemId);
    fail(recovery && recovery.usableQuantity + recovery.damagedQuantity + recovery.missingQuantity === component.quantity,
      "Usable, damaged, and missing quantities must match the original components.");
    const item = state.items.find(i => i.id === component.itemId);
    fail(item?.active, "Reactivate the original component before recording its recovery.");
    const identities = [...recovery.usableSerials, ...recovery.damagedSerials, ...recovery.missingSerials];
    fail(item.tracking === "serialized" ? recovery.usableSerials.length === recovery.usableQuantity &&
      recovery.damagedSerials.length === recovery.damagedQuantity && recovery.missingSerials.length === recovery.missingQuantity &&
      identities.length === component.serials.length && identities.every(serial => component.serials.includes(serial)) &&
      new Set(identities).size === identities.length : !identities.length, "Recovered serials must exactly partition the original component identities.");
    fail(!recovery.damagedQuantity && !recovery.missingQuantity || recovery.reason, "Enter a reason for each damaged or missing component.");
    if (recovery.usableQuantity) usable.push(line(component.itemId, recovery.usableQuantity, recovery.usableSerials));
    if (recovery.damagedQuantity) damaged.push(line(component.itemId, recovery.damagedQuantity, recovery.damagedSerials));
    if (recovery.missingQuantity) missing.push(line(component.itemId, recovery.missingQuantity, recovery.missingSerials));
  }
  const output = line(assembly.itemId, data.quantity, data.serials);
  hooks.move(data.warehouseId, [output], -1, { to: null, assemblyId: assembly.id });
  assembly.disassembledQuantity += data.quantity;
  assembly.disassembledSerials.push(...data.serials);
  for (const recovered of usable) {
    // Release the component's own identity only; nested kit contents remain occupied.
    state.serialOccupancy = (state.serialOccupancy ?? []).filter(o =>
      o.itemId !== recovered.itemId || !recovered.serials.includes(o.serial));
    hooks.move(data.warehouseId, [recovered], 1, { from: { kind: "assembly", id: assembly.id } });
  }
  for (const recovered of damaged) {
    const id = `${operationId}:${recovered.itemId}`;
    state.kitHolds!.push({ ...recovered, id, assemblyId: assembly.id, receiptId: operationId,
      warehouseId: data.warehouseId, reason: data.components.find(c => c.itemId === recovered.itemId)!.reason,
      status: "held", actor, occurredAt: now });
    moveKitProvenance(state, data.warehouseId, [recovered], -1,
      { from: { kind: "assembly", id: assembly.id }, to: { kind: "hold", id } });
  }
  for (const lost of missing) moveKitProvenance(state, data.warehouseId, [lost], -1,
    { from: { kind: "assembly", id: assembly.id }, to: { kind: "retired", id: operationId } });
  state.receipts.push({ id: operationId, action: "disassemble", reference: assembly.itemId, warehouseId: data.warehouseId,
    lines: [output], components: usable, actor, occurredAt: now, reason: data.reason,
    kitConversion: { assemblyId: assembly.id, recovered: data.components } });
}

export function applyKitHoldResolution(state: InventoryState, raw: unknown, operationId: string, actor: string, now: string, hooks: Hooks) {
  const data = z.object({ id: identifier.max(250), outcome: z.enum(["released", "scrapped"]),
    reason: z.string().trim().min(1).max(1000) }).strict().parse(raw);
  const hold = state.kitHolds!.find(h => h.id === data.id);
  fail(hold?.status === "held", "Choose an open kit component inspection hold.");
  hooks.access(hold.warehouseId);
  hold.status = data.outcome; hold.resolution = { operationId, actor, occurredAt: now, reason: data.reason };
  if (data.outcome === "released") {
    state.serialOccupancy = (state.serialOccupancy ?? []).filter(o => o.itemId !== hold.itemId || !hold.serials.includes(o.serial));
    hooks.move(hold.warehouseId, [line(hold.itemId, hold.quantity, hold.serials)], 1, { from: { kind: "hold", id: hold.id } });
  } else moveKitProvenance(state, hold.warehouseId, [hold], -1,
    { from: { kind: "hold", id: hold.id }, to: { kind: "retired", id: operationId } });
  state.receipts.push({ id: operationId, action: "resolveKitHold", reference: hold.itemId, warehouseId: hold.warehouseId,
    lines: data.outcome === "released" ? [line(hold.itemId, hold.quantity, hold.serials)] : [], actor, occurredAt: now,
    reason: data.reason, kitHoldId: hold.id, kitInspection: line(hold.itemId, hold.quantity, [...hold.serials]), resolution: data.outcome });
}
