import test from "node:test";
import assert from "node:assert/strict";
import { createReplacementSchema, replacementVisitDto, replacementRecoverySchema, deleteUnusedReplacementSchema } from "../shared/defective-replacement";
import { validateReplacementBackup } from "../server/replacementBackup";

const recovery = { rootWorkOrderId: 1, parentWorkOrderId: 1, equipment: "system",
  reason: "System failed commissioning", vehicleId: null,
  operationId: "11111111-1111-4111-8111-111111111111", actorId: "synthetic-technician",
  predecessorFingerprint: "a".repeat(64), active: true, cancelledAt: null };
test("replacement input is strict and requires meaningful reason and captured predecessor", () => {
  const input = { ...recovery, predecessorFingerprint: recovery.predecessorFingerprint };
  const valid = { operationId: input.operationId, predecessorFingerprint: input.predecessorFingerprint,
    equipment: input.equipment, reason: input.reason, vehicleId: input.vehicleId };
  assert.ok(createReplacementSchema.safeParse(valid).success);
  assert.equal(createReplacementSchema.safeParse({ ...valid, reason: "bad" }).success, false);
  assert.equal(createReplacementSchema.safeParse({ ...valid, rootWorkOrderId: 99 }).success, false);
  assert.equal(createReplacementSchema.safeParse({ ...valid, equipment: "reading_only" }).success, false);
});
test("replacement DTO preserves source and active false without inventing legacy relationships", () => {
  assert.equal(replacementVisitDto({ id: 1 }), null);
  assert.deepEqual(replacementVisitDto({ replacement_root_id: 1, replacement_parent_id: 2, replacement_equipment: "module",
    replacement_reason: "Module stopped transmitting", replacement_vehicle_id: null,
    replacement_operation_id: recovery.operationId, replacement_active: false }),
  { rootWorkOrderId: 1, parentWorkOrderId: 2, equipment: "module", reason: "Module stopped transmitting",
    vehicleId: null, operationId: recovery.operationId, active: false, cancelledAt: null });
});
test("backup rejects missing/circular predecessors and competing active replacements", () => {
  const root = { id: 1, status: "Completed" }, child = { id: 2, status: "Open", replacementRecovery: recovery };
  assert.doesNotThrow(() => validateReplacementBackup([root, child]));
  assert.throws(() => validateReplacementBackup([child]), /predecessor/);
  assert.throws(() => validateReplacementBackup([root, { ...child, replacementRecovery: { ...recovery, parentWorkOrderId: 2 } }]), /predecessor/);
  assert.throws(() => validateReplacementBackup([root, child, { id: 3, status: "Open",
    replacementRecovery: { ...recovery, operationId: "22222222-2222-4222-8222-222222222222" } }]), /competing/);
  assert.throws(() => validateReplacementBackup([root, { ...child, status: "Completed" }]), /cannot also be active/);
});
test("recovery requires a reason and deletion requires explicit no-physical-work confirmation", () => {
  assert.equal(replacementRecoverySchema.safeParse({ reason: "Accidental cancellation" }).success, true);
  assert.equal(replacementRecoverySchema.safeParse({ reason: "oops" }).success, false);
  assert.equal(deleteUnusedReplacementSchema.safeParse({ reason: "Wrong customer work order" }).success, false);
  assert.equal(deleteUnusedReplacementSchema.safeParse({ reason: "Wrong customer work order", noPhysicalReplacement: true }).success, true);
  assert.equal(deleteUnusedReplacementSchema.safeParse({ reason: "Wrong customer work order", noPhysicalReplacement: false }).success, false);
  const root = { id: 1, status: "Completed" };
  assert.doesNotThrow(() => validateReplacementBackup([root, { id: 2, status: "Open", replacementRecovery: {
    ...recovery, active: false, cancelledAt: "2026-10-23T00:00:00.000Z", deletedAt: "2026-10-23T00:01:00.000Z", deletedBy: "synthetic-technician",
  } }]));
  assert.throws(() => validateReplacementBackup([root, { id: 2, status: "Open", replacementRecovery: {
    ...recovery, deletedAt: "2026-10-23T00:01:00.000Z",
  } }]), /deleted replacement/);
});
