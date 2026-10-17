import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, commandPermission, inventoryPermissions, inventoryCommandSchema, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder, reserved } from "../shared/inventory-engine";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { orderLineProgress } from "../shared/inventory-shipment-model";
import { blankShipmentCapture } from "../shared/inventory-shipment-draft-model";
import { initialLocationTypes } from "../shared/inventory-location-types";

const actor = "admin";
function post(s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) {
  return applyInventoryCommand(s, { action, data, operationId }, actor, true).state;
}
function setup() {
  let s = emptyInventory();
  // This suite exercises restricted-location safeguards; shared defaults have their own coverage.
  s.locationTypes = initialLocationTypes("assigned");
  for (const id of ["main", "van"]) s = post(s, "warehouse", { id, code: id, name: id, type: "physical", address: "Test location" });
  s = post(s, "vendor", { id: "vendor", name: "Test vendor" });
  s = post(s, "item", { id: "meter", sku: "meter", name: "Meter", tracking: "serialized", equipment: "system" });
  s = post(s, "item", { id: "seal", sku: "seal", name: "Seal", tracking: "regular" });
  s = post(s, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main", lines: [
    { itemId: "meter", quantity: 3 }, { itemId: "seal", quantity: 10 },
  ] });
  s = post(s, "release", { orderId: "po" });
  s = post(s, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 3, serials: ["00001", "00002", "00003"] }, { itemId: "seal", quantity: 10 },
  ] });
  return s;
}

test("purchase orders can be un-released, edited and released again only before receiving", () => {
  let s = setup();
  const data = { id: "editable-po", type: "purchase", vendorId: "vendor", destinationId: "main",
    lines: [{ itemId: "seal", quantity: 5 }] };
  const stock = structuredClone(s.stock), receipts = structuredClone(s.receipts);
  s = post(s, "order", data);
  assert.throws(() => post(s, "unrelease", { orderId: data.id }), /Only released/);
  s = post(s, "release", { orderId: data.id });
  const operationId = randomUUID();
  const request = { action: "unrelease" as const, operationId, data: { orderId: data.id } };
  assert.equal(inventoryCommandSchema.parse(request).action, "unrelease");
  s = post(s, "unrelease", request.data, operationId);
  assert.deepEqual(post(s, "unrelease", request.data, operationId), s, "same operation retry is safe");
  assert.equal(s.orders.find(o => o.id === data.id)?.status, "draft");
  assert.throws(() => post(s, "receive", { orderId: data.id, lines: data.lines }), /Release an open/);
  assert.throws(() => post(s, "order", { ...data, type: "transfer", vendorId: null, sourceId: "van" }), /Order type cannot change/);
  s = post(s, "order", { ...data, notes: "Add a serialized meter", lines: [
    { itemId: "seal", quantity: 8 }, { itemId: "meter", quantity: 1 },
  ] });
  assert.deepEqual(s.stock, stock); assert.deepEqual(s.receipts, receipts);
  s = post(s, "release", { orderId: data.id });
  const released = s;
  assert.throws(() => applyInventoryCommand(s, { ...request, operationId: randomUUID() }, "outsider", false), /Warehouse access/);
  assert.deepEqual(s, released, "unauthorized attempt does not mutate the order");
  s = post(s, "receive", { orderId: data.id, lines: [{ itemId: "seal", quantity: 1 }] });
  assert.throws(() => post(s, "unrelease", request.data), /Only released/);
  // A stale released status must not allow erasing previously posted activity.
  const inconsistent = structuredClone(s);
  inconsistent.orders.find(o => o.id === data.id)!.status = "released";
  assert.throws(() => post(inconsistent, "unrelease", request.data), /posted receipts/);
  assert.throws(() => post(s, "unrelease", { orderId: "po" }), /Only released/);
  assert.equal(commandPermission("unrelease"), null, "permission is resolved from the persisted order type");
});

