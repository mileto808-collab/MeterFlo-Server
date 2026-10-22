import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand, reserved } from "../shared/inventory-engine";
import { fulfillmentOutstanding, type FulfillmentBatch } from "../shared/inventory-fulfillment";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action, data }, "operator", true).state;
function fixture(scheduled = false) {
  let state = emptyInventory();
  for (const id of ["source", "stage"]) state = post(state, "warehouse", { id, code: id, name: id, type: "physical", address: "Test" });
  for (const id of ["van-a", "van-b"]) state = post(state, "warehouse", {
    id, code: id, name: id, type: "vehicle", userIds: id === "van-a" ? ["old"] : ["new"],
    vin: id === "van-a" ? "1HGCM82633A004352" : "1HGCM82633A004353", plate: id, plateState: "CO",
  });
  state = post(state, "item", { id: "meter", sku: "METER", name: "Meter", tracking: "serialized" });
  state = post(state, "item", { id: "part", sku: "PART", name: "Part", tracking: "regular" });
  state = post(state, "vendor", { id: "vendor", name: "Vendor" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "van-a",
    lines: [{ itemId: "meter", quantity: 4 }, { itemId: "part", quantity: 8 }] });
  state = post(state, "release", { orderId: "po" });
  state = post(state, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 4, serials: ["A", "B", "C", "D"] }, { itemId: "part", quantity: 8 },
  ] });
  const batch: FulfillmentBatch = {
    id: randomUUID(), name: "Route handover", sourceId: "source", stagingId: "stage", vehicleId: "van-a",
    mode: scheduled ? "scheduled" : "crew", status: "completed", revision: 1, createdAt: new Date().toISOString(), createdBy: "operator",
    workOrders: [1, 2].map(id => ({ workOrderId: id, assignmentVersion: 1, installerId: scheduled ? "old" : null, label: `WO-${id}` })),
    lines: [1, 2].map((id, index) => ({ workOrderId: id, itemId: "meter", quantity: 1,
      stagedQuantity: 1, deliveredQuantity: 1, stagedSerials: [index ? "B" : "A"], deliveredSerials: [index ? "B" : "A"] })),
  };
  state.fulfillmentBatches = [batch];
  return { state, batch };
}
const input = (state: InventoryState, batch: FulfillmentBatch, serial = "C") => ({
  mode: "work", revision: state.revision, sourceId: "van-a", destinationId: "van-b",
  batchId: batch.id, batchRevision: batch.revision, workOrders: [{ workOrderId: 1, assignmentVersion: 1 }],
  installerId: null, lines: [{ itemId: "meter", quantity: 1, serials: [serial] }],
  reason: "Both crews verified this physical handover", physicallyConfirmed: true,
});
test("stock-only handover moves exact stock without changing dispatch or assignments", () => {
  const { state } = fixture();
  const before = structuredClone(state.fulfillmentBatches);
  const next = post(state, "vehicleTransfer", { mode: "stock", revision: state.revision,
    sourceId: "van-a", destinationId: "van-b", workOrders: [],
    lines: [{ itemId: "meter", quantity: 1, serials: ["D"] }, { itemId: "part", quantity: 2, serials: [] }],
    reason: "Both crews received spare meters and fittings", physicallyConfirmed: true });
  assert.deepEqual(next.fulfillmentBatches, before);
  assert.equal(next.stock.find(row => row.warehouseId === "van-a" && row.itemId === "meter")!.quantity, 3);
  assert.deepEqual(next.stock.find(row => row.warehouseId === "van-b" && row.itemId === "meter")!.serials, ["D"]);
  assert.equal(next.receipts.at(-1)!.sourceId, "van-a");
});
test("taking over one order preserves original picks, other work and demand coverage", () => {
  const { state, batch } = fixture();
  const originalLines = structuredClone(batch.lines);
  const next = post(state, "vehicleTransfer", input(state, batch));
  const saved = next.fulfillmentBatches![0];
  assert.equal(saved.vehicleId, "van-a", "original ticket vehicle is historical");
  assert.equal(saved.workOrders[0].vehicleId, "van-b");
  assert.equal(saved.workOrders[1].vehicleId, undefined);
  assert.deepEqual(saved.lines, originalLines, "custody scanning does not bind original pick serials to installations");
  assert.deepEqual(fulfillmentOutstanding(next, 1, [{ itemId: "meter", quantity: 1 }]), []);
  assert.deepEqual(next.stock.find(row => row.warehouseId === "van-b" && row.itemId === "meter")!.serials, ["C"]);
});
test("unknown-outcome retry replays once even though stock and batch revisions have changed", () => {
  const { state, batch } = fixture();
  const command: InventoryCommand = { operationId: randomUUID(), action: "vehicleTransfer", data: input(state, batch) };
  const result = applyInventoryCommand(state, command, "operator", true);
  assert.equal(applyInventoryCommand(result.state, command, "operator", true).replay, true);
  assert.equal(result.state.receipts.filter(receipt => receipt.id === command.operationId).length, 1);
  assert.throws(() => applyInventoryCommand(result.state, { ...command, operationId: randomUUID() }, "operator", true), /changed/);
});
test("scheduled work moves its own exact reservations but never another job's serial", () => {
  let { state, batch } = fixture(true);
  for (const [id, serial] of [[1, "A"], [2, "B"]] as const) state = post(state, "assign", {
    workOrderId: id, revision: 0, lines: [{ warehouseId: "van-a", itemId: "meter", quantity: 1, serials: [serial], reservationMode: "serial" }],
  });
  const payload = { ...input(state, batch, "A"), installerId: "new" };
  assert.throws(() => post(state, "vehicleTransfer", { ...payload, installerId: null }), /receiving installer/);
  assert.throws(() => post(state, "vehicleTransfer", { ...payload, lines: [{ itemId: "meter", quantity: 1, serials: ["B"] }] }), /reserved/);
  const next = post(state, "vehicleTransfer", payload);
  assert.equal(reserved(next, "van-b", "meter"), 1);
  assert.equal(reserved(next, "van-a", "meter"), 1);
  assert.equal(next.allocations.find(row => row.workOrderId === 1)!.lines[0].warehouseId, "van-b");
});
test("duplicate scans, excess demand and unfinished handoff cannot change stock", () => {
  const { state, batch } = fixture();
  const before = JSON.stringify(state);
  assert.throws(() => post(state, "vehicleTransfer", { ...input(state, batch),
    lines: [{ itemId: "meter", quantity: 2, serials: ["A", "A"] }] }), /only once/);
  assert.throws(() => post(state, "vehicleTransfer", { ...input(state, batch),
    lines: [{ itemId: "meter", quantity: 2, serials: ["A", "C"] }] }), /complete picked quantities/);
  batch.lines[0].deliveredQuantity = 0;
  assert.throws(() => post(state, "vehicleTransfer", input(state, batch)), /handoff/);
  batch.lines[0].deliveredQuantity = 1;
  assert.equal(JSON.stringify(state), before);
});
test("prepared actual use and excess reservations block takeover with no mutations", () => {
  let { state, batch } = fixture();
  state = post(state, "assign", { workOrderId: 1, revision: 0,
    lines: [{ warehouseId: "van-a", itemId: "meter", quantity: 2, serials: [], reservationMode: "quantity" }] });
  assert.throws(() => post(state, "vehicleTransfer", input(state, batch)), /additional reserved demand|reserved quantities/);
  state.allocations[0].used = [{ itemId: "meter", warehouseId: "van-a", quantity: 1, serials: ["A"] }];
  assert.throws(() => post(state, "vehicleTransfer", input(state, batch)), /prepared installation/);
});
test("subsequent handover follows effective vehicle and portable relational records retain ownership", () => {
  const { state, batch } = fixture();
  let next = post(state, "vehicleTransfer", input(state, batch));
  const moved = next.fulfillmentBatches![0];
  next = post(next, "vehicleTransfer", { ...input(next, moved), sourceId: "van-b", destinationId: "van-a" });
  assert.equal(next.fulfillmentBatches![0].workOrders[0].vehicleId, "van-a");
  const tables = inventoryToRelational(next, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), next.revision, Object.keys(next));
  assert.deepEqual(restored.fulfillmentBatches, next.fulfillmentBatches);
  assert.equal(restored.receipts.at(-1)!.sourceId, "van-b");
  assert.deepEqual(restored.receipts.at(-1)!.workOrderIds, [1]);
  validateInventoryBackup({ state: restored, enabled: true, movements: [] }, [1, 2]);
});
