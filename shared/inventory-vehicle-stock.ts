export type VehicleStockLocation = {
  id: string; projectId: number; projectName: string; timezone: string;
  name: string; code: string;
};
export type VehicleStockDirectory = {
  vehicles: VehicleStockLocation[]; generatedAt: string;
};
export type VehicleStockRow = {
  itemId: string; warehouseId: string; quantity: number; reserved: number;
  available: number; revision: number; serialCount: number;
  item: { id: string; sku: string; name: string; category: string; unit: string; tracking: string };
};
export type VehicleStockResponse = {
  vehicle: VehicleStockLocation; generatedAt: string; revision: number;
  total: number; filtered: number; quantity: number; reserved: number;
  offset: number; rows: VehicleStockRow[];
};
export type VehicleStockSerials = {
  serials: string[]; total: number; filtered: number; offset: number; revision: number;
};
