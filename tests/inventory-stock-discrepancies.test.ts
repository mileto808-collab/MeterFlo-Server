import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, commandPermission, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { inventoryWizardBasis } from "../shared/inventory-wizard-use";
import { validateInventoryBackup } from "../server/inventoryBackup";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { inventoryActivityGroups } from "../shared/inventory-activity-groups";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(state, { action, data, operationId }, "warehouse", true).state;
function setup(tracking = "regular") {
  let state = emptyInventory();
  state = post(state, "warehouse", { id: "main", code: "MAIN", name: "Main", type: "physical", address: "Fixture" });
  state = post(state, "warehouse", { id: "other", code: "OTHER", name: "Other", type: "physical", address: "Fixture" });
  state = post(state, "vendor", { id: "vendor", name: "Vendor" });
  return post(state, "item", { id: "item", sku: "PART", name: "Field part", tracking });
}
function receive(state: InventoryState, quantity: number, serials: string[] = []) {
  const id = randomUUID();
  state = post(state, "order", { id, type: "purchase", vendorId: "vendor", destinationId: "main", lines: [{ itemId: "item", quantity }] });
  state = post(state, "release", { orderId: id });
  return post(state, "receive", { orderId: id, lines: [{ itemId: "item", quantity, serials }] });
}
function prepare(state: InventoryState, workOrderId = 1, quantity = 1, serials: string[] = []) {
  return post(state, "prepareUse", { workOrderId, revision: 0, mode: "changeout",
    used: [{ itemId: "item", warehouseId: "main", quantity, serials }], dispositions: [] });
}
const finish = (state: InventoryState, workOrderId = 1) => completeInventoryWorkOrder(state, workOrderId, false, "tech");
const resolution = (state: InventoryState, method: "apply_stock" | "documented_adjustment", receiptIds: string[] = []) => ({
  id: state.stockDiscrepancies![0].id, method, receiptIds,
  reason: "Verified the missing field-stock transaction.", evidence: "Investigation DOC-001",
});

test("shortage completion records full actual use, debits only available stock and preserves reservations", () => {
  let state = receive(setup(), 2);
  state = post(state, "assign", { workOrderId: 2, lines: [{ itemId: "item", warehouseId: "main", quantity: 1 }] });
  state = finish(prepare(state, 1, 5));
  assert.equal(state.stock.find(value => value.itemId === "item")!.quantity, 1);
  assert.equal(state.allocations.find(value => value.workOrderId === 1)!.used[0].quantity, 5);
  assert.equal(state.allocations.find(value => value.workOrderId === 2)!.lines[0].quantity, 1);
  assert.equal(state.stockDiscrepancies![0].quantity, 4);
  assert.equal(state.stockDiscrepancies![0].recordedAvailable, 1);
  assert.equal(state.stockDiscrepancies![0].actor, "tech");
  assert.equal(finish(state), state, "Completion replay never creates another debit or discrepancy");
  assert.throws(() => post(state, "reconcileWorkOrder", { workOrderId: 1, reason: "Reverse use" }), /Resolve.*discrepancies/);
});

test("warehouse receiving between prepare and completion is accepted without a project revision conflict", () => {
  let state = prepare(setup());
  const basis = inventoryWizardBasis({ revision: state.revision });
  state = receive(state, 1);
  assert.equal(inventoryWizardBasis({ revision: state.revision }), basis);
  state = finish(state);
  assert.equal(state.stock[0].quantity, 0);
  assert.equal(state.stockDiscrepancies?.length ?? 0, 0);
  assert.notEqual(inventoryWizardBasis({ revision: state.revision, allocation: state.allocations[0] }), basis,
    "An actual work-order allocation change still requires review");
});

test("two concurrent field intents cannot overdraw stock; the later completion records the pending debit", () => {
  let state = receive(setup(), 1);
  state = prepare(prepare(state), 2);
  state = finish(finish(state), 2);
  assert.equal(state.stock[0].quantity, 0);
  assert.equal(state.stockDiscrepancies!.length, 1);
  assert.equal(state.stockDiscrepancies![0].workOrderId, 2);
});

