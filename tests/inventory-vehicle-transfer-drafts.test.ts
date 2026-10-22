import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { emptyInventory, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import {
  vehicleTransferDraftCaptureSchema, meaningfulVehicleTransferDraft, savedVehicleTransferDraftSchema,
} from "../shared/inventory-vehicle-transfer-drafts";
import { inventoryToRelational, inventoryFromRelational } from "../server/inventoryRelationalCodec";
import { validateInventoryBackup } from "../server/inventoryBackup";

function fixture() {
  let state = emptyInventory();
  for (const [index, id] of ["from", "to"].entries())
    state = applyInventoryCommand(state, { operationId: randomUUID(), action: "warehouse", data: {
      id, code: id, name: id, type: "vehicle", userIds: ["operator"],
      vin: index ? "1HGCM82633A004353" : "1HGCM82633A004352", plate: id, plateState: "CO",
    } }, "operator", true).state;
  state = applyInventoryCommand(state, { operationId: randomUUID(), action: "item",
    data: { id: "part", sku: "PART", name: "Fitting", tracking: "regular" } }, "operator", true).state;
  state.stock = [{ warehouseId: "from", itemId: "part", quantity: 3, serials: [] }];
  const id = randomUUID();
  const capture = vehicleTransferDraftCaptureSchema.parse({ mode: "stock", sourceId: "from",
    destinationId: "to", quantities: { part: "1" }, reason: "Crews checked the physical fittings" });
  const command: InventoryCommand = { operationId: randomUUID(), action: "vehicleTransfer", data: {
    mode: "stock", sourceId: "from", destinationId: "to", revision: state.revision,
    workOrders: [], lines: [{ itemId: "part", quantity: 1, serials: [] }],
    reason: capture.reason, physicallyConfirmed: true, draftId: id, draftRevision: 1,
  } };
  state.vehicleTransferDrafts = [savedVehicleTransferDraftSchema.parse({ id, revision: 1, status: "submitting",
    createdBy: "operator", updatedBy: "operator", savedAt: new Date().toISOString(), saveId: randomUUID(),
    capture, command })];
  return { state, command };
}
test("only actual handover inputs create a draft; partial scanner and quantity input is retained", () => {
  assert.equal(meaningfulVehicleTransferDraft(vehicleTransferDraftCaptureSchema.parse({ mode: "stock" })), false);
  assert.equal(meaningfulVehicleTransferDraft(vehicleTransferDraftCaptureSchema.parse({ mode: "work" })), false);
  const capture = vehicleTransferDraftCaptureSchema.parse({ mode: "stock", quantities: { part: "1e" },
    scans: { meter: "MF00001\nMF0000" } });
  assert.equal(meaningfulVehicleTransferDraft(capture), true);
  assert.equal(capture.scans.meter, "MF00001\nMF0000");
  assert.equal(capture.quantities.part, "1e");
  assert.equal(vehicleTransferDraftCaptureSchema.safeParse({ ...capture, physicallyConfirmed: true }).success, false);
});
test("posting and hiding a shared draft is atomic and exact replay cannot duplicate stock", () => {
  const { state, command } = fixture();
  const result = applyInventoryCommand(state, command, "operator", true);
  assert.equal(state.vehicleTransferDrafts![0].status, "submitting", "input state is immutable");
  assert.equal(result.state.vehicleTransferDrafts![0].status, "posted");
  assert.equal(result.state.vehicleTransferDrafts![0].receiptId, command.operationId);
  assert.equal(result.state.stock.find(row => row.warehouseId === "from")!.quantity, 2);
  const replay = applyInventoryCommand(result.state, command, "another-authorized-worker", true);
  assert.equal(replay.replay, true);
  assert.equal(replay.state, result.state, "cross-worker recovery preserves the original posting evidence");
  assert.equal(replay.state.receipts.filter(row => row.id === command.operationId).length, 1);
});
test("edited, unlocked, deleted and superseded drafts fence late commands", () => {
  for (const status of ["editing", "deleted", "posted", "submitting"] as const) {
    const { state, command } = fixture();
    const draft = state.vehicleTransferDrafts![0];
    draft.status = status;
    if (status === "submitting" || status === "posted") draft.command!.operationId = randomUUID();
    assert.throws(() => applyInventoryCommand(state, command, "operator", true), /changed|resolved|another request/i);
    assert.equal(state.stock[0].quantity, 3);
  }
});
test("normalized storage and portable backups retain editable captures and exact pending identities", () => {
  const { state, command } = fixture();
  const tables = inventoryToRelational(state, 1);
  const restored = inventoryFromRelational(new Map([...tables].map(([name, table]) => [name, table.rows])),
    state.revision, Object.keys(state));
  assert.deepEqual(restored.vehicleTransferDrafts, state.vehicleTransferDrafts);
  const posted = applyInventoryCommand(restored, command, "operator", true).state;
  assert.doesNotThrow(() => validateInventoryBackup({ version: 1, state: posted }));
  const invalid = structuredClone(posted);
  invalid.vehicleTransferDrafts![0].command!.data.draftId = randomUUID();
  assert.throws(() => validateInventoryBackup({ version: 1, state: invalid }), /binding/i);
});
