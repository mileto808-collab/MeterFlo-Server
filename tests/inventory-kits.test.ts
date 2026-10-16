import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, commandPermission, type InventoryState, type InventoryCommand, type StockLine } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { kitAssemblyOptions, kitDisassemblyContents, kitSerialContents, remainingKitHold } from "../shared/inventory-kits";
import { extractReceiptSerialEvidence } from "../server/inventoryReceiptSerials";
import { buildOperationsDataset } from "../client/src/lib/inventory-operations-data";
import { operationsCsv } from "../client/src/lib/inventory-operations-export";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryPrint } from "../server/inventoryPrint";

const post = (s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId: string = randomUUID()) =>
  applyInventoryCommand(s, { action, data, operationId }, "admin", true).state;
const line = (itemId: string, quantity: number, serials: string[] = []): StockLine => ({ itemId, quantity, serials });
function setup(serialized = false) {
  let s = emptyInventory();
  for (const id of ["w", "van"]) s = post(s, "warehouse", { id, code: id, name: id, type: "physical", address: "Fixture" });
  s = post(s, "vendor", { id: "v", name: "Supplier" });
  s = post(s, "item", { id: "part", sku: "PART", name: "Part", tracking: serialized ? "serialized" : "regular" });
  s = post(s, "item", { id: "seal", sku: "SEAL", name: "Seal", tracking: "regular" });
  s = post(s, "item", { id: "kit", sku: "KIT", name: "Test kit", tracking: serialized ? "serialized" : "regular",
    components: [{ itemId: "part", quantity: 1 }, { itemId: "seal", quantity: 2 }] });
  s = post(s, "order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w",
    lines: [line("part", 6), line("seal", 20)] });
  s = post(s, "release", { orderId: "po" });
  s = post(s, "receive", { orderId: "po", lines: [line("part", 6, serialized ? ["P1", "P2", "P3", "P4", "P5", "P6"] : []), line("seal", 20)] });
  return s;
}
function assemble(s: InventoryState, quantity = 3, serials: string[] = [], parts: string[] = []) {
  return post(s, "assemble", { warehouseId: "w", itemId: "kit", quantity, serials,
    components: [line("part", quantity, parts), line("seal", 2 * quantity)] });
}
function recovery(itemId: string, usableQuantity: number, usableSerials: string[] = [], damagedQuantity = 0,
  damagedSerials: string[] = [], missingQuantity = 0, missingSerials: string[] = []) {
  return { itemId, usableQuantity, usableSerials, damagedQuantity, damagedSerials, missingQuantity, missingSerials,
    reason: damagedQuantity || missingQuantity ? "Observed damaged or missing during breakdown" : "" };
}
function breakdown(s: InventoryState, assemblyId: string, quantity: number, serials: string[] = [], warehouseId = "w") {
  return { warehouseId, assemblyId, quantity, serials, reason: "Return components to stock",
    components: kitDisassemblyContents(s, assemblyId, quantity, serials).map(l => recovery(l.itemId, l.quantity, l.serials)) };
}
const qty = (s: InventoryState, itemId: string, warehouseId = "w") => s.stock.find(b => b.itemId === itemId && b.warehouseId === warehouseId)?.quantity ?? 0;
const backup = (s: InventoryState) => validateInventoryBackup({ enabled: true, movements: [], state: JSON.parse(JSON.stringify(s)) }, s.allocations.map(a => a.workOrderId));