test("applying corrected stock settles only the pending quantity and retries cannot debit twice", () => {
  let state = finish(prepare(receive(setup(), 2), 1, 5));
  assert.equal(state.stockDiscrepancies![0].quantity, 3);
  assert.throws(() => post(state, "resolveStockDiscrepancy", resolution(state, "apply_stock")), /Link the receipt/);
  state = receive(state, 5);
  const receiptId = state.receipts.at(-1)!.id, operationId = randomUUID();
  const data = resolution(state, "apply_stock", [receiptId]);
  state = post(state, "resolveStockDiscrepancy", data, operationId);
  assert.equal(state.stock[0].quantity, 2, "Only the previously undebited three units are posted");
  assert.equal(state.stockDiscrepancies![0].status, "resolved");
  assert.equal(state.stockDiscrepancies![0].resolvedBy, "warehouse");
  assert.deepEqual(post(state, "resolveStockDiscrepancy", data, operationId), state);
  assert.throws(() => post(state, "resolveStockDiscrepancy", data), /already resolved/);
  assert.equal(inventoryActivityGroups(state).find(value => value.receipts.some(receipt => receipt.id === operationId))!.receipts.length, 2);
});

test("documented adjustment requires evidence and creates no stock, fabricated receipt, or duplicate usage", () => {
  let state = finish(prepare(setup(), 1, 3));
  const stock = structuredClone(state.stock);
  assert.throws(() => post(state, "resolveStockDiscrepancy", { ...resolution(state, "documented_adjustment"), evidence: "" }));
  state = post(state, "resolveStockDiscrepancy", resolution(state, "documented_adjustment"));
  assert.deepEqual(state.stock, stock);
  assert.equal(state.allocations[0].used[0].quantity, 3);
  assert.equal(state.orders.length, 0);
  assert.equal(state.receipts.at(-1)!.action, "resolveStockDiscrepancy");
  assert.match(state.receipts.at(-1)!.reason!, /no available stock created/);
  assert.equal(commandPermission("resolveStockDiscrepancy"), "inventory.resolveExceptions");
});

test("unrecorded serials become installed occupancy and a second work order cannot claim them", () => {
  let state = finish(prepare(setup("serialized"), 1, 1, ["NEW-001"]));
  assert.equal(state.stockDiscrepancies![0].serials[0], "NEW-001");
  assert.equal(state.serialOccupancy!.find(value => value.serial === "NEW-001")!.workOrderId, 1);
  assert.throws(() => prepare(state, 2, 1, ["NEW-001"]), /Scanned serial/);
  assert.throws(() => receive(state, 1, ["NEW-001"]), /already installed/);
  state = post(state, "resolveStockDiscrepancy", resolution(state, "documented_adjustment"));
  assert.equal(state.serialOccupancy!.find(value => value.serial === "NEW-001")!.workOrderId, 1);
});

test("resolved discrepancy evidence remains valid after an authorized usage reversal", () => {
  let state = finish(prepare(setup(), 1, 3));
  state = post(state, "resolveStockDiscrepancy", resolution(state, "documented_adjustment"));
  state = post(state, "reconcileWorkOrder", { workOrderId: 1, reason: "Verified physical usage reversal.", restoreUsedStock: true });
  assert.equal(state.allocations[0].used.length, 0);
  assert.equal(state.stock[0].quantity, 3);
  validateInventoryBackup({ state, enabled: true, movements: [] }, [1]);
  assert.equal(state.stockDiscrepancies![0].status, "resolved", "Historical review evidence is retained");
});

test("serial reservations, foreign locations, holds and repeated input remain hard conflicts", () => {
  let state = receive(setup("serialized"), 1, ["KNOWN"]);
  state = post(state, "assign", { workOrderId: 2, lines: [{ itemId: "item", warehouseId: "main", quantity: 1, serials: ["KNOWN"] }] });
  assert.throws(() => prepare(state, 1, 1, ["KNOWN"]), /Scanned serial/);
  state = setup("serialized");
  assert.throws(() => post(state, "prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", dispositions: [],
    used: ["main", "other"].map(warehouseId => ({ itemId: "item", warehouseId, quantity: 1, serials: ["DUP"] })) }), /same serial/);
});

test("open and resolved discrepancies round-trip through relational storage and portable backup validation", () => {
  let state = finish(prepare(setup("serialized"), 1, 1, ["EXTERNAL"]));
  for (const resolved of [false, true]) {
    if (resolved) state = post(state, "resolveStockDiscrepancy", resolution(state, "documented_adjustment"));
    validateInventoryBackup({ state, enabled: true, movements: [] }, [1]);
    const tables = inventoryToRelational(state, 1);
    const hydrated = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])),
      state.revision, Object.keys(state));
    assert.deepEqual(hydrated.stockDiscrepancies, state.stockDiscrepancies);
    const invalid = structuredClone(state);
    invalid.stockDiscrepancies![0].quantity++;
    assert.throws(() => validateInventoryBackup({ state: invalid, enabled: true, movements: [] }, [1]), /discrepancy/);
  }
});
