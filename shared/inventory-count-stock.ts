import type { Stock } from "./inventory";

/** Compare physical stock, not JSON field/row ordering introduced by persistence. */
export function countStockMatches(snapshot: readonly Stock[], current: readonly Stock[]): boolean {
  if (snapshot.length !== current.length) return false;
  const signatures = (rows: readonly Stock[]) => rows.map(row => JSON.stringify([
    row.warehouseId, row.itemId, row.quantity, row.revision, [...row.serials].sort(),
  ])).sort();
  const before = signatures(snapshot), after = signatures(current);
  return before.every((value, index) => value === after[index]);
}
