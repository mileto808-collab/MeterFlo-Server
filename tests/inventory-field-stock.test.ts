import test from "node:test";
import assert from "node:assert/strict";
import { emptyInventory, warehouseSchema, itemSchema } from "../shared/inventory";
import { initialLocationTypes } from "../shared/inventory-location-types";
import { fieldStockSettings, fieldStockSettingsSchema, resolveFieldStock, fieldStockSourceAllowed, fieldFulfillmentAllowed } from "../shared/inventory-field-stock";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";

const warehouse = (id: string, type: "physical" | "vehicle", users: string[] = []) =>
  warehouseSchema.parse({ id, code: id, name: id, type, address: "1 Main St", userIds: users,
    vin: type === "vehicle" ? "1HGCM82633A004352" : "", plate: "ABC", plateState: "CO" });
function fixture() {
  const state = emptyInventory();
  state.locationTypes = initialLocationTypes();
  state.warehouses = [warehouse("main", "physical"), warehouse("truck", "vehicle", ["tech1", "tech2"])];
  state.items = [itemSchema.parse({ id: "device", sku: "DEV", name: "Device", tracking: "regular", equipment: "system" }),
    itemSchema.parse({ id: "kit", sku: "KIT", name: "Kit", tracking: "regular", components: [{ itemId: "device", quantity: 1 }] })];
  return state;
}
const line = (warehouseId: string, itemId = "device", quantity = 1) => ({ warehouseId, itemId, quantity, serials: [] });
test("shared vehicle assignments select one common stock source for each technician", () => {
  const state = fixture();
  assert.equal(resolveFieldStock(state, "tech1", false).source?.id, "truck");
  assert.equal(resolveFieldStock(state, "tech2", false).source?.id, "truck");
  assert.equal(resolveFieldStock(state, "other", false).source, undefined);
  assert.equal(fieldStockSettings(state).fulfillment, "components");
});
test("multiple vehicles require a choice, remember only an eligible assignment, and never choose physical stock as fallback", () => {
  const state = fixture();
  state.warehouses.push(warehouse("truck2", "vehicle", ["tech1"]));
  assert.equal(resolveFieldStock(state, "tech1", false).source, undefined);
  assert.equal(resolveFieldStock(state, "tech1", false, "truck2").source?.id, "truck2");
  assert.equal(resolveFieldStock(state, "tech1", false, "main").source, undefined);
  state.warehouses.find(w => w.id === "truck2")!.active = false;
  assert.equal(resolveFieldStock(state, "tech1", false, "truck2").source?.id, "truck");
  state.warehouses.find(w => w.id === "truck")!.userIds = [];
  assert.equal(resolveFieldStock(state, "tech1", false, "truck").source, undefined);
});
test("project warehouse mode uses the exact configured shared warehouse without vehicle transfers", () => {
  const state = fixture();
  state.fieldSettings = [fieldStockSettingsSchema.parse({ sourceMode: "project_warehouse", warehouseId: "main" })];
  assert.equal(resolveFieldStock(state, "tech1", false, "truck").source?.id, "main");
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, false, line("main")), true);
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, false, line("truck")), false);
  state.warehouses[0].active = false;
  assert.equal(resolveFieldStock(state, "tech1", false).source, undefined);
});
test("unprivileged callers cannot switch source but authorized exceptions still require location access", () => {
  const state = fixture();
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, false, line("main")), false);
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, true, line("main")), true);
  assert.equal(fieldStockSourceAllowed(state, "other", false, true, line("truck")), false);
  assert.equal(resolveFieldStock(state, "tech1", false, "", "main").source?.id, "main");
});
test("existing reservations retain their source and limits rather than moving to the default vehicle", () => {
  const state = fixture();
  const reserved = [line("main")];
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, false, line("main"), reserved), true);
  assert.equal(fieldStockSourceAllowed(state, "tech1", false, false, line("main", "device", 2), reserved), false);
});
test("kit exceptions require permission while original reserved representation remains usable", () => {
  const state = fixture();
  state.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  assert.equal(fieldFulfillmentAllowed(state, 1, [line("truck", "kit")], [], false), false);
  assert.equal(fieldFulfillmentAllowed(state, 1, [line("truck", "kit")], [], true), true);
  assert.equal(fieldFulfillmentAllowed(state, 1, [line("truck", "kit")], [line("truck", "kit")], false), true);
  state.fieldSettings = [fieldStockSettingsSchema.parse({ fulfillment: "kits" })];
  assert.equal(fieldFulfillmentAllowed(state, 1, [line("truck")], [], false), false);
  assert.equal(fieldFulfillmentAllowed(state, 1, [line("truck")], [line("truck")], false), true);
  assert.equal(fieldFulfillmentAllowed(state, 1, [], [], false), true, "Reading-only visits do not consume kits.");
});
test("field settings reject nonexistent/vehicle defaults, save by command, and round-trip relationally", () => {
  let state = fixture();
  const command = (warehouseId: string) => ({ operationId: crypto.randomUUID(), action: "fieldSettings" as const,
    data: { sourceMode: "project_warehouse", warehouseId, fulfillment: "kits" } });
  assert.throws(() => applyInventoryCommand(state, command("missing"), "admin", true), /physical project warehouse/);
  assert.throws(() => applyInventoryCommand(state, command("truck"), "admin", true), /physical project warehouse/);
  state = applyInventoryCommand(state, command("main"), "admin", true).state;
  assert.equal(fieldStockSettings(state).warehouseId, "main");
  const tables = new Map([...inventoryToRelational(state, 1)].map(([name, table]) => [name, table.rows]));
  const restored = inventoryFromRelational(tables, state.revision, Object.keys(state));
  assert.deepEqual(restored.fieldSettings, state.fieldSettings);
});
