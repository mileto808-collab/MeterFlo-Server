import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assignedToTechnician } from "../shared/work-order-assignment";
import { warehouseRouteOrigins } from "../shared/routing-origins";
import { emptyInventory, warehouseSchema } from "../shared/inventory";

test("technician visibility uses personal OR exact group membership, independently of status", () => {
  for (const status of ["Open", "Scheduled", "Trouble", "Completed", "Closed"]) {
    assert.equal(assignedToTechnician({ assignedUserId: "tech" }, "tech", []), true, status);
    assert.equal(assignedToTechnician({ assignedUserId: null, assignedGroupId: "Field crew" }, "tech", ["Field crew"]), true, status);
    assert.equal(assignedToTechnician({ assignedUserId: "other", assignedGroupId: "Field crew" }, "tech", ["Field crew"]), true, status);
  }
  assert.equal(assignedToTechnician({ assignedUserId: "other" }, "tech", ["Field crew"]), false);
  assert.equal(assignedToTechnician({ assignedGroupId: "Other crew" }, "tech", ["Field crew"]), false);
  assert.equal(assignedToTechnician({ assignedGroupId: "Field crew 2" }, "tech", ["Field crew"]), false);
  assert.equal(assignedToTechnician({}, "tech", []), false);
});

test("warehouse origins exclude inactive, addressless, vehicle/mobile and inaccessible locations", () => {
  const state = emptyInventory(1);
  const fixed = warehouseSchema.parse({ id: randomUUID(), code: "MAIN", name: "Main",
    type: "physical", address: " 100 Main St ", city: " Denver ", state: "CO", zip: "80201" });
  state.warehouses = [fixed, { ...fixed, id: randomUUID(), active: false },
    { ...fixed, id: randomUUID(), address: " " },
    { ...fixed, id: randomUUID(), type: "vehicle" }, { ...fixed, id: randomUUID(), type: "mobile" }];
  assert.deepEqual(warehouseRouteOrigins(state, "tech", true),
    [{ id: fixed.id, name: "Main", address: "100 Main St, Denver, CO, 80201" }]);
  const custom = randomUUID();
  state.locationTypes = [{ id: custom, name: "Assigned fixed location", kind: "physical", accessPolicy: "assigned", revision: 1 }];
  state.warehouses = [{ ...fixed, locationTypeId: custom }];
  assert.deepEqual(warehouseRouteOrigins(state, "tech", false), []);
  state.warehouses[0].userIds = ["tech"];
  assert.equal(warehouseRouteOrigins(state, "tech", false).length, 1);
  state.locationTypes[0].kind = "vehicle";
  assert.deepEqual(warehouseRouteOrigins(state, "tech", true), []);
});
