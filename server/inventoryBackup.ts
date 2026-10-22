import type { PoolClient } from "pg";
import { emptyInventory, warehouseSchema, itemSchema, vendorSchema, allocationSchema, reservationSchema, savedCountDraftSchema, categoryNameSchema, categoryKey, type InventoryState } from "../shared/inventory";
import { workPlanInputSchema } from "../shared/inventory-planning";
import { fulfillmentBatchSchema } from "../shared/inventory-fulfillment";
import { savedFulfillmentDraftSchema } from "../shared/inventory-fulfillment-drafts";
import { z } from "zod";
import { validateCustomerHandoffs } from "../shared/inventory-customer-handoffs";
import { mergeOrderHighWater, validateOrderNumbers } from "../shared/inventory-order-labels";
import { countPayloadFits } from "../shared/inventory-count-limits";
import { reserved } from "../shared/inventory-engine";
import { validateShipmentBackup } from "./inventoryShipmentBackup";
import { savedShipmentDraftSchema } from "../shared/inventory-shipment-draft-model";
import { draftWarehouse } from "../shared/inventory-shipment-drafts";
import { readInventoryCategories, storedCategoryState, writeInventoryCategories, writeInventoryCategoryItem } from "./inventoryCategories";
import { validateKitBackup } from "./inventoryKitBackup";
import { readRelationalInventory, writeRelationalInventory, clearRelationalInventory } from "./inventoryRelational";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";
import { fieldStockSettingsSchema } from "../shared/inventory-field-stock";
import { removalRuleSchema, removalPolicySchema } from "../shared/inventory-removal-policy";
import { dispositionSchema } from "../shared/inventory";
import { stockDiscrepancySchema } from "../shared/inventory-stock-discrepancies";
import { exportChangeouts, restoreChangeouts, validateChangeouts, type ChangeoutBackup } from "./changeoutBackup";

