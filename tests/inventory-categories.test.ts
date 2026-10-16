import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, inventoryCategoryNames, itemSchema, commandPermission, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { normalizeInventoryCategories, inventoryCategoryLabels } from "../shared/inventory-categories";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { operationsCsv } from "../client/src/lib/inventory-operations-export";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(state, { action, data, operationId }, "test-maintainer", true).state;
const item = { id: "meter", sku: "MTR", name: "Meter", tracking: "regular" };

test("categories have stable IDs, maintain permission, project scope, and idempotent creation", () => {
  assert.equal(commandPermission("category"), "inventory.maintain");
  assert.equal(commandPermission("categoryRename"), "inventory.maintain");
  const initial = emptyInventory(), id = randomUUID();
  const saved = post(initial, "category", { name: " Meters " }, id);
  assert.deepEqual(saved.categoryCatalog, [{ id, name: "Meters", active: true }]);
  assert.equal(saved.categories, undefined);
  assert.deepEqual(initial.categories, []);
  assert.deepEqual(post(saved, "category", { name: " Meters " }, id), saved);
  assert.throws(() => post(saved, "category", { name: "meters" }), /already exists/);
  for (const name of ["", "  ", "x".repeat(501)]) assert.throws(() => post(saved, "category", { name }));
  assert.deepEqual(inventoryCategoryNames(post(emptyInventory(), "category", { name: "Meters" })), ["Meters"]);
});

test("items select project category IDs and None is null, distinct from a category named None", () => {
  let state = post(emptyInventory(), "category", { name: "None" });
  const id = state.categoryCatalog![0].id;
  state = post(state, "item", { ...item, categoryId: id });
  assert.equal(state.items[0].categoryId, id);
  assert.equal(state.items[0].category, "None");
  assert.throws(() => post(state, "item", { ...item, categoryId: randomUUID() }), /existing category/);
  state = post(state, "item", { ...state.items[0], categoryId: null });
  assert.equal(state.items[0].categoryId, null);
  assert.equal(state.items[0].category, "");
  assert.equal(state.categoryCatalog!.length, 1);
  assert.deepEqual(state.stock, []);
});

test("legacy names migrate without losing unused categories or case/whitespace variant assignments", () => {
  const legacy = emptyInventory();
  legacy.categories = ["Unused"];
  legacy.items = [
    itemSchema.parse({ ...item, category: " Legacy meters " }),
    itemSchema.parse({ ...item, id: "two", sku: "TWO", category: "LEGACY METERS" }),
    itemSchema.parse({ ...item, id: "three", sku: "THREE", category: "" }),
  ];
  const before = structuredClone(legacy), migrated = normalizeInventoryCategories(legacy);
  assert.deepEqual(legacy, before);
  assert.deepEqual(inventoryCategoryNames(migrated), ["Legacy meters", "Unused"]);
  assert.equal(migrated.items[0].categoryId, migrated.items[1].categoryId);
  assert.equal(migrated.items[2].categoryId, null);
  assert.ok(migrated.items.every(value => value.category === ""), "Labels are not persisted as relationships");
  assert.deepEqual(normalizeInventoryCategories(migrated), migrated, "Migration does not reissue IDs");
  const compatible = post(inventoryCategoryLabels(migrated), "item", { ...item, category: "legacy meters" });
  assert.equal(compatible.items[0].categoryId, migrated.items[0].categoryId, "Older clients can select known names");
});

