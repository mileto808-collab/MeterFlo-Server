import { z } from "zod";
import { COUNT_MAX_LINES, COUNT_MAX_SERIALS, countPayloadFits } from "./inventory-count-limits";
import { allocationSchema, dispositionSchema, itemSchema, stockLineSchema, vendorSchema, warehouseSchema, countDraftSchema,
  type Allocation, type InventoryCommand, type InventoryState, type StockLine, type Stock } from "./inventory";

export class InventoryError extends Error { status = 409; }
const assert: (ok: unknown, message: string) => asserts ok = (ok, message) => { if (!ok) throw new InventoryError(message); };
const lines = z.array(stockLineSchema).min(1).max(500);
const allocations = z.array(allocationSchema).max(500);
const identifier = z.string().min(1).max(100);
const workId = z.number().int().positive();
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
export const canonicalInventoryJson = (value: unknown): string => JSON.stringify(value, (_key, v) =>
  v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(key => [key, v[key]])) : v);
export function reserved(s: InventoryState, warehouseId: string, itemId: string, except?: number) {
  return s.allocations.filter(a => a.status === "reserved" && a.workOrderId !== except)
    .flatMap(a => a.lines).filter(l => l.warehouseId === warehouseId && l.itemId === itemId)
    .reduce((n, l) => n + l.quantity, 0);
}
export function warehouseAccess(s: InventoryState, id: string, actor: string, admin: boolean) {
  const w = s.warehouses.find(w => w.id === id);
  assert(w && w.active, "Choose an active warehouse in this project.");
  assert(admin || w.assignedUserId === actor || w.userIds.includes(actor), "Warehouse access required.");
  return w;
}
function item(s: InventoryState, id: string) {
  const i = s.items.find(i => i.id === id); assert(i && i.active, "Choose an active item in this project."); return i;
}
function validateLines(s: InventoryState, input: StockLine[]) {
  const ids = new Set<string>();
  for (const l of input) {
    const i = item(s, l.itemId);
    assert(!ids.has(l.itemId), "Combine duplicate item lines."); ids.add(l.itemId);
    assert(i.tracking === "serialized" ? l.serials.length === l.quantity : l.serials.length === 0, "Serialized quantities must match scanned serials; regular items use quantities.");
    assert(new Set(l.serials).size === l.serials.length, "Duplicate serial scanned.");
  }
}
function balance(s: InventoryState, warehouseId: string, itemId: string): Stock {
  let b = s.stock.find(b => b.warehouseId === warehouseId && b.itemId === itemId);
  if (!b) { b = { warehouseId, itemId, quantity: 0, serials: [], revision: 0 }; s.stock.push(b); }
  return b;
}
// Historical allocations remain immutable evidence, not permanent ownership.
function serialFootprint(s: InventoryState, input: StockLine[], ancestors: string[] = []): { itemId: string; serial: string }[] {
  return input.flatMap(l => l.serials.flatMap(serial => {
    const contents = !ancestors.includes(l.itemId) && s.items.find(i => i.id === l.itemId)?.components.length
      ? [...s.receipts].reverse().find(r => r.action === "assemble" && r.lines.some(x => x.itemId === l.itemId && x.serials.includes(serial)))?.components : undefined;
    return [{ itemId: l.itemId, serial }, ...(contents ? serialFootprint(s, contents, [...ancestors, l.itemId]) : [])];
  }));
}
function ensureSerialOccupancy(s: InventoryState) {
  if (s.serialOccupancy) return;
  s.serialOccupancy = [];
  for (const a of s.allocations.filter(a => a.status === "consumed" || a.status === "released" && a.used.length)) occupy(s, a.used, a.workOrderId);
  for (const b of s.stock.filter(b => s.items.find(i => i.id === b.itemId)?.components.length)) {
    const children = serialFootprint(s, [b]).filter(x => x.itemId !== b.itemId);
    for (const x of children) s.serialOccupancy.push({ ...x, workOrderId: null });
  }
  s.serialOccupancy = s.serialOccupancy.filter(x =>
    !s.stock.some(b => b.itemId === x.itemId && b.serials.includes(x.serial)) &&
    !s.returns.some(r => r.serial === x.serial && r.status !== "released" && s.items.find(i => i.id === x.itemId)?.equipment === r.equipment));
}
function occupy(s: InventoryState, input: StockLine[], workOrderId: number | null) {
  for (const x of serialFootprint(s, input)) {
    s.serialOccupancy = (s.serialOccupancy || []).filter(o => o.itemId !== x.itemId || o.serial !== x.serial);
    s.serialOccupancy.push({ ...x, workOrderId });
  }
}
function move(s: InventoryState, warehouseId: string, input: StockLine[], sign: 1 | -1, except?: number) {
  validateLines(s, input);
  for (const l of input) {
    const b = balance(s, warehouseId, l.itemId);
    if (sign < 0) {
      assert(b.quantity - reserved(s, warehouseId, l.itemId, except) >= l.quantity, "Insufficient available stock.");
      const held = s.allocations.filter(a => a.status === "reserved" && a.workOrderId !== except).flatMap(a => a.lines)
        .filter(a => a.warehouseId === warehouseId && a.itemId === l.itemId).flatMap(a => a.serials);
      assert(l.serials.every(x => b.serials.includes(x) && !held.includes(x)), "Serial unavailable or reserved elsewhere.");
      b.serials = b.serials.filter(x => !l.serials.includes(x));
    } else {
      for (const serial of l.serials) {
        assert(!s.stock.some(b => b.itemId === l.itemId && b.serials.includes(serial)), "Serial already in inventory.");
        assert(!s.orders.some(o => o.type === "transfer" && o.dispatched.some(x => x.itemId === l.itemId && x.serials.includes(serial)) &&
          !o.received.some(x => x.itemId === l.itemId && x.serials.includes(serial))), "Serial is in transit.");
        assert(!s.serialOccupancy?.some(x => x.itemId === l.itemId && x.serial === serial),
          "Serial already installed or contained in an assembled kit.");
        assert(!s.returns.some(r => r.serial === serial && r.status !== "released"), "Serial is pending return/condition review.");
      }
      b.serials.push(...l.serials);
    }
    b.quantity += sign * l.quantity; b.revision++;
  }
}
function totals(input: StockLine[], itemId: string) { return input.filter(l => l.itemId === itemId).reduce((n, l) => n + l.quantity, 0); }
function within(input: StockLine[], expected: StockLine[], prior: StockLine[]) {
  for (const l of input) {
    const e = expected.find(e => e.itemId === l.itemId);
    assert(e && totals(prior, l.itemId) + l.quantity <= e.quantity, "Quantity exceeds remaining order quantity.");
    assert(l.serials.every(x => (!e.serials.length || e.serials.includes(x)) && !prior.some(p => p.itemId === l.itemId && p.serials.includes(x))), "Unexpected or previously received serial.");
  }
}
function kitCycles(s: InventoryState) {
  const visit = (id: string, ancestors: string[]) => {
    assert(!ancestors.includes(id), "Kit components cannot contain a cycle.");
    const i = s.items.find(i => i.id === id); assert(i, "Kit component not found.");
    for (const c of i.components) visit(c.itemId, [...ancestors, id]);
  };
  for (const i of s.items) visit(i.id, []);
}
export function applyInventoryCommand(original: InventoryState, command: InventoryCommand, actor: string, admin: boolean, now = new Date().toISOString()) {
  if (command.action === "countSaveDraft" || command.action === "countPost")
    assert(countPayloadFits(command.data), "Count data exceeds the 8 MiB limit; no changes were posted.");
  const fingerprint = canonicalInventoryJson({ action: command.action, data: command.data, actor });
  if (original.operations[command.operationId]) {
    assert(original.operations[command.operationId] === fingerprint, "Posting identifier was already used for a different operation.");
    return { state: original, replay: true };
  }
  const s = structuredClone(original), d = command.data;
  ensureSerialOccupancy(s);
  const access = (id: string) => warehouseAccess(s, id, actor, admin);
  const receipt = (reference: string, warehouseId: string | null, input: StockLine[], reason?: string, components?: StockLine[]) =>
    s.receipts.push({ id: command.operationId, action: command.action, reference, warehouseId, lines: input, actor, occurredAt: now, reason, components });
  const a = command.action;
  if (a === "warehouse" || a === "vendor" || a === "item") {
    const value = a === "warehouse" ? warehouseSchema.parse(d) : a === "vendor" ? vendorSchema.parse(d) : itemSchema.parse(d);
    const list = (a === "warehouse" ? s.warehouses : a === "vendor" ? s.vendors : s.items) as any[];
    const old = list.find(x => x.id === value.id);
    if (a === "warehouse") {
      assert(!s.warehouses.some(w => w.id !== value.id && w.code.toLowerCase() === (value as any).code.toLowerCase()), "Warehouse code already exists.");
      if (old) access(old.id);
      if (!(value as any).active) assert(!s.stock.some(b => b.warehouseId === value.id && b.quantity) &&
        !s.orders.some(o => [o.sourceId, o.destinationId].includes(value.id) && !["completed", "cancelled"].includes(o.status)) &&
        !s.returns.some(r => r.warehouseId === value.id && r.status !== "released"), "Warehouse has stock or unresolved operations.");
    }
    if (a === "item") {
      const i = value as any;
      assert(!s.items.some(x => x.id !== i.id && x.sku.toLowerCase() === i.sku.toLowerCase()), "SKU already exists.");
      assert(!i.vendorId || s.vendors.some(v => v.id === i.vendorId && v.active), "Vendor is not active in this project.");
      if (!i.active) assert(!s.stock.some(b => b.itemId === i.id && b.quantity) &&
        !s.orders.some(o => !["completed", "cancelled"].includes(o.status) && o.lines.some(l => l.itemId === i.id)) &&
        !s.allocations.some(a => a.status === "reserved" && a.lines.some(l => l.itemId === i.id)), "Item has stock, reservations or open orders.");
      if (old) assert(old.tracking === i.tracking && same(old.components, i.components) ||
        !s.stock.some(b => b.itemId === i.id && b.quantity) && !s.allocations.some(x => x.lines.some(l => l.itemId === i.id)), "Cannot change tracking or kit definition for stock/assigned items.");
    }
    if (old) list[list.indexOf(old)] = value; else list.push(value);
    if (a === "item") kitCycles(s);
  } else if (a === "order") {
    const o = z.object({ id: identifier, type: z.enum(["purchase", "transfer"]), destinationId: identifier,
      sourceId: identifier.nullable().default(null), vendorId: identifier.nullable().default(null),
      lines, notes: z.string().max(2000).default("") }).strict().parse(d);
    access(o.destinationId);
    assert(o.type === "purchase" ? s.vendors.some(v => v.id === o.vendorId && v.active) :
      o.sourceId && o.sourceId !== o.destinationId, "Select a vendor or distinct source warehouse.");
    if (o.sourceId) assert(s.warehouses.some(w => w.id === o.sourceId && w.active), "Choose an active source warehouse in this project.");
    assert(o.type === "transfer" ? !o.vendorId : !o.sourceId, "Purchase orders use a vendor; transfers use a source warehouse.");
    // Purchase quantities need not have known serials until receiving.
    if (o.type === "transfer") validateLines(s, o.lines);
    else {
      assert(new Set(o.lines.map(l => l.itemId)).size === o.lines.length, "Combine duplicate item lines.");
      for (const l of o.lines) { item(s, l.itemId); assert(!l.serials.length, "Scan purchase serials when receiving."); }
    }
    const old = s.orders.find(x => x.id === o.id); assert(!old || old.status === "draft", "Only draft orders are editable.");
    if (old) s.orders[s.orders.indexOf(old)] = { ...old, ...o };
    else s.orders.push({ ...o, received: [], dispatched: [], status: "draft", createdAt: now });
  } else if (["release", "cancel", "receive", "dispatch", "accept"].includes(a)) {
    const orderId = identifier.parse(d.orderId), o = s.orders.find(o => o.id === orderId);
    assert(o, "Order not found.");
    if (a === "dispatch" || a === "release" && o.type === "transfer") access(o.sourceId!);
    else access(o.destinationId);
    if (a === "release") { assert(o.status === "draft", "Only draft orders can be released."); o.status = "released"; }
    else if (a === "cancel") {
      assert(!["cancelled", "completed"].includes(o.status), "Order is already closed.");
      assert(o.dispatched.every(l => totals(o.received, l.itemId) >= totals(o.dispatched, l.itemId)), "Receive dispatched stock before cancelling remaining quantities.");
      o.status = "cancelled";
    } else {
      assert(["released", "partial"].includes(o.status), "Release an open order before posting.");
      const input = lines.parse(d.lines); validateLines(s, input);
      if (a === "receive") {
        assert(o.type === "purchase", "Purchase order required."); within(input, o.lines, o.received);
        move(s, o.destinationId, input, 1); o.received.push(...input);
      } else if (a === "dispatch") {
        assert(o.type === "transfer" && o.sourceId, "Transfer order required."); within(input, o.lines, o.dispatched);
        move(s, o.sourceId, input, -1); o.dispatched.push(...input);
      } else {
        assert(o.type === "transfer", "Transfer order required.");
        // Collapse dispatched lines to remaining expected identity/quantity.
        const dispatched = o.lines.map(l => ({ ...l, quantity: totals(o.dispatched, l.itemId),
          serials: o.dispatched.filter(x => x.itemId === l.itemId).flatMap(x => x.serials) }));
        within(input, dispatched, o.received); o.received.push(...input); move(s, o.destinationId, input, 1);
      }
      o.status = o.lines.every(l => totals(o.received, l.itemId) === l.quantity) ? "completed" : "partial";
      receipt(o.id, a === "dispatch" ? o.sourceId : o.destinationId, input, typeof d.reason === "string" ? d.reason.slice(0, 1000) : "");
    }
  } else if (a === "assign") {
    const { workOrderId, lines: input } = z.object({ workOrderId: workId, lines: allocations }).strict().parse(d);
    const old = s.allocations.find(a => a.workOrderId === workOrderId);
    assert(!old || old.status !== "consumed", "Reconcile completed stock before changing assignments.");
    const groups = new Map<string, StockLine[]>();
    for (const l of input) { access(l.warehouseId); groups.set(l.warehouseId, [...(groups.get(l.warehouseId) || []), l]); }
    // Test availability without altering the balances.
    const trial = structuredClone(s);
    for (const [w, ls] of groups) move(trial, w, ls, -1, workOrderId);
    const value = { workOrderId, lines: input, used: [], dispositions: [], mode: null, status: "reserved" as const, revision: (old?.revision || 0) + 1 };
    if (old) s.allocations[s.allocations.indexOf(old)] = value; else s.allocations.push(value);
  } else if (a === "prepareUse") {
    const input = z.object({ workOrderId: workId, revision: z.number().int(), mode: z.enum(["changeout", "reading_only"]),
      used: allocations, dispositions: z.array(dispositionSchema).max(2) }).strict().parse(d);
    const allocation = s.allocations.find(a => a.workOrderId === input.workOrderId);
    assert(allocation && allocation.status === "reserved" && allocation.revision === input.revision, "Assignments changed; refresh work-order items.");
    for (const l of allocation.lines) access(l.warehouseId);
    const keys = input.used.map(l => `${l.warehouseId}/${l.itemId}`);
    assert(new Set(keys).size === keys.length, "Combine duplicate used-item lines.");
    assert(input.mode !== "reading_only" || !input.used.length && !input.dispositions.length, "Reading-only work cannot consume replacement stock.");
    for (const l of input.used) {
      validateLines(s, [l]);
      const assigned = allocation.lines.find(x => x.warehouseId === l.warehouseId && x.itemId === l.itemId);
      assert(assigned && l.quantity <= assigned.quantity && l.serials.every(x => assigned.serials.includes(x)), "Used items must be reserved on this work order.");
    }
    assert(new Set(input.dispositions.map(x => x.equipment)).size === input.dispositions.length, "Only one disposition per removed equipment type.");
    for (const r of input.dispositions) if (r.disposition === "returned") { assert(r.warehouseId, "Choose a return warehouse."); access(r.warehouseId); }
    allocation.used = input.used; allocation.dispositions = input.dispositions; allocation.mode = input.mode;
  } else if (a === "assemble") {
    const { warehouseId, itemId, quantity, serials, components } = z.object({ warehouseId: identifier, itemId: identifier,
      quantity: z.number().int().positive().max(1000000), serials: z.array(identifier).default([]), components: lines }).strict().parse(d);
    access(warehouseId); const kit = item(s, itemId); assert(kit.components.length, "Select a kit item.");
    if (components.some(c => c.serials.length))
      assert(kit.tracking === "serialized" && quantity === 1, "Kits containing serialized units require a kit serial and one-kit-at-a-time assembly for traceability.");
    assert(components.length === kit.components.length && kit.components.every(c => totals(components, c.itemId) === c.quantity * quantity), "Scanned components must match the kit definition.");
    move(s, warehouseId, components, -1);
    const output = [{ itemId, quantity, serials }]; move(s, warehouseId, output, 1);
    receipt(itemId, warehouseId, output, "Kit assembly", components);
    occupy(s, components, null);
  } else if (a === "countStart") {
    const { id, warehouseId } = z.object({ id: identifier, warehouseId: identifier }).strict().parse(d);
    access(warehouseId); assert(!s.counts.some(c => c.id === id), "Count identifier already exists.");
    assert(s.stock.filter(b => b.warehouseId === warehouseId).length <= COUNT_MAX_LINES,
      `This warehouse exceeds the ${COUNT_MAX_LINES}-item complete-count limit; no items were omitted.`);
    s.counts.push({ id, warehouseId, snapshot: structuredClone(s.stock.filter(b => b.warehouseId === warehouseId)), status: "open" });
  } else if (a === "countSaveDraft") {
    const { id, ...draft } = countDraftSchema.extend({ id: identifier }).parse(d);
    const c = s.counts.find(c => c.id === id); assert(c && c.status === "open", "Open count required."); access(c.warehouseId);
    assert(draft.revision === (c.draft?.revision ?? 0), "Count draft changed. Reload saved draft before saving or posting.");
    assert(new Set(draft.rows.map(row => row.itemId)).size === draft.rows.length, "Duplicate draft item.");
    assert(draft.rows.every(row => s.items.some(item => item.id === row.itemId)), "Draft item is not in this project.");
    const savedDraft = { ...draft, revision: draft.revision + 1, savedBy: actor, savedAt: now };
    assert(countPayloadFits(savedDraft), "Saved count draft exceeds the 8 MiB limit; no changes were saved.");
    c.draft = savedDraft;
  } else if (a === "countCancel") {
    const { id, reason } = z.object({ id: identifier, reason: z.string().trim().min(1).max(1000) }).strict().parse(d);
    const c = s.counts.find(c => c.id === id); assert(c && c.status === "open", "Open count required."); access(c.warehouseId);
    c.status = "cancelled"; c.reason = reason; delete c.draft;
  } else if (a === "countPost") {
    const { id, lines: input, reason, draftRevision } = z.object({ id: identifier, draftRevision: z.number().int().nonnegative().optional(), lines: z.array(stockLineSchema.extend({ quantity: z.number().int().nonnegative().max(1000000) })).max(COUNT_MAX_LINES),
      reason: z.string().trim().min(1).max(1000) }).strict().parse(d);
    const c = s.counts.find(c => c.id === id); assert(c && c.status === "open", "Open count required."); access(c.warehouseId);
    assert(!c.draft && draftRevision === undefined || (draftRevision ?? 0) === (c.draft?.revision ?? 0),
      "Count draft changed. Reload saved draft before saving or posting.");
    assert(same(c.snapshot, s.stock.filter(b => b.warehouseId === c.warehouseId)), "Stock moved since counting began; start a new count.");
    assert(input.reduce((sum, line) => sum + line.serials.length, 0) <= COUNT_MAX_SERIALS,
      `Count exceeds the ${COUNT_MAX_SERIALS}-serial complete-count limit; no changes were posted.`);
    validateLines(s, input);
    const submittedIds = new Set(input.map(line => line.itemId));
    assert(c.snapshot.every(b => submittedIds.has(b.itemId)), "Enter every item in this warehouse count, including zero quantities.");
    for (const l of input) {
      const b = balance(s, c.warehouseId, l.itemId);
      assert(l.quantity >= reserved(s, c.warehouseId, l.itemId), "Count would remove reserved stock; reconcile assignments first.");
      const removed = b.serials.filter(x => !l.serials.includes(x)), added = l.serials.filter(x => !b.serials.includes(x));
      const delta = l.quantity - b.quantity;
      if (item(s, l.itemId).tracking === "serialized") {
        if (removed.length) move(s, c.warehouseId, [{ itemId: l.itemId, quantity: removed.length, serials: removed }], -1);
        if (added.length) move(s, c.warehouseId, [{ itemId: l.itemId, quantity: added.length, serials: added }], 1);
      } else if (delta) move(s, c.warehouseId, [{ ...l, quantity: Math.abs(delta) }], delta > 0 ? 1 : -1);
    }
    c.status = "posted"; c.reason = reason; c.lines = input; delete c.draft; receipt(c.id, c.warehouseId, input, reason);
  } else if (a === "reconcileWorkOrder") {
    const input = z.object({ workOrderId: workId, reason: z.string().trim().min(1).max(1000),
      restoreUsedStock: z.boolean() }).strict().parse(d);
    const allocation = s.allocations.find(x => x.workOrderId === input.workOrderId);
    assert(allocation && allocation.status === "consumed", "Only consumed work-order inventory can be reconciled.");
    assert(!s.returns.some(r => r.workOrderId === input.workOrderId && r.status !== "pending"), "Reconcile accepted returns before reversing this work order.");
    for (const l of allocation.used) access(l.warehouseId);
    if (input.restoreUsedStock) {
      const used = structuredClone(allocation.used);
      allocation.status = "released"; allocation.used = [];
      const groups = new Map<string, StockLine[]>();
      for (const l of used) groups.set(l.warehouseId, [...(groups.get(l.warehouseId) || []), l]);
      s.serialOccupancy = s.serialOccupancy!.filter(x => x.workOrderId !== input.workOrderId);
      for (const [w, ls] of groups) move(s, w, ls, 1);
      for (const l of used.filter(l => s.items.find(i => i.id === l.itemId)?.components.length)) {
        for (const x of serialFootprint(s, [l]).filter(x => x.itemId !== l.itemId)) s.serialOccupancy!.push({ ...x, workOrderId: null });
      }
      receipt(`work-order-${input.workOrderId}`, null, used, input.reason);
    } else { allocation.status = "released"; receipt(`work-order-${input.workOrderId}`, null, [], input.reason); }
    allocation.lines = []; allocation.mode = null;
    s.returns = s.returns.filter(r => r.workOrderId !== input.workOrderId);
  } else if (a === "returnAccept" || a === "returnRelease") {
    const r = s.returns.find(r => r.id === identifier.parse(d.id)); assert(r && r.warehouseId, "Return not found."); access(r.warehouseId);
    if (a === "returnAccept") { assert(r.status === "pending", "Return already accepted."); r.status = "quarantine"; receipt(r.id, r.warehouseId, [], "Removed equipment accepted into quarantine"); }
    else {
      const reason = z.string().trim().min(1).max(1000).parse(d.reason), itemId = identifier.parse(d.itemId);
      assert(r.status === "quarantine", "Accept and inspect returned equipment first.");
      assert(item(s, itemId).tracking === "serialized" && item(s, itemId).equipment === r.equipment, "Select matching serialized equipment.");
      r.status = "released"; r.itemId = itemId;
      const input = [{ itemId, quantity: 1, serials: [r.serial] }];
      move(s, r.warehouseId, input, 1); receipt(r.id, r.warehouseId, input, reason);
    }
  }
  s.operations[command.operationId] = fingerprint; s.revision++;
  return { state: s, replay: false };
}

