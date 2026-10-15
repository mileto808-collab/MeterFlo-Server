import type { InventoryCount, InventoryItem, StockLine } from "@shared/inventory";
import { COUNT_MAX_LINES, COUNT_MAX_SERIALS, countPayloadFits } from "@shared/inventory-count-limits";

/** One model for both the visible rows and the submitted lines. */
export function inventoryCountRows(
  count: InventoryCount,
  items: InventoryItem[],
  quantities: Record<string, string>,
  serials: Record<string, string>,
) {
  const ids = new Set([...count.snapshot.map(row => row.itemId), ...count.draft?.rows.map(row => row.itemId) ?? [],
    ...Object.keys(quantities), ...Object.keys(serials)]);
  const itemMap = new Map(items.map(item => [item.id, item]));
  const snapshotMap = new Map(count.snapshot.map(row => [row.itemId, row]));
  const savedMap = new Map(count.draft?.rows.map(row => [row.itemId, row]) ?? []);
  return [...ids].map(itemId => {
    const snapshot = snapshotMap.get(itemId), saved = savedMap.get(itemId);
    return {
      itemId, item: itemMap.get(itemId),
      quantity: quantities[itemId] ?? saved?.quantity ?? String(snapshot?.quantity ?? 0),
      serials: serials[itemId] ?? saved?.serials ?? snapshot?.serials.join("\n") ?? "",
    };
  });
}

export function inventoryCountLines(rows: ReturnType<typeof inventoryCountRows>): StockLine[] {
  if (rows.length > COUNT_MAX_LINES) throw new Error(`This count exceeds the supported ${COUNT_MAX_LINES}-item limit. No items were omitted.`);
  const lines = rows.map(row => {
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
  if (lines.reduce((sum, line) => sum + line.serials.length, 0) > COUNT_MAX_SERIALS)
    throw new Error(`This count exceeds the ${COUNT_MAX_SERIALS}-serial limit. No items were omitted.`);
  if (!countPayloadFits({ lines })) throw new Error("Count data exceeds the 8 MiB limit. No items were omitted.");
  return lines;
}
