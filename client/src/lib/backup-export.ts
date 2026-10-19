import { apiRequest } from "@/lib/queryClient";

export type BackupRunExportFormat = "csv" | "xlsx" | "print";

export interface BackupRunExportFilters {
  search?: string;
  status?: string;
  backupType?: string;
  scheduleId?: string;
  from?: string;
  to?: string;
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number | null | undefined>>) {
  const encode = (value: string | number | null | undefined) => {
    let cell = value == null ? "" : String(value);
    if (/^[=+\-@]/.test(cell)) cell = `'${cell}`;
    return `"${cell.replaceAll('"', '""')}"`;
  };
  const csv = [headers, ...rows].map(row => row.map(encode).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function makeExportUrl(format: BackupRunExportFormat, filters: BackupRunExportFilters) {
  const params = new URLSearchParams({ format });
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, value);
  });
  return `/api/maintenance/backups/runs/export?${params.toString()}`;
}

export async function exportBackupRuns(format: BackupRunExportFormat, filters: BackupRunExportFilters) {
  const response = await apiRequest("GET", makeExportUrl(format, filters));
  if (!response.ok) {
    let message = "Could not export backup history.";
    try {
      const body = await response.json();
      message = body.message || message;
    } catch {
      // Keep the user-facing fallback if the server returned a non-JSON error.
    }
    throw new Error(message);
  }

  if (format === "print") {
    const html = await response.text();
    const printWindow = window.open("", "_blank");
    if (!printWindow) throw new Error("Allow pop-ups to open the print view.");
    printWindow.opener = null;
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
    return;
  }

  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const filename = disposition.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]
    ?.replaceAll('"', "")
    || `meterflo-backup-history.${format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = decodeURIComponent(filename);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
