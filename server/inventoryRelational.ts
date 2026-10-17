import type { Pool, PoolClient } from "pg";
import { notifyInventoryChanged } from "./inventoryNotifications";
import { sql, Param, type SQL } from "drizzle-orm";
import { emptyInventory, type InventoryState } from "../shared/inventory";
import { readInventoryCategories, storedCategoryState } from "./inventoryCategories";
import { inventoryFromRelational, inventoryToRelational, writeRelationalInventory } from "./inventoryRelationalCodec";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";

type Client = Pick<PoolClient, "query">;
/** Keep the same database transaction when a caller uses Drizzle. */
export function drizzleInventoryClient(transaction: { execute: (statement: SQL) => Promise<any> }): Client {
  return { query: async (text: string, parameters: unknown[] = []) => transaction.execute(sql.join(
    text.split(/(\$\d+)/).map(part => /^\$\d+$/.test(part)
      ? new Param(parameters[Number(part.slice(1)) - 1]) : sql.raw(part)),
    sql.raw(""),
  )) } as Client;
}
export { writeRelationalInventory } from "./inventoryRelationalCodec";
export { relationalTableNames } from "./inventoryRelationalModel";
const tables = [...inventoryToRelational(emptyInventory(), 0).keys()];

/**
 * The retained legacy row is a transaction lock and pre-cutover archive only.
 * Data-only backfill is atomic on first use, after schema installation/Publish.
 * Once marked, every read comes from relational rows; never fall back to JSON.
 */
export async function readRelationalInventory(client: Client, projectId: number, options: { readOnly?: boolean } = {}): Promise<InventoryState> {
  const { rows: [root] } = await client.query(`SELECT project_id FROM public.inventory_state WHERE project_id=$1${options.readOnly ? "" : " FOR UPDATE"}`, [projectId]);
  if (!root) return emptyInventory();
  const { rows: [marker] } = await client.query("SELECT version,revision,collections FROM public.inventory_relational_projects WHERE project_id=$1", [projectId]);
  if (!marker) {
    const { rows: [archive] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [projectId]);
    // Audit exports run in a read-only consistent snapshot. Pre-cutover evidence
    // is readable there, but cannot initiate migration or override a marker.
    if (options.readOnly) return normalizeInventoryLocations(archive.state, "assigned");
    const categoryState = archive.state.categoryCatalog === undefined
      ? storedCategoryState(archive.state)
      : await readInventoryCategories(client, projectId, archive.state);
    const legacy = normalizeInventoryLocations(categoryState);
    await writeRelationalInventory(client, projectId, legacy);
    const loaded = await readRelationalInventory(client, projectId);
    if (JSON.stringify(storedCategoryState(loaded)) !== JSON.stringify(storedCategoryState(legacy))) {
      // Object field order is not semantic; compare canonical objects below.
      const canonical = (value: any): string => JSON.stringify(value, (_key, entry) =>
        entry && !Array.isArray(entry) && typeof entry === "object"
          ? Object.fromEntries(Object.keys(entry).sort().map(key => [key, entry[key]])) : entry);
      if (canonical(storedCategoryState(loaded)) !== canonical(storedCategoryState(legacy)))
        throw new Error("Inventory relational migration did not round-trip exactly; transaction must be rolled back.");
    }
    return loaded;
  }
  if (marker.version !== 1) throw new Error("Unsupported inventory relational storage version.");
  const rows = new Map<string, any[]>();
  for (const table of tables) {
    const result = await client.query(`SELECT * FROM public.${table} WHERE project_id=$1`, [projectId]);
    rows.set(table, result.rows);
  }
  const loaded = inventoryFromRelational(rows, marker.revision, marker.collections);
  if (!marker.collections.includes("locationTypes")) {
    const migrated = normalizeInventoryLocations(loaded, options.readOnly ? "assigned" : "shared");
    if (!options.readOnly) {
      await writeRelationalInventory(client, projectId, migrated);
      await client.query(`INSERT INTO public.inventory_movements(project_id,operation_id,action,changes)
        VALUES($1,$2,'locationTypeMigration',$3) ON CONFLICT(project_id,operation_id) DO NOTHING`,
      [projectId, `location-type-migration-${projectId}`, JSON.stringify({ stock: [], entities: [
        { field: "locationTypes", before: null, after: migrated.locationTypes },
      ] })]);
    }
    return migrated;
  }
  return normalizeInventoryLocations(loaded);
}

export async function migrateRelationalInventories(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT project_id FROM public.inventory_state ORDER BY project_id FOR UPDATE");
    for (const row of rows) {
      const state = await readRelationalInventory(client, row.project_id);
      await writeRelationalInventory(client, row.project_id, state);
    }
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    const { rows: constraints } = await client.query(`SELECT conrelid::regclass::text AS relation,conname
      FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname LIKE 'inventory_rel_fk_%' AND NOT convalidated`);
    for (const constraint of constraints) {
      if (!/^inventory_[a-z_]+$/.test(constraint.relation.replace(/^public\./, "")) || !/^inventory_rel_fk_[a-f0-9]+$/.test(constraint.conname))
        throw new Error("Unexpected inventory migration constraint.");
      await client.query(`ALTER TABLE ${constraint.relation} VALIDATE CONSTRAINT "${constraint.conname}"`);
    }
    await client.query("ALTER TABLE public.inventory_warehouses VALIDATE CONSTRAINT inventory_warehouse_location_type_required");
    await client.query("COMMIT");
    return rows.length;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

/** Used only by explicit project restore; preserves the legacy archive separately. */
export async function clearRelationalInventory(client: Client, projectId: number) {
  // Defer new FKs; existing item->category RESTRICT requires categories last.
  for (const table of [...tables.filter(name => name !== "inventory_categories")].reverse())
    await client.query(`DELETE FROM public.${table} WHERE project_id=$1`, [projectId]);
  await client.query("DELETE FROM public.inventory_categories WHERE project_id=$1", [projectId]);
  await client.query("DELETE FROM public.inventory_relational_projects WHERE project_id=$1", [projectId]);
  await notifyInventoryChanged(client, projectId);
}
