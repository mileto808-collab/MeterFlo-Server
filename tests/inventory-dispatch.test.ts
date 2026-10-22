import test from "node:test";
import assert from "node:assert/strict";
import { dispatchFromEvidence, type DispatchEvidence } from "../shared/inventory-dispatch";

const ready: DispatchEvidence = {
  batchId: "batch", batchName: "Route 644", receiptNumber: "PICK-2026-000001",
  vehicleId: "van", vehicleName: "Vehicle 1", member: true, mode: "crew", status: "active",
  assignmentVersion: 1, currentVersion: 1, installerId: null, currentInstallerId: null,
  staged: 3, delivered: 0, required: 3, ready: true, issue: false, activeVehicle: true,
  currentStatus: "open",
};
test("unpicked plans and staged work not released as ready do not dispatch", () => {
  assert.equal(dispatchFromEvidence({ ...ready, staged: 0 }), null);
  assert.equal(dispatchFromEvidence({ ...ready, ready: false }), null);
});
test("ready staging is visible for verification but not field execution", () => {
  const value = dispatchFromEvidence(ready)!;
  assert.equal(value.stage, "awaiting_pickup");
  assert.equal(value.canStart, false);
  assert.match(value.reason!, /handoff/);
  assert.equal(value.receiptNumber, ready.receiptNumber);
});
test("handoff enables the order only after all of its demand is delivered", () => {
  assert.equal(dispatchFromEvidence({ ...ready, delivered: 2 })!.canStart, false);
  assert.equal(dispatchFromEvidence({ ...ready, delivered: 3 })!.stage, "ready_for_field");
});
test("helpers gain access through vehicle membership, never group membership alone", () => {
  assert.equal(dispatchFromEvidence({ ...ready, member: false }), null);
  assert.equal(dispatchFromEvidence({ ...ready, activeVehicle: false }), null);
  assert.equal(dispatchFromEvidence({ ...ready, status: "cancelled" }), null);
  assert.equal(dispatchFromEvidence({ ...ready, member: true })!.vehicleId, "van");
});
test("pickup issues and changed scheduled installers require review", () => {
  assert.equal(dispatchFromEvidence({ ...ready, issue: true })!.stage, "needs_review");
  assert.equal(dispatchFromEvidence({ ...ready, mode: "scheduled", currentVersion: 2 })!.stage, "needs_review");
  assert.equal(dispatchFromEvidence({ ...ready, mode: "scheduled", installerId: "old", currentInstallerId: "new" })!.canStart, false);
});
test("claiming already handed-off shared work preserves dispatch; changed staging does not", () => {
  const claimed = { ...ready, currentVersion: 2, currentInstallerId: "helper", currentInstallerMember: true };
  assert.equal(dispatchFromEvidence({ ...claimed, delivered: 3 })!.canStart, true);
  assert.equal(dispatchFromEvidence(claimed)!.stage, "needs_review");
  assert.equal(dispatchFromEvidence({ ...claimed, delivered: 3, currentInstallerMember: false })!.canStart, false);
});
test("cancelled work or a crew order becoming individually scheduled needs resolution", () => {
  assert.equal(dispatchFromEvidence({ ...ready, currentStatus: "cancelled" })!.canStart, false);
  assert.equal(dispatchFromEvidence({ ...ready, currentStatus: "scheduled" })!.stage, "needs_review");
});
test("completed custody batches can still authorize outstanding handed-off work", () => {
  assert.equal(dispatchFromEvidence({ ...ready, status: "completed", delivered: 3 })!.canStart, true);
});
