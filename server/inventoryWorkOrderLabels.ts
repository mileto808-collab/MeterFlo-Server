import { pool } from "./db";
import { InventoryError } from "../shared/inventory-engine";
import type { InventoryWorkOrderLabels, InventoryWorkOrderIdentifiers } from "../shared/inventory-work-order-labels";

/** Read only display identifiers, scoped to references in visible inventory. */
export async function inventoryWorkOrderLabels(schema: string | null | undefined, ids: readonly number[]): Promise<InventoryWorkOrderLabels> {
  return (await inventoryWorkOrderContext(schema, ids)).labels;
}

export async function inventoryWorkOrderContext(schema: string | null | undefined, ids: readonly number[]): Promise<{
  labels: InventoryWorkOrderLabels; identifiers: InventoryWorkOrderIdentifiers;
}> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return { labels: {}, identifiers: {} };
  if (!schema) throw new InventoryError("Work-order storage unavailable.");
  const { rows } = await pool.query<{ id: number; customer_wo_id: string | null; old_system_id: string | null;
    new_system_id: string | null; old_module_id: string | null; new_module_id: string | null }>(
    `SELECT id,customer_wo_id,old_system_id,new_system_id,old_module_id,new_module_id
     FROM "${schema.replace(/"/g, '""')}".work_orders WHERE id=ANY($1::int[])`, [uniqueIds]);
  return {
    labels: Object.fromEntries(rows.map(row => [String(row.id), row.customer_wo_id?.trim() || String(row.id)])),
    identifiers: Object.fromEntries(rows.map(row => [String(row.id), { customerWoId: row.customer_wo_id?.trim() ?? "",
      equipmentIds: [row.old_system_id, row.new_system_id, row.old_module_id, row.new_module_id].filter((value): value is string => !!value?.trim()) }])),
  };
}
