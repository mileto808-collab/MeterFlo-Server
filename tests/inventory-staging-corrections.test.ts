import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { applyInventoryCommand, reserved } from "../shared/inventory-engine";
import { emptyInventory, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { type FulfillmentBatch } from "../shared/inventory-fulfillment";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryFulfillmentPrint } from "../server/inventoryFulfillmentPrint";
import { kitSerialContents } from "../shared/inventory-kits";
const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID(), actor = "worker") =>
  applyInventoryCommand(state, { operationId, action, data }, actor, true).state;
function setup(mode: "crew" | "scheduled" = "crew") {
  let state = emptyInventory();
  for (const id of ["source", "stage", "vehicle"]) state = post(state, "warehouse", { id, code: id, name: id,
    type: id === "vehicle" ? "vehicle" : "physical", address: "Test warehouse", userIds: ["worker"],
    ...(id === "vehicle" ? { vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO" } : {}),
    ...(id === "stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}) });
  state = post(state, "item", { id: "meter", sku: "MTR", name: "Meter", tracking: "serialized" });
  state = post(state, "item", { id: "part", sku: "PART", name: "Fitting", tracking: "regular" });
  state = post(state, "vendor", { id: "vendor", name: "Supplier" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "source",
    lines: [{ itemId: "meter", quantity: 5 }, { itemId: "part", quantity: 10 }] });
  state = post(state, "release", { orderId: "po" });
  state = post(state, "receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 5, serials: ["A", "B", "C", "D", "E"] },
    { itemId: "part", quantity: 10 }] });
  const batch: FulfillmentBatch = { id: randomUUID(), name: "Crew pickup", mode, sourceId: "source", stagingId: "stage",
    vehicleId: "vehicle", status: "active", revision: 1, createdBy: "worker", createdAt: new Date().toISOString(),
    workOrders: [{ workOrderId: 1, assignmentVersion: 1, label: "CUSTOMER-100" }],
    lines: [{ workOrderId: 1, itemId: "meter", quantity: 3, stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] },
      { workOrderId: 1, itemId: "part", quantity: 3, stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }] };
  state = applyInventoryCommand(state, { operationId: randomUUID(), action: "fulfillmentCreate", data: { id: batch.id } },
    "worker", true, undefined, { fulfillmentBatch: batch }).state;
  return post(state, "fulfillmentMove", { id: batch.id, revision: 1, phase: "stage", reason: "Physical stock pulled and counted",
    physicallyConfirmed: true, lines: [{ itemId: "meter", quantity: 2, serials: ["A", "B"] }, { itemId: "part", quantity: 2, serials: [] }] });
}
const line = (serials: string[], parts = 2) => [
  { itemId: "meter", quantity: serials.length, serials }, { itemId: "part", quantity: parts, serials: [] },
];
const correct = (state: InventoryState, mode: string, lines: ReturnType<typeof line>, extra = {}) => ({
  id: state.fulfillmentBatches![0].id, revision: state.fulfillmentBatches![0].revision, mode, lines,
  reason: "Verified actual staging contents against source stock", confirmed: true, sourceVerified: true, ready: true, ...extra,
});
for (const mode of ["crew", "scheduled"] as const) test(`${mode}: report pauses handoff; correction reuses actual stock, holds and immutable receipts`, () => {
  let state = setup(mode);
  const original = structuredClone(state), batch = state.fulfillmentBatches![0], op = randomUUID();
  const report = { id: batch.id, revision: batch.revision, itemId: "meter", category: "wrong_serial", description: "The meter label does not match staged serials." };
  state = post(state, "fulfillmentIssue", report, op);
  assert.deepEqual(state.stock, original.stock);
  assert.deepEqual(post(state, "fulfillmentIssue", report, op), state);
  assert.throws(() => post(state, "fulfillmentMove", { id: batch.id, revision: batch.revision + 1, phase: "vehicle",
    lines: [{ itemId: "meter", quantity: 1, serials: ["A"] }], reason: "Trying to hand off the reported stock", physicallyConfirmed: true }), /Pickup needs review/);
  const data = correct(state, "recording", line(["B", "C"], 1)), correctionId = randomUUID();
  state = post(state, "fulfillmentCorrect", data, correctionId);
  assert.deepEqual(state.stock.find(row => row.warehouseId === "stage" && row.itemId === "meter")?.serials.sort(), ["B", "C"]);
  assert.ok(state.stock.find(row => row.warehouseId === "source" && row.itemId === "meter")!.serials.includes("A"));
  assert.equal(state.stock.find(row => row.warehouseId === "source" && row.itemId === "part")!.quantity, 9);
  assert.equal(reserved(state, "stage", "meter"), 2);
  assert.equal(state.fulfillmentBatches![0].issues![0].status, "resolved");
  assert.deepEqual(state.receipts.slice(0, original.receipts.length), original.receipts);
  assert.deepEqual(post(state, "fulfillmentCorrect", data, correctionId), state);
  assert.throws(() => post(state, "fulfillmentCorrect", data), /batch changed/i);
  const tables = inventoryToRelational(state, 1);
  assert.equal(tables.get("inventory_fulfillment_issues")!.rows.length, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, value]) => [name, value.rows])), state.revision, Object.keys(state));
  assert.deepEqual(restored.fulfillmentBatches, state.fulfillmentBatches);
  assert.deepEqual(restored.receipts.at(-1)!.stagingCorrection, state.receipts.at(-1)!.stagingCorrection);
  validateInventoryBackup({ state: restored, enabled: true, movements: [] }, [1]);
  const html = inventoryFulfillmentPrint(restored.fulfillmentBatches![0], restored, "Project");
  assert.match(html, /Pickup problems and stock corrections/); assert.match(html, /Before:/); assert.match(html, /After:/);
});
test("wrong physical part returned after exchange does not credit stock twice", () => {
  const state = setup(), data = correct(state, "exchange", line(["A", "B"]), {
    observedReturns: [{ itemId: "part", quantity: 1, serials: [] }],
  });
  const after = post(state, "fulfillmentCorrect", data);
  assert.deepEqual(after.stock, state.stock);
  assert.match(after.receipts.at(-1)!.reason!, /already accounted at source; not credited again/);
  assert.throws(() => post(state, "fulfillmentCorrect", { ...data, observedReturns: [{ itemId: "part", quantity: 100, serials: [] }] }), /Unexpected returned stock/);
});
test("a mistaken report can be resolved by verified unchanged stock without an invented movement", () => {
  let state = setup();
  const before = structuredClone(state.stock), batch = state.fulfillmentBatches![0];
  state = post(state, "fulfillmentIssue", { id: batch.id, revision: batch.revision, itemId: "meter",
    category: "wrong_serial", description: "The crew initially thought the wrong meter was staged" });
  state = post(state, "fulfillmentCorrect", correct(state, "recording", line(["A", "B"])));
  assert.deepEqual(state.stock, before);
  assert.equal(state.fulfillmentBatches![0].issues![0].status, "resolved");
  assert.match(state.receipts.at(-1)!.reason!, /Pickup verified — no stock change/);
});
test("missing stock is not credited elsewhere and recovery is exact, protected and replay-safe", () => {
  let state = setup("scheduled");
  const source = structuredClone(state.stock.filter(row => row.warehouseId === "source"));
  state = post(state, "fulfillmentCorrect", correct(state, "missing", line(["B"], 1)));
  assert.deepEqual(state.stock.filter(row => row.warehouseId === "source"), source);
  const batch = state.fulfillmentBatches![0];
  assert.equal(batch.issues!.filter(row => row.status === "investigating").length, 2);
  assert.ok(state.serialOccupancy?.some(row => row.serial === "A" && row.workOrderId === null));
  assert.throws(() => post(state, "fulfillmentCorrect", correct(state, "recording", line(["A", "B"], 1))), /Insufficient|unavailable/);
  const meter = batch.issues!.find(row => row.itemId === "meter")!, op = randomUUID();
  const recovery = { id: batch.id, revision: batch.revision, issueId: meter.id, outcome: "found",
    warehouseId: "source", reason: "Located the meter on the original warehouse shelf", confirmed: true };
  state = post(state, "fulfillmentInvestigate", recovery, op);
  assert.deepEqual(post(state, "fulfillmentInvestigate", recovery, op), state);
  assert.ok(state.stock.find(row => row.warehouseId === "source" && row.itemId === "meter")!.serials.includes("A"));
  const part = state.fulfillmentBatches![0].issues!.find(row => row.itemId === "part")!;
  const before = structuredClone(state.stock);
  state = post(state, "fulfillmentInvestigate", { ...recovery, revision: state.fulfillmentBatches![0].revision,
    issueId: part.id, outcome: "written_off", warehouseId: undefined, reason: "Confirmed loss after reviewing all stock locations" });
  assert.deepEqual(state.stock, before);
});
test("corrections cannot change delivered units, exceed requirements, substitute items, duplicate or invent serials", () => {
  let state = setup();
  state = post(state, "fulfillmentMove", { id: state.fulfillmentBatches![0].id, revision: 2, phase: "vehicle",
    lines: [{ itemId: "meter", quantity: 1, serials: ["A"] }], reason: "Physical partial vehicle handoff verified", physicallyConfirmed: true });
  for (const data of [correct(state, "recording", line(["A"])), correct(state, "recording", line(["B", "C", "D"])),
    correct(state, "recording", line(["B", "B"])), correct(state, "recording", line(["UNKNOWN"])),
    correct(state, "recording", [{ itemId: "substitute", quantity: 1, serials: [] }]),
    correct(state, "missing", line(["B", "C"]))]) assert.throws(() => post(state, "fulfillmentCorrect", data));
  state = post(state, "fulfillmentCorrect", correct(state, "exchange", line(["C"])));
  assert.deepEqual(state.fulfillmentBatches![0].lines[0].deliveredSerials, ["A"]);
  assert.deepEqual(state.stock.find(row => row.warehouseId === "vehicle" && row.itemId === "meter")!.serials, ["A"]);
  assert.throws(() => post(state, "fulfillmentIssue", { id: state.fulfillmentBatches![0].id,
    revision: state.fulfillmentBatches![0].revision, itemId: "meter", category: "other", description: "Reporting without being assigned to this vehicle" }, randomUUID(), "outsider"), /current assignee/);
});
test("serialized kit correction and missing recovery preserve the original assembled contents", () => {
  let state = setup();
  state = post(state, "item", { id: "kit", sku: "KIT", name: "Meter kit", tracking: "serialized",
    components: [{ itemId: "meter", quantity: 1 }, { itemId: "part", quantity: 1 }] });
  for (const [serial, component] of [["K1", "C"], ["K2", "D"]]) {
    state = post(state, "assemble", { warehouseId: "source", itemId: "kit", quantity: 1, serials: [serial],
      components: [{ itemId: "meter", quantity: 1, serials: [component] }, { itemId: "part", quantity: 1, serials: [] }] });
  }
  const batch: FulfillmentBatch = { id: randomUUID(), name: "Kit pickup", mode: "crew", sourceId: "source", stagingId: "stage",
    vehicleId: "vehicle", status: "active", revision: 1, createdBy: "worker", createdAt: new Date().toISOString(),
    workOrders: [{ workOrderId: 2, assignmentVersion: 1, label: "CUSTOMER-KIT" }],
    lines: [{ workOrderId: 2, itemId: "kit", quantity: 1, stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }] };
  state = applyInventoryCommand(state, { operationId: randomUUID(), action: "fulfillmentCreate", data: { id: batch.id } },
    "worker", true, undefined, { fulfillmentBatch: batch }).state;
  state = post(state, "fulfillmentMove", { id: batch.id, revision: 1, phase: "stage", reason: "Physical kit staged for pickup",
    physicallyConfirmed: true, lines: [{ itemId: "kit", quantity: 1, serials: ["K1"] }] });
  const contents = structuredClone(kitSerialContents(state, "kit", "K2"));
  const base = { id: batch.id, confirmed: true, sourceVerified: true, ready: true, reason: "Verified the actual staged kit and source identities" };
  state = post(state, "fulfillmentCorrect", { ...base, revision: 2, mode: "recording",
    lines: [{ itemId: "kit", quantity: 1, serials: ["K2"] }] });
  assert.deepEqual(kitSerialContents(state, "kit", "K2"), contents);
  state = post(state, "fulfillmentCorrect", { ...base, revision: 3, mode: "missing",
    lines: [{ itemId: "kit", quantity: 0, serials: [] }] });
  const issue = state.fulfillmentBatches!.find(row => row.id === batch.id)!.issues![0];
  state = post(state, "fulfillmentInvestigate", { id: batch.id, revision: 4, issueId: issue.id, outcome: "found",
    warehouseId: "source", reason: "Located the complete assembled kit on a verified shelf", confirmed: true });
  assert.deepEqual(kitSerialContents(state, "kit", "K2"), contents);
  assert.ok(state.stock.find(row => row.itemId === "kit" && row.warehouseId === "source")!.serials.includes("K2"));
});
