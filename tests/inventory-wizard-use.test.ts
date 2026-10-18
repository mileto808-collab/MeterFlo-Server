import test from "node:test";
import assert from "node:assert/strict";
import type { InventoryItem } from "../shared/inventory";
import { actualUseLinesAreValid, bindWizardEquipmentSerials, initialActualUse, plannedInventoryLabels, plannedUseDrafts } from "../shared/inventory-wizard-use";

const product = (id: string, extra: Partial<InventoryItem> = {}): InventoryItem => ({
  id, sku: id.toUpperCase(), name: id, tracking: "regular", equipment: "none", active: true,
  unit: "each", cost: 0, billingRate: 0, reorderPoint: 0, images: [], components: [], ...extra,
});
const items = [
  product("system", { tracking: "serialized", equipment: "system" }),
  product("module", { tracking: "serialized", equipment: "module" }),
  product("seal"), product("labor", { kind: "labor", unit: "job" }),
  product("inner", { components: [{ itemId: "module", quantity: 1 }, { itemId: "seal", quantity: 2 }] }),
  product("kit", { tracking: "serialized", name: "Long kit name must not be displayed",
    components: [{ itemId: "system", quantity: 1 }, { itemId: "inner", quantity: 1 }, { itemId: "labor", quantity: 1.5 }] }),
];
const requirements = [{ itemId: "kit", quantity: 1 }];

test("planned labels show leaf inventory and labor allowances, not nested kit names", () => {
  const labels = plannedInventoryLabels(requirements, items);
  assert.deepEqual(labels.map(row => row.itemId), ["system", "module", "seal", "labor"]);
  assert.equal(labels.find(row => row.itemId === "labor")?.quantity, 1.5);
  assert.equal(labels.find(row => row.itemId === "labor")?.unit, "job");
  assert.equal(labels.find(row => row.itemId === "labor")?.labor, true);
  assert.ok(labels.every(row => !row.label.includes("Long kit")));
});

test("planned loose stock derives quantities without reserving or creating labor stock", () => {
  const lines = plannedUseDrafts(requirements, items, "van", "components");
  assert.deepEqual(lines.map(row => [row.itemId, row.quantity]), [["system", "1"], ["module", "1"], ["seal", "2"]]);
  assert.ok(lines.every(row => row.warehouseId === "van" && !row.reserved && row.serials === ""));
  assert.equal(actualUseLinesAreValid(lines, items, true), true);
  assert.equal(actualUseLinesAreValid(lines, items), false);
  assert.equal(actualUseLinesAreValid(plannedUseDrafts(requirements, items, "", "components"), items, true), false);
});

test("wizard scans bind exact system/module serials and clear or replace them without mutating the draft", () => {
  const original = plannedUseDrafts(requirements, items, "van", "components");
  const bound = bindWizardEquipmentSerials(original, items, { system: "0000123", module: "MOD-0002" });
  assert.equal(actualUseLinesAreValid(bound, items), true);
  assert.equal(bound.find(row => row.itemId === "system")?.serials, "0000123");
  assert.equal(bound.find(row => row.itemId === "module")?.serials, "MOD-0002");
  assert.ok(original.every(row => row.serials === ""));
  assert.equal(bindWizardEquipmentSerials(bound, items, { system: "0000123", module: "MOD-0002" }), bound);
  const corrected = bindWizardEquipmentSerials(bound, items, { system: "0000124", module: "" });
  assert.equal(corrected.find(row => row.itemId === "system")?.serials, "0000124");
  assert.equal(corrected.find(row => row.itemId === "module")?.serials, "");
  assert.equal(actualUseLinesAreValid(corrected, items), false);
});

test("preassembled kit consumes only the kit; its identity is not replaced by the new device scan", () => {
  const lines = plannedUseDrafts(requirements, items, "van", "kits");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].itemId, "kit");
  assert.equal(actualUseLinesAreValid(lines, items, true), false);
  lines[0].serials = "KIT-0001";
  assert.equal(bindWizardEquipmentSerials(lines, items, { system: "0000123", module: "MOD-0002" }), lines);
  assert.equal(actualUseLinesAreValid(lines, items), true);
});

test("planned reservations preserve location, maximums and allowed serials", () => {
  const allocation = { lines: [{ warehouseId: "van", itemId: "kit", quantity: 1, serials: ["KIT-0001"] }] };
  const lines = initialActualUse(allocation, requirements, items);
  assert.equal(lines[0].itemId, "kit");
  assert.equal(lines[0].warehouseId, "van");
  assert.equal(lines[0].quantity, "1");
  assert.equal(lines[0].reserved, true);
  lines[0].serials = "KIT-NOT-RESERVED";
  assert.equal(actualUseLinesAreValid(lines, items), false);
  lines[0].serials = "KIT-0001";
  assert.equal(actualUseLinesAreValid(lines, items), true);
});

test("a planned item can retain split reserved locations without duplicating stock rows", () => {
  const lines = plannedUseDrafts([{ itemId: "seal", quantity: 3 }], items, "", "components", [
    { warehouseId: "van1", itemId: "seal", quantity: 1, serials: [] },
    { warehouseId: "van2", itemId: "seal", quantity: 2, serials: [] },
  ]);
  assert.deepEqual(lines.map(row => [row.warehouseId, row.quantity]), [["van1", "1"], ["van2", "2"]]);
  assert.equal(actualUseLinesAreValid(lines, items), true);
  const partial = plannedUseDrafts([{ itemId: "seal", quantity: 3 }], items, "van1", "components",
    [{ warehouseId: "van1", itemId: "seal", quantity: 1, serials: [] }]);
  assert.equal(partial.length, 1);
  assert.equal(partial[0].quantity, "3");
  assert.equal(partial[0].maxQuantity, 1);
  assert.equal(actualUseLinesAreValid(partial, items), false);
});

test("unplanned reservations still start with zero actual use; scans do not invent quantity-only serials", () => {
  const lines = initialActualUse({ lines: [{ warehouseId: "van", itemId: "seal", quantity: 2, serials: [] }] });
  assert.equal(lines[0].quantity, "0");
  assert.equal(bindWizardEquipmentSerials(lines, items, { system: "0000123", module: "MOD-0002" }), lines);
  assert.equal(initialActualUse(null).length, 0);
});

test("labor, unknown items, multiple equipment units and unrelated serialized hardware cannot bypass validation", () => {
  const one = plannedUseDrafts(requirements, items, "van", "components")[0];
  assert.equal(actualUseLinesAreValid([{ ...one, itemId: "labor" }], items, true), false);
  assert.equal(actualUseLinesAreValid([{ ...one, itemId: "missing" }], items, true), false);
  assert.equal(actualUseLinesAreValid([{ ...one, quantity: "2" }], items, true), false);
  const hardware = product("hardware", { tracking: "serialized" });
  assert.equal(actualUseLinesAreValid([{ ...one, itemId: "hardware" }], [...items, hardware], true), false);
});

