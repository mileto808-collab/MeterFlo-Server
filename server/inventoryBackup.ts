import type { PoolClient } from "pg";
import { emptyInventory, warehouseSchema, itemSchema, vendorSchema, allocationSchema, savedCountDraftSchema, categoryNameSchema, categoryKey, type InventoryState } from "../shared/inventory";
import { z } from "zod";
import { mergeOrderHighWater, validateOrderNumbers } from "../shared/inventory-order-labels";
import { countPayloadFits } from "../shared/inventory-count-limits";
import { reserved } from "../shared/inventory-engine";
import { validateShipmentBackup } from "./inventoryShipmentBackup";
import { savedShipmentDraftSchema } from "../shared/inventory-shipment-draft-model";
import { draftWarehouse } from "../shared/inventory-shipment-drafts";
import { readInventoryCategories, storedCategoryState, writeInventoryCategories, writeInventoryCategoryItem } from "./inventoryCategories";

export type InventoryBackup = { state: InventoryState; movements: any[]; enabled: boolean };
export async function exportInventory(client: PoolClient, schema: string): Promise<InventoryBackup | undefined> {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) return;
  const { rows: [r] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [p.id]);
  if (!r) return;
  const state = storedCategoryState(await readInventoryCategories(client, p.id, r.state));
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
  for (const count of s.counts) if (count.draft) {
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
}
export async function restoreInventory(client: PoolClient, schema: string, backup: InventoryBackup) {
  const { rows: [p] } = await client.query("SELECT id FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) throw new Error("Restore the project configuration before inventory.");
  const { rows: ids } = await client.query(`SELECT id FROM "${schema}".work_orders`);
  validateInventoryBackup(backup, ids.map(x => x.id));
  const { rows: [local] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [p.id]);
  backup = { ...backup, state: storedCategoryState(mergeOrderHighWater(backup.state, local?.state)) };
  await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [p.id, JSON.stringify(backup.state || emptyInventory())]);
  await client.query("DELETE FROM public.inventory_quantities WHERE project_id=$1", [p.id]);
  await client.query("DELETE FROM public.inventory_items WHERE project_id=$1", [p.id]);
  await client.query("DELETE FROM public.inventory_categories WHERE project_id=$1", [p.id]);
  await writeInventoryCategories(client, p.id, backup.state);
  for (const i of backup.state.items) await writeInventoryCategoryItem(client, p.id, i);
  for (const b of backup.state.stock) await client.query("INSERT INTO public.inventory_quantities(project_id,warehouse_id,item_id,quantity,reserved,serials) VALUES($1,$2,$3,$4,$5,$6)",
    [p.id, b.warehouseId, b.itemId, b.quantity, reserved(backup.state, b.warehouseId, b.itemId), JSON.stringify(b.serials)]);
  await client.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [p.id]);
  for (const m of backup.movements) await client.query("INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,occurred_at,changes) VALUES($1,$2,$3,$4,$5,$6)",
    [p.id, m.operation_id, m.action, m.actor_id, m.occurred_at, JSON.stringify(m.changes)]);
  await client.query("UPDATE public.projects SET inventory_enabled=$2 WHERE id=$1", [p.id, backup.enabled]);
}
