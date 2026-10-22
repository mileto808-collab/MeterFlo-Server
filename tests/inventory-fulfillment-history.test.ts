import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { fulfillmentResumeStatus, type FulfillmentBatch } from "../shared/inventory-fulfillment";
import { buildOperationsDataset, filterOperationsRows } from "../client/src/lib/inventory-operations-data";
import { operationsCsv, operationsPrintHtml, operationsWorkbook } from "../client/src/lib/inventory-operations-export";

function fixture() {
  let state = emptyInventory();
  for (const id of ["source", "staging", "vehicle"]) state = applyInventoryCommand(state, {
    operationId: randomUUID(), action: "warehouse", data: { id, name: `Location ${id}`, code: id, type: "physical", address: "Test warehouse" },
  }, "worker", true).state;
  state = applyInventoryCommand(state, { operationId: randomUUID(), action: "item",
    data: { id: "meter", name: "Test meter", sku: "METER", tracking: "serialized", equipment: "system" },
  }, "worker", true).state;
  const batch: FulfillmentBatch = {
    id: randomUUID(), name: "Route 644", mode: "crew", sourceId: "source", stagingId: "staging", vehicleId: "vehicle",
    createdAt: "2026-10-20T12:00:00.000Z", createdBy: "worker", status: "active", revision: 1,
    workOrders: [{ workOrderId: 195, assignmentVersion: 2, label: "CUSTOMER-2048" }],
    lines: [{ workOrderId: 195, itemId: "meter", quantity: 2, stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }],
  };
  const orders = [{ workOrderId: 195, assignmentVersion: 2, status: "Open", eligible: true }];
  return { state, batch, orders };
}

test("resume discovery accepts unfinished work without requiring stock to be available yet", () => {
  const { state, batch, orders } = fixture();
  assert.deepEqual(fulfillmentResumeStatus(state, batch, orders, "worker", true), { resumable: true, nextStep: "stage" });
  batch.lines[0].stagedQuantity = 2;
  assert.deepEqual(fulfillmentResumeStatus(state, batch, orders, "worker", true), { resumable: true, nextStep: "vehicle" });
});

test("terminal, exhausted, inaccessible and inactive-item batches cannot be resumed", () => {
  const { state, batch, orders } = fixture();
  for (const status of ["completed", "cancelled"] as const)
    assert.equal(fulfillmentResumeStatus(state, { ...batch, status }, orders, "worker", true).resumable, false);
  assert.equal(fulfillmentResumeStatus(state, batch, [], "worker", true).resumable, false);
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "", false).resumable, false);
  state.warehouses[0].active = false;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
  state.warehouses[0].active = true;
  state.items[0].active = false;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
  state.items[0].active = true;
  batch.lines[0].stagedQuantity = batch.lines[0].deliveredQuantity = 2;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
});

test("changed crew assignments prohibit new pulls but preserve valid staged-stock handoff", () => {
  const { state, batch, orders } = fixture();
  orders[0].assignmentVersion++;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
  batch.lines[0].stagedQuantity = 1;
  const result = fulfillmentResumeStatus(state, batch, orders, "worker", true);
  assert.equal(result.resumable, true); assert.equal(result.nextStep, "vehicle");
  orders[0].status = "Completed";
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).nextStep, "vehicle");
});

test("scheduled reassignment or completion remains blocked even with staged stock", () => {
  const { state, batch, orders } = fixture();
  batch.mode = "scheduled"; orders[0].status = "Scheduled";
  batch.lines[0].stagedQuantity = 2;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, true);
  orders[0].assignmentVersion++;
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
  orders[0].assignmentVersion--; orders[0].status = "Completed";
  assert.equal(fulfillmentResumeStatus(state, batch, orders, "worker", true).resumable, false);
});

test("completed history uses readable identities and shared search, filters, dates and exports", async () => {
  const { state, batch } = fixture();
  batch.status = "completed"; batch.lines[0].stagedQuantity = batch.lines[0].deliveredQuantity = 2;
  batch.lines[0].stagedSerials = batch.lines[0].deliveredSerials = ["000001", "000002"];
  state.fulfillmentBatches = [batch, { ...batch, id: randomUUID(), name: "Unfinished", status: "active" },
    { ...batch, id: randomUUID(), name: "Released", status: "cancelled" }];
  state.receipts.push({ ...state.receipts[0], id: randomUUID(), action: "fulfillmentMove",
    reference: batch.id, occurredAt: "2026-10-20T14:00:00.000Z" });
  const dataset = buildOperationsDataset("fulfillment", state, [], [], "America/Denver");
  assert.equal(dataset.rows.length, 1);
  const matches = filterOperationsRows(dataset, "customer-2048", { vehicle: "Location vehicle" }, dataset.defaultSort,
    { from: "2026-10-20", to: "2026-10-20", timezone: "America/Denver" });
  assert.equal(matches.length, 1);
  assert.equal(filterOperationsRows(dataset, "000001", {}, dataset.defaultSort).length, 1);
  assert.equal(filterOperationsRows(dataset, "", { mode: "Scheduled installer" }, dataset.defaultSort).length, 0);
  assert.equal(filterOperationsRows(dataset, "", {}, dataset.defaultSort,
    { from: "2026-10-21", to: "", timezone: "America/Denver" }).length, 0);
  const csv = operationsCsv(dataset, matches);
  assert.match(csv, /CUSTOMER-2048/); assert.match(csv, /000001/); assert.doesNotMatch(csv, new RegExp(batch.id));
  const html = operationsPrintHtml({ project: "Test project", timezone: "America/Denver" }, "fulfillment", dataset, matches);
  assert.match(html, /Print \/ Save PDF/); assert.match(html, /CUSTOMER-2048/); assert.doesNotMatch(html, new RegExp(batch.id));
  const workbook = await operationsWorkbook({ project: "Test project", timezone: "America/Denver" }, "fulfillment", dataset, matches);
  assert.ok(workbook.SheetNames.includes("Completed batches"));
  assert.equal(filterOperationsRows(dataset, "not found", {}, dataset.defaultSort).length, 0);
  const withoutEvidence = buildOperationsDataset("fulfillment", { ...state, receipts: [] }, [], [], "America/Denver");
  assert.equal(withoutEvidence.rows[0].cells.completed, "Not recorded");
  assert.equal(filterOperationsRows(withoutEvidence, "", {}, withoutEvidence.defaultSort,
    { from: "2026-10-20", to: "", timezone: "America/Denver" }).length, 0);
});
