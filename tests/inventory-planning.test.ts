import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryState, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder, reserved } from "../shared/inventory-engine";
import { effectivePlannedLines } from "../shared/inventory-planning";
import { initialActualUse, actualUseLinesAreValid } from "../shared/inventory-wizard-use";
import { inventoryFromRelational, inventoryToRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";

const post = (state: InventoryState, action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) =>
  applyInventoryCommand(state, { action, data, operationId }, "fixture", true).state;
function setup() {
  let state = emptyInventory();
  for (const id of ["main", "stage"]) state = post(state, "warehouse", { id, code: id, name: id, type: "physical", address: "Owned test location" });
  state = post(state, "vendor", { id: "vendor", name: "Test vendor" });
  state = post(state, "item", { id: "meter", sku: "meter", name: "Meter", tracking: "serialized", equipment: "system" });
  state = post(state, "item", { id: "part", sku: "part", name: "Part", tracking: "regular" });
  state = post(state, "order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main",
    lines: [{ itemId: "meter", quantity: 4 }, { itemId: "part", quantity: 10 }] });
  state = post(state, "release", { orderId: "po" });
  return post(state, "receive", { orderId: "po", lines: [
    { itemId: "meter", quantity: 4, serials: ["A", "B", "C", "D"] }, { itemId: "part", quantity: 10 },
  ] });
}
const quantityHold = { itemId: "meter", warehouseId: "main", quantity: 2, serials: [], reservationMode: "quantity" };

test("manual plans have provenance/revisions and do not reserve or deduct stock", () => {
  const before = setup();
  const lines = [{ id: randomUUID(), itemId: "part", quantity: 100, kind: "addition", reason: "" },
    { id: randomUUID(), itemId: "meter", quantity: 0, kind: "override", reason: "Customer does not require this replacement" }];
  const state = post(before, "plan", { workOrderId: 1, revision: 0, lines });
  assert.deepEqual(state.stock, before.stock);
  assert.equal(reserved(state, "main", "part"), 0);
  assert.deepEqual(effectivePlannedLines([{ itemId: "meter", quantity: 1 }], state.workPlans![0].lines),
    [{ itemId: "part", quantity: 100 }]);
  assert.throws(() => post(state, "plan", { workOrderId: 1, revision: 0, lines: [] }), /Planned items changed/);
  assert.equal(state.workPlans![0].lines.length, 2);
  assert.deepEqual(effectivePlannedLines([], state.workPlans![0].lines), [{ itemId: "part", quantity: 100 }],
    "Old type overrides cannot resurrect obsolete mapped equipment");
});

test("quantity and exact serial holds share capacity without choosing installed serials", () => {
  let state = post(setup(), "assign", { workOrderId: 1, lines: [quantityHold] });
  assert.equal(state.stock.find(line => line.itemId === "meter")!.quantity, 4);
  assert.deepEqual(state.allocations[0].lines[0].serials, []);
  assert.throws(() => post(state, "assign", { workOrderId: 2, lines: [
    { ...quantityHold, reservationMode: "serial", quantity: 3, serials: ["B", "C", "D"] },
  ] }), /Insufficient available stock/);
  state = post(state, "assign", { workOrderId: 2, lines: [
    { ...quantityHold, reservationMode: "serial", quantity: 1, serials: ["C"] },
  ] });
  assert.throws(() => post(state, "assign", { workOrderId: 3, lines: [{ ...quantityHold, quantity: 2 }] }), /Insufficient/);
  assert.throws(() => post(state, "assign", { workOrderId: 1, revision: 0, lines: [] }), /Reservations changed/);
  const drafts = initialActualUse(state.allocations[0], [{ itemId: "meter", quantity: 1 }], state.items);
  assert.equal(drafts.length, 1);
  const captured = drafts.map(line => ({ ...line, quantity: "1", serials: "B" }));
  assert.equal(actualUseLinesAreValid(captured, state.items), true);
});

test("physical staging moves custody, relocates holds, prints a receipt and is idempotent", () => {
  let state = post(setup(), "assign", { workOrderId: 1, lines: [quantityHold] });
  state = post(state, "plan", { workOrderId: 1, revision: 0,
    lines: [{ id: randomUUID(), itemId: "part", quantity: 100, kind: "addition", reason: "Optional extra fittings" }] });
  state.workRequirements = [{ workOrderId: 1, lines: [{ itemId: "meter", quantity: 1 }, { itemId: "part", quantity: 100 }],
    automaticLines: [{ itemId: "meter", quantity: 1 }], missing: [] }];
  const command: InventoryCommand = { operationId: randomUUID(), action: "stageWorkOrder", data: {
    workOrderId: 1, revision: 1, sourceId: "main", destinationId: "stage",
    lines: [{ itemId: "meter", quantity: 2, serials: ["A", "B"] }], reason: "Pulled and counted for the assigned installer", physicallyConfirmed: true,
  } };
  state = applyInventoryCommand(state, command, "fixture", true).state;
  assert.equal(state.stock.find(line => line.warehouseId === "main" && line.itemId === "meter")!.quantity, 2);
  assert.equal(state.stock.find(line => line.warehouseId === "stage" && line.itemId === "meter")!.quantity, 2);
  assert.equal(reserved(state, "main", "meter"), 0);
  assert.equal(reserved(state, "stage", "meter"), 2);
  assert.deepEqual(state.allocations[0].lines[0].serials, [], "Custody serials are not installed-serial reservations");
  assert.equal(state.allocations[0].status, "reserved");
  assert.equal(state.serialOccupancy?.some(record => record.workOrderId === 1), false);
  assert.equal(state.receipts.at(-1)!.action, "stageWorkOrder");
  assert.equal(applyInventoryCommand(state, command, "fixture", true).replay, true);
  assert.throws(() => post(state, "stageWorkOrder", { ...command.data, revision: 1 }), /Reservations changed/);
  state = post(state, "prepareUse", { workOrderId: 1, revision: state.allocations[0].revision, mode: "changeout",
    used: [{ itemId: "meter", warehouseId: "stage", quantity: 1, serials: ["B"] }], dispositions: [] });
  state = completeInventoryWorkOrder(state, 1, false, "fixture");
  assert.equal(state.stock.find(line => line.warehouseId === "stage" && line.itemId === "meter")!.quantity, 1);
  assert.equal(reserved(state, "stage", "meter"), 0, "Unused staged stock is not consumed or left reserved");
  assert.equal(state.stock.find(line => line.warehouseId === "main" && line.itemId === "part")!.quantity, 10,
    "Planned extras that were not used are never consumed");
});

test("relational snapshots round-trip manual plans and quantity reservation metadata", () => {
  let state = post(setup(), "plan", { workOrderId: 1, revision: 0,
    lines: [{ id: randomUUID(), itemId: "part", quantity: 2, kind: "addition", reason: "Extra fittings" }] });
  state = post(state, "assign", { workOrderId: 1, lines: [quantityHold] });
  const tables = inventoryToRelational(state, 7);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])), state.revision, Object.keys(state));
  assert.deepEqual(restored.workPlans, state.workPlans);
  assert.deepEqual(restored.allocations, state.allocations);
  assert.equal(tables.get("inventory_work_plan_lines")!.rows[0].item_id, "part");
  validateInventoryBackup({ enabled: true, state: JSON.parse(JSON.stringify(restored)), movements: [] }, [1]);
});
