import { randomUUID } from "node:crypto";
import { pool } from "./db";
import { auditContext } from "./auditContext";
import { inventoryState, inventoryWorkOrderChange, lockInventoryForSchema } from "./inventoryService";
import { workRequirements } from "./inventoryRequirements";
import { resolveFieldStock } from "../shared/inventory-field-stock";
import { emitWorkOrderUpdated } from "./eventEmitter";
import { schemaName } from "./changeoutService";
import { insertAuditEvent } from "./auditService";

/** Exported so isolated integration checks can drain the real durable queue. */
export async function processNextChangeout() {
  const client = await pool.connect();
  let job: any;
  try {
    await client.query("BEGIN");
    const selected = await client.query(`SELECT c.*,p.database_name,p.inventory_enabled FROM public.changeout_completions c
      JOIN public.projects p ON p.id=c.project_id
      WHERE c.status IN ('pending','failed') AND c.attempts<5 AND c.next_attempt_at<=now()
      ORDER BY c.created_at FOR UPDATE OF c SKIP LOCKED LIMIT 1`);
    job = selected.rows[0];
    if (!job) { await client.query("COMMIT"); return false; }
    if (!job.inventory_enabled) throw new Error("Inventory is paused. Review the accepted usage before resuming reconciliation.");
    const evidence = job.evidence;
    if (schemaName(evidence.schema) !== schemaName(job.database_name)) throw new Error("Project database association changed; review required.");
    await auditContext.run({ actorId: job.actor_id, actorLabel: job.actor_label, actorKind: "service",
      source: "inventory-reconciliation", operationId: job.id }, async () => {
      await lockInventoryForSchema(client, job.database_name);
      const { rows: [currentWork] } = await client.query(`SELECT status,new_system_id,new_module_id FROM "${job.database_name}".work_orders WHERE id=$1`, [job.work_order_id]);
      const { rows: [status] } = await client.query("SELECT code FROM public.work_order_statuses WHERE lower(code)=lower($1) OR lower(label)=lower($1) LIMIT 1", [currentWork?.status ?? ""]);
      if (!currentWork || !["completed", "closed"].includes(String(status?.code ?? currentWork.status).toLowerCase()) ||
          ["new_system_id", "new_module_id"].some(key => String(currentWork[key] ?? "") !== String(evidence.next[key] ?? "")))
        throw new Error("Accepted installation no longer matches the work order. Review restored or corrected records before accounting for this usage.");
      const state = await inventoryState(job.project_id, client);
      const priorAllocation = state.allocations.find(a => a.workOrderId === job.work_order_id);
      let usage = job.reviewed_usage ?? evidence.usage;
      if (!usage && priorAllocation?.mode) usage = {
        mode: priorAllocation.mode, used: priorAllocation.used, dispositions: priorAllocation.dispositions,
      };
      if (!usage || (!usage.used?.length && usage.mode !== "reading_only")) {
        const requirements = await workRequirements(client, job.project_id, state, evidence.next);
        if (requirements.missing.length) throw new Error("New equipment type mapping is missing. Correct the project inventory mapping and retry.");
        const source = resolveFieldStock(state, job.actor_id, true);
        if (!source.source) throw new Error("Field stock source needs warehouse review.");
        if (!requirements.lines.length) throw new Error("Actual usage needs review: no inventory lines or equipment mapping were captured.");
        usage = { mode: "changeout", dispositions: usage?.dispositions ?? [], used: requirements.lines.map(line => {
          const item = state.items.find(i => i.id === line.itemId);
          const serial = item?.equipment === "system" ? evidence.next.new_system_id :
            item?.equipment === "module" ? evidence.next.new_module_id : null;
          return { itemId: line.itemId, quantity: line.quantity, warehouseId: source.source!.id,
            serials: item?.tracking === "serialized" && serial ? [serial] : [] };
        }) };
      }
      const command = { operationId: randomUUID(), revision: priorAllocation?.revision ?? 0,
        mode: usage.mode, used: usage.used ?? [], dispositions: usage.dispositions ?? [] };
      if (command.mode === "reading_only" && ["system", "module"].some(equipment =>
        String(evidence.next[`new_${equipment}_id`] ?? "") !== String(evidence.prior[`old_${equipment}_id`] ?? "")))
        throw new Error("Reading-only usage cannot account for a changed equipment identity. Review the captured actual installation.");
      await inventoryWorkOrderChange(client, job.database_name, evidence.prior, evidence.next, command, undefined, false, true);
      await client.query("UPDATE public.changeout_completions SET status='succeeded',attempts=attempts+1,error=null,finished_at=now() WHERE id=$1", [job.id]);
      await client.query("UPDATE public.changeout_installation_claims SET active=false WHERE completion_id=$1", [job.id]);
      await insertAuditEvent(client, { action: "workOrder.inventoryReconciled", entityType: "work_orders",
        entityId: String(job.work_order_id), projectId: job.project_id,
        metadata: { submissionId: job.id, reviewedBy: job.reviewed_by ?? null } });
      await client.query("COMMIT");
    });
    emitWorkOrderUpdated(job.project_id, job.work_order_id);
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    if (!job) throw error;
    // Only this queue row changes; accepted work and immutable evidence remain.
    await pool.query(`UPDATE public.changeout_completions SET status='failed',attempts=attempts+1,
      error=$2,next_attempt_at=now()+(LEAST(3600,30*power(2,attempts))||' seconds')::interval
      WHERE id=$1 AND attempts=$3 AND status=$4`,
    [job.id, error instanceof Error ? error.message.slice(0, 1500) : "Inventory reconciliation failed", job.attempts, job.status]);
    return true;
  } finally { client.release(); }
}

let running = false;
export function startChangeoutWorker() {
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { for (let i = 0; i < 10 && await processNextChangeout(); i++); }
    catch { console.error("Changeout reconciliation queue unavailable; accepted jobs remain durable."); }
    finally { running = false; }
  }, 3000);
  timer.unref();
}
