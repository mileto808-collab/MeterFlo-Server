import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, commandPermission, type InventoryState, type InventoryCommand, type StockLine } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { actualEquipmentLines } from "../shared/inventory-requirements";
import { kitDisassemblyContents, kitAssemblyOptions } from "../shared/inventory-kits";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { storedCategoryState } from "../server/inventoryCategories";
import { inventoryPrint } from "../server/inventoryPrint";
import { extractReceiptSerialEvidence } from "../server/inventoryReceiptSerials";
import { initialLocationTypes } from "../shared/inventory-location-types";

const post = (s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(s, { action, data, operationId }, "receiver", true).state;
const line = (itemId: string, quantity: number, serials: string[] = []): StockLine => ({ itemId, quantity, serials });
const backup = (s: InventoryState) => validateInventoryBackup({ enabled: true, movements: [], state: structuredClone(s) },
  s.allocations.map(a => a.workOrderId));
function setup(serialized = true) {
  let s = emptyInventory();
  s.locationTypes = initialLocationTypes("assigned");
  for (const id of ["w", "van"]) s = post(s, "warehouse", { id, code: id, name: id, type: "physical", address: "Fixture", userIds: ["receiver"] });
  s = post(s, "vendor", { id: "v", name: "Kit supplier" });
  s = post(s, "item", { id: "meter", sku: "M", name: "Meter", tracking: serialized ? "serialized" : "regular", equipment: "system" });
  s = post(s, "item", { id: "module", sku: "R", name: "Radio", tracking: serialized ? "serialized" : "regular", equipment: "module" });
  s = post(s, "item", { id: "seal", sku: "S", name: "Seal", tracking: "regular" });
  s = post(s, "item", { id: "kit", sku: "K", name: "Vendor meter kit", tracking: serialized ? "serialized" : "regular",
    components: [{ itemId: "meter", quantity: 1 }, { itemId: "module", quantity: 1 }, { itemId: "seal", quantity: 2 }] });
  s = post(s, "order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [line("kit", 2)] });
  s = post(s, "release", { orderId: "po" });
  return post(s, "receive", { orderId: "po", lines: [line("kit", 2, serialized ? ["K1", "K2"] : [])] });
}
function capture(s: InventoryState, serial = "K1", meter = "M1", module = "R1") {
  const serialized = s.items.find(i => i.id === "kit")!.tracking === "serialized";
  return { receiptId: s.receipts.find(r => r.action === "receive")!.id, itemId: "kit", quantity: 1,
    serials: serialized ? [serial] : [], reason: "Opened vendor carton and verified actual labels and quantities",
    components: [line("meter", 1, serialized ? [meter] : []), line("module", 1, serialized ? [module] : []), line("seal", 2)] };
}
function breakdown(s: InventoryState, assemblyId: string, serials = ["K1"], quantity = 1, warehouseId = "w") {
  return { warehouseId, assemblyId, quantity, serials, reason: "Opened purchased kit",
    components: kitDisassemblyContents(s, assemblyId, quantity, serials).map(c => ({
      itemId: c.itemId, usableQuantity: c.quantity, usableSerials: c.serials,
      damagedQuantity: 0, damagedSerials: [], missingQuantity: 0, missingSerials: [], reason: "",
    })) };
}

test("vendor inspection records real identities without moving finished or loose stock, with stable retries", () => {
  let s = setup();
  const before = structuredClone(s.stock), data = capture(s), id = randomUUID();
  assert.equal(commandPermission("verifyVendorKit"), "inventory.receive");
  s = applyInventoryCommand(s, { action: "verifyVendorKit", data, operationId: id }, "receiver", false).state;
  assert.deepEqual(s.stock, before, "inspection cannot add kits or deduct fictitious loose components");
  assert.equal(s.kitAssemblies![0].source, "vendor");
  assert.equal(s.kitAssemblies![0].sourceReceiptId, data.receiptId);
  assert.deepEqual(s.kitAssemblies![0].components, data.components);
  assert.deepEqual(s.serialOccupancy!.map(o => o.serial).sort(), ["M1", "R1"]);
  assert.equal(applyInventoryCommand(s, { action: "verifyVendorKit", data, operationId: id }, "receiver", false).replay, true);
  assert.deepEqual(post(s, "verifyVendorKit", data, id), s);
  assert.throws(() => post(s, "verifyVendorKit", { ...data, reason: "Different capture" }, id), /different operation/);
  assert.throws(() => post(s, "verifyVendorKit", data), /unverified|receiving identity/);
  s = post(s, "verifyVendorKit", capture(s, "K2", "M2", "R2"));
  assert.deepEqual(s.stock, before);
  backup(s);
  const tables = inventoryToRelational(s, 77);
  assert.equal(tables.get("inventory_kit_assemblies")!.rows[0].source_receipt_id, data.receiptId);
  assert.equal(tables.get("inventory_kit_contents")!.rows.length, 6);
  assert.ok(tables.get("inventory_kit_contents_values")!.rows.some(r => r.value === "M1"));
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, structuredClone(table.rows)])), s.revision, Object.keys(s));
  assert.deepEqual(storedCategoryState(restored), storedCategoryState(s));
  backup(restored);
  const receipt = s.receipts.find(r => r.id === id)!;
  const html = inventoryPrint("receipt", receipt, s, "Fixture");
  assert.match(html, /Vendor kit contents verified/);
  assert.match(html, /No loose component stock was deducted or added/);
  assert.ok(extractReceiptSerialEvidence(receipt, s).some(e => e.category === "vendor-component" && e.serials.includes("M1")));
});

