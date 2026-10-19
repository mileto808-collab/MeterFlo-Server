import test from "node:test";
import assert from "node:assert/strict";
import { inventoryReceiptContexts } from "../shared/inventory-receipt-context";
import { inventoryPrint } from "../server/inventoryPrint";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { receiptIdentifierFixture } from "./support/inventory-receipt-identifiers-fixture";

test("receipt relationships follow record/history identities, not shared serials or notes", () => {
  const { state } = receiptIdentifierFixture(), before = structuredClone(state);
  const contexts = inventoryReceiptContexts(state);
  for (const id of ["capture-195", "accept-195", "decide-195"]) {
    assert.deepEqual(contexts.get(id)?.workOrderIds, [195]);
    assert.deepEqual(contexts.get(id)?.removed.map(record => record.id), ["wo-195-system-1"]);
  }
  assert.deepEqual(contexts.get("capture-196")?.workOrderIds, [196]);
  assert.deepEqual(contexts.get("unrelated")?.workOrderIds, []);
  assert.deepEqual(state, before);
});

test("receipts display customer work-order IDs, retain raw references, and fall back to internal IDs", () => {
  const { state, labels } = receiptIdentifierFixture(), before = structuredClone(state);
  const html = inventoryPrint("receipt", state.receipts[2], state, "Fixture", [], "America/New_York", labels);
  assert.match(html, /Operation reference: Work order 0002048 · System OLD001/);
  assert.doesNotMatch(html, /Operation reference: wo-195-system-1/);
  assert.match(inventoryPrint("receipt", state.receipts[3], state, "Fixture", [], "UTC", labels), /Operation reference: Work order 196/);
  assert.match(inventoryPrint("receipt", state.receipts[4], state, "Fixture", [], "UTC", labels), /Operation reference: other-operation/);
  const escaped = inventoryPrint("receipt", state.receipts[2], state, "Fixture", [], "UTC", { "195": "<Customer & WO>" });
  assert.match(escaped, /Work order &lt;Customer &amp; WO&gt;/);
  assert.doesNotMatch(escaped, /Work order <Customer/);
  assert.deepEqual(state, before);
});

for (const kind of ["activity", "returns"] as const) {
  test(`${kind} has independently searchable internal, customer and old/new equipment identifiers`, () => {
    const { state, labels, identifiers } = receiptIdentifierFixture();
    const dataset = buildOperationsDataset(kind, state, [], [], "America/New_York", labels, identifiers);
    assert.equal(dataset.searchFilters?.length, 3);
    const selected = (key: string, value: string) =>
      filterOperationsRows(dataset, "", { [key]: value }, dataset.defaultSort);
    const expected = kind === "activity" ? 3 : 1;
    for (const [key, value] of [["systemWorkOrderId", "195"], ["customerWorkOrderId", "0002"],
      ["equipmentId", "new001"], ["equipmentId", "NEW-MODULE"]]) {
      assert.equal(selected(key, value).length, expected, `${key}: ${value}`);
    }
    assert.equal(selected("customerWorkOrderId", "196").length, 0, "Missing customer IDs must not be invented from internal IDs");
    assert.equal(selected("systemWorkOrderId", "196").length, 1);
    assert.equal(selected("equipmentId", "OLD001").length, kind === "activity" ? 4 : 2);
    assert.equal(filterOperationsRows(dataset, "", { systemWorkOrderId: "196", customerWorkOrderId: "0002048" }, dataset.defaultSort).length, 0);
    assert.equal(filterOperationsRows(dataset, "NEW-MODULE", {}, dataset.defaultSort).length, expected);
    assert.equal(filterOperationsRows(dataset, "", { customerWorkOrderId: "all" }, dataset.defaultSort).length, 0, "Literal identifier 'all' is not a facet wildcard");
    assert.equal(filterOperationsRows(dataset, "", { systemWorkOrderId: " 195 " }, dataset.defaultSort).length, expected);
  });
}

test("identifier filters combine with facets and project-timezone dates without changing the full ledger", () => {
  const { state, labels, identifiers } = receiptIdentifierFixture();
  const dataset = buildOperationsDataset("activity", state, [], [], "America/New_York", labels, identifiers);
  const rows = filterOperationsRows(dataset, "", { systemWorkOrderId: "195", action: "returnAccept" }, dataset.defaultSort,
    { from: "2026-10-18", to: "2026-10-18", timezone: "America/New_York" });
  assert.deepEqual(rows.map(row => row.id), ["accept-195"]);
  assert.match(String(rows[0].cells.reference), /0002048/);
  assert.equal(filterOperationsRows(dataset, "", { systemWorkOrderId: "195" }, dataset.defaultSort,
    { from: "2026-10-19", to: "2026-10-19", timezone: "America/New_York" }).length, 0);
  assert.equal(dataset.rows.length, 5);
  assert.equal(state.receipts.length, 5);
});
