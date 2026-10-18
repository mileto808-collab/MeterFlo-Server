import type { InventoryItem, Vendor } from "@shared/inventory";

export type CatalogKind = "items" | "vendors";
type Cell = string | number;
type Context = { project: string; timezone: string };
const headers = {
  items: ["Product ID / SKU", "Name / product label", "Description", "Category", "Unit", "Tracking", "Equipment", "Barcode", "Manufacturer", "Model", "Vendor", "Cost", "Reorder point", "Status", "Kit components", "Image URLs", "Item type", "Billing rate"],
  vendors: ["Name", "Contact", "Address", "Phone", "Email", "Reference", "Status"],
};
const escape = (value: Cell) => String(value).replace(/[&<>"']/g, c =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function catalogExportRows(kind: CatalogKind, rows: readonly (InventoryItem | Vendor)[], vendors: readonly Vendor[]): Cell[][] {
  const vendorNames = new Map(vendors.map(v => [v.id, v.name]));
  return rows.map(row => {
    if (kind === "vendors") {
      const v = row as Vendor;
      return [v.name, v.contact, v.address, v.phone, v.email, v.reference, v.active ? "Active" : "Inactive"];
    }
    const i = row as InventoryItem;
    return [i.sku, i.name, i.description, i.category, i.unit, i.tracking, i.equipment, i.barcode,
      i.manufacturer, i.model, i.vendorId ? vendorNames.get(i.vendorId) ?? "Unavailable vendor" : "",
      i.cost, i.reorderPoint, i.active ? "Active" : "Inactive", i.components.length, i.images.join("\n"), i.kind ?? "stock", i.billingRate ?? 0];
  });
}

export function catalogCsv(kind: CatalogKind, rows: readonly (InventoryItem | Vendor)[], vendors: readonly Vendor[]) {
  return "\uFEFF" + [headers[kind], ...catalogExportRows(kind, rows, vendors)].map(row => row.map(value => {
    const text = String(value);
    const safe = typeof value === "string" && /^[\s\uFEFF]*[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n") + "\r\n";
}

export async function catalogWorkbook(context: Context, kind: CatalogKind, rows: readonly (InventoryItem | Vendor)[], vendors: readonly Vendor[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([headers[kind], ...catalogExportRows(kind, rows, vendors)]);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    if (typeof sheet[key].v === "string") {
      sheet[key].t = "s"; sheet[key].z = "@"; delete sheet[key].f;
    }
  }
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  sheet["!cols"] = headers[kind].map(() => ({ wch: 24 }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, kind === "items" ? "Items" : "Vendors");
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
    ["Project", context.project], ["Timezone", context.timezone], ["Matching records", rows.length],
    ["Scope", "All matching records in the selected sort order, not just the current page."],
  ]), "Export details");
  return book;
}

export function catalogPrintHtml(context: Context, kind: CatalogKind, rows: readonly (InventoryItem | Vendor)[], vendors: readonly Vendor[]) {
  // Keep printed columns legible; full catalog fields remain in CSV and Excel.
  const indices = kind === "items" ? [0, 1, 4, 16, 11, 17, 13, 14] : headers.vendors.map((_, i) => i);
  const title = kind === "items" ? "Items" : "Vendors";
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.project)} — ${title}</title>
<style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}button{padding:10px}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1px solid #bbb;padding:5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}@page{size:landscape;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:9pt}}</style></head>
<body><button onclick="window.print()">Print / Save PDF</button><h1>${title}</h1>
<table><thead><tr><th colspan="${indices.length}">${escape(context.project)} · ${rows.length} matching ${kind} · Timezone: ${escape(context.timezone)}</th></tr>
<tr>${indices.map(i => `<th>${escape(headers[kind][i])}</th>`).join("")}</tr></thead><tbody>
${catalogExportRows(kind, rows, vendors).map(row => `<tr>${indices.map(i => `<td>${escape(row[i])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`;
}

export async function downloadInventoryCatalog(format: "csv" | "xlsx" | "pdf", context: Context, kind: CatalogKind, rows: (InventoryItem | Vendor)[], vendors: Vendor[]) {
  if (!rows.length) throw new Error(`No matching ${kind} to export.`);
  if (format === "pdf") {
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("The browser blocked the print window. Allow pop-ups and try again.");
    popup.opener = null;
    popup.document.open(); popup.document.write(catalogPrintHtml(context, kind, rows, vendors)); popup.document.close();
    return;
  }
  let blob: Blob;
  if (format === "csv") blob = new Blob([catalogCsv(kind, rows, vendors)], { type: "text/csv;charset=utf-8" });
  else {
    const XLSX = await import("xlsx");
    blob = new Blob([XLSX.write(await catalogWorkbook(context, kind, rows, vendors), { bookType: "xlsx", type: "array" })],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${context.project.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 80) || "inventory"}-${kind}.${format}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
