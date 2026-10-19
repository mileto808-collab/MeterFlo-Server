import type { StockBalanceRow } from "./inventory-stock-export";

type Availability = "all" | "in-stock" | "available" | "reserved" | "out-of-stock";
type SortBy = "item-asc" | "item-desc" | "location-asc" | "location-desc" | "available-asc" | "available-desc";
export type InventoryStockFilters = { warehouse: string; locationType: string; category: string; tracking: string; availability: Availability; sort: SortBy };
export const initialStockFilters: InventoryStockFilters = {
  warehouse: "all", locationType: "all", category: "all", tracking: "all", availability: "all", sort: "item-asc",
};

export function filterInventoryStockRows(rows: readonly StockBalanceRow[], query: string, filters: InventoryStockFilters): StockBalanceRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const result = rows.filter(row => {
    const available = row.quantity - row.reserved;
    if (needle && ![row.item.sku, row.item.name, row.warehouse.code, row.warehouse.name, ...row.serials]
      .join(" ").toLocaleLowerCase().includes(needle)) return false;
    if (filters.warehouse !== "all" && row.warehouseId !== filters.warehouse) return false;
    if (filters.locationType !== "all" && row.warehouse.locationTypeId !== filters.locationType) return false;
    if (filters.category !== "all" && row.item.category.trim() !== filters.category) return false;
    if (filters.tracking !== "all" && row.item.tracking !== filters.tracking) return false;
    if (filters.availability === "in-stock" && row.quantity <= 0) return false;
    if (filters.availability === "available" && available <= 0) return false;
    if (filters.availability === "reserved" && row.reserved <= 0) return false;
    if (filters.availability === "out-of-stock" && row.quantity > 0) return false;
    return true;
  });
  const descending = filters.sort.endsWith("desc");
  const sortType = filters.sort.split("-")[0];
  result.sort((a, b) => {
    const compare = sortType === "item"
      ? `${a.item.name} ${a.item.sku}`.localeCompare(`${b.item.name} ${b.item.sku}`)
      : sortType === "location"
        ? `${a.warehouse.name} ${a.warehouse.code}`.localeCompare(`${b.warehouse.name} ${b.warehouse.code}`)
        : (a.quantity - a.reserved) - (b.quantity - b.reserved);
    return descending ? -compare : compare;
  });
  return result;
}
