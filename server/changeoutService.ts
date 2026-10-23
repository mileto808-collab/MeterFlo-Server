import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { auditContext } from "./auditContext";
import { insertAuditEvent } from "./auditService";
import { permissionKeys, type User } from "../shared/schema";
import { inventoryDispatchScope } from "./inventoryDispatch";
import { mobileSubmissionContext } from "./mobileSubmissionContext";
import { validateReplacementCompletion } from "./replacementService";

export async function assertInventoryDispatchAllowed(client: Pick<PoolClient, "query">, projectId: number, row: any, user: User) {
  if (await storage.isAdminUser(user) || !user.subroleId ||
      (await storage.getSubrole(user.subroleId))?.key !== "field_technician") return false;
  const scope = await inventoryDispatchScope(projectId, user.id, [{
    id: row.id, assignedUserId: row.assigned_user_id, assignedGroupId: row.assigned_group_id,
    newSystemType: row.new_system_type, newModuleType: row.new_module_type,
    assignmentVersion: row.assignment_version, status: row.status,
  }], client);
  if (!scope.enabled) return false;
  const dispatch = scope.dispatch.get(row.id);
  if (dispatch && !dispatch.canStart)
    throw new ChangeoutError(dispatch.reason ?? "The vehicle handoff must be completed before starting.");
  if (!dispatch && (scope.requires.has(row.id) || scope.batched.has(row.id)))
    throw new ChangeoutError("This work is not handed off to one of your authorized vehicles. Ask the warehouse to prepare it or a manager to add you to the helping crew.", 403);
  return !!dispatch;
}

export class ChangeoutError extends Error {
  constructor(message: string, public status = 409, public code = "CHANGEOUT_CONFLICT") { super(message); }
}
export const schemaName = (schema: string) => {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new ChangeoutError("Invalid project schema", 400);
  return `"${schema}"`;
};
export async function canonicalStatus(client: Pick<PoolClient, "query">, value: unknown) {
  const { rows } = await client.query("SELECT label FROM public.work_order_statuses WHERE lower(code)=lower($1) OR lower(label)=lower($1) LIMIT 1", [String(value ?? "")]);
  return String(rows[0]?.label ?? value ?? "").toLowerCase();
}
export async function canStart(user: User) {
  return !user.isLocked && user.role !== "customer" &&
    await storage.hasPermission(user, permissionKeys.WORK_ORDERS_VIEW) &&
    await storage.hasPermission(user, permissionKeys.WORK_ORDERS_METER_CHANGEOUT);
}
export async function assertClaimAllowed(client: PoolClient, row: any, userId: string, projectId?: number) {
  if (row.replacement_cancelled_at) throw new ChangeoutError("This replacement visit was cancelled.", 409, "REPLACEMENT_NOT_ELIGIBLE");
  const user = await storage.getUser(userId);
  if (!user || !await canStart(user)) throw new ChangeoutError("Changeout permission is required.", 403);
  const status = await canonicalStatus(client, row.status);
  if (!["open", "scheduled"].includes(status)) throw new ChangeoutError("Only Open or individually assigned Scheduled work can be started.");
  if (row.assigned_user_id && row.assigned_user_id !== user.id)
    throw new ChangeoutError("This work order has already been assigned to another technician.");
  if (status === "scheduled" && row.assigned_user_id !== user.id)
    throw new ChangeoutError("Scheduled work must be assigned to you before starting.");
  const vehicleCrew = projectId ? await assertInventoryDispatchAllowed(client, projectId, row, user) : false;
  if (row.assigned_user_id === user.id) return;
  if (vehicleCrew) return;
  const admin = await storage.isAdminUser(user);
  if (!admin) {
    const groups = await storage.getUserGroupMemberships(user.id);
    if (!row.assigned_group_id || !groups.some(g => g.name === row.assigned_group_id))
      throw new ChangeoutError("This work order is not in your assigned group's available work.", 403);
  }
}

export async function submissionReplay(client: PoolClient, projectId: number, workOrderId: number, token?: string,
  requestFingerprint?: string, actorId = auditContext.getStore()?.actorId) {
  if (!token) return null;
  if (!z.string().uuid().safeParse(token).success) throw new ChangeoutError("Invalid submission identity.", 400);
  const { rows: [record] } = await client.query("SELECT * FROM public.changeout_completions WHERE id=$1", [token]);
  if (record && (record.project_id !== projectId || record.work_order_id !== workOrderId ||
      record.actor_id !== actorId))
    throw new ChangeoutError("Submission identity belongs to another changeout.");
  if (record) {
    const accepted = record.evidence?.mobileSubmission?.fingerprint;
    if ((accepted || requestFingerprint) && accepted !== requestFingerprint)
      throw new ChangeoutError("This submission identity was used with different inputs. Retain the original request to recover its outcome.",
        409, "CHANGEOUT_PAYLOAD_MISMATCH");
  }
  return record;
}

