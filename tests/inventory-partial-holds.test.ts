import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { remainingHold, orderLineProgress } from "../shared/inventory-shipment-model";
import { validateInventoryBackup as validateBackup } from "../server/inventoryBackup";
import { shipmentPrint } from "../server/inventoryShipmentPrint";

const post = (s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(s, { action, data, operationId }, "inspector", true).state;
const validateInventoryBackup = (state: InventoryState) => validateBackup({ state, enabled: true, movements: [] }, []);
function fixture() {
  let s = emptyInventory();
  for (const id of ["main", "van"]) s = post(s, "warehouse", { id, code: id, name: id, type: "physical", address: "Fixture" });
  s = post(s, "vendor", { id: "vendor", name: "Supplier" });
  for (const [id, tracking] of [["meter", "serialized"], ["seal", "regular"]])
    s = post(s, "item", { id, sku: id, name: id, tracking });
  s = post(s, "order", { id: "po", type: "purchase", destinationId: "main", vendorId: "vendor",
    lines: [{ itemId: "meter", quantity: 4 }, { itemId: "seal", quantity: 5 }] });
  s = post(s, "release", { orderId: "po" });
  return post(s, "receive", { orderId: "po", lines: [], damaged: [
    { itemId: "meter", quantity: 4, serials: ["0001", "0002"], unidentifiedQuantity: 2, reason: "Crushed carton" },
    { itemId: "seal", quantity: 5, reason: "Wet box" },
  ] });
}
test("partial known/unidentified dispositions retain original evidence, custody and exact retry identity", () => {
  let s = fixture();
  const originalHold = structuredClone(s.shipmentHolds![0]);
  const originalReceipt = structuredClone(s.receipts[0]), originalReceived = structuredClone(s.orders[0].received);
  const id = originalHold.id;
  const first = { id, outcome: "released", quantity: 1, serials: ["0001"], reason: "Verified working",
    verifiedSerials: ["0001"] };
  const operationId = randomUUID();
  s = post(s, "resolveHold", first, operationId);
  assert.deepEqual(post(s, "resolveHold", first, operationId), s);
  assert.throws(() => post(s, "resolveHold", { ...first, reason: "Changed" }, operationId), /different operation/);
  assert.throws(() => post(s, "resolveHold", first), /still in this hold/);
  assert.equal(s.stock[0].quantity, 1);
  assert.deepEqual(remainingHold(s.shipmentHolds![0]), { quantity: 3, serials: ["0002"],
    unidentifiedQuantity: 2, expectedSerials: [] });
  assert.equal(orderLineProgress(s, s.orders[0], "meter").held, 3);
  assert.equal(orderLineProgress(s, s.orders[0], "meter").usable, 1);
  // A count must still reject the unselected quarantined identity.
  const count = post(s, "countStart", { id: "count", warehouseId: "main" });
  assert.throws(() => post(count, "countPost", { id: "count", reason: "Bypass",
    lines: [{ itemId: "meter", quantity: 2, serials: ["0001", "0002"] }] }), /quarantined/);
  s = post(s, "resolveHold", { id, outcome: "returned", quantity: 1, unidentifiedQuantity: 1,
    reason: "One unreadable unit physically returned", reference: "Vendor RMA-42" });
  s = post(s, "resolveHold", { id, outcome: "released", quantity: 1, unidentifiedQuantity: 1,
    verifiedSerials: ["0003"], reason: "Read label after cleaning" });
  s = post(s, "resolveHold", { id, outcome: "scrapped", quantity: 1, serials: ["0002"], reason: "Destroyed housing" });
  const hold = s.shipmentHolds![0];
  assert.equal(hold.status, "resolved");
  assert.equal(remainingHold(hold).quantity, 0);
  assert.equal(hold.dispositions!.length, 4);
  const { dispositions, status, ...source } = hold;
  const { status: oldStatus, ...oldSource } = originalHold;
  assert.deepEqual(source, oldSource);
  assert.deepEqual(s.receipts[0], originalReceipt);
  assert.deepEqual(s.orders[0].received, originalReceived);
  assert.deepEqual(s.stock[0].serials, ["0001", "0003"]);
  assert.ok(s.serialOccupancy!.some(x => x.serial === "0002" && x.workOrderId === null));
  assert.throws(() => post(s, "resolveHold", { id, outcome: "released", reason: "Again", verifiedSerials: ["0002"] }),
    /Open shipment hold/);
  validateInventoryBackup(s);
  const printed = shipmentPrint("order", s.orders[0], s);
  assert.match(printed, /Remaining quarantined: 0/);
  for (const event of dispositions!) {
    assert.ok(printed.includes(`Receipt #${s.receipts.findIndex(receipt => receipt.id === event.operationId) + 1}`));
    assert.ok(!printed.includes(event.operationId));
    assert.ok(printed.includes(event.reason));
    const receipt = s.receipts.find(r => r.id === event.operationId)!;
    assert.match(shipmentPrint("receipt", receipt, s), /covers 1 units only/);
    assert.equal(receipt.actor, "inspector");
  }
  // Scrapped identities cannot be reintroduced through another purchase.
  s = post(s, "order", { id: "later", type: "purchase", destinationId: "main", vendorId: "vendor",
    lines: [{ itemId: "meter", quantity: 1 }] });
  s = post(s, "release", { orderId: "later" });
  assert.throws(() => post(s, "receive", { orderId: "later",
    lines: [{ itemId: "meter", quantity: 1, serials: ["0002"] }] }), /installed|disposed|occupied/);
});

test("quantity goods release/return/write-off only selected counts and reject invalid selection atomically", () => {
  let s = fixture();
  const id = s.shipmentHolds![1].id;
  for (const data of [
    { quantity: 6 }, { quantity: 0 }, { quantity: 1.5 }, { quantity: 1, serials: ["0001"] },
    { quantity: 1, unidentifiedQuantity: 1 }, { quantity: 1, verifiedSerials: ["0001"] },
  ]) assert.throws(() => post(s, "resolveHold", { id, outcome: "released", reason: "Inspect", ...data }));
  s = post(s, "resolveHold", { id, outcome: "released", quantity: 2, reason: "Two tested seals" });
  assert.equal(remainingHold(s.shipmentHolds![1]).quantity, 3);
  validateInventoryBackup(s);
  s = post(s, "resolveHold", { id, outcome: "returned", quantity: 1, reason: "Return torn seal", reference: "RMA-43" });
  s = post(s, "resolveHold", { id, outcome: "scrapped", reason: "Remaining two unusable" });
  assert.equal(s.stock.find(x => x.itemId === "seal")!.quantity, 2);
  assert.equal(remainingHold(s.shipmentHolds![1]).quantity, 0);
  assert.equal(s.shipmentHolds![1].status, "resolved");
  validateInventoryBackup(s);
});

test("transfer unidentified selections retain exact dispatch references and prevent substitution", () => {
  let s = fixture();
  const id = s.shipmentHolds![0].id;
  for (const data of [
    { quantity: 1, serials: ["0001"], verifiedSerials: ["0002"] },
    { quantity: 1, unidentifiedQuantity: 1, verifiedSerials: ["0001"] },
    { quantity: 2, serials: ["0001", "0001"], verifiedSerials: ["0001", "0001"] },
    { serials: ["0001"], verifiedSerials: ["0001"] },
  ]) assert.throws(() => post(s, "resolveHold", { id, outcome: "released", reason: "Inspect", ...data }));
  s = post(s, "resolveHold", { id, outcome: "released", verifiedSerials: ["0001", "0002", "0003", "0004"], reason: "All verified" });
  s = post(s, "order", { id: "tr", type: "transfer", sourceId: "main", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 3 }] });
  s = post(s, "release", { orderId: "tr" });
  s = post(s, "dispatch", { orderId: "tr", lines: [{ itemId: "meter", quantity: 3, serials: ["0001", "0002", "0003"] }] });
  s = post(s, "accept", { orderId: "tr", lines: [], damaged: [{ itemId: "meter", quantity: 3,
    serials: ["0001"], unidentifiedQuantity: 2, expectedSerials: ["0002", "0003"], reason: "Transit damage" }] });
  const transferHold = s.shipmentHolds!.find(h => h.orderId === "tr")!;
  const partial = { id: transferHold.id, outcome: "released", quantity: 1, unidentifiedQuantity: 1,
    expectedSerials: ["0002"], verifiedSerials: ["0002"], reason: "Label verified" };
  assert.throws(() => post(s, "resolveHold", { ...partial, expectedSerials: [] }), /dispatch reference/);
  assert.throws(() => post(s, "resolveHold", { ...partial, verifiedSerials: ["0003"] }), /match.*dispatched/);
  s = post(s, "resolveHold", partial);
  assert.deepEqual(remainingHold(s.shipmentHolds!.find(h => h.id === transferHold.id)!).expectedSerials, ["0003"]);
  s = post(s, "resolveHold", { id: transferHold.id, outcome: "scrapped", quantity: 1,
    unidentifiedQuantity: 1, expectedSerials: ["0003"], reason: "Unreadable and destroyed" });
  validateInventoryBackup(s);
});

