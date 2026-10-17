import { z } from "zod";
import { requirementsSatisfied } from "./inventory-requirements";
import { itemDeletionBlockers, categoryDeletionBlockers } from "./inventory-deletion";
import { normalizeInventoryCategories, inventoryCategoryLabels } from "./inventory-categories";
import { allocateOrderNumber, uuidOrderId } from "./inventory-order-labels";
import { COUNT_MAX_LINES, COUNT_MAX_SERIALS, countPayloadFits } from "./inventory-count-limits";
import { countStockScopeMatches } from "./inventory-count-stock";
import { normalizeInventoryLocations, warehouseAccessible, resolveWarehouseInput, applyLocationTypeCommand } from "./inventory-location-types";
import { allocationSchema, dispositionSchema, itemSchema, stockLineSchema, vendorSchema, warehouseSchema, countDraftSchema,
  categoryNameSchema, categoryKey, inventoryCategoryNames,
  type Allocation, type InventoryCommand, type InventoryState, type StockLine, type Stock } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { applyShipmentCommand, assertNotHeld, shipmentActions } from "./inventory-shipment-engine";
import { settledLines } from "./inventory-shipment-model";
import { applyShipmentDraftCommand, isShipmentDraftAction, validateDraftPosting, draftFingerprintCommand, validateDraftReplay } from "./inventory-shipment-drafts";
import { ensureKitProvenance, kitSerialContents, moveKitProvenance, recordKitAssembly, remainingKitHold,
  applyKitDisassembly, applyKitHoldResolution, vendorKitSchema, vendorKitSource, type KitFlow } from "./inventory-kits";

