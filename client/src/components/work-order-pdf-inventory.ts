import type { InventoryItem, Warehouse, WorkAllocation, WorkRequirements } from "@shared/inventory";
import { inventoryComponentDetails, type WorkKitComponentTrace } from "@shared/inventory-component-details";

export type WorkOrderPrintInventory = {
  enabled: boolean; allocation: WorkAllocation | null; requirements?: WorkRequirements;
  items: InventoryItem[]; warehouses: Pick<Warehouse, "id" | "code" | "name">[];
  componentTrace?: WorkKitComponentTrace[];
};
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const cell = (value: unknown) => `<td style="padding:4px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere;">${esc(value)}</td>`;
const table = (headers: string[], rows: string[]) => `<table style="width:100%;font-size:10px;border-collapse:collapse;table-layout:fixed;"><thead><tr>${headers.map(h => `<th style="text-align:left;padding:4px;border-bottom:1px solid #aaa;">${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;

export function buildWorkOrderInventoryHtml(enabled: boolean, snapshot?: WorkOrderPrintInventory): string {
  if (!enabled) return "";
  if (!snapshot) throw new Error("Inventory could not load. Retry before printing.");
  if (!snapshot.enabled) return "";
  const itemName = (id: string) => {
    const item = snapshot.items.find(value => value.id === id);
    return item ? `${item.sku} · ${item.name}` : id;
  };
  const location = (id: string) => {
    const warehouse = snapshot.warehouses.find(value => value.id === id);
    return warehouse ? `${warehouse.code} · ${warehouse.name}` : id;
  };
  const allocation = snapshot.allocation;
  const planned = snapshot.requirements?.lines ?? [];
  const plannedRows = planned.flatMap(line => {
    const item = snapshot.items.find(value => value.id === line.itemId);
    return [`<tr>${cell(itemName(line.itemId))}${cell(`${line.quantity} ${item?.unit ?? "units"}`)}</tr>`,
      ...inventoryComponentDetails(line.itemId, line.quantity, snapshot.items).map(component =>
        `<tr>${cell(`${"— ".repeat(component.depth)}${component.sku} · ${component.label}${component.labor ? " · Labor (non-stock)" : ""}`)}${cell(`${component.quantity} ${component.unit}`)}</tr>`)];
  });
  const stockRows = (lines: WorkAllocation["lines"]) => lines.map(line =>
    `<tr>${cell(itemName(line.itemId))}${cell(location(line.warehouseId))}${cell(line.quantity)}${cell(line.serials.join(", ") || "None")}</tr>`);
  const traces = (snapshot.componentTrace ?? []).map(trace => `<div style="margin-top:6px;break-inside:avoid;">
    <strong>Recorded original kit components: ${esc(itemName(trace.kitItemId))} · ${esc(trace.quantity)}</strong>
    ${trace.kitSerials.length ? `<p>Kit serials: ${esc(trace.kitSerials.join(", "))}</p>` : ""}
    ${table(["Component", "Quantity", "Recorded serials"], trace.components.map(component =>
      `<tr>${cell(itemName(component.itemId))}${cell(component.quantity)}${cell(component.serials.join(", ") || "None recorded")}</tr>`))}
    ${trace.partialBatch ? "<p>Partial quantity batch: individual component serial identities are not established by this record.</p>" : ""}
  </div>`).join("");
  return `<section style="background:#f1f5f2;padding:9px;border-left:4px solid #47715b;margin-bottom:10px;font-size:10px;">
    <h3 style="margin:0 0 6px;font-size:12px;">Inventory</h3>
    <h4>Planned requirements — not reserved</h4>
    <p>Components below describe the current planned recipe, not proof of installed component identities.</p>
    ${plannedRows.length ? table(["Item / component", "Required quantity"], plannedRows) : "<p>No mapped planned items.</p>"}
    ${snapshot.requirements?.missing.length ? `<p>Unmapped equipment types: ${snapshot.requirements.missing.map(m => esc(`${m.equipment} ${m.typeId}`)).join(", ")}</p>` : ""}
    <h4>${allocation?.status === "consumed" ? "Reservation record (stock already consumed)" : "Reserved stock"}</h4>
    ${allocation?.lines.length ? table(["Item", "Location", "Quantity", "Reserved serials"], stockRows(allocation.lines)) : "<p>No reserved stock lines.</p>"}
    <h4>${allocation?.status === "consumed" ? "Consumed inventory" : "Recorded actual use — not yet consumed"}</h4>
    <p>Review: ${esc(allocation?.mode ?? "Not reviewed")} · Status: ${esc(allocation?.status ?? "No assignment")}</p>
    ${allocation?.used.length ? table(["Item", "Location", "Actual quantity", "Actual serials"], stockRows(allocation.used)) : "<p>No actual inventory use recorded.</p>"}
    ${traces}
    ${allocation?.used.some(line => snapshot.items.find(item => item.id === line.itemId)?.components.length) && !traces ? "<p>Original kit component custody evidence is unavailable. Do not infer installed contents from the current recipe.</p>" : ""}
    ${allocation?.dispositions.length ? `<h4>Removed equipment</h4><ul>${allocation.dispositions.map(d => `<li>${esc(d.equipment)} ${esc(d.serial)} — ${esc(d.disposition)}${d.warehouseId ? ` to ${esc(location(d.warehouseId))}` : ""}</li>`).join("")}</ul>` : ""}
  </section>`;
}