test("transfers return to draft without moving stock, retain identity and block dispatch until re-released", () => {
  let s = setup();
  const data = { id: "editable-transfer", type: "transfer", sourceId: "main", destinationId: "van",
    lines: [{ itemId: "seal", quantity: 2 }] };
  s = post(s, "order", data);
  s = post(s, "release", { orderId: data.id });
  const original = structuredClone(s), number = s.orders.find(o => o.id === data.id)!.orderNumber;
  const operationId = randomUUID();
  s = post(s, "unrelease", { orderId: data.id }, operationId);
  assert.deepEqual(post(s, "unrelease", { orderId: data.id }, operationId), s);
  assert.equal(s.orders.find(o => o.id === data.id)!.status, "draft");
  assert.throws(() => post(s, "dispatch", { orderId: data.id, lines: data.lines }), /Release an open/);
  s = post(s, "order", { ...data, lines: [{ itemId: "seal", quantity: 4 }, { itemId: "meter", quantity: 1 }] });
  assert.deepEqual(s.stock, original.stock);
  assert.deepEqual(s.receipts, original.receipts);
  assert.equal(s.orders.find(o => o.id === data.id)!.orderNumber, number);
  s = post(s, "release", { orderId: data.id });
  const draft = { id: randomUUID(), revision: 0, orderId: data.id, stage: "dispatch", capture: blankShipmentCapture() };
  const captured = post(s, "shipmentDraftSave", draft);
  assert.throws(() => post(captured, "unrelease", { orderId: data.id }), /saved shipment drafts/);
  for (const accessible of [["main"], ["van"]]) {
    const restricted = structuredClone(s);
    for (const warehouse of restricted.warehouses) warehouse.userIds = accessible.includes(warehouse.id) ? ["tech"] : [];
    assert.throws(() => applyInventoryCommand(restricted, { action: "unrelease", data: { orderId: data.id }, operationId: randomUUID() }, "tech", false), /Warehouse access/);
  }
  s = post(s, "dispatch", { orderId: data.id, lines: [{ itemId: "seal", quantity: 1 }] });
  assert.throws(() => post(s, "unrelease", { orderId: data.id }), /Only released|posted receipts/);
  const stale = structuredClone(s);
  stale.orders.find(o => o.id === data.id)!.status = "released";
  assert.throws(() => post(stale, "unrelease", { orderId: data.id }), /posted receipts/);
  assert.throws(() => post(stale, "archiveOrder", { orderId: data.id }), /Purchase order required/);
});

test("clearing cancelled POs preserves stock, receipts and IDs and supports restoration", () => {
  let s = setup();
  s = post(s, "order", { id: "cancel-po", type: "purchase", vendorId: "vendor", destinationId: "main",
    lines: [{ itemId: "seal", quantity: 5 }] });
  s = post(s, "release", { orderId: "cancel-po" });
  s = post(s, "receive", { orderId: "cancel-po", lines: [{ itemId: "seal", quantity: 2 }] });
  assert.throws(() => post(s, "archiveOrder", { orderId: "cancel-po" }), /Only cancelled/);
  s = post(s, "cancel", { orderId: "cancel-po" });
  const stock = structuredClone(s.stock), receipts = structuredClone(s.receipts), orders = s.orders.length;
  const operationId = randomUUID();
  assert.throws(() => applyInventoryCommand(s, { action: "archiveOrder", operationId,
    data: { orderId: "cancel-po" } }, "outsider", false), /Warehouse access/);
  s = post(s, "archiveOrder", { orderId: "cancel-po" }, operationId);
  assert.ok(s.orders.find(o => o.id === "cancel-po")?.archivedAt);
  assert.deepEqual(post(s, "archiveOrder", { orderId: "cancel-po" }, operationId), s);
  assert.equal(s.orders.length, orders);
  assert.deepEqual(s.stock, stock); assert.deepEqual(s.receipts, receipts);
  assert.throws(() => post(s, "order", { id: "cancel-po", type: "purchase", vendorId: "vendor",
    destinationId: "main", lines: [{ itemId: "seal", quantity: 1 }] }), /Only draft/);
  s = JSON.parse(JSON.stringify(s));
  s = post(s, "restoreOrder", { orderId: "cancel-po" });
  assert.equal(s.orders.find(o => o.id === "cancel-po")?.archivedAt, undefined);
  assert.equal(s.orders.find(o => o.id === "cancel-po")?.status, "cancelled");
  s = post(s, "order", { id: "tr", type: "transfer", sourceId: "main", destinationId: "van",
    lines: [{ itemId: "seal", quantity: 1 }] });
  s = post(s, "cancel", { orderId: "tr" });
  assert.throws(() => post(s, "unrelease", { orderId: "tr" }), /Only released/);
  for (const action of ["archiveOrder", "restoreOrder"] as const) {
    assert.throws(() => post(s, action, { orderId: "tr" }), /Purchase order required/);
    assert.equal(commandPermission(action), inventoryPermissions.purchase);
  }
});