test("renaming changes only the catalog record; item IDs, stock, and historical records stay unchanged", () => {
  let state = post(emptyInventory(), "category", { name: "Meters" });
  const id = state.categoryCatalog![0].id;
  state = post(state, "item", { ...item, categoryId: id });
  state.stock = [{ warehouseId: "warehouse", itemId: "meter", quantity: 5, serials: [] }];
  const before = structuredClone(state), operationId = randomUUID();
  const updated = post(state, "categoryRename", { id, newName: " Electric meters " }, operationId);
  assert.deepEqual(updated.categoryCatalog, [{ id, name: "Electric meters", active: true }]);
  assert.equal(updated.items[0].category, "Electric meters");
  assert.deepEqual(normalizeInventoryCategories(updated).items, normalizeInventoryCategories(before).items);
  assert.deepEqual(updated.stock, before.stock);
  assert.deepEqual(updated.orders, before.orders);
  assert.deepEqual(updated.receipts, before.receipts);
  assert.deepEqual(state, before);
  assert.deepEqual(post(updated, "categoryRename", { id, newName: " Electric meters " }, operationId), updated);
  assert.equal(post(updated, "categoryRename", { id, newName: "ELECTRIC METERS" }).items[0].categoryId, id);
});

test("rename rejects duplicate/invalid names and missing IDs without changing state", () => {
  let state = post(emptyInventory(), "category", { name: "Meters" });
  state = post(state, "category", { name: "Supplies" });
  const before = structuredClone(state), id = state.categoryCatalog![0].id;
  for (const data of [
    { id, newName: " SUPPLIES " }, { id, newName: "" }, { id, newName: "x".repeat(501) },
    { id: randomUUID(), newName: "Other" }, { name: "Meters", newName: "Other" },
  ]) assert.throws(() => post(state, "categoryRename", data));
  assert.deepEqual(state, before);
});

test("portable backups retain category IDs and validate dangling references and duplicate catalogs", () => {
  let state = post(emptyInventory(), "category", { name: "Meters" });
  state = post(state, "item", { ...item, categoryId: state.categoryCatalog![0].id });
  const backup = { state: normalizeInventoryCategories(state), enabled: true, movements: [] };
  validateInventoryBackup(backup, []);
  const restored = JSON.parse(JSON.stringify(backup));
  assert.deepEqual(normalizeInventoryCategories(restored.state), backup.state);
  restored.state.items[0].categoryId = randomUUID();
  assert.throws(() => validateInventoryBackup(restored, []), /missing category/);
  const duplicate = structuredClone(backup);
  duplicate.state.categoryCatalog!.push({ id: randomUUID(), name: "meters", active: true });
  assert.throws(() => validateInventoryBackup(duplicate, []), /Duplicate/);
  const old = { state: emptyInventory(), enabled: true, movements: [] };
  old.state.items = [itemSchema.parse({ ...item, category: "Old category" })];
  validateInventoryBackup(old, []);
  assert.equal(normalizeInventoryCategories(old.state).categoryCatalog![0].name, "Old category");
});

test("category records count by ID and retain search, usage filters, and escaped CSV", () => {
  let state = post(emptyInventory(), "category", { name: 'Unused, "supplies"' });
  state = post(state, "category", { name: "Meters" });
  const id = state.categoryCatalog!.find(c => c.name === "Meters")!.id;
  state = post(state, "item", { ...item, categoryId: id });
  const dataset = buildOperationsDataset("categories", state);
  assert.equal(dataset.rows.find(row => row.id === id)!.cells.itemCount, 1);
  assert.equal(filterOperationsRows(dataset, "meters", {}, dataset.defaultSort).length, 1);
  assert.equal(filterOperationsRows(dataset, "", { usage: "Unused" }, dataset.defaultSort).length, 1);
  assert.match(operationsCsv(dataset, dataset.rows), /"Unused, ""supplies"""/);
});

test("inactive category assignments survive unrelated edits, but cannot be newly assigned", () => {
  let state = post(emptyInventory(), "category", { name: "Meters" });
  const id = state.categoryCatalog![0].id;
  state = post(state, "item", { ...item, categoryId: id });
  state.categoryCatalog![0].active = false;
  state = post(state, "item", { ...state.items[0], description: "Changed" });
  assert.equal(state.items[0].categoryId, id);
  assert.throws(() => post(state, "item", { ...item, id: "two", sku: "TWO", categoryId: id }), /active category/);
});
