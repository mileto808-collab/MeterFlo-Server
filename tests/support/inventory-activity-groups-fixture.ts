import { receiptIdentifierFixture } from "./inventory-receipt-identifiers-fixture";

export function activityBatchFixture(verification: "scan" | "visual" = "scan") {
  const fixture = receiptIdentifierFixture();
  const { state } = fixture;
  const handoffId = "10000000-0000-4000-8000-000000000001";
  // Distinct physical equipment, verified together in one recorded customer handoff.
  state.returns[1].serial = "OLD002";
  state.returns.forEach((record, index) => {
    record.status = "customer_returned";
    record.customerHandoffId = handoffId;
    record.history?.push({ operationId: handoffId, actor: "fixture", occurredAt: "2026-10-19T04:00:00Z",
      outcome: "customer_returned", reason: "Customer collection", recipient: "Fixture customer",
      handoffId, reference: "SHIP-001" });
  });
  fixture.identifiers["196"].equipmentIds = ["OLD002"];
  state.customerHandoffs = [{ id: handoffId, warehouseId: "main", recipient: "Fixture customer",
    reference: "SHIP-001", reason: "Collected together", verification, actor: "fixture", occurredAt: "2026-10-19T04:00:00Z",
    lines: state.returns.map(record => ({ returnId: record.id, workOrderId: record.workOrderId, equipment: record.equipment,
      serial: record.serial, verifiedSerial: record.serial, expectedOperationId: record.history!.at(-2)!.operationId })) }];
  state.receipts.push({ id: handoffId, action: "returnCustomerBatch", reference: handoffId,
    actor: "fixture", occurredAt: "2026-10-19T04:00:00Z", warehouseId: "main", lines: [], reason: "Collected together" });
  return fixture;
}
