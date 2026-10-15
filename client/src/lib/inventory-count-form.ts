import type { InventoryCount, InventoryItem, StockLine } from "@shared/inventory";

/** One model for both the visible rows and the submitted lines. */
export function inventoryCountRows(
  count: InventoryCount,
  items: InventoryItem[],
  quantities: Record<string, string>,
  serials: Record<string, string>,
) {
  const ids = new Set([...count.snapshot.map(row => row.itemId), ...items.filter(item => item.active).map(item => item.id)]);
  return [...ids].map(itemId => {
    const snapshot = count.snapshot.find(row => row.itemId === itemId);
    return {
      itemId, item: items.find(item => item.id === itemId),
      quantity: quantities[itemId] ?? String(snapshot?.quantity ?? 0),
      serials: serials[itemId] ?? snapshot?.serials.join("\n") ?? "",
    };
  });
}

export function inventoryCountLines(rows: ReturnType<typeof inventoryCountRows>): StockLine[] {
  if (rows.length > 500) throw new Error("This count exceeds the supported 500-item limit. Contact an administrator; no items were omitted.");
  return rows.map(row => {
    if (!row.item) throw new Error(`Count item ${row.itemId} is no longer in the catalog. Resolve it before posting.`);
    const name = `${row.item.sku} · ${row.item.name}`;
    const quantity = Number(row.quantity);
    if (!row.quantity.trim() || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000000)
      throw new Error(`${name}: enter a whole quantity from 0 to 1,000,000. Blank is not zero.`);
    const serials = row.item.tracking === "serialized"
      ? row.serials.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) : [];
    if (row.item.tracking === "serialized" && (serials.length !== quantity || new Set(serials).size !== serials.length))
      throw new Error(`${name}: record one distinct serial per counted unit. Clear the serial list when counting zero.`);
    return { itemId: row.itemId, quantity, serials };
  });
}
