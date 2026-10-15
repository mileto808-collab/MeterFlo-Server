import test from "node:test";
import assert from "node:assert/strict";
import { orderSaveAttempt } from "../client/src/lib/inventory-order-save";

test("unchanged order retries retain both identities, including structurally reordered payloads", () => {
  let sequence = 0;
  const createId = () => `generated-${++sequence}`;
  const payload = { type: "purchase", lines: [{ itemId: "meter", quantity: 2, serials: [] }] };
  const first = orderSaveAttempt(null, "project-one", "", payload, createId);
  const retry = orderSaveAttempt(first, "project-one", " ", {
    lines: [{ serials: [], quantity: 2, itemId: "meter" }], type: "purchase",
  }, createId);
  assert.strictEqual(first, retry);
  assert.equal(sequence, 2);
  const edited = orderSaveAttempt(retry, "project-one", "", { ...payload, notes: "Corrected" }, createId);
  assert.equal(edited.id, first.id);
  assert.notEqual(edited.operationId, first.operationId);
  const reverted = orderSaveAttempt(edited, "project-one", "", payload, createId);
  assert.equal(reverted.id, first.id);
  assert.notEqual(reverted.operationId, first.operationId, "do not replay an obsolete payload after a later edit");
  const next = orderSaveAttempt(null, "project-one", "", payload, createId);
  assert.notEqual(next.id, first.id);
  assert.notEqual(next.operationId, first.operationId);
  const otherProject = orderSaveAttempt(first, "project-two", "", payload, createId);
  assert.notEqual(otherProject.id, first.id);
});

test("explicit references remain stable but changing or clearing them starts a new attempt", () => {
  let sequence = 0;
  const createId = () => `generated-${++sequence}`;
  const payload = { type: "transfer", lines: [{ itemId: "meter", quantity: 2, serials: [] }] };
  const first = orderSaveAttempt(null, "project-one", " TR-42 ", payload, createId);
  assert.equal(first.id, "TR-42");
  assert.equal(sequence, 1);
  assert.strictEqual(orderSaveAttempt(first, "project-one", "TR-42", payload, createId), first);
  const changed = orderSaveAttempt(first, "project-one", "TR-43", payload, createId);
  assert.equal(changed.id, "TR-43");
  assert.notEqual(changed.operationId, first.operationId);
  const cleared = orderSaveAttempt(first, "project-one", "", payload, createId);
  assert.notEqual(cleared.id, first.id);
});
