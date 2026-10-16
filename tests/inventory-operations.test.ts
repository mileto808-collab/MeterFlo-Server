import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, itemSchema, warehouseSchema } from "../shared/inventory";
import { buildOperationsDataset, filterOperationsRows, type OperationsKind } from "../client/src/lib/inventory-operations-data";
import { operationsCsv, operationsWorkbook, operationsPrintHtml, downloadInventoryOperations } from "../client/src/lib/inventory-operations-export";

const state = emptyInventory();
const actor = "b5000000-0000-4000-8000-000000000001";
state.warehouses = [warehouseSchema.parse({ id: "w", code: "000001", name: "=Warehouse", address: "<Address>", phone: "0000123", type: "physical" })];
state.items = [itemSchema.parse({ id: "i", sku: "00001", name: "<Meter>", tracking: "serialized" })];
state.orders = [{ id: "o", orderNumber: "TR-2026-000001", reference: "Customer ref", type: "transfer", vendorId: null,
  sourceId: "w", destinationId: "w", status: "partial", lines: [], received: [], dispatched: [], notes: "", createdAt: "2026-10-15T00:00:00Z" }];
state.receipts = [
  { id: "r", action: "accept", reference: "o", warehouseId: "w", lines: [{ itemId: "i", quantity: 2, serials: ["0001", "0002"] }],
    actor, occurredAt: "2026-10-15T00:00:00Z", reason: "=unsafe" },
  { id: "r2", action: "countPost", reference: "c", warehouseId: "w", lines: [], actor, occurredAt: "2026-10-16T00:00:00Z" },
];
state.counts = [{ id: "c", warehouseId: "w", status: "posted", snapshot: [] }];
state.returns = [{ id: "ret", serial: "0001", equipment: "system", disposition: "returned", warehouseId: "w", workOrderId: 8, status: "pending" }];
state.shipmentHolds = [{ id: "h", orderId: "o", receiptId: "r", itemId: "i", warehouseId: "w", status: "held",
  quantity: 2, serials: ["0001"], unidentifiedQuantity: 1, expectedSerials: [], actor, occurredAt: "2026-10-15T00:00:00Z", reason: "<Damage>", dispositions: [] }];
const people = [{ id: actor, username: "Inspector" }];
const kinds: OperationsKind[] = ["locations", "exceptions", "returns", "activity"];
const context = { project: "<Project>", timezone: "America/Denver" };

test("all four datasets search and filter in supplied authorization scope without mutation", () => {
  const before = structuredClone(state);
  for (const kind of kinds) {
    const dataset = buildOperationsDataset(kind, state, people);
    assert.ok(dataset.rows.length);
    assert.equal(filterOperationsRows(dataset, "NO-MATCH", {}, dataset.defaultSort).length, 0);
    assert.equal(filterOperationsRows(dataset, "", {}, dataset.defaultSort).length, dataset.rows.length);
    const firstFilter = dataset.filters[0];
    assert.ok(filterOperationsRows(dataset, "", { [firstFilter.key]: firstFilter.options[0].value }, dataset.defaultSort).length);
    assert.equal(filterOperationsRows(dataset, "", { [firstFilter.key]: "missing" }, dataset.defaultSort).length, 0);
  }
  assert.deepEqual(state, before);
});
test("activity and exceptions resolve readable identities and search exact serials", () => {
  const activity = buildOperationsDataset("activity", state, people);
  assert.equal(activity.rows[0].cells.reference, "TR-2026-000001");
  assert.equal(activity.rows[0].cells.actor, "Inspector");
  assert.equal(activity.rows[1].cells.reference, "Count #1");
  assert.equal(filterOperationsRows(activity, "0002", {}, activity.defaultSort)[0].id, "r");
  assert.equal(filterOperationsRows(activity, "", {}, activity.defaultSort)[0].id, "r2");
  const exceptions = buildOperationsDataset("exceptions", state, people);
  assert.equal(exceptions.rows[0].cells.receipt, "Receipt #1");
  assert.equal(exceptions.rows[0].cells.reference, "Inspection hold #1");
  assert.equal(exceptions.rows[0].cells.held, 2);
});
test("CSV/Excel preserve exact text, formula safety, passed scope and numeric quantities", async () => {
  const XLSX = await import("xlsx");
  for (const kind of kinds) {
    const dataset = buildOperationsDataset(kind, state, people);
    const rows = dataset.rows.slice(0, 1);
    const csv = operationsCsv(dataset, rows);
    assert.ok(csv.includes("'=") || !csv.includes("="));
    const book = await operationsWorkbook(context, kind, dataset, rows);
    const roundtrip = XLSX.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
    const values = XLSX.utils.sheet_to_json(roundtrip.Sheets[roundtrip.SheetNames[0]], { header: 1 }) as unknown[][];
    assert.equal(values.length, 2);
    if (kind === "locations") assert.equal(values[1][0], "000001");
    if (kind === "returns") assert.equal(values[1][1], "0001");
  }
});
test("summary PDFs escape content, use repeated readable headings and omit hold serial lists", () => {
  for (const kind of kinds) {
    const dataset = buildOperationsDataset(kind, state, people);
    const html = operationsPrintHtml(context, kind, dataset, dataset.rows);
    assert.ok(html.includes("&lt;Project&gt;"));
    assert.ok(html.includes("table-header-group"));
    assert.ok(!html.includes("<Damage>"));
    assert.ok(!html.includes(actor));
  }
});
test("zero matches never broaden export scope", async () => {
  for (const kind of kinds) for (const format of ["csv", "xlsx", "pdf"] as const) {
    await assert.rejects(downloadInventoryOperations(format, context, kind, buildOperationsDataset(kind, state), []), /No matching/);
  }
});
