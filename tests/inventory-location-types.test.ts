import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, warehouseSchema, commandPermission, inventoryPermissions, type InventoryCommand, type InventoryState } from "../shared/inventory";
import { applyInventoryCommand, warehouseAccess } from "../shared/inventory-engine";
import { defaultLocationTypeId, initialLocationTypes, locationTypeLabel, normalizeInventoryLocations, warehouseAccessible } from "../shared/inventory-location-types";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { prepareLocationTypeRestore } from "../server/inventoryLocationTypesBackup";
import { inventoryAuditEntity } from "../server/auditReadModel";
import { permissionRegistry } from "../shared/permissionRegistry";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, actor = "operator", admin = true) =>
  applyInventoryCommand(state, { operationId: randomUUID(), action, data }, actor, admin).state;
function fixture() {
  let state = emptyInventory();
  state = post(state, "warehouse", { id: "main", code: "MAIN", name: "Warehouse", type: "physical", address: "10 Main", assignedUserId: "old-owner", userIds: ["relief"] });
  state = post(state, "warehouse", { id: "van", code: "VAN", name: "Vehicle", type: "vehicle", vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", assignedUserId: "driver" });
  return state;
}

test("live cutover uses shared warehouses and assigned vehicles without losing old assignments", () => {
  const state = fixture();
  assert.equal(state.locationTypes!.length, 2);
  assert.equal(state.warehouses[0].locationTypeId, defaultLocationTypeId("physical"));
  assert.equal(warehouseAccessible(state, state.warehouses[0], "other-member", false), true);
  assert.equal(warehouseAccessible(state, state.warehouses[1], "other-member", false), false);
  assert.equal(warehouseAccessible(state, state.warehouses[1], "driver", false), true);
  assert.deepEqual(state.warehouses[0].userIds, ["relief"]);
  assert.equal(state.warehouses[0].assignedUserId, "old-owner");
  assert.deepEqual(normalizeInventoryLocations(state), state);
});

test("location access fails closed for inactive, unknown type, missing identity and legacy grants", () => {
  const state = fixture(), warehouse = state.warehouses[0];
  assert.equal(warehouseAccessible(state, { ...warehouse, active: false }, "operator", true), false);
  assert.equal(warehouseAccessible(state, { ...warehouse, locationTypeId: randomUUID() }, "operator", true), false);
  assert.equal(warehouseAccessible(state, warehouse, undefined, true), false);
  const { locationTypeId, ...legacy } = warehouse;
  assert.equal(warehouseAccessible({}, legacy, "other-member", false), false);
  assert.equal(warehouseAccessible({}, legacy, "relief", false), true);
});

test("custom mobile types need no VIN; rename uses immutable IDs; deletion blocks active and inactive references", () => {
  const typeId = randomUUID();
  let state = fixture();
  state = post(state, "locationType", { id: typeId, name: "  Mobile   storage ", kind: "mobile", accessPolicy: "assigned" });
  assert.equal(state.locationTypes!.find(type => type.id === typeId)!.name, "Mobile storage");
  assert.throws(() => post(state, "locationType", { id: randomUUID(), name: "mobile storage", kind: "physical", accessPolicy: "shared" }), /already exists/);
  state = post(state, "warehouse", { id: "cart", code: "CART", name: "Portable stock", type: "mobile", locationTypeId: typeId, assignedUserId: "driver" });
  const original = structuredClone(state.warehouses[2]);
  state = post(state, "locationType", { id: typeId, name: "Portable storage", kind: "mobile", accessPolicy: "assigned", expectedRevision: 1 });
  assert.deepEqual(state.warehouses[2], original);
  assert.equal(locationTypeLabel(state, state.warehouses[2]), "Portable storage");
  assert.throws(() => post(state, "locationTypeDelete", { id: typeId, expectedRevision: 2 }), /used by 1 location/);
  state = post(state, "warehouse", { ...state.warehouses[2], active: false });
  assert.throws(() => post(state, "locationTypeDelete", { id: typeId, expectedRevision: 2 }), /including inactive/);
  const unused = randomUUID();
  state = post(state, "locationType", { id: unused, name: "Unused", kind: "physical", accessPolicy: "shared" });
  state = post(state, "locationTypeDelete", { id: unused, expectedRevision: 1 });
  assert.ok(!state.locationTypes!.some(type => type.id === unused));
});

test("policy changes require a current type revision and exact affected-location acknowledgement", () => {
  let state = fixture();
  const id = defaultLocationTypeId("physical"), data = { id, name: "Warehouse", kind: "physical", accessPolicy: "assigned", expectedRevision: 1 };
  assert.throws(() => post(state, "locationType", data), /confirm/);
  assert.throws(() => post(state, "locationType", { ...data, confirmAffectedLocations: ["main", "van"] }), /confirm/);
  state = post(state, "locationType", { ...data, confirmAffectedLocations: ["main"] });
  assert.throws(() => post(state, "locationType", { ...data, name: "Stale" }), /changed/);
  assert.equal(warehouseAccessible(state, state.warehouses[0], "other-member", false), false);
  assert.equal(warehouseAccessible(state, state.warehouses[0], "relief", false), true);
  assert.throws(() => post(state, "warehouse", { ...state.warehouses[0], expectedLocationTypeRevision: 1 }), /type changed/);
  const before = structuredClone(state);
  assert.throws(() => post(state, "locationType", { id, name: "Vehicle now", kind: "vehicle", accessPolicy: "assigned", expectedRevision: 2, confirmAffectedLocations: ["main"] }), /VIN/);
  assert.deepEqual(state, before, "Failed validation must not partially change the kind or policy");
});

test("shared inventory operations work without assignments while restricted stock remains protected", () => {
  let state = fixture();
  state = post(state, "vendor", { id: "vendor", name: "Supplier" });
  state = post(state, "item", { id: "part", sku: "PART", name: "Part", tracking: "regular" });
  state = post(state, "item", { id: "kit", sku: "KIT", name: "Kit", tracking: "regular", components: [{ itemId: "part", quantity: 1 }] });
  const run = (action: InventoryCommand["action"], data: Record<string, unknown>) => state = post(state, action, data, "other-member", false);
  run("order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main", lines: [{ itemId: "part", quantity: 10 }] });
  run("release", { orderId: "po" });
  run("receive", { orderId: "po", lines: [{ itemId: "part", quantity: 10 }] });
  run("assemble", { warehouseId: "main", itemId: "kit", quantity: 1, serials: [], components: [{ itemId: "part", quantity: 1, serials: [] }] });
  run("countStart", { id: "count", warehouseId: "main", scope: "selected" });
  run("assign", { workOrderId: 1, lines: [{ warehouseId: "main", itemId: "part", quantity: 1 }] });
  run("prepareUse", { workOrderId: 1, revision: 1, mode: "changeout", used: [{ warehouseId: "main", itemId: "part", quantity: 1 }], dispositions: [] });
  assert.equal(state.stock.find(stock => stock.itemId === "part")!.quantity, 9);
  assert.throws(() => run("countStart", { id: "blocked", warehouseId: "van" }), /access required/);
  assert.throws(() => warehouseAccess(state, "van", "other-member", false), /access required/);
});

test("backup adapters retain modern policies and restore pre-type physical locations as restricted", () => {
  const modern = fixture();
  validateInventoryBackup({ state: modern, movements: [], enabled: true }, []);
  const tables = inventoryToRelational(modern, 1);
  assert.equal(tables.get("inventory_location_types")!.rows.length, 2);
  const decoded = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, structuredClone(table.rows)])), modern.revision, Object.keys(modern));
  assert.deepEqual(decoded.locationTypes, modern.locationTypes);
  const legacy = structuredClone(modern);
  delete legacy.locationTypes;
  for (const warehouse of legacy.warehouses) delete warehouse.locationTypeId;
  const restored = normalizeInventoryLocations(legacy, "assigned");
  assert.equal(warehouseAccessible(restored, restored.warehouses[0], "other-member", false), false);
  assert.equal(warehouseAccessible(restored, restored.warehouses[0], "old-owner", false), true);
  assert.throws(() => normalizeInventoryLocations({ ...modern, locationTypes: [] }), /existing location type/);
});

