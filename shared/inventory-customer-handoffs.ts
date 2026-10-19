import { z } from "zod";
import type { InventoryCommand, InventoryState } from "./inventory";
import { InventoryError } from "./inventory-errors";
import { warehouseRemovalDecision } from "./inventory-removal-display";

export const customerHandoffSchema = z.object({
  id: z.string().uuid(), warehouseId: z.string().min(1), recipient: z.string().trim().min(1).max(200),
  reference: z.string().trim().max(200), reason: z.string().trim().min(1).max(1000),
  verification: z.enum(["visual", "scan"]), actor: z.string().min(1), occurredAt: z.string().datetime(),
  lines: z.array(z.object({
    returnId: z.string().min(1), workOrderId: z.number().int().positive(), equipment: z.enum(["system", "module"]),
    serial: z.string().min(1), verifiedSerial: z.string().min(1), expectedOperationId: z.string().min(1),
  }).strict()).min(1).max(500),
}).strict();
export type CustomerHandoff = z.infer<typeof customerHandoffSchema>;

export function applyCustomerHandoff(state: InventoryState, command: InventoryCommand, actor: string, now: string,
  access: (warehouseId: string) => void) {
  const input = z.object({
    warehouseId: z.string().min(1), recipient: z.string().trim().min(1).max(200),
    reference: z.string().trim().max(200), reason: z.string().trim().min(1).max(1000),
    verification: z.enum(["visual", "scan"]), visuallyVerified: z.boolean(),
    entries: z.array(z.object({ id: z.string().min(1), expectedOperationId: z.string().min(1) }).strict()).min(1).max(500),
    scannedSerials: z.array(z.string().trim().min(1).max(500)).max(500),
  }).strict().parse(command.data);
  access(input.warehouseId);
  if (new Set(input.entries.map(entry => entry.id)).size !== input.entries.length)
    throw new InventoryError("Select each equipment entry only once.");
  const records = input.entries.map(entry => {
    const record = state.returns.find(record => record.id === entry.id);
    if (!record || record.status !== "customer_pending" || record.disposition !== "returned" ||
      record.warehouseId !== input.warehouseId || warehouseRemovalDecision(record)?.outcome !== "customer_return")
      throw new InventoryError("Selected equipment is no longer awaiting customer handoff at this location.");
    if (record.history?.at(-1)?.operationId !== entry.expectedOperationId)
      throw new InventoryError("Equipment custody changed. Review the selected entries before continuing.");
    if (!record.serial.trim()) throw new InventoryError("Every selected entry must have a recorded serial before handoff.");
    return { record, entry };
  });
  const serials = records.map(({ record }) => record.serial.trim());
  if (input.verification === "visual") {
    if (!input.visuallyVerified || input.scannedSerials.length)
      throw new InventoryError("Confirm visual inspection of every selected serial; visual handoffs must not contain scans.");
  } else {
    if (input.visuallyVerified || new Set(serials).size !== serials.length)
      throw new InventoryError("Scan verification requires distinct recorded serials; resolve ambiguous identities or use visual inspection.");
    const scanned = new Set(input.scannedSerials);
    if (scanned.size !== input.scannedSerials.length || scanned.size !== serials.length || serials.some(serial => !scanned.has(serial)))
      throw new InventoryError("Scan each selected serial exactly once. Missing, duplicate, or unexpected serials cannot be handed off.");
  }
  const handoff: CustomerHandoff = {
    id: command.operationId, warehouseId: input.warehouseId, recipient: input.recipient, reference: input.reference,
    reason: input.reason, verification: input.verification, actor, occurredAt: now,
    // Scan order is retained as physical verification evidence, not substituted into equipment identity.
    lines: (input.verification === "scan"
      ? input.scannedSerials.map(serial => records.find(({ record }) => record.serial.trim() === serial)!)
      : records).map(({ record, entry }) => ({
        returnId: record.id, workOrderId: record.workOrderId, equipment: record.equipment,
        serial: record.serial, verifiedSerial: input.verification === "scan" ? record.serial.trim() : record.serial,
        expectedOperationId: entry.expectedOperationId,
      })),
  };
  customerHandoffSchema.parse(handoff);
  for (const { record } of records) {
    const decision = warehouseRemovalDecision(record)!;
    record.status = "customer_returned"; record.customerHandoffId = handoff.id;
    record.customerRecipient = input.recipient; record.customerReference = input.reference;
    record.customerHandoffAt = now; record.customerHandoffBy = actor;
    record.history!.push({
      operationId: command.operationId, handoffId: handoff.id, actor, occurredAt: now, outcome: "customer_returned",
      reason: input.reason, recipient: input.recipient, reference: input.reference,
      ruleId: decision.ruleId, ruleRevision: decision.ruleRevision, ruleName: decision.ruleName,
    });
  }
  (state.customerHandoffs ??= []).push(handoff);
}

export function validateCustomerHandoffs(state: InventoryState) {
  const handoffs = z.array(customerHandoffSchema).parse(state.customerHandoffs ?? []);
  const ids = new Set<string>(), returnedIds = new Set<string>();
  for (const handoff of handoffs) {
    if (ids.has(handoff.id) || !state.warehouses.some(warehouse => warehouse.id === handoff.warehouseId))
      throw new Error("Customer handoff has a duplicate identity or missing location.");
    ids.add(handoff.id);
    const scans = new Set<string>();
    for (const line of handoff.lines) {
      const record = state.returns.find(record => record.id === line.returnId);
      const event = record?.history?.at(-1), prior = record?.history?.at(-2);
      if (returnedIds.has(line.returnId) || !record || record.customerHandoffId !== handoff.id ||
        record.status !== "customer_returned" || record.warehouseId !== handoff.warehouseId ||
        record.serial !== line.serial || record.equipment !== line.equipment || record.workOrderId !== line.workOrderId ||
        line.verifiedSerial !== (handoff.verification === "scan" ? line.serial.trim() : line.serial) ||
        event?.handoffId !== handoff.id || event.operationId !== handoff.id || event.outcome !== "customer_returned" ||
        event.actor !== handoff.actor || event.occurredAt !== handoff.occurredAt ||
        event.recipient !== handoff.recipient || event.reference !== handoff.reference || event.reason !== handoff.reason ||
        prior?.operationId !== line.expectedOperationId || record.customerHandoffBy !== handoff.actor ||
        record.customerHandoffAt !== handoff.occurredAt || record.customerRecipient !== handoff.recipient ||
        record.customerReference !== handoff.reference)
        throw new Error("Customer handoff verification or custody evidence is inconsistent.");
      if (handoff.verification === "scan" && scans.has(line.verifiedSerial))
        throw new Error("Customer handoff contains duplicate scans.");
      scans.add(line.verifiedSerial); returnedIds.add(line.returnId);
    }
  }
  if (state.returns.some(record => record.customerHandoffId && !returnedIds.has(record.id)))
    throw new Error("Equipment references a missing customer handoff.");
}
