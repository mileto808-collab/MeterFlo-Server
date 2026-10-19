import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, itemSchema, warehouseSchema, commandPermission, inventoryPermissions, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { customerReturnRuleId, normalizeRemovalPolicy, removalConfig, removalChoices } from "../shared/inventory-removal-policy";
import { warehouseRemovalDecision, removalActivityDisplay, removalActivityIndex } from "../shared/inventory-removal-display";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";

function fixture(): InventoryState {
  const state = normalizeRemovalPolicy(emptyInventory());
  state.warehouses.push(warehouseSchema.parse({ id: "w", code: "W", name: "Warehouse", type: "physical", address: "Fixture" }));
  state.items.push(itemSchema.parse({ id: "meter", sku: "M", name: "Meter", tracking: "serialized", equipment: "system" }));
  state.returns.push({ id: "return", workOrderId: 1, equipment: "system", serial: "OLD", disposition: "returned", warehouseId: "w", status: "quarantine",
    ruleId: state.removalRules![0].id, ruleRevision: 1, ruleName: state.removalRules![0].name, policyRevision: 1,
    history: [{ operationId: "accepted", actor: "receiver", occurredAt: "2026-10-18T12:00:00.000Z", outcome: "quarantine", reason: "Accepted" }] });
  return state;
}
function command(state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) {
  return applyInventoryCommand(state, { action, data, operationId }, "warehouse-manager", true, "2026-10-19T01:00:00.000Z");
}
const decide = (state: InventoryState, outcome: "customer_return" | "scrapped" | "released") => {
  const rule = removalConfig(state).rules.find(rule => rule.stage === "warehouse" && rule.outcome === outcome)!;
  return command(state, "returnDecide", { id: "return", ruleId: rule.id, ruleRevision: rule.revision, reason: "Inspection decision",
    ...(outcome === "released" ? { itemId: "meter" } : {}) }).state;
};
const correction = (state: InventoryState) => ({
  id: "return", expectedOperationId: state.returns[0].history!.at(-1)!.operationId,
  reason: "Prior disposition selected incorrectly; verified physically present", physicallyPresent: true,
});
const handoff = (state: InventoryState) => ({
  id: "return", expectedOperationId: state.returns[0].history!.at(-1)!.operationId,
  recipient: "Customer depot", reference: "COLLECTION-123", reason: "Collected by authorized customer representative",
});

test("customer return is held outside usable stock until an audited actual handoff, with safe replay", () => {
  const held = decide(fixture(), "customer_return"), operationId = randomUUID();
  assert.equal(held.returns[0].status, "customer_pending");
  assert.equal(held.stock.length, 0);
  assert.equal(warehouseRemovalDecision(held.returns[0])?.ruleId, customerReturnRuleId);
  const payload = handoff(held);
  const result = command(held, "returnCustomerHandoff", payload, operationId);
  assert.equal(result.state.returns[0].status, "customer_returned");
  assert.equal(result.state.returns[0].customerRecipient, "Customer depot");
  assert.equal(result.state.returns[0].customerHandoffBy, "warehouse-manager");
  assert.equal(result.state.stock.length, 0);
  assert.ok(command(result.state, "returnCustomerHandoff", payload, operationId).replay);
  assert.throws(() => command(result.state, "returnCustomerHandoff", handoff(result.state)), /awaiting/i);
  assert.throws(() => command(result.state, "returnCorrectDecision", correction(result.state)), /physically present/i);
  assert.throws(() => command(held, "returnCustomerHandoff", { ...payload, expectedOperationId: "stale" }), /custody changed/i);
  assert.throws(() => command(held, "returnCustomerHandoff", { ...payload, recipient: "" }));
  const activity = removalActivityDisplay(result.state, removalActivityIndex(result.state).get(operationId)!);
  assert.equal(activity.decisionLabel, "", "A handoff is not a second warehouse disposition");
  assert.match(activity.custodyLabel, /Customer depot.*COLLECTION-123/);
});

test("incorrect scrap can be corrected without rewriting history, then explicitly returned to customer", () => {
  const scrapped = decide(fixture(), "scrapped");
  const original = structuredClone(scrapped.returns[0].history);
  assert.throws(() => command(scrapped, "returnCorrectDecision", { ...correction(scrapped), physicallyPresent: false }));
  const op = randomUUID(), payload = correction(scrapped);
  const corrected = command(scrapped, "returnCorrectDecision", payload, op).state;
  assert.equal(corrected.returns[0].status, "quarantine");
  assert.deepEqual(corrected.returns[0].history!.slice(0, -1), original);
  assert.equal(corrected.returns[0].history!.at(-1)!.previousStatus, "scrapped");
  assert.equal(warehouseRemovalDecision(corrected.returns[0]), undefined);
  assert.ok(command(corrected, "returnCorrectDecision", payload, op).replay);
  assert.equal(decide(corrected, "customer_return").returns[0].status, "customer_pending");
  assert.equal(corrected.stock.length, 0);
});

