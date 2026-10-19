import type { InventoryItem, Stock, Warehouse } from "../../../shared/inventory";

export type StockBalanceRow = Stock & {
  item: Pick<InventoryItem, "id" | "sku" | "name" | "category" | "unit" | "tracking">;
  warehouse: Pick<Warehouse, "id" | "name" | "code" | "type" | "locationTypeId"> & { locationTypeName?: string };
  reserved: number; serialCount?: number;
};
export type StockExportContext = { project: string; timezone: string };
type Cell = string | number;
const headers = ["SKU", "Item", "Category", "Unit", "Tracking", "Location code", "Location",
  "Location type", "On hand", "Reserved", "Available", "Serial count"];
const escape = (value: Cell) => String(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function stockBalanceExportRows(rows: readonly StockBalanceRow[]): Cell[][] {
  return rows.map(row => [row.item.sku, row.item.name, row.item.category, row.item.unit, row.item.tracking,
    row.warehouse.code, row.warehouse.name, row.warehouse.locationTypeName ?? row.warehouse.type, row.quantity, row.reserved,
    row.quantity - row.reserved, row.serialCount ?? row.serials.length]);
}

export function stockBalanceCsv(rows: readonly StockBalanceRow[]) {
  return "\uFEFF" + [headers, ...stockBalanceExportRows(rows)].map(row => row.map(value => {
    const text = String(value);
    const safe = typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}

export async function stockBalanceWorkbook(context: StockExportContext, rows: readonly StockBalanceRow[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...stockBalanceExportRows(rows)]);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    if (typeof sheet[key].v === "string") {
      sheet[key].t = "s"; sheet[key].z = "@"; delete sheet[key].f;
    }
  }
  sheet["!cols"] = headers.map((_, index) => ({ wch: [1, 6].includes(index) ? 36 : 20 }));
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Stock balances");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Project", context.project], ["Timezone", context.timezone], ["Matching balances", rows.length],
    ["Scope", "All matching balances in the selected sort order, not just the current page."],
    ["Serials", "Counts only. Use the stock serial viewer to export individual serial identities."],
    ["Availability", "On hand minus reserved; reserved stock is not available."],
  ]), "Export details");
  return book;
}

export function stockBalancePrintHtml(context: StockExportContext, rows: readonly StockBalanceRow[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.project)} — Stock balances</title>
<style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}button{padding:10px}
table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}
.number{text-align:right;font-variant-numeric:tabular-nums}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
@page{size:landscape;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:9pt}}</style></head>
<body><button onclick="window.print()">Print / Save PDF</button><h1>On hand by location</h1>
<p>${escape(context.project)} · ${rows.length} matching balances · Timezone: ${escape(context.timezone)}</p>
<p>Available = on hand − reserved. Individual serial identities are available from the serial viewer.</p>
<table><colgroup>${[26, 24, 15, 9, 9, 9, 8].map(width => `<col style="width:${width}%">`).join("")}</colgroup>
<thead><tr><th colspan="7">${escape(context.project)} · ${rows.length} matching balances · Timezone: ${escape(context.timezone)}</th></tr>
<tr><th>Item / SKU</th><th>Location / code</th><th>Category / tracking</th><th>On hand</th><th>Reserved</th><th>Available</th><th>Serial count</th></tr></thead><tbody>
${rows.map(row => `<tr><td>${escape(row.item.name)}<br>${escape(row.item.sku)}</td><td>${escape(row.warehouse.name)}<br>${escape(row.warehouse.code)}</td>
<td>${escape(row.item.category)}<br>${escape(row.item.tracking)}</td>
<td class="number">${row.quantity}</td><td class="number">${row.reserved}</td><td class="number">${row.quantity - row.reserved}</td>
<td class="number">${row.serialCount ?? row.serials.length}</td></tr>`).join("")}</tbody></table></body></html>`;
}

export async function downloadInventoryStock(
  format: "csv" | "xlsx" | "pdf", context: StockExportContext, rows: readonly StockBalanceRow[],
  printWindow?: Window,
) {
  if (!rows.length) throw new Error("No matching stock balances to export.");
  if (format === "pdf") {
    const popup = printWindow ?? window.open("", "_blank");
    if (!popup) throw new Error("The browser blocked the print window. Allow pop-ups and try again.");
    popup.opener = null;
    popup.document.open(); popup.document.write(stockBalancePrintHtml(context, rows)); popup.document.close();
    return;
  }
  let blob: Blob;
  if (format === "csv") blob = new Blob([stockBalanceCsv(rows)], { type: "text/csv;charset=utf-8" });
  else {
    const XLSX = await import("xlsx");
    blob = new Blob([XLSX.write(await stockBalanceWorkbook(context, rows), { bookType: "xlsx", type: "array" })],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${context.project.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "inventory"}-stock.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
