import type { EquipmentVisibility } from "@shared/project-equipment-scope";

interface PdfEquipmentData {
  oldSystemId?: string | null;
  newSystemId?: string | null;
  oldSystemReading?: string | number | null;
  newSystemReading?: string | number | null;
  oldSystemType?: string | null;
  newSystemType?: string | null;
  oldModuleId?: string | null;
  newModuleId?: string | null;
  oldModuleRead?: string | number | null;
  newModuleRead?: string | number | null;
  oldModuleType?: string | null;
  newModuleType?: string | null;
  oldGps?: string | null;
  newGps?: string | null;
}

function text(value: string | number | null | undefined): string {
  return String(value ?? "-").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]!));
}

function row(label: string, value: string | number | null | undefined): string {
  return `<tr>
    <td style="font-weight: bold; width: 100px; padding: 2px 0;">${label}:</td>
    <td style="padding: 2px 0;">${text(value === "" ? null : value)}</td>
  </tr>`;
}

function column(heading: string, rows: string): string {
  return `<div>
    <h3 style="margin: 0 0 6px 0; font-size: 12px; font-weight: bold; color: #333;">${heading}</h3>
    <table style="width: 100%; font-size: 11px;"><tbody>${rows}</tbody></table>
  </div>`;
}

function table(columns: string[]): string {
  if (!columns.length) return "";
  return `<table style="width: 100%; border-collapse: collapse; margin-bottom: 10px;">
    <tbody><tr>${columns.map((content, index) => `<td style="width: ${100 / columns.length}%; vertical-align: top;${columns.length === 2 ? index === 0 ? " padding-right: 10px;" : " padding-left: 10px;" : ""}">${content}</td>`).join("")}</tr></tbody>
  </table>`;
}

/** Render only permitted, populated equipment; never alter historical values. */
export function buildWorkOrderEquipmentHtml(
  workOrder: PdfEquipmentData,
  visibility: EquipmentVisibility,
): string {
  const hasOldSystem = visibility.showSystem && !!(workOrder.oldSystemId || workOrder.oldSystemReading != null || workOrder.oldSystemType);
  const hasNewSystem = visibility.showSystem && !!(workOrder.newSystemId || workOrder.newSystemReading != null || workOrder.newSystemType);
  const hasOldModule = visibility.showModule && !!(workOrder.oldModuleId || workOrder.oldModuleRead != null || workOrder.oldModuleType);
  const hasNewModule = visibility.showModule && !!(workOrder.newModuleId || workOrder.newModuleRead != null || workOrder.newModuleType);

  // GPS is shared. Attach it to a visible device on each side, or render it
  // independently when all equipment for that side is absent or hidden.
  const systemColumns: string[] = [];
  const moduleColumns: string[] = [];
  const gpsColumns: string[] = [];
  for (const side of ["old", "new"] as const) {
    const old = side === "old";
    const label = old ? "Old" : "New";
    const hasSystem = old ? hasOldSystem : hasNewSystem;
    const hasModule = old ? hasOldModule : hasNewModule;
    const gps = workOrder[`${side}Gps`];
    if (hasSystem) {
      systemColumns.push(column(`${label} System`,
        row("System ID", workOrder[`${side}SystemId`])
        + row("Reading", workOrder[`${side}SystemReading`])
        + row("Type", workOrder[`${side}SystemType`])
        + row("GPS", gps)));
    }
    if (hasModule) {
      moduleColumns.push(column(`${label} Module`,
        row("Module ID", workOrder[`${side}ModuleId`])
        + row("Reading", workOrder[`${side}ModuleRead`])
        + row("Type", workOrder[`${side}ModuleType`])
        + (!hasSystem ? row("GPS", gps) : "")));
    }
    if (!hasSystem && !hasModule && gps) {
      gpsColumns.push(column(`${label} Location`, row("GPS", gps)));
    }
  }
  return table(systemColumns) + table(moduleColumns) + table(gpsColumns);
}