test("partial regular decisions preserve evidence, reject over-selection, retry and finish mixed custody", () => {
  let s = assemble(setup());
  const data = breakdown(s, s.receipts.at(-1)!.id, 3);
  data.components[0] = recovery("part", 0, [], 3);
  s = post(s, "disassemble", data);
  const original = structuredClone(s.receipts.at(-1)), hold = structuredClone(s.kitHolds![0]);
  const operationId = randomUUID();
  const decision = { id: hold.id, outcome: "released", quantity: 1, serials: [], reason: "One passed" };
  s = post(s, "resolveKitHold", decision, operationId);
  assert.equal(qty(s, "part"), 4);
  assert.deepEqual(remainingKitHold(s.kitHolds![0]), { quantity: 2, serials: [] });
  backup(s);
  assert.deepEqual(post(s, "resolveKitHold", decision, operationId), s);
  assert.throws(() => post(s, "resolveKitHold", { ...decision, quantity: 2 }, operationId), /different operation/);
  const before = structuredClone(s);
  for (const quantity of [0, -1, 1.5, 3]) assert.throws(() => post(s, "resolveKitHold", { ...decision, quantity }));
  assert.throws(() => post(s, "resolveKitHold", { ...decision, reason: " " }));
  assert.throws(() => applyInventoryCommand(s, { action: "resolveKitHold", operationId: randomUUID(), data: decision },
    "warehouse-user", false), /location|access/i);
  assert.deepEqual(s, before);
  s = post(s, "resolveKitHold", { ...decision, outcome: "scrapped", reason: "One failed" });
  backup(s);
  s = post(s, "resolveKitHold", { ...decision, reason: "Final passed" });
  assert.equal(s.kitHolds![0].status, "resolved");
  assert.equal(s.kitHolds![0].dispositions!.length, 3);
  assert.equal(qty(s, "part"), 5);
  assert.deepEqual(s.receipts.find(r => r.id === original!.id), original);
  assert.deepEqual({ ...s.kitHolds![0], status: hold.status, dispositions: undefined }, { ...hold, dispositions: undefined });
  assert.throws(() => post(s, "resolveKitHold", decision), /open/);
  backup(s);
});

test("exact serial subsets never release missing or already decided identities and exports describe selected scrap", () => {
  let s = post(setup(true), "item", { id: "batch", sku: "BATCH", name: "Batch kit", tracking: "serialized",
    components: [{ itemId: "part", quantity: 4 }] });
  s = post(s, "assemble", { warehouseId: "w", itemId: "batch", quantity: 1, serials: ["B1"],
    components: [line("part", 4, ["P1", "P2", "P3", "P4"])] });
  const data = breakdown(s, s.receipts.at(-1)!.id, 1, ["B1"]);
  data.components = [recovery("part", 0, [], 3, ["P1", "P2", "P3"], 1, ["P4"])];
  s = post(s, "disassemble", data);
  const id = s.kitHolds![0].id;
  const decision = { id, quantity: 1, serials: ["P2"], outcome: "released", reason: "Passed test" };
  s = post(s, "resolveKitHold", decision);
  assert.deepEqual(remainingKitHold(s.kitHolds![0]).serials, ["P1", "P3"]);
  backup(s);
  for (const serials of [["P2"], ["P4"], ["UNKNOWN"], ["P1", "P1"], []])
    assert.throws(() => post(s, "resolveKitHold", { ...decision, serials }));
  s = post(s, "resolveKitHold", { ...decision, outcome: "scrapped", serials: ["P1"], reason: "Failed pressure test" });
  const receipt = s.receipts.at(-1)!;
  assert.deepEqual(extractReceiptSerialEvidence(receipt, s).flatMap(e => e.serials), ["P1"]);
  const html = inventoryPrint("receipt", receipt, s, "Fixture");
  assert.ok(html.includes("Selected quantity: 1") && html.includes('data-serial-category="kit-inspection"'));
  const dataset = buildOperationsDataset("activity", s);
  const csv = operationsCsv(dataset, dataset.rows.filter(r => r.id === receipt.id));
  assert.ok(csv.includes("P1") && csv.includes("Failed pressure test") && csv.includes("PART"));
  assert.ok(!csv.includes("P3"));
  backup(s);
  for (const corrupt of [
    (c: InventoryState) => { c.kitHolds![0].dispositions![0].serials = ["P4"]; },
    (c: InventoryState) => { c.kitHolds![0].dispositions![0].reason = "Changed"; },
    (c: InventoryState) => { c.kitHolds![0].status = "released"; },
    (c: InventoryState) => { c.kitHolds![0].dispositions!.pop(); },
  ]) { const copy = structuredClone(s); corrupt(copy); assert.throws(() => backup(copy)); }
  s = post(s, "resolveKitHold", { ...decision, serials: ["P3"] });
  assert.equal(s.kitHolds![0].status, "resolved");
  assert.ok(s.serialOccupancy!.some(o => o.serial === "P1"));
  assert.ok(s.serialOccupancy!.some(o => o.serial === "P4"));
  backup(s);
});

