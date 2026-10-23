import test from "node:test";
import assert from "node:assert/strict";
import { inventoryCapabilities } from "../shared/inventory-capabilities";
import { inventoryPermissions } from "../shared/inventory";

const access = (permissions: string[]) => inventoryCapabilities(permission => permissions.includes(permission));
test("field view and assign grant stock lookup, not warehouse areas or fulfillment", () => {
  for (const permissions of [["inventory.view"], ["inventory.view", "inventory.assign", "workOrders.view"]]) {
    const result = access(permissions);
    assert.deepEqual(Object.entries(result.tabs).filter(([, enabled]) => enabled).map(([key]) => key), ["stock"]);
    assert.equal(result.fulfillment, false);
    assert.equal(result.startInventory, false);
    assert.equal(result.vehicleTransfer, false);
    assert.equal(result.stats, false);
  }
});
test("stock transfer workers can start inventory without work-order fulfillment access", () => {
  const permissions = ["inventory.view", "inventory.transfer", "inventory.receive"];
  assert.equal(access(permissions).startInventory, true);
  assert.equal(access(permissions).vehicleTransfer, true);
  assert.equal(access(permissions).fulfillment, false);
  for (const removed of permissions)
    assert.equal(access(permissions.filter(key => key !== removed)).vehicleTransfer, false, removed);
  assert.equal(access(["inventory.view", "inventory.receive"]).returnEquipment, true);
  assert.equal(access(["inventory.view", "inventory.receive"]).startInventory, true);
  assert.equal(access(["inventory.view", "inventory.count"]).verifyVehicle, true);
  assert.equal(access(["inventory.view", "inventory.count"]).startInventory, true);
  assert.equal(access(["inventory.view", "inventory.count"]).returnStock, false);
});
test("fulfillment requires every prerequisite, not work-order viewing alone", () => {
  const permissions = ["inventory.view", "inventory.assign", "inventory.receive", "inventory.transfer", "workOrders.view"];
  assert.equal(access(permissions).fulfillment, true);
  for (const removed of permissions) assert.equal(access(permissions.filter(key => key !== removed)).fulfillment, false, removed);
});
test("each action grants its applicable management surface without unrelated workflows", () => {
  for (const [permission, tab] of [["maintain", "items"], ["manageLocationTypes", "locations"], ["purchase", "orders"],
    ["count", "counts"], ["resolveExceptions", "exceptions"], ["resolveReturns", "returns"]]) {
    const result = access(["inventory.view", `inventory.${permission}`]);
    assert.equal(result.tabs[tab as keyof typeof result.tabs], true);
    assert.equal(result.fulfillment, false);
    assert.equal(result.stats, true);
  }
  const all = access([...Object.values(inventoryPermissions), "workOrders.view"]);
  assert.equal(access(["inventory.view", "inventory.transfer"]).tabs.returns, false);
  assert.equal(access(["inventory.view", "inventory.configure"]).tabs.locations, false);
  assert.equal(Object.values(all.tabs).every(Boolean), true);
  assert.equal(all.fulfillment, true);
  assert.equal(Object.values(access([]).tabs).some(Boolean), false);
});
