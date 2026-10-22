import test from "node:test";
import assert from "node:assert/strict";
import { workOrderInventoryCapabilities as capabilities } from "../shared/work-order-inventory-capabilities";
import { samePlanOverrides } from "../shared/inventory-planning";
import { commandPermission } from "../shared/inventory";
import { permissionRegistry } from "../shared/permissionRegistry";

const options = { enabled: true, editable: true, readingOnly: false, consumed: false };
test("a technician may plan without receiving stock-management controls", () => {
  assert.deepEqual(capabilities(["workOrders.view", "inventory.plan", "inventory.assign"], options), {
    canPlan: true, canOverridePlan: false, canReserve: false, canStage: false, canReviewUse: false, canReconcile: false,
  });
});
test("field actual-use permission alone grants neither planning nor reservations", () => {
  const result = capabilities(["workOrders.view", "inventory.view", "inventory.assign"], options);
  assert.equal(result.canPlan, false);
  assert.equal(result.canReserve, false);
  assert.equal(result.canReviewUse, false);
  assert.equal(commandPermission("plan"), "inventory.plan");
  assert.equal(commandPermission("assign"), "inventory.reserve");
  assert.equal(commandPermission("prepareUse"), "inventory.assign");
});
test("reservation and override permissions are separate and respect locked projects", () => {
  const permissions = ["workOrders.view", "inventory.view", "inventory.plan", "inventory.overridePlan", "inventory.reserve"];
  assert.equal(capabilities(permissions, options).canOverridePlan, true);
  assert.equal(capabilities(permissions, options).canReserve, true);
  for (const locked of [{ ...options, enabled: false }, { ...options, editable: false }, { ...options, readingOnly: true }]) {
    assert.equal(capabilities(permissions, locked).canPlan, false);
    assert.equal(capabilities(permissions, locked).canReserve, false);
  }
  assert.equal(capabilities(["inventory.overridePlan"], options).canOverridePlan, false);
  const otherInstaller = capabilities(permissions, { ...options, stockEditable: false });
  assert.equal(otherInstaller.canPlan, true);
  assert.equal(otherInstaller.canReserve, false);
  const readingManager = capabilities(["workOrders.view", "inventory.view", "inventory.assign", "inventory.maintain"],
    { ...options, readingOnly: true });
  assert.equal(readingManager.canReviewUse, true);
  assert.equal(readingManager.canPlan, false);
  assert.equal(readingManager.canReserve, false);
});
test("planners can preserve overrides but cannot add, alter or remove one", () => {
  const line = { id: "override", itemId: "meter", kind: "override" as const, quantity: 2, reason: "Authorized requirement change" };
  const extra = { id: "extra", itemId: "fitting", kind: "addition" as const, quantity: 3, reason: "" };
  assert.equal(samePlanOverrides([line], [extra, line]), true);
  assert.equal(samePlanOverrides([line], [extra]), false);
  assert.equal(samePlanOverrides([], [line]), false);
  assert.equal(samePlanOverrides([line], [{ ...line, quantity: 3 }]), false);
});
test("normal role management includes all three explicit permission choices", () => {
  for (const key of ["inventory.plan", "inventory.overridePlan", "inventory.reserve"]) {
    assert.ok(permissionRegistry.find(permission => permission.key === key)?.label);
  }
  assert.equal(permissionRegistry.find(permission => permission.key === "inventory.plan")!.defaultAccess.fieldTechnician, true);
  assert.equal(permissionRegistry.find(permission => permission.key === "inventory.reserve")!.defaultAccess.fieldTechnician, false);
});
