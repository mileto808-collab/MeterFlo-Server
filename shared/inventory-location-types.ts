import { z } from "zod";
import type { InventoryState, Warehouse } from "./inventory";
import { InventoryError } from "./inventory-errors";

export const locationKindSchema = z.enum(["physical", "vehicle", "mobile"]);
export const locationTypeNameSchema = z.string().trim().min(1, "Enter a location type name.").max(200)
  .transform(name => name.replace(/\s+/g, " "));
export const locationTypeSchema = z.object({
  id: z.string().uuid(), name: locationTypeNameSchema, kind: locationKindSchema,
  accessPolicy: z.enum(["shared", "assigned"]), revision: z.number().int().positive(),
}).strict();
export type InventoryLocationType = z.infer<typeof locationTypeSchema>;
export const defaultStagingTypeId = "57e15eca-f991-4328-a091-000000000003";
export const isStagingType = (type: InventoryLocationType | undefined) =>
  type?.kind === "physical" && (type.id === defaultStagingTypeId || locationTypeKey(type.name) === "staging");
const defaults = {
  physical: "57e15eca-f991-4328-a091-000000000001",
  vehicle: "57e15eca-f991-4328-a091-000000000002",
};
export const defaultLocationTypeId = (kind: "physical" | "vehicle") => defaults[kind];
export const locationTypeKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();
export function initialLocationTypes(legacyPhysicalPolicy: "shared" | "assigned" = "shared"): InventoryLocationType[] {
  return [
    { id: defaults.physical, name: "Warehouse", kind: "physical", accessPolicy: legacyPhysicalPolicy, revision: 1 },
    { id: defaults.vehicle, name: "Vehicle", kind: "vehicle", accessPolicy: "assigned", revision: 1 },
    { id: defaultStagingTypeId, name: "Staging", kind: "physical", accessPolicy: "shared", revision: 1 },
  ];
}
type LocationState = Pick<InventoryState, "locationTypes">;
export function locationTypeFor(state: LocationState, warehouse: Pick<Warehouse, "type" | "locationTypeId">) {
  const id = warehouse.locationTypeId ?? (warehouse.type === "mobile" ? undefined : defaults[warehouse.type]);
  return state.locationTypes?.find(type => type.id === id);
}
export const locationTypeLabel = (state: LocationState, warehouse: Warehouse) =>
  locationTypeFor(state, warehouse)?.name ?? (warehouse.type === "vehicle" ? "Vehicle" : warehouse.type === "mobile" ? "Mobile" : "Warehouse");

/** Actor membership and action permissions are checked by the authenticated caller. Unknown policies fail closed. */
export function warehouseAccessible(state: LocationState, warehouse: Warehouse | undefined, actor: string | undefined, admin: boolean) {
  if (!warehouse?.active || !actor) return false;
  const type = locationTypeFor(state, warehouse);
  if (warehouse.locationTypeId && !type) return false;
  return admin || type?.accessPolicy === "shared" || warehouse.assignedUserId === actor || warehouse.userIds.includes(actor);
}

/** Live cutover intentionally shares physical warehouses. Legacy restores explicitly request assigned access instead. */
export function normalizeInventoryLocations(input: InventoryState, legacyPhysicalPolicy: "shared" | "assigned" = "shared"): InventoryState {
  const state = structuredClone(input);
  state.locationTypes = state.locationTypes === undefined ? initialLocationTypes(legacyPhysicalPolicy)
    : z.array(locationTypeSchema).parse(state.locationTypes);
  if (!state.locationTypes.some(type => type.id === defaultStagingTypeId || locationTypeKey(type.name) === "staging"))
    state.locationTypes.push({ id: defaultStagingTypeId, name: "Staging",
      kind: "physical", accessPolicy: "shared", revision: 1 });
  if (new Set(state.locationTypes.map(type => type.id)).size !== state.locationTypes.length ||
      new Set(state.locationTypes.map(type => locationTypeKey(type.name))).size !== state.locationTypes.length)
    throw new InventoryError("Location type IDs and names must be unique within this project.");
  for (const warehouse of state.warehouses) {
    const type = locationTypeFor(state, warehouse);
    if (!type) throw new InventoryError("Choose an existing location type from this project.");
    warehouse.locationTypeId = type.id;
    warehouse.type = type.kind;
  }
  return state;
}

