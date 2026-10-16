import type { InventoryOrder, InventoryState } from "../../../shared/inventory";
import { orderLabel, orderReference } from "../../../shared/inventory-order-labels";
import { orderLineProgress } from "../../../shared/inventory-shipment-model";

export type InventoryOrderExportContext = { project: string; timezone: string };
type Cell = string | number;

export const inventoryOrderExportHeaders = [
  "Order number", "Reference", "Internal order ID", "Type", "Status", "Created at",
  "Vendor", "Source", "Destination", "SKU", "Product", "Ordered", "Dispatched",
  "Received", "Usable", "Damaged", "In transit", "Remaining", "Closed short", "Lost",
];

export function inventoryOrderExportRows(
  context: InventoryOrderExportContext, orders: readonly InventoryOrder[], state: InventoryState,
): Cell[][] {
  const items = new Map(state.items.map(item => [item.id, item]));
  const locations = new Map(state.warehouses.map(location => [location.id, `${location.name} (${location.code})`]));
  const vendors = new Map(state.vendors.map(vendor => [vendor.id, vendor.name]));
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: context.timezone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return orders.flatMap(order => {
    const createdAt = order.createdAt ? date.format(new Date(order.createdAt)) : "";
    const base = [orderLabel(order), orderReference(order), order.id, order.type, order.status, createdAt,
      vendors.get(order.vendorId || "") || "", locations.get(order.sourceId || "") || "",
      locations.get(order.destinationId) || ""];
    return order.lines.length ? order.lines.map(line => {
      const item = items.get(line.itemId), progress = orderLineProgress(state, order, line.itemId);
      return [...base, item?.sku || "", item?.name || "Product unavailable", progress.ordered, progress.dispatched,
        progress.received, progress.usable, progress.damaged, progress.inTransit, progress.remaining, progress.closedShort, progress.lost];
    }) : [[...base, "", "", 0, 0, 0, 0, 0, 0, 0, 0, 0]];
  });
}

/** CSV quoting alone does not prevent formulas executing in spreadsheet software. */
export function inventoryOrderCsvCell(value: Cell): string {
  const text = String(value);
  const safe = typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function inventoryOrderCsv(context: InventoryOrderExportContext, orders: readonly InventoryOrder[], state: InventoryState) {
  const headers = inventoryOrderExportHeaders.map(header => header === "Created at" ? `Created at (${context.timezone})` : header);
  return "\uFEFF" + [headers, ...inventoryOrderExportRows(context, orders, state)]
    .map(row => row.map(inventoryOrderCsvCell).join(",")).join("\r\n") + "\r\n";
}

export async function inventoryOrderWorkbook(context: InventoryOrderExportContext, orders: readonly InventoryOrder[], state: InventoryState) {
  const XLSX = await import("xlsx");
  const headers = inventoryOrderExportHeaders.map(header => header === "Created at" ? `Created at (${context.timezone})` : header);
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...inventoryOrderExportRows(context, orders, state)]);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    if (typeof sheet[key].v === "string") { sheet[key].t = "s"; sheet[key].z = "@"; delete sheet[key].f; }
  }
  sheet["!cols"] = headers.map((_, index) => ({ wch: [2, 6, 7, 8, 10].includes(index) ? 40 : 22 }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Orders");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Project", context.project], ["Timezone", context.timezone], ["Matching orders exported", orders.length],
    ["Scope", "All matching orders, not just the current page. One row per product line."],
    ["Identity", "Order number and reference are display values. Internal order ID is immutable."],
  ]), "Export details");
  return workbook;
}

const escape = (value: Cell) => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function inventoryOrderPrintHtml(context: InventoryOrderExportContext, orders: readonly InventoryOrder[], state: InventoryState) {
  const rows = inventoryOrderExportRows(context, orders, state);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.project)} — Inventory orders</title>
<style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}button{padding:10px}
table{table-layout:fixed;width:100%;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.context{font-size:12px}
@page{size:landscape;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:9pt}}</style></head>
<body><button onclick="window.print()">Print / Save PDF</button><h1>Purchase &amp; transfer orders</h1>
<p>${escape(context.project)} · ${orders.length} matching orders · ${rows.length} product lines · Timezone: ${escape(context.timezone)}</p>
<table><colgroup>${[13, 9, 13, 18, 22, 8, 8, 9].map(width => `<col style="width:${width}%">`).join("")}</colgroup>
<thead><tr><th class="context" colspan="8">${escape(context.project)} · ${orders.length} matching orders · Timezone: ${escape(context.timezone)}</th></tr>
<tr><th>Order / reference</th><th>Type / status</th><th>Created</th><th>Vendor / route</th><th>Product / SKU</th><th>Ordered</th><th>Received</th><th>Remaining</th></tr></thead><tbody>
${rows.map(row => `<tr><td>${escape(row[0])}${row[1] ? `<br>Reference: ${escape(row[1])}` : ""}</td>
<td>${escape(row[3])}<br>${escape(row[4])}</td><td>${escape(row[5])}</td>
<td>${row[6] ? `${escape(row[6])}<br>` : ""}${row[7] ? `From: ${escape(row[7])}<br>` : ""}To: ${escape(row[8])}</td>
<td>${escape(row[10])}<br>${escape(row[9])}</td><td>${escape(row[11])}</td><td>${escape(row[13])}</td><td>${escape(row[17])}</td></tr>`).join("")}
</tbody></table></body></html>`;
}

function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename;
  document.body.appendChild(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadInventoryOrders(
  format: "csv" | "xlsx" | "pdf", context: InventoryOrderExportContext,
  orders: readonly InventoryOrder[], state: InventoryState,
) {
  if (!orders.length) throw new Error("There are no matching orders to export.");
  if (format === "pdf") {
    const html = inventoryOrderPrintHtml(context, orders, state);
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("Allow popups for this site to open the printable PDF view.");
    popup.opener = null; popup.document.open(); popup.document.write(html); popup.document.close();
    return;
  }
  const filename = `${context.project.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "inventory"}-orders.${format}`;
  if (format === "csv") {
    save(new Blob([inventoryOrderCsv(context, orders, state)], { type: "text/csv;charset=utf-8" }), filename);
    return;
  }
  const workbook = await inventoryOrderWorkbook(context, orders, state);
  const XLSX = await import("xlsx");
  save(new Blob([XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true })],
    { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), filename);
}
