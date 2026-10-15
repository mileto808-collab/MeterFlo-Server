import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { blankShipmentCapture, type ShipmentCapture } from "../shared/inventory-shipment-draft-model";
import { validateInventoryBackup } from "../server/inventoryBackup";

function post(s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>,
  operationId = randomUUID(), actor = "owner", admin = false) {
  return applyInventoryCommand(s, { action, data, operationId }, actor, admin);
}
function fixture() {
  let s = emptyInventory();
  for (const id of ["main", "van"]) s = post(s, "warehouse", {
    id, code: id, name: id, type: "physical", address: "Fixture", userIds: ["owner", "other"],
  }, randomUUID(), "owner", true).state;
  s = post(s, "vendor", { id: "v", name: "Vendor" }, randomUUID(), "owner", true).state;
  s = post(s, "item", { id: "meter", sku: "meter", name: "Meter", tracking: "serialized" }, randomUUID(), "owner", true).state;
  s = post(s, "order", { id: "po", type: "purchase", destinationId: "main", vendorId: "v",
    lines: [{ itemId: "meter", quantity: 3 }] }).state;
  return post(s, "release", { orderId: "po" }).state;
}
function capture(): ShipmentCapture {
  return { ...blankShipmentCapture(), entries: { meter: { itemId: "meter", goodQuantity: "2", damagedQuantity: "0",
    unreadableQuantity: "0", damageReason: "", goodSerials: ["00001", "00002"], damagedSerials: [], expectedSerials: [] } } };
}
const payload = () => ({ orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: ["00001", "00002"] }], damaged: [], reason: "" });
function save(s: InventoryState, id = randomUUID(), content = capture()) {
  return { id, state: post(s, "shipmentDraftSave", { id, revision: 0, orderId: "po", stage: "receive", capture: content }).state };
}
function prepared() {
  const saved = save(fixture()), postingId = randomUUID();
  const state = post(saved.state, "shipmentDraftPrepare", { id: saved.id, revision: 1, postingId, payload: payload() }).state;
  return { state, id: saved.id, postingId, data: { ...payload(), draftId: saved.id, draftRevision: 2 } };
}

test("saving incomplete scans preserves exact text without stock, reservation, receipt or order changes", () => {
  const original = fixture(), content = capture();
  content.entries.meter.goodSerials = ["00001"];
  content.entries.meter.goodQuantity = "";
  content.scanBuffers["meter-goodSerials"] = "0000 unfinished ";
  const { state } = save(original, randomUUID(), content);
  for (const field of ["stock", "allocations", "orders", "receipts"] as const) assert.deepEqual(state[field], original[field]);
  assert.deepEqual(state.shipmentDrafts![0].capture, content);
  assert.equal(state.shipmentDrafts![0].ownerId, "owner");
  assert.ok(!Object.values(state.operations).at(-1)!.includes("0000 unfinished"), "journal does not accumulate copies of scan lists");
  validateInventoryBackup({ state, movements: [], enabled: true }, []);
});

test("draft CAS and body-aware replay prevent conflicting saves and operation identity reuse", () => {
  const s = fixture(), id = randomUUID(), commandId = randomUUID();
  const data = { id, revision: 0, stage: "receive", orderId: "po", capture: capture() };
  const first = post(s, "shipmentDraftSave", data, commandId);
  assert.equal(post(first.state, "shipmentDraftSave", data, commandId).replay, true);
  assert.throws(() => post(first.state, "shipmentDraftSave", { ...data, capture: blankShipmentCapture() }, commandId), /different draft contents/);
  const updated = post(first.state, "shipmentDraftSave", { ...data, revision: 1 }).state;
  assert.throws(() => post(updated, "shipmentDraftSave", { ...data, revision: 1 }), /changed/);
  assert.throws(() => post(updated, "shipmentDraftSave", data, commandId), /changed/);
  assert.throws(() => post(updated, "shipmentDraftSave", { ...data, revision: 2 }, randomUUID(), "other"), /owner/);
  assert.throws(() => save(updated), /already exists/);
});

