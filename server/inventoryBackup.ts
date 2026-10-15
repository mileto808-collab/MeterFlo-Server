import type { PoolClient } from "pg";
import { emptyInventory, warehouseSchema, itemSchema, vendorSchema, allocationSchema, savedCountDraftSchema, type InventoryState } from "../shared/inventory";
import { z } from "zod";
import { countPayloadFits } from "../shared/inventory-count-limits";
import { reserved } from "../shared/inventory-engine";
import { validateShipmentBackup } from "./inventoryShipmentBackup";

export type InventoryBackup = { state: InventoryState; movements: any[]; enabled: boolean };
export async function exportInventory(client: PoolClient, schema: string): Promise<InventoryBackup | undefined> {
  const { rows: [p] } = await client.query("SELECT id,inventory_enabled FROM public.projects WHERE database_name=$1", [schema]);
  if (!p) return;
  const { rows: [r] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [p.id]);
  if (!r) return;
  const { rows } = await client.query("SELECT operation_id,action,actor_id,occurred_at,changes FROM public.inventory_movements WHERE project_id=$1 ORDER BY id", [p.id]);
  return { state: r.state, movements: rows, enabled: !!p.inventory_enabled };
}
export function validateInventoryBackup(backup: InventoryBackup, workOrderIds: number[]) {
  const s = backup.state;
  z.array(warehouseSchema).parse(s.warehouses); z.array(itemSchema).parse(s.items); z.array(vendorSchema).parse(s.vendors);
  if (!Array.isArray(s.stock) || !Array.isArray(s.allocations) || !Array.isArray(s.orders) || !Array.isArray(s.receipts) ||
    !Array.isArray(s.returns) || !Array.isArray(s.counts) || typeof s.operations !== "object") throw new Error("Incomplete inventory backup.");
  for (const a of s.allocations) {
    if (!workOrderIds.includes(a.workOrderId)) throw new Error("Inventory backup refers to a missing work order.");
    z.array(allocationSchema).parse(a.lines); z.array(allocationSchema).parse(a.used);
  }
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
  await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2) ON CONFLICT(project_id) DO UPDATE SET state=EXCLUDED.state,updated_at=now()", [p.id, JSON.stringify(backup.state || emptyInventory())]);
  await client.query("DELETE FROM public.inventory_quantities WHERE project_id=$1", [p.id]);
  await client.query("DELETE FROM public.inventory_items WHERE project_id=$1", [p.id]);
  for (const i of backup.state.items) await client.query("INSERT INTO public.inventory_items(project_id,id,sku,data) VALUES($1,$2,$3,$4)", [p.id, i.id, i.sku, JSON.stringify(i)]);
  for (const b of backup.state.stock) await client.query("INSERT INTO public.inventory_quantities(project_id,warehouse_id,item_id,quantity,reserved,serials) VALUES($1,$2,$3,$4,$5,$6)",
    [p.id, b.warehouseId, b.itemId, b.quantity, reserved(backup.state, b.warehouseId, b.itemId), JSON.stringify(b.serials)]);
  await client.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [p.id]);
  for (const m of backup.movements) await client.query("INSERT INTO public.inventory_movements(project_id,operation_id,action,actor_id,occurred_at,changes) VALUES($1,$2,$3,$4,$5,$6)",
    [p.id, m.operation_id, m.action, m.actor_id, m.occurred_at, JSON.stringify(m.changes)]);
  await client.query("UPDATE public.projects SET inventory_enabled=$2 WHERE id=$1", [p.id, backup.enabled]);
}
