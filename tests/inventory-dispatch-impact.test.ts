import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, type WorkRequirements } from "../shared/inventory";
import { reconcileDispatchRequirements } from "../shared/inventory-dispatch-impact";
import type { FulfillmentBatch } from "../shared/inventory-fulfillment";
function fixture() {
  const state = emptyInventory(1);
  state.items = [{ id: "meter", active: true, kind: "physical" }] as any;
  const batch = { id: "batch", name: "Route 644", status: "active", revision: 1,
    workOrders: [{ workOrderId: 1 }], lines: [{ workOrderId: 1, itemId: "meter", quantity: 1,
      stagedQuantity: 0, deliveredQuantity: 0, stagedSerials: [], deliveredSerials: [] }] } as FulfillmentBatch;
  state.fulfillmentBatches = [batch];
  const prior: WorkRequirements = { workOrderId: 1, lines: [{ itemId: "meter", quantity: 1 }], missing: [] };
  return { state, batch, prior };
}
test("compatible metadata edits leave dispatch untouched", () => {
  const { state, prior } = fixture(), snapshot = JSON.stringify(state);
  assert.deepEqual(reconcileDispatchRequirements(state, prior, prior), {});
  assert.equal(JSON.stringify(state), snapshot);
});
test("changed material quantities update a single never-posted plan without moving stock", () => {
  const { state, prior, batch } = fixture();
  assert.deepEqual(reconcileDispatchRequirements(state, prior, { ...prior, lines: [{ itemId: "meter", quantity: 2 }] }), {});
  assert.equal(batch.lines[0].quantity, 2);
  assert.equal(batch.revision, 2);
  assert.deepEqual(state.stock, []);
  assert.deepEqual(state.receipts, []);
});
test("posted stock and zero-net corrections cannot be silently reduced", () => {
  for (const history of [false, true]) {
    const { state, batch, prior } = fixture();
    if (history) state.receipts = [{ reference: batch.id, action: "fulfillmentCorrect" }] as any;
    else batch.lines[0].stagedQuantity = 1;
    const snapshot = JSON.stringify(state);
    const result = reconcileDispatchRequirements(state, prior, { ...prior, lines: [] });
    assert.match(result.error!, /Stock has already moved/);
    assert.equal(JSON.stringify(state), snapshot);
  }
});
test("supplemental demand after posting preserves the original batch and custody", () => {
  const { state, batch, prior } = fixture();
  batch.lines[0].stagedQuantity = 1;
  const snapshot = JSON.stringify(state);
  assert.deepEqual(reconcileDispatchRequirements(state, prior, { ...prior, lines: [{ itemId: "meter", quantity: 3 }] }), {});
  assert.equal(JSON.stringify(state), snapshot);
  assert.deepEqual(reconcileDispatchRequirements(state, { ...prior, lines: [{ itemId: "meter", quantity: 3 }] },
    { ...prior, lines: [{ itemId: "meter", quantity: 2 }] }), {});
  assert.equal(JSON.stringify(state), snapshot);
});
test("unmapped or empty demand requires explicit batch resolution", () => {
  const { state, prior } = fixture();
  assert.match(reconcileDispatchRequirements(state, prior, { ...prior, lines: [] }).error!, /Resume saved batch/);
  assert.match(reconcileDispatchRequirements(state, prior, { ...prior, missing: [{ equipment: "system", typeId: "missing" }] }).error!, /unmapped/);
});
