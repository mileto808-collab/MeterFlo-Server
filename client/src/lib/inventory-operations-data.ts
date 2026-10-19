import { inventoryCategoryNames, type InventoryState } from "@shared/inventory";
import { inventoryActorLabel, inventoryHoldLabel, inventoryReceiptLabel, type InventoryActorLabel } from "@shared/inventory-display-labels";
import { inventoryCountReference } from "@shared/inventory-count-reference";
import { orderLabel, orderReference, uuidOrderId } from "@shared/inventory-order-labels";
import { holdStatus, remainingHold } from "@shared/inventory-shipment-model";
import { locationTypeFor, locationTypeLabel } from "@shared/inventory-location-types";
import { orderDate } from "@shared/inventory-order-search";
import { inventoryWorkOrderLabel, type InventoryWorkOrderLabels } from "@shared/inventory-work-order-labels";
import { removalConfig } from "@shared/inventory-removal-policy";
import { removalDispositionDisplay, warehouseRemovalDecision, removalFilterKey, removalActivityIndex, removalActivityDisplay } from "@shared/inventory-removal-display";

export type OperationsKind = "locations" | "exceptions" | "returns" | "activity" | "categories" | "counts";
export type OperationsRow = { id: string; search: string; cells: Record<string, string | number>; facets: Record<string, string>; facetValues?: Record<string, string[]>; timestamps?: string[] };
export type OperationsDataset = {
  rows: OperationsRow[];
  columns: { key: string; label: string }[];
  filters: { key: string; label: string; options: { value: string; label: string }[] }[];
  sorts: { key: string; label: string }[];
  defaultSort: string;
  dateFilterLabel?: string;
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
  users: readonly { id: string; username: string }[] = [], timezone = "UTC", workOrderLabels: InventoryWorkOrderLabels = {},
): OperationsDataset {
  const locations = new Map(state.warehouses.map(w => [w.id, w]));
  const locationTypes = new Map((state.locationTypes ?? []).map(type => [type.id, type]));
  const items = new Map(state.items.map(i => [i.id, i]));
  const orders = new Map(state.orders.map(o => [o.id, o]));
  const people = [...actors, ...users];
  const dispositionOptions = { fieldDisposition: new Map<string, string>(), warehouseDisposition: new Map<string, string>() };
  for (const rule of removalConfig(state).rules) dispositionOptions[rule.stage === "field" ? "fieldDisposition" : "warehouseDisposition"]
    .set(removalFilterKey(rule.id, rule.outcome), `${rule.name}${rule.active ? "" : " (inactive)"}`);
  const rememberDisposition = (key: keyof typeof dispositionOptions, display: { key: string; label: string }) => {
    if (!dispositionOptions[key].has(display.key)) dispositionOptions[key].set(display.key, display.label);
    return display;
  };
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
    const catalog = state.categoryCatalog;
    const categoryRows = catalog !== undefined
      ? catalog.map(category => ({
        id: category.id,
        name: category.name,
        itemCount: state.items.filter(item => item.categoryId === category.id).length,
      }))
      : inventoryCategoryNames(state).map(name => ({
        id: name,
        name,
        itemCount: state.items.filter(item => item.category.trim().toLowerCase() === name.trim().toLowerCase()).length,
      }));
    rows = categoryRows.map(({ id, name, itemCount }) => {
      return textSearch({
        id,
        cells: { name, itemCount },
        facets: { usage: itemCount > 0 ? "In use" : "Unused" },
      });
    });
    cols = columns([["name", "Category"], ["itemCount", "Items"]]);
    filterKeys = [["usage", "Usage"]];
    sorts = [{ key: "name:asc", label: "Name · A–Z" }, { key: "name:desc", label: "Name · Z–A" },
      { key: "itemCount:desc", label: "Most items" }, { key: "itemCount:asc", label: "Fewest items" }];
  } else if (kind === "counts") {
    const countDates = new Map<string, string[]>();
    for (const receipt of state.receipts) if (receipt.action.startsWith("count")) {
      const dates = countDates.get(receipt.reference) ?? [];
      dates.push(receipt.occurredAt);
      countDates.set(receipt.reference, dates);
    }
    rows = state.counts.map((count, index) => {
      const snapshotQuantity = count.snapshot.reduce((total, line) => total + line.quantity, 0);
      const countedQuantity = (count.lines ?? []).reduce((total, line) => total + line.quantity, 0);
      const location = locationName(count.warehouseId);
      return textSearch({
        id: count.id,
        cells: {
          reference: inventoryCountReference(state.counts, count.id),
          location,
          status: count.status,
          snapshotItems: count.snapshot.length,
          snapshotQuantity,
          countedItems: count.lines?.length ?? 0,
          countedQuantity,
          reason: count.reason ?? count.draft?.reason ?? "",
          sequence: index + 1,
        },
        facets: { warehouse: count.warehouseId, status: count.status },
        timestamps: [...(countDates.get(count.id) ?? []), ...(count.draft?.savedAt ? [count.draft.savedAt] : [])],
      }, [count.id]);
    });
    cols = columns([["reference", "Count"], ["location", "Location"], ["status", "Status"],
      ["snapshotItems", "Snapshot items"], ["snapshotQuantity", "Snapshot units"],
      ["countedItems", "Counted items"], ["countedQuantity", "Counted units"], ["reason", "Reason"]]);
    filterKeys = [["status", "Status"], ["warehouse", "Location"]];
    sorts = [{ key: "sequence:desc", label: "Newest first" }, { key: "sequence:asc", label: "Oldest first" },
      { key: "location:asc", label: "Location · A–Z" }, { key: "status:asc", label: "Status · A–Z" }];
  } else if (kind === "locations") {
    rows = state.warehouses.map(w => textSearch({
      id: w.id, cells: {
        code: w.code, name: w.name, type: locationTypeLabel(state, w),
        status: w.active ? "Active" : "Inactive", address: w.address, city: w.city, state: w.state, zip: w.zip,
        contact: w.contact, phone: w.phone, location: w.location, vin: w.vin, plate: w.plate, plateState: w.plateState,
        make: w.make, model: w.model, year: w.year ?? "", assigned: w.assignedUserId ? inventoryActorLabel(w.assignedUserId, people) : "Unassigned",
        authorized: w.userIds.map(id => inventoryActorLabel(id, people)).join("; "),
      }, facets: { type: locationTypeFor(state, w)?.id ?? w.locationTypeId ?? w.type,
        status: w.active ? "Active" : "Inactive", assigned: w.assignedUserId ? "Assigned" : "Unassigned" },
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
      }, facets: { warehouse: h.warehouseId, status: holdStatus(h), tracking: item?.tracking ?? "Unknown", actor: h.actor },
      timestamps: [h.occurredAt] },
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
    rows = state.returns.map(r => {
      const field = rememberDisposition("fieldDisposition", removalDispositionDisplay(state, r, "field"));
      const decision = warehouseRemovalDecision(r);
      const warehouse = decision ? rememberDisposition("warehouseDisposition", removalDispositionDisplay(state, decision, "warehouse")) : undefined;
      return textSearch({ id: r.id, cells: {
      equipment: r.equipment === "system" ? "System" : "Module", serial: r.serial, status: r.status,
      workOrder: inventoryWorkOrderLabel(r.workOrderId, workOrderLabels), location: locationName(r.warehouseId), fieldDisposition: field.label,
      warehouseDisposition: warehouse?.label ?? (r.disposition === "returned" ? "No warehouse decision recorded" : "Not applicable"),
      sku: r.itemId ? items.get(r.itemId)?.sku ?? "Unavailable item" : "", item: r.itemId ? items.get(r.itemId)?.name ?? "Unavailable item" : "",
    }, facets: { equipment: r.equipment, status: r.status, warehouse: r.warehouseId ?? "none",
      fieldDisposition: field.key, warehouseDisposition: warehouse?.key ?? "none" },
    timestamps: (r.history ?? []).map(event => event.occurredAt) });
    });
    cols = columns([["equipment", "Equipment"], ["serial", "Serial"], ["status", "Status"], ["workOrder", "Work order"],
      ["location", "Return location"], ["fieldDisposition", "Field disposition"], ["warehouseDisposition", "Warehouse decision"], ["sku", "SKU"], ["item", "Released item"]]);
    filterKeys = [["equipment", "Equipment"], ["status", "Status"], ["warehouse", "Return location"], ["fieldDisposition", "Field disposition"], ["warehouseDisposition", "Warehouse decision"]];
    sorts = [{ key: "workOrder:desc", label: "Work order · highest first" }, { key: "workOrder:asc", label: "Work order · lowest first" },
      { key: "serial:asc", label: "Serial · A–Z" }, { key: "status:asc", label: "Status · A–Z" }];
  } else {
    const removalEvents = removalActivityIndex(state);
    rows = state.receipts.map((r, index) => {
      const removal = removalActivityDisplay(state, removalEvents.get(r.id) ?? []);
      removal.fields.forEach(display => rememberDisposition("fieldDisposition", display));
      removal.decisions.forEach(display => rememberDisposition("warehouseDisposition", display));
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
        items: (r.kitInspection ? [r.kitInspection] : r.lines).map(l => `${items.get(l.itemId)?.sku ?? "Unavailable item"} · ${items.get(l.itemId)?.name ?? ""} × ${l.quantity}`).join("; "),
        quantity: r.kitInspection?.quantity ?? r.lines.reduce((n, l) => n + l.quantity, 0), damaged: (r.damaged ?? []).reduce((n, l) => n + l.quantity, 0) +
          (r.kitConversion?.recovered ?? []).reduce((n, l) => n + l.damagedQuantity, 0),
        componentsOut: r.action === "assemble" ? (r.components ?? []).map(l => `${items.get(l.itemId)?.sku ?? "Unavailable item"} × ${l.quantity}`).join("; ") : "",
        componentsIn: r.action === "disassemble" ? (r.components ?? []).map(l => `${items.get(l.itemId)?.sku ?? "Unavailable item"} × ${l.quantity}`).join("; ") : "",
        missingComponents: (r.kitConversion?.recovered ?? []).filter(l => l.missingQuantity).map(l => `${items.get(l.itemId)?.sku ?? "Unavailable item"} × ${l.missingQuantity}`).join("; "),
        sourceAssembly: r.sourceReceiptId ? inventoryReceiptLabel(state.receipts, r.sourceReceiptId) :
          r.kitConversion ? inventoryReceiptLabel(state.receipts, r.kitConversion.assemblyId) :
          r.kitHoldId ? inventoryReceiptLabel(state.receipts, state.kitHolds?.find(h => h.id === r.kitHoldId)?.assemblyId ?? "") : "",
        inspectionSerials: r.kitInspection?.serials.join("; ") ?? "",
        reason: r.reason ?? "", resolution: r.resolution ?? "", externalReference: r.externalReference ?? "",
        fieldDisposition: removal.fieldLabel, warehouseDisposition: removal.decisionLabel, custodyEvent: removal.custodyLabel,
      }, facets: { action: r.action, warehouse: r.warehouseId ?? "none", actor: r.actor },
      facetValues: { fieldDisposition: removal.fields.length ? removal.fields.map(field => field.key) : ["none"],
        warehouseDisposition: removal.decisions.length ? removal.decisions.map(decision => decision.key) : ["none"] } },
      [r.reference, r.id, ...r.lines.flatMap(l => [items.get(l.itemId)?.sku, ...l.serials]),
        ...(r.components ?? []).flatMap(l => [items.get(l.itemId)?.sku, ...l.serials]), ...(r.kitInspection?.serials ?? []),
        ...(r.kitConversion?.recovered ?? []).flatMap(l => [items.get(l.itemId)?.sku, l.reason, ...l.damagedSerials, ...l.missingSerials])]);
    });
    cols = columns([["receipt", "Receipt"], ["action", "Action"], ["reference", "Order / operation"], ["orderReference", "Order reference"],
      ["location", "Location"], ["actor", "User"], ["date", `Date (${timezone})`], ["items", "Items"], ["quantity", "Quantity"],
      ["damaged", "Damaged quantity"], ["reason", "Reason"], ["resolution", "Resolution"], ["externalReference", "External reference"]]);
    cols.push(...columns([["componentsOut", "Components consumed"], ["componentsIn", "Usable components returned"],
      ["missingComponents", "Missing components"], ["sourceAssembly", "Original assembly"], ["inspectionSerials", "Inspection serials"]]));
    cols.push(...columns([["fieldDisposition", "Field disposition"], ["warehouseDisposition", "Warehouse decision"], ["custodyEvent", "Custody event"]]));
    filterKeys = [["action", "Action"], ["warehouse", "Location"], ["actor", "User"], ["fieldDisposition", "Field disposition"], ["warehouseDisposition", "Warehouse decision"]];
    sorts = [{ key: "sequence:desc", label: "Newest first" }, { key: "sequence:asc", label: "Oldest first" },
      { key: "action:asc", label: "Action · A–Z" }];
  }
  return {
    rows: kind === "activity" ? rows.map(row => ({ ...row, timestamps: [String(row.cells.occurredAt)] })) : rows,
    columns: cols, sorts, defaultSort: sorts[0].key,
    dateFilterLabel: ({ returns: "Custody or decision activity", counts: "Count activity", exceptions: "Arrival recorded", activity: "Movement recorded" } as Partial<Record<OperationsKind, string>>)[kind],
    filters: filterKeys.map(([key, label]) => ({
      key, label, options: [...new Set([
        ...(key === "fieldDisposition" || key === "warehouseDisposition" ? dispositionOptions[key].keys() : []),
        ...rows.flatMap(r => r.facetValues?.[key] ?? [r.facets[key]]),
      ])].map(value => ({
        value, label: key === "warehouse" ? locationName(value === "none" ? null : value) :
          key === "fieldDisposition" || key === "warehouseDisposition" ? dispositionOptions[key].get(value) ?? `No ${key === "fieldDisposition" ? "field disposition" : "warehouse decision"} recorded` :
          key === "actor" ? inventoryActorLabel(value, people) :
          key === "type" ? locationTypes.get(value)?.name ?? (value === "physical" ? "Warehouse" : value === "vehicle" ? "Vehicle" : value) : value,
      })).sort((a, b) => a.label.localeCompare(b.label)),
    })),
  };
}