test("regular partial disassembly uses recorded recipe, balances stock, and is replay-safe", () => {
  let s = assemble(setup()), id = s.receipts.at(-1)!.id;
  const assemblyReceipt = structuredClone(s.receipts.at(-1));
  assert.equal(qty(s, "kit"), 3); assert.equal(qty(s, "part"), 3);
  assert.equal(kitAssemblyOptions(s, "w", "kit")[0].availableQuantity, 3);
  const payload = breakdown(s, id, 1), operationId = randomUUID();
  s = post(s, "disassemble", payload, operationId);
  assert.equal(qty(s, "kit"), 2); assert.equal(qty(s, "part"), 4); assert.equal(qty(s, "seal"), 16);
  assert.deepEqual(s.receipts.find(r => r.id === id), assemblyReceipt);
  assert.deepEqual(post(s, "disassemble", payload, operationId), s);
  assert.throws(() => post(s, "disassemble", { ...payload, quantity: 2 }, operationId), /different operation/);
  assert.throws(() => breakdown(s, id, 3), /remaining assembled/);
  const changed = structuredClone(s);
  changed.items.find(i => i.id === "kit")!.components[0].quantity = 5;
  assert.equal(kitDisassemblyContents(changed, id, 1, [])[0].quantity, 1, "current recipe does not rewrite history");
  s = post(s, "disassemble", breakdown(s, id, 2));
  assert.equal(qty(s, "part"), 6); assert.equal(qty(s, "seal"), 20);
  assert.deepEqual(kitAssemblyOptions(s, "w", "kit"), []);
  backup(s);
});

test("serialized breakdown, damage inspection, missing identities and reassembly preserve custody", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]), id = s.receipts.at(-1)!.id;
  const payload = breakdown(s, id, 1, ["K1"]);
  payload.components = [recovery("part", 0, [], 1, ["P1"]), recovery("seal", 1, [], 0, [], 1)];
  s = post(s, "disassemble", payload);
  assert.equal(qty(s, "kit"), 0); assert.equal(qty(s, "part"), 5); assert.equal(qty(s, "seal"), 19);
  assert.equal(s.kitHolds![0].status, "held");
  const hold = s.kitHolds![0];
  assert.ok(s.serialOccupancy!.some(o => o.serial === "P1"));
  const frozen = structuredClone(s);
  assert.throws(() => post(s, "assemble", { warehouseId: "w", itemId: "kit", quantity: 1, serials: ["K2"],
    components: [line("part", 1, ["P1"]), line("seal", 2)] }), /unavailable/);
  assert.deepEqual(s, frozen);
  backup(s);
  const operationId = randomUUID(), resolution = { id: hold.id, outcome: "released", reason: "Tested and usable" };
  s = post(s, "resolveKitHold", resolution, operationId);
  assert.deepEqual(post(s, "resolveKitHold", resolution, operationId), s);
  assert.equal(qty(s, "part"), 6);
  s = assemble(s, 1, ["K1"], ["P2"]);
  assert.deepEqual(kitSerialContents(s, "kit", "K1")[0].serials, ["P2"], "reused kit serial belongs to newest contents");
  s = post(s, "disassemble", breakdown(s, s.receipts.at(-1)!.id, 1, ["K1"]));
  assert.deepEqual(kitSerialContents(s, "kit", "K1"), []);
  assert.ok(s.stock.find(b => b.itemId === "part")!.serials.includes("P2"));
  backup(s);
});

