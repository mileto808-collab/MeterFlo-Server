import type { InventoryItem, Warehouse, WorkAllocation, WorkRequirements } from "@shared/inventory";
import { inventoryComponentDetails, type WorkKitComponentTrace } from "@shared/inventory-component-details";

export type WorkOrderPrintInventory = {
  enabled: boolean; allocation: WorkAllocation | null; requirements?: WorkRequirements;
  items: InventoryItem[]; warehouses: Pick<Warehouse, "id" | "code" | "name">[];
  componentTrace?: WorkKitComponentTrace[];
};
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** A concise work-order summary, not the inventory custody/transaction report. */
export function buildWorkOrderInventoryHtml(enabled: boolean, snapshot?: WorkOrderPrintInventory): string {
  if (!enabled) return "";
  if (!snapshot) throw new Error("Inventory could not load. Retry before printing.");
  if (!snapshot.enabled) return "";
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  const allocation = snapshot.allocation;
  const actual = allocation?.status === "consumed" || !!allocation?.used.length;
  const planned = snapshot.requirements?.lines ?? [];
  const roots = actual ? allocation?.used ?? [] : allocation?.status === "released" ? [] : planned;
  const rows: { itemId: string; quantity: number; depth: number; allowance?: boolean }[] = [];
  for (const line of roots) {
    rows.push({ ...line, depth: 0 });
    if (!actual) {
      rows.push(...inventoryComponentDetails(line.itemId, line.quantity, snapshot.items)
        .map(component => ({ ...component, allowance: component.labor })));
    }
  }
  if (actual) {
    // Only recorded original contents describe completed kits, never today's recipe.
    for (const trace of snapshot.componentTrace ?? []) {
      rows.push(...trace.components.map(line => ({ ...line, depth: 1 })));
    }
    // Labor is non-stock. Keep configured allowances distinct from worked time.
    if (allocation?.mode !== "reading_only") for (const line of planned) {
      rows.push(...inventoryComponentDetails(line.itemId, line.quantity, snapshot.items)
        .filter(component => component.labor)
        .map(component => ({ ...component, allowance: true })));
    }
  }
  const hasBilling = rows.some(row => {
    const rate = items.get(row.itemId)?.billingRate;
    return typeof rate === "number" && Number.isFinite(rate);
  });
  const cell = (value: unknown) => `<td style="padding:4px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere;">${esc(value)}</td>`;
  const body = rows.map(row => {
    const item = items.get(row.itemId);
    const rate = item?.billingRate;
    const description = `${row.depth ? "— ".repeat(row.depth) : ""}${item ? `${item.sku} · ${item.name}` : row.itemId}${row.allowance ? " · Labor allowance" : item?.kind === "labor" ? " · Labor" : ""}`;
    return `<tr>${cell(description)}${cell(`${Number(row.quantity.toFixed(6))} ${item?.unit ?? "units"}`)}${hasBilling ? cell(typeof rate === "number" && Number.isFinite(rate) ? rate.toFixed(2) : "—") : ""}</tr>`;
  }).join("");
  const headers = ["Item / labor", "Quantity", ...(hasBilling ? ["Billing rate"] : [])];
  const reservationSummary = allocation?.status === "reserved" && allocation.lines.length
    ? `<p>Reserved, not consumed: ${allocation.lines.map(line => esc(`${items.get(line.itemId)?.sku ?? line.itemId} · ${line.quantity} at ${
      snapshot.warehouses.find(warehouse => warehouse.id === line.warehouseId)?.name ?? line.warehouseId}${
      line.reservationMode === "quantity" ? " (quantity hold; installed serial not selected)" : line.serials.length ? " (specific serials reserved)" : ""}`)).join("; ")}.</p>` : "";
  return `<section style="margin-bottom:10px;font-size:10px;">
    <h3 style="margin:0 0 6px;font-size:12px;">Inventory — ${actual ? "Recorded items & labor" : "Planned items & labor"}</h3>
    ${reservationSummary}
    ${rows.length ? `<table style="width:100%;font-size:10px;border-collapse:collapse;table-layout:fixed;"><thead><tr>${headers.map(header =>
      `<th style="text-align:left;padding:4px;border-bottom:1px solid #aaa;">${esc(header)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table>` : "<p>No inventory line items recorded.</p>"}
  </section>`;
}
