import { inventoryCategoryNames, type InventoryState } from "@shared/inventory";
import { inventoryActorLabel, inventoryHoldLabel, inventoryReceiptLabel, type InventoryActorLabel } from "@shared/inventory-display-labels";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { orderLabel, orderReference, uuidOrderId } from "@shared/inventory-order-labels";
import { holdStatus, remainingHold } from "@shared/inventory-shipment-model";

export type OperationsKind = "locations" | "exceptions" | "returns" | "activity" | "categories";
export type OperationsRow = { id: string; search: string; cells: Record<string, string | number>; facets: Record<string, string> };
export type OperationsDataset = {
  rows: OperationsRow[];
  columns: { key: string; label: string }[];
  filters: { key: string; label: string; options: { value: string; label: string }[] }[];
  sorts: { key: string; label: string }[];
  defaultSort: string;
};
const columns = (pairs: [string, string][]) => pairs.map(([key, label]) => ({ key, label }));
const textSearch = (row: Omit<OperationsRow, "search">, extra: unknown[] = []): OperationsRow =>
  ({ ...row, search: [...Object.values(row.cells), ...extra].join(" ").toLocaleLowerCase() });
const displayTime = (iso: string, timezone: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString("en-US", { timeZone: timezone });
};

export function buildOperationsDataset(
  kind: OperationsKind, state: InventoryState, actors: readonly InventoryActorLabel[] = [],
  users: readonly { id: string; username: string }[] = [], timezone = "UTC",
): OperationsDataset {
  const locations = new Map(state.warehouses.map(w => [w.id, w]));
  const items = new Map(state.items.map(i => [i.id, i]));
  const orders = new Map(state.orders.map(o => [o.id, o]));
  const people = [...actors, ...users];
  const locationName = (id: string | null) => id ? locations.get(id)?.name ?? "Unavailable location" : "Not recorded";
  const orderName = (id: string) => {
    const order = orders.get(id);
    return order ? orderLabel(order) : uuidOrderId(id) ? "Order (reference unavailable)" : id;
  };
  let rows: OperationsRow[];
  let cols: OperationsDataset["columns"];
  let filterKeys: [string, string][];
  let sorts: OperationsDataset["sorts"];
  if (kind === "categories") {
    const categoryNames = inventoryCategoryNames(state);
    rows = categoryNames.map(name => {
      const itemCount = state.items.filter(item => item.category.trim().toLowerCase() === name.trim().toLowerCase()).length;
      return textSearch({
        id: name,
        cells: { name, itemCount },
        facets: { usage: itemCount > 0 ? "In use" : "Unused" },
      });
    });
    cols = columns([["name", "Category"], ["itemCount", "Items"]]);
    filterKeys = [["usage", "Usage"]];
    sorts = [{ key: "name:asc", label: "Name · A–Z" }, { key: "name:desc", label: "Name · Z–A" },
      { key: "itemCount:desc", label: "Most items" }, { key: "itemCount:asc", label: "Fewest items" }];
  } else if (kind === "locations") {
    rows = state.warehouses.map(w => textSearch({
      id: w.id, cells: {
        code: w.code, name: w.name, type: w.type === "vehicle" ? "Vehicle" : "Warehouse",
        status: w.active ? "Active" : "Inactive", address: w.address, city: w.city, state: w.state, zip: w.zip,
        contact: w.contact, phone: w.phone, location: w.location, vin: w.vin, plate: w.plate, plateState: w.plateState,
        make: w.make, model: w.model, year: w.year ?? "", assigned: w.assignedUserId ? inventoryActorLabel(w.assignedUserId, people) : "Unassigned",
        authorized: w.userIds.map(id => inventoryActorLabel(id, people)).join("; "),
      }, facets: { type: w.type, status: w.active ? "Active" : "Inactive", assigned: w.assignedUserId ? "Assigned" : "Unassigned" },
    }));
    cols = columns([["code", "Location code"], ["name", "Location"], ["type", "Type"], ["status", "Status"], ["address", "Address"],
      ["city", "City"], ["state", "State"], ["zip", "Postal code"], ["contact", "Contact"], ["phone", "Phone"], ["location", "Location notes"],
      ["vin", "VIN"], ["plate", "License plate"], ["plateState", "Plate jurisdiction"], ["make", "Make"], ["model", "Model"], ["year", "Year"],
      ["assigned", "Assigned user"], ["authorized", "Additional authorized users"]]);
    filterKeys = [["type", "Location type"], ["status", "Status"], ["assigned", "User assignment"]];
    sorts = [{ key: "name:asc", label: "Name · A–Z" }, { key: "name:desc", label: "Name · Z–A" }, { key: "code:asc", label: "Code · A–Z" }];
  } else if (kind === "exceptions") {
    rows = (state.shipmentHolds ?? []).map(h => {
      const item = items.get(h.itemId), order = orders.get(h.orderId), remaining = remainingHold(h);
      return textSearch({ id: h.id, cells: {
        reference: inventoryHoldLabel(state.shipmentHolds ?? [], h.id), order: orderName(h.orderId),
        orderReference: order ? orderReference(order) : "", receipt: inventoryReceiptLabel(state.receipts, h.receiptId),
        sku: item?.sku ?? "Unavailable item", item: item?.name ?? "Unavailable item", location: locationName(h.warehouseId),
        status: holdStatus(h), quantity: h.quantity, held: remaining.quantity, serialCount: remaining.serials.length,
        unidentified: remaining.unidentifiedQuantity, actor: inventoryActorLabel(h.actor, people),
        date: displayTime(h.occurredAt, timezone), occurredAt: h.occurredAt, reason: h.reason,
      }, facets: { warehouse: h.warehouseId, status: holdStatus(h), tracking: item?.tracking ?? "Unknown", actor: h.actor } },
      [h.orderId, h.receiptId, ...h.serials, ...h.expectedSerials]);
    });
    cols = columns([["reference", "Hold"], ["order", "Order"], ["orderReference", "Order reference"], ["receipt", "Receipt"],
      ["sku", "SKU"], ["item", "Item"], ["location", "Location"], ["status", "Status"], ["quantity", "Original quantity"],
      ["held", "Still held"], ["serialCount", "Known serial count"], ["unidentified", "Unidentified units"], ["actor", "Received by"],
      ["date", `Date (${timezone})`], ["reason", "Reason"]]);
    filterKeys = [["warehouse", "Location"], ["status", "Status"], ["tracking", "Tracking"], ["actor", "Received by"]];
    sorts = [{ key: "occurredAt:desc", label: "Newest first" }, { key: "occurredAt:asc", label: "Oldest first" },
      { key: "item:asc", label: "Item · A–Z" }, { key: "held:desc", label: "Most units held" }];
  } else if (kind === "returns") {
    rows = state.returns.map(r => textSearch({ id: r.id, cells: {
      equipment: r.equipment === "system" ? "System" : "Module", serial: r.serial, status: r.status,
      workOrder: r.workOrderId, location: locationName(r.warehouseId), disposition: r.disposition,
      sku: r.itemId ? items.get(r.itemId)?.sku ?? "Unavailable item" : "", item: r.itemId ? items.get(r.itemId)?.name ?? "Unavailable item" : "",
    }, facets: { equipment: r.equipment, status: r.status, warehouse: r.warehouseId ?? "none", disposition: r.disposition } }));
    cols = columns([["equipment", "Equipment"], ["serial", "Serial"], ["status", "Status"], ["workOrder", "Work order"],
      ["location", "Return location"], ["disposition", "Disposition"], ["sku", "SKU"], ["item", "Released item"]]);
    filterKeys = [["equipment", "Equipment"], ["status", "Status"], ["warehouse", "Return location"], ["disposition", "Disposition"]];
    sorts = [{ key: "workOrder:desc", label: "Work order · highest first" }, { key: "workOrder:asc", label: "Work order · lowest first" },
      { key: "serial:asc", label: "Serial · A–Z" }, { key: "status:asc", label: "Status · A–Z" }];
  } else {
    rows = state.receipts.map((r, index) => {
      const order = orders.get(r.reference);
      const returned = state.returns.find(value => value.id === r.reference);
      const item = items.get(r.reference);
      const reference = r.action.startsWith("count") ? inventoryCountReference(state.counts, r.reference) :
        order ? orderLabel(order) : r.holdId ? inventoryHoldLabel(state.shipmentHolds ?? [], r.holdId) :
        returned ? `Removed equipment · ${returned.serial}` : item ? `${item.sku} · ${item.name}` :
        uuidOrderId(r.reference) ? "Operation (reference unavailable)" : r.reference;
      return textSearch({ id: r.id, cells: {
        receipt: inventoryReceiptLabel(state.receipts, r.id), sequence: index + 1, action: r.action, reference,
        orderReference: order ? orderReference(order) : "", location: locationName(r.warehouseId), actor: inventoryActorLabel(r.actor, people),
        date: displayTime(r.occurredAt, timezone), occurredAt: r.occurredAt,
        items: r.lines.map(l => `${items.get(l.itemId)?.sku ?? "Unavailable item"} · ${items.get(l.itemId)?.name ?? ""} × ${l.quantity}`).join("; "),
        quantity: r.lines.reduce((n, l) => n + l.quantity, 0), damaged: (r.damaged ?? []).reduce((n, l) => n + l.quantity, 0),
        reason: r.reason ?? "", resolution: r.resolution ?? "", externalReference: r.externalReference ?? "",
      }, facets: { action: r.action, warehouse: r.warehouseId ?? "none", actor: r.actor } },
      [r.reference, r.id, ...r.lines.flatMap(l => [items.get(l.itemId)?.sku, ...l.serials])]);
    });
    cols = columns([["receipt", "Receipt"], ["action", "Action"], ["reference", "Order / operation"], ["orderReference", "Order reference"],
      ["location", "Location"], ["actor", "User"], ["date", `Date (${timezone})`], ["items", "Items"], ["quantity", "Quantity"],
      ["damaged", "Damaged quantity"], ["reason", "Reason"], ["resolution", "Resolution"], ["externalReference", "External reference"]]);
    filterKeys = [["action", "Action"], ["warehouse", "Location"], ["actor", "User"]];
    sorts = [{ key: "sequence:desc", label: "Newest first" }, { key: "sequence:asc", label: "Oldest first" },
      { key: "action:asc", label: "Action · A–Z" }];
  }
  return {
    rows, columns: cols, sorts, defaultSort: sorts[0].key,
    filters: filterKeys.map(([key, label]) => ({
      key, label, options: [...new Set(rows.map(r => r.facets[key]))].map(value => ({
        value, label: key === "warehouse" ? locationName(value === "none" ? null : value) :
          key === "actor" ? inventoryActorLabel(value, people) : value === "physical" ? "Warehouse" :
          value === "vehicle" ? "Vehicle" : value,
      })).sort((a, b) => a.label.localeCompare(b.label)),
    })),
  };
}

export function filterOperationsRows(dataset: OperationsDataset, query: string, selected: Record<string, string>, sort: string): OperationsRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const [key, direction] = sort.split(":");
  return dataset.rows.filter(row => (!needle || row.search.includes(needle)) &&
    Object.entries(selected).every(([facet, value]) => !value || value === "all" || row.facets[facet] === value))
    .sort((a, b) => {
      const left = a.cells[key] ?? "", right = b.cells[key] ?? "";
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
      return direction === "desc" ? -comparison : comparison;
    });
}