test("legacy whole-hold receipts remain restorable without inventing partial history", () => {
  for (const outcome of ["released", "scrapped"] as const) {
    let s = assemble(setup(true), 1, ["K1"], ["P1"]);
    const data = breakdown(s, s.receipts.at(-1)!.id, 1, ["K1"]);
    data.components[0] = recovery("part", 0, [], 1, ["P1"]);
    s = post(s, "disassemble", data);
    s = post(s, "resolveKitHold", { id: s.kitHolds![0].id, outcome, reason: "Legacy inspection" });
    const hold = s.kitHolds![0], event = hold.dispositions![0];
    hold.resolution = { operationId: event.operationId, actor: event.actor, occurredAt: event.occurredAt, reason: event.reason };
    delete hold.dispositions;
    assert.deepEqual(remainingKitHold(hold), { quantity: 0, serials: [] });
    backup(s);
  }
});

test("transfers preserve regular batch and serialized kit provenance at destination, never in transit", () => {
  for (const serialized of [false, true]) {
    let s = assemble(setup(serialized), serialized ? 1 : 3, serialized ? ["K1"] : [], serialized ? ["P1"] : []);
    const id = s.receipts.at(-1)!.id, quantity = serialized ? 1 : 2, serials = serialized ? ["K1"] : [];
    s = post(s, "order", { id: "tr", type: "transfer", sourceId: "w", destinationId: "van", lines: [line("kit", quantity)] });
    s = post(s, "release", { orderId: "tr" });
    s = post(s, "dispatch", { orderId: "tr", lines: [line("kit", quantity, serials)] });
    assert.deepEqual(kitAssemblyOptions(s, "van", "kit"), []);
    assert.throws(() => post(s, "disassemble", breakdown(s, id, quantity, serials, "van")), /Insufficient|no longer available/);
    s = post(s, "accept", { orderId: "tr", lines: [line("kit", quantity, serials)] });
    assert.equal(kitAssemblyOptions(s, "van", "kit")[0].availableQuantity, quantity);
    s = post(s, "disassemble", breakdown(s, id, quantity, serials, "van"));
    assert.equal(qty(s, "part", "van"), quantity); assert.equal(qty(s, "kit", "van"), 0);
    backup(s);
  }
});

test("nested serialized kits recover the inner kit without freeing its component serials", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]), inner = s.receipts.at(-1)!.id;
  s = post(s, "item", { id: "outer", sku: "OUTER", name: "Outer kit", tracking: "serialized", components: [{ itemId: "kit", quantity: 1 }] });
  s = post(s, "assemble", { warehouseId: "w", itemId: "outer", quantity: 1, serials: ["OUT1"], components: [line("kit", 1, ["K1"])] });
  const outer = s.receipts.at(-1)!.id;
  assert.deepEqual(kitAssemblyOptions(s, "w", "kit"), []);
  s = post(s, "disassemble", breakdown(s, outer, 1, ["OUT1"]));
  assert.ok(s.stock.find(b => b.itemId === "kit")!.serials.includes("K1"));
  assert.ok(s.serialOccupancy!.some(o => o.serial === "P1"));
  assert.equal(kitAssemblyOptions(s, "w", "kit")[0].assemblyId, inner);
  s = post(s, "disassemble", breakdown(s, inner, 1, ["K1"]));
  assert.ok(!s.serialOccupancy!.some(o => o.serial === "P1"));
  backup(s);
});

