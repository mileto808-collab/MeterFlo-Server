import { emptyInventory, warehouseSchema } from "../../shared/inventory";
import type { InventoryWorkOrderIdentifiers } from "../../shared/inventory-work-order-labels";

export function receiptIdentifierFixture() {
  const state = emptyInventory();
  state.warehouses = [warehouseSchema.parse({ id: "main", code: "MAIN", name: "Main warehouse", type: "physical", address: "1 Fixture Way" })];
  state.returns = [
    { id: "wo-195-system-1", workOrderId: 195, equipment: "system", serial: "OLD001", disposition: "returned",
      warehouseId: "main", status: "customer_pending", history: [
        { operationId: "capture-195", actor: "fixture", occurredAt: "2026-10-19T03:00:00Z", outcome: "returned" },
        { operationId: "accept-195", actor: "fixture", occurredAt: "2026-10-19T03:05:00Z", outcome: "quarantine" },
        { operationId: "decide-195", actor: "fixture", occurredAt: "2026-10-19T03:10:00Z", outcome: "customer_return" },
      ] },
    { id: "wo-196-system-1", workOrderId: 196, equipment: "system", serial: "OLD001", disposition: "returned",
      warehouseId: "main", status: "pending", history: [
        { operationId: "capture-196", actor: "fixture", occurredAt: "2026-10-19T03:15:00Z", outcome: "returned" },
      ] },
  ];
  state.receipts = [
    { id: "capture-195", action: "complete", reference: "work-order-195" },
    { id: "accept-195", action: "returnAccept", reference: "wo-195-system-1" },
    { id: "decide-195", action: "returnDecide", reference: "wo-195-system-1" },
    { id: "capture-196", action: "complete", reference: "wo-196-system-1" },
    { id: "unrelated", action: "receive", reference: "other-operation", reason: "Mentioning 195 and OLD001 does not create a relationship." },
  ].map((receipt, index) => ({ ...receipt, lines: [], actor: "fixture", warehouseId: "main",
    occurredAt: `2026-10-19T03:${String(index * 5).padStart(2, "0")}:00Z` }));
  const labels = { "195": "0002048", "196": "196" };
  const identifiers: InventoryWorkOrderIdentifiers = {
    "195": { customerWoId: "0002048", equipmentIds: ["OLD001", "NEW001", "OLD-MODULE", "NEW-MODULE"] },
    "196": { customerWoId: "", equipmentIds: ["OLD001"] },
  };
  return { state, labels, identifiers };
}
