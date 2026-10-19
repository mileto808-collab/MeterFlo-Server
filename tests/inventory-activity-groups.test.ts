import test from "node:test";
import assert from "node:assert/strict";
import { inventoryActivityGroups } from "../shared/inventory-activity-groups";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { groupedInventoryActivity } from "../client/src/lib/inventory-activity-data";
import { inventoryActivityPrint } from "../server/inventoryActivityPrint";
import { receiptIdentifierFixture } from "./support/inventory-receipt-identifiers-fixture";
import { activityBatchFixture } from "./support/inventory-activity-groups-fixture";

test("one summary follows all removed-equipment transactions without merging matching serials, locations or notes", () => {
  const { state, labels } = receiptIdentifierFixture(), before = structuredClone(state);
  const groups = inventoryActivityGroups(state, labels);
  assert.equal(groups.length, 3);
  const removed = groups.find(group => group.returnIds.includes("wo-195-system-1"))!;
  assert.deepEqual(removed.receipts.map(receipt => receipt.id), ["capture-195", "accept-195", "decide-195"]);
  assert.match(removed.title, /Work order 0002048/);
  assert.ok(!removed.returnIds.includes("wo-196-system-1"), "Same serial is not a relationship");
  assert.ok(!removed.receipts.some(receipt => receipt.id === "unrelated"), "Notes are not a relationship");
  assert.deepEqual(state, before);
  assert.deepEqual(groups.flatMap(group => group.receipts.map(receipt => receipt.id)).sort(), state.receipts.map(receipt => receipt.id).sort());
});

test("a batch handoff produces one summary containing every equipment history, once", () => {
  const { state, labels } = activityBatchFixture(), before = structuredClone(state);
  const groups = inventoryActivityGroups(state, labels), batch = groups.find(group => group.batch)!;
  assert.equal(groups.length, 2);
  assert.equal(batch.receipts.length, 5);
  assert.equal(batch.returnIds.length, 2);
  assert.match(batch.title, /Customer return batch · 2 equipment · SHIP-001/);
  assert.equal(new Set(batch.receipts.map(receipt => receipt.id)).size, 5);
  assert.deepEqual(state, before);
});

test("purchase/transfer batches group dispatch, receipt and hold disposition via exact order/receipt identities", () => {
  const { state } = receiptIdentifierFixture();
  state.orders = [{ id: "order-1", orderNumber: "TR-2026-000001", reference: "Customer transfer",
    type: "transfer", vendorId: null, sourceId: "main", destinationId: "main", lines: [], received: [], dispatched: [],
    status: "completed", notes: "", createdAt: "2026-10-18T00:00:00Z" }];
  const base = { lines: [], warehouseId: "main", actor: "fixture", occurredAt: "2026-10-19T05:00:00Z" };
  state.receipts.push({ ...base, id: "dispatch", action: "dispatch", reference: "order-1" },
    { ...base, id: "receive", action: "accept", reference: "order-1" },
    { ...base, id: "hold-decision", action: "resolveHold", reference: "hold-1", holdId: "hold-1" });
  state.shipmentHolds = [{ id: "hold-1", orderId: "order-1", receiptId: "receive", warehouseId: "main", actor: "fixture",
    occurredAt: base.occurredAt, status: "scrapped", itemId: "item", quantity: 1, serials: [], reason: "Damaged" }];
  const order = inventoryActivityGroups(state).find(group => group.receipts.some(receipt => receipt.id === "dispatch"))!;
  assert.deepEqual(order.receipts.map(receipt => receipt.id), ["dispatch", "receive", "hold-decision"]);
  assert.match(order.title, /TR-2026-000001/);
});

test("filters must match one transaction, not combine an action from one event with a date from another", () => {
  const { state, labels, identifiers } = activityBatchFixture();
  const raw = buildOperationsDataset("activity", state, [], [], "America/New_York", labels, identifiers);
  const grouped = groupedInventoryActivity(raw, inventoryActivityGroups(state, labels));
  const matches = (selected: Record<string, string>, from = "", to = "") =>
    filterOperationsRows(grouped, "", selected, grouped.defaultSort, { from, to, timezone: "America/New_York" });
  assert.equal(matches({ action: "returnDecide" }, "2026-10-19", "2026-10-19").length, 0);
  const selected = matches({ action: "returnDecide" }, "2026-10-18", "2026-10-18");
  assert.equal(selected.length, 1);
  assert.equal(selected[0].children?.length, 5, "Matching summary retains the complete history");
  assert.equal(matches({ systemWorkOrderId: "196" }).length, 1);
  assert.equal(filterOperationsRows(grouped, "SHIP-001", {}, grouped.defaultSort).length, 1);
  assert.match(String(selected[0].cells.history), /Customer handoff/);
  assert.equal(state.receipts.length, 6, "Grouping never replaces ledger records");
});

for (const verification of ["scan", "visual"] as const) {
  test(`batch history print includes all receipts and the separate ${verification} serial manifest`, () => {
    const { state, labels } = activityBatchFixture(verification);
    const batch = inventoryActivityGroups(state, labels).find(group => group.batch)!;
    const html = inventoryActivityPrint(batch, state, "Fixture <Project>", [{ id: "fixture", username: "Warehouse user" }],
      "America/New_York", labels);
    assert.equal((html.match(/data-receipt-id=/g) ?? []).length, 5);
    assert.equal((html.match(/<html>/g) ?? []).length, 1);
    assert.equal((html.match(/<body>/g) ?? []).length, 1);
    assert.equal((html.match(/<button/g) ?? []).length, 1);
    assert.match(html, /Fixture &lt;Project&gt;/);
    assert.match(html, /Warehouse user/);
    assert.match(html, /Work order 0002048/);
    assert.match(html, /Customer return serials/);
    assert.match(html, verification === "scan" ? /Every serial scanned/ : /Every serial visually inspected/);
    assert.match(html, /OLD001/); assert.match(html, /OLD002/);
    assert.match(html, /break-before:page/);
    assert.match(html, /EDT/);
    assert.doesNotMatch(html, /Mentioning 195/, "Unrelated receipt must not enter a printed history");
    assert.match(html, /Field disposition: Returned to warehouse/);
    assert.match(html, /Warehouse decision: Return to customer/);
  });
}

test("authorization scope is inherited; a supplied visible subset cannot print excluded ledger entries", () => {
  const { state, labels } = activityBatchFixture();
  state.receipts = state.receipts.filter(receipt => receipt.id === "decide-195");
  state.returns = state.returns.filter(record => record.workOrderId === 195);
  state.customerHandoffs = [];
  const group = inventoryActivityGroups(state, labels)[0];
  const html = inventoryActivityPrint(group, state, "Fixture", [], "UTC", labels);
  assert.equal(group.receipts.length, 1);
  assert.doesNotMatch(html, /data-receipt-id="accept-195"/);
  assert.doesNotMatch(html, /OLD002/);
});
