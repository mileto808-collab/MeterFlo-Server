import { z } from "zod";
import type { InventoryState, InventoryCommand } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { shipmentCaptureSchema, shipmentStageSchema, savedShipmentDraftSchema } from "./inventory-shipment-draft-model";

const assert: (value: unknown, message: string) => asserts value = (value, message) => {
  if (!value) throw new InventoryError(message);
};
const uuid = z.string().uuid();
const revision = z.number().int().nonnegative();
const key = z.object({ id: uuid, revision });
export const isShipmentDraftAction = (action: string) => action.startsWith("shipmentDraft");
// Do not append another complete scan list to the permanent operation journal
// on every Save. Replay checks compare the omitted body to its live CAS record.
export function draftFingerprintCommand(command: InventoryCommand) {
  const { capture, payload, ...header } = command.data;
  return command.action === "shipmentDraftSave" || command.action === "shipmentDraftPrepare" ? header : command.data;
}
export function validateDraftReplay(s: InventoryState, command: InventoryCommand, actor: string, canonical: (v: unknown) => string) {
  if (!["shipmentDraftSave", "shipmentDraftPrepare"].includes(command.action)) return;
  const draft = s.shipmentDrafts?.find(d => d.id === command.data.id);
  assert(draft && draft.ownerId === actor && draft.revision === Number(command.data.revision) + 1,
    "Saved draft has changed since this request. Reload the saved draft; nothing was overwritten.");
  assert(command.action === "shipmentDraftSave" ?
    canonical(draft.capture) === canonical(command.data.capture) :
    draft.pending?.operationId === command.data.postingId && canonical(draft.pending?.payload) === canonical(command.data.payload),
  "Posting identifier was already used for different draft contents.");
}
export function draftWarehouse(s: InventoryState, orderId: string, stage: string) {
  const order = s.orders.find(o => o.id === orderId);
  assert(order, "Saved draft order no longer exists. Restore the order or discard this draft.");
  assert(stage === "receive" ? order.type === "purchase" : order.type === "transfer", "Wrong shipment stage for this order.");
  return stage === "dispatch" ? order.sourceId! : order.destinationId;
}
export function applyShipmentDraftCommand(s: InventoryState, command: InventoryCommand, actor: string, now: string, access: (id: string) => unknown, admin: boolean) {
  assert(new TextEncoder().encode(JSON.stringify(command.data)).length <= 8 * 1024 * 1024, "Shipment draft exceeds 8 MiB.");
  s.shipmentDrafts ??= [];
  const { id, revision: expectedRevision } = key.parse(command.data);
  const old = s.shipmentDrafts.find(d => d.id === id);
  if (old) {
    assert(old.ownerId === actor || command.action === "shipmentDraftClaim" && admin, "Only the saved draft owner may change or post it.");
    access(draftWarehouse(s, old.orderId, old.stage));
  }
  assert((old?.revision ?? 0) === expectedRevision, "Saved shipment draft changed. Reload it before continuing; your local entries have not been removed.");
  if (command.action === "shipmentDraftSave") {
    const data = key.extend({ orderId: z.string().min(1).max(100), stage: shipmentStageSchema, capture: shipmentCaptureSchema }).strict().parse(command.data);
    access(draftWarehouse(s, data.orderId, data.stage));
    assert(!old || old.orderId === data.orderId && old.stage === data.stage, "A saved draft cannot change order or stage.");
    assert(!old?.pending, "Check the unconfirmed posting before editing this draft.");
    assert(!s.shipmentDrafts.some(d => d.id !== id && d.orderId === data.orderId && d.stage === data.stage),
      "A saved draft already exists for this order and stage. Its owner must finish or discard it first.");
    assert(old || s.shipmentDrafts.length < 100, "This project already has 100 unfinished shipment drafts. Finish or discard existing drafts first.");
    const saved = savedShipmentDraftSchema.parse({ id, orderId: data.orderId, stage: data.stage, capture: data.capture,
      ownerId: actor, savedAt: now, revision: expectedRevision + 1, pending: null });
    if (old) Object.assign(old, saved); else s.shipmentDrafts.push(saved);
    return;
  }
  assert(old, "Saved shipment draft not found.");
  const posted = old.pending && s.receipts.some(r => r.id === old.pending!.operationId);
  if (command.action === "shipmentDraftPrepare") {
    const data = key.extend({ postingId: uuid, payload: z.record(z.unknown()) }).strict().parse(command.data);
    assert(!old.pending, "A posting attempt already exists. Resume it unchanged.");
    assert(!Object.values(old.capture.scanBuffers).some(Boolean), "Commit or clear unfinished scanner text before preparing a posting.");
    assert(data.payload.orderId === old.orderId, "Posting order does not match the saved draft.");
    assert(data.payload.draftId === undefined && data.payload.draftRevision === undefined,
      "Prepared payload cannot contain draft transport headers.");
    assert(!s.operations[data.postingId] && !s.receipts.some(r => r.id === data.postingId), "Posting identity already used.");
    assert(data.postingId !== command.operationId, "Use a separate identity for posting.");
    old.pending = { operationId: data.postingId, payload: data.payload };
  } else if (command.action === "shipmentDraftClaim") {
    key.strict().parse(command.data);
    assert(admin, "Administrator access is required to take ownership.");
    assert(posted || !old.pending || !s.operations[old.pending.operationId], "Posting evidence requires administrator investigation.");
    // Cancel an unposted prepared identity under the aggregate lock. A late old
    // request cannot post after its owner/revision has changed.
    if (!posted) old.pending = null;
    old.ownerId = actor;
  } else if (command.action === "shipmentDraftUnlock") {
    key.strict().parse(command.data);
    assert(!posted && (!old.pending || !s.operations[old.pending.operationId]), "This batch is already posted. Confirm its receipt instead of editing it.");
    old.pending = null;
  } else if (command.action === "shipmentDraftDelete") {
    const data = key.extend({ confirmedOperationId: uuid.optional() }).strict().parse(command.data);
    assert(!old.pending || posted && data.confirmedOperationId === old.pending.operationId,
      "An unconfirmed posting cannot be discarded. Check/retry it or return to editing safely first.");
    s.shipmentDrafts = s.shipmentDrafts.filter(d => d.id !== id);
    return;
  } else throw new InventoryError("Unknown shipment draft command.");
  old.revision++; old.savedAt = now;
}

// Runs under the same aggregate lock as stock posting. Unlock and late POST
// cannot race past one another: whichever obtains the lock first is authoritative.
export function validateDraftPosting(s: InventoryState, command: InventoryCommand, actor: string,
  canonical: (value: unknown) => string) {
  if (command.data.draftId === undefined) return command;
  const saved = s.shipmentDrafts?.find(d => d.id === command.data.draftId);
  assert(saved && saved.ownerId === actor, "Saved shipment draft owner required.");
  assert(saved.stage === command.action && saved.orderId === command.data.orderId &&
    saved.revision === command.data.draftRevision, "Saved shipment draft changed. Reload before posting.");
  const { draftId, draftRevision, ...payload } = command.data;
  assert(saved.pending && saved.pending.operationId === command.operationId &&
    canonical(saved.pending.payload) === canonical(payload), "Retry the prepared posting unchanged, or safely return to editing.");
  return { ...command, data: payload };
}
