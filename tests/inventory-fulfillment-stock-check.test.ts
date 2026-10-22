import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, type InventoryState } from "../shared/inventory";
import type { FulfillmentBatch } from "../shared/inventory-fulfillment";
import { checkFulfillmentSerials } from "../shared/inventory-fulfillment-scans";

function fixture() {
  const state = emptyInventory();
  state.items = [{ id: "meter", active: true, tracking: "serialized" }, { id: "module", active: true, tracking: "serialized" }] as InventoryState["items"];
  state.stock = [
    { warehouseId: "source", itemId: "meter", quantity: 3, serials: ["0001", "0002", "0003"], revision: 1 },
    { warehouseId: "stage", itemId: "meter", quantity: 2, serials: ["0004", "0005"], revision: 1 },
    { warehouseId: "source", itemId: "module", quantity: 1, serials: ["MODULE"], revision: 1 },
  ];
  const batch = {
    id: "batch", mode: "scheduled", status: "active", sourceId: "source", stagingId: "stage",
    vehicleId: "vehicle", workOrders: [{ workOrderId: 1, assignmentVersion: 0 }],
    lines: [{ itemId: "meter", workOrderId: 1, quantity: 5, stagedQuantity: 1, deliveredQuantity: 0, stagedSerials: ["0004"], deliveredSerials: [] }],
    name: "Test", revision: 1, createdAt: "2026-10-22T00:00:00Z",
  } as FulfillmentBatch;
  state.fulfillmentBatches = [batch];
  return { state, batch };
}

test("pull checks item, source, missing serials and leading zeros without changing stock", () => {
  const { state, batch } = fixture();
  const before = JSON.stringify(state);
  const problems = checkFulfillmentSerials(state, batch, "stage", [{ itemId: "meter", serials: ["0001", "0004", "MODULE", "1", "UNKNOWN"] }]);
  assert.deepEqual(problems.map(problem => problem.serial), ["0004", "MODULE", "1", "UNKNOWN"]);
  assert.ok(problems.every(problem => /selected source/.test(problem.reason)));
  assert.equal(JSON.stringify(state), before);
});

test("other work and crew holds block scans, but a scheduled batch can move its own reservation", () => {
  const { state, batch } = fixture();
  state.allocations = [
    { workOrderId: 1, status: "reserved", lines: [{ warehouseId: "source", itemId: "meter", quantity: 1, serials: ["0001"] }] },
    { workOrderId: 2, status: "reserved", lines: [{ warehouseId: "source", itemId: "meter", quantity: 1, serials: ["0002"] }] },
  ] as InventoryState["allocations"];
  state.fulfillmentBatches!.push({ ...batch, id: "other", mode: "crew", stagingId: "source",
    lines: [{ ...batch.lines[0], stagedSerials: ["0003"], deliveredSerials: [] }] });
  const problems = checkFulfillmentSerials(state, batch, "stage", [{ itemId: "meter", serials: ["0001", "0002", "0003"] }]);
  assert.deepEqual(problems.map(problem => problem.serial), ["0002", "0003"]);
  assert.ok(problems.every(problem => /Reserved/.test(problem.reason)));
});

test("an exact reservation for a different demand row in the same batch is not waived", () => {
  const { state, batch } = fixture();
  batch.lines.push({ ...batch.lines[0], workOrderId: 2 });
  state.allocations = [{ workOrderId: 2, status: "reserved",
    lines: [{ warehouseId: "source", itemId: "meter", quantity: 1, serials: ["0001"] }] }] as InventoryState["allocations"];
  assert.match(checkFulfillmentSerials(state, batch, "stage", [{ itemId: "meter", serials: ["0001"] }])[0].reason, /Reserved/);
});

test("handoff requires this batch's staged custody and current physical location", () => {
  const { state, batch } = fixture();
  assert.deepEqual(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0004"] }]), []);
  assert.match(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0005"] }])[0].reason, /this batch/);
  state.stock = state.stock.filter(row => row.warehouseId !== "stage");
  assert.match(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0004"] }])[0].reason, /Staging/);
  batch.lines[0].deliveredSerials.push("0004");
  assert.match(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0004"] }])[0].reason, /awaiting handoff/);
});

test("a crew handoff releases its own pool hold, never another batch's hold", () => {
  const { state, batch } = fixture();
  batch.mode = "crew";
  assert.deepEqual(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0004"] }]), []);
  state.fulfillmentBatches!.push({ ...batch, id: "other" });
  assert.match(checkFulfillmentSerials(state, batch, "vehicle", [{ itemId: "meter", serials: ["0004"] }])[0].reason, /another batch/);
});
