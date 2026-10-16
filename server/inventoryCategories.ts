import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import type { InventoryState } from "../shared/inventory";
import { normalizeInventoryCategories, inventoryCategoryLabels } from "../shared/inventory-categories";

type QueryClient = Pick<PoolClient, "query">;
export const storedCategoryState = (state: InventoryState) => normalizeInventoryCategories(state, randomUUID);

export async function writeInventoryCategories(client: QueryClient, projectId: number, state: InventoryState) {
  for (const category of state.categoryCatalog ?? []) {
    await client.query(`INSERT INTO public.inventory_categories(project_id,id,name,active) VALUES($1,$2,$3,$4)
      ON CONFLICT(project_id,id) DO UPDATE SET name=EXCLUDED.name,active=EXCLUDED.active
      WHERE inventory_categories.name IS DISTINCT FROM EXCLUDED.name OR inventory_categories.active IS DISTINCT FROM EXCLUDED.active`,
    [projectId, category.id, category.name, category.active]);
  }
}

export async function writeInventoryCategoryItem(client: QueryClient, projectId: number, item: InventoryState["items"][number]) {
  await client.query(`INSERT INTO public.inventory_items(project_id,id,sku,data,category_id) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(project_id,id) DO UPDATE SET sku=EXCLUDED.sku,data=EXCLUDED.data,category_id=EXCLUDED.category_id`,
  [projectId, item.id, item.sku, JSON.stringify({ ...item, category: "" }), item.categoryId ?? null]);
}

/** Caller holds the aggregate lock. This is data migration only; never startup DDL. */
export async function readInventoryCategories(client: QueryClient, projectId: number, original: InventoryState): Promise<InventoryState> {
  let state = original;
  if (state.categoryCatalog === undefined) {
    state = storedCategoryState(state);
    await writeInventoryCategories(client, projectId, state);
    for (const item of state.items) await writeInventoryCategoryItem(client, projectId, item);
    await client.query("UPDATE public.inventory_state SET state=$2,updated_at=now() WHERE project_id=$1",
      [projectId, JSON.stringify(state)]);
    await client.query(`INSERT INTO public.inventory_movements(project_id,operation_id,action,changes)
      VALUES($1,$2,'categoryMigration',$3) ON CONFLICT(project_id,operation_id) DO NOTHING`,
    [projectId, `category-id-migration-v1-${projectId}`, JSON.stringify({ stock: [], entities: [
      { field: "categoryCatalog", before: original.categories ?? [], after: state.categoryCatalog },
    ] })]);
  }
  const { rows: categories } = await client.query(
    "SELECT id,name,active FROM public.inventory_categories WHERE project_id=$1 ORDER BY name,id", [projectId]);
  const { rows: assignments } = await client.query(
    "SELECT id,category_id FROM public.inventory_items WHERE project_id=$1", [projectId]);
  const ids = new Map(assignments.map(row => [row.id, row.category_id]));
  const items = state.items.map(item => {
    if (!ids.has(item.id)) throw new Error("Inventory item relationship is missing. Restore or repair the inventory before continuing.");
    return { ...item, categoryId: ids.get(item.id) ?? null, category: "" };
  });
  return inventoryCategoryLabels(storedCategoryState({ ...state, categoryCatalog: categories, items }));
}
