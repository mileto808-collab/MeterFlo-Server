import { z } from "zod";

export const replacementScopeSchema = z.enum(["system", "module", "both"]);
export type ReplacementScope = z.infer<typeof replacementScopeSchema>;
export const createReplacementSchema = z.object({
  operationId: z.string().uuid(),
  predecessorFingerprint: z.string().length(64),
  equipment: replacementScopeSchema,
  reason: z.string().trim().min(10).max(2000),
  vehicleId: z.string().min(1).max(200).nullable(),
}).strict();
export type CreateReplacement = z.infer<typeof createReplacementSchema>;

export interface ReplacementVisit {
  rootWorkOrderId: number;
  parentWorkOrderId: number;
  equipment: ReplacementScope;
  reason: string;
  vehicleId: string | null;
  operationId: string;
  active: boolean;
  cancelledAt: string | null;
}
export interface ReplacementHistoryRow {
  workOrderId: number;
  label: string;
  status: string;
  equipment: ReplacementScope | null;
  reason: string | null;
  oldSystemId: string | null;
  newSystemId: string | null;
  oldModuleId: string | null;
  newModuleId: string | null;
  completedAt: string | null;
  accountingStatus: "pending" | "failed" | "succeeded" | "not_required" | null;
  operationId: string | null;
  cancelledAt: string | null;
  recovery: { canRestore: boolean; canDelete: boolean; restoreReason: string | null; deleteReason: string | null;
    restoreAssigneeLabel: string; usesOriginalRequester: boolean } | null;
}
export const replacementRecoverySchema = z.object({ reason: z.string().trim().min(10).max(1000) }).strict();
export const deleteUnusedReplacementSchema = replacementRecoverySchema.extend({ noPhysicalReplacement: z.literal(true) }).strict();
export interface ReplacementOperationStatus {
  operationId: string;
  workOrderId: number;
  label: string;
  status: "active" | "cancelled" | "deleted" | "completed";
}
export interface ReplacementEligibility {
  contractVersion: 1;
  timezone: string;
  canCreate: boolean;
  reason: string | null;
  rootWorkOrderId: number;
  predecessorFingerprint: string;
  inventoryEnabled: boolean;
  availableEquipment: Array<"system" | "module">;
  baseline: { systemId: string | null; systemType: string | null; moduleId: string | null; moduleType: string | null };
  vehicles: Array<{ id: string; name: string; code: string }>;
  activeVisit: { workOrderId: number; label: string; canResume: boolean } | null;
  history: ReplacementHistoryRow[];
}

export function replacementVisitDto(row: Record<string, any>): ReplacementVisit | null {
  if (!row.replacement_root_id && !row.replacementRootId) return null;
  return {
    rootWorkOrderId: row.replacementRootId ?? row.replacement_root_id,
    parentWorkOrderId: row.replacementParentId ?? row.replacement_parent_id,
    equipment: row.replacementEquipment ?? row.replacement_equipment,
    reason: row.replacementReason ?? row.replacement_reason,
    vehicleId: row.replacementVehicleId ?? row.replacement_vehicle_id ?? null,
    operationId: row.replacementOperationId ?? row.replacement_operation_id,
    active: row.replacementActive ?? row.replacement_active ?? false,
    cancelledAt: row.replacementCancelledAt ?? row.replacement_cancelled_at ?? null,
  };
}

export function includesEquipment(scope: ReplacementScope, equipment: "system" | "module") {
  return scope === "both" || scope === equipment;
}