export function resolveWarehouseInput(state: InventoryState, data: Record<string, unknown>): Record<string, unknown> & { type: InventoryLocationType["kind"]; locationTypeId: string } {
  const previous = state.warehouses.find(warehouse => warehouse.id === data.id);
  const kind = locationKindSchema.parse(data.type);
  const locationTypeId = data.locationTypeId ?? (previous?.type === kind ? previous.locationTypeId : undefined)
    ?? (kind === "mobile" ? undefined : defaultLocationTypeId(kind));
  const type = state.locationTypes?.find(type => type.id === locationTypeId);
  if (!type) throw new InventoryError("Choose an existing location type from this project.");
  if (data.expectedLocationTypeRevision !== undefined && data.expectedLocationTypeRevision !== type.revision)
    throw new InventoryError("The selected location type changed. Refresh and review its access policy before saving.");
  if (kind !== type.kind) throw new InventoryError("Location type details changed. Refresh and review before saving.");
  return { ...data, type: type.kind, locationTypeId: type.id };
}

export function applyLocationTypeCommand(state: InventoryState, action: "locationType" | "locationTypeDelete", data: Record<string, unknown>) {
  if (action === "locationTypeDelete") {
    const input = z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict().parse(data);
    const type = state.locationTypes?.find(type => type.id === input.id);
    if (!type || type.revision !== input.expectedRevision) throw new InventoryError("Location type changed or was deleted. Refresh before trying again.");
    const used = state.warehouses.filter(warehouse => warehouse.locationTypeId === type.id).length;
    if (used) throw new InventoryError(`Cannot delete "${type.name}": used by ${used} location${used === 1 ? "" : "s"}, including inactive locations. Change their types first.`);
    state.locationTypes = state.locationTypes!.filter(type => type.id !== input.id);
    return;
  }
  const input = z.object({
    id: z.string().uuid(), name: locationTypeNameSchema, kind: locationKindSchema, accessPolicy: z.enum(["shared", "assigned"]),
    expectedRevision: z.number().int().positive().optional(), confirmAffectedLocations: z.array(z.string().min(1).max(100)).optional(),
  }).strict().parse(data);
  const prior = state.locationTypes!.find(type => type.id === input.id);
  if (prior ? prior.revision !== input.expectedRevision : input.expectedRevision !== undefined)
    throw new InventoryError("Location type changed or was deleted. Refresh before trying again.");
  if (state.locationTypes!.some(type => type.id !== input.id && locationTypeKey(type.name) === locationTypeKey(input.name)))
    throw new InventoryError("Location type name already exists in this project.");
  const affected = state.warehouses.filter(warehouse => warehouse.locationTypeId === input.id);
  if (prior && (prior.kind !== input.kind || prior.accessPolicy !== input.accessPolicy) && affected.length) {
    const expected = affected.map(warehouse => warehouse.id).sort();
    if (JSON.stringify(expected) !== JSON.stringify([...(input.confirmAffectedLocations ?? [])].sort()))
      throw new InventoryError(`Review and confirm the policy/kind change for all ${affected.length} affected locations. Refresh if that list changed.`);
  }
  const type: InventoryLocationType = { id: input.id, name: input.name, kind: input.kind, accessPolicy: input.accessPolicy, revision: (prior?.revision ?? 0) + 1 };
  state.locationTypes = [...state.locationTypes!.filter(type => type.id !== input.id), type];
  for (const warehouse of affected) warehouse.type = type.kind;
}
