import type { InventoryItem, Warehouse } from "@shared/inventory";
import type { SavedVehicleReturnDraft } from "@shared/inventory-vehicle-returns";

export type VehicleReturnScreen = "return-equipment" | "vehicle-count" | "return-stock";
export type ReturnEquipment = {
  id: string;
  serial: string;
  equipment: string;
  workOrderId: number;
  warehouseId: string;
  expectedVehicleId: string | null;
  label: string;
};
export type WorkflowData = {
  revision: number;
  timezone: string;
  vehicles: Warehouse[];
  destinations: Warehouse[];
  items: InventoryItem[];
  stock: Array<{ itemId: string; quantity: number; available: number; serials: string[] }>;
  equipment: ReturnEquipment[];
  drafts: SavedVehicleReturnDraft[];
};
export type VehicleReturnStep = "setup" | "select" | "capture" | "review" | "receipt";
export type VehicleReturnLine = {
  itemId: string;
  item: InventoryItem | undefined;
  quantityText: string;
  quantity: number;
  serials: string[];
};
