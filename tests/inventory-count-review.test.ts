import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand, type InventoryState, type Stock, type StockLine } from "../shared/inventory";
import { inventoryCountReviewIdentity, inventoryCountSerialChanges } from "../shared/inventory-count-review";
import { applyInventoryCommand } from "../shared/inventory-engine";

const catalog = [
  { id: "meter", name: "Meter", sku: "MTR", tracking: "serialized" as const },
  { id: "seal", name: "Seal", sku: "SEAL", tracking: "regular" as const },
];
const baseline: Stock[] = [
  { itemId: "meter", warehouseId: "main", quantity: 2, serials: ["0001", "0002"], revision: 3 },
  { itemId: "seal", warehouseId: "main", quantity: 5, serials: [], revision: 1 },
];
const swap: StockLine[] = [{ itemId: "meter", quantity: 2, serials: ["0001", "0003"] }];
const change = (lines: StockLine[]) => inventoryCountSerialChanges(baseline, lines, catalog);

test("same-quantity serial swap explicitly lists removals, additions and unchanged identities", () => {
  const before = structuredClone({ baseline, swap, catalog });
  assert.deepEqual(change(swap), [{
    itemId: "meter", itemName: "Meter", sku: "MTR", expectedQuantity: 2, actualQuantity: 2,
    missingSerials: ["0002"], unexpectedSerials: ["0003"], unchangedSerialCount: 1,
  }]);
  assert.deepEqual({ baseline, swap, catalog }, before);
});

test("unchanged serialized sets, regular quantities and unselected stock do not create serial discrepancies", () => {
  assert.deepEqual(change([{ itemId: "meter", quantity: 2, serials: ["0002", "0001"] }]), []);
  assert.deepEqual(change([{ itemId: "seal", quantity: 3, serials: [] }]), []);
  assert.deepEqual(change([]), []);
});

test("zero counts show all removals; newly discovered products show all additions with leading zeros", () => {
  assert.deepEqual(change([{ itemId: "meter", quantity: 0, serials: [] }])[0].missingSerials, ["0001", "0002"]);
  const fresh = inventoryCountSerialChanges([], swap, catalog)[0];
  assert.equal(fresh.expectedQuantity, 0);
  assert.deepEqual(fresh.unexpectedSerials, ["0001", "0003"]);
});

test("review identity ignores ordering but binds every material posting value", () => {
  const lines = [...swap, { itemId: "seal", quantity: 4, serials: [] }];
  const identity = inventoryCountReviewIdentity("count", 1, lines, "Physical verification");
  assert.equal(inventoryCountReviewIdentity("count", 1, [...lines].reverse().map(line => ({
    ...line, serials: [...line.serials].reverse(),
  })), "Physical verification"), identity);
  for (const [id, revision, input, reason] of [
    ["different", 1, lines, "Physical verification"],
    ["count", 2, lines, "Physical verification"],
    ["count", 1, [{ ...swap[0], quantity: 1, serials: ["0001"] }], "Physical verification"],
    ["count", 1, [{ ...swap[0], serials: ["0001", "0004"] }], "Physical verification"],
    ["count", 1, lines, "Different reason"],
  ] as const) {
    assert.notEqual(inventoryCountReviewIdentity(id, revision, input, reason), identity);
  }
});

test("large serial reviews include every discrepancy without modifying or truncating the captured list", () => {
  const serials = Array.from({ length: 50000 }, (_, i) => String(i).padStart(8, "0"));
  const lines = [{ itemId: "meter", quantity: serials.length, serials }];
  const result = inventoryCountSerialChanges([], lines, catalog)[0];
  assert.equal(result.unexpectedSerials.length, 50000);
  assert.equal(result.unexpectedSerials.at(-1), "00049999");
  assert.equal(lines[0].serials[0], "00000000");
});

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action, data }, "review-fixture", true).state;

function fixture() {
  let state = post(emptyInventory(), "warehouse", { id: "main", code: "MAIN", name: "Main", type: "physical", address: "Fixture only" });
  state = post(state, "vendor", { id: "vendor", name: "Fixture vendor" });
  state = post(state, "item", { id: "meter", sku: "MTR", name: "Meter", tracking: "serialized" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main", lines: [{ itemId: "meter", quantity: 2 }] });
  state = post(state, "release", { orderId: "po" });
  state = post(state, "receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: ["0001", "0002"] }] });
  return post(state, "countStart", { id: "count", warehouseId: "main", scope: "selected" });
}

test("review describes exactly the engine's atomic serial swap; generating review alone changes nothing", () => {
  const state = fixture(), before = structuredClone(state);
  const review = inventoryCountSerialChanges(state.counts[0].snapshot, swap, state.items);
  assert.deepEqual(state, before);
  const posted = post(state, "countPost", { id: "count", reason: "Verified serial discrepancy", lines: swap });
  assert.deepEqual(posted.stock[0].serials, ["0001", "0003"]);
  assert.equal(posted.stock[0].quantity, 2);
  assert.equal(review[0].missingSerials[0], "0002");
  assert.equal(review[0].unexpectedSerials[0], "0003");
  assert.deepEqual(state, before);
});

test("review does not bypass reserved serial protection or stale count baselines", () => {
  const initial = fixture();
  const reserved = post(initial, "assign", { workOrderId: 123, lines: [{ warehouseId: "main", itemId: "meter", quantity: 1, serials: ["0002"] }] });
  const before = structuredClone(reserved);
  assert.throws(() => post(reserved, "countPost", { id: "count", reason: "Reviewed", lines: swap }), /reserved|available/i);
  assert.deepEqual(reserved, before, "Rejected review must not partially remove/add serials");
  const moved = structuredClone(initial);
  moved.stock[0].revision++;
  assert.throws(() => post(moved, "countPost", { id: "count", reason: "Reviewed", lines: swap }), /Stock moved/);
});