/** No stock graph/warehouse lock here: accept field evidence and a durable job together. */
export async function acceptCompletion(client: PoolClient, schema: string, prior: any, next: any,
  updates: any, project: any) {
  const context = auditContext.getStore();
  if (!context?.actorId) throw new ChangeoutError("Authenticated completion identity required.", 403);
  const actor = await storage.getUser(context.actorId);
  if (!actor || !await canStart(actor)) throw new ChangeoutError("Changeout permission is required.", 403);
  const admin = await storage.isAdminUser(actor);
  if (!admin && prior.assigned_user_id !== actor.id)
    throw new ChangeoutError("Claim this work order before submitting. It may have been reassigned.", 403);
  await validateReplacementCompletion(client, schema, prior, next, updates, actor, project.id);
  if (!admin) {
    const vehicleWork = await assertInventoryDispatchAllowed(client, project.id, prior, actor);
    if (vehicleWork) {
      const scope = await inventoryDispatchScope(project.id, actor.id, [{
        id: prior.id, assignedUserId: prior.assigned_user_id, assignedGroupId: prior.assigned_group_id,
        newSystemType: prior.new_system_type, newModuleType: prior.new_module_type,
        assignmentVersion: prior.assignment_version, status: prior.status,
      }], client);
      const dispatch = scope.dispatch.get(prior.id)!;
      if (Array.isArray(updates.inventoryUsage?.used) &&
          updates.inventoryUsage.used.some((line: any) => line.warehouseId !== dispatch.vehicleId))
        throw new ChangeoutError("Use inventory from this order's dispatched vehicle. Record an authorized stock transfer and resolve dispatch before using a different vehicle.");
    }
  }
  const token = updates.changeoutSubmissionId || randomUUID();
  if (!z.string().uuid().safeParse(token).success) throw new ChangeoutError("Invalid submission identity.", 400);
  const { rows: [draft] } = await client.query(`SELECT assignment_version FROM public.changeout_drafts
    WHERE project_id=$1 AND work_order_id=$2 AND user_id=$3 AND submission_id=$4`,
  [project.id, next.id, actor.id, token]);
  if (updates.changeoutSubmissionId) {
    const version = draft?.assignment_version ?? updates.changeoutAssignmentVersion;
    if (!Number.isInteger(version) || version !== prior.assignment_version)
      throw new ChangeoutError("This assignment changed. Your captured draft is retained, but this old attempt cannot be submitted.");
  }
  const mobile = mobileSubmissionContext.getStore();
  const evidence = { schema, prior, next, usage: updates.inventoryUsage ?? null,
    ...(mobile ? { mobileSubmission: { fingerprint: mobile.fingerprint, kind: mobile.kind } } : {}) };
  const fingerprint = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
  await client.query(`INSERT INTO public.changeout_completions
    (id,project_id,work_order_id,actor_id,actor_label,fingerprint,assignment_version,evidence,status,finished_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $9='not_required' THEN now() END)`,
  [token, project.id, next.id, actor.id, actor.username, fingerprint, prior.assignment_version,
    JSON.stringify(evidence), project.inventory_enabled ? "pending" : "not_required"]);
  // Register selected serialized components without requiring stock bookkeeping.
  for (const line of Array.isArray(updates.inventoryUsage?.used) ? updates.inventoryUsage.used : []) {
    if (typeof line.itemId !== "string" || !Array.isArray(line.serials)) continue;
    for (const serial of line.serials.filter((s: unknown) => typeof s === "string" && !!s)) {
      const occupied = await client.query(`SELECT 1 FROM public.inventory_serial_occupancy WHERE project_id=$1
        AND item_id=$2 AND serial=$3 AND work_order_id IS NOT NULL AND work_order_id<>$4 LIMIT 1`,
      [project.id, line.itemId, serial, next.id]);
      if (occupied.rowCount) throw new ChangeoutError("A captured serial is already installed on another work order.");
      const result = await client.query(`INSERT INTO public.changeout_installation_claims
        (project_id,item_id,serial,work_order_id,completion_id) VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(project_id,item_id,serial) DO UPDATE SET work_order_id=EXCLUDED.work_order_id,
        completion_id=EXCLUDED.completion_id,active=true
        WHERE NOT changeout_installation_claims.active OR changeout_installation_claims.work_order_id=EXCLUDED.work_order_id RETURNING serial`,
      [project.id, line.itemId, serial, next.id, token]);
      if (!result.rowCount) throw new ChangeoutError("A captured serial was already submitted on another work order.");
    }
  }
  await client.query("DELETE FROM public.changeout_drafts WHERE project_id=$1 AND work_order_id=$2", [project.id, next.id]);
  if (prior.replacement_root_id) await client.query(`UPDATE "${schema}".work_orders SET replacement_active=false WHERE id=$1`, [next.id]);
  await client.query("INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id,operation_id) VALUES($1,$2,'workorder_updated',$3,$4) ON CONFLICT DO NOTHING",
    [project.id, next.id, actor.id, context.operationId]);
  await insertAuditEvent(client, { action: "workOrder.completionAccepted", entityType: "work_orders",
    entityId: String(next.id), projectId: project.id, metadata: { submissionId: token, inventory: project.inventory_enabled ? "pending" : "not_required" } });
}

