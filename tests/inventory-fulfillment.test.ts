import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyInventoryCommand, reserved } from "../shared/inventory-engine";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { fulfillmentOutstanding, type FulfillmentBatch } from "../shared/inventory-fulfillment";
import { inventoryFromRelational, inventoryToRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryPrint } from "../server/inventoryPrint";
import { inventoryActivityGroups } from "../shared/inventory-activity-groups";

const post = (s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(s, { operationId, action, data }, "worker", true).state;
function setup() {
  let s = emptyInventory();
  for (const id of ["source", "stage", "vehicle"]) s = post(s, "warehouse", {
    id, code: id, name: id, type: "physical", address: "Owned fulfillment test",
    ...(id === "stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}),
  });
  s = post(s, "item", { id: "meter", sku: "METER", name: "Meter", tracking: "serialized", equipment: "system" });
  s = post(s, "item", { id: "part", sku: "PART", name: "Fitting", tracking: "regular" });
  s = post(s, "vendor", { id: "vendor", name: "Vendor" });
  s = post(s, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "source",
    lines: [{ itemId: "meter", quantity: 4 }, { itemId: "part", quantity: 10 }] });
  s = post(s, "release", { orderId: "po" });
  return post(s, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 4, serials: ["A", "B", "C", "D"] }, { itemId: "part", quantity: 10 },
  ] });
}
function create(s: InventoryState, mode: "crew" | "scheduled" = "crew") {
  const batch: FulfillmentBatch = { id: randomUUID(), name: "Route 789 · Crew A", mode,
    sourceId: "source", stagingId: "stage", vehicleId: "vehicle", status: "active", revision: 1,
    createdBy: "worker", createdAt: new Date().toISOString(),
    workOrders: [1, 2].map(id => ({ workOrderId: id, assignmentVersion: 2, label: `CUSTOMER-${id}` })),
    lines: [1, 2].map(id => ({ workOrderId: id, itemId: "meter", quantity: 1,
      stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] })) };
  const command: InventoryCommand = { operationId: randomUUID(), action: "fulfillmentCreate", data: { id: batch.id } };
  return { batch, state: applyInventoryCommand(s, command, "worker", true, undefined, { fulfillmentBatch: batch }).state };
}
const move = (s: InventoryState, phase: "stage" | "vehicle", serials: string[], operationId = randomUUID()) => {
  const batch = s.fulfillmentBatches![0];
  return post(s, "fulfillmentMove", { id: batch.id, revision: batch.revision, phase,
    lines: [{ itemId: "meter", quantity: serials.length, serials }],
    reason: "Physically counted and scanned for this batch", physicallyConfirmed: true }, operationId);
};
test("crew fulfillment counts demand once, pools custody, and hands stock to a vehicle without installed reservations", () => {
  const initial = setup();
  let { state, batch } = create(initial);
  assert.deepEqual(state.stock, initial.stock);
  assert.equal(state.allocations.length, 0);
  assert.deepEqual(fulfillmentOutstanding(state, 1, [{ itemId: "meter", quantity: 1 }]), []);
  state = move(state, "stage", ["A"]);
  assert.equal(reserved(state, "stage", "meter"), 1);
  assert.equal(state.allocations.length, 0);
  assert.equal(state.fulfillmentBatches![0].status, "active");
  assert.throws(() => post(state, "assign", { workOrderId: 3, lines: [
    { itemId: "meter", warehouseId: "stage", quantity: 1, serials: ["A"], reservationMode: "serial" },
  ] }), /Insufficient|unavailable/);
  state = move(state, "stage", ["B"]);
  const commandId = randomUUID(), prior = state;
  state = move(state, "vehicle", ["B"], commandId);
  const replay: InventoryCommand = { operationId: commandId, action: "fulfillmentMove", data: {
    id: batch.id, revision: prior.fulfillmentBatches![0].revision, phase: "vehicle",
    lines: [{ itemId: "meter", quantity: 1, serials: ["B"] }],
    reason: "Physically counted and scanned for this batch", physicallyConfirmed: true,
  } };
  assert.equal(applyInventoryCommand(state, replay, "worker", true).replay, true);
  assert.equal(reserved(state, "stage", "meter"), 1);
  assert.throws(() => move(state, "vehicle", ["C"]), /physically staged/);
  assert.throws(() => post(state, "fulfillmentMove", { ...replay.data, revision: 1 }), /batch changed/);
  state = move(state, "vehicle", ["A"]);
  assert.equal(state.fulfillmentBatches![0].status, "completed");
  assert.equal(reserved(state, "stage", "meter"), 0);
  assert.deepEqual(state.stock.find(b => b.warehouseId === "vehicle" && b.itemId === "meter")!.serials.sort(), ["A", "B"]);
  assert.equal(state.allocations.length, 0);
  assert.equal(state.serialOccupancy?.some(o => o.workOrderId === 1), false);
  const history = inventoryActivityGroups(state, "UTC").find(group => group.receipts.some(r => r.reference === batch.id));
  assert.ok(history); assert.equal(history!.receipts.length, 5);
});
test("scheduled staging relocates quantity holds without forcing custody serials as installation serials", () => {
  let { state } = create(setup(), "scheduled");
  state = move(state, "stage", ["A", "B"]);
  assert.equal(reserved(state, "stage", "meter"), 2);
  assert.deepEqual(state.allocations.map(a => a.lines[0].serials), [[], []]);
  assert.equal(state.allocations[0].assignmentVersion, 2);
  state = move(state, "vehicle", ["B"]);
  assert.equal(state.allocations.find(a => a.workOrderId === 2)!.lines[0].warehouseId, "vehicle");
  assert.equal(reserved(state, "stage", "meter"), 1);
  assert.equal(reserved(state, "vehicle", "meter"), 1);
  assert.deepEqual(fulfillmentOutstanding(state, 2, [{ itemId: "meter", quantity: 2 }]), [{ itemId: "meter", quantity: 1 }]);
});
test("releasing an unfinished batch retains physical staging, releases only its holds and uncovers remaining demand", () => {
  for (const mode of ["crew", "scheduled"] as const) {
    let { state } = create(setup(), mode);
    state = move(state, "stage", ["A", "B"]);
    state = move(state, "vehicle", ["A"]);
    const before = structuredClone(state.stock);
    const batch = state.fulfillmentBatches![0];
    state = post(state, "fulfillmentClose", { id: batch.id, revision: batch.revision, reason: "Assignment changed; review remaining staged equipment" });
    assert.deepEqual(state.stock, before);
    assert.equal(state.fulfillmentBatches![0].status, "cancelled");
    assert.equal(reserved(state, "stage", "meter"), 0);
    assert.deepEqual(fulfillmentOutstanding(state, 1, [{ itemId: "meter", quantity: 1 }]), []);
    assert.deepEqual(fulfillmentOutstanding(state, 2, [{ itemId: "meter", quantity: 1 }]), [{ itemId: "meter", quantity: 1 }]);
  }
});
test("fulfillment relational roundtrip, protected stock projection, portable backup and readable manifest", () => {
  let { state, batch } = create(setup());
  state = move(state, "stage", ["A", "B"]);
  const tables = inventoryToRelational(state, 7);
  assert.equal(tables.get("inventory_fulfillment_batches")!.rows.length, 1);
  assert.equal(tables.get("inventory_quantities")!.rows.find(r => r.warehouse_id === "stage")!.reserved, 2);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, value]) => [name, value.rows])),
    state.revision, Object.keys(state));
  assert.deepEqual(restored.fulfillmentBatches, state.fulfillmentBatches);
  const backup = { state: restored, enabled: true, movements: [] };
  validateInventoryBackup(backup, [1, 2]);
  const html = inventoryPrint("receipt", state.receipts.at(-1)!, state, "Owned Project", [], "America/New_York", { 1: "CUSTOMER-1", 2: "CUSTOMER-2" });
  assert.match(html, /Route 789/); assert.match(html, /CUSTOMER-1/); assert.match(html, /not installed-serial/);
  restored.fulfillmentBatches![0].lines[0].deliveredQuantity = 10;
  assert.throws(() => validateInventoryBackup(backup, [1, 2]), /fulfillment custody/);
  assert.throws(() => applyInventoryCommand(state, { operationId: randomUUID(), action: "fulfillmentCreate", data: batch }, "worker", true), /must be verified/);
});