test("nested regular batch positions survive partial breakdown", () => {
  let s = assemble(setup());
  const inner = s.receipts.at(-1)!.id;
  s = post(s, "item", { id: "outer", sku: "OUTER", name: "Outer kit", tracking: "regular", components: [{ itemId: "kit", quantity: 1 }] });
  s = post(s, "assemble", { warehouseId: "w", itemId: "outer", quantity: 2, components: [line("kit", 2)] });
  const outer = s.receipts.at(-1)!.id;
  s = post(s, "disassemble", breakdown(s, outer, 1));
  assert.equal(kitAssemblyOptions(s, "w", "kit")[0].availableQuantity, 2);
  s = post(s, "disassemble", breakdown(s, inner, 2));
  assert.equal(qty(s, "part"), 5);
  backup(s);
});

test("tracking cannot be changed while a component is contained in a kit", () => {
  let s = setup(true);
  s = post(s, "item", { id: "all", sku: "ALL", name: "All seals", tracking: "regular", components: [{ itemId: "seal", quantity: 20 }] });
  s = post(s, "assemble", { warehouseId: "w", itemId: "all", quantity: 1, components: [line("seal", 20)] });
  assert.equal(qty(s, "seal"), 0);
  assert.throws(() => post(s, "item", { ...s.items.find(i => i.id === "seal"), tracking: "serialized" }), /Tracking cannot change/);
});

test("reservation, warehouse denial and malformed dispositions fail without changing state", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]), id = s.receipts.at(-1)!.id;
  const payload = breakdown(s, id, 1, ["K1"]);
  for (const change of [
    { components: [recovery("part", 1, ["FOREIGN"]), recovery("seal", 2)] },
    { components: [recovery("part", 1, ["P1"]), recovery("seal", 1)] },
    { components: [recovery("part", 0, [], 0, [], 1, ["P1"]), { ...recovery("seal", 2), itemId: "part" }] },
    { serials: ["UNKNOWN"] },
  ]) { const before = structuredClone(s); assert.throws(() => post(s, "disassemble", { ...payload, ...change })); assert.deepEqual(s, before); }
  assert.throws(() => applyInventoryCommand(s, { action: "disassemble", operationId: randomUUID(), data: payload }, "outsider", false), /Warehouse access/);
  s = post(s, "assign", { workOrderId: 1, lines: [{ ...line("kit", 1, ["K1"]), warehouseId: "w" }] });
  assert.deepEqual(kitAssemblyOptions(s, "w", "kit"), []);
  assert.throws(() => post(s, "disassemble", payload), /Insufficient|reserved/);
  s = post(s, "prepareUse", { workOrderId: 1, revision: 1, mode: "changeout",
    used: [{ ...line("kit", 1, ["K1"]), warehouseId: "w" }], dispositions: [] });
  s = completeInventoryWorkOrder(s, 1, false);
  assert.throws(() => post(s, "disassemble", payload), /Insufficient/);
  const leftInstalled = post(s, "reconcileWorkOrder", { workOrderId: 1, reason: "Leave installed equipment in place", restoreUsedStock: false });
  assert.deepEqual(kitAssemblyOptions(leftInstalled, "w", "kit"), []);
  backup(leftInstalled);
  s = post(s, "reconcileWorkOrder", { workOrderId: 1, reason: "Physical return", restoreUsedStock: true });
  assert.equal(kitAssemblyOptions(s, "w", "kit")[0].availableQuantity, 1);
  backup(s);
  assert.equal(commandPermission("disassemble"), "inventory.assemble");
  assert.equal(commandPermission("resolveKitHold"), "inventory.resolveExceptions");
});

test("unproven purchased stock is not a recoverable kit; trustworthy legacy serial receipts remain usable", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]);
  const id = s.receipts.at(-1)!.id;
  delete s.kitAssemblies; delete s.kitHolds;
  assert.equal(kitAssemblyOptions(s, "w", "kit")[0].assemblyId, id);
  s = post(s, "disassemble", breakdown(s, id, 1, ["K1"])); backup(s);
  let regular = setup();
  regular = post(regular, "order", { id: "purchased-kits", type: "purchase", vendorId: "v", destinationId: "w", lines: [line("kit", 2)] });
  regular = post(regular, "release", { orderId: "purchased-kits" });
  regular = post(regular, "receive", { orderId: "purchased-kits", lines: [line("kit", 2)] });
  assert.deepEqual(kitAssemblyOptions(regular, "w", "kit"), []);
  assert.throws(() => breakdown(regular, "invented", 1), /trustworthy/);
});

