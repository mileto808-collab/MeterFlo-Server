import { z } from "zod";
import { pool } from "../db";
import { auditContext, serviceAuditContext, withAuditContext } from "../auditContext";
import { beginAuditOperation, finishAuditOperation, insertAuditEvent, safeAuditLabel } from "../auditService";
import { lockInventoryForSchema } from "../inventoryService";
import { emitWorkOrderUpdated } from "../eventEmitter";
import { projectSchema } from "./schema";
import { enqueueCustomerDelivery } from "../customerApiService";

export const closingPolicySchema = z.object({
  enabled: z.boolean(), afterHours: z.number().int().min(1).max(87600),
}).strict();
export const lifecycleError = (message: string, status = 409) => Object.assign(new Error(message), { status });
export async function closingPolicy(projectId: number) {
  const { rows: [row] } = await pool.query("SELECT enabled,after_hours FROM public.work_order_closing_policy WHERE project_id=$1", [projectId]);
  return { enabled: row?.enabled ?? false, afterHours: row?.after_hours ?? 168 };
}
export async function saveClosingPolicy(projectId: number, input: unknown) {
  const policy = closingPolicySchema.parse(input), client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [previous] } = await client.query("SELECT enabled,after_hours FROM public.work_order_closing_policy WHERE project_id=$1 FOR UPDATE", [projectId]);
    const before = { enabled: previous?.enabled ?? false, afterHours: previous?.after_hours ?? 168 };
    await client.query(`INSERT INTO public.work_order_closing_policy(project_id,enabled,after_hours)
      VALUES($1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET enabled=excluded.enabled,after_hours=excluded.after_hours,
      enabled_at=CASE WHEN work_order_closing_policy.enabled IS DISTINCT FROM excluded.enabled
        OR work_order_closing_policy.after_hours<>excluded.after_hours THEN now() ELSE work_order_closing_policy.enabled_at END,
      updated_at=now()`, [projectId, policy.enabled, policy.afterHours]);
    await insertAuditEvent(client, { action: "workOrder.closingPolicyChanged", entityType: "workOrderPolicy", entityId: String(projectId), entityLabel: "Work-order closing policy",
      projectId, changes: ["enabled", "afterHours"].filter(k => before[k as keyof typeof before] !== policy[k as keyof typeof policy])
        .map(k => ({ field: k, before: before[k as keyof typeof before], after: policy[k as keyof typeof policy] })) });
    await client.query("COMMIT");
    return policy;
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
/** Locks and rechecks eligibility inside the transaction. No completion/reset/inventory mutations. */
export async function lifecycleBatch(projectId: number, ids: number[], mode: "close" | "reopen" | "autoClose", reason = "") {
    const { rows: [project] } = await pool.query<{ database_name: string; is_active: boolean }>("SELECT database_name,is_active FROM public.projects WHERE id=$1", [projectId]);
  if (!project?.database_name) throw lifecycleError("Project not found.", 404);
  if (project.is_active === false) throw lifecycleError("Inactive projects cannot be changed.");
  const schema = projectSchema(project.database_name), actor = auditContext.getStore() || serviceAuditContext("automaticClose");
  const operationId = await beginAuditOperation(`workOrder.${mode}`, "batch", projectId);
  return withAuditContext({ ...actor, operationId }, async () => {
    let updatedCount = 0, skipped = 0, failed = 0;
    const updatedIds: number[] = [], skippedIds: number[] = [], failedIds: number[] = [];
    const skippedReasons: string[] = [];
    try {
      for (const id of [...new Set(ids)]) {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          // Same order as normal updates; completion and closing cannot race.
          await lockInventoryForSchema(client, project.database_name);
          const { rows: [row] } = await client.query(`SELECT w.*,
            public.meterflo_work_order_status_is(status,'Completed') is_completed,
            public.meterflo_work_order_status_is(status,'Closed') is_closed
            FROM ${schema}.work_orders w WHERE id=$1 FOR UPDATE`, [id]);
          const label = safeAuditLabel(String(row?.customer_wo_id?.trim() || id));
          let eligible = !!row && (mode === "reopen" ? row.is_closed : row.is_completed);
          if (mode === "autoClose" && eligible) {
            const { rows: [p] } = await client.query(`SELECT enabled AND
              greatest($2::timestamp AT TIME ZONE 'UTC',$3::timestamptz,enabled_at)
                +after_hours*interval '1 hour'<=now() eligible
              FROM public.work_order_closing_policy WHERE project_id=$1 FOR SHARE`,
            [projectId, row.completed_at, row.review_started_at]);
            eligible = !!p?.eligible && !!row.completed_at;
          }
          if (!eligible) {
            skipped++;
            skippedIds.push(id);
            const detail = mode === "reopen" ? "Only Closed orders can be reopened." : "Only eligible Completed orders can be closed.";
            if (skippedReasons.length < 10) skippedReasons.push(`${label}: ${detail}`);
            await insertAuditEvent(client, { action: `workOrder.${mode}`, entityType: "work_orders", entityId: String(id),
              entityLabel: label, projectId, outcome: "skipped", metadata: { reason: detail } });
            await client.query("COMMIT");
            continue;
          }
          const target = mode === "reopen" ? "Completed" : "Closed";
          const { rows: [status] } = await client.query("SELECT code FROM public.work_order_statuses WHERE lower(code)=lower($1)", [target]);
          await client.query("SELECT set_config('meterflo.lifecycle_write','authorized',true)");
          if (mode === "reopen") {
            await client.query(`UPDATE ${schema}.work_orders SET status=$2,sub_status_id=NULL,
              review_started_at=now(),closed_at=NULL,closed_by=NULL,updated_at=now(),updated_by=$3 WHERE id=$1`,
            [id, status?.code || target, actor.actorKind === "user" ? actor.actorLabel : null]);
          } else {
            await client.query(`UPDATE ${schema}.work_orders SET status=$2,sub_status_id=NULL,
              closed_at=now(),closed_by=$3,assigned_user_id=NULL,assigned_group_id=NULL,
              scheduled_at=NULL,scheduled_by=NULL,updated_at=now(),updated_by=$4 WHERE id=$1`,
            [id, status?.code || target, actor.actorLabel, actor.actorKind === "user" ? actor.actorLabel : null]);
          }
          if (mode === "reopen") {
            const { rows: [current] } = await client.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1`, [id]);
            await enqueueCustomerDelivery(client, project.database_name, current);
          }
          await insertAuditEvent(client, { action: `workOrder.${mode}`, entityType: "work_orders",
            entityId: String(id), entityLabel: label, projectId, outcome: "success",
            metadata: { reason: safeAuditLabel(reason || (mode === "autoClose" ? "Configured review interval elapsed." : "Manual close.")),
              previousStatus: row.status, status: target, previousAssignedUserId: row.assigned_user_id,
              previousAssignedGroup: row.assigned_group_id, completedAt: row.completed_at, completedBy: row.completed_by } });
          await client.query("COMMIT");
          updatedCount++;
          updatedIds.push(id);
          emitWorkOrderUpdated(projectId, id, actor.actorId || undefined);
        } catch (e) {
          await client.query("ROLLBACK");
          failed++;
          failedIds.push(id);
          const databaseCode = /^[A-Z0-9]{5}$/.test(String((e as any)?.code)) ? String((e as any).code) : "unknown";
          console.error("[work-order-closing] Transaction failed.", { databaseCode, action: mode });
          if (skippedReasons.length < 10) skippedReasons.push(`${id}: Close/reopen failed; no change committed.`);
          await insertAuditEvent(client, { action: `workOrder.${mode}`, entityType: "work_orders",
            entityId: String(id), projectId, outcome: "failed", metadata: { reason: "Transaction failed; no change committed.", databaseCode } });
        } finally { client.release(); }
      }
      await finishAuditOperation(operationId, failed ? "partial" : skipped ? "partial" : "success", { updated: updatedCount, skipped, failed });
      return { success: failed === 0, updatedCount, skipped, failed, skippedReasons, updatedIds, skippedIds, failedIds,
        message: `${updatedCount} updated; ${skipped} skipped; ${failed} failed.` };
    } catch (e) { await finishAuditOperation(operationId, "failed", { updated: updatedCount, skipped, failed }); throw e; }
  });
}
export async function isClosingStatus(value: string) {
  const { rows: [row] } = await pool.query("SELECT public.meterflo_work_order_status_is($1,'Closed') closing", [value]);
  return row.closing === true;
}
export async function runAutomaticClosing() {
  const { withBackupExclusive } = await import("../backups/lock");
  return withBackupExclusive(async () => {
    const client = await pool.connect();
    let locked = false;
    try {
      locked = (await client.query("SELECT pg_try_advisory_lock(hashtext('meterflo-automatic-closing')) locked")).rows[0].locked;
      if (!locked) return;
      const { rows: projects } = await client.query(`SELECT p.id,p.database_name FROM public.projects p
        JOIN public.work_order_closing_policy c ON c.project_id=p.id WHERE c.enabled AND p.is_active IS NOT FALSE
        AND c.enabled_at+c.after_hours*interval '1 hour'<=now()`);
      const { rows: statuses } = await client.query("SELECT code,label FROM public.work_order_statuses WHERE lower(code)='completed'");
      const completedValues = [...new Set(["Completed", "completed", "COMPLETED", ...statuses.flatMap(s => [s.code, s.label])])];
      for (const project of projects) {
        const schema = projectSchema(project.database_name);
        const { rows } = await client.query(`SELECT w.id FROM ${schema}.work_orders w
          JOIN public.work_order_closing_policy c ON c.project_id=$1
          WHERE w.status=ANY($2::varchar[]) AND w.completed_at IS NOT NULL
          AND w.completed_at<=((now()-c.after_hours*interval '1 hour') AT TIME ZONE 'UTC')
          AND greatest(w.completed_at AT TIME ZONE 'UTC',w.review_started_at,c.enabled_at)+c.after_hours*interval '1 hour'<=now()
          ORDER BY w.completed_at,w.id LIMIT 200`, [project.id, completedValues]);
        if (rows.length) await withAuditContext(serviceAuditContext("automaticClose"),
          () => lifecycleBatch(project.id, rows.map(r => r.id), "autoClose"));
      }
    } finally {
      if (locked) await client.query("SELECT pg_advisory_unlock(hashtext('meterflo-automatic-closing'))");
      client.release();
    }
  });
}
export function startAutomaticClosing() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runAutomaticClosing(); } catch { console.error("[work-order-closing] Automatic close failed; no success assumed. Will retry next minute."); }
    finally { running = false; }
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  void tick();
}
