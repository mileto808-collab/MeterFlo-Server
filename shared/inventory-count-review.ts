import type { InventoryItem, Stock, StockLine } from "./inventory";

export type InventoryCountSerialChange = {
  itemId: string;
  itemName: string;
  sku: string;
  expectedQuantity: number;
  actualQuantity: number;
  missingSerials: string[];
  unexpectedSerials: string[];
  unchangedSerialCount: number;
};

/** Call only after count-line validation; this review never changes stock or input. */
export function inventoryCountSerialChanges(
  snapshot: readonly Stock[],
  lines: readonly StockLine[],
  items: readonly Pick<InventoryItem, "id" | "sku" | "name" | "tracking">[],
): InventoryCountSerialChange[] {
  const baseline = new Map(snapshot.map(row => [row.itemId, row]));
  const catalog = new Map(items.map(item => [item.id, item]));
  const changes: InventoryCountSerialChange[] = [];
  for (const line of lines) {
    const item = catalog.get(line.itemId);
    if (!item || item.tracking !== "serialized") continue;
    const expected = baseline.get(line.itemId);
    const expectedSerials = new Set(expected?.serials ?? []);
    const actualSerials = new Set(line.serials);
    const missingSerials = [...expectedSerials].filter(serial => !actualSerials.has(serial));
    const unexpectedSerials = [...actualSerials].filter(serial => !expectedSerials.has(serial));
    if (!missingSerials.length && !unexpectedSerials.length) continue;
    changes.push({
      itemId: item.id, itemName: item.name, sku: item.sku,
      expectedQuantity: expected?.quantity ?? 0, actualQuantity: line.quantity,
      missingSerials, unexpectedSerials,
      unchangedSerialCount: line.serials.length - unexpectedSerials.length,
    });
  }
  return changes;
}

/** Binds acknowledgement to the exact count, saved revision, quantities, identities and reason. */
export function inventoryCountReviewIdentity(
  countId: string,
  draftRevision: number,
  lines: readonly StockLine[],
  reason: string,
): string {
  return JSON.stringify({
    countId, draftRevision, reason,
    lines: lines.map(line => ({
      itemId: line.itemId, quantity: line.quantity, serials: [...line.serials].sort(),
    })).sort((a, b) => a.itemId.localeCompare(b.itemId)),
  });
}
