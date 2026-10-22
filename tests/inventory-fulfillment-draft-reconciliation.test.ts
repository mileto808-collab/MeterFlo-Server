import assert from "node:assert/strict";
import { test } from "node:test";
import { hasMeaningfulFulfillmentWork, reconcileFulfillmentDraft, type FulfillmentDraftActivity, type SavedFulfillmentInputs } from "../client/src/lib/fulfillment-draft-reconciliation";
const draft: SavedFulfillmentInputs = {
  batchId: "batch", selectedIds: [1], pending: null, createAttempt: null,
  quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "",
};
const emptyActivity: FulfillmentDraftActivity = {
  batchId: "", selectedIds: [], pending: null, createAttempt: null,
  quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "",
  name: "", sourceId: "", stagingId: "", vehicleId: "",
};
test("opening, changing mode, navigating and searching without work do not create a resumable draft", () => {
  assert.equal(hasMeaningfulFulfillmentWork(emptyActivity), false);
  // Mode, step, search and filters are viewing state; they do not supply an order, capture or posting identity.
  assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, mode: "scheduled", step: "vehicle",
    search: "route 644", route: "644", installer: "installer", date: "2026-10-21" }), false);
  assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, quantities: { "stage:meter": "0" } }), false);
  assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, reassignmentBatchId: "batch" }), false);
  assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, reassignmentReason: "Installer changed" }), true);
  assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, reassignmentVehicleId: "new-vehicle" }), true);
});
test("actual selections, entered details and protected operation attempts remain resumable", () => {
  for (const changes of [
    { selectedIds: [195] }, { name: "Crew route" }, { sourceId: "warehouse" }, { stagingId: "stage" },
    { vehicleId: "vehicle" }, { batchId: "existing" }, { pending: { operationId: "retry" } },
    { createAttempt: { operationId: "create" } }, { quantities: { "stage:meter": "2" } },
    { serialText: { "stage:meter": "00001" } }, { reason: "Physical movement" },
    { physicallyConfirmed: true }, { closeReason: "Release remainder" },
  ]) assert.equal(hasMeaningfulFulfillmentWork({ ...emptyActivity, ...changes }), true);
});
const completed = [{ id: "batch", status: "completed", workOrders: [{ workOrderId: 1 }] }];
test("completed and cancelled batches stop being resumable when no unrecorded inputs remain", () => {
  assert.deepEqual(reconcileFulfillmentDraft(draft, completed, []), { kind: "clear", status: "completed" });
  assert.deepEqual(reconcileFulfillmentDraft(draft, [{ ...completed[0], status: "cancelled" }], []), { kind: "clear", status: "cancelled" });
});
test("active or unavailable batches do not authorize deleting a local draft", () => {
  assert.deepEqual(reconcileFulfillmentDraft(draft, [{ ...completed[0], status: "active" }], []), { kind: "keep" });
  assert.deepEqual(reconcileFulfillmentDraft(draft, [], []), { kind: "keep" });
});
test("completed batches never discard an unresolved movement or creation identity", () => {
  for (const key of ["pending", "createAttempt"] as const)
    assert.deepEqual(reconcileFulfillmentDraft({ ...draft, [key]: { operationId: "unknown" } }, completed, []), { kind: "keep" });
});
test("unposted captures are retained for review rather than offered as an unfinished batch", () => {
  for (const captures of [
    { quantities: { "vehicle:item": "2" } }, { serialText: { "vehicle:item": "000123" } },
    { reason: "Physically moved stock" }, { physicallyConfirmed: true }, { closeReason: "Release remainder" },
  ]) assert.deepEqual(reconcileFulfillmentDraft({ ...draft, ...captures }, completed, []), { kind: "review", status: "completed" });
  assert.deepEqual(reconcileFulfillmentDraft({ ...draft, batchId: "", reassignmentBatchId: "batch",
    reassignmentReason: "Installer changed", reassignmentVehicleId: "new-vehicle" }, completed, []),
  { kind: "review", status: "completed" });
});
test("pre-batch selections completed elsewhere are reconciled only when current demand is covered", () => {
  assert.deepEqual(reconcileFulfillmentDraft({ ...draft, batchId: "" }, completed, [
    { workOrderId: 1, missing: [], lines: [] },
  ]), { kind: "clear", status: "completed" });
  for (const order of [
    { workOrderId: 1, missing: ["mapping"], lines: [] },
    { workOrderId: 1, missing: [], lines: [{ quantity: 1 }] },
  ]) assert.deepEqual(reconcileFulfillmentDraft({ ...draft, batchId: "" }, completed, [order]), { kind: "keep" });
  assert.deepEqual(reconcileFulfillmentDraft({ ...draft, batchId: "", selectedIds: [1, 2] }, completed, []), { kind: "keep" });
});