// Called inside the same database transaction as the work-order status update.
export function completeInventoryWorkOrder(original: InventoryState, workOrderId: number, readingOnly: boolean) {
  const s = structuredClone(original), a = s.allocations.find(a => a.workOrderId === workOrderId);
  ensureSerialOccupancy(s);
  assert(a && a.mode, "Review inventory use and removed-equipment disposition before completing this work order.");
  if (a.status === "consumed" || a.status === "released") return original;
  assert(!readingOnly || a.mode === "reading_only", "This project only permits reading-only work.");
  if (a.mode === "changeout") {
    const groups = new Map<string, Allocation[]>();
    for (const l of a.used) groups.set(l.warehouseId, [...(groups.get(l.warehouseId) || []), l]);
    for (const [w, ls] of groups) move(s, w, ls, -1, workOrderId);
    for (const d of a.dispositions) s.serialOccupancy = s.serialOccupancy!.filter(x =>
      x.serial !== d.serial || s.items.find(i => i.id === x.itemId)?.equipment !== d.equipment);
    occupy(s, a.used, workOrderId);
    for (const r of a.dispositions) s.returns.push({ ...r, id: `wo-${workOrderId}-${r.equipment}-${a.revision}`, workOrderId, status: "pending" });
    a.status = "consumed";
  } else a.status = "released";
  s.revision++; return s;
}