test("full-system legacy public rows are upgraded before their NOT NULL/FK constraints are applied", () => {
  const state = fixture();
  delete state.locationTypes;
  state.warehouses.forEach(warehouse => delete warehouse.locationTypeId);
  const backup = { mainDatabase: { inventory_state: [{ project_id: 1, state }], inventory_warehouses: [{ project_id: 1, id: "main" }] } as Record<string, any[]>,
    projectDatabases: [{ projectId: 1, inventory: { state } }] };
  prepareLocationTypeRestore(backup);
  assert.equal(backup.mainDatabase.inventory_location_types.length, 2);
  assert.equal(backup.mainDatabase.inventory_warehouses.length, 2);
  assert.ok(backup.mainDatabase.inventory_warehouses.every(row => row.location_type_id));
  const restored = backup.projectDatabases[0].inventory.state;
  assert.equal(warehouseAccessible(restored, restored.warehouses[0], "other-member", false), false);
});

test("type permissions are discoverable and audit labels identify renamed or deleted types", () => {
  const definition = permissionRegistry.find(permission => permission.key === inventoryPermissions.manageLocationTypes);
  assert.ok(definition);
  assert.match(definition.label, /Location Types and Access/);
  assert.equal(definition.defaultAccess.fieldTechnician, false);
  assert.equal(commandPermission("locationType"), definition.key);
  assert.equal(commandPermission("locationTypeDelete"), definition.key);
  const type = initialLocationTypes()[0];
  const label = inventoryAuditEntity(emptyInventory(), [{ field: "locationTypes", before: [type], after: [] }], "operation");
  assert.match(label!, /Location type.*Warehouse/);
});
