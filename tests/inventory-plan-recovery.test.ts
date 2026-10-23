import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { resolvePlanOutcome } from "../shared/inventory-plan-recovery";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { inventoryVisibleState } from "../server/inventoryRoutes";
import { pool } from "../server/db";

test.after(async () => pool.end());
const actor = "recovery-fixture";
function setup() {
  return applyInventoryCommand(emptyInventory(), { operationId: randomUUID(), action: "item",
    data: { id: "part", sku: "PART", name: "Recovery part", tracking: "regular" } }, actor, true).state;
}
function command(revision = 0): InventoryCommand {
  return { operationId: randomUUID(), action: "plan", data: { workOrderId: 1, revision,
    lines: [{ id: randomUUID(), itemId: "part", quantity: 2, kind: "addition", reason: "Extra fittings" }] } };
}
test("accepted evidence keeps the original revision after later edit/removal without replay effects", () => {
  const original = setup(), c = command();
  const saved = applyInventoryCommand(original, c, actor, true).state;
  const edited = applyInventoryCommand(saved, { ...command(1), data: { workOrderId: 1, revision: 1, lines: [] } }, actor, true).state;
  const result = resolvePlanOutcome(edited, c, actor, "resolve");
  assert.equal(result.state, edited);
  assert.equal(result.result.status, "accepted");
  assert.equal(result.result.acceptedRevision, 1);
  assert.deepEqual(edited.workPlans![0].lines, []);
  assert.deepEqual(edited.stock, original.stock);
  assert.equal(applyInventoryCommand(edited, c, actor, true).replay, true);
  assert.equal(edited.planOperationOutcomes!.length, 2);
});
test("lookup absence is unresolved; explicit resolution fences delayed original posts without changing the plan", () => {
  const state = setup(), c = command();
  assert.equal(resolvePlanOutcome(state, c, actor, "lookup").result.status, "unresolved");
  const resolved = resolvePlanOutcome(state, c, actor, "resolve");
  assert.equal(resolved.result.status, "rejected");
  assert.equal(resolved.state.operations[c.operationId], undefined);
  assert.deepEqual(resolved.state.workPlans, state.workPlans);
  assert.throws(() => applyInventoryCommand(resolved.state, c, actor, true), /conclusively fenced/);
  assert.equal(resolvePlanOutcome(resolved.state, c, actor, "resolve").state, resolved.state);
  assert.equal(applyInventoryCommand(resolved.state, { ...c, operationId: randomUUID() }, actor, true).state.workPlans![0].revision, 1);
});
test("actor/payload/work-order mismatches neither disclose evidence nor replace fences", () => {
  const c = command(), saved = applyInventoryCommand(setup(), c, actor, true).state;
  for (const [candidate, owner] of [
    [c, "other-account"],
    [{ ...c, data: { ...c.data, revision: 20 } }, actor],
    [{ ...c, data: { ...c.data, workOrderId: 2 } }, actor],
  ] as const) {
    const result = resolvePlanOutcome(saved, candidate, owner, "resolve");
    assert.equal(result.result.status, "unresolved");
    assert.equal(result.state, saved);
  }
});
test("old committed operations confirm acceptance without inventing an accepted revision", () => {
  const c = command(), state = applyInventoryCommand(setup(), c, actor, true).state;
  delete state.planOperationOutcomes;
  const result = resolvePlanOutcome(state, c, actor, "lookup");
  assert.equal(result.result.status, "accepted");
  assert.equal(result.result.acceptedRevision, null);
  assert.equal(result.result.occurredAt, null);
});
test("accepted and fenced outcomes survive relational round trips and stay out of broad inventory projections", () => {
  const c = command(), state = applyInventoryCommand(setup(), c, actor, true).state;
  const fenced = resolvePlanOutcome(state, command(1), actor, "resolve").state;
  const tables = inventoryToRelational(fenced, 7);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), fenced.revision, Object.keys(fenced));
  assert.deepEqual(restored.planOperationOutcomes, fenced.planOperationOutcomes);
  assert.deepEqual(inventoryVisibleState(restored, actor, true).planOperationOutcomes, []);
  assert.equal(resolvePlanOutcome(restored, c, actor, "lookup").result.status, "accepted");
});