test("serialized transfer drafts plan quantities without scans; dispatch and arrival validate actual identities", () => {
  let s = setup();
  const before = structuredClone(s.stock);
  const order = { id: "quantity-transfer", type: "transfer", sourceId: "main", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 2 }, { itemId: "seal", quantity: 3 }] };
  s = post(s, "order", order);
  s = post(s, "order", { ...order, lines: [{ itemId: "meter", quantity: 3 }, { itemId: "seal", quantity: 5 }] });
  assert.deepEqual(s.stock, before, "inline planning quantity changes must not move stock");
  assert.deepEqual(s.orders.find(o => o.id === order.id)?.lines.map(l => l.serials), [[], []]);
  for (const quantity of [0, -1, 1.5, 1000001]) assert.throws(() => post(s, "order", {
    ...order, lines: [{ itemId: "meter", quantity }],
  }));
  s = post(s, "release", { orderId: order.id });
  assert.throws(() => post(s, "dispatch", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1 }] }), /match scanned serials/);
  assert.throws(() => post(s, "dispatch", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["FOREIGN"] }] }), /unavailable/);
  assert.throws(() => post(s, "accept", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }] }), /exceeds remaining/);
  s = post(s, "dispatch", { orderId: order.id, lines: [
    { itemId: "meter", quantity: 2, serials: ["00001", "00002"] }, { itemId: "seal", quantity: 2 },
  ] });
  assert.throws(() => post(s, "accept", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["00003"] }] }), /Unexpected/);
  const receiptCount = s.receipts.length;
  s = post(s, "accept", { orderId: order.id, lines: [
    { itemId: "meter", quantity: 1, serials: ["00001"] }, { itemId: "seal", quantity: 2 },
  ] });
  assert.equal(s.receipts.length, receiptCount + 1);
  assert.equal(s.receipts.at(-1)?.reference, order.id, "movement receipt links back to the unique order reference");
  assert.deepEqual(s.stock.find(b => b.warehouseId === "van" && b.itemId === "meter")?.serials, ["00001"]);
  assert.throws(() => post(s, "accept", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }] }), /previously received/);
});

test("count drafts preserve unfinished input, isolate editors and never change the stock snapshot", () => {
  let s = setup();
  s = post(s, "countStart", { id: "draft-count", warehouseId: "main" });
  const stock = structuredClone(s.stock), snapshot = structuredClone(s.counts[0].snapshot);
  const data = { id: "draft-count", revision: 0, reason: "Half scanned", rows: [
    { itemId: "meter", quantity: "", serials: "00001\n00001\nunfinished" },
    { itemId: "seal", quantity: "007", serials: "" },
  ] };
  const operationId = randomUUID();
  s = post(s, "countSaveDraft", data, operationId);
  assert.deepEqual(s.stock, stock);
  assert.deepEqual(s.counts[0].snapshot, snapshot);
  assert.deepEqual(s.counts[0].draft?.rows, data.rows);
  assert.equal(s.counts[0].draft?.savedBy, actor);
  assert.equal(s.counts[0].draft?.revision, 1);
  assert.deepEqual(post(s, "countSaveDraft", data, operationId), s, "identical network retry is idempotent");
  const restored: InventoryState = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restored.counts[0].draft, s.counts[0].draft);
  assert.throws(() => post(s, "countSaveDraft", data), /Count draft changed/);
  assert.throws(() => applyInventoryCommand(s, { action: "countSaveDraft", operationId: randomUUID(),
    data: { ...data, revision: 1 } }, "unauthorized", false), /Warehouse access/);
  assert.throws(() => post(s, "countSaveDraft", { ...data, revision: 1, rows: [{ itemId: "foreign", quantity: "1", serials: "" }] }), /not in this project/);
  const lines = snapshot.map(b => ({ itemId: b.itemId, quantity: b.quantity, serials: b.serials }));
  assert.throws(() => post(s, "countPost", { id: "draft-count", lines, reason: "Older editor", draftRevision: 0 }), /Count draft changed/);
  assert.throws(() => post(s, "countPost", { id: "draft-count", lines, reason: "Legacy editor" }), /Count draft changed/);
  const posted = post(s, "countPost", { id: "draft-count", lines, reason: "Verified", draftRevision: 1 });
  assert.equal(posted.counts[0].status, "posted");
  assert.equal(posted.counts[0].draft, undefined);
  const moved = post(s, "countStart", { id: "other", warehouseId: "main" });
  const changed = post(moved, "countPost", { id: "other", reason: "Stock correction",
    lines: lines.map(l => l.itemId === "seal" ? { ...l, quantity: 11 } : l) });
  assert.throws(() => post(changed, "countPost", { id: "draft-count", lines, reason: "Stale snapshot", draftRevision: 1 }), /Stock moved/);
  const cancelled = post(s, "countCancel", { id: "draft-count", reason: "Restart" });
  assert.equal(cancelled.counts[0].draft, undefined);
  assert.throws(() => post(cancelled, "countSaveDraft", { ...data, revision: 1 }), /Open count/);
});