test("raw scanner text cannot prepare a posting; existing stock constraints still reject stale draft payloads", () => {
  const content = capture(); content.scanBuffers["meter-goodSerials"] = "00003";
  const saved = save(fixture(), randomUUID(), content);
  assert.throws(() => post(saved.state, "shipmentDraftPrepare", {
    id: saved.id, revision: 1, postingId: randomUUID(), payload: payload(),
  }), /unfinished scanner text/);
  const p = prepared();
  const occupied = post(p.state, "receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 1, serials: ["00001"] }] }).state;
  assert.throws(() => post(occupied, "receive", p.data, p.postingId), /Serial|serial/);
  assert.equal(occupied.receipts.length, 1);
  assert.deepEqual(occupied.shipmentDrafts![0].capture, capture());
});

test("prepared identity survives serialization and lost response; confirmation alone clears the saved batch", () => {
  const p = prepared(), restored = JSON.parse(JSON.stringify(p.state)) as InventoryState;
  validateInventoryBackup({ state: restored, movements: [], enabled: true }, []);
  const posted = post(restored, "receive", p.data, p.postingId).state;
  assert.equal(posted.stock[0].quantity, 2);
  assert.equal(posted.shipmentDrafts!.length, 1);
  assert.equal(post(posted, "receive", p.data, p.postingId).replay, true);
  assert.equal(posted.receipts.filter(r => r.id === p.postingId).length, 1);
  assert.throws(() => post(posted, "shipmentDraftDelete", { id: p.id, revision: 2 }), /unconfirmed posting/);
  assert.throws(() => post(posted, "shipmentDraftUnlock", { id: p.id, revision: 2 }), /already posted/);
  const confirmed = post(posted, "shipmentDraftDelete", { id: p.id, revision: 2, confirmedOperationId: p.postingId }).state;
  assert.equal(confirmed.shipmentDrafts!.length, 0);
  assert.equal(post(confirmed, "receive", p.data, p.postingId).replay, true);
});

test("atomic unlock blocks a late old POST and preserves all capture for a new validated attempt", () => {
  const p = prepared();
  assert.throws(() => post(p.state, "receive", { ...p.data, reason: "changed" }, p.postingId), /unchanged/);
  const unlocked = post(p.state, "shipmentDraftUnlock", { id: p.id, revision: 2 }).state;
  assert.deepEqual(unlocked.shipmentDrafts![0].capture, capture());
  assert.throws(() => post(unlocked, "receive", p.data, p.postingId), /changed|unchanged/);
  assert.equal(unlocked.receipts.length, 0);
  const nextId = randomUUID();
  const next = post(unlocked, "shipmentDraftPrepare", { id: p.id, revision: 3, postingId: nextId, payload: payload() }).state;
  assert.equal(post(next, "receive", { ...payload(), draftId: p.id, draftRevision: 4 }, nextId).state.receipts.length, 1);
});

test("admin adoption recovers restored orphan ownership safely, without impersonating a prior pending attempt", () => {
  const p = prepared();
  assert.throws(() => post(p.state, "shipmentDraftClaim", { id: p.id, revision: 2 }, randomUUID(), "other"), /owner|Administrator/);
  const adopted = post(p.state, "shipmentDraftClaim", { id: p.id, revision: 2 }, randomUUID(), "other", true).state;
  assert.equal(adopted.shipmentDrafts![0].ownerId, "other");
  assert.equal(adopted.shipmentDrafts![0].pending, null);
  assert.deepEqual(adopted.stock, p.state.stock);
  assert.throws(() => post(adopted, "receive", p.data, p.postingId), /owner/);
  const posted = post(p.state, "receive", p.data, p.postingId).state;
  const adoptedPosted = post(posted, "shipmentDraftClaim", { id: p.id, revision: 2 }, randomUUID(), "other", true).state;
  assert.equal(adoptedPosted.shipmentDrafts![0].pending!.operationId, p.postingId);
  const done = post(adoptedPosted, "shipmentDraftDelete", { id: p.id, revision: 3, confirmedOperationId: p.postingId }, randomUUID(), "other", true).state;
  assert.equal(done.shipmentDrafts!.length, 0);
  assert.equal(done.receipts.length, 1);
});

test("draft backup validation rejects duplicate identities and wrong receipt linkage without changing old-backup compatibility", () => {
  validateInventoryBackup({ state: fixture(), movements: [], enabled: true }, []);
  const p = prepared(), duplicate = structuredClone(p.state);
  duplicate.shipmentDrafts!.push(structuredClone(duplicate.shipmentDrafts![0]));
  assert.throws(() => validateInventoryBackup({ state: duplicate, movements: [], enabled: true }, []), /duplicate/);
  const wrong = post(p.state, "receive", p.data, p.postingId).state;
  wrong.receipts[0].reference = "different-order";
  assert.throws(() => validateInventoryBackup({ state: wrong, movements: [], enabled: true }, []), /unrelated receipt/);
});

test("malformed buffers, reserved payload headers, size limits and warehouse deactivation fail without truncating saved capture", () => {
  const s = save(fixture());
  const before = JSON.stringify(s.state);
  assert.throws(() => post(s.state, "shipmentDraftSave", { id: s.id, revision: 1, orderId: "po", stage: "receive",
    capture: { ...capture(), scanBuffers: { unknown: "partial" } } }), /scanner buffer/);
  assert.throws(() => post(s.state, "shipmentDraftPrepare", { id: s.id, revision: 1, postingId: randomUUID(),
    payload: { ...payload(), draftId: s.id } }), /transport headers/);
  assert.throws(() => post(s.state, "shipmentDraftSave", { id: s.id, revision: 1, orderId: "po", stage: "receive",
    capture: { ...capture(), reason: "x".repeat(8 * 1024 * 1024) } }), /8 MiB/);
  assert.throws(() => post(s.state, "warehouse", { ...s.state.warehouses[0], active: false }, randomUUID(), "owner", true), /saved shipment drafts/);
  assert.equal(JSON.stringify(s.state), before);
  const full = structuredClone(s.state);
  full.shipmentDrafts = Array.from({ length: 100 }, (_, i) => ({
    ...structuredClone(s.state.shipmentDrafts![0]), id: randomUUID(), orderId: `existing-${i}`,
  }));
  assert.throws(() => post(full, "shipmentDraftSave", { id: randomUUID(), revision: 0, orderId: "po",
    stage: "receive", capture: capture() }), /100 unfinished/);
  const oversized = structuredClone(s.state);
  const largeDraft = structuredClone(s.state.shipmentDrafts![0]);
  largeDraft.capture.entries.meter.goodSerials = Array(10000).fill("x".repeat(100));
  oversized.shipmentDrafts = Array.from({ length: 34 }, () => ({ ...largeDraft, id: randomUUID() }));
  assert.throws(() => validateInventoryBackup({ state: oversized, movements: [], enabled: true }, []), /32 MiB/);
});
