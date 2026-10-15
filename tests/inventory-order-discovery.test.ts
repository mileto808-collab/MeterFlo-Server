import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, warehouseSchema, itemSchema, vendorSchema, commandPermission, inventoryPermissions, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { allocateOrderNumber, mergeOrderHighWater, orderLabel, orderReference, validateOrderNumbers } from "../shared/inventory-order-labels";
import { searchOrders, emptyOrderFilters, orderDate } from "../shared/inventory-order-search";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { orderSaveAttempt } from "../client/src/lib/inventory-order-save";

function fixture() {
  const state = emptyInventory();
  state.warehouses = ["main", "van"].map(id => warehouseSchema.parse({ id, code: id.toUpperCase(),
    name: id === "main" ? "Cleveland Main" : "Service Vehicle 1", type: "physical", address: "Test only" }));
  state.items = [itemSchema.parse({ id: "meter", sku: "000701", name: "E460 Meter", tracking: "regular" })];
  state.vendors = [vendorSchema.parse({ id: "supplier", name: "Landis+Gyr" })];
  return state;
}
const payload = (id = randomUUID(), type = "purchase", reference = "27491-01") => ({
  id, type, reference, destinationId: type === "purchase" ? "main" : "van",
  sourceId: type === "purchase" ? null : "main", vendorId: type === "purchase" ? "supplier" : null,
  lines: [{ itemId: "meter", quantity: 2, serials: [] }],
});
function run(state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID(), now = "2026-10-15T12:00:00.000Z") {
  return applyInventoryCommand(state, { action, data, operationId }, "operator", true, now).state;
}
function searchable() {
  let state = run(fixture(), "order", payload());
  state = run(state, "order", payload(randomUUID(), "transfer", "VAN-88"), randomUUID(), "2026-10-16T01:00:00.000Z");
  state.orders[0].status = "cancelled";
  state.orders[0].archivedAt = "2026-10-17T00:00:00.000Z";
  return state;
}
test("server numbers share a yearly project counter and exact retries do not allocate again", () => {
  const operationId = randomUUID(), input = payload();
  let state = run(fixture(), "order", input, operationId);
  assert.equal(state.orders[0].orderNumber, "PO-2026-000001");
  state = run(state, "order", payload(randomUUID(), "transfer"));
  assert.equal(state.orders[1].orderNumber, "TR-2026-000002");
  assert.strictEqual(run(state, "order", input, operationId), state);
  state = run(state, "order", { ...input, reference: "Corrected", notes: "Edit" });
  assert.equal(state.orders.length, 2);
  assert.equal(state.orders[0].orderNumber, "PO-2026-000001");
  assert.equal(state.orders[0].reference, "Corrected");
  state = run(state, "order", payload(), randomUUID(), "2027-01-01T00:00:00.000Z");
  assert.equal(state.orders[2].orderNumber, "PO-2027-000001");
  assert.equal(allocateOrderNumber(fixture(), "purchase", "2026-10-15T00:00:00Z"), "PO-2026-000001", "separate projects have independent numbering");
});
test("legacy numbering preserves identities, immutable evidence, custom labels and atomic warehouse access", () => {
  let state = run(fixture(), "order", payload());
  const uuid = state.orders[0].id;
  delete state.orders[0].orderNumber;
  delete state.orderNumberCounters;
  state.orders.push({ ...state.orders[0], id: "PO-2026-000015", reference: undefined });
  state.receipts.push({ id: "receipt", action: "receive", reference: uuid, warehouseId: "main", lines: [], actor: "operator", occurredAt: "2026-10-15T12:00:00Z" });
  const original = structuredClone(state);
  assert.equal(commandPermission("numberOrders"), inventoryPermissions.maintain);
  assert.throws(() => applyInventoryCommand(state, { action: "numberOrders", data: {}, operationId: randomUUID() }, "outsider", false), /access|warehouse|assigned/i);
  assert.deepEqual(state, original);
  state = run(state, "numberOrders", {});
  assert.equal(state.orders[0].id, uuid);
  assert.equal(state.orders[0].orderNumber, "PO-2026-000016");
  assert.equal(orderLabel(state.orders[1]), "PO-2026-000015");
  assert.equal(orderReference(state.orders[1]), "PO-2026-000015");
  assert.deepEqual(state.receipts, original.receipts);
  assert.deepEqual(state.stock, original.stock);
  assert.deepEqual(run(state, "numberOrders", {}).orders, state.orders);
});
test("restored high-water marks retain higher known local counters without mutating archives", () => {
  const archive = run(fixture(), "order", payload()), local = structuredClone(archive);
  local.orderNumberCounters = { "2026": 90, "2027": 4 };
  const merged = mergeOrderHighWater(archive, local);
  assert.equal(allocateOrderNumber(merged, "transfer", "2026-10-15T00:00:00Z"), "TR-2026-000091");
  assert.equal(archive.orderNumberCounters!["2026"], 1);
  assert.equal(merged.orderNumberCounters!["2027"], 4);
  const older = structuredClone(archive);
  delete older.orders[0].orderNumber; delete older.orderNumberCounters;
  assert.equal(mergeOrderHighWater(older, local).orders[0].orderNumber, local.orders[0].orderNumber,
    "an old archive must not renumber a known internal order");
  const conflict = structuredClone(archive);
  conflict.orders[0].orderNumber = "PO-2026-000090";
  conflict.orderNumberCounters!["2026"] = 90;
  assert.throws(() => mergeOrderHighWater(conflict, local), /conflicts/);
  validateInventoryBackup({ state: merged, movements: [], enabled: true }, []);
  const legacy = fixture();
  validateInventoryBackup({ state: legacy, movements: [], enabled: true }, []);
});
test("backup validation rejects duplicate, wrong-type, malformed and rewound numbering metadata", () => {
  const state = searchable();
  const check = (mutate: (state: InventoryState) => void) => {
    const copy = structuredClone(state); mutate(copy);
    assert.throws(() => validateInventoryBackup({ state: copy, movements: [], enabled: true }, []), /order/i);
  };
  check(state => { state.orders[1].orderNumber = state.orders[0].orderNumber; });
  check(state => { state.orders[1].orderNumber = "TR-2026-000000"; });
  check(state => { state.orders[1].orderNumber = "invalid"; });
  check(state => { state.orderNumberCounters = { "2026": 1 }; });
  check(state => { state.orderNumberCounters = [] as any; });
  check(state => { state.orders[1].id = state.orders[0].id; });
  validateOrderNumbers(state);
});
test("search matches number, reference, raw ID, products, vendors and locations without duplicates", () => {
  const state = searchable(), original = structuredClone(state), search = (query: string) => searchOrders(state, { ...emptyOrderFilters, query }, true, "America/Denver");
  for (const query of ["000701", "E460", "Meter", "Cleveland", "MAIN"]) assert.equal(search(query).length, 2, query);
  assert.equal(search("701").length, 2);
  assert.equal(search("0000701").length, 0, "do not convert numeric-looking SKUs");
  assert.equal(search("Landis+Gyr").length, 1);
  assert.equal(search("27491-01").length, 1);
  assert.equal(search(state.orders[1].id).length, 1);
  assert.equal(search("tr-2026-000002").length, 1);
  assert.equal(search("E460 vehicle").length, 1);
  assert.equal(search("  ").length, 2);
  assert.equal(searchOrders(state, emptyOrderFilters, false, "UTC").length, 1);
  assert.deepEqual(state, original, "search is read-only");
});
test("filters combine, creation boundaries use configured timezone, undated records sort last", () => {
  const state = searchable(), query = { ...emptyOrderFilters, type: "transfer", status: "draft", sourceId: "main", destinationId: "van",
    query: "000701 Vehicle", from: "2026-10-15", to: "2026-10-15" };
  assert.equal(orderDate("2026-10-16T01:00:00Z", "America/Denver"), "2026-10-15");
  assert.equal(searchOrders(state, query, true, "America/Denver").length, 1);
  assert.equal(searchOrders(state, query, true, "UTC").length, 0);
  assert.equal(searchOrders(state, { ...query, vendorId: "supplier" }, true, "America/Denver").length, 0);
  assert.equal(searchOrders(state, { ...query, from: "2026-10-16" }, true, "America/Denver").length, 0);
  assert.equal(searchOrders(state, { ...emptyOrderFilters, sort: "oldest" }, true, "UTC")[0].id, state.orders[0].id);
  state.orders[1].createdAt = "invalid legacy date";
  assert.equal(searchOrders(state, { ...emptyOrderFilters, sort: "oldest" }, true, "UTC")[1].id, state.orders[1].id);
  assert.equal(searchOrders(state, { ...emptyOrderFilters, from: "2026-01-01" }, true, "UTC").length, 1);
});
test("changing an external reference keeps a new editor's stable identity and creates a fresh command", () => {
  const first = orderSaveAttempt(null, "project", "", { reference: "000001" }, randomUUID);
  const edited = orderSaveAttempt(first, "project", "", { reference: "000002" }, randomUUID);
  assert.equal(first.id, edited.id);
  assert.notEqual(first.operationId, edited.operationId);
  const existing = orderSaveAttempt(null, "project", "existing-internal-id", { reference: "000003" }, randomUUID);
  assert.equal(existing.id, "existing-internal-id");
});
