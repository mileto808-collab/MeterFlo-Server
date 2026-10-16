import type { AuditChange, AuditEvent } from "@shared/audit";

export type ReadableAuditEvent = AuditEvent & {
  eventReference?: string;
  entityReference?: string;
  operationReference?: string;
  projectReference?: string;
  displayChanges?: AuditChange[];
  displayMetadata?: Record<string, unknown>;
};

export type AuditExportContext = { timezone: string; scope: string };

const headers = ["Event reference", "Project", "Actor", "Action", "Entity", "Outcome", "Occurred at", "Changes"];
const text = (value: unknown) => value === null || value === undefined ? "" :
  typeof value === "string" ? value : JSON.stringify(value);

function safeCsvCell(value: unknown): string {
  const raw = text(value);
  const safe = /^[\s\uFEFF]*[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replace(/"/g, '""')}"`;
}

function eventValues(event: ReadableAuditEvent, timezone: string): string[] {
  const changes = event.displayChanges ?? event.changes ?? [];
  const readableEntity = event.entityReference || event.entityLabel || "Recorded entity";
  const readableProject = event.projectReference || event.projectLabel || (event.projectId ? `Project ${event.projectId}` : "Global");
  const occurredAt = (() => {
    const date = new Date(event.occurredAt);
    return Number.isNaN(date.getTime()) ? event.occurredAt : new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium", timeStyle: "medium", timeZone: timezone,
    }).format(date);
  })();
  return [
    event.eventReference || "Recorded event",
    readableProject,
    event.actorLabel || "Unknown actor",
    event.action,
    `${event.entityType} · ${readableEntity}`,
    event.outcome,
    occurredAt,
    changes.map(change => `${change.field}: ${text(change.before)} → ${text(change.after)}`).join(" | "),
  ];
}

export function auditCsv(events: ReadableAuditEvent[], context: AuditExportContext): string {
  const rows = [
    ["MeterFlo audit evidence", `Scope: ${context.scope}`, `Matching events: ${events.length}`, `Timezone: ${context.timezone}`],
    headers,
    ...events.map(event => eventValues(event, context.timezone)),
  ];
  return "\uFEFF" + rows.map(row => row.map(safeCsvCell).join(",")).join("\r\n") + "\r\n";
}

export async function auditWorkbook(events: ReadableAuditEvent[], context: AuditExportContext) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet([
    headers,
    ...events.map(event => eventValues(event, context.timezone)),
  ]);
  for (const key of Object.keys(sheet)) {
    if (key.startsWith("!")) continue;
    const cell = sheet[key];
    if (typeof cell.v === "string") { cell.t = "s"; cell.z = "@"; delete cell.f; }
  }
  sheet["!autofilter"] = { ref: sheet["!ref"]! };
  sheet["!cols"] = headers.map(() => ({ wch: 28 }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Audit evidence");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ["Export scope", context.scope],
    ["Matching events", events.length],
    ["Timezone", context.timezone],
    ["Coverage", "All matching authorized events, not only the current page."],
  ]), "Export details");
  return workbook;
}

const escapeHtml = (value: unknown) => text(value).replace(/[&<>"']/g, char =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function auditPrintHtml(events: ReadableAuditEvent[], context: AuditExportContext): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>MeterFlo audit evidence</title>
<style>body{font:12px Georgia,serif;margin:24px;color:#23363b;background:#fbfaf6}h1{font:600 24px Georgia,serif}button{padding:10px;border:1px solid #aab7b3;background:#e3ece8;border-radius:4px}table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border:1px solid #c7d1cc;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}@page{size:landscape;margin:12mm}@media print{body{margin:0}button{display:none}table{font-size:9pt}}</style></head>
<body><button onclick="window.print()">Print / Save PDF</button><h1>MeterFlo audit evidence</h1>
<p>Scope: ${escapeHtml(context.scope)} · ${events.length} matching events · Timezone: ${escapeHtml(context.timezone)} · All matching authorized events</p>
<table><thead><tr>${headers.map(header => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead><tbody>
${events.map(event => `<tr>${eventValues(event, context.timezone).map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("")}
</tbody></table></body></html>`;
}

export async function downloadAuditExport(format: "csv" | "xlsx" | "pdf", events: ReadableAuditEvent[], context: AuditExportContext, printWindow?: Window | null) {
  if (!events.length) throw new Error("There are no matching events to export.");
  if (format === "pdf") {
    const popup = printWindow ?? window.open("", "_blank");
    if (!popup) throw new Error("The browser blocked the print window. Allow pop-ups and try again.");
    popup.opener = null;
    popup.document.open(); popup.document.write(auditPrintHtml(events, context)); popup.document.close();
    return;
  }
  const blob = format === "csv"
    ? new Blob([auditCsv(events, context)], { type: "text/csv;charset=utf-8" })
    : new Blob([await (async () => {
      const XLSX = await import("xlsx");
      return XLSX.write(await auditWorkbook(events, context), { bookType: "xlsx", type: "array" });
    })()], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `meterflo-audit-${format === "xlsx" ? "evidence.xlsx" : "evidence.csv"}`;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
