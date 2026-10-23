import type { PoolClient } from "pg";
import { z } from "zod";
import { replacementScopeSchema } from "../shared/defective-replacement";

export const replacementBackupSchema = z.object({
  rootWorkOrderId: z.number().int().positive(), parentWorkOrderId: z.number().int().positive(),
  equipment: replacementScopeSchema, reason: z.string().min(10).max(2000),
  vehicleId: z.string().nullable(), operationId: z.string().uuid(), actorId: z.string(),
  predecessorFingerprint: z.string().length(64), active: z.boolean(), cancelledAt: z.string().datetime().nullable().default(null),
  cancelledBy: z.string().nullable().default(null),
}).strict();

export function replacementBackupDto(row: any) {
  return row.replacement_root_id ? {
    rootWorkOrderId: row.replacement_root_id, parentWorkOrderId: row.replacement_parent_id,
    equipment: row.replacement_equipment, reason: row.replacement_reason,
    vehicleId: row.replacement_vehicle_id, operationId: row.replacement_operation_id,
    actorId: row.replacement_actor_id, predecessorFingerprint: row.replacement_predecessor_fingerprint,
    active: row.replacement_active,
    cancelledAt: row.replacement_cancelled_at?.toISOString?.() ?? row.replacement_cancelled_at ?? null,
    cancelledBy: row.replacement_cancelled_by ?? null,
  } : null;
}
export function validateReplacementBackup(orders: any[]) {
  const ids = new Map(orders.map(row => [row.id, row]));
  const operations = new Set<string>(), activeRoots = new Set<number>();
  for (const order of orders) {
    if (!order.replacementRecovery) continue;
    const visit = replacementBackupSchema.parse(order.replacementRecovery);
    const root = ids.get(visit.rootWorkOrderId), parent = ids.get(visit.parentWorkOrderId);
    if (!root || !parent || root.replacementRecovery || visit.rootWorkOrderId === order.id ||
        visit.parentWorkOrderId >= order.id || parent.id !== root.id && parent.replacementRecovery?.rootWorkOrderId !== root.id)
      throw new Error("Replacement backup has an invalid or missing installation predecessor.");
    if (operations.has(visit.operationId) || visit.active && activeRoots.has(visit.rootWorkOrderId))
      throw new Error("Replacement backup contains duplicate operations or competing active visits.");
    if (visit.active && (visit.cancelledAt || ["completed", "closed", "cancelled"].includes(String(order.status).toLowerCase())))
      throw new Error("A completed replacement cannot also be active.");
    if (visit.cancelledAt && visit.active) throw new Error("A cancelled replacement cannot be active.");
    operations.add(visit.operationId); if (visit.active) activeRoots.add(visit.rootWorkOrderId);
  }
}
export async function restoreReplacementMetadata(db: PoolClient, schema: string, orders: any[], mapping: Map<number, number>) {
  for (const order of orders) {
    if (!order.replacementRecovery) continue;
    const v = replacementBackupSchema.parse(order.replacementRecovery);
    await db.query(`UPDATE "${schema}".work_orders SET replacement_root_id=$2,replacement_parent_id=$3,
      replacement_equipment=$4,replacement_reason=$5,replacement_vehicle_id=$6,replacement_operation_id=$7,
      replacement_actor_id=$8,replacement_predecessor_fingerprint=$9,replacement_active=$10,replacement_cancelled_at=$11,replacement_cancelled_by=$12 WHERE id=$1`,
    [mapping.get(order.id), mapping.get(v.rootWorkOrderId), mapping.get(v.parentWorkOrderId),
      v.equipment, v.reason, v.vehicleId, v.operationId, v.actorId, v.predecessorFingerprint, v.active, v.cancelledAt, v.cancelledBy]);
  }
}
