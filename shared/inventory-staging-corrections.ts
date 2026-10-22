import { z } from "zod";
import type { InventoryState, StockLine } from "./inventory";
import { InventoryError } from "./inventory-errors";

const id = z.string().min(1).max(100);
const reason = z.string().trim().min(10).max(1000);
export const stagedIssueSchema = z.object({
  id, itemId: id, category: z.enum(["wrong_serial", "wrong_item", "quantity", "missing", "other"]),
  description: reason, status: z.enum(["open", "investigating", "resolved"]),
  reportedBy: id, reportedAt: z.string().datetime(), quantity: z.number().int().positive().optional(),
  serials: z.array(z.string()).optional(), resolvedBy: id.optional(), resolvedAt: z.string().datetime().optional(),
  resolution: z.string().max(2000).optional(),
}).strict();
export type StagedIssue = z.infer<typeof stagedIssueSchema>;
const base = z.object({ id: z.string().uuid(), revision: z.number().int().positive() });
export const fulfillmentIssueSchema = base.extend({
  itemId: id, category: stagedIssueSchema.shape.category, description: reason,
}).strict();
const counted = z.object({ itemId: id, quantity: z.number().int().min(0).max(1000000),
  serials: z.array(z.string().trim().min(1).max(100)).max(10000) }).strict();
