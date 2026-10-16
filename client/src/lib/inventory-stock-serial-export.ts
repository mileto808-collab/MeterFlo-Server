export type StockSerialExportContext = {
  project: string;
  sku: string;
  item: string;
  location: string;
  locationCode: string;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function stockSerialFilename(context: StockSerialExportContext, extension: string) {
  const stem = [context.sku, context.locationCode].filter(Boolean).join("-")
    .replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "stock";
  return `${stem}-serials.${extension}`;
}

export function stockSerialCsv(serials: readonly string[]) {
  // Match the other Inventory CSV exports: quoted text, UTF-8, and formula protection.
  const quote = (value: string) => {
    const safe = /^[\s\uFEFF]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  return "\uFEFF" + ["Serial", ...serials].map(quote).join("\r\n") + "\r\n";
}

export async function stockSerialWorkbook(context: StockSerialExportContext, serials: readonly string[]) {
  const XLSX = await import("xlsx");
  const rows = [
    ["Project", context.project], ["Item", context.item], ["SKU", context.sku],
    ["Location", context.location], ["Location code", context.locationCode],
    ["Exported serial count", String(serials.length)],
    ["Stock scope", "On-hand serials, including reserved units. Not an availability report."],
    [], ["Serial"],
    ...serials.map(serial => [serial]),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  // Every cell, including formula-like identities, is explicitly plain text.
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    sheet[key].t = "s";
    sheet[key].z = "@";
    delete sheet[key].f;
  }
  sheet["!cols"] = [{ wch: 34 }, { wch: 65 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Stock serials");
  return workbook;
}

export function stockSerialPrintHtml(context: StockSerialExportContext, serials: readonly string[]) {
  const identity = `${context.project} · ${context.sku} — ${context.item} · ${context.location} (${context.locationCode})`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(context.sku)} — Stock serials</title>
<style>
body{font:14px Arial,sans-serif;margin:24px;color:#111}
h1{font-size:22px}p{line-height:1.5}button{padding:10px 16px}
table{width:100%;border-collapse:collapse;table-layout:fixed}
col.number{width:4rem}th,td{padding:6px 8px;border:1px solid #bbb;text-align:left;vertical-align:top}
.identity{font-size:12px;overflow-wrap:anywhere}td.serial{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}
@page{size:auto;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:10pt}}
</style></head><body><button onclick="window.print()">Print / Save PDF</button>
<h1>Stock serials</h1><p>${escapeHtml(identity)}<br>Exported serial count: ${serials.length}<br>
On-hand serials, including reserved units. Not an availability report.</p>
<table><colgroup><col class="number"><col></colgroup><thead>
<tr><th colspan="2" class="identity">${escapeHtml(identity)} · ${serials.length} serials</th></tr>
<tr><th scope="col">No.</th><th scope="col">Serial</th></tr></thead><tbody>
${serials.map((serial, index) => `<tr><td>${index + 1}</td><td class="serial">${escapeHtml(serial)}</td></tr>`).join("")}
</tbody></table></body></html>`;
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function downloadStockSerials(
  format: "xlsx" | "csv" | "pdf",
  context: StockSerialExportContext,
  serials: readonly string[],
  printWindow?: Window,
) {
  if (!serials.length) throw new Error("There are no serials to export.");
  // Snapshot the selected scope before any asynchronous workbook work.
  const selected = [...serials];
  if (format === "pdf") {
    // Open synchronously in the click gesture so popup blocking is detectable.
    const popup = printWindow ?? window.open("", "_blank");
    if (!popup) throw new Error("Allow popups for this site to open the printable PDF view.");
    popup.opener = null;
    popup.document.open();
    popup.document.write(stockSerialPrintHtml(context, selected));
    popup.document.close();
    return;
  }
  if (format === "csv") {
    saveBlob(new Blob([stockSerialCsv(selected)], { type: "text/csv;charset=utf-8" }),
      stockSerialFilename(context, "csv"));
    return;
  }
  const XLSX = await import("xlsx");
  const workbook = await stockSerialWorkbook(context, selected);
  const bytes = XLSX.write(workbook, { type: "array", bookType: "xlsx", compression: true });
  saveBlob(new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    stockSerialFilename(context, "xlsx"));
}