export { InventoryError } from "./inventory-errors";
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
  assert(warehouseAccessible(s, w, actor, admin), "Warehouse access required.");
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
    const contents = !ancestors.includes(l.itemId) ? kitSerialContents(s, l.itemId, serial) : undefined;
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
function move(s: InventoryState, warehouseId: string, input: StockLine[], sign: 1 | -1, except?: number, flow?: KitFlow) {
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
        assertNotHeld(s, l.itemId, serial);
        assert(!(s.kitHolds ?? []).some(h => h.status === "held" && h.itemId === l.itemId && remainingKitHold(h).serials.includes(serial)),
          "Serial is held for kit component inspection.");
        assert(!s.stock.some(b => b.itemId === l.itemId && b.serials.includes(serial)), "Serial already in inventory.");
        assert(!s.orders.some(o => o.type === "transfer" && o.dispatched.some(x => x.itemId === l.itemId && x.serials.includes(serial)) &&
          !settledLines(o).some(x => x.itemId === l.itemId && x.serials.includes(serial))), "Serial is in transit.");
        assert(!s.serialOccupancy?.some(x => x.itemId === l.itemId && x.serial === serial),
          "Serial already installed, contained in an assembled kit, or unavailable due to loss/disposal.");
        assert(!s.returns.some(r => r.serial === serial && r.status !== "released"), "Serial is pending return/condition review.");
      }
      b.serials.push(...l.serials);
    }
    b.quantity += sign * l.quantity; b.revision++;
  }
  moveKitProvenance(s, warehouseId, input, sign, flow);
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
export function applyInventoryCommand(original: InventoryState, command: InventoryCommand, actor: string, admin: boolean, now = new Date().toISOString(), capabilities: { manageLocations?: boolean } = {}) {
  if (shipmentActions.includes(command.action) || ["assemble", "verifyVendorKit", "disassemble", "resolveKitHold"].includes(command.action))
    assert(new TextEncoder().encode(JSON.stringify(command.data)).length <= 8 * 1024 * 1024, "Shipment data exceeds the 8 MiB limit; no changes were posted.");
  if (command.action === "countSaveDraft" || command.action === "countPost")
    assert(countPayloadFits(command.data), "Count data exceeds the 8 MiB limit; no changes were posted.");
  const fingerprint = canonicalInventoryJson({ action: command.action,
    data: isShipmentDraftAction(command.action) ? draftFingerprintCommand(command) : command.data, actor });
  if (original.operations[command.operationId]) {
    assert(original.operations[command.operationId] === fingerprint, "Posting identifier was already used for a different operation.");
    if (isShipmentDraftAction(command.action)) validateDraftReplay(original, command, actor, canonicalInventoryJson);
    return { state: original, replay: true };
  }
  const s = normalizeInventoryLocations(inventoryCategoryLabels(normalizeInventoryCategories(original))), d = command.data;
  ensureKitProvenance(s);
  ensureSerialOccupancy(s);
  const access = (id: string) => warehouseAccess(s, id, actor, admin);
  const receipt = (reference: string, warehouseId: string | null, input: StockLine[], reason?: string, components?: StockLine[]) =>
    s.receipts.push({ id: command.operationId, action: command.action, reference, warehouseId, lines: input, actor, occurredAt: now, reason, components });
  const a = command.action;
  if (isShipmentDraftAction(a)) {
    applyShipmentDraftCommand(s, command, actor, now, access, admin);
    assert(new TextEncoder().encode(JSON.stringify(s.shipmentDrafts)).length <= 32 * 1024 * 1024,
      "Saved shipment drafts exceed the project's 32 MiB limit. Finish or discard older drafts first.");
  } else if (shipmentActions.includes(a)) {
    const posting = validateDraftPosting(s, command, actor, canonicalInventoryJson);
    const flow: KitFlow = a === "dispatch" ? { to: { kind: "transit", id: String(d.orderId) } } :
      a === "accept" ? { from: { kind: "transit", id: String(d.orderId) } } :
      a === "resolveHold" ? { from: { kind: "hold", id: String(d.id) } } : {};
    applyShipmentCommand(s, posting, actor, now, { access, move: (w, ls, sign) => move(s, w, ls, sign, undefined, flow),
      validate: ls => validateLines(s, ls), within });
    for (const hold of (s.shipmentHolds ?? []).filter(h => h.receiptId === command.operationId)) {
      if (a === "accept") moveKitProvenance(s, hold.warehouseId,
        [{ itemId: hold.itemId, quantity: hold.quantity, serials: [...hold.serials, ...hold.expectedSerials] }], -1,
        { from: { kind: "transit", id: hold.orderId }, to: { kind: "hold", id: hold.id } });
    }
    if (a === "resolveTransit") {
      const r = s.receipts.find(r => r.id === command.operationId);
      if (r) moveKitProvenance(s, r.warehouseId ?? "", r.lines, -1,
        { from: { kind: "transit", id: String(d.orderId) }, to: { kind: "retired", id: command.operationId } });
    }
    if (a === "resolveHold") {
      const r = s.receipts.find(r => r.id === command.operationId), disposition = r?.holdDisposition;
      if (disposition && disposition.outcome !== "released") {
        const hold = s.shipmentHolds!.find(h => h.id === d.id)!;
        moveKitProvenance(s, hold.warehouseId, [{ itemId: hold.itemId, quantity: disposition.quantity,
          serials: [...disposition.serials, ...disposition.expectedSerials] }], -1,
          { from: { kind: "hold", id: hold.id }, to: { kind: "retired", id: command.operationId } });
      }
    }
  } else if (a === "locationType" || a === "locationTypeDelete") {
    applyLocationTypeCommand(s, a, d);
    // Changing kind must not leave any existing location invalid.
    if (a === "locationType") for (const warehouse of s.warehouses.filter(warehouse => warehouse.locationTypeId === d.id))
      warehouseSchema.parse(warehouse);
  } else if (a === "itemDelete" || a === "categoryDelete") {
    const { id } = z.object({ id: z.string().min(1).max(100) }).strict().parse(d);
    const blockers = a === "itemDelete" ? itemDeletionBlockers(s, id) : categoryDeletionBlockers(s, id);
    assert(!blockers.length, `Cannot delete: ${blockers.join(" ")}`);
    if (a === "itemDelete") {
      s.items = s.items.filter(item => item.id !== id);
      s.stock = s.stock.filter(stock => stock.itemId !== id);
    } else s.categoryCatalog = s.categoryCatalog!.filter(category => category.id !== id);
  } else if (a === "category") {
    const name = categoryNameSchema.parse(d.name);
    assert(!inventoryCategoryNames(s).some(existing => categoryKey(existing) === categoryKey(name)), "Category already exists in this project.");
    s.categoryCatalog!.push({ id: command.operationId, name, active: true });
  } else if (a === "categoryRename") {
    const { id, newName } = z.object({ id: z.string().uuid(), newName: categoryNameSchema }).strict().parse(d);
    const category = s.categoryCatalog!.find(existing => existing.id === id);
    assert(category, "Category no longer exists. Refresh the category list and try again.");
    assert(!s.categoryCatalog!.some(existing => existing.id !== id && categoryKey(existing.name) === categoryKey(newName)),
      "Category already exists in this project. Choose a different name.");
    category.name = newName;
  } else if (a === "warehouse" || a === "vendor" || a === "item") {
    const value = a === "warehouse" ? warehouseSchema.parse(resolveWarehouseInput(s, d)) : a === "vendor" ? vendorSchema.parse(d) : itemSchema.parse(d);
    const list = (a === "warehouse" ? s.warehouses : a === "vendor" ? s.vendors : s.items) as any[];
    const old = list.find(x => x.id === value.id);
    if (a === "warehouse") {
      assert(!s.warehouses.some(w => w.id !== value.id && w.code.toLowerCase() === (value as any).code.toLowerCase()), "Warehouse code already exists.");
      if (old && !capabilities.manageLocations) access(old.id);
      if (!(value as any).active) assert(!s.stock.some(b => b.warehouseId === value.id && b.quantity) &&
        !(s.kitHolds ?? []).some(h => h.warehouseId === value.id && h.status === "held") &&
        !(s.shipmentHolds ?? []).some(h => h.warehouseId === value.id && h.status === "held") &&
        !s.orders.some(o => [o.sourceId, o.destinationId].includes(value.id) && !["completed", "cancelled", "closed"].includes(o.status)) &&
        !s.returns.some(r => r.warehouseId === value.id && r.status !== "released") &&
        !(s.shipmentDrafts ?? []).some(draft => s.orders.some(order => order.id === draft.orderId &&
          (draft.stage === "dispatch" ? order.sourceId : order.destinationId) === value.id)),
        "Warehouse has stock or unresolved operations, including saved shipment drafts. Finish or discard them first.");
    }
    if (a === "item") {
      const i = value as any;
      // New clients submit an ID; accept names only from older clients that omit it.
      const category = i.categoryId === undefined
        ? s.categoryCatalog!.find(c => categoryKey(c.name) === categoryKey(i.category))
        : s.categoryCatalog!.find(c => c.id === i.categoryId);
      if (i.categoryId || i.categoryId === undefined && i.category.trim()) {
        assert(category, "Choose an existing category from this project, or None.");
        assert(category.active || old?.categoryId === category.id, "Choose an active category from this project.");
        i.categoryId = category.id;
        i.category = category.name;
      } else { i.categoryId = null; i.category = ""; }
      assert(!s.items.some(x => x.id !== i.id && x.sku.toLowerCase() === i.sku.toLowerCase()), "SKU already exists.");
      assert(!i.vendorId || s.vendors.some(v => v.id === i.vendorId && v.active), "Vendor is not active in this project.");
      if (!i.active) assert(!s.stock.some(b => b.itemId === i.id && b.quantity) &&
        !(s.kitHolds ?? []).some(h => h.itemId === i.id && h.status === "held") &&
        !(s.shipmentHolds ?? []).some(h => h.itemId === i.id && h.status === "held") &&
        !s.orders.some(o => !["completed", "cancelled", "closed"].includes(o.status) && o.lines.some(l => l.itemId === i.id)) &&
        !s.allocations.some(a => a.status === "reserved" && a.lines.some(l => l.itemId === i.id)), "Item has stock, reservations or open orders.");
      if (old) assert(old.tracking === i.tracking && same(old.components, i.components) ||
        !(s.kitHolds ?? []).some(h => h.itemId === i.id && h.status === "held") &&
        !(s.shipmentHolds ?? []).some(h => h.itemId === i.id && h.status === "held") &&
        !s.orders.some(o => !["completed", "cancelled", "closed"].includes(o.status) && o.lines.some(l => l.itemId === i.id)) &&
        !s.stock.some(b => b.itemId === i.id && b.quantity) && !s.allocations.some(x => x.lines.some(l => l.itemId === i.id)), "Cannot change tracking or kit definition for stock/assigned items.");
      if (old && old.tracking !== i.tracking) assert(
        !s.serialOccupancy!.some(o => o.itemId === i.id) &&
        !s.kitAssemblies!.some(a => a.positions.some(p => p.kind !== "retired") &&
          (a.itemId === i.id || a.components.some(c => c.itemId === i.id))),
        "Tracking cannot change while this item belongs to an assembled kit or occupied serial custody.");
    }
    if (old) list[list.indexOf(old)] = value; else list.push(value);
    if (a === "item") kitCycles(s);
  } else if (a === "numberOrders") {
    z.object({}).strict().parse(d);
    for (const order of [...s.orders].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))) {
      if (order.orderNumber || !uuidOrderId(order.id)) continue;
      access(order.destinationId);
      if (order.sourceId) access(order.sourceId);
      order.orderNumber = allocateOrderNumber(s, order.type, Number.isFinite(Date.parse(order.createdAt)) ? order.createdAt : now);
    }
  } else if (a === "order") {
    const o = z.object({ id: identifier, type: z.enum(["purchase", "transfer"]), destinationId: identifier,
      sourceId: identifier.nullable().default(null), vendorId: identifier.nullable().default(null),
      replacementFor: identifier.optional(), reference: z.string().trim().max(100).optional(),
      lines, notes: z.string().max(2000).default("") }).strict().parse(d);
    assert(!o.replacementFor || o.replacementFor !== o.id && s.orders.some(x => x.id === o.replacementFor && !x.replacementFor),
      "Select an existing original order for replacements, not this order or another replacement.");
    access(o.destinationId);
    assert(o.type === "purchase" ? s.vendors.some(v => v.id === o.vendorId && v.active) :
      o.sourceId && o.sourceId !== o.destinationId, "Select a vendor or distinct source warehouse.");
    if (o.sourceId) assert(s.warehouses.some(w => w.id === o.sourceId && w.active), "Choose an active source warehouse in this project.");
    assert(o.type === "transfer" ? !o.vendorId : !o.sourceId, "Purchase orders use a vendor; transfers use a source warehouse.");
    // Orders plan products and quantities. Identify physical units when receiving
    // or dispatching; older transfer drafts with preselected serials remain valid.
    assert(new Set(o.lines.map(l => l.itemId)).size === o.lines.length, "Combine duplicate item lines.");
    for (const l of o.lines) {
      item(s, l.itemId);
      if (o.type === "purchase") assert(!l.serials.length, "Scan purchase serials when receiving.");
      else if (l.serials.length) validateLines(s, [l]);
    }
    const old = s.orders.find(x => x.id === o.id); assert(!old || old.status === "draft", "Only draft orders are editable.");
    if (old) {
      assert(old.type === o.type && !old.archivedAt, "Order type cannot change; cleared orders cannot be edited.");
      access(old.destinationId);
      if (old.sourceId) access(old.sourceId);
    }
    if (old) s.orders[s.orders.indexOf(old)] = { ...old, ...o };
    else s.orders.push({ ...o, reference: o.reference ?? (uuidOrderId(o.id) ? "" : o.id),
      orderNumber: allocateOrderNumber(s, o.type, now), received: [], dispatched: [], status: "draft", createdAt: now });
  } else if (["release", "cancel", "unrelease", "archiveOrder", "restoreOrder"].includes(a)) {
    const orderId = identifier.parse(d.orderId), o = s.orders.find(o => o.id === orderId);
    assert(o, "Order not found.");
    if (a === "dispatch" || a === "release" && o.type === "transfer") access(o.sourceId!);
    else access(o.destinationId);
    if (["unrelease", "archiveOrder", "restoreOrder"].includes(a)) {
      if (a === "unrelease") {
        if (o.type === "transfer") access(o.sourceId!);
        assert(o.status === "released" && !o.archivedAt, "Only released orders can be un-released.");
        assert(!o.received.length && !o.dispatched.length && !s.receipts.some(r => r.reference === o.id),
          "Orders with posted receipts or dispatches cannot be un-released.");
        assert(!(s.shipmentDrafts ?? []).some(draft => draft.orderId === o.id),
          "Resume or discard saved shipment drafts before un-releasing this order.");
        o.status = "draft";
      } else {
        assert(o.type === "purchase", "Purchase order required.");
        assert(o.status === "cancelled", "Only cancelled purchase orders can be cleared or restored.");
        if (a === "archiveOrder") {
          assert(!o.archivedAt, "Purchase order is already cleared.");
          o.archivedAt = now;
        } else {
          assert(o.archivedAt, "Purchase order is not cleared.");
          delete o.archivedAt;
        }
      }
    } else if (a === "release") { assert(o.status === "draft" && !o.archivedAt, "Only draft orders can be released."); o.status = "released"; }
    else if (a === "cancel") {
      assert(!["cancelled", "completed", "closed"].includes(o.status), "Order is already closed.");
      assert(!o.losses?.length && !(s.shipmentHolds ?? []).some(h => h.orderId === o.id),
        "Use authorized Close with exceptions for shipment discrepancies; cancellation cannot hide damage or loss.");
      assert(o.dispatched.every(l => totals(o.received, l.itemId) >= totals(o.dispatched, l.itemId)), "Receive dispatched stock before cancelling remaining quantities.");
      o.status = "cancelled";
    }
  } else if (a === "typeLink") {
    const input = z.object({ equipment: z.enum(["system", "module"]), typeId: z.number().int(),
      itemId: identifier.nullable() }).strict().parse(d);
    const id = `${input.equipment}-${input.typeId}`;
    if (input.itemId) {
      const linked = item(s, input.itemId);
      assert(linked.active, "Choose an active inventory item.");
      const coversEquipment = (itemId: string, seen: string[] = []): boolean => {
        assert(!seen.includes(itemId), "Kit recipe contains a cycle.");
        const candidate = item(s, itemId);
        return candidate.equipment === input.equipment ||
          candidate.components.some(c => coversEquipment(c.itemId, [...seen, itemId]));
      };
      assert(coversEquipment(input.itemId), `Choose an item or kit containing ${input.equipment} equipment.`);
      const link = { id, ...input, itemId: input.itemId,
        systemTypeId: input.equipment === "system" ? input.typeId : null,
        moduleTypeId: input.equipment === "module" ? input.typeId : null };
      s.typeLinks = [...(s.typeLinks ?? []).filter(l => l.id !== id), link];
    } else s.typeLinks = (s.typeLinks ?? []).filter(l => l.id !== id);
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
    let allocation = s.allocations.find(a => a.workOrderId === input.workOrderId);
    if (!allocation) {
      assert(input.revision === 0, "Inventory use changed; refresh work-order items.");
      allocation = { workOrderId: input.workOrderId, lines: [], used: [], dispositions: [], mode: null, status: "reserved", revision: 0 };
      s.allocations.push(allocation);
    }
    assert(allocation.status === "reserved" && allocation.revision === input.revision, "Assignments changed; refresh work-order items.");
    for (const l of allocation.lines) access(l.warehouseId);
    const keys = input.used.map(l => `${l.warehouseId}/${l.itemId}`);
    assert(new Set(keys).size === keys.length, "Combine duplicate used-item lines.");
    assert(input.mode !== "reading_only" || !input.used.length && !input.dispositions.length, "Reading-only work cannot consume replacement stock.");
    for (const l of input.used) {
      access(l.warehouseId);
      validateLines(s, [l]);
      const assigned = allocation.lines.find(x => x.warehouseId === l.warehouseId && x.itemId === l.itemId);
      if (assigned) assert(l.quantity <= assigned.quantity && l.serials.every(x => assigned.serials.includes(x)), "Used reserved items must match this work order's reservation.");
    }
    // Check unreserved actual selections against current custody, excluding only
    // this work order's own reservations. Preparation itself reserves nothing.
    const trial = structuredClone(s);
    const groups = new Map<string, Allocation[]>();
    for (const l of input.used) groups.set(l.warehouseId, [...(groups.get(l.warehouseId) ?? []), l]);
    for (const [warehouse, selected] of groups) move(trial, warehouse, selected, -1, input.workOrderId);
    assert(new Set(input.dispositions.map(x => x.equipment)).size === input.dispositions.length, "Only one disposition per removed equipment type.");
    for (const r of input.dispositions) if (r.disposition === "returned") { assert(r.warehouseId, "Choose a return warehouse."); access(r.warehouseId); }
    allocation.used = input.used; allocation.dispositions = input.dispositions; allocation.mode = input.mode; allocation.revision++;
  } else if (a === "verifyVendorKit") {
    const data = vendorKitSchema.parse(d);
    const { kit, warehouseId } = vendorKitSource(s, data);
    access(warehouseId);
    validateLines(s, data.components);
    assert(data.components.length === kit.components.length && kit.components.every(c =>
      totals(data.components, c.itemId) === c.quantity * data.quantity), "Captured contents must exactly match the kit recipe.");
    assert(data.components.every(c => !item(s, c.itemId).components.length),
      "Nested vendor kits require their own verified contents; capture a leaf-component kit instead.");
    if (data.components.some(c => c.serials.length))
      assert(kit.tracking === "serialized" && data.quantity === 1,
        "Kits containing serialized units require a kit serial and one-kit-at-a-time inspection for traceability.");
    // Use the existing incoming-custody checks on an isolated trial only.
    // Actual loose balances and revisions must never change during inspection.
    const trial = structuredClone(s);
    move(trial, warehouseId, data.components, 1);
    const output = { itemId: kit.id, quantity: data.quantity, serials: data.serials };
    recordKitAssembly(s, command.operationId, warehouseId, output, data.components, now);
    Object.assign(s.kitAssemblies!.at(-1)!, { source: "vendor", sourceReceiptId: data.receiptId });
    occupy(s, data.components, null);
    receipt(kit.id, warehouseId, [output], data.reason, data.components);
    s.receipts.at(-1)!.sourceReceiptId = data.receiptId;
  } else if (a === "assemble") {
    const { warehouseId, itemId, quantity, serials, components } = z.object({ warehouseId: identifier, itemId: identifier,
      quantity: z.number().int().positive().max(1000000), serials: z.array(identifier).default([]), components: lines }).strict().parse(d);
    access(warehouseId); const kit = item(s, itemId); assert(kit.components.length, "Select a kit item.");
    if (components.some(c => c.serials.length))
      assert(kit.tracking === "serialized" && quantity === 1, "Kits containing serialized units require a kit serial and one-kit-at-a-time assembly for traceability.");
    assert(components.length === kit.components.length && kit.components.every(c => totals(components, c.itemId) === c.quantity * quantity), "Scanned components must match the kit definition.");
    move(s, warehouseId, components, -1, undefined, { to: { kind: "assembly", id: command.operationId } });
    const output = [{ itemId, quantity, serials }]; move(s, warehouseId, output, 1);
    receipt(itemId, warehouseId, output, "Kit assembly", components);
    recordKitAssembly(s, command.operationId, warehouseId, output[0], components, now);
    occupy(s, components, null);
  } else if (a === "disassemble" || a === "resolveKitHold") {
    const hooks = { access, move: (w: string, ls: StockLine[], sign: 1 | -1, flow?: KitFlow) => move(s, w, ls, sign, undefined, flow) };
    if (a === "disassemble") applyKitDisassembly(s, d, command.operationId, actor, now, hooks);
    else applyKitHoldResolution(s, d, command.operationId, actor, now, hooks);
  } else if (a === "countStart") {
    const { id, warehouseId, scope } = z.object({ id: identifier, warehouseId: identifier, scope: z.enum(["selected", "warehouse"]).optional() }).strict().parse(d);
    access(warehouseId); assert(!s.counts.some(c => c.id === id), "Count identifier already exists.");
    assert(scope === "selected" || s.stock.filter(b => b.warehouseId === warehouseId).length <= COUNT_MAX_LINES,
      `This warehouse exceeds the ${COUNT_MAX_LINES}-item complete-count limit; no items were omitted.`);
    s.counts.push({ id, warehouseId, ...(scope ? { scope } : {}), snapshot: structuredClone(s.stock.filter(b => b.warehouseId === warehouseId)), status: "open" });
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
    assert(countStockScopeMatches(c, s.stock.filter(b => b.warehouseId === c.warehouseId), input.map(line => line.itemId)), "Stock moved since counting began; start a new count.");
    assert(input.reduce((sum, line) => sum + line.serials.length, 0) <= COUNT_MAX_SERIALS,
      `Count exceeds the ${COUNT_MAX_SERIALS}-serial complete-count limit; no changes were posted.`);
    validateLines(s, input);
    const submittedIds = new Set(input.map(line => line.itemId));
    if (c.scope === "selected") assert(input.length > 0, "Add at least one product before posting this selected-items count.");
    else assert(c.snapshot.every(b => submittedIds.has(b.itemId)), "Enter every item in this warehouse count, including zero quantities.");
    assert(!c.draft || c.draft.rows.every(row => submittedIds.has(row.itemId)), "Include every saved count entry when posting; save a revised selection before removing entries.");
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
      for (const [w, ls] of groups) move(s, w, ls, 1, undefined, { from: { kind: "work", id: String(input.workOrderId) } });
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
  return { state: inventoryCategoryLabels(s), replay: false };
}