export function filterOperationsRows(dataset: OperationsDataset, query: string, selected: Record<string, string>, sort: string,
  dates?: { from: string; to: string; timezone: string }): OperationsRow[] {
  const needle = query.trim().toLocaleLowerCase();
  const [key, direction] = sort.split(":");
  if (dataset.dateFilterLabel && dates?.from && dates.to && dates.from > dates.to) return [];
  return dataset.rows.filter(row => (!needle || row.search.includes(needle)) &&
    Object.entries(selected).every(([facet, value]) => !value || value === "all" ||
      (row.facetValues?.[facet] ?? [row.facets[facet]]).includes(value)) &&
    (!dataset.dateFilterLabel || !dates || !dates.from && !dates.to || (row.timestamps ?? []).some(timestamp => {
      const day = orderDate(timestamp, dates.timezone);
      return !!day && (!dates.from || day >= dates.from) && (!dates.to || day <= dates.to);
    })))
    .sort((a, b) => {
      const left = a.cells[key] ?? "", right = b.cells[key] ?? "";
      const comparison = typeof left === "number" && typeof right === "number" ? left - right :
        String(left).localeCompare(String(right), undefined, key === "workOrder" ? { numeric: true } : undefined);
      return direction === "desc" ? -comparison : comparison;
    });
}