test("installed serials can be removed, inspected, reinstalled and returned again without erasing history", () => {
  let s = setup();
  const install = (id: number, serial: string, removed?: string) => {
    s = post(s, "assign", { workOrderId: id, lines: [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: [serial] }] });
    s = post(s, "prepareUse", { workOrderId: id, revision: 1, mode: "changeout",
      used: [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: [serial] }],
      dispositions: removed ? [{ equipment: "system", serial: removed, disposition: "returned", warehouseId: "main" }] : [] });
    s = completeInventoryWorkOrder(s, id, false);
  };
  const release = (id: number) => {
    const ret = s.returns.find(r => r.workOrderId === id)!;
    s = post(s, "returnAccept", { id: ret.id });
    s = post(s, "returnRelease", { id: ret.id, itemId: "meter", reason: "Inspected and tested" });
  };
  const duplicate = () => {
    const counted = post(s, "countStart", { id: randomUUID(), warehouseId: "main" });
    const count = counted.counts.at(-1)!;
    const lines = counted.stock.map(b => ({ itemId: b.itemId, quantity: b.quantity + (b.itemId === "meter" ? 1 : 0),
      serials: b.itemId === "meter" ? [...b.serials, "00001"] : b.serials }));
    assert.throws(() => post(counted, "countPost", { id: count.id, lines, reason: "Duplicate attempt" }), /already installed/);
  };
  install(101, "00001"); duplicate();
  install(102, "00002", "00001"); release(102);
  assert.ok(s.stock.find(b => b.itemId === "meter")!.serials.includes("00001"));
  install(103, "00001"); duplicate(); // An older approved return must not authorize another copy.
  install(104, "00003", "00001"); release(104);
  assert.deepEqual(s.stock.find(b => b.itemId === "meter")!.serials, ["00001"]);
  assert.equal(s.allocations.find(a => a.workOrderId === 101)!.status, "consumed");
  assert.equal(s.serialOccupancy!.filter(o => o.itemId === "meter").length, 2);
});
test("mixed receipts preserve serials and retries do not move stock twice", () => {
  let s = setup();
  s = post(s, "order", { id: "po2", type: "purchase", vendorId: "vendor", destinationId: "main", lines: [{ itemId: "seal", quantity: 2 }] });
  s = post(s, "release", { orderId: "po2" });
  const command = { action: "receive" as const, operationId: randomUUID(), data: { orderId: "po2", lines: [{ itemId: "seal", quantity: 2 }] } };
  const r = applyInventoryCommand(s, command, actor, true);
  assert.equal(r.state.stock.find(b => b.itemId === "seal")?.quantity, 12);
  assert.equal(applyInventoryCommand(r.state, command, actor, true).replay, true);
  assert.throws(() => applyInventoryCommand(r.state, { ...command, data: { orderId: "po2", lines: [{ itemId: "seal", quantity: 3 }] } }, actor, true), /different operation/);
  assert.deepEqual(r.state.stock.find(b => b.itemId === "meter")?.serials, ["00001", "00002", "00003"]);
});
test("reservations prevent concurrent assignments and completion consumes once", () => {
  let s = setup();
  s = post(s, "assign", { workOrderId: 1, lines: [{ warehouseId: "main", itemId: "meter", quantity: 1, serials: ["00001"] }, { warehouseId: "main", itemId: "seal", quantity: 2 }] });
  assert.equal(reserved(s, "main", "meter"), 1);
  assert.equal(s.stock.find(b => b.itemId === "meter")?.quantity, 3);
  assert.throws(() => post(s, "assign", { workOrderId: 2, lines: [{ warehouseId: "main", itemId: "meter", quantity: 1, serials: ["00001"] }] }), /reserved/);
  s = post(s, "prepareUse", { workOrderId: 1, revision: 1, mode: "changeout", used: [{ warehouseId: "main", itemId: "meter", quantity: 1, serials: ["00001"] }], dispositions: [{ equipment: "system", serial: "old01", disposition: "returned", warehouseId: "main" }] });
  s = completeInventoryWorkOrder(s, 1, false);
  assert.equal(s.stock.find(b => b.itemId === "meter")?.quantity, 2);
  assert.equal(s.stock.find(b => b.itemId === "seal")?.quantity, 10);
  assert.equal(reserved(s, "main", "seal"), 0);
  assert.deepEqual(completeInventoryWorkOrder(s, 1, false), s);
  assert.equal(s.returns[0].status, "pending");
  s = post(s, "returnAccept", { id: s.returns[0].id });
  assert.equal(s.stock.find(b => b.itemId === "meter")?.quantity, 2);
  s = post(s, "returnRelease", { id: s.returns[0].id, itemId: "meter", reason: "Inspected and serviceable" });
  assert.equal(s.stock.find(b => b.itemId === "meter")?.quantity, 3);
});
test("reading-only completion releases reservations without consuming", () => {
  let s = post(setup(), "assign", { workOrderId: 2, lines: [] });
  s = post(s, "prepareUse", { workOrderId: 2, revision: 1, mode: "reading_only", used: [], dispositions: [] });
  const done = completeInventoryWorkOrder(s, 2, true);
  assert.deepEqual(done.stock, s.stock);
  assert.equal(done.allocations[0].status, "released");
  assert.throws(() => post(s, "prepareUse", { workOrderId: 2, revision: s.allocations.find(a => a.workOrderId === 2)!.revision, mode: "reading_only", used: [{ warehouseId: "main", itemId: "seal", quantity: 1 }], dispositions: [] }), /Reading-only/);
});
test("partial transfer dispatch/acceptance and cancellation retain stock", () => {
  let s = setup();
  s = post(s, "order", { id: "to", type: "transfer", sourceId: "main", destinationId: "van", lines: [{ itemId: "meter", quantity: 2, serials: ["00001", "00002"] }] });
  s = post(s, "release", { orderId: "to" });
  s = post(s, "dispatch", { orderId: "to", lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }] });
  assert.equal(s.stock.find(b => b.warehouseId === "main" && b.itemId === "meter")?.quantity, 2);
  assert.throws(() => post(s, "cancel", { orderId: "to" }), /Receive dispatched/);
  s = post(s, "accept", { orderId: "to", lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }] });
  assert.equal(s.stock.find(b => b.warehouseId === "van")?.quantity, 1);
  s = post(s, "cancel", { orderId: "to" });
  assert.equal(s.orders.find(o => o.id === "to")?.status, "cancelled");
});
test("kit assembly retains component lineage and prevents cycles", () => {
  let s = post(setup(), "item", { id: "kit", sku: "kit", name: "Meter kit", tracking: "serialized", components: [{ itemId: "meter", quantity: 1 }, { itemId: "seal", quantity: 2 }] });
  s = post(s, "assemble", { warehouseId: "main", itemId: "kit", quantity: 1, serials: ["KIT0001"], components: [{ itemId: "meter", quantity: 1, serials: ["00001"] }, { itemId: "seal", quantity: 2 }] });
  assert.equal(s.stock.find(b => b.itemId === "kit")?.quantity, 1);
  assert.equal(s.stock.find(b => b.itemId === "seal")?.quantity, 8);
  assert.equal(s.receipts.at(-1)?.components?.[0].serials[0], "00001");
  assert.throws(() => post(emptyInventory(), "item", { id: "a", sku: "a", name: "Bad kit", tracking: "regular", components: [{ itemId: "a", quantity: 1 }] }), /cycle/);
});
test("counts detect intervening movements and permit explicit zero", () => {
  let s = post(setup(), "countStart", { id: "count", warehouseId: "main" });
  s = post(s, "countPost", { id: "count", reason: "Physical stock checked", lines: [{ itemId: "meter", quantity: 3, serials: ["00001", "00002", "00003"] }, { itemId: "seal", quantity: 0 }] });
  assert.equal(s.stock.find(b => b.itemId === "seal")?.quantity, 0);
  let moved = post(setup(), "countStart", { id: "count", warehouseId: "main" });
  moved = post(moved, "order", { id: "p2", type: "purchase", destinationId: "main", vendorId: "vendor", lines: [{ itemId: "seal", quantity: 1 }] });
  moved = post(moved, "release", { orderId: "p2" });
  moved = post(moved, "receive", { orderId: "p2", lines: [{ itemId: "seal", quantity: 1 }] });
  assert.throws(() => post(moved, "countPost", { id: "count", reason: "Stale", lines: [] }), /Stock moved/);
});
test("warehouse scoping, required vehicle fields and failed mutations leave state intact", () => {
  const s = setup(), serialized = JSON.stringify(s);
  assert.throws(() => applyInventoryCommand(s, { operationId: randomUUID(), action: "countStart", data: { id: "bad", warehouseId: "main" } }, "unauthorized", false), /access required/);
  assert.throws(() => post(s, "warehouse", { id: "bad", code: "bad", name: "bad", type: "vehicle" }), /VIN|Plate/);
  assert.throws(() => post(s, "assign", { workOrderId: 1, lines: [{ warehouseId: "main", itemId: "seal", quantity: 100 }] }), /Insufficient/);
  assert.equal(JSON.stringify(s), serialized);
});

