import type { StockBalanceRow } from "./inventory-stock-export";

export type StockPage = {
  rows: StockBalanceRow[]; total: number; filtered: number; quantity: number; reserved: number; offset: number; revision: number;
};
export type SerialPage = { serials: string[]; total: number; filtered: number; offset: number; revision: number };
export type StockSummary = { locations: number; vehicles: number; items: number; serialized: number; quantity: number; orders: number; counts: number };
export function stockUrl(base: string, path: string, params: Record<string, string | number>) {
  return `${base}/stock${path}?${new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)]))}`;
}
export async function fetchStock<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  return response.json();
}
/** Exports fetch only the selected dataset, on demand, in bounded chunks.
 * A changing revision aborts rather than silently mixing pages or broadening scope.
 */
export function collectStockExport(
  base: string, path: string, params: Record<string, string | number>, field: "rows",
): Promise<StockBalanceRow[]>;
export function collectStockExport(
  base: string, path: string, params: Record<string, string | number>, field: "serials",
): Promise<string[]>;
export async function collectStockExport(
  base: string, path: string, params: Record<string, string | number>, field: "rows" | "serials",
): Promise<Array<StockBalanceRow | string>> {
  const result: Array<StockBalanceRow | string> = [];
  let revision: number | undefined, expected: number | undefined;
  for (let offset = 0; ; offset += 100) {
    const page = await fetchStock<StockPage | SerialPage>(stockUrl(base, path, { ...params, offset, limit: 100 }));
    if (revision !== undefined && (page.revision !== revision || page.filtered !== expected || page.offset !== offset))
      throw new Error("Stock changed while preparing this export. Refresh and retry.");
    revision = page.revision; expected = page.filtered;
    const entries = field === "rows" ? (page as StockPage).rows : (page as SerialPage).serials;
    result.push(...entries);
    if (result.length >= page.filtered) return result;
    if (!entries.length) throw new Error("The export could not be completed. Refresh and retry.");
  }
}
