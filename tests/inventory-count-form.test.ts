import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inventoryCountRows, inventoryCountLines } from "../client/src/lib/inventory-count-form";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";

function post(s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>) {
  return applyInventoryCommand(s, { operationId: randomUUID(), action, data }, "fixture", true).state;
}
function fixture() {
  let state = post(emptyInventory(), "warehouse", { id: "main", code: "MAIN", name: "Main", type: "physical", address: "Fixture" });
  state = post(state, "item", { id: "serial", sku: "SER", name: "Serialized", tracking: "serialized" });
  state = post(state, "item", { id: "regular", sku: "REG", name: "Regular", tracking: "regular" });
  return state;
}

test("empty warehouse submits newly found regular and serialized items and explicit zeros", () => {
  let state = post(fixture(), "countStart", { id: "count", warehouseId: "main" });
  const rows = inventoryCountRows(state.counts[0], state.items, { regular: "4", serial: "2" }, { serial: "00001;\n00002" });
  const lines = inventoryCountLines(rows);
  state = post(state, "countPost", { id: "count", lines, reason: "Found and verified stock" });
  assert.equal(state.stock.find(b => b.itemId === "regular")?.quantity, 4);
  assert.deepEqual(state.stock.find(b => b.itemId === "serial")?.serials, ["00001", "00002"]);
  state = post(state, "countStart", { id: "zero", warehouseId: "main" });
  const zeros = inventoryCountLines(inventoryCountRows(state.counts[1], state.items, { regular: "0", serial: "0" }, { serial: "" }));
  state = post(state, "countPost", { id: "zero", lines: zeros, reason: "Physical zero confirmed" });
  assert.ok(state.stock.every(b => b.quantity === 0 && b.serials.length === 0));
});

test("untouched displayed defaults are submitted exactly and do not move stock", () => {
  let state = fixture();
  state = post(state, "countStart", { id: "seed", warehouseId: "main" });
  state = post(state, "countPost", { id: "seed", reason: "Fixture", lines: [
    { itemId: "serial", quantity: 1, serials: ["00001"] }, { itemId: "regular", quantity: 5 },
  ] });
  state = post(state, "countStart", { id: "unchanged", warehouseId: "main" });
  const before = structuredClone(state.stock);
  const rows = inventoryCountRows(state.counts[1], state.items, {}, {});
  assert.equal(rows.find(r => r.itemId === "serial")?.serials, "00001");
  const lines = inventoryCountLines(rows);
  state = post(state, "countPost", { id: "unchanged", lines, reason: "Verified unchanged" });
  assert.deepEqual(state.stock, before);
  assert.deepEqual(state.counts[1].lines, lines);
});

test("blank/invalid quantity, mismatched/duplicate scans, unavailable rows and oversized counts fail instead of dropping data", () => {
  const state = post(fixture(), "countStart", { id: "count", warehouseId: "main" });
  const build = (quantities: Record<string, string>, serials: Record<string, string> = {}) =>
    inventoryCountLines(inventoryCountRows(state.counts[0], state.items, quantities, serials));
  for (const quantity of ["", " ", "-1", "1.5", "Infinity", "1000001"])
    assert.throws(() => build({ regular: quantity }), /whole quantity/);
  assert.throws(() => build({ serial: "2" }, { serial: "00001" }), /distinct serial/);
  assert.throws(() => build({ serial: "2" }, { serial: "00001,00001" }), /distinct serial/);
  assert.throws(() => build({ serial: "0" }, { serial: "00001" }), /counting zero/);
  const missing = { ...state.counts[0], snapshot: [{ warehouseId: "main", itemId: "missing", quantity: 0, serials: [], revision: 0 }] };
  assert.throws(() => inventoryCountLines(inventoryCountRows(missing, state.items, {}, {})), /no longer in the catalog/);
  const rows = inventoryCountRows(state.counts[0], state.items, {}, {});
  assert.throws(() => inventoryCountLines(Array(501).fill(rows[0])), /500-item/);
});

test("complete form payloads still reject stale stock and removal of reservations atomically", () => {
  let state = post(fixture(), "countStart", { id: "seed", warehouseId: "main" });
  state = post(state, "countPost", { id: "seed", reason: "Fixture", lines: [
    { itemId: "regular", quantity: 5 }, { itemId: "serial", quantity: 1, serials: ["00001"] },
  ] });
  state = post(state, "assign", { workOrderId: 1, lines: [{ itemId: "regular", warehouseId: "main", quantity: 2 }] });
  state = post(state, "countStart", { id: "reserved", warehouseId: "main" });
  const lines = inventoryCountLines(inventoryCountRows(state.counts[1], state.items, { regular: "0" }, {}));
  const before = structuredClone(state);
  assert.throws(() => post(state, "countPost", { id: "reserved", lines, reason: "Attempt zero" }), /reserved stock/);
  assert.deepEqual(state, before);
  state = post(state, "countStart", { id: "other", warehouseId: "main" });
  state = post(state, "countPost", { id: "other", lines: [
    { itemId: "regular", quantity: 6 }, { itemId: "serial", quantity: 1, serials: ["00001"] },
  ], reason: "Other verified count" });
  const stale = inventoryCountLines(inventoryCountRows(state.counts[1], state.items, {}, {}));
  const moved = structuredClone(state);
  assert.throws(() => post(state, "countPost", { id: "reserved", lines: stale, reason: "Old snapshot" }), /Stock moved/);
  assert.deepEqual(state, moved);
});