const shipmentPO = (s: InventoryState, id = "shipment", quantity = 4) => {
  s = post(s, "order", { id, type: "purchase", destinationId: "main", vendorId: "vendor",
    lines: [{ itemId: "meter", quantity }, { itemId: "seal", quantity }] });
  return post(s, "release", { orderId: id });
};
const damage = (itemId: string, quantity: number, serials: string[] = [], unidentifiedQuantity = 0, expectedSerials: string[] = []) =>
  ({ itemId, quantity, serials, unidentifiedQuantity, expectedSerials, reason: "Crushed shipping carton; inspection required" });

test("good, damaged and unidentified physical receipts stay separate; inspection and short closure preserve evidence", () => {
  let s = shipmentPO(setup());
  const id = randomUUID(), data = { orderId: "shipment",
    lines: [{ itemId: "meter", quantity: 1, serials: ["00010"] }, { itemId: "seal", quantity: 1 }],
    damaged: [damage("meter", 2, ["00011"], 1), damage("seal", 2)] };
  s = post(s, "receive", data, id);
  assert.deepEqual(post(s, "receive", data, id), s, "retry never creates duplicate physical receipt or holds");
  assert.equal(s.stock.find(b => b.itemId === "meter")!.quantity, 4);
  assert.equal(s.stock.find(b => b.itemId === "seal")!.quantity, 11);
  const order = s.orders.find(o => o.id === "shipment")!;
  assert.deepEqual(orderLineProgress(s, order, "meter"), {
    ordered: 4, dispatched: 0, received: 3, damaged: 2, held: 2, usable: 1, lost: 0, closedShort: 0, inTransit: 0, remaining: 1,
  });
  assert.equal(order.status, "partial");
  const hold = s.shipmentHolds!.find(h => h.itemId === "meter")!;
  const held = structuredClone(s);
  assert.throws(() => post(s, "warehouse", { ...s.warehouses[0], active: false }), /stock or unresolved/);
  assert.throws(() => post(s, "item", { ...s.items[0], tracking: "regular" }), /Cannot change tracking/);
  assert.throws(() => post(s, "resolveHold", { id: hold.id, outcome: "released", reason: "Inspection",
    verifiedSerials: ["00011"] }), /match scanned serials/);
  assert.throws(() => post(s, "resolveHold", { id: hold.id, outcome: "released", reason: "Inspection",
    verifiedSerials: ["BAD", "00012"] }), /Keep every/);
  assert.throws(() => post(s, "resolveHold", { id: hold.id, outcome: "returned", reason: "Vendor return" }), /destination/);
  assert.throws(() => applyInventoryCommand(s, { action: "resolveHold", operationId: randomUUID(),
    data: { id: hold.id, outcome: "scrapped", reason: "Inspection" } }, "outsider", false), /Warehouse access/);
  assert.deepEqual(s, held, "failures preserve balances, scans and custody");
  // Ordinary stock counts must not fabricate the verified quarantined identity.
  let counted = post(s, "countStart", { id: "held-count", warehouseId: "main" });
  assert.throws(() => post(counted, "countPost", { id: "held-count", reason: "Attempted bypass",
    lines: counted.stock.map(b => ({ itemId: b.itemId, quantity: b.quantity + (b.itemId === "meter" ? 1 : 0),
      serials: b.itemId === "meter" ? [...b.serials, "00011"] : b.serials })) }), /quarantined/);
  const resolution = { id: hold.id, outcome: "released", reason: "Inspected, read and verified both labels",
    verifiedSerials: ["00011", "00012"] };
  const resolutionId = randomUUID();
  s = post(s, "resolveHold", resolution, resolutionId);
  assert.deepEqual(post(s, "resolveHold", resolution, resolutionId), s);
  assert.throws(() => post(s, "resolveHold", resolution), /Open shipment hold/);
  assert.equal(s.stock.find(b => b.itemId === "meter")!.quantity, 6);
  assert.ok(s.stock.find(b => b.itemId === "meter")!.serials.includes("00012"));
  const sealHold = s.shipmentHolds!.find(h => h.itemId === "seal")!;
  s = post(s, "resolveHold", { id: sealHold.id, outcome: "returned", reason: "Return damaged seals",
    reference: "Supplier dock; RMA-123 / carrier tracking" });
  assert.equal(s.stock.find(b => b.itemId === "seal")!.quantity, 11, "returning quarantine never reduces good stock");
  const closeId = randomUUID(), closeData = { orderId: "shipment", reason: "Vendor cannot supply remaining units" };
  s = post(s, "closeOrder", closeData, closeId);
  assert.deepEqual(post(s, "closeOrder", closeData, closeId), s);
  assert.equal(s.orders.find(o => o.id === "shipment")!.status, "closed");
  assert.deepEqual(s.orders.find(o => o.id === "shipment")!.closure!.unfulfilled.map(l => l.quantity), [1, 1]);
  assert.deepEqual(s.orders.find(o => o.id === "shipment")!.lines.map(l => l.quantity), [4, 4]);
  assert.throws(() => post(s, "receive", data), /Release an open/);
  validateInventoryBackup({ state: JSON.parse(JSON.stringify(s)), enabled: true, movements: [] }, []);
  for (const corrupt of [
    (copy: InventoryState) => { copy.shipmentHolds![0].receiptId = "missing"; },
    (copy: InventoryState) => { copy.orders.find(o => o.id === "shipment")!.closure!.unfulfilled[0].quantity++; },
  ]) { const copy = structuredClone(s); corrupt(copy); assert.throws(() => validateInventoryBackup({ state: copy, enabled: true, movements: [] }, []), /shipment backup/); }
});

