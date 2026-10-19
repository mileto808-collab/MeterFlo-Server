import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory } from "../shared/inventory";
import { buildOperationsDataset, filterOperationsRows, type OperationsKind } from "../client/src/lib/inventory-operations-data";
import { operationsCsv, operationsPrintHtml } from "../client/src/lib/inventory-operations-export";

function fixture() {
  const state = emptyInventory(), early = "2026-10-19T03:01:17Z", late = "2026-10-19T07:01:17Z";
  state.receipts = ["early", "late", "unknown"].map((id, index) => ({
    id, action: "countPost", reference: id, warehouseId: null, lines: [], actor: "fixture",
    occurredAt: index === 0 ? early : index === 1 ? late : "",
  }));
  state.counts = state.receipts.map(receipt => ({ id: receipt.id, warehouseId: "warehouse", status: "posted", snapshot: [] }));
  state.returns = state.receipts.map(receipt => ({
    id: receipt.id, equipment: "system", serial: receipt.id, workOrderId: 1, disposition: "returned",
    warehouseId: "warehouse", status: "scrapped",
    history: receipt.occurredAt ? [{ operationId: receipt.id, actor: "fixture", occurredAt: receipt.occurredAt, outcome: "scrapped", reason: "Fixture" }] : [],
  }));
  state.shipmentHolds = state.receipts.map(receipt => ({
    id: receipt.id, orderId: "order", receiptId: receipt.id, itemId: "item", warehouseId: "warehouse",
    quantity: 1, serials: [], unidentifiedQuantity: 1, expectedSerials: [], status: "held",
    actor: "fixture", occurredAt: receipt.occurredAt, reason: "Fixture", dispositions: [],
  }));
  return state;
}

for (const kind of ["returns", "exceptions", "counts", "activity"] as OperationsKind[]) {
  test(`${kind}: inclusive project-local dates, open bounds, missing dates, invalid range and exports`, () => {
    const state = fixture(), dataset = buildOperationsDataset(kind, state, [], [], "America/Denver");
    const before = structuredClone(state);
    const select = (from: string, to: string, timezone = "America/Denver") =>
      filterOperationsRows(dataset, "", {}, dataset.defaultSort, { from, to, timezone });
    assert.ok(dataset.dateFilterLabel);
    assert.equal(select("", "").length, 3, "No range preserves undated historical records");
    assert.deepEqual(select("2026-10-18", "2026-10-18").map(row => row.id), ["early"]);
    assert.deepEqual(select("2026-10-19", "2026-10-19").map(row => row.id), ["late"]);
    assert.equal(select("2026-10-18", "2026-10-19").length, 2);
    assert.deepEqual(select("", "2026-10-18").map(row => row.id), ["early"]);
    assert.deepEqual(select("2026-10-19", "").map(row => row.id), ["late"]);
    assert.equal(select("2026-10-20", "2026-10-18").length, 0);
    assert.equal(select("2026-10-19", "2026-10-19", "UTC").length, 2, "UTC is not the project-local day");
    const filtered = select("2026-10-18", "2026-10-18");
    assert.ok(!operationsCsv(dataset, filtered).includes("unknown"));
    const print = operationsPrintHtml({ project: "Test", timezone: "America/Denver" }, kind, dataset, filtered);
    assert.ok(print.includes("1 matching records"));
    assert.deepEqual(state, before, "Filtering does not invent or modify historical timestamps");
  });
}

test("custody and count ranges include any matching recorded event, not only the first", () => {
  const state = fixture();
  state.returns[0].history!.push({ operationId: "later", actor: "fixture", occurredAt: "2026-10-22T12:00:00Z", outcome: "inspection", reason: "Fixture" });
  state.receipts.push({ ...state.receipts[0], id: "later", action: "countPost", occurredAt: "2026-10-22T12:00:00Z" });
  for (const kind of ["returns", "counts"] as const) {
    const dataset = buildOperationsDataset(kind, state);
    assert.deepEqual(filterOperationsRows(dataset, "", {}, dataset.defaultSort,
      { from: "2026-10-22", to: "2026-10-22", timezone: "America/Denver" }).map(row => row.id), ["early"]);
  }
});

test("catalog and location snapshots do not offer misleading date filters", () => {
  for (const kind of ["categories", "locations"] as const) {
    const dataset = buildOperationsDataset(kind, fixture());
    assert.equal(dataset.dateFilterLabel, undefined);
    dataset.rows = [{ id: "record", search: "record", cells: { name: "record" }, facets: {} }];
    assert.equal(filterOperationsRows(dataset, "", {}, dataset.defaultSort,
      { from: "2026-10-20", to: "2026-10-18", timezone: "America/Denver" }).length, 1,
    "Unsupported date filters cannot hide undated catalog records");
  }
});
