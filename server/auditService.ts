import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { auditContext, serviceAuditContext, withAuditContext, type AuditContext } from "./auditContext";
import { auditRetentionSchema, type AuditEvent, type AuditRetention } from "../shared/audit";

export const auditInstanceId = randomUUID();
export function safeAuditLabel(value:string) {
  return value.length>500 || /:\/\/|bearer\s|data:|BEGIN.*PRIVATE KEY/i.test(value) ? "[redacted label]" : value;
}
export const eventDto = (r:any):AuditEvent => ({
  id:r.id,occurredAt:new Date(r.occurred_at).toISOString(),actorId:r.actor_id,actorLabel:r.actor_label,
  actorKind:r.actor_kind,source:r.source,action:r.action,entityType:r.entity_type,entityId:r.entity_id,
  entityLabel:r.entity_label,projectId:r.project_id,projectLabel:r.project_label,operationId:r.operation_id,
  outcome:r.outcome,changes:r.changes,metadata:r.metadata,
});
export async function insertAuditEvent(client:PoolClient,data:{
  action:string;entityType:string;entityId:string;entityLabel?:string;projectId?:number|null;projectLabel?:string|null;
  outcome?:string;operationId?:string;changes?:unknown[];metadata?:Record<string,unknown>;
}, context = auditContext.getStore() || serviceAuditContext("system")) {
  // Only callers with fixed, safe metadata pass values here. Never pass error
  // objects, request bodies, filenames/paths, uploaded content or auth settings.
  await client.query(`INSERT INTO meterflo_audit.events(actor_id,actor_label,actor_kind,source,action,entity_type,
    entity_id,entity_label,project_id,project_label,operation_id,outcome,changes,metadata)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [context.actorId,safeAuditLabel(context.actorLabel),context.actorKind,context.source,data.action,data.entityType,safeAuditLabel(data.entityId),
      safeAuditLabel(data.entityLabel || data.entityId),data.projectId ?? null,data.projectLabel ? safeAuditLabel(data.projectLabel) : null,
      data.operationId || context.operationId,data.outcome || "success",JSON.stringify(data.changes || []),JSON.stringify(data.metadata || {})]);
}
export async function beginAuditOperation(type:string,entityId:string,projectId:number|null=null,projectLabel:string|null=null) {
  const context=auditContext.getStore() || serviceAuditContext("system"),id=randomUUID();
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO meterflo_audit.operations(id,actor_id,actor_label,actor_kind,source,entity_type,
      entity_id,entity_label,project_id,project_label,instance_id) VALUES($1,$2,$3,$4,$5,$6,$7,$7,$8,$9,$10)`,
      [id,context.actorId,safeAuditLabel(context.actorLabel),context.actorKind,context.source,type,safeAuditLabel(entityId),projectId,
        projectLabel ? safeAuditLabel(projectLabel) : null,auditInstanceId]);
    await insertAuditEvent(client,{action:`${type}.started`,entityType:type,entityId,projectId,projectLabel,operationId:id,
      outcome:"started",metadata:{startedAt:new Date().toISOString(),parentOperationId:context.operationId}},context);
    await client.query("COMMIT");
    return id;
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function finishAuditOperation(id:string,outcome:string,counts:Record<string,number>={}) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const {rows:[op]}=await client.query(`UPDATE meterflo_audit.operations SET outcome=$2,completed_at=now()
      WHERE id=$1 AND outcome='started' RETURNING *`,[id,outcome]);
    if (op) {
      const ctx:AuditContext={actorId:op.actor_id,actorLabel:op.actor_label,actorKind:op.actor_kind,source:op.source,operationId:id};
      await insertAuditEvent(client,{action:`${op.entity_type}.finished`,entityType:op.entity_type,entityId:op.entity_id,
        entityLabel:op.entity_label,projectId:op.project_id,projectLabel:op.project_label,operationId:id,outcome,
        metadata:{startedAt:new Date(op.started_at).toISOString(),completedAt:new Date().toISOString(),...counts}},ctx);
    }
    await client.query("COMMIT");
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function auditedOperation<T>(type:string,target:string,fn:()=>Promise<T>,projectId:number|null=null,projectLabel:string|null=null):Promise<T> {
  if (["systemBackup", "systemRestore", "systemFilesRestore"].includes(type)) {
    const { withBackupExclusive } = await import("./backups/lock");
    return withBackupExclusive(async () => {
      const result = await auditedOperationData(type,target,fn,projectId,projectLabel);
      if (type === "systemRestore") {
        // Restored schedules may contain another server's paths and queued work.
        // Recreate the CURRENT operational schema during the explicit restore,
        // never in managed production startup or deployment hooks.
        const { migrateBackupSchema } = await import("./backups/schema");
        await migrateBackupSchema(pool);
        const { migrateFileTransfers } = await import("./file-transfers/schema");
        await migrateFileTransfers(pool);
        await pool.query("UPDATE public.file_exports SET is_enabled=false,next_run_at=null,updated_at=now()");
        await pool.query("UPDATE public.https_transfer_settings SET enabled=false,updated_at=now()");
        await pool.query("UPDATE public.https_transfer_credentials SET revoked_at=coalesce(revoked_at,now())");
        await pool.query("UPDATE public.https_transfer_files SET status='received',message='Processing interrupted by restore; review before enabling.' WHERE status='processing'");
        await pool.query("UPDATE public.file_import_configs SET is_enabled=false WHERE source='sftp'");
        await pool.query(`UPDATE public.file_export_runs SET status='cancelled',completed_at=now(),
          message='Paused after system restore. Review the SFTP destination and create a new export.'
          WHERE status IN ('queued','running','failed','interrupted')`);
        await pool.query("UPDATE public.file_export_attempts SET status='interrupted',completed_at=now(),message='System restored.' WHERE status='running'");
        await pool.query("UPDATE public.backup_schedules SET enabled=false,next_run_at=null,updated_at=now()");
        await pool.query(`UPDATE public.backup_runs SET status=CASE WHEN status='running' THEN 'interrupted' ELSE 'cancelled' END,
          completed_at=now(),error='Paused after system restore. Review the destination and re-enable schedules.'
          WHERE status IN ('queued','running')`);
      }
      return result;
    });
  }
  return auditedOperationData(type,target,fn,projectId,projectLabel);
}
async function auditedOperationData<T>(type:string,target:string,fn:()=>Promise<T>,projectId:number|null=null,projectLabel:string|null=null):Promise<T> {
  const id=await beginAuditOperation(type,target,projectId,projectLabel);
  const ctx={...(auditContext.getStore() || serviceAuditContext("system")),operationId:id};
  try {
    const result=await withAuditContext(ctx,fn);
    const r=result as any;
    const outcome=r?.success===false ? "failed" :
      (Array.isArray(r?.errors)&&r.errors.length)||(Array.isArray(r?.projectErrors)&&r.projectErrors.length)||(r?.failed>0) ? "partial" : "success";
    const counts:Record<string,number>={};
    for (const key of ["restored","created","updated","skipped","failed","imported","projectsRestored","recordsImported","recordsFailed","filesRestored"]) {
      if (typeof r?.[key]==="number") counts[key]=r[key];
    }
    if (/Import$/i.test(type)) {
      const {rows:[n]}=await pool.query(`SELECT count(*) FILTER(WHERE created)::int created,
        count(*) FILTER(WHERE NOT created)::int updated FROM (
          SELECT entity_id,project_id,bool_or(action='created') created FROM meterflo_audit.events
          WHERE operation_id=$1 AND entity_type='work_orders' GROUP BY entity_id,project_id
        ) changes`,[id]);
      counts.created=n.created;counts.updated=n.updated;
      counts.skipped=Math.max(0,(counts.imported || counts.recordsImported || 0)-n.created-n.updated);
    }
    await finishAuditOperation(id,outcome,counts);
    return result;
  } catch(e) {
    await finishAuditOperation(id,"failed");
    throw e;
  }
}
export async function reconcileAuditOperations() {
  const {rows}=await pool.query(`SELECT id FROM meterflo_audit.operations WHERE outcome='started' AND instance_id<>$1`,[auditInstanceId]);
  for (const op of rows) await finishAuditOperation(op.id,"unknown");
  // Manual file imports have durable history but no separate worker lease.
  // Preserve the initiating event and explicitly record uncertain completion
  // after process replacement; do not invent success or mutate legacy history.
  const {rows:imports}=await pool.query(`SELECT e.* FROM meterflo_audit.events e
    WHERE e.action='import.started' AND e.entity_type IN ('file_import_history','import_history')
    AND NOT EXISTS(SELECT 1 FROM meterflo_audit.events terminal WHERE terminal.operation_id=e.operation_id
      AND terminal.entity_type=e.entity_type AND terminal.entity_id=e.entity_id
      AND terminal.outcome NOT IN ('started','queued','running','retrying'))`);
  for (const run of imports) {
    const client=await pool.connect();
    try {
      await withAuditContext(serviceAuditContext("importRecovery"),()=>insertAuditEvent(client,{
        action:"import.outcomeUnknown",entityType:run.entity_type,entityId:run.entity_id,entityLabel:run.entity_label,
        projectId:run.project_id,projectLabel:run.project_label,operationId:run.operation_id,outcome:"unknown",
        metadata:{initiatingActorId:run.actor_id,reason:"Process replaced without a recorded import outcome"},
      }));
    } finally {client.release();}
  }
}
export async function auditPolicy():Promise<AuditRetention> {
  const {rows:[r]}=await pool.query("SELECT automatic,days FROM meterflo_audit.policy WHERE singleton");
  return auditRetentionSchema.parse(r);
}
export async function auditInventory() {
  const {rows:[r]}=await pool.query(`SELECT count(*)::int count,min(occurred_at) oldest,max(occurred_at) newest,
    pg_total_relation_size('meterflo_audit.events')::float8 bytes FROM meterflo_audit.events`);
  return {policy:await auditPolicy(),count:r.count,bytes:r.bytes,
    oldest:r.oldest?new Date(r.oldest).toISOString():null,newest:r.newest?new Date(r.newest).toISOString():null};
}
const previews=new Map<string,{actor:string;expires:number;ids:string[];before:string;policy:string}>();
export async function previewAuditCleanup(actor:string,before:string) {
  if (!Number.isFinite(Date.parse(before)) || Date.parse(before)>Date.now()) throw new Error("Choose a cutoff in the past");
  const {rows}=await pool.query(`SELECT e.id FROM meterflo_audit.events e WHERE e.occurred_at<$1 AND
    (e.outcome<>'started' OR EXISTS(SELECT 1 FROM meterflo_audit.events terminal WHERE terminal.operation_id=e.operation_id
      AND terminal.outcome NOT IN ('started','queued','running','retrying')))
    ORDER BY e.sequence LIMIT 1001`,[before]);
  const token=randomUUID(),expires=Date.now()+10*60*1000;
  for (const [key,p] of previews) if (p.expires<Date.now()) previews.delete(key);
  if (previews.size>=100) previews.delete(previews.keys().next().value!);
  previews.set(token,{actor,expires,ids:rows.slice(0,1000).map(r=>r.id),before,policy:JSON.stringify(await auditPolicy())});
  return {token,count:Math.min(rows.length,1000),before,expiresAt:new Date(expires).toISOString(),limited:rows.length>1000};
}
export async function cleanupAudit(actor:string,token:string) {
  const p=previews.get(token);
  if (!p || p.actor!==actor || p.expires<Date.now()) throw new Error("Preview expired or belongs to another user");
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(715296)");
    if (p.policy!==JSON.stringify(await auditPolicy())) throw new Error("Retention settings changed; preview again");
    await client.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
    const deleted=await client.query(`DELETE FROM meterflo_audit.events e WHERE id=ANY($1::uuid[]) AND
      (e.outcome<>'started' OR EXISTS(SELECT 1 FROM meterflo_audit.events terminal WHERE terminal.operation_id=e.operation_id
        AND terminal.outcome NOT IN ('started','queued','running','retrying')))`,[p.ids]);
    const removed=deleted.rowCount || 0;
    await insertAuditEvent(client,{action:"audit.cleanup",entityType:"auditRetention",entityId:"global",metadata:{removed,before:p.before}});
    await client.query("COMMIT");
    previews.delete(token);
    return {removed};
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function saveAuditPolicy(value:unknown) {
  const policy=auditRetentionSchema.parse(value),client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(715296)");
    const {rows:[old]}=await client.query("SELECT automatic,days FROM meterflo_audit.policy WHERE singleton FOR UPDATE");
    if (JSON.stringify(old)!==JSON.stringify(policy)) {
      await client.query("UPDATE meterflo_audit.policy SET automatic=$1,days=$2 WHERE singleton",[policy.automatic,policy.days]);
      await insertAuditEvent(client,{action:"audit.policyChanged",entityType:"auditRetention",entityId:"global",
        changes:Object.keys(policy).filter(k=>(old as any)[k]!==(policy as any)[k]).map(field=>({field,before:old[field],after:(policy as any)[field]}))});
    }
    await client.query("COMMIT"); previews.clear(); return policy;
  } catch(e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export function startAuditRetention() {
  const timer=setInterval(()=>withAuditContext(serviceAuditContext("auditRetention"),async()=>{
    const p=await auditPolicy();
    if (!p.automatic) return;
    const preview=await previewAuditCleanup("system",new Date(Date.now()-p.days*86400000).toISOString());
    if (preview.count) await cleanupAudit("system",preview.token);
  }).catch(()=>console.warn("[Audit] Automatic retention did not complete; audit events retained.")),60*60*1000);
  timer.unref();
}
