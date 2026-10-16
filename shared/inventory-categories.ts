import { z } from "zod";
import type { InventoryState } from "./inventory";

export const inventoryCategorySchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(500),
  active: z.boolean().default(true),
});
export type InventoryCategory = z.infer<typeof inventoryCategorySchema>;
const key = (name: string) => name.trim().toLowerCase();

/** Upgrade portable legacy snapshots. Never infer a name for a dangling modern ID. */
export function normalizeInventoryCategories(original: InventoryState, makeId = () => crypto.randomUUID()): InventoryState {
  const state = structuredClone(original);
  const modern = state.categoryCatalog !== undefined;
  const catalog = modern ? z.array(inventoryCategorySchema).parse(state.categoryCatalog) : [];
  if (new Set(catalog.map(c => c.id)).size !== catalog.length ||
      new Set(catalog.map(c => key(c.name))).size !== catalog.length)
    throw new Error("Duplicate inventory categories in backup.");
  if (!modern) {
    const legacy = state.categories ?? [];
    if (new Set(legacy.map(key)).size !== legacy.length) throw new Error("Duplicate inventory categories in backup.");
    for (const name of [...legacy, ...state.items.map(item => item.category || "")]) {
      if (!key(name) || catalog.some(c => key(c.name) === key(name))) continue;
      catalog.push(inventoryCategorySchema.parse({ id: makeId(), name, active: true }));
    }
  }
  state.categoryCatalog = catalog;
  delete state.categories;
  state.items = state.items.map(item => {
    let categoryId = item.categoryId;
    if (categoryId === undefined) {
      if (modern && item.category?.trim()) throw new Error("Inventory item is missing its category ID.");
      categoryId = catalog.find(c => key(c.name) === key(item.category || ""))?.id ?? null;
    }
    if (categoryId !== null && !catalog.some(c => c.id === categoryId))
      throw new Error("Inventory item refers to a missing category.");
    return { ...item, categoryId, category: "" };
  });
  return state;
}

/** Labels are a read projection, not the stored relationship. */
export function inventoryCategoryLabels(state: InventoryState): InventoryState {
  const names = new Map((state.categoryCatalog ?? []).map(c => [c.id, c.name]));
  return { ...state, items: state.items.map(item => ({ ...item,
    category: item.categoryId ? names.get(item.categoryId) ?? "" : item.categoryId === null ? "" : item.category,
  })) };
}