test("damage identity validation, reservations and transactional close reject mismatches without mutation", () => {
  let s = shipmentPO(setup());
  const before = structuredClone(s);
  for (const damaged of [
    [damage("meter", 2, ["DUP", "DUP"])],
    [damage("meter", 2, ["ONE"])],
    [damage("seal", 1, [], 1)],
    [damage("meter", 1, ["00001"])],
    [damage("meter", 1, ["NEW"], 0, ["UNEXPECTED"])],
  ]) assert.throws(() => post(s, "receive", { orderId: "shipment", lines: [], damaged }));
  assert.throws(() => post(s, "receive", { orderId: "shipment",
    lines: [{ itemId: "meter", quantity: 1, serials: ["DUP"] }], damaged: [damage("meter", 1, ["DUP"])] }), /Duplicate/);
  assert.throws(() => post(s, "receive", { orderId: "shipment", lines: [], damaged: [damage("seal", 5)] }), /remaining/);
  assert.throws(() => post(s, "receive", { orderId: "shipment", lines: [], closeRemainder: true }), /reason/);
  assert.deepEqual(s, before);
  s = post(s, "receive", { orderId: "shipment", lines: [], damaged: [damage("meter", 1, ["HELD"])],
    closeRemainder: true, reason: "Accept damaged carton, close short remainder" });
  const hold = s.shipmentHolds![0];
  assert.equal(s.orders.find(o => o.id === "shipment")!.status, "closed");
  assert.equal(hold.status, "held", "closing the order never deletes its pending inspection");
  assert.throws(() => post(s, "assign", { workOrderId: 1,
    lines: [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: ["HELD"] }] }), /unavailable/);
  s = post(s, "resolveHold", { id: hold.id, outcome: "scrapped", reason: "Confirmed unrepairable" });
  assert.equal(s.stock.find(b => b.itemId === "meter")!.quantity, 3);
  assert.ok(s.serialOccupancy!.some(x => x.serial === "HELD"));
  assert.equal(s.orders.find(o => o.id === "shipment")!.status, "closed");
  // A zero-arrival closure is evidence, not a movement with invented zero units.
  s = shipmentPO(s, "never-arrived", 1);
  const stock = structuredClone(s.stock);
  s = post(s, "closeOrder", { orderId: "never-arrived", reason: "Shipment cancelled by supplier" });
  assert.deepEqual(s.stock, stock);
  assert.deepEqual(s.receipts.at(-1)!.lines, []);
});