test("correcting a stock release removes that available serial, never fabricates missing, reserved or moved stock", () => {
  const released = decide(fixture(), "released");
  assert.equal(released.stock[0].quantity, 1);
  const corrected = command(released, "returnCorrectDecision", correction(released)).state;
  assert.equal(corrected.stock.find(stock => stock.itemId === "meter")?.quantity ?? 0, 0);
  assert.equal(corrected.returns[0].itemId, undefined);
  const unavailable = structuredClone(released);
  unavailable.stock[0].quantity = 0; unavailable.stock[0].serials = [];
  assert.throws(() => command(unavailable, "returnCorrectDecision", correction(unavailable)), /stock|serial/i);
  const reserved = structuredClone(released);
  reserved.allocations.push({ workOrderId: 2, revision: 1, mode: "changeout", status: "reserved",
    lines: [{ itemId: "meter", warehouseId: "w", quantity: 1, serials: ["OLD"] }], used: [], dispositions: [] });
  assert.throws(() => command(reserved, "returnCorrectDecision", correction(reserved)), /stock|serial|reserved/i);
});

test("project choices are explicit per equipment; renamed rules preserve identity and used behavior is fixed", () => {
  let state = fixture();
  const field = { ...state.removalRules![0], id: randomUUID(), name: "Contract allows onsite", outcome: "left_onsite" as const };
  state = command(state, "removalRule", field).state;
  state = command(state, "removalPolicy", { ...removalConfig(state).policy, requireSystemReturn: false }).state;
  assert.ok(!removalChoices(state, "system", "field").some(rule => rule.id === field.id));
  state = command(state, "removalFieldChoices", { equipment: "system", ruleIds: [field.id], revision: removalConfig(state).policy.revision }).state;
  assert.deepEqual(removalChoices(state, "system", "field").map(rule => rule.id), [field.id]);
  assert.ok(!removalChoices(state, "module", "field").some(rule => rule.id === field.id));
  state = command(state, "removalRule", { ...field, name: "Renamed contract rule" }).state;
  assert.equal(removalChoices(state, "system", "field")[0].name, "Renamed contract rule");
  assert.throws(() => command(state, "removalRule", { ...removalChoices(state, "system", "field")[0], outcome: "scrapped" }), /behavior cannot change/i);
  assert.throws(() => command(state, "removalFieldChoices", { equipment: "module", ruleIds: [field.id], revision: removalConfig(state).policy.revision }), /allowed/i);
  assert.throws(() => command(state, "removalFieldChoices", { equipment: "system", ruleIds: [customerReturnRuleId], revision: removalConfig(state).policy.revision }), /allowed/i);
  state = command(state, "removalPolicy", { ...removalConfig(state).policy, requireSystemReturn: true }).state;
  assert.equal(removalChoices(state, "system", "field").length, 0, "Mandatory return does not infer an unapproved fallback");
  assert.equal(commandPermission("returnCustomerHandoff"), inventoryPermissions.resolveReturns);
  assert.equal(commandPermission("returnCorrectDecision"), inventoryPermissions.resolveReturns);
  assert.equal(commandPermission("removalFieldChoices"), inventoryPermissions.manageRemovalRules);
});

test("customer custody and relational technician selections survive backup/restore encoding", () => {
  const held = decide(fixture(), "customer_return");
  const completed = command(held, "returnCustomerHandoff", handoff(held)).state;
  const tables = inventoryToRelational(completed, 1);
  assert.ok(tables.has("inventory_field_removal_choices"));
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), completed.revision, Object.keys(completed));
  assert.deepEqual(restored.fieldRemovalChoices, completed.fieldRemovalChoices);
  assert.deepEqual(restored.returns, completed.returns);
  assert.doesNotThrow(() => validateInventoryBackup({ state: restored, enabled: true, movements: [] }, [1]));
  restored.fieldRemovalChoices![0].ruleId = randomUUID();
  assert.throws(() => validateInventoryBackup({ state: restored, enabled: true, movements: [] }, [1]), /technician disposition/i);
});
