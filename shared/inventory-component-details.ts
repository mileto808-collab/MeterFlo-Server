import type { InventoryItem, InventoryState, StockLine } from "./inventory";

/** Current recipe information for planning, never evidence of installed custody. */
export function inventoryComponentDetails(itemId: string, quantity: number, items: InventoryItem[], ancestors = new Set<string>()):
  Array<{ itemId: string; label: string; sku: string; unit: string; labor: boolean; quantity: number; depth: number }> {
  const item = items.find(value => value.id === itemId);
  if (!item || ancestors.has(itemId)) return [];
  const next = new Set(ancestors).add(itemId);
  return item.components.flatMap(component => {
    if (next.has(component.itemId)) return [];
    const child = items.find(value => value.id === component.itemId);
    const total = Math.round(quantity * component.quantity * 1000000) / 1000000;
    return [{ itemId: component.itemId, label: child?.name ?? component.itemId, sku: child?.sku ?? "",
      unit: child?.unit ?? "units", labor: child?.kind === "labor", quantity: total, depth: next.size },
      ...inventoryComponentDetails(component.itemId, total, items, next)];
  });
}

export type WorkKitComponentTrace = {
  sourceId: string; kitItemId: string; quantity: number; kitSerials: string[];
  components: StockLine[]; partialBatch: boolean;
};

/** Original assembled contents held by this work order, not today's recipe. */
export function workKitComponentTrace(state: Pick<InventoryState, "kitAssemblies">, workOrderId: number): WorkKitComponentTrace[] {
  return (state.kitAssemblies ?? []).flatMap(assembly => assembly.positions
    .filter(position => position.kind === "work" && position.id === String(workOrderId) && position.quantity > 0)
    .map(position => ({
      sourceId: assembly.id, kitItemId: assembly.itemId, quantity: position.quantity,
      kitSerials: position.serials, partialBatch: position.quantity !== assembly.quantity,
      components: assembly.components.map(component => ({
        itemId: component.itemId, quantity: component.quantity * position.quantity / assembly.quantity,
        // A partial quantity batch cannot prove which component serials were used.
        serials: position.quantity === assembly.quantity ? component.serials : [],
      })),
    })));
}