test("transfers require physical arrival scans or explicit loss, preserving transit and quarantine custody", () => {
  let s = setup();
  s = post(s, "order", { id: "transfer-ex", type: "transfer", sourceId: "main", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 3 }, { itemId: "seal", quantity: 5 }] });
  s = post(s, "release", { orderId: "transfer-ex" });
  s = post(s, "dispatch", { orderId: "transfer-ex", lines: [
    { itemId: "meter", quantity: 3, serials: ["00001", "00002", "00003"] }, { itemId: "seal", quantity: 2 },
  ] });
  assert.throws(() => post(s, "closeOrder", { orderId: "transfer-ex", reason: "Do not erase transit" }), /still in transit/);
  assert.throws(() => post(s, "accept", { orderId: "transfer-ex", lines: [], damaged: [damage("meter", 1, [], 1)] }), /Unidentified/);
  assert.throws(() => post(s, "accept", { orderId: "transfer-ex", lines: [], damaged: [damage("meter", 1, [], 1, ["OTHER"])] }), /Unexpected/);
  s = post(s, "accept", { orderId: "transfer-ex",
    lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }, { itemId: "seal", quantity: 2 }],
    damaged: [damage("meter", 1, [], 1, ["00002"])] });
  assert.equal(s.stock.find(b => b.warehouseId === "van" && b.itemId === "meter")!.quantity, 1);
  let order = s.orders.find(o => o.id === "transfer-ex")!;
  assert.equal(orderLineProgress(s, order, "meter").inTransit, 1);
  assert.throws(() => post(s, "resolveTransit", { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["00002"] }],
    reason: "Already physically held" }), /previously received/);
  const lostData = { orderId: order.id, lines: [{ itemId: "meter", quantity: 1, serials: ["00003"] }],
    reason: "Carrier confirmed missing carton; supervisor reviewed evidence" }, lostId = randomUUID();
  const stock = structuredClone(s.stock);
  s = post(s, "resolveTransit", lostData, lostId);
  assert.deepEqual(s.stock, stock, "a transit loss is not an arrival and never restocks the source");
  assert.deepEqual(post(s, "resolveTransit", lostData, lostId), s);
  assert.throws(() => post(s, "resolveTransit", lostData), /remaining|previously/);
  assert.throws(() => post(s, "cancel", { orderId: order.id }), /Close with exceptions/);
  s = post(s, "closeOrder", { orderId: order.id, reason: "Close carrier loss and unshipped seals; create replacement" });
  order = s.orders.find(o => o.id === order.id)!;
  assert.deepEqual(order.closure!.unfulfilled.map(l => l.quantity), [1, 3]);
  assert.equal(orderLineProgress(s, order, "meter").inTransit, 0);
  const hold = s.shipmentHolds![0];
  assert.throws(() => post(s, "resolveHold", { id: hold.id, outcome: "released", reason: "Wrong identity",
    verifiedSerials: ["WRONG"] }), /must match/);
  s = post(s, "resolveHold", { id: hold.id, outcome: "released", reason: "Confirmed damaged label identity, unit tested",
    verifiedSerials: ["00002"] });
  assert.deepEqual(s.stock.find(b => b.warehouseId === "van" && b.itemId === "meter")!.serials, ["00001", "00002"]);
  validateInventoryBackup({ state: JSON.parse(JSON.stringify(s)), enabled: true, movements: [] }, []);
  s = post(s, "order", { id: "replacement", type: "transfer", replacementFor: order.id,
    sourceId: "main", destinationId: "van", lines: [{ itemId: "meter", quantity: 1 }] });
  assert.equal(s.orders.at(-1)!.replacementFor, order.id);
  assert.throws(() => post(s, "order", { id: "self", type: "purchase", replacementFor: "self",
    destinationId: "main", vendorId: "vendor", lines: [{ itemId: "seal", quantity: 1 }] }), /original order/);
  assert.equal(commandPermission("closeOrder"), inventoryPermissions.closeOrders);
  assert.equal(commandPermission("resolveTransit"), inventoryPermissions.resolveExceptions);
  assert.equal(commandPermission("resolveHold"), inventoryPermissions.resolveExceptions);
});
