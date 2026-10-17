export type CountExportRow = {
  sku: string;
  name: string;
  tracking: string;
  expected: number;
  actual: string;
  serials: string;
};

export type CountExportContext = {
  project: string;
  location: string;
  countReference: string;
  scope: "selected" | "warehouse";
  exportScope: string;
};

const headings = ["SKU", "Item", "Tracking", "Expected quantity at count start", "Actual quantity", "Entered serials"];
const escape = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, character =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
const csvCell = (value: unknown) => {
  let text = String(value ?? "");
  // Treat user-entered text as text, never a spreadsheet formula.
  if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
};
const serialEntries = (value: string) => value.split(/[\n,;]/).filter(entry => entry.trim().length > 0);
const metadata = (context: CountExportContext, count: number) => [
  ["Project", context.project],
  ["Location", context.location],
  ["Count", context.countReference],
  ["Count scope", context.scope === "selected" ? "Selected items" : "Full warehouse"],
  ["Export scope", context.exportScope],
  ["Exported items", count],
  ["Values", "Includes current unsaved entries. Exporting does not save or post a count. Blank quantities are not zero."],
  ["Expected quantity", "Fixed stock snapshot at count start, not today's live stock."],
];

/** CSV retains raw captures, including blank quantities and serial separators. */
export function countEntriesCsv(rows: readonly CountExportRow[]): string {
  return "\uFEFF" + [headings, ...rows.map(row => [
    row.sku, row.name, row.tracking, row.expected, row.actual, row.serials,
  ])].map(row => row.map(csvCell).join(",")).join("\r\n");
}

/** Separate serial rows avoid Excel's per-cell text limit for large counts. */
export async function countEntriesWorkbook(context: CountExportContext, rows: readonly CountExportRow[]) {
  const XLSX = await import("xlsx");
  const book = XLSX.utils.book_new();
  const summary = XLSX.utils.aoa_to_sheet([
    [...headings.slice(0, -1), "Entered serial count"],
    ...rows.map(row => [row.sku, row.name, row.tracking, row.expected, row.actual, serialEntries(row.serials).length]),
  ]);
  const serialRows = rows.flatMap(row => serialEntries(row.serials).map((serial, index) =>
    [row.sku, row.name, index + 1, serial]));
  const serialSheet = XLSX.utils.aoa_to_sheet([["SKU", "Item", "Entry", "Entered serial"], ...serialRows]);
  const details = XLSX.utils.aoa_to_sheet(metadata(context, rows.length));
  for (const sheet of [summary, serialSheet, details]) {
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith("!") || typeof cell !== "object" || !cell || typeof cell.v !== "string") continue;
      cell.t = "s";
      cell.z = "@";
      delete cell.f;
    }
  }
  summary["!autofilter"] = { ref: summary["!ref"]! };
  summary["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 18 }, { wch: 20 }, { wch: 20 }, { wch: 20 }];
  serialSheet["!cols"] = [{ wch: 22 }, { wch: 36 }, { wch: 10 }, { wch: 32 }];
  details["!cols"] = [{ wch: 24 }, { wch: 110 }];
  XLSX.utils.book_append_sheet(book, summary, "Count entries");
  XLSX.utils.book_append_sheet(book, serialSheet, "Entered serials");
  XLSX.utils.book_append_sheet(book, details, "Export details");
  return book;
}

export function countEntriesPrintHtml(context: CountExportContext, rows: readonly CountExportRow[]) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escape(context.countReference)} — ${escape(context.project)}</title>
<style>body{font:12px Arial,sans-serif;margin:24px;color:#111}h1{font-size:22px}button{padding:10px}table{width:100%;table-layout:fixed;border-collapse:collapse}td,th{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}dt{font-weight:bold}dd{margin:0 0 6px}@page{size:landscape;margin:12mm}@media print{button{display:none}}</style></head><body>
<button onclick="window.print()">Print / Save PDF</button><h1>${escape(context.countReference)} · Count entries</h1>
<dl>${metadata(context, rows.length).map(([key, value]) => `<dt>${escape(key)}</dt><dd>${escape(value)}</dd>`).join("")}</dl>
<table><thead><tr>${[...headings.slice(0, -1), "Entered serial count"].map(heading => `<th>${escape(heading)}</th>`).join("")}</tr></thead><tbody>
${rows.map(row => `<tr>${[row.sku, row.name, row.tracking, row.expected, row.actual, serialEntries(row.serials).length].map(value => `<td>${escape(value)}</td>`).join("")}</tr>`).join("")}
</tbody></table>${rows.filter(row => row.serials).map(row => `<h2>${escape(row.sku)} · ${escape(row.name)} — Entered serials</h2><pre>${escape(row.serials)}</pre>`).join("")}</body></html>`;
}

export async function downloadCountEntries(format: "csv" | "xlsx" | "pdf", context: CountExportContext, rows: CountExportRow[]) {
  if (!rows.length) throw new Error("No count entries in the selected export scope.");
  if (format === "pdf") {
    const popup = window.open("", "_blank");
    if (!popup) throw new Error("The browser blocked the print window. Allow pop-ups and try again.");
    popup.opener = null;
    popup.document.open();
    popup.document.write(countEntriesPrintHtml(context, rows));
    popup.document.close();
    return;
  }
  let blob: Blob;
  if (format === "csv") blob = new Blob([countEntriesCsv(rows)], { type: "text/csv;charset=utf-8" });
  else {
    const XLSX = await import("xlsx");
    blob = new Blob([XLSX.write(await countEntriesWorkbook(context, rows), { bookType: "xlsx", type: "array" })],
      { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  const filename = `${context.project}-${context.countReference}-entries`.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 140);
  link.href = url;
  link.download = `${filename}.${format}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
