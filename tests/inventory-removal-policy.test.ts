import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, itemSchema, warehouseSchema, commandPermission, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { removalChoices, removalConfig, validateRemovalWorkflow, hasInventoryReplacement } from "../shared/inventory-removal-policy";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";

function base() {
  const s = emptyInventory();
  s.warehouses = [warehouseSchema.parse({ id: "main", code: "MAIN", name: "Warehouse", type: "physical", address: "Fixture" })];
  s.items = [itemSchema.parse({ id: "meter", sku: "M", name: "Meter", tracking: "serialized", equipment: "system" }),
    itemSchema.parse({ id: "regular", sku: "R", name: "Regular meter", tracking: "regular", equipment: "module" })];
  return s;
}
function post(s: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) {
  return applyInventoryCommand(s, { action, data, operationId }, "fixture-actor", true, "2026-10-17T12:00:00.000Z").state;
}
const removed = (s: InventoryState, equipment: "system" | "module" = "system") => {
  const r = removalChoices(s, equipment, "field")[0];
  return { equipment, serial: "OLD-1", disposition: "returned", warehouseId: "main",
    ruleId: r.id, ruleRevision: r.revision, policyRevision: removalConfig(s).policy.revision };
};
function prepared() {
  let s = base();
  s = post(s, "prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", used: [], dispositions: [removed(s)] });
  return s;
}
test("safe defaults, custom same-outcome names, rename history, stale review, and used deletion", () => {
  let s = base();
  assert.deepEqual(removalChoices(s, "system", "field").map(r => r.outcome), ["returned"]);
  const rule = { ...removalChoices(s, "system", "field")[0], id: randomUUID(), name: "Contract salvage return" };
  s = post(s, "removalRule", rule);
  assert.equal(removalChoices(s, "system", "field").length, 2);
  s = post(s, "prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", used: [], dispositions: [{ ...removed(s), ruleId: rule.id }] });
  const complete = completeInventoryWorkOrder(s, 1, false, "installer", "2026-10-17T12:00:00.000Z");
  assert.equal(complete.returns[0].ruleName, rule.name);
  assert.equal(complete.returns[0].status, "pending");
  assert.equal(complete.returns[0].history![0].actor, "installer");
  const renamed = post(complete, "removalRule", { ...rule, name: "Renamed" });
  assert.equal(renamed.returns[0].ruleName, rule.name);
  assert.throws(() => post(renamed, "removalRuleDelete", { id: rule.id, revision: 2 }), /used/i);
  assert.throws(() => completeInventoryWorkOrder(post(s, "removalRule", { ...rule, name: "Changed" }), 1, false), /changed/i);
  assert.throws(() => post(renamed, "removalRule", { ...rule, active: false }), /changed/i);
  const disabled = post(renamed, "removalRule", { ...rule, revision: 2, active: false });
  assert.ok(!removalChoices(disabled, "system", "field").some(r => r.id === rule.id));
  const unused = { ...rule, id: randomUUID(), name: "Unused", revision: 1 };
  s = post(s, "removalRule", unused);
  s = post(s, "removalRuleDelete", { id: unused.id, revision: 1 });
  assert.ok(!removalConfig(s).rules.some(r => r.id === unused.id));
});
test("mandatory returns reject forged field scrap, warehouse-only choices, stale policy and no-approved-rule fallback", () => {
  let s = base();
  const scrap = { ...removalConfig(s).rules[0], id: randomUUID(), name: "Approved field scrap", outcome: "scrapped" as const };
  s = post(s, "removalRule", scrap);
  const prepare = (d: unknown) => post(s, "prepareUse", { workOrderId: 1, revision: s.allocations[0]?.revision ?? 0, mode: "changeout", used: [], dispositions: [d] });
  assert.throws(() => prepare({ ...removed(s), ruleId: scrap.id, disposition: "scrapped", warehouseId: null }), /approved/i);
  assert.throws(() => prepare({ ...removed(s), ruleId: removalConfig(s).rules[2].id, disposition: "scrapped", warehouseId: null }), /approved/i);
  assert.throws(() => prepare({ ...removed(s), ruleName: "Forged", policyRevision: 99 }), /changed/i);
  s = post(s, "removalPolicy", { ...removalConfig(s).policy, requireSystemReturn: false });
  assert.ok(removalChoices(s, "system", "field").some(r => r.id === scrap.id));
  assert.ok(!removalChoices(s, "module", "field").some(r => r.id === scrap.id));
  s = prepare({ ...removed(s), ruleId: scrap.id, disposition: "scrapped", warehouseId: null });
  const complete = completeInventoryWorkOrder(s, 1, false);
  assert.equal(complete.returns[0].status, "scrapped");
  assert.throws(() => post(complete, "returnAccept", { id: complete.returns[0].id }), /Return not found/i);
  const defaultRule = removalConfig(s).rules[0];
  s = post(s, "removalRule", { ...defaultRule, active: false });
  s = post(s, "removalPolicy", { ...removalConfig(s).policy, requireSystemReturn: true });
  assert.equal(removalChoices(s, "system", "field").length, 0);
  assert.throws(() => prepare({ equipment: "system", serial: "OLD", disposition: "returned", warehouseId: "main" }), /approved/i);
});
test("receipt before warehouse decision, final scrap, release regular/serialized, reason, replay and history", () => {
  let s = completeInventoryWorkOrder(prepared(), 1, false, "installer");
  const r = s.returns[0], scrap = removalChoices(s, "system", "warehouse").find(r => r.outcome === "scrapped")!;
  const decision = { id: r.id, ruleId: scrap.id, ruleRevision: scrap.revision, reason: "Failed inspection" };
  assert.throws(() => post(s, "returnDecide", decision), /Accept and inspect/i);
  s = post(s, "returnAccept", { id: r.id });
  assert.equal(s.stock.length, 0);
  assert.throws(() => post(s, "returnDecide", { ...decision, reason: "" }));
  assert.throws(() => post(s, "returnDecide", { ...decision, ruleRevision: 22 }), /current approved/i);
  const op = randomUUID();
  s = post(s, "returnDecide", decision, op);
  assert.equal(s.returns[0].status, "scrapped");
  assert.equal(s.returns[0].history!.length, 3);
  assert.deepEqual(post(s, "returnDecide", decision, op), s);
  assert.equal(s.stock.length, 0);
  assert.throws(() => post(s, "returnDecide", decision), /Accept and inspect/i);
  for (const equipment of ["system", "module"] as const) {
    let state = post(base(), "prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", used: [], dispositions: [removed(base(), equipment)] });
    state = completeInventoryWorkOrder(state, 1, false);
    state = post(state, "returnAccept", { id: state.returns[0].id });
    const release = removalChoices(state, equipment, "warehouse").find(r => r.outcome === "released")!;
    state = post(state, "returnDecide", { id: state.returns[0].id, ruleId: release.id, ruleRevision: release.revision,
      reason: "Tested good", itemId: equipment === "system" ? "meter" : "regular" });
    assert.equal(state.stock[0].quantity, 1);
    assert.equal(state.stock[0].serials.length, equipment === "system" ? 1 : 0);
  }
});
test("workflow and equipment scope reject forbidden choices; reconciliation preserves removal custody", () => {
  const s = prepared();
  assert.throws(() => validateRemovalWorkflow("reading_only", [], [], s, { wizardMode: "changeout", equipment: "system" }), /workflow/i);
  assert.throws(() => validateRemovalWorkflow("changeout", [], [], s, { wizardMode: "reading_only", equipment: "both" }), /workflow/i);
  assert.throws(() => validateRemovalWorkflow("reading_only", [{ itemId: "meter" }], [], s, { wizardMode: "user_choice", equipment: "both" }), /Reading-only/i);
  assert.throws(() => validateRemovalWorkflow("changeout", [], [{ ...removed(s), equipment: "module", disposition: "returned" }], s, { wizardMode: "changeout", equipment: "system" }), /scope/i);
  assert.doesNotThrow(() => validateRemovalWorkflow("reading_only", [], [], s, { wizardMode: "user_choice", equipment: "module" }));
  const completed = completeInventoryWorkOrder(s, 1, false);
  const reconciled = post(completed, "reconcileWorkOrder", { workOrderId: 1, reason: "Reopen", restoreUsedStock: false });
  assert.deepEqual(reconciled.returns, completed.returns);
  const reassigned = post(reconciled, "assign", { workOrderId: 1, lines: [] });
  const reviewedAgain = post(reassigned, "prepareUse", { workOrderId: 1, revision: reassigned.allocations[0].revision,
    mode: "changeout", used: [], dispositions: [removed(reassigned)] });
  assert.deepEqual(completeInventoryWorkOrder(reviewedAgain, 1, false).returns, completed.returns,
    "Reopening and completing again must not duplicate the original physical return.");
  assert.equal(commandPermission("returnAccept"), "inventory.receive");
  assert.equal(commandPermission("returnRelease"), "inventory.resolveReturns");
  assert.equal(commandPermission("returnDecide"), "inventory.resolveReturns");
  assert.equal(commandPermission("removalRule"), "inventory.manageRemovalRules");
});
test("rules and evidence round-trip relationally and backups reject orphaned definitions", () => {
  const s = completeInventoryWorkOrder(prepared(), 1, false);
  const relational = inventoryToRelational(s, 1);
  assert.ok(relational.has("inventory_removal_rules"));
  assert.ok(relational.has("inventory_removal_policies"));
  // The codec includes marker metadata alongside relational rows.
  const rows = new Map([...relational].map(([name, table]) => [name, table.rows]));
  const decoded = inventoryFromRelational(rows, s.revision, Object.keys(s));
  assert.deepEqual(decoded.removalRules, s.removalRules);
  assert.deepEqual(decoded.returns, s.returns);
  assert.doesNotThrow(() => validateInventoryBackup({ state: s, enabled: true, movements: [] }, [1]));
  const corrupt = structuredClone(s); corrupt.removalRules = [];
  assert.throws(() => validateInventoryBackup({ state: corrupt, enabled: true, movements: [] }, [1]), /orphaned/i);
});

