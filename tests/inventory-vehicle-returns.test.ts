import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { vehicleReturnCaptureSchema, meaningfulVehicleReturn, type VehicleReturnKind } from "../shared/inventory-vehicle-returns";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action, data }, "operator", true).state;
function fixture() {
  let state = emptyInventory();
  state = post(state, "warehouse", { id: "main", code: "MAIN", name: "Main", type: "physical", address: "Test warehouse" });
  state = post(state, "warehouse", { id: "van", code: "VAN", name: "Vehicle", type: "vehicle",
    vin: "1HGCM82633A004352", plate: "VAN", plateState: "CO" });
  state = post(state, "item", { id: "meter", sku: "METER", name: "Meter", tracking: "serialized" });
  state = post(state, "item", { id: "part", sku: "PART", name: "Parts", tracking: "regular" });
  state = post(state, "vendor", { id: "vendor", name: "Vendor" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 2 }, { itemId: "part", quantity: 5 }] });
  state = post(state, "release", { orderId: "po" });
  state = post(state, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 2, serials: ["A", "B"] }, { itemId: "part", quantity: 5 },
  ] });
  state.returns.push({ id: "removed", workOrderId: 9, equipment: "system", serial: "OLD",
    disposition: "returned", warehouseId: "main", status: "pending" });
  return state;
}
function freeze(state: InventoryState, kind: VehicleReturnKind, patch: Record<string, unknown> = {}) {
  const id = randomUUID(), operationId = randomUUID();
  const capture = vehicleReturnCaptureSchema.parse({ kind, sourceId: "van", destinationId: kind === "count" ? "" : "main",
    itemIds: kind === "equipment" ? [] : ["meter"], returnIds: kind === "equipment" ? ["removed"] : [],
    quantities: kind === "equipment" ? {} : { meter: kind === "count" ? "2" : "1" },
    scans: kind === "equipment" ? { system: "OLD" } : { meter: kind === "count" ? "A\nB" : "A" },
    reason: "Physical return verified by receiving worker", ...patch });
  const command: InventoryCommand = { operationId, action: "vehicleReturn",
    data: { draftId: id, draftRevision: 1, physicallyConfirmed: true } };
  state.vehicleReturnDrafts = [{ id, revision: 1, capture, status: "submitting",
    baseline: structuredClone(state.stock.filter(row => row.warehouseId === "van")), command: command as any,
    createdBy: "operator", updatedBy: "operator", saveId: randomUUID(), savedAt: new Date().toISOString() }];
  return command;
}
test("opening a workflow alone is not meaningful work", () => {
  assert.equal(meaningfulVehicleReturn(vehicleReturnCaptureSchema.parse({ kind: "stock" })), false);
  assert.equal(meaningfulVehicleReturn(vehicleReturnCaptureSchema.parse({ kind: "stock", sourceId: "van" })), true);
});
test("stock unload atomically debits vehicle and credits main warehouse with one receipt", () => {
  const state = fixture(), command = freeze(state, "stock");
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.deepEqual(next.stock.find(row => row.warehouseId === "van" && row.itemId === "meter")!.serials, ["B"]);
  assert.deepEqual(next.stock.find(row => row.warehouseId === "main" && row.itemId === "meter")!.serials, ["A"]);
  assert.equal(next.receipts.at(-1)!.vehicleReturn!.kind, "stock");
  assert.equal(next.vehicleReturnDrafts![0].status, "posted");
  assert.equal(state.vehicleReturnDrafts![0].status, "submitting", "engine preserves caller's pre-transaction state");
});
test("duplicate, wrong-location and over-quantity stock scans never post", () => {
  for (const patch of [{ quantities: { meter: "2" }, scans: { meter: "A\nA" } },
    { scans: { meter: "OTHER" } }, { quantities: { meter: "3" }, scans: { meter: "A\nB\nC" } }]) {
    const state = fixture(), command = freeze(state, "stock", patch);
    assert.throws(() => applyInventoryCommand(state, command, "operator", true));
    assert.equal(state.stock.find(row => row.itemId === "meter")!.quantity, 2);
  }
});
test("returning an assembled kit preserves its original captured components", () => {
  let state = fixture();
  state = post(state, "item", { id: "kit", sku: "KIT", name: "Vehicle kit", tracking: "regular",
    components: [{ itemId: "part", quantity: 1 }] });
  state = post(state, "assemble", { warehouseId: "van", itemId: "kit", quantity: 1, serials: [],
    components: [{ itemId: "part", quantity: 1, serials: [] }] });
  const captured = structuredClone(state.kitAssemblies);
  state.items.find(item => item.id === "kit")!.components[0].quantity = 3;
  const command = freeze(state, "stock", { itemIds: ["kit"], quantities: { kit: "1" }, scans: {} });
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(next.stock.find(row => row.warehouseId === "main" && row.itemId === "kit")!.quantity, 1);
  assert.deepEqual(next.kitAssemblies![0].components, captured![0].components);
  assert.equal(next.kitAssemblies!.length, captured!.length, "moving a kit must not invent a new assembly");
});
test("removed equipment acceptance changes custody only; no reusable stock is added", () => {
  const state = fixture();
  state.returns[0].warehouseId = "van";
  const command = freeze(state, "equipment");
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.deepEqual(next.stock, state.stock);
  assert.equal(next.returns[0].status, "quarantine");
  assert.equal(next.returns[0].fieldWarehouseId, "van", "preserve original field disposition for safe work-order reopen checks");
  assert.equal(next.returns[0].warehouseId, "main", "actual custody follows the warehouse receipt");
  assert.equal(next.returns[0].history!.at(-1)!.operationId, command.operationId);
  assert.equal(next.receipts.at(-1)!.vehicleReturn!.equipment![0].serial, "OLD");
});
test("equipment requires exact verified scans and remains protected against repeat acceptance", () => {
  for (const scans of [{ system: "WRONG" }, { system: "OLD\nOLD" }, {}]) {
    const state = fixture(), command = freeze(state, "equipment", { scans });
    assert.throws(() => applyInventoryCommand(state, command, "operator", true), /Scan every/);
  }
  const state = fixture(), command = freeze(state, "equipment");
  state.returns[0].status = "quarantine";
  assert.throws(() => applyInventoryCommand(state, command, "operator", true), /no longer pending/);
});
test("removed equipment can be received into a chosen staging location without adding usable stock", () => {
  const state = post(fixture(), "warehouse", { id: "returns-staging", code: "RETURNS", name: "Returns",
    type: "physical", locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "Returns staging area" });
  const command = freeze(state, "equipment", { destinationId: "returns-staging" });
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(next.returns[0].warehouseId, "returns-staging");
  assert.equal(next.returns[0].status, "quarantine");
  assert.equal(next.receipts.at(-1)!.vehicleReturn!.destinationId, "returns-staging");
  assert.deepEqual(next.stock, state.stock);
});
test("removed-equipment receiving still rejects inactive or vehicle destinations", () => {
  for (const destinationId of ["main", "van"]) {
    const state = fixture();
    if (destinationId === "main") state.warehouses.find(row => row.id === "main")!.active = false;
    const command = freeze(state, "equipment", { destinationId });
    assert.throws(() => applyInventoryCommand(state, command, "operator", true), /active receiving warehouse/);
  }
});
test("matching vehicle verification completes a selected count without changing stock", () => {
  const state = fixture(), command = freeze(state, "count");
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(next.counts.at(-1)!.status, "posted");
  assert.equal(next.receipts.at(-1)!.vehicleReturn!.needsReview, false);
  assert.deepEqual(next.stock, state.stock);
});
test("unexpected/missing serials create an open count with observed evidence, not a stock adjustment", () => {
  const state = fixture(), command = freeze(state, "count", { scans: { meter: "A\nUNEXPECTED" } });
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(next.counts.at(-1)!.status, "open");
  assert.equal(next.counts.at(-1)!.draft!.rows[0].serials, "A\nUNEXPECTED");
  assert.deepEqual(next.receipts.at(-1)!.vehicleReturn!.counts![0].missing, ["B"]);
  assert.deepEqual(next.receipts.at(-1)!.vehicleReturn!.counts![0].unexpected, ["UNEXPECTED"]);
  assert.deepEqual(next.stock, state.stock);
});
test("zero observed quantity is valid for a count and preserves missing-stock evidence", () => {
  const state = fixture(), command = freeze(state, "count", { quantities: { meter: "0" }, scans: { meter: "" } });
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(next.counts.at(-1)!.draft!.rows[0].quantity, "0");
  assert.equal(next.stock.find(row => row.itemId === "meter")!.quantity, 2);
});
test("stock moving after a count baseline blocks stale observations from being finalized", () => {
  const state = fixture(), command = freeze(state, "count");
  state.stock.find(row => row.itemId === "meter")!.revision++;
  assert.throws(() => applyInventoryCommand(state, command, "operator", true), /stock changed/);
});
test("shared retry by another authorized actor returns original receipt without a duplicate movement", () => {
  const state = fixture(), command = freeze(state, "stock");
  const next = applyInventoryCommand(state, command, "operator", true).state;
  assert.equal(applyInventoryCommand(next, command, "other", true).replay, true);
  assert.equal(next.receipts.filter(row => row.id === command.operationId).length, 1);
});
test("unlocking or tampering with frozen command prevents late posting", () => {
  const state = fixture(), command = freeze(state, "stock");
  assert.throws(() => applyInventoryCommand(state, { ...command, operationId: randomUUID() }, "operator", true), /late request/);
  state.vehicleReturnDrafts![0].status = "editing";
  delete state.vehicleReturnDrafts![0].command;
  assert.throws(() => applyInventoryCommand(state, command, "operator", true), /late request/);
});
test("draft baselines, frozen commands and returned-equipment receipts survive relational and backup round trips", () => {
  const state = fixture(), command = freeze(state, "equipment");
  const next = applyInventoryCommand(state, command, "operator", true).state;
  const tables = inventoryToRelational(next, 7);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), next.revision, Object.keys(next));
  assert.deepEqual(restored.vehicleReturnDrafts, next.vehicleReturnDrafts);
  assert.deepEqual(restored.receipts.at(-1)!.vehicleReturn, next.receipts.at(-1)!.vehicleReturn);
  validateInventoryBackup({ version: 1, projectId: 7, exportedAt: new Date().toISOString(), state: restored } as any, [9]);
});
