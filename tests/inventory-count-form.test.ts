import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { inventoryCountRows, inventoryCountLines } from "../client/src/lib/inventory-count-form";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { COUNT_MAX_LINES, COUNT_MAX_BYTES } from "../shared/inventory-count-limits";

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
  const rows = inventoryCountRows(state.counts[0], state.items, { regular: "0" }, {});
  assert.throws(() => inventoryCountLines(Array(COUNT_MAX_LINES + 1).fill(rows[0])), /2000-item/);
});

test("large catalogs do not force unused products into complete atomic counts", () => {
  let state = fixture();
  const base = state.items.find(item => item.id === "regular")!;
  state.items.push(...Array.from({ length: 3000 }, (_, n) => ({ ...base, id: `large-${n}`, sku: `LARGE-${n}` })));
  state.stock = Array.from({ length: COUNT_MAX_LINES - 1 }, (_, n) => ({
    warehouseId: "main", itemId: `large-${n}`, quantity: 2, serials: [], revision: 0,
  }));
  state = post(state, "countStart", { id: "large", warehouseId: "main" });
  const quantities = { "large-2999": "0", "large-0": "0" };
  const rows = inventoryCountRows(state.counts[0], state.items, quantities, {});
  assert.equal(rows.length, COUNT_MAX_LINES);
  assert.ok(!rows.some(row => row.itemId === "large-2500"), "unused catalog items are excluded");
  const lines = inventoryCountLines(rows);
  const saved = post(state, "countSaveDraft", { id: "large", revision: 0, reason: "Large saved draft",
    rows: rows.map(row => ({ itemId: row.itemId, quantity: row.quantity, serials: row.serials })) });
  assert.equal(saved.counts[0].draft?.rows.length, COUNT_MAX_LINES);
  assert.equal(inventoryCountRows(JSON.parse(JSON.stringify(saved.counts[0])), state.items, {}, {}).length, COUNT_MAX_LINES);
  const before = JSON.stringify(state);
  assert.throws(() => post(state, "countPost", { id: "large", reason: "Missing one", lines: lines.slice(1) }), /every item/);
  assert.equal(JSON.stringify(state), before);
  const begin = performance.now();
  const completed = post(state, "countPost", { id: "large", reason: "Complete physical count", lines });
  console.log(JSON.stringify({ metric: "engine.countPost2000", milliseconds: Math.round(performance.now() - begin) }));
  assert.equal(completed.counts[0].lines!.length, COUNT_MAX_LINES);
  assert.equal(completed.stock.find(row => row.itemId === "large-0")!.quantity, 0);
  assert.equal(completed.stock.find(row => row.itemId === "large-2999")!.quantity, 0);
  assert.throws(() => inventoryCountLines([...rows, { ...rows[0], itemId: "large-2500" }]), /2000-item/);
  assert.throws(() => post(state, "countPost", { id: "large", reason: "Too large", lines: [...lines, { itemId: "large-2500", quantity: 0 }] }), /2000/);
  const moved = structuredClone(state);
  moved.stock[0].quantity++;
  assert.throws(() => post(moved, "countPost", { id: "large", reason: "Stale", lines }), /Stock moved/);
  const tooLarge = structuredClone(state);
  tooLarge.stock.push(...[2000, 2001].map(n => ({ warehouseId: "main", itemId: `large-${n}`, quantity: 0, serials: [], revision: 0 })));
  assert.throws(() => post(tooLarge, "countStart", { id: "oversized", warehouseId: "main" }), /2000-item/);
  assert.throws(() => post(state, "countSaveDraft", { id: "large", revision: 0, reason: "Oversized",
    rows: [{ itemId: "regular", quantity: "0", serials: "x".repeat(COUNT_MAX_BYTES) }] }), /8 MiB/);
  const serialized = structuredClone(state);
  const serialLines = Array.from({ length: 6 }, (_, n) => {
    serialized.items.push({ ...base, id: `serial-limit-${n}`, sku: `SER-LIMIT-${n}`, tracking: "serialized" });
    return { itemId: `serial-limit-${n}`, quantity: 10000, serials: Array.from({ length: 10000 }, (_, serial) => `S${n}-${serial}`) };
  });
  assert.throws(() => post(serialized, "countPost", { id: "large", reason: "Too many serials", lines: [...lines, ...serialLines] }), /2000/);
  const small = post(fixture(), "countStart", { id: "small", warehouseId: "main" });
  small.items.push(...serialized.items.filter(item => item.id.startsWith("serial-limit-")));
  assert.throws(() => post(small, "countPost", { id: "small", reason: "Too many serials", lines: serialLines }), /50000-serial/);
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
