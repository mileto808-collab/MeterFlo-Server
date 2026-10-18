import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder, reserved } from "../shared/inventory-engine";
import { actualEquipmentLines, deduplicateRequirements } from "../shared/inventory-requirements";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { storedCategoryState } from "../server/inventoryCategories";
import { mapImportRecord } from "../server/apiImportFetch";
import { apiImportConfigSchema } from "../shared/customer-api-import";
import { itemDeletionBlockers } from "../shared/inventory-deletion";

function post(state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) {
  return applyInventoryCommand(state, { action, data, operationId }, "tech", true).state;
}
function setup(serialized = true) {
  let s = emptyInventory();
  s = post(s, "warehouse", { id: "van", code: "VAN", name: "Vehicle", type: "vehicle", userIds: ["tech"],
    vin: "1HGCM82633A004352", plate: "TEST123", plateState: "CO", address: "Test" });
  s = post(s, "vendor", { id: "vendor", name: "Supplier" });
  s = post(s, "item", { id: "meter", sku: "M", name: "Meter", equipment: "system", tracking: serialized ? "serialized" : "regular" });
  s = post(s, "item", { id: "seal", sku: "S", name: "Seal", tracking: "regular" });
  s = post(s, "item", { id: "kit", sku: "K", name: "Installation kit", tracking: serialized ? "serialized" : "regular",
    components: [{ itemId: "meter", quantity: 1 }, { itemId: "seal", quantity: 2 }] });
  s = post(s, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "van",
    lines: [{ itemId: "meter", quantity: 2 }, { itemId: "seal", quantity: 4 }] });
  s = post(s, "release", { orderId: "po" });
  s = post(s, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 2, serials: serialized ? ["M1", "M2"] : [] },
    { itemId: "seal", quantity: 4, serials: [] },
  ] });
  return s;
}
const meterUse = (serialized = true) => ({ itemId: "meter", warehouseId: "van", quantity: 1, serials: serialized ? ["M1"] : [] });
const sealUse = { itemId: "seal", warehouseId: "van", quantity: 2, serials: [] };
const prepare = (s: InventoryState, used: any[], workOrderId = 1, revision = 0) =>
  post(s, "prepareUse", { workOrderId, revision, mode: "changeout", used, dispositions: [] });

test("actual serialized use needs no reservation and deducts only at completion, once", () => {
  const initial = setup();
  initial.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "meter", quantity: 1 }], missing: [] }];
  const prepared = prepare(initial, [meterUse()]);
  assert.deepEqual(prepared.stock, initial.stock);
  assert.equal(reserved(prepared, "van", "meter"), 0);
  assert.deepEqual(prepared.allocations[0].lines, []);
  const consumed = completeInventoryWorkOrder(prepared, 1, false);
  assert.equal(consumed.stock.find(s => s.itemId === "meter")!.quantity, 1);
  assert.ok(consumed.serialOccupancy!.some(s => s.serial === "M1" && s.workOrderId === 1));
  assert.deepEqual(completeInventoryWorkOrder(consumed, 1, false), consumed);
});

test("quantity-only standalone equipment does not require serial capture", () => {
  const initial = setup(false);
  const consumed = completeInventoryWorkOrder(prepare(initial, [meterUse(false)]), 1, false);
  assert.equal(consumed.stock.find(s => s.itemId === "meter")!.quantity, 1);
  assert.equal(consumed.serialOccupancy!.length, 0);
});

test("loose components satisfy a kit requirement without ever assembling kit stock", () => {
  const initial = setup();
  initial.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  const consumed = completeInventoryWorkOrder(prepare(initial, [meterUse(), sealUse]), 1, false);
  assert.equal(consumed.stock.find(s => s.itemId === "meter")!.quantity, 1);
  assert.equal(consumed.stock.find(s => s.itemId === "seal")!.quantity, 2);
  assert.ok(!consumed.stock.some(s => s.itemId === "kit" && s.quantity));
});

test("preassembled kits consume components at assembly, only the kit at completion", () => {
  let s = setup();
  s = post(s, "assemble", { warehouseId: "van", itemId: "kit", quantity: 1, serials: ["KIT1"],
    components: [{ itemId: "meter", quantity: 1, serials: ["M1"] }, { itemId: "seal", quantity: 2, serials: [] }] });
  s.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  const before = structuredClone(s.stock.filter(s => s.itemId !== "kit"));
  const used = [{ itemId: "kit", warehouseId: "van", quantity: 1, serials: ["KIT1"] }];
  const consumed = completeInventoryWorkOrder(prepare(s, used), 1, false);
  assert.deepEqual(consumed.stock.filter(s => s.itemId !== "kit"), before);
  assert.equal(consumed.stock.find(s => s.itemId === "kit")!.quantity, 0);
  assert.ok(actualEquipmentLines(consumed, used).some(l => l.itemId === "meter" && l.serials.includes("M1")));
  assert.ok(consumed.serialOccupancy!.some(l => l.serial === "M1" && l.workOrderId === 1));
});

