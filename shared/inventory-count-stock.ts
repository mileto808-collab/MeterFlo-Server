import type { InventoryCount, Stock } from "./inventory";

/** Compare physical stock, not JSON field/row ordering introduced by persistence. */
export function countStockMatches(snapshot: readonly Stock[], current: readonly Stock[]): boolean {
  if (snapshot.length !== current.length) return false;
  const signatures = (rows: readonly Stock[]) => rows.map(row => JSON.stringify([
    row.warehouseId, row.itemId, row.quantity, row.revision, [...row.serials].sort(),
  ])).sort();
  const before = signatures(snapshot), after = signatures(current);
  return before.every((value, index) => value === after[index]);
}

/** Selected counts protect the items being counted, not unrelated warehouse movements. */
export function countStockScopeMatches(count: InventoryCount, current: readonly Stock[], itemIds: Iterable<string>): boolean {
  if (count.scope !== "selected") return countStockMatches(count.snapshot, current);
  const selected = new Set(itemIds);
  return countStockMatches(
    count.snapshot.filter(row => selected.has(row.itemId)),
    current.filter(row => selected.has(row.itemId)),
  );
}
