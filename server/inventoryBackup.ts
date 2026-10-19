import type { PoolClient } from "pg";
import { emptyInventory, warehouseSchema, itemSchema, vendorSchema, allocationSchema, savedCountDraftSchema, categoryNameSchema, categoryKey, type InventoryState } from "../shared/inventory";
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

export type InventoryBackup = { state: InventoryState; movements: any[]; enabled: boolean };
export async function exportInventory(client: PoolClient, schema: string): Promise<InventoryBackup | undefined> {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) return;
  const { rows: [r] } = await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [p.id]);
  if (!r) return;
  const state = storedCategoryState(await readRelationalInventory(client, p.id));
  const { rows } = await client.query("SELECT operation_id,action,actor_id,occurred_at,changes FROM public.inventory_movements WHERE project_id=$1 ORDER BY id", [p.id]);
  return { state, movements: rows, enabled: !!p.inventory_enabled };
}
export function validateInventoryBackup(backup: InventoryBackup, workOrderIds: number[]) {
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
    missing: z.array(z.object({ equipment: z.enum(["system", "module"]), typeId: z.string().min(1) }).strict()),
  }).strict()).parse(s.workRequirements ?? []);
  if (new Set(requirements.map(r => r.workOrderId)).size !== requirements.length ||
      requirements.some(r => !workOrderIds.includes(r.workOrderId) || r.lines.some(l => !s.items.some(i => i.id === l.itemId))))
    throw new Error("Inventory backup has invalid planned work-order requirements.");
  z.array(warehouseSchema).parse(s.warehouses); z.array(itemSchema).parse(s.items); z.array(vendorSchema).parse(s.vendors);
  const categories = z.array(categoryNameSchema).parse(s.categories ?? []);
  if (new Set(categories.map(categoryKey)).size !== categories.length) throw new Error("Duplicate inventory categories in backup.");
  storedCategoryState(s);
  if (!Array.isArray(s.stock) || !Array.isArray(s.allocations) || !Array.isArray(s.orders) || !Array.isArray(s.receipts) ||
    !Array.isArray(s.returns) || !Array.isArray(s.counts) || typeof s.operations !== "object") throw new Error("Incomplete inventory backup.");
  for (const a of s.allocations) {
    if (!workOrderIds.includes(a.workOrderId)) throw new Error("Inventory backup refers to a missing work order.");
    z.array(allocationSchema).parse(a.lines); z.array(allocationSchema).parse(a.used);
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
}
