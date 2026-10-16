import type { Pool } from "pg";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { readInventoryCategories } from "./inventoryCategories";

/** Explicit maintenance/test entry point. Never invoked by application startup. */
export async function applyInventoryCategorySchema(pool: Pool) {
  const sql = await readFile(fileURLToPath(new URL("../migrations/inventory-category-ids.sql", import.meta.url)), "utf8");
  await pool.query(sql);
}

export async function migrateInventoryCategoryData(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT project_id,state FROM public.inventory_state ORDER BY project_id FOR UPDATE");
    for (const row of rows) await readInventoryCategories(client, row.project_id, row.state);
    await client.query("COMMIT");
    return rows.length;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
