import * as XLSX from "xlsx";
import type { Project } from "@shared/schema";

export type ProjectExportFormat = "csv" | "xlsx" | "pdf";

const columns: Array<{ key: keyof Project; label: string }> = [
  { key: "id", label: "Project ID" },
  { key: "name", label: "Name" },
  { key: "description", label: "Description" },
  { key: "customerEmail", label: "Customer email" },
  { key: "createdAt", label: "Created (UTC)" },
  { key: "isActive", label: "Status" },
];

function cellValue(project: Project, key: keyof Project): string {
  const value = project[key];
  if (key === "id") return String(value ?? "");
  if (key === "isActive") return value === false ? "Inactive" : "Active";
  if (key === "createdAt" && value) {
    const date = new Date(value as string | number | Date);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
  }
  return value == null ? "" : String(value);
}

function protectSpreadsheetText(value: string): string {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

function csvCell(value: string): string {
  return `"${protectSpreadsheetText(value).replace(/"/g, '""')}"`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Export the complete already-filtered and permission-scoped project list.
 * Returns false only when the browser blocks the PDF/print popup.
 */
export function exportProjects(format: ProjectExportFormat, projects: Project[]): boolean {
  if (!projects.length) return true;
  const records = projects.map(project => columns.map(column => cellValue(project, column.key)));
  const date = new Date().toISOString().slice(0, 10);

  if (format === "csv") {
    const rows = [columns.map(column => column.label), ...records];
    saveBlob(new Blob(["\uFEFF", rows.map(row => row.map(csvCell).join(",")).join("\r\n")], {
      type: "text/csv;charset=utf-8",
    }), `projects-${date}.csv`);
    return true;
  }

  if (format === "xlsx") {
    const worksheet = XLSX.utils.aoa_to_sheet([
      columns.map(column => column.label),
      ...records.map(row => row.map(protectSpreadsheetText)),
    ]);
    worksheet["!cols"] = columns.map((column, columnIndex) => {
      const widest = records.reduce((maximum, row) => Math.max(maximum, row[columnIndex].length), column.label.length + 2);
      return { wch: Math.min(48, widest) };
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Projects");
    XLSX.writeFile(workbook, `projects-${date}.xlsx`);
    return true;
  }

  const printWindow = window.open("", "_blank");
  if (!printWindow) return false;
  printWindow.opener = null;
  const header = columns.map(column => `<th>${escapeHtml(column.label)}</th>`).join("");
  const body = records.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join("")}</tr>`).join("");
  printWindow.document.open();
  printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Projects</title>
    <style>body{font:12px system-ui,sans-serif;color:#17221f;padding:24px}h1{font-size:20px}
    table{width:100%;border-collapse:collapse}th,td{text-align:left;border:1px solid #ccd5d1;padding:6px;vertical-align:top}
    th{background:#eaf0ed}td{overflow-wrap:anywhere}@media print{body{padding:0}}</style></head>
    <body><h1>Projects</h1><p>${projects.length} projects · ${escapeHtml(date)}</p>
    <table><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table>
    <script>window.addEventListener("load",()=>window.print());</script></body></html>`);
  printWindow.document.close();
  return true;
}
