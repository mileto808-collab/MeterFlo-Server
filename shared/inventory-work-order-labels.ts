export type InventoryWorkOrderLabels = Record<string, string>;
export type InventoryWorkOrderIdentifiers = Record<string, { customerWoId: string; equipmentIds: string[] }>;

export function inventoryWorkOrderLabel(id: number, labels: InventoryWorkOrderLabels = {}): string {
  return labels[String(id)]?.trim() || String(id);
}
