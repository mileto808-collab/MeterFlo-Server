import type { InventoryState } from "./inventory";
import { locationTypeFor, warehouseAccessible } from "./inventory-location-types";

export function warehouseRouteOrigins(state: InventoryState, userId: string, admin: boolean) {
  return state.warehouses.filter(warehouse => {
    const type = locationTypeFor(state, warehouse);
    return warehouse.active && warehouse.type === "physical" &&
      (!warehouse.locationTypeId || type?.kind === "physical") &&
      typeof warehouse.address === "string" && !!warehouse.address.trim() &&
      warehouseAccessible(state, warehouse, userId, admin);
  }).map(warehouse => ({
    id: warehouse.id, name: warehouse.name,
    address: [warehouse.address, warehouse.city, warehouse.state, warehouse.zip]
      .filter(value => typeof value === "string" && !!value.trim()).map(value => value.trim()).join(", "),
  })).sort((a, b) => a.name.localeCompare(b.name));
}
