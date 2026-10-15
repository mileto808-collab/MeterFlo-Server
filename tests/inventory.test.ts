import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, commandPermission, inventoryPermissions, inventoryCommandSchema, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder, reserved } from "../shared/inventory-engine";

const actor = "admin";
function post(s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) {
  return applyInventoryCommand(s, { action, data, operationId }, actor, true).state;
}
function setup() {
  let s = emptyInventory();
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
  assert.equal(commandPermission("unrelease"), inventoryPermissions.purchase);
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
  for (const action of ["unrelease", "archiveOrder", "restoreOrder"] as const) {
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
  assert.throws(() => post(s, "prepareUse", { workOrderId: 2, revision: 1, mode: "reading_only", used: [{ warehouseId: "main", itemId: "seal", quantity: 1 }], dispositions: [] }), /Reading-only/);
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