export const fulfillmentCorrectSchema = base.extend({
  mode: z.enum(["recording", "exchange", "missing"]), reason,
  // Full snapshot of the stock that will remain waiting for this batch, excluding delivered units.
  lines: z.array(counted).min(1).max(500),
  observedReturns: z.array(counted).max(500).default([]),
  confirmed: z.literal(true), sourceVerified: z.literal(true), ready: z.boolean(),
}).strict();
export const fulfillmentInvestigateSchema = base.extend({
  issueId: id, outcome: z.enum(["found", "written_off"]), warehouseId: id.optional(),
  reason, confirmed: z.literal(true),
}).strict();
export type StagingCorrectionEvidence = {
  mode: "recording" | "exchange" | "missing"; before: z.infer<typeof counted>[];
  after: z.infer<typeof counted>[]; observedReturns: z.infer<typeof counted>[];
};
export const pickupNeedsReview = (batch: { issues?: StagedIssue[] }) => batch.issues?.some(issue => issue.status === "open") ?? false;
const ensure: (ok: unknown, message: string) => asserts ok = (ok, message) => {
  if (!ok) throw new InventoryError(message);
};
type Tools = {
  access(id: string): unknown;
  move(warehouse: string, lines: StockLine[], sign: 1 | -1, transitId: string, kind?: "missing" | "recovered"): void;
  receipt(reference: string, warehouse: string, lines: StockLine[], reason: string): void;
};
export function applyStagingCorrection(state: InventoryState, action: string, data: Record<string, unknown>,
  operationId: string, actor: string, now: string, tools: Tools) {
  const input = action === "fulfillmentIssue" ? fulfillmentIssueSchema.parse(data) :
    action === "fulfillmentInvestigate" ? fulfillmentInvestigateSchema.parse(data) : fulfillmentCorrectSchema.parse(data);
  const batch = state.fulfillmentBatches?.find(row => row.id === input.id);
  ensure(batch, "Fulfillment batch not found.");
  ensure(batch.revision === input.revision, "This batch changed. Refresh and review its current stock; no correction was posted.");
  batch.issues ??= [];
  if (action === "fulfillmentIssue") {
    ensure(batch.issues.length < 1000, "This batch has reached its issue-history limit. Ask an administrator to review it.");
    const report = fulfillmentIssueSchema.parse(data);
    ensure(batch.status === "active" && batch.lines.some(line => line.stagedQuantity > line.deliveredQuantity),
      "Only stock still waiting at staging can be reported here. Handed-off stock needs a vehicle return or transfer.");
    const vehicle = state.warehouses.find(row => row.id === batch.vehicleId && row.active);
    ensure(vehicle?.type === "vehicle" && (vehicle.assignedUserId === actor || vehicle.userIds.includes(actor)),
      "Only a current assignee of this vehicle can report a pickup problem.");
    ensure(batch.lines.some(line => line.itemId === report.itemId), "Choose an item from this pickup.");
    batch.issues.push({ id: operationId, itemId: report.itemId, category: report.category,
      description: report.description, status: "open", reportedBy: actor, reportedAt: now });
    batch.revision++;
    tools.receipt(batch.id, batch.stagingId, [], `Pickup needs review · ${batch.name} · ${report.description}`);
    return;
  }
  tools.access(batch.sourceId); tools.access(batch.stagingId);
  if (action === "fulfillmentInvestigate") {
    const resolution = fulfillmentInvestigateSchema.parse(data);
    const issue = batch.issues.find(row => row.id === resolution.issueId && row.status === "investigating");
    ensure(issue?.quantity, "Choose an outstanding missing-stock investigation.");
    if (resolution.outcome === "found") {
      ensure(resolution.warehouseId, "Choose the verified physical recovery location.");
      tools.access(resolution.warehouseId);
      const location = state.warehouses.find(row => row.id === resolution.warehouseId);
      ensure(location?.type === "physical", "Recover stock to a physical warehouse; then use normal staging or transfer.");
      const serials = issue.serials ?? [];
      for (const serial of serials) {
        ensure(state.serialOccupancy?.some(row => row.itemId === issue.itemId && row.serial === serial && row.workOrderId === null),
          "Missing-serial evidence changed. Ask an inventory manager to investigate before recovery.");
      }
      state.serialOccupancy = state.serialOccupancy?.filter(row =>
        !(row.itemId === issue.itemId && row.workOrderId === null && serials.includes(row.serial)));
      tools.move(resolution.warehouseId, [{ itemId: issue.itemId, quantity: issue.quantity, serials }], 1, issue.id.split(":")[0], "recovered");
    }
    issue.status = "resolved"; issue.resolvedBy = actor; issue.resolvedAt = now;
    issue.resolution = `${resolution.outcome === "found" ? "Found and recovered to verified warehouse" : "Written off; no stock added"} · ${resolution.reason}`;
    batch.revision++;
    tools.receipt(batch.id, resolution.warehouseId ?? batch.stagingId,
      resolution.outcome === "found" ? [{ itemId: issue.itemId, quantity: issue.quantity, serials: issue.serials ?? [] }] : [],
      `Missing-stock investigation resolved · ${issue.resolution}`);
    return;
  }
  const correction = fulfillmentCorrectSchema.parse(data);
  ensure(batch.status === "active", "Only an active batch's unhanded-off stock can be corrected.");
  const itemIds = [...new Set(batch.lines.map(line => line.itemId))];
  ensure(new Set(correction.lines.map(line => line.itemId)).size === itemIds.length &&
    correction.lines.length === itemIds.length && correction.lines.every(line => itemIds.includes(line.itemId)),
  "Review every required item once. Substitutions require an authorized work-order requirement change.");
  ensure(correction.mode === "exchange" || correction.observedReturns.length === 0,
    "Only a confirmed physical exchange can include physically returned unexpected stock.");
  const before = itemIds.map(itemId => {
    const rows = batch.lines.filter(line => line.itemId === itemId);
    return { itemId, quantity: rows.reduce((sum, row) => sum + row.stagedQuantity - row.deliveredQuantity, 0),
      serials: rows.flatMap(row => row.stagedSerials.filter(serial => !row.deliveredSerials.includes(serial))) };
  });
  const deltas = correction.lines.map(after => {
    const prior = before.find(row => row.itemId === after.itemId)!;
    const item = state.items.find(row => row.id === after.itemId && row.active && row.kind !== "labor");
    ensure(item, "A required item is inactive. Review the work-order requirements before correcting stock.");
    const maximum = batch.lines.filter(row => row.itemId === after.itemId).reduce((sum, row) => sum + row.quantity - row.deliveredQuantity, 0);
    ensure(after.quantity <= maximum, "Corrected staging quantity cannot exceed this batch's remaining requirements.");
    ensure(item.tracking === "serialized" ? after.serials.length === after.quantity &&
      new Set(after.serials).size === after.serials.length : after.serials.length === 0,
    "Enter exactly one unique serial per serialized unit; quantity-tracked items have no serials.");
    ensure(after.serials.every(serial => !batch.lines.some(row => row.itemId === after.itemId && row.deliveredSerials.includes(serial))),
      "A corrected serial was already handed to the vehicle. Leave delivered units unchanged; use a vehicle return or transfer instead.");
    const removed = item.tracking === "serialized" ? prior.serials.filter(serial => !after.serials.includes(serial)) : [];
    const added = item.tracking === "serialized" ? after.serials.filter(serial => !prior.serials.includes(serial)) : [];
    const removeQty = item.tracking === "serialized" ? removed.length : Math.max(0, prior.quantity - after.quantity);
    const addQty = item.tracking === "serialized" ? added.length : Math.max(0, after.quantity - prior.quantity);
    ensure(correction.mode !== "missing" || addQty === 0, "Missing-stock corrections can only remove unlocated units. Record verified replacements separately.");
    return { itemId: after.itemId, removeQty, addQty, removed, added };
  });
  const changed = deltas.some(row => row.removeQty || row.addQty);
  const verificationOnly = !changed && correction.mode === "recording" && pickupNeedsReview(batch);
  ensure(changed || verificationOnly || correction.mode === "exchange" &&
    correction.observedReturns.some(row => row.quantity > 0),
  "Nothing changed. Review the actual quantities/serials, or identify the unexpected stock you physically returned.");
  ensure(correction.mode !== "missing" || batch.issues.length + deltas.filter(row => row.removeQty > 0).length <= 1000,
    "This correction would exceed the batch's issue-history limit. Ask an administrator to review it.");
  // Release ONLY this batch's undelivered holds while applying its correction. Other custody stays protected.
  for (const line of batch.lines) if (batch.mode === "scheduled") {
    const allocation = state.allocations.find(row => row.workOrderId === line.workOrderId && row.status === "reserved");
    const hold = allocation?.lines.find(row => row.warehouseId === batch.stagingId && row.itemId === line.itemId);
    const waiting = line.stagedQuantity - line.deliveredQuantity;
    ensure(!waiting || hold && hold.quantity >= waiting, "This batch's staging reservation changed. Review inventory before correcting it.");
    if (hold && waiting) {
      hold.quantity -= waiting;
      hold.serials = hold.serials.filter(serial => !line.stagedSerials.includes(serial) || line.deliveredSerials.includes(serial));
      allocation!.lines = allocation!.lines.filter(row => row.quantity > 0); allocation!.revision++;
    }
  }
  batch.status = "cancelled"; // excludes only its crew hold; restored before publishing the transaction
  for (const delta of deltas) {
    if (delta.removeQty) {
      const part = { itemId: delta.itemId, quantity: delta.removeQty, serials: delta.removed };
      tools.move(batch.stagingId, [part], -1, operationId, correction.mode === "missing" ? "missing" : undefined);
      if (correction.mode === "missing") {
        state.serialOccupancy ??= [];
        state.serialOccupancy.push(...delta.removed.map(serial => ({ itemId: delta.itemId, serial, workOrderId: null })));
        batch.issues.push({ id: `${operationId}:${deltas.indexOf(delta)}`, itemId: delta.itemId, category: "missing",
          description: correction.reason, status: "investigating", quantity: delta.removeQty, serials: delta.removed,
          reportedBy: actor, reportedAt: now });
      } else tools.move(batch.sourceId, [part], 1, operationId);
    }
    if (delta.addQty) {
      const part = { itemId: delta.itemId, quantity: delta.addQty, serials: delta.added };
      tools.move(batch.sourceId, [part], -1, operationId); tools.move(batch.stagingId, [part], 1, operationId);
    }
  }
  ensure(new Set(correction.observedReturns.map(row => row.itemId)).size === correction.observedReturns.length,
    "Combine unexpected returned stock by item.");
  for (const returned of correction.observedReturns) {
    const item = state.items.find(row => row.id === returned.itemId && row.active && row.kind !== "labor");
    const atSource = state.stock.find(row => row.itemId === returned.itemId && row.warehouseId === batch.sourceId);
    ensure(item && returned.quantity > 0 && atSource && atSource.quantity >= returned.quantity &&
      (item.tracking === "serialized" ? returned.serials.length === returned.quantity &&
        new Set(returned.serials).size === returned.serials.length && returned.serials.every(serial => atSource.serials.includes(serial))
        : returned.serials.length === 0),
    "Unexpected returned stock must be verified at the original source after the exchange. Stock recorded elsewhere needs a separate transfer/discrepancy review; it cannot be credited twice.");
  }
  for (const after of correction.lines) {
    let quantity = after.quantity, offset = 0;
    for (const row of batch.lines.filter(row => row.itemId === after.itemId)) {
      const assigned = Math.min(quantity, row.quantity - row.deliveredQuantity);
      row.stagedQuantity = row.deliveredQuantity + assigned;
      row.stagedSerials = [...row.deliveredSerials, ...after.serials.slice(offset, offset + assigned)];
      quantity -= assigned; offset += assigned;
      if (batch.mode === "scheduled" && assigned) {
        const allocation = state.allocations.find(value => value.workOrderId === row.workOrderId);
        ensure(allocation?.status === "reserved", "The work-order reservation changed. Review its assignment before correcting.");
        const hold = allocation.lines.find(value => value.warehouseId === batch.stagingId && value.itemId === row.itemId);
        if (hold) { hold.quantity += assigned; hold.reservationMode = "quantity"; }
        else allocation.lines.push({ itemId: row.itemId, warehouseId: batch.stagingId, quantity: assigned, serials: [], reservationMode: "quantity" });
      }
    }
  }
  batch.status = "active"; batch.pickupReady = correction.ready;
  for (const issue of batch.issues.filter(row => row.status === "open")) {
    issue.status = "resolved"; issue.resolvedBy = actor; issue.resolvedAt = now; issue.resolution = correction.reason;
  }
  batch.revision++;
  const label = (line: { itemId: string; quantity: number; serials: string[] }) => {
    const item = state.items.find(row => row.id === line.itemId);
    return `${item?.sku ?? "Unavailable item"} · ${item?.name ?? ""}: ${line.quantity}${line.serials.length ? ` [${line.serials.join(", ")}]` : ""}`;
  };
  const mode = verificationOnly ? "Pickup verified — no stock change" : correction.mode === "recording" ? "Recording correction — no physical exchange claimed" :
    correction.mode === "missing" ? "Missing stock — not returned or made available elsewhere" : "Confirmed physical return / exchange";
  tools.receipt(batch.id, batch.stagingId, [],
    `${mode} · ${correction.reason}\nBefore: ${before.map(label).join("; ")}\nAfter: ${correction.lines.map(label).join("; ")}${
      correction.observedReturns.length ? `\nUnexpected stock physically returned (already accounted at source; not credited again): ${correction.observedReturns.map(label).join("; ")}` : ""}`);
  state.receipts.at(-1)!.stagingCorrection = { mode: correction.mode, before, after: correction.lines, observedReturns: correction.observedReturns };
}
