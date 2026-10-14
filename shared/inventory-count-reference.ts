/**
 * Counts are append-only in the canonical project ledger. Derive a readable
 * ordinal from that persisted order, not a filtered/sorted presentation list.
 * Keep UUIDs as the identifiers for commands, relationships and audit history.
 */
export function inventoryCountReference(counts: readonly { id: string }[], id: string): string {
  const index = counts.findIndex(count => count.id === id);
  return index < 0 ? "Count (reference unavailable)" : `Count #${index + 1}`;
}