test("recipe, source receipt, warehouse, and serial validation reject atomically", () => {
  const s = setup(), data = capture(s), before = structuredClone(s);
  for (const changed of [
    { ...data, receiptId: "not-a-receipt" }, { ...data, itemId: "meter" }, { ...data, quantity: 0 },
    { ...data, quantity: 2, serials: ["K1", "K2"] }, { ...data, serials: ["UNKNOWN"] },
    { ...data, reason: "" }, { ...data, components: [data.components[0]] },
    { ...data, components: [...data.components, data.components[0]] },
    { ...data, components: [line("meter", 1), ...data.components.slice(1)] },
    { ...data, components: [line("meter", 2, ["M1", "M1"]), ...data.components.slice(1)] },
    { ...data, components: [data.components[0], data.components[1], line("seal", 2, ["NOT-SERIALIZED"])] },
  ]) assert.throws(() => post(s, "verifyVendorKit", changed));
  assert.throws(() => applyInventoryCommand(s, { action: "verifyVendorKit", data, operationId: randomUUID() }, "outsider", false), /access/);
  assert.deepEqual(s, before);
  const assigned = post(s, "assign", { workOrderId: 11, lines: [{ ...line("kit", 1, ["K1"]), warehouseId: "w" }] });
  assert.throws(() => post(assigned, "verifyVendorKit", capture(assigned)), /reservations/);
});

test("components cannot be claimed from loose stock, another kit, installed work, transit, quarantine or returns", () => {
  let s = setup();
  s = post(s, "order", { id: "loose", type: "purchase", vendorId: "v", destinationId: "w", lines: [line("meter", 1)] });
  s = post(s, "release", { orderId: "loose" });
  const loose = post(s, "receive", { orderId: "loose", lines: [line("meter", 1, ["M1"])] });
  assert.throws(() => post(loose, "verifyVendorKit", capture(loose)), /already in inventory/);
  const kit = post(s, "verifyVendorKit", capture(s));
  assert.throws(() => post(kit, "verifyVendorKit", capture(kit, "K2")), /contained|installed/);
  const transit = post(loose, "order", { id: "tr", type: "transfer", sourceId: "w", destinationId: "van", lines: [line("meter", 1)] });
  const dispatched = post(post(transit, "release", { orderId: "tr" }), "dispatch", { orderId: "tr", lines: [line("meter", 1, ["M1"])] });
  assert.throws(() => post(dispatched, "verifyVendorKit", capture(dispatched)), /transit/);
  const held = post(s, "receive", { orderId: "loose", lines: [], damaged: [
    { ...line("meter", 1, ["M1"]), reason: "Damaged box", unidentifiedQuantity: 0 },
  ] });
  assert.throws(() => post(held, "verifyVendorKit", capture(held)), /held|inspect|quarantined/);
  const installed = structuredClone(s);
  installed.serialOccupancy!.push({ itemId: "meter", serial: "M1", workOrderId: 99 });
  assert.throws(() => post(installed, "verifyVendorKit", capture(installed)), /installed/);
  const returned = structuredClone(s);
  returned.returns.push({ id: "r", workOrderId: 99, equipment: "system", serial: "M1", warehouseId: "w", disposition: "returned", status: "pending" });
  assert.throws(() => post(returned, "verifyVendorKit", capture(returned)), /pending return/);
});