// Called inside the same database transaction as the work-order status update.
export function completeInventoryWorkOrder(original: InventoryState, workOrderId: number, readingOnly: boolean) {
  const s = structuredClone(original), a = s.allocations.find(a => a.workOrderId === workOrderId);
  ensureKitProvenance(s);
  ensureSerialOccupancy(s);
  assert(a && a.mode, "Review inventory use and removed-equipment disposition before completing this work order.");
  if (a.status === "consumed" || a.status === "released") return original;
  assert(!readingOnly || a.mode === "reading_only", "This project only permits reading-only work.");
  if (a.mode === "changeout") {
    const requirements = s.workRequirements?.find(r => r.workOrderId === workOrderId);
    assert(!requirements || requirementsSatisfied(s, requirements, a.used),
      "Resolve missing type-to-item links and record every required item or kit component before completion.");
    const groups = new Map<string, Allocation[]>();
    for (const l of a.used) groups.set(l.warehouseId, [...(groups.get(l.warehouseId) || []), l]);
    for (const [w, ls] of groups) move(s, w, ls, -1, workOrderId, { to: { kind: "work", id: String(workOrderId) } });
    for (const d of a.dispositions) s.serialOccupancy = s.serialOccupancy!.filter(x =>
      x.serial !== d.serial || s.items.find(i => i.id === x.itemId)?.equipment !== d.equipment);
    occupy(s, a.used, workOrderId);
    for (const r of a.dispositions) s.returns.push({ ...r, id: `wo-${workOrderId}-${r.equipment}-${a.revision}`, workOrderId, status: "pending" });
    a.status = "consumed";
  } else a.status = "released";
  s.revision++; return s;
}
