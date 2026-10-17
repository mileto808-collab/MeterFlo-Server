import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, itemSchema, warehouseSchema, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { inventoryCountRows, inventoryCountLines } from "../client/src/lib/inventory-count-form";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";
import { storedCategoryState } from "../server/inventoryCategories";

function fixture() {
  const state = emptyInventory();
  state.items = ["meter", "seal", "spare"].map(id => itemSchema.parse({ id, sku: id, name: id, tracking: id === "meter" ? "serialized" : "regular" }));
  state.warehouses = [warehouseSchema.parse({ id: "main", code: "MAIN", name: "Main", type: "physical", address: "Test" })];
  state.stock = [
    { itemId: "meter", warehouseId: "main", quantity: 2, serials: ["00001", "00002"] },
    { itemId: "seal", warehouseId: "main", quantity: 8, serials: [] },
  ];
  return state;
}
const post = (state: InventoryState, data: Record<string, unknown>) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action: "countStart", data }, "counter", true).state;

test("selected products are saved atomically as blank entries without narrowing the fixed warehouse snapshot", () => {
  const before = fixture();
  const state = post(before, { id: "count", warehouseId: "main", scope: "selected", itemIds: ["meter", "spare"] });
  const count = state.counts[0];
  assert.deepEqual(count.snapshot, before.stock);
  assert.equal(count.scope, "selected");
  assert.equal(count.draft!.revision, 1);
  assert.equal(count.draft!.savedBy, "counter");
  assert.deepEqual(count.draft!.rows, ["meter", "spare"].map(itemId => ({ itemId, quantity: "", serials: "" })));
  const rows = inventoryCountRows(count, state.items, {}, {});
  assert.deepEqual(rows.map(row => row.itemId), ["meter", "spare"]);
  assert.throws(() => inventoryCountLines(rows), /Blank is not zero/);
  assert.deepEqual(before.counts, []);
  assert.deepEqual(state.stock, before.stock);
  const normalized = normalizeInventoryLocations(storedCategoryState(state));
  const tables = inventoryToRelational(normalized, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), normalized.revision, Object.keys(normalized));
  assert.deepEqual(restored.counts[0].draft, count.draft);
});

test("warehouse option retains complete snapshot entries and selected-empty compatibility still works", () => {
  const state = fixture();
  const full = post(state, { id: "full", warehouseId: "main", scope: "warehouse" }).counts[0];
  assert.deepEqual(inventoryCountRows(full, state.items, {}, {}).map(row => row.itemId), ["meter", "seal"]);
  const selected = post(state, { id: "selected", warehouseId: "main", scope: "selected" }).counts[0];
  assert.deepEqual(inventoryCountRows(selected, state.items, {}, {}), []);
});

test("invalid product selection fails atomically and cannot seed another project's or inactive products", () => {
  const state = fixture();
  state.items[2].active = false;
  const original = structuredClone(state);
  for (const data of [
    { scope: "warehouse", itemIds: ["meter"] },
    { itemIds: ["meter"] },
    { scope: "selected", itemIds: ["meter", "meter"] },
    { scope: "selected", itemIds: ["other-project-item"] },
    { scope: "selected", itemIds: ["spare"] },
    { scope: "selected", itemIds: [] },
  ]) {
    assert.throws(() => post(state, { id: "count", warehouseId: "main", ...data }));
    assert.deepEqual(state, original);
  }
});

test("posting a selected count adjusts chosen products only and requires its seeded draft revision", () => {
  let state = post(fixture(), { id: "count", warehouseId: "main", scope: "selected", itemIds: ["seal"] });
  const command: InventoryCommand = { operationId: randomUUID(), action: "countPost", data: {
    id: "count", reason: "Physical count", draftRevision: 1, lines: [{ itemId: "seal", quantity: 7, serials: [] }],
  } };
  assert.throws(() => applyInventoryCommand(state, { ...command, data: { ...command.data, draftRevision: 0 } }, "counter", true), /draft changed/);
  state = applyInventoryCommand(state, command, "counter", true).state;
  assert.equal(state.stock.find(stock => stock.itemId === "seal")!.quantity, 7);
  assert.deepEqual(state.stock.find(stock => stock.itemId === "meter")!.serials, ["00001", "00002"]);
});