export type InventoryBackup = { state: InventoryState; movements: any[]; enabled: boolean; changeouts?: ChangeoutBackup };
export async function exportInventory(client: PoolClient, schema: string): Promise<InventoryBackup | undefined> {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) return;
  const { rows: [r] } = await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [p.id]);
  const changeouts = await exportChangeouts(client, p.id);
  if (!r && !changeouts.completions.length && !changeouts.drafts.length) return;
  const state = r ? storedCategoryState(await readRelationalInventory(client, p.id)) : emptyInventory();
  const { rows } = await client.query("SELECT operation_id,action,actor_id,occurred_at,changes FROM public.inventory_movements WHERE project_id=$1 ORDER BY id", [p.id]);
  return { state, movements: rows, enabled: !!p.inventory_enabled, changeouts };
}
export function validateInventoryBackup(backup: InventoryBackup, workOrderIds: number[]) {
  validateChangeouts(backup.changeouts, new Set(workOrderIds));
  const discrepancies = z.array(stockDiscrepancySchema).parse(backup.state.stockDiscrepancies ?? []);
  const state = backup.state;
  if (new Set(discrepancies.map(value => value.id)).size !== discrepancies.length)
    throw new Error("Duplicate stock discrepancy in inventory backup.");
  for (const value of discrepancies) {
    const product = state.items.find(item => item.id === value.itemId);
    const source = state.receipts.find(receipt => receipt.id === value.sourceReceiptId && receipt.action === "fieldUseShortage" &&
      receipt.reference === `work-order-${value.workOrderId}`);
    const line = source?.lines.find(line => line.itemId === value.itemId &&
      ((line as typeof line & { warehouseId?: string }).warehouseId ?? source.warehouseId) === value.warehouseId);
    if (!workOrderIds.includes(value.workOrderId) || !product || !state.warehouses.some(warehouse => warehouse.id === value.warehouseId) ||
      !source ||
      !line || line.quantity !== value.usedQuantity || value.quantity > line.quantity ||
      (product.tracking === "serialized" ? value.serials.length !== value.quantity : value.serials.length !== 0) ||
      new Set(value.serials).size !== value.serials.length || value.serials.some(serial => !line.serials.includes(serial)) ||
      value.receiptIds?.some(id => !state.receipts.some(receipt => receipt.id === id)) ||
      value.status === "resolved" && (!value.resolvedBy || !value.resolvedAt || !value.reason || !value.evidence || !value.method ||
        !state.receipts.some(receipt => receipt.action === "resolveStockDiscrepancy" && receipt.reference === value.id &&
          receipt.sourceReceiptId === value.sourceReceiptId && receipt.actor === value.resolvedBy && receipt.occurredAt === value.resolvedAt)))
      throw new Error("Inventory backup has invalid stock discrepancy evidence.");
  }
  const drafts = z.array(savedShipmentDraftSchema).max(100).parse(backup.state.shipmentDrafts ?? []);
  if (new TextEncoder().encode(JSON.stringify(drafts)).length > 32 * 1024 * 1024)
    throw new Error("Saved shipment drafts exceed the project's 32 MiB limit.");
  if (new Set(drafts.map(d => d.id)).size !== drafts.length ||
    new Set(drafts.map(d => JSON.stringify([d.orderId, d.stage]))).size !== drafts.length)
    throw new Error("Inventory backup contains duplicate shipment drafts.");
  for (const draft of drafts) {
    if (!backup.state.warehouses.some(w => w.id === draftWarehouse(backup.state, draft.orderId, draft.stage)) ||
      new TextEncoder().encode(JSON.stringify(draft)).length > 16 * 1024 * 1024 ||
      draft.pending && (draft.pending.payload.orderId !== draft.orderId ||
        draft.pending.payload.draftId !== undefined || draft.pending.payload.draftRevision !== undefined))
      throw new Error("Inventory backup has an invalid shipment draft.");
    const receipt = draft.pending && backup.state.receipts.find(r => r.id === draft.pending!.operationId);
    if (receipt && (receipt.action !== draft.stage || receipt.reference !== draft.orderId))
      throw new Error("Saved shipment draft references an unrelated receipt.");
  }
  const s = backup.state;
  const batches = z.array(fulfillmentBatchSchema).parse(s.fulfillmentBatches ?? []);
  for (const receipt of s.receipts ?? []) {
    if (receipt.sourceId && !s.warehouses.some(warehouse => warehouse.id === receipt.sourceId))
      throw new Error("Invalid receipt source location in backup.");
    if (receipt.workOrderIds !== undefined && (!Array.isArray(receipt.workOrderIds) ||
      receipt.workOrderIds.some(id => !Number.isSafeInteger(id) || !workOrderIds.includes(id)) ||
      new Set(receipt.workOrderIds).size !== receipt.workOrderIds.length))
      throw new Error("Invalid receipt work-order identities in backup.");
  }
  for (const receipt of s.receipts) if (receipt.fulfillmentDeletion) {
    const deletion = z.object({ batch: fulfillmentBatchSchema, deletedBy: z.string().min(1),
      deletedAt: z.string().datetime() }).strict().parse(receipt.fulfillmentDeletion);
    if (deletion.batch.id !== receipt.reference || receipt.action !== "fulfillmentDelete" ||
        receipt.lines.length || receipt.actor !== deletion.deletedBy || receipt.occurredAt !== deletion.deletedAt)
      throw new Error("Invalid deleted fulfillment batch history.");
  }
  const fulfillmentDrafts = z.array(savedFulfillmentDraftSchema).parse(s.fulfillmentDrafts ?? []);
  if (new Set(fulfillmentDrafts.map(draft => draft.id)).size !== fulfillmentDrafts.length)
    throw new Error("Duplicate saved fulfillment draft identities in backup.");
  if (new Set(batches.map(batch => batch.id)).size !== batches.length) throw new Error("Duplicate fulfillment batch identity.");
  for (const batch of batches) {
    if (new Set(batch.workOrders.map(w => w.workOrderId)).size !== batch.workOrders.length ||
      batch.workOrders.some(w => !workOrderIds.includes(w.workOrderId) ||
        !!w.vehicleId && !s.warehouses.some(vehicle => vehicle.id === w.vehicleId)) ||
      [batch.sourceId, batch.stagingId, batch.vehicleId].some(id => !s.warehouses.some(w => w.id === id)) ||
      new Set([batch.sourceId, batch.stagingId, batch.vehicleId]).size !== 3 ||
      new Set(batch.lines.map(line => `${line.workOrderId}/${line.itemId}`)).size !== batch.lines.length)
      throw new Error("Invalid fulfillment work-order or location references.");
    for (const line of batch.lines) {
      const item = s.items.find(item => item.id === line.itemId);
      if (!item || item.kind === "labor" || !batch.workOrders.some(w => w.workOrderId === line.workOrderId) ||
        line.deliveredQuantity > line.stagedQuantity || line.stagedQuantity > line.quantity ||
        (item.tracking === "serialized" ? line.stagedSerials.length !== line.stagedQuantity ||
          line.deliveredSerials.length !== line.deliveredQuantity : line.stagedSerials.length || line.deliveredSerials.length) ||
        new Set(line.stagedSerials).size !== line.stagedSerials.length ||
        new Set(line.deliveredSerials).size !== line.deliveredSerials.length ||
        line.deliveredSerials.some(serial => !line.stagedSerials.includes(serial)))
        throw new Error("Invalid fulfillment custody or quantities.");
    }
    if (batch.status === "completed" && batch.lines.some(line => line.deliveredQuantity !== line.quantity))
      throw new Error("Completed fulfillment has outstanding quantities.");
  }
  const fieldSettings = z.array(fieldStockSettingsSchema).max(1).parse(s.fieldSettings ?? []);
  for (const setting of fieldSettings)
    if (setting.sourceMode === "project_warehouse" && !s.warehouses.some(w => w.id === setting.warehouseId && w.type === "physical"))
      throw new Error("Inventory field stock settings reference a missing project warehouse.");
  const rules = z.array(removalRuleSchema).max(1000).parse(s.removalRules ?? []);
  const policies = z.array(removalPolicySchema).max(1).parse(s.removalPolicies ?? []);
  const choices = z.array(z.object({ id: z.string().min(1), equipment: z.enum(["system", "module"]), ruleId: z.string().uuid() }).strict()).max(2000).parse(s.fieldRemovalChoices ?? []);
  if (new Set(choices.map(choice => choice.id)).size !== choices.length || choices.some(choice =>
    choice.id !== `${choice.equipment}:${choice.ruleId}` || !rules.some(rule => rule.id === choice.ruleId &&
      rule.stage === "field" && [choice.equipment, "both"].includes(rule.equipment))))
    throw new Error("Inventory backup has orphaned or invalid technician disposition selections.");
  if ((s.removalRules === undefined) !== (s.removalPolicies === undefined) ||
      s.removalPolicies !== undefined && policies.length !== 1 ||
      new Set(rules.map(r => r.id)).size !== rules.length ||
      new Set(rules.map(r => r.name.toLowerCase())).size !== rules.length)
    throw new Error("Inventory backup has invalid equipment-removal rules.");
  const historical = (d: { ruleId?: string; ruleName?: string; ruleRevision?: number; policyRevision?: number }) => {
    if (d.ruleId && (!rules.some(r => r.id === d.ruleId) || !d.ruleName || !d.ruleRevision))
      throw new Error("Inventory backup has an orphaned removal-rule snapshot.");
  };
  for (const allocation of s.allocations) for (const d of allocation.dispositions) {
    dispositionSchema.parse(d); historical(d);
  }
  const returnSchema = dispositionSchema.extend({
    id: z.string().min(1), workOrderId: z.number().int().positive(),
    status: z.enum(["pending", "quarantine", "released", "scrapped", "left_onsite", "customer_pending", "customer_returned"]),
    customerRecipient: z.string().trim().min(1).max(200).optional(), customerReference: z.string().max(200).optional(),
    customerHandoffAt: z.string().datetime().optional(), customerHandoffBy: z.string().min(1).optional(), customerHandoffId: z.string().uuid().optional(),
    itemId: z.string().min(1).optional(), history: z.array(z.object({
      recipient: z.string().max(200).optional(), reference: z.string().max(200).optional(), previousStatus: z.string().max(40).optional(),
      physicallyPresent: z.boolean().optional(), handoffId: z.string().uuid().optional(),
      operationId: z.string().min(1), actor: z.string().min(1), occurredAt: z.string().datetime(),
      outcome: z.enum(["returned", "scrapped", "left_onsite", "released", "quarantine", "customer_return", "customer_returned", "decision_corrected"]), reason: z.string().min(1),
      ruleId: z.string().uuid().optional(), ruleRevision: z.number().int().positive().optional(), ruleName: z.string().min(1).max(200).optional(),
    }).strict()).optional(),
  }).strict();
  for (const returned of z.array(returnSchema).parse(s.returns)) {
    historical(returned);
    for (const event of returned.history ?? []) historical(event);
    if (["customer_pending", "customer_returned"].includes(returned.status)) {
      const history = returned.history ?? [], handoff = history.at(-1);
      if (returned.disposition !== "returned" || !returned.warehouseId || returned.itemId ||
        !history.some(event => event.outcome === "customer_return") ||
        returned.status === "customer_returned" && (!returned.customerRecipient || !returned.customerHandoffAt || !returned.customerHandoffBy ||
          handoff?.outcome !== "customer_returned" || handoff.recipient !== returned.customerRecipient ||
          handoff.occurredAt !== returned.customerHandoffAt || handoff.actor !== returned.customerHandoffBy))
        throw new Error("Inventory backup has invalid customer-return custody.");
    }
    if (!workOrderIds.includes(returned.workOrderId) ||
        returned.warehouseId && !s.warehouses.some(w => w.id === returned.warehouseId) ||
        returned.itemId && !s.items.some(i => i.id === returned.itemId) ||
        ["quarantine", "released"].includes(returned.status) && (!returned.warehouseId || returned.disposition !== "returned"))
      throw new Error("Inventory backup has invalid removed-equipment custody.");
  }
  validateCustomerHandoffs(s);
  // A pre-type backup used assigned-user checks even for physical warehouses.
  // Restore that policy explicitly rather than applying the live cutover default.
  const locations = normalizeInventoryLocations(s, "assigned");
  z.array(warehouseSchema).parse(locations.warehouses);
  const typeLinks = z.array(z.object({
    id: z.string().min(1), equipment: z.enum(["system", "module"]), typeId: z.number().int(),
    itemId: z.string().min(1), systemTypeId: z.number().int().nullable(), moduleTypeId: z.number().int().nullable(),
  }).strict()).parse(s.typeLinks ?? []);
  if (new Set(typeLinks.map(l => `${l.equipment}/${l.typeId}`)).size !== typeLinks.length ||
      typeLinks.some(l => l.id !== `${l.equipment}-${l.typeId}` || !s.items.some(i => i.id === l.itemId) ||
        (l.equipment === "system" ? l.systemTypeId !== l.typeId || l.moduleTypeId !== null : l.moduleTypeId !== l.typeId || l.systemTypeId !== null)))
    throw new Error("Inventory backup has invalid equipment type links.");
  const requirements = z.array(z.object({
    workOrderId: z.number().int().positive(),
    lines: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().int().positive() }).strict()),
    automaticLines: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().int().positive() }).strict()).optional(),
    missing: z.array(z.object({ equipment: z.enum(["system", "module"]), typeId: z.string().min(1) }).strict()),
  }).strict()).parse(s.workRequirements ?? []);
  if (new Set(requirements.map(r => r.workOrderId)).size !== requirements.length ||
      requirements.some(r => !workOrderIds.includes(r.workOrderId) || [...r.lines, ...(r.automaticLines ?? [])].some(l => !s.items.some(i => i.id === l.itemId))))
    throw new Error("Inventory backup has invalid planned work-order requirements.");
  const plans = z.array(workPlanInputSchema.extend({ updatedBy: z.string().optional(), updatedAt: z.string().datetime().optional() })).parse(s.workPlans ?? []);
  if (new Set(plans.map(plan => plan.workOrderId)).size !== plans.length || plans.some(plan =>
    !workOrderIds.includes(plan.workOrderId) || new Set(plan.lines.map(line => line.id)).size !== plan.lines.length ||
    plan.lines.some(line => !s.items.some(item => item.id === line.itemId)) ||
    new Set(plan.lines.filter(line => line.kind === "override").map(line => line.itemId)).size !== plan.lines.filter(line => line.kind === "override").length))
    throw new Error("Inventory backup has invalid manual work-order plans.");
  z.array(warehouseSchema).parse(s.warehouses); z.array(itemSchema).parse(s.items); z.array(vendorSchema).parse(s.vendors);
  const categories = z.array(categoryNameSchema).parse(s.categories ?? []);
  if (new Set(categories.map(categoryKey)).size !== categories.length) throw new Error("Duplicate inventory categories in backup.");
  storedCategoryState(s);
  if (!Array.isArray(s.stock) || !Array.isArray(s.allocations) || !Array.isArray(s.orders) || !Array.isArray(s.receipts) ||
    !Array.isArray(s.returns) || !Array.isArray(s.counts) || typeof s.operations !== "object") throw new Error("Incomplete inventory backup.");
  for (const a of s.allocations) {
    if (!workOrderIds.includes(a.workOrderId)) throw new Error("Inventory backup refers to a missing work order.");
    z.array(reservationSchema).parse(a.lines); z.array(allocationSchema).parse(a.used);
    if (a.lines.some(line => line.reservationMode === "quantity" && line.serials.length))
      throw new Error("Quantity reservations cannot contain assigned serials.");
  }
  validateOrderNumbers(s);
  for (const order of s.orders) if (order.archivedAt !== undefined) {
    z.string().datetime().parse(order.archivedAt);
    if (order.type !== "purchase" || order.status !== "cancelled")
      throw new Error("Only cancelled purchase orders may be cleared in an inventory backup.");
  }
  for (const count of s.counts) {
    if (count.scope !== undefined && count.scope !== "selected" && count.scope !== "warehouse")
      throw new Error("Inventory backup has an invalid count scope.");
    if (!count.draft) continue;
    const draft = savedCountDraftSchema.parse(count.draft);
    if (!countPayloadFits(draft) || count.status !== "open" || !s.warehouses.some(w => w.id === count.warehouseId) ||
      new Set(draft.rows.map(row => row.itemId)).size !== draft.rows.length ||
      draft.rows.some(row => !s.items.some(item => item.id === row.itemId)))
      throw new Error("Inventory backup has an invalid count draft.");
  }
  for (const b of s.stock) {
    const i = s.items.find(i => i.id === b.itemId);
    if (!i || !s.warehouses.some(w => w.id === b.warehouseId) || !Number.isSafeInteger(b.quantity) || b.quantity < reserved(s, b.warehouseId, b.itemId) ||
      b.quantity < 0 || i.tracking === "serialized" && (b.quantity !== b.serials.length || new Set(b.serials).size !== b.serials.length))
      throw new Error("Inventory backup has invalid stock relationships or quantities.");
  }
  validateShipmentBackup(s);
  validateKitBackup(s);
}
export async function restoreInventory(client: PoolClient, schema: string, backup: InventoryBackup) {
  const { rows: [p] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) throw new Error("Restore the project configuration before inventory.");
  const { rows: ids } = await client.query(`SELECT id FROM "${schema}".work_orders`);
  validateInventoryBackup(backup, ids.map(x => x.id));
  const local = await readRelationalInventory(client, p.id);
  backup = { ...backup, state: normalizeInventoryLocations(storedCategoryState(mergeOrderHighWater(backup.state, local)), "assigned") };
  await clearRelationalInventory(client, p.id);
  await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [p.id, JSON.stringify(backup.state || emptyInventory())]);
  await writeRelationalInventory(client, p.id, backup.state);
  await client.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [p.id]);
  for (const m of backup.movements) await client.query("INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,occurred_at,changes) VALUES($1,$2,$3,$4,$5,$6)",
    [p.id, m.operation_id, m.action, m.actor_id, m.occurred_at, JSON.stringify(m.changes)]);
  await client.query("UPDATE public.projects SET inventory_enabled=$2 WHERE id=$1", [p.id, backup.enabled]);
  await restoreChangeouts(client, p.id, schema, backup.changeouts);
}
