import type { InventoryOrder, InventoryState } from "./inventory";

export const uuidOrderId = (id: string) => /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
export const orderLabel = (order: InventoryOrder) => order.orderNumber || (uuidOrderId(order.id) ?
  `${order.type === "purchase" ? "PO" : "TR"} · number pending` : order.id);
export const orderReference = (order: InventoryOrder) => order.reference ?? (uuidOrderId(order.id) ? "" : order.id);
const parts = (value: string) => /^(PO|TR)-(\d{4})-([0-9]{6,9})$/i.exec(value);

export function orderHighWater(state: InventoryState) {
  const counters = { ...state.orderNumberCounters };
  for (const order of state.orders) for (const label of [order.orderNumber, order.id]) {
    const match = label && parts(label);
    if (match) counters[match[2]] = Math.max(counters[match[2]] || 0, Number(match[3]));
  }
  return counters;
}
export function mergeOrderHighWater(restored: InventoryState, local?: InventoryState) {
  if (!local) return restored;
  const a = orderHighWater(restored), b = orderHighWater(local);
  if (!Object.keys(a).length && !Object.keys(b).length) return restored;
  const previous = new Map(local.orders.map(order => [order.id, order]));
  const merged = { ...restored, orders: restored.orders.map(order => {
    const prior = previous.get(order.id);
    if (!prior?.orderNumber) return order;
    if (order.type !== prior.type || order.orderNumber && order.orderNumber !== prior.orderNumber)
      throw new Error("Restored order number conflicts with a locally issued number.");
    return order.orderNumber ? order : { ...order, orderNumber: prior.orderNumber };
  }), orderNumberCounters: Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])]
    .map(year => [year, Math.max(a[year] || 0, b[year] || 0)])) };
  validateOrderNumbers(merged);
  return merged;
}
export function allocateOrderNumber(state: InventoryState, type: InventoryOrder["type"], at: string) {
  const year = String(new Date(at).getUTCFullYear());
  if (!/^\d{4}$/.test(year)) throw new Error("Cannot number an order without a valid year.");
  const counters = orderHighWater(state);
  const used = new Set(state.orders.flatMap(order => [order.orderNumber || "", order.id]).map(value => value.toUpperCase()));
  let next = counters[year] || 0, number: string;
  do {
    if (++next > 999999999) throw new Error("Order number limit reached for this year.");
    number = `${type === "purchase" ? "PO" : "TR"}-${year}-${String(next).padStart(6, "0")}`;
  } while (used.has(number));
  state.orderNumberCounters = { ...counters, [year]: next };
  return number;
}
export function validateOrderNumbers(state: InventoryState) {
  const labels = new Map<string, string>();
  if (new Set(state.orders.map(order => order.id)).size !== state.orders.length) throw new Error("Duplicate inventory order ID.");
  for (const order of state.orders) {
    if (order.reference !== undefined && (typeof order.reference !== "string" || order.reference.length > 100))
      throw new Error("Invalid inventory order reference.");
    if (order.orderNumber !== undefined) {
      const match = typeof order.orderNumber === "string" && parts(order.orderNumber);
      if (!match || Number(match[3]) < 1 || match[1].toUpperCase() !== (order.type === "purchase" ? "PO" : "TR"))
        throw new Error("Invalid inventory order number.");
    }
    for (const label of [order.orderNumber, uuidOrderId(order.id) ? undefined : order.id]) if (label) {
      const normalized = label.toUpperCase(), previous = labels.get(normalized);
      if (previous && previous !== order.id) throw new Error("Duplicate inventory order number or legacy label.");
      labels.set(normalized, order.id);
    }
  }
  if (state.orderNumberCounters !== undefined) {
    if (!state.orderNumberCounters || typeof state.orderNumberCounters !== "object" || Array.isArray(state.orderNumberCounters))
      throw new Error("Invalid order numbering counters.");
    const required = orderHighWater({ ...state, orderNumberCounters: undefined });
    for (const [year, value] of Object.entries(state.orderNumberCounters))
      if (!/^\d{4}$/.test(year) || !Number.isSafeInteger(value) || value < 0 || value > 999999999 || value < (required[year] || 0))
        throw new Error("Invalid or rewound order numbering counter.");
    if (Object.keys(required).some(year => state.orderNumberCounters![year] === undefined))
      throw new Error("Missing order numbering high-water counter.");
  }
}
