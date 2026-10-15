import type { InventoryState } from "./inventory";
import { orderLabel, orderReference } from "./inventory-order-labels";

export type OrderFilters = { query: string; type: string; status: string; vendorId: string; sourceId: string;
  destinationId: string; from: string; to: string; sort: "newest" | "oldest" | "number" };
export const emptyOrderFilters: OrderFilters = { query: "", type: "", status: "", vendorId: "", sourceId: "",
  destinationId: "", from: "", to: "", sort: "newest" };
export function orderDate(value: string, timezone: string) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (name: string) => parts.find(value => value.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function searchOrders(state: InventoryState, filters: OrderFilters, cleared: boolean, timezone: string) {
  const words = filters.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const items = new Map(state.items.map(value => [value.id, value]));
  const locations = new Map(state.warehouses.map(value => [value.id, value]));
  const vendors = new Map(state.vendors.map(value => [value.id, value]));
  return state.orders.filter(order => {
    if (!cleared && order.archivedAt || filters.type && order.type !== filters.type || filters.status && order.status !== filters.status ||
      filters.vendorId && order.vendorId !== filters.vendorId || filters.sourceId && order.sourceId !== filters.sourceId ||
      filters.destinationId && order.destinationId !== filters.destinationId) return false;
    if (filters.from || filters.to) {
      const day = orderDate(order.createdAt, timezone);
      if (!day || filters.from && day < filters.from || filters.to && day > filters.to) return false;
    }
    const text = [order.id, orderLabel(order), orderReference(order), vendors.get(order.vendorId || "")?.name,
      ...[order.sourceId, order.destinationId].flatMap(id => [locations.get(id || "")?.name, locations.get(id || "")?.code]),
      ...order.lines.flatMap(line => { const item = items.get(line.itemId); return [line.itemId, item?.sku, item?.name]; })]
      .join(" ").toLocaleLowerCase();
    return words.every(word => text.includes(word));
  }).sort((a, b) => {
    const number = () => orderLabel(a).localeCompare(orderLabel(b), undefined, { numeric: true }) || a.id.localeCompare(b.id);
    if (filters.sort === "number") return number();
    const ta = Date.parse(a.createdAt), tb = Date.parse(b.createdAt);
    if (!Number.isFinite(ta) || !Number.isFinite(tb)) return Number.isFinite(ta) ? -1 : Number.isFinite(tb) ? 1 : number();
    return (filters.sort === "oldest" ? ta - tb : tb - ta) || number();
  });
}