test("legacy serial labels cannot recover old contents after a count removal and replacement receipt", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]);
  const oldAssembly = s.receipts.at(-1)!.id;
  s = post(s, "countStart", { id: "remove-kit", warehouseId: "w" });
  s = post(s, "countPost", { id: "remove-kit", reason: "Original kit no longer present",
    lines: s.stock.filter(b => b.warehouseId === "w").map(b => b.itemId === "kit" ? line("kit", 0) : line(b.itemId, b.quantity, b.serials)) });
  s = post(s, "order", { id: "replacement", type: "purchase", vendorId: "v", destinationId: "w", lines: [line("kit", 1)] });
  s = post(s, "release", { orderId: "replacement" });
  s = post(s, "receive", { orderId: "replacement", lines: [line("kit", 1, ["K1"])] });
  // A pre-upgrade snapshot has receipt history but no modern position ledger.
  delete s.kitAssemblies; delete s.kitHolds;
  assert.deepEqual(kitAssemblyOptions(s, "w", "kit"), []);
  const before = structuredClone(s);
  assert.throws(() => post(s, "disassemble", { warehouseId: "w", assemblyId: oldAssembly, quantity: 1, serials: ["K1"],
    components: [recovery("part", 1, ["P1"]), recovery("seal", 2)], reason: "Must not recover old contents" }), /no longer available/);
  assert.deepEqual(s, before, "replacement kit cannot mint components from an unrelated historical recipe");
});

test("legacy serialized provenance survives an uninterrupted exact transfer chain", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]);
  s = post(s, "order", { id: "legacy-tr", type: "transfer", sourceId: "w", destinationId: "van", lines: [line("kit", 1)] });
  s = post(s, "release", { orderId: "legacy-tr" });
  s = post(s, "dispatch", { orderId: "legacy-tr", lines: [line("kit", 1, ["K1"])] });
  s = post(s, "accept", { orderId: "legacy-tr", lines: [line("kit", 1, ["K1"])] });
  delete s.kitAssemblies;
  assert.equal(kitAssemblyOptions(s, "van", "kit")[0].availableQuantity, 1);
});

test("inspection scrap keeps serial unavailable and corrupt provenance or dispositions cannot restore", () => {
  let s = assemble(setup(true), 1, ["K1"], ["P1"]), id = s.receipts.at(-1)!.id;
  const payload = breakdown(s, id, 1, ["K1"]);
  payload.components[0] = recovery("part", 0, [], 1, ["P1"]);
  s = post(s, "disassemble", payload);
  s = post(s, "resolveKitHold", { id: s.kitHolds![0].id, outcome: "scrapped", reason: "Failed inspection" });
  assert.ok(s.serialOccupancy!.some(o => o.serial === "P1")); backup(s);
  for (const corrupt of [
    (c: InventoryState) => { c.kitAssemblies![0].disassembledQuantity = 0; },
    (c: InventoryState) => { c.kitAssemblies![0].components[0].quantity = 5; },
    (c: InventoryState) => { c.receipts.find(r => r.action === "disassemble")!.kitConversion!.recovered[0].damagedQuantity = 0; },
    (c: InventoryState) => { c.kitHolds![0].receiptId = "missing"; },
  ]) { const copy = structuredClone(s); corrupt(copy); assert.throws(() => backup(copy), /kit backup|component|remaining/i); }
  const html = inventoryPrint("receipt", s.receipts.find(r => r.action === "disassemble"), s, "Fixture");
  assert.ok(html.includes("KIT"));
  assert.ok(html.includes("Stock conversion") && html.includes("Original assembly:"));
  assert.ok(html.includes("Damaged / held") && html.includes('data-serial-category="damaged"'));
});
