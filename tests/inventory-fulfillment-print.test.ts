import { test } from "node:test";
import assert from "node:assert/strict";
import { inventoryFulfillmentPrint } from "../server/inventoryFulfillmentPrint";
import { emptyInventory, type InventoryState } from "../shared/inventory";
import type { FulfillmentBatch } from "../shared/inventory-fulfillment";

function fixture() {
  const state = emptyInventory();
  state.items = [{ id: "meter", sku: "MTR", name: "Test meter" }] as InventoryState["items"];
  state.warehouses = [{ id: "source", name: "Warehouse" }, { id: "stage", name: "Staging" },
    { id: "vehicle", name: "Crew vehicle" }] as InventoryState["warehouses"];
  const batch: FulfillmentBatch = {
    id: "batch", name: "Crew batch", mode: "crew", status: "active", revision: 4,
    sourceId: "source", stagingId: "stage", vehicleId: "vehicle", createdBy: "worker",
    createdAt: "2026-10-21T12:00:00.000Z",
    workOrders: [1, 2].map(id => ({ workOrderId: id, label: `Old label ${id}`, assignmentVersion: 0 })),
    lines: [1, 2].map(id => ({ workOrderId: id, itemId: "meter", quantity: 1, stagedQuantity: 1,
      deliveredQuantity: id === 1 ? 1 : 0, stagedSerials: [`000${id}`], deliveredSerials: id === 1 ? ["0001"] : [] })),
  };
  state.fulfillmentBatches = [batch];
  state.receipts = [
    { id: "pull-two", action: "fulfillmentMove", reference: batch.id, warehouseId: "stage", actor: "worker",
      occurredAt: "2026-10-21T15:00:00.000Z", reason: "Second pull", lines: [{ itemId: "meter", quantity: 1, serials: ["0002"] }] },
    { id: "unrelated", action: "fulfillmentMove", reference: "another-batch", warehouseId: "stage", actor: "worker",
      occurredAt: "2026-10-21T13:00:00.000Z", reason: "DO NOT INCLUDE", lines: [] },
    { id: "handoff", action: "fulfillmentMove", reference: batch.id, warehouseId: "vehicle", actor: "worker",
      occurredAt: "2026-10-21T14:00:00.000Z", reason: "First handoff", lines: [{ itemId: "meter", quantity: 1, serials: ["0001"] }] },
    { id: "pull-one", action: "fulfillmentMove", reference: batch.id, warehouseId: "stage", actor: "worker",
      occurredAt: "2026-10-21T13:00:00.000Z", reason: "First pull", lines: [{ itemId: "meter", quantity: 1, serials: ["0001"] }] },
  ];
  return { state, batch };
}

test("one batch receipt retains ordered partial movements, readable identities, timezone and distinct quantity totals", () => {
  const { state, batch } = fixture();
  const before = JSON.stringify(state);
  const html = inventoryFulfillmentPrint(batch, state, "Test project", [{ id: "worker", username: "Warehouse worker" }],
    "America/New_York", { "1": "CUSTOMER-001", "2": "CUSTOMER-002" });
  assert.equal((html.match(/<html>/g) ?? []).length, 1);
  assert.equal((html.match(/onclick="window.print\(\)"/g) ?? []).length, 1);
  assert.match(html, /<td>MTR · Test meter<\/td><td>2<\/td><td>2<\/td><td>1<\/td><td>1<\/td><td>0<\/td>/);
  assert.ok(html.indexOf("First pull") < html.indexOf("First handoff"));
  assert.ok(html.indexOf("First handoff") < html.indexOf("Second pull"));
  assert.match(html, /CUSTOMER-001, CUSTOMER-002/);
  assert.doesNotMatch(html, /Old label|DO NOT INCLUDE/);
  assert.match(html, /0001/); assert.match(html, /0002/);
  assert.match(html, /America\/New_York/); assert.match(html, /9:00:00 AM EDT/);
  assert.match(html, /Warehouse worker/);
  assert.equal(JSON.stringify(state), before, "Printing never changes the stock ledger.");
});

test("release history is not a stock return and all user text is escaped", () => {
  const { state, batch } = fixture();
  batch.status = "cancelled";
  batch.name = '<script>alert("batch")</script>';
  state.receipts.push({ id: "release", action: "fulfillmentClose", reference: batch.id,
    warehouseId: "stage", actor: "worker", occurredAt: "2026-10-21T16:00:00.000Z",
    reason: "<img src=x onerror=alert(1)>", lines: [] });
  const html = inventoryFulfillmentPrint(batch, state, "<Customer>");
  assert.match(html, /Unfinished remainder released/);
  assert.match(html, /no physical return or stock transfer/);
  assert.match(html, /Status: cancelled/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;Customer&gt;/);
  assert.doesNotMatch(html, /<script>|<img /);
});

test("an unposted batch clearly reports no physical stock movements", () => {
  const { state, batch } = fixture();
  state.receipts = [];
  const html = inventoryFulfillmentPrint(batch, state, "Test project");
  assert.match(html, /No physical stock movements have been recorded/);
});