test("reading-only inference checks both project scopes and cannot disguise installed identity changes", () => {
  const before: Record<"system" | "module", { old: string; new: string | null }> =
    { system: { old: "SYSTEM-OLD", new: null }, module: { old: "MODULE-OLD", new: null } };
  for (const [readingEquipment, equipment] of [["system", "module"], ["module", "system"]] as const) {
    const workflow = { wizardMode: "user_choice", readingEquipment, equipment };
    const reading = structuredClone(before);
    reading[readingEquipment].new = before[readingEquipment].old;
    assert.equal(hasInventoryReplacement(before, reading, workflow), false);
    const replaced = structuredClone(reading);
    replaced[equipment].new = "INSTALLED-NEW";
    assert.equal(hasInventoryReplacement(before, replaced, workflow), true);
    replaced[equipment].old = "INSTALLED-NEW";
    assert.equal(hasInventoryReplacement(before, replaced, workflow), true, "Forging old and new together does not hide installation");
    assert.equal(hasInventoryReplacement(replaced, replaced, workflow), false, "Equal old/new is not a replacement");
    replaced[equipment].old = "MODULE-OLD";
    assert.equal(hasInventoryReplacement(replaced, replaced, workflow), true, "Applicable prefilled replacement cannot infer reading-only");
  }
  const historical = { system: { old: "S", new: "S" }, module: { old: "LEGACY-OLD", new: "LEGACY-NEW" } };
  const workflow = { wizardMode: "reading_only", equipment: "system", readingEquipment: "system" };
  assert.equal(hasInventoryReplacement(historical, historical, workflow), false, "Unchanged hidden history is preserved");
  assert.equal(hasInventoryReplacement(historical, { ...historical, module: { old: "LEGACY-OLD", new: "OTHER" } }, workflow), true);
});
