import type { InventoryCount, InventoryItem } from "@shared/inventory";
import { COUNT_MAX_LINES, COUNT_MAX_BYTES } from "@shared/inventory-count-limits";

export type CountCaptureRow = { itemId: string; quantity: string; serials: string };
export type CountRecovery = {
  version: 1;
  writer: string;
  countId: string;
  baseline: string;
  revision: number;
  updatedAt: number;
  reason: string;
  rows: CountCaptureRow[];
};

export function countRecoveryPrefix(userId: string, projectId: string) {
  return `meterflo:count-capture:${encodeURIComponent(userId)}:${encodeURIComponent(projectId)}:`;
}

export function countRecoveryKey(prefix: string, record: Pick<CountRecovery, "countId" | "writer">) {
  return `${prefix}${encodeURIComponent(record.countId)}:${encodeURIComponent(record.writer)}`;
}

/** Compare immutable count baselines, not the warehouse's changing live stock. */
export function countRecoveryBaseline(count: InventoryCount) {
  return JSON.stringify([count.warehouseId, count.scope ?? "warehouse", count.snapshot.map(row =>
    [row.itemId, row.quantity, row.revision ?? 0, [...row.serials].sort()],
  ).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}

export function parseCountRecovery(raw: string | null): CountRecovery | null {
  if (!raw || raw.length > COUNT_MAX_BYTES * 2) return null;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || typeof value.writer !== "string" || !value.writer ||
      typeof value.countId !== "string" || !value.countId || typeof value.baseline !== "string" ||
      !Number.isSafeInteger(value.revision) || value.revision < 0 ||
      !Number.isSafeInteger(value.updatedAt) || value.updatedAt <= 0 ||
      typeof value.reason !== "string" || value.reason.length > 1000 ||
      !Array.isArray(value.rows) || value.rows.length > COUNT_MAX_LINES) return null;
    const ids = new Set<string>();
    for (const row of value.rows) {
      if (!row || typeof row.itemId !== "string" || !row.itemId || ids.has(row.itemId) ||
        typeof row.quantity !== "string" || typeof row.serials !== "string") return null;
      ids.add(row.itemId);
    }
    return value as CountRecovery;
  } catch { return null; }
}

export function readCountRecoveries(storage: Storage, prefix: string): CountRecovery[] {
  const records: CountRecovery[] = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(prefix)) continue;
    const record = parseCountRecovery(storage.getItem(key));
    if (record && countRecoveryKey(prefix, record) === key) records.push(record);
  }
  return records.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Never erase a capture that a different tab updated after it was offered. */
export function removeCountRecovery(storage: Storage, prefix: string, record: CountRecovery) {
  const key = countRecoveryKey(prefix, record);
  if (storage.getItem(key) === JSON.stringify(record)) storage.removeItem(key);
}

export function matchesCountProduct(item: InventoryItem | undefined, raw: string) {
  const query = raw.trim().toLowerCase();
  return !query || !!item && [item.sku, item.name, item.barcode, item.description]
    .some(value => value?.toLowerCase().includes(query));
}

export function resolveCountProductScan(items: InventoryItem[], raw: string, existingIds: string[]) {
  const code = raw.trim();
  if (!code) return { error: "Scan a barcode or search by SKU, name or description." } as const;
  // Exact text comparison preserves significant leading zeros. Barcodes take precedence over SKU.
  const barcodeMatches = items.filter(item => item.barcode?.trim() === code);
  const skuMatches = items.filter(item => item.sku.toLowerCase() === code.toLowerCase());
  const nameMatches = items.filter(item => item.active && item.name.toLowerCase() === code.toLowerCase());
  const matches = barcodeMatches.length ? barcodeMatches : skuMatches.length ? skuMatches
    : nameMatches.length ? nameMatches : items.filter(item => item.active &&
      [item.sku, item.name, item.description].some(value => value?.toLowerCase().includes(code.toLowerCase())));
  if (!matches.length) return { error: `No catalog item matches "${code}". Nothing was added.` } as const;
  if (matches.length !== 1) return { error: "More than one catalog item matches. Refine the search or choose a product below." } as const;
  const item = matches[0];
  if (!item.active) return { error: `${item.name} is inactive. Nothing was added.` } as const;
  if (existingIds.includes(item.id)) return { error: `${item.name} is already included. Its quantity was not changed.` } as const;
  if (existingIds.length >= COUNT_MAX_LINES) return { error: `This count already has the maximum ${COUNT_MAX_LINES} products.` } as const;
  return { item } as const;
}
