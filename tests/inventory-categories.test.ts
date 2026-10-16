import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, inventoryCategoryNames, itemSchema, commandPermission, inventoryCommandSchema, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { operationsCsv } from "../client/src/lib/inventory-operations-export";

const post = (s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(s, { action, data, operationId }, "test-maintainer", true).state;
const item = { id: "meter", sku: "MTR", name: "Meter", tracking: "regular" };

test("category commands require maintain permission, validate names, and replay without duplicating", () => {
  assert.equal(commandPermission("category"), "inventory.maintain");
  assert.equal(inventoryCommandSchema.parse({ operationId: randomUUID(), action: "category", data: { name: "Meters" } }).action, "category");
  const initial = emptyInventory();
  const operationId = randomUUID();
  const saved = post(initial, "category", { name: "  Meters  " }, operationId);
  assert.deepEqual(saved.categories, ["Meters"]);
  assert.deepEqual(initial.categories, []);
  assert.deepEqual(post(saved, "category", { name: "  Meters  " }, operationId), saved);
  assert.throws(() => post(saved, "category", { name: "meters" }), /already exists/);
  for (const name of ["", "  ", "x".repeat(501)])
    assert.throws(() => post(saved, "category", { name }));
  const other = post(emptyInventory(), "category", { name: "Meters" });
  assert.deepEqual(other.categories, ["Meters"], "Categories are project-scoped");
});

test("item category must be selected from project categories, and None is an empty string", () => {
  let state = post(emptyInventory(), "category", { name: "Meters" });
  state = post(state, "item", { ...item, category: "meters" });
  assert.equal(state.items[0].category, "Meters");
  assert.throws(() => post(state, "item", { ...item, category: "Unregistered" }), /existing category/);
  state = post(state, "item", { ...item, category: "" });
  assert.equal(state.items[0].category, "");
  state = post(state, "item", item);
  assert.equal(state.items[0].category, "");
  assert.deepEqual(state.stock, []);
});

test("legacy category values are retained and available without migrating historical items", () => {
  const old = emptyInventory();
  delete old.categories;
  old.items.push(itemSchema.parse({ ...item, category: " Legacy Meter Category " }));
  const before = structuredClone(old);
  assert.deepEqual(inventoryCategoryNames(old), [" Legacy Meter Category "]);
  assert.deepEqual(old, before);
  assert.throws(() => post(old, "category", { name: "legacy meter category" }), /already exists/);
  const updated = post(old, "item", { ...old.items[0], description: "Updated" });
  assert.equal(updated.items[0].category, old.items[0].category);
  const added = post(old, "item", { ...item, id: "second", sku: "MTR2", category: " Legacy Meter Category " });
  assert.equal(added.items[1].category, " Legacy Meter Category ");
  const cleared = post(old, "item", { ...old.items[0], category: "" });
  assert.deepEqual(inventoryCategoryNames(cleared), [" Legacy Meter Category "]);
});

test("backups accept old inventories and preserve unused registry categories", () => {
  const state = post(emptyInventory(), "category", { name: "Unused category" });
  const restored = JSON.parse(JSON.stringify({ state, movements: [], enabled: true }));
  validateInventoryBackup(restored, []);
  assert.deepEqual(inventoryCategoryNames(restored.state), ["Unused category"]);
  delete restored.state.categories;
  validateInventoryBackup(restored, []);
  restored.state.categories = ["Meters", "meters"];
  assert.throws(() => validateInventoryBackup(restored, []), /Duplicate inventory categories/);
});

test("category records combine legacy spellings, count usage, filter, and escape CSV", () => {
  const state = emptyInventory();
  state.categories = ["Meters", 'Unused, "supplies"', "=1+2"];
  state.items = [
    itemSchema.parse({ ...item, category: " meters " }),
    itemSchema.parse({ ...item, id: "two", sku: "TWO", category: "METERS" }),
  ];
  const before = structuredClone(state);
  const dataset = buildOperationsDataset("categories", state);
  assert.equal(dataset.rows.length, 3);
  assert.equal(dataset.rows.find(row => row.cells.name === "Meters")?.cells.itemCount, 2);
  assert.equal(filterOperationsRows(dataset, "METERS", {}, dataset.defaultSort).length, 1);
  assert.equal(filterOperationsRows(dataset, "", { usage: "Unused" }, dataset.defaultSort).length, 2);
  const csv = operationsCsv(dataset, dataset.rows);
  assert.ok(csv.includes('"Unused, ""supplies"""'));
  assert.ok(csv.includes("\"'=1+2\""));
  assert.deepEqual(state, before);
});