test("requirements deduplicate a shared kit and components and reject incomplete or doubled usage", () => {
  const s = setup();
  assert.deepEqual(deduplicateRequirements(s, ["kit", "meter", "kit"]), [{ itemId: "kit", quantity: 1 }]);
  s.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  assert.throws(() => completeInventoryWorkOrder(prepare(s, [meterUse()]), 1, false), /every required/);
  const doubled = structuredClone(s);
  doubled.allocations = [{ workOrderId: 1, lines: [], used: [meterUse(), { itemId: "kit", warehouseId: "van", quantity: 1, serials: ["K"] }],
    dispositions: [], mode: "changeout", status: "reserved", revision: 1 }];
  assert.throws(() => completeInventoryWorkOrder(doubled, 1, false), /every required/);
});

test("unmapped new types block changeouts, but never reading-only visits", () => {
  const s = setup();
  s.workRequirements = [{ workOrderId: 1, lines: [], missing: [{ equipment: "system", typeId: "unknown" }] }];
  assert.throws(() => completeInventoryWorkOrder(prepare(s, [meterUse()]), 1, false), /missing type-to-item/);
  const reading = post(s, "prepareUse", { workOrderId: 1, revision: 0, mode: "reading_only", used: [], dispositions: [] });
  assert.deepEqual(completeInventoryWorkOrder(reading, 1, true).stock, s.stock);
});

test("selection checks current access, serial custody, competing reservations, and stale edits", () => {
  let s = setup();
  s = post(s, "assign", { workOrderId: 2, lines: [meterUse()] });
  assert.throws(() => prepare(s, [meterUse()]), /reserved|available|serial/i);
  const alternative = { ...meterUse(), serials: ["M2"] };
  let selected = prepare(s, [alternative]);
  assert.throws(() => prepare(selected, [alternative], 1, 0), /Assignments changed/);
  const latestRevision = selected.allocations.find(a => a.workOrderId === 1)!.revision;
  const operationId = randomUUID();
  const command: InventoryCommand = { action: "prepareUse", operationId, data: { workOrderId: 1, revision: latestRevision, mode: "changeout", used: [alternative], dispositions: [] } };
  const result = applyInventoryCommand(selected, command, "tech", true);
  assert.equal(applyInventoryCommand(result.state, command, "tech", true).replay, true);
  assert.throws(() => applyInventoryCommand(s, { ...command, data: { ...command.data, revision: 0 } }, "outsider", false), /access/i);
  selected = completeInventoryWorkOrder(selected, 1, false);
  assert.throws(() => prepare(selected, [alternative], 3), /serial|stock|available/i);
});

test("type links and planned lines use relational references and round-trip without stock", () => {
  let s = setup();
  s = post(s, "typeLink", { equipment: "system", typeId: 53, itemId: "kit" });
  assert.equal(s.typeLinks![0].systemTypeId, 53);
  assert.ok(itemDeletionBlockers(s, "kit").some(s => s.includes("system/module type")));
  s.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "kit", quantity: 1 }], missing: [] }];
  const tables = inventoryToRelational(s, 1);
  assert.equal(tables.get("inventory_type_links")!.rows[0].item_id, "kit");
  assert.equal(tables.get("inventory_work_requirement_lines")!.rows[0].quantity, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, structuredClone(table.rows)])), s.revision, Object.keys(s));
  assert.deepEqual(storedCategoryState(restored), storedCategoryState(s));
  assert.throws(() => post(s, "typeLink", { equipment: "module", typeId: 1, itemId: "seal" }), /containing module/);
});

test("customer API accepts and validates new types, ignores old assignment mappings", () => {
  const config = apiImportConfigSchema.parse({
    name: "planned", endpoint: "https://example.com/orders", fieldMapping: {
      id: "customerWoId", customer: "customerId", name: "customerName", address: "address", service: "serviceType",
      system: "newSystemType", module: "newModuleType", assigned: "inventoryItems",
    },
  });
  const record = { id: "WO1", customer: "C", name: "Customer", address: "Test", service: "electric", system: "SYS", module: "MOD",
    assigned: [{ warehouseId: "any", itemId: "any", serials: ["UNKNOWN"], quantity: 1 }] };
  const rules = { services: ["electric"], statuses: ["Open"], systems: ["SYS"], modules: ["MOD"], openStatus: "Open" };
  const valid = mapImportRecord(record, config, rules);
  assert.deepEqual(valid.errors, []);
  assert.equal(valid.mapped.newSystemType, "SYS");
  assert.equal(valid.mapped.newModuleType, "MOD");
  assert.equal(valid.mapped.inventoryItems, undefined);
  assert.ok(mapImportRecord({ ...record, system: "invalid" }, config, rules).errors.some(s => s.startsWith("newSystemType:")));
});
