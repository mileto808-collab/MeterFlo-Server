import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { countStockScopeMatches } from "../shared/inventory-count-stock";
import { inventoryCountRows, inventoryCountLines } from "../client/src/lib/inventory-count-form";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action, data }, "fixture", true).state;

function fixture() {
  let state = post(emptyInventory(), "warehouse", { id: "main", code: "MAIN", name: "Main", type: "physical", address: "Test only" });
  state = post(state, "vendor", { id: "vendor", name: "Fixture supplier" });
  state = post(state, "item", { id: "regular", sku: "REG", name: "Regular", tracking: "regular" });
  state = post(state, "item", { id: "serial", sku: "SER", name: "Serialized", tracking: "serialized" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main",
    lines: [{ itemId: "regular", quantity: 3 }, { itemId: "serial", quantity: 2 }] });
  state = post(state, "release", { orderId: "po" });
  return post(state, "receive", { orderId: "po", lines: [
    { itemId: "regular", quantity: 3 }, { itemId: "serial", quantity: 2, serials: ["S1", "S2"] },
  ] });
}
const start = (state = fixture()) => post(state, "countStart", { id: "selected", warehouseId: "main", scope: "selected" });
const regularLine = { itemId: "regular", quantity: 2, serials: [] };

test("selected count starts empty while retaining the immutable stock baseline", () => {
  const before = fixture(), state = start(before), count = state.counts[0];
  assert.equal(count.scope, "selected");
  assert.equal(count.snapshot.length, 2);
  assert.deepEqual(state.stock, before.stock);
  assert.deepEqual(inventoryCountRows(count, state.items, {}, {}), []);
  const rows = inventoryCountRows(count, state.items, { regular: "" }, {});
  assert.equal(rows.length, 1);
  assert.equal(rows[0].quantity, "");
  assert.throws(() => inventoryCountLines(rows), /Blank is not zero/);
  assert.equal(count.snapshot.find(row => row.itemId === "regular")?.quantity, 3);
});

test("selected draft and relational roundtrip restore only explicitly added entries", () => {
  let state = start();
  const snapshot = structuredClone(state.counts[0].snapshot), stock = structuredClone(state.stock);
  state = post(state, "countSaveDraft", { id: "selected", revision: 0, reason: "Fixture count",
    rows: [{ itemId: "regular", quantity: "2", serials: "" }] });
  assert.deepEqual(state.counts[0].snapshot, snapshot);
  assert.deepEqual(state.stock, stock);
  const tables = inventoryToRelational(state, 1);
  const hydrated = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, structuredClone(table.rows)])), state.revision, Object.keys(state));
  assert.equal(hydrated.counts[0].scope, "selected");
  const rows = inventoryCountRows(hydrated.counts[0], hydrated.items, {}, {});
  assert.deepEqual(rows.map(row => row.itemId), ["regular"]);
  assert.equal(rows[0].quantity, "2");
});

test("posting selected products leaves all unselected quantities and serial custody untouched", () => {
  const state = start();
  const serialStock = structuredClone(state.stock.find(row => row.itemId === "serial"));
  const serialRegistry = structuredClone(state.serialRegistry);
  const result = post(state, "countPost", { id: "selected", reason: "One product verified", lines: [regularLine] });
  assert.equal(result.counts[0].status, "posted");
  assert.equal(result.stock.find(row => row.itemId === "regular")?.quantity, 2);
  assert.deepEqual(result.stock.find(row => row.itemId === "serial"), serialStock);
  assert.deepEqual(result.serialRegistry, serialRegistry);
  assert.deepEqual(result.counts[0].lines, [regularLine]);
});

test("selected stock movement blocks posting, unrelated stock movement does not", () => {
  const state = start();
  const unrelated = structuredClone(state);
  unrelated.stock.find(row => row.itemId === "serial")!.revision++;
  assert.equal(countStockScopeMatches(unrelated.counts[0], unrelated.stock, ["regular"]), true);
  assert.doesNotThrow(() => post(unrelated, "countPost", { id: "selected", reason: "Only regular counted", lines: [regularLine] }));
  const selected = structuredClone(state);
  selected.stock.find(row => row.itemId === "regular")!.revision++;
  assert.equal(countStockScopeMatches(selected.counts[0], selected.stock, ["regular"]), false);
  assert.throws(() => post(selected, "countPost", { id: "selected", reason: "Outdated count", lines: [regularLine] }), /Stock moved/);
});

test("selected counts cannot post empty or omit a previously saved selection", () => {
  let state = start();
  assert.throws(() => post(state, "countPost", { id: "selected", reason: "Empty selection", lines: [] }), /at least one product/);
  state = post(state, "countSaveDraft", { id: "selected", revision: 0, reason: "", rows: [
    { itemId: "regular", quantity: "2", serials: "" }, { itemId: "serial", quantity: "2", serials: "S1\nS2" },
  ] });
  assert.throws(() => post(state, "countPost", { id: "selected", draftRevision: 1, reason: "Missing saved row", lines: [regularLine] }), /every saved count entry/);
});

test("selected serial counts still validate scanners and protect reserved stock", () => {
  const state = start();
  assert.throws(() => post(state, "countPost", { id: "selected", reason: "Bad serials",
    lines: [{ itemId: "serial", quantity: 2, serials: ["S1"] }] }), /serial/i);
  const assigned = post(fixture(), "assign", { workOrderId: 1,
    lines: [{ itemId: "regular", warehouseId: "main", quantity: 2 }] });
  assert.throws(() => post(start(assigned), "countPost", { id: "selected", reason: "Cannot erase reservations",
    lines: [{ itemId: "regular", quantity: 1 }] }), /reserved stock/);
});

test("legacy full-warehouse counts still require every snapshot row", () => {
  const state = post(fixture(), "countStart", { id: "full", warehouseId: "main" });
  assert.equal(inventoryCountRows(state.counts[0], state.items, {}, {}).length, 2);
  assert.throws(() => post(state, "countPost", { id: "full", reason: "Incomplete full count", lines: [regularLine] }), /every item/);
});
