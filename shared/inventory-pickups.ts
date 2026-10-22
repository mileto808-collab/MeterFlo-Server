/** Vehicle-assignee pickup projection; never grants access to other warehouse data. */
export type InventoryPickupItem = {
  itemId: string; sku: string; name: string; unit: string;
  plannedQuantity: number; stagedQuantity: number; deliveredQuantity: number;
  readyQuantity: number; remainingToStage: number; serials: string[];
};
export type InventoryPickupNotice = {
  projectId: number; projectName: string; timezone: string;
  batchId: string; batchName: string; ticketNumber: string; revision: number;
  createdAt: string; readyAt: string; status: "ready" | "partial";
  vehicleId: string; vehicleName: string; stagingName: string; stagingLocation: string;
  notes: string; unread: boolean; items: InventoryPickupItem[];
};
export type InventoryPickupResponse = { pickups: InventoryPickupNotice[]; unreadCount: number };

export function fulfillmentTicketNumber(createdAt: string, position: number): string {
  return `PICK-${createdAt.slice(0, 4)}-${String(position + 1).padStart(6, "0")}`;
}
