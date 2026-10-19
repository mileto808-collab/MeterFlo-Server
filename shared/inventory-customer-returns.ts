import { z } from "zod";
import type { InventoryCommand, InventoryState, StockLine } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { warehouseRemovalDecision } from "./inventory-removal-display";

/** Physical handoff and corrections never infer intent from a note or a renamed rule. */
export function applyCustomerReturnCommand(state: InventoryState, command: InventoryCommand, actor: string, now: string,
  access: (warehouseId: string) => void, changeStock: (warehouseId: string, lines: StockLine[], direction: 1 | -1) => void,
  receipt: (reference: string, warehouseId: string | null, lines: StockLine[], reason?: string) => void) {
  const base = z.object({ id: z.string().min(1), expectedOperationId: z.string().min(1), reason: z.string().trim().min(1).max(1000) });
  const input = command.action === "returnCustomerHandoff" ? base.extend({
    recipient: z.string().trim().min(1).max(200), reference: z.string().trim().max(200),
  }).strict().parse(command.data) : base.extend({ physicallyPresent: z.literal(true) }).strict().parse(command.data);
  const record = state.returns.find(record => record.id === input.id);
  if (!record || record.disposition !== "returned" || !record.warehouseId) throw new InventoryError("Warehouse return not found.");
  access(record.warehouseId);
  if (record.history?.at(-1)?.operationId !== input.expectedOperationId)
    throw new InventoryError("Equipment custody changed. Review the current entry before continuing.");
  if (command.action === "returnCustomerHandoff") {
    if (record.status !== "customer_pending") throw new InventoryError("Equipment must be awaiting customer handoff.");
    const handoff = input as typeof input & { recipient: string; reference: string };
    const decision = warehouseRemovalDecision(record);
    if (decision?.outcome !== "customer_return") throw new InventoryError("Record a return-to-customer warehouse decision before handoff.");
    record.status = "customer_returned";
    record.customerRecipient = handoff.recipient; record.customerReference = handoff.reference;
    record.customerHandoffAt = now; record.customerHandoffBy = actor;
    record.history!.push({ operationId: command.operationId, actor, occurredAt: now, outcome: "customer_returned",
      reason: input.reason, recipient: handoff.recipient, reference: handoff.reference,
      ruleId: decision?.ruleId, ruleRevision: decision?.ruleRevision, ruleName: decision?.ruleName });
    receipt(record.id, record.warehouseId, [], input.reason);
  } else {
    if (!["released", "scrapped", "customer_pending"].includes(record.status))
      throw new InventoryError("Only a warehouse decision for equipment still physically present can be corrected.");
    const previousStatus = record.status, lines: StockLine[] = [];
    if (record.status === "released") {
      const item = state.items.find(item => item.id === record.itemId);
      if (!item) throw new InventoryError("Released inventory item is unavailable.");
      lines.push({ itemId: item.id, quantity: 1, serials: item.tracking === "serialized" ? [record.serial] : [] });
      // Existing stock movement checks enforce available quantity, serial custody and reservations.
      changeStock(record.warehouseId, lines, -1);
    }
    record.status = "quarantine"; delete record.itemId;
    delete record.customerRecipient; delete record.customerReference;
    delete record.customerHandoffAt; delete record.customerHandoffBy;
    record.history!.push({ operationId: command.operationId, actor, occurredAt: now, outcome: "decision_corrected",
      previousStatus, reason: input.reason, physicallyPresent: true });
    receipt(record.id, record.warehouseId, lines, input.reason);
  }
}