test("backup validation rejects corrupt partial histories and accepts older whole-batch snapshots", () => {
  let s = fixture();
  const id = s.shipmentHolds![0].id;
  s = post(s, "resolveHold", { id, outcome: "released", quantity: 1, serials: ["0001"],
    verifiedSerials: ["0001"], reason: "Inspect" });
  validateInventoryBackup(s);
  for (const damage of [
    (x: InventoryState) => { x.shipmentHolds![0].dispositions!.push(x.shipmentHolds![0].dispositions![0]); },
    (x: InventoryState) => { x.shipmentHolds![0].status = "released"; },
    (x: InventoryState) => { x.receipts.pop(); },
    (x: InventoryState) => { x.receipts.at(-1)!.holdDisposition!.quantity = 3; },
    (x: InventoryState) => { x.shipmentHolds![0].serials = []; },
  ]) {
    const bad = structuredClone(s); damage(bad);
    assert.throws(() => validateInventoryBackup(bad));
  }
  // Simulate a pre-partial-disposition archive, not a conversion on restore.
  let legacy = fixture();
  legacy = post(legacy, "resolveHold", { id: legacy.shipmentHolds![1].id, outcome: "returned",
    reason: "Old whole batch return", reference: "RMA-old" });
  const oldHold = legacy.shipmentHolds![1], event = oldHold.dispositions![0];
  oldHold.resolution = { operationId: event.operationId, actor: event.actor, occurredAt: event.occurredAt,
    reason: event.reason, reference: event.reference, verifiedSerials: [] };
  delete oldHold.dispositions;
  delete legacy.receipts.at(-1)!.holdDisposition;
  validateInventoryBackup(legacy);
  assert.equal(remainingHold(oldHold).quantity, 0);
  assert.equal(orderLineProgress(legacy, legacy.orders[0], "seal").held, 0);
});
