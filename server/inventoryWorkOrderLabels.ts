import { pool } from "./db";
import { InventoryError } from "../shared/inventory-engine";
import type { InventoryWorkOrderLabels } from "../shared/inventory-work-order-labels";

/** Read only display identifiers, scoped to references in visible inventory. */
export async function inventoryWorkOrderLabels(schema: string | null | undefined, ids: readonly number[]): Promise<InventoryWorkOrderLabels> {
  const uniqueIds = [...new Set(ids)];
  if (!uniqueIds.length) return {};
  if (!schema) throw new InventoryError("Work-order storage unavailable.");
  const { rows } = await pool.query<{ id: number; customer_wo_id: string | null }>(
    `SELECT id,customer_wo_id FROM "${schema.replace(/"/g, '""')}".work_orders WHERE id=ANY($1::int[])`, [uniqueIds]);
  return Object.fromEntries(rows.map(row => [String(row.id), row.customer_wo_id?.trim() || String(row.id)]));
}