/** Trouble is a retained field attempt, not replacement consumption or completed work. */
export async function acceptMobileTrouble(client: PoolClient, schema: string, prior: any, next: any, project: any) {
  const mobile = mobileSubmissionContext.getStore();
  if (!mobile) return;
  const evidence = { schema, prior, next, usage: null,
    mobileSubmission: { fingerprint: mobile.fingerprint, kind: "trouble" } };
  await client.query(`INSERT INTO public.changeout_completions
    (id,project_id,work_order_id,actor_id,actor_label,fingerprint,assignment_version,evidence,status,finished_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'not_required',now())`,
  [mobile.id, project.id, next.id, mobile.actorId, auditContext.getStore()?.actorLabel ?? "",
    createHash("sha256").update(JSON.stringify(evidence)).digest("hex"), prior.assignment_version, JSON.stringify(evidence)]);
  await insertAuditEvent(client, { action: "workOrder.mobileTroubleAccepted", entityType: "work_orders",
    entityId: String(next.id), projectId: project.id, metadata: { submissionId: mobile.id } });
}

export async function guardPendingInstallationUse(client: PoolClient, projectId: number, before: any, after: any) {
  const { rows } = await client.query("SELECT item_id,serial,work_order_id FROM public.changeout_installation_claims WHERE project_id=$1 AND active", [projectId]);
  for (const row of rows) {
    const installed = after.serialOccupancy?.find((v: any) => v.itemId === row.item_id && v.serial === row.serial);
    if (installed?.workOrderId && installed.workOrderId !== row.work_order_id)
      throw new ChangeoutError("This serial belongs to a completed changeout awaiting inventory reconciliation.");
    const oldStock = before.stock.find((s: any) => s.itemId === row.item_id && s.serials.includes(row.serial));
    const newStock = after.stock.find((s: any) => s.itemId === row.item_id && s.serials.includes(row.serial));
    if (newStock && (!oldStock || oldStock.warehouseId !== newStock.warehouseId))
      throw new ChangeoutError("An installed serial awaiting reconciliation cannot be received or moved as available stock.");
    for (const allocation of after.allocations) {
      if (allocation.workOrderId === row.work_order_id) continue;
      const original = before.allocations.find((a: any) => a.workOrderId === allocation.workOrderId);
      for (const key of ["used", "lines"]) {
        if (allocation[key]?.some((l: any) => l.itemId === row.item_id && l.serials.includes(row.serial)) &&
            !original?.[key]?.some((l: any) => l.itemId === row.item_id && l.serials.includes(row.serial)))
          throw new ChangeoutError("This serial is already captured by a completed changeout.");
      }
    }
  }
}

export const draftInput = z.object({
  baseRevision: z.number().int().nonnegative(), submissionId: z.string().uuid(),
  assignmentVersion: z.number().int().nonnegative().optional(),
  step: z.string().min(1).max(80), capture: z.record(z.unknown()),
}).strict();
export function draftDto(row: any) {
  return { workOrderId: row.work_order_id, submissionId: row.submission_id, assignmentVersion: row.assignment_version,
    revision: row.revision, step: row.step, capture: row.capture, updatedAt: row.updated_at };
}
export async function draftEligibility(client: Pick<PoolClient, "query">, row: any, userId: string, draft?: any) {
  const completed = ["completed", "closed"].includes(await canonicalStatus(client, row?.status));
  const canResume = !!row && !completed && row.assigned_user_id === userId &&
    (!draft || row.assignment_version === draft.assignment_version);
  return { completed, canResume, assignmentVersion: row?.assignment_version,
    reason: completed ? "Work order completed" : canResume ? null : "Assignment changed. Captured data is retained for review, not submission." };
}
