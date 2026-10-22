import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyInventoryCommand, reserved } from "../shared/inventory-engine";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { fulfillmentOutstanding, type FulfillmentBatch } from "../shared/inventory-fulfillment";
import { inventoryPickTicket } from "../server/inventoryPickTicket";
import { inventoryFromRelational, inventoryToRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryPrint } from "../server/inventoryPrint";
import { inventoryActivityGroups } from "../shared/inventory-activity-groups";
import { inventoryFulfillmentPrint } from "../server/inventoryFulfillmentPrint";
import { reassignmentDemandState } from "../shared/inventory-fulfillment-reassignment";

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
test("partial pickup readiness is explicit, versioned, replay-safe and does not move stock", () => {
  let { state, batch } = create(setup());
  assert.throws(() => post(state, "fulfillmentReady", { id: batch.id, revision: 1, ready: true }), /no stock at staging/i);
  state = move(state, "stage", ["A"]);
  const before = structuredClone(state), operationId = randomUUID();
  const data = { id: batch.id, revision: state.fulfillmentBatches![0].revision, ready: true };
  state = post(state, "fulfillmentReady", data, operationId);
  assert.deepEqual(state.stock, before.stock);
  assert.deepEqual(state.allocations, before.allocations);
  assert.equal(state.fulfillmentBatches![0].pickupReady, true);
  assert.equal(state.fulfillmentBatches![0].revision, data.revision + 1);
  assert.deepEqual(post(state, "fulfillmentReady", data, operationId), state);
  assert.throws(() => post(state, "fulfillmentReady", { ...data, ready: false }), /Batch changed/);
  const relational = inventoryToRelational(state, 1);
  const restored = inventoryFromRelational(new Map([...relational].map(([name, value]) => [name, value.rows])),
    state.revision, Object.keys(state));
  assert.equal(restored.fulfillmentBatches![0].pickupReady, true);
});

for (const staged of [["A"], ["A", "B"]]) test(`scheduled reassignment reuses ${staged.length} staged units, rebases reservations and is exactly-once without stock movement`, () => {
  let { state } = create(setup(), "scheduled");
  state = post(state, "warehouse", { id: "new-vehicle", code: "NEW", name: "New installer's vehicle",
    type: "vehicle", userIds: ["new-installer"], vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO" });
  state = move(state, "stage", staged);
  const before = structuredClone(state), batch = state.fulfillmentBatches![0];
  const shadow = reassignmentDemandState(state, batch);
  assert.deepEqual(fulfillmentOutstanding(shadow, 1, [{ itemId: "meter", quantity: 1 }]), [{ itemId: "meter", quantity: 1 }]);
  assert.deepEqual(state, before, "Readiness review cannot mutate physical or reservation state.");
  const reviewed: FulfillmentBatch = { ...batch, vehicleId: "new-vehicle", revision: batch.revision + 1,
    workOrders: batch.workOrders.map(work => ({ ...work, assignmentVersion: 3,
      installerId: "new-installer", installer: "New installer", scheduledDate: "2026-10-22T14:00:00.000Z" })) };
  const command: InventoryCommand = { operationId: randomUUID(), action: "fulfillmentReassign",
    data: { id: batch.id, revision: batch.revision, vehicleId: reviewed.vehicleId,
      workOrders: reviewed.workOrders.map(({ workOrderId, assignmentVersion }) => ({ workOrderId, assignmentVersion })),
      reason: "Installer changed; reuse the reviewed staged meters", confirmed: true } };
  assert.throws(() => applyInventoryCommand(state, command, "worker", true), /verified against current/);
  const changed = structuredClone(reviewed); changed.lines[0].stagedSerials = ["C"];
  assert.throws(() => applyInventoryCommand(state, command, "worker", true, undefined, { fulfillmentBatch: changed }), /serial custody/);
  state = applyInventoryCommand(state, command, "worker", true, undefined, { fulfillmentBatch: reviewed }).state;
  assert.deepEqual(state.stock, before.stock);
  assert.deepEqual(state.transactions, before.transactions);
  assert.deepEqual(state.fulfillmentBatches![0].lines, before.fulfillmentBatches![0].lines);
  assert.equal(state.fulfillmentBatches![0].vehicleId, "new-vehicle");
  assert.ok(state.allocations.every(allocation => allocation.assignmentVersion === 3));
  assert.equal(state.receipts.at(-1)?.action, "fulfillmentReassign");
  assert.equal(state.receipts.at(-1)?.lines.length, 0);
  assert.match(state.receipts.at(-1)?.reason ?? "", /no physical movement/);
  const printed = inventoryFulfillmentPrint(state.fulfillmentBatches![0], state, "Owned project");
  assert.match(printed, /Reassignment reviews — no stock movement/);
  assert.match(printed, /New installer/);
  assert.match(printed, /Installer changed; reuse the reviewed staged meters/);
  assert.doesNotMatch(printed, new RegExp(batch.id));
  assert.equal(applyInventoryCommand(state, command, "worker", true).replay, true);
  assert.throws(() => applyInventoryCommand(state, { ...command, operationId: randomUUID() },
    "worker", true, undefined, { fulfillmentBatch: reviewed }), /Batch changed/);
  const relational = inventoryToRelational(state, 1);
  const restored = inventoryFromRelational(new Map([...relational].map(([name, value]) => [name, value.rows])),
    state.revision, Object.keys(state));
  assert.equal(restored.fulfillmentBatches![0].workOrders[0].installer, "New installer");
  assert.equal(restored.fulfillmentBatches![0].workOrders[0].scheduledDate, "2026-10-22T14:00:00.000Z");
  state = move(state, "vehicle", ["A"]);
  assert.equal(state.stock.find(stock => stock.warehouseId === "new-vehicle" && stock.itemId === "meter")?.quantity, 1);
  const delivered = state.fulfillmentBatches![0];
  assert.throws(() => applyInventoryCommand(state, { ...command, operationId: randomUUID(),
    data: { ...command.data, revision: delivered.revision } }, "worker", true, undefined,
    { fulfillmentBatch: { ...delivered, revision: delivered.revision + 1 } }), /Already-delivered/);
});

test("pick tickets print escaped readable identities and actual staged custody without changing stock", async () => {
  let { state, batch } = create(setup());
  state = move(state, "stage", ["A"]);
  batch = state.fulfillmentBatches![0];
  const before = structuredClone(state);
  const html = await inventoryPickTicket(batch, state, { id: 1, name: "Project <script>", timezone: "America/Denver" },
    [{ id: "worker", username: "Crew tech" }], "https://example.test", { "1": "CUSTOMER-1", "2": "CUSTOMER-2" });
  assert.match(html, /PICK-\d{4}-000001/);
  assert.match(html, /data:image\/png;base64,/);
  assert.match(html, /Project &lt;script&gt;/);
  assert.match(html, /CUSTOMER-1/);
  assert.match(html, /Partially staged — not yet ready/);
  assert.match(html, /Recorded serials waiting at staging/);
  assert.doesNotMatch(html, new RegExp(batch.id));
  assert.deepEqual(state, before);
});

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