test("completed changeout links actual underlying equipment to the work order and consumes only finished kits", () => {
  let s = setup();
  s = post(s, "verifyVendorKit", capture(s));
  s.workRequirements = [{ workOrderId: 11, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  s = post(s, "assign", { workOrderId: 11, lines: [{ ...line("kit", 1, ["K1"]), warehouseId: "w" }] });
  s = post(s, "prepareUse", { workOrderId: 11, revision: s.allocations[0].revision, mode: "changeout",
    used: [{ ...line("kit", 1, ["K1"]), warehouseId: "w" }], dispositions: [] });
  const equipment = actualEquipmentLines(s, s.allocations[0].used)
    .filter(l => s.items.find(i => i.id === l.itemId)?.equipment !== "none");
  assert.deepEqual(equipment.map(l => [l.itemId, l.serials]), [["meter", ["M1"]], ["module", ["R1"]]]);
  s = completeInventoryWorkOrder(s, 11, false);
  assert.equal(s.stock.find(b => b.itemId === "kit")!.quantity, 1);
  assert.equal(s.stock.filter(b => b.itemId !== "kit").length, 0);
  assert.deepEqual(s.serialOccupancy!.filter(o => o.workOrderId === 11).map(o => o.serial).sort(), ["K1", "M1", "R1"]);
  assert.deepEqual(s.kitAssemblies![0].positions, [{ kind: "work", id: "11", quantity: 1, serials: ["K1"] }]);
  backup(s);
});

test("vendor contents survive transfer, recipe changes, breakdown and component reuse without double recovery", () => {
  let s = setup(), data = capture(s), id = randomUUID();
  s = post(s, "verifyVendorKit", data, id);
  s = post(s, "order", { id: "tr", type: "transfer", sourceId: "w", destinationId: "van", lines: [line("kit", 1)] });
  s = post(s, "release", { orderId: "tr" });
  s = post(s, "dispatch", { orderId: "tr", lines: [line("kit", 1, ["K1"])] });
  backup(s);
  s = post(s, "accept", { orderId: "tr", lines: [line("kit", 1, ["K1"])] });
  assert.equal(kitAssemblyOptions(s, "van", "kit")[0].assemblyId, id);
  s.items.find(i => i.id === "kit")!.components[0].quantity = 9;
  const recovery = breakdown(s, id, ["K1"], 1, "van");
  const op = randomUUID();
  s = post(s, "disassemble", recovery, op);
  assert.equal(s.stock.find(b => b.itemId === "meter" && b.warehouseId === "van")!.quantity, 1);
  assert.deepEqual(s.stock.find(b => b.itemId === "meter")!.serials, ["M1"]);
  assert.deepEqual(post(s, "disassemble", recovery, op), s);
  assert.throws(() => post(s, "disassemble", recovery), /remaining assembled/);
  backup(s);
  const original = setup(), second = capture(original);
  let used = post(original, "verifyVendorKit", second);
  const firstId = used.kitAssemblies![0].id;
  used = post(used, "disassemble", breakdown(used, firstId));
  assert.throws(() => post(used, "verifyVendorKit", capture(used, "K2")), /already in inventory/);
});

test("quantity-only purchased kits can be verified and split only with quantity-only contents", () => {
  let s = setup(false), data = capture(s), id = randomUUID();
  data.quantity = 2;
  data.components = data.components.map(c => ({ ...c, quantity: c.quantity * 2 }));
  const before = structuredClone(s.stock);
  s = post(s, "verifyVendorKit", data, id);
  assert.deepEqual(s.stock, before);
  s = post(s, "disassemble", breakdown(s, id, [], 1));
  assert.equal(s.stock.find(b => b.itemId === "meter")!.quantity, 1);
  backup(s);
});

test("tampered receiving provenance is rejected during restore and replacement serial labels never inherit old contents", () => {
  let s = setup();
  s = post(s, "verifyVendorKit", capture(s));
  for (const corrupt of [
    (c: InventoryState) => { c.kitAssemblies![0].sourceReceiptId = "missing"; },
    (c: InventoryState) => { c.receipts.find(r => r.action === "verifyVendorKit")!.sourceReceiptId = "missing"; },
    (c: InventoryState) => { c.receipts.find(r => r.action === "receive")!.lines[0].serials = ["OTHER", "K2"]; },
    (c: InventoryState) => { delete c.kitAssemblies![0].source; },
    (c: InventoryState) => { c.kitAssemblies = []; },
    (c: InventoryState) => { c.serialOccupancy = []; },
    (c: InventoryState) => { c.kitAssemblies![0].components[0].serials = []; },
  ]) { const copy = structuredClone(s); corrupt(copy); assert.throws(() => backup(copy)); }
  s = post(s, "countStart", { id: "c", warehouseId: "w" });
  s = post(s, "countPost", { id: "c", reason: "Missing original kit", lines: [line("kit", 1, ["K2"])] });
  s = post(s, "order", { id: "replacement", type: "purchase", vendorId: "v", destinationId: "w", lines: [line("kit", 1)] });
  s = post(s, "release", { orderId: "replacement" });
  s = post(s, "receive", { orderId: "replacement", lines: [line("kit", 1, ["K1"])] });
  assert.throws(() => post(s, "verifyVendorKit", capture(s)), /unverified|receiving identity/);
  assert.deepEqual(kitAssemblyOptions(s, "w", "kit"), []);
});
