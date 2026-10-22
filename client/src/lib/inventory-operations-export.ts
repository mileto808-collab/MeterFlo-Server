import type { OperationsDataset, OperationsKind, OperationsRow } from "./inventory-operations-data";

type Context = { project: string; timezone: string };
const titles: Record<OperationsKind, string> = { locations: "Locations", exceptions: "Shipment exceptions", returns: "Removed Equipment", activity: "Activity", categories: "Categories", counts: "Cycle counts", fulfillment: "Completed batches" };
const escape = (value: string | number) => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
export const operationsExportRows = (dataset: OperationsDataset, rows: readonly OperationsRow[]) =>
  rows.map(row => dataset.columns.map(column => row.cells[column.key] ?? ""));

export function operationsCsv(dataset: OperationsDataset, rows: readonly OperationsRow[]) {
  return "\uFEFF" + [dataset.columns.map(c => c.label), ...operationsExportRows(dataset, rows)].map(row => row.map(value => {
    const text = String(value);
    const safe = typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}
export async function operationsWorkbook(context: Context, kind: OperationsKind, dataset: OperationsDataset, rows: readonly OperationsRow[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([dataset.columns.map(c => c.label), ...operationsExportRows(dataset, rows)]);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    if (typeof sheet[key].v === "string") { sheet[key].t = "s"; sheet[key].z = "@"; delete sheet[key].f; }
  }
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  sheet["!cols"] = dataset.columns.map(() => ({ wch: 24 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, titles[kind]);
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Project", context.project], ["Timezone", context.timezone], ["Matching records", rows.length],
    ["Scope", "All matching records in the selected sort order, not just the current page."],
    ["Serials", "Summary exports use serial counts for shipment holds. Removed equipment retains its individual serial identity."],
  ]), "Export details");
  return book;
}
export function operationsPrintHtml(context: Context, kind: OperationsKind, dataset: OperationsDataset, rows: readonly OperationsRow[]) {
  const printKeys: Record<OperationsKind, string[]> = {
    fulfillment: ["name", "mode", "workOrders", "source", "staging", "vehicle", "staged", "delivered", "completed"],
    locations: ["code", "name", "type", "status", "address", "plate", "assigned"],
    exceptions: ["reference", "order", "sku", "location", "status", "held", "actor", "date", "reason"],
    returns: ["equipment", "serial", "status", "workOrder", "location", "sku"],
    activity: ["receipt", "action", "reference", "location", "actor", "date", "items", "reason"],
    categories: ["name", "itemCount"],
    counts: ["reference", "location", "status", "snapshotItems", "snapshotQuantity", "countedItems", "countedQuantity", "reason"],
  };
  printKeys.returns.push("fieldDisposition", "warehouseDisposition");
  printKeys.returns.push(...["customerRecipient", "customerReference", "customerHandoffAt"].filter(key => rows.some(row => !!row.cells[key])));
  printKeys.activity.push("fieldDisposition", "warehouseDisposition", "custodyEvent");
  const cols = dataset.columns.filter(c => printKeys[kind].includes(c.key));
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.project)} — ${titles[kind]}</title>
<style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}button{padding:10px}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}@page{size:landscape;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:9pt}}</style></head>
<body><button onclick="window.print()">Print / Save PDF</button><h1>${titles[kind]}</h1><table><thead><tr><th colspan="${cols.length}">${escape(context.project)} · ${rows.length} matching records · Timezone: ${escape(context.timezone)}</th></tr>
<tr>${cols.map(c => `<th>${escape(c.label)}</th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${cols.map(c => `<td>${escape(row.cells[c.key] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}
export async function downloadInventoryOperations(format: "csv" | "xlsx" | "pdf", context: Context, kind: OperationsKind, dataset: OperationsDataset, rows: OperationsRow[]) {
  if (!rows.length) throw new Error("No matching records to export.");
  if (format === "pdf") {
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("The browser blocked the print window. Allow pop-ups and try again.");
    popup.opener = null;
    popup.document.open(); popup.document.write(operationsPrintHtml(context, kind, dataset, rows)); popup.document.close();
    return;
  }
  let blob: Blob;
  if (format === "csv") blob = new Blob([operationsCsv(dataset, rows)], { type: "text/csv;charset=utf-8" });
  else {
    const XLSX = await import("xlsx");
    blob = new Blob([XLSX.write(await operationsWorkbook(context, kind, dataset, rows), { bookType: "xlsx", type: "array" })],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url;
  link.download = `${context.project.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "inventory"}-${kind}.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
