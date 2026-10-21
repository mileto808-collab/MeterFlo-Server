import type { Express } from "express";
import { z } from "zod";
import { pool } from "./db";
import { storage } from "./storage";
import { ChangeoutError, canStart, draftDto, draftEligibility, draftInput, schemaName } from "./changeoutService";
import { permissionKeys } from "../shared/schema";
import { insertAuditEvent } from "./auditService";
import { inventoryState } from "./inventoryService";
import { warehouseAccess } from "../shared/inventory-engine";
import { allocationSchema, dispositionSchema } from "../shared/inventory";

export function registerChangeoutRoutes(app: Express, auth: any) {
  const scope = async (req: any, inventory = false) => {
    const user = await storage.getUser(req.user?.claims?.sub);
    const projectId = z.coerce.number().int().positive().parse(req.params.projectId);
    if (!user || user.isLocked || (inventory ? !await storage.hasPermission(user, permissionKeys.INVENTORY_VIEW) : !await canStart(user)))
      throw new ChangeoutError("Forbidden", 403);
    if (!await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, projectId))
      throw new ChangeoutError("Project access required.", 403);
    const { rows: [project] } = await pool.query("SELECT * FROM public.projects WHERE id=$1", [projectId]);
    if (!project?.database_name) throw new ChangeoutError("Project not found.", 404);
    return { user, project, schema: schemaName(project.database_name) };
  };
  const handle = (fn: Function) => async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (e: any) { res.status(e.status ?? (e instanceof z.ZodError ? 400 : 500)).json({
      message: e instanceof ChangeoutError ? e.message : e instanceof z.ZodError ? "Invalid draft or reconciliation request." : "Changeout request failed." }); }
  };
  app.get("/api/projects/:projectId/changeout-drafts", auth, handle(async (req: any, res: any) => {
    const { user, project, schema } = await scope(req);
    const { rows } = await pool.query(`SELECT d.work_order_id,d.submission_id,d.assignment_version,d.revision,d.step,d.updated_at,
      w.status,w.assigned_user_id,w.assignment_version AS current_version,w.customer_wo_id
      FROM public.changeout_drafts d LEFT JOIN ${schema}.work_orders w ON w.id=d.work_order_id
      WHERE d.project_id=$1 AND d.user_id=$2 ORDER BY d.updated_at DESC`, [project.id, user.id]);
    const drafts = [];
    for (const row of rows) {
      const eligibility = await draftEligibility(pool, { ...row, assignment_version: row.current_version }, user.id, row);
      if (!eligibility.completed) drafts.push({ ...draftDto(row), capture: undefined, ...eligibility,
        assignmentVersion: row.assignment_version, customerWoId: row.customer_wo_id });
    }
    res.json({ drafts });
  }));
  const path = "/api/projects/:projectId/work-orders/:workOrderId/changeout-draft";
  app.get(path, auth, handle(async (req: any, res: any) => {
    const { user, project, schema } = await scope(req);
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    const { rows: [work] } = await pool.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1`, [id]);
    const selectedToken = req.query.submissionId === undefined ? null : z.string().uuid().parse(req.query.submissionId);
    const { rows: [draft] } = await pool.query(`SELECT * FROM public.changeout_drafts
      WHERE project_id=$1 AND work_order_id=$2 AND user_id=$3 AND ($5::uuid IS NULL OR submission_id=$5)
      ORDER BY (assignment_version=$4) DESC,updated_at DESC LIMIT 1`, [project.id, id, user.id, work?.assignment_version ?? -1, selectedToken]);
    const eligibility = await draftEligibility(pool, work, user.id, draft);
    res.json({ draft: eligibility.completed ? null : draft ? draftDto(draft) : null, ...eligibility });
  }));
  app.put(path, auth, handle(async (req: any, res: any) => {
    const { user, project, schema } = await scope(req);
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    const input = draftInput.parse(req.body);
    if (Buffer.byteLength(JSON.stringify(input.capture)) > 25 * 1024 * 1024)
      throw new ChangeoutError("Server draft exceeds 25 MiB. Keep the local copy and reduce photo size before retrying.", 413);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { rows: [work] } = await client.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1 FOR UPDATE`, [id]);
      const { rows: [existing] } = await client.query(`SELECT * FROM public.changeout_drafts
        WHERE project_id=$1 AND work_order_id=$2 AND user_id=$3 AND submission_id=$4`,
      [project.id, id, user.id, input.submissionId]);
      const eligibility = await draftEligibility(client, work, user.id, existing);
      if (!eligibility.canResume) throw new ChangeoutError(eligibility.reason ?? "Cannot resume.", 409);
      if (input.assignmentVersion !== undefined && input.assignmentVersion !== work.assignment_version)
        throw new ChangeoutError("The assignment changed. This draft remains local and cannot overwrite a new assignment.");
      if (project.is_active === false) throw new ChangeoutError("Project is inactive.", 403);
      const { rows: [saved] } = await client.query(`INSERT INTO public.changeout_drafts
        (project_id,work_order_id,user_id,submission_id,assignment_version,revision,step,capture)
        SELECT $1,$2,$3,$4,$5,1,$6,$7 WHERE $8=0
        ON CONFLICT(project_id,work_order_id,user_id,submission_id) DO UPDATE SET
        revision=changeout_drafts.revision+1,step=EXCLUDED.step,capture=EXCLUDED.capture,updated_at=now()
        WHERE changeout_drafts.revision=$8 RETURNING *`,
      [project.id, id, user.id, input.submissionId, work.assignment_version, input.step, JSON.stringify(input.capture), input.baseRevision]);
      // UPDATE for existing revisions cannot use INSERT ... WHERE false.
      let result = saved;
      if (!result && input.baseRevision > 0) {
        const updated = await client.query(`UPDATE public.changeout_drafts SET revision=revision+1,step=$5,capture=$6,updated_at=now()
          WHERE project_id=$1 AND work_order_id=$2 AND user_id=$3 AND submission_id=$4 AND revision=$7 RETURNING *`,
        [project.id, id, user.id, input.submissionId, input.step, JSON.stringify(input.capture), input.baseRevision]);
        result = updated.rows[0];
      }
      if (!result) throw new ChangeoutError("A newer server draft exists. Your local capture was not overwritten.", 409);
      await client.query("COMMIT");
      res.json({ draft: draftDto(result), ...eligibility });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }));
  app.delete(path, auth, handle(async (req: any, res: any) => {
    const { user, project } = await scope(req);
    const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
    const revision = z.number().int().nonnegative().parse(req.body.baseRevision);
    const submissionId = z.string().uuid().parse(req.body.submissionId);
    const result = await pool.query(`DELETE FROM public.changeout_drafts WHERE project_id=$1 AND work_order_id=$2
      AND user_id=$3 AND revision=$4 AND submission_id=$5 RETURNING submission_id`, [project.id, id, user.id, revision, submissionId]);
    if (!result.rowCount && revision !== 0) throw new ChangeoutError("Draft changed. Refresh before discarding.");
    const auditClient = await pool.connect();
    try { await insertAuditEvent(auditClient, { action: "workOrder.draftDiscarded", entityType: "work_orders", entityId: String(id),
      projectId: project.id, metadata: { count: result.rowCount } }); } finally { auditClient.release(); }
    res.json({ deleted: result.rowCount });
  }));
  app.get("/api/projects/:projectId/changeout-reconciliation", auth, handle(async (req: any, res: any) => {
    const { project } = await scope(req, true);
    const { rows } = await pool.query(`SELECT id,work_order_id AS "workOrderId",status,attempts,error,created_at AS "createdAt",
      finished_at AS "finishedAt",actor_label AS "actorLabel",review_reason AS "reviewReason",
      evidence->'usage' AS usage,reviewed_usage AS "reviewedUsage",
      evidence->'next'->>'customer_wo_id' AS "customerWoId",
      evidence->'next'->>'new_system_id' AS "newSystemId",evidence->'next'->>'new_module_id' AS "newModuleId"
      FROM public.changeout_completions WHERE project_id=$1 AND (
        status IN ('pending','failed') OR id IN (
          SELECT id FROM public.changeout_completions WHERE project_id=$1 AND status='succeeded'
          ORDER BY created_at DESC LIMIT 500))
      ORDER BY created_at DESC`, [project.id]);
    res.json({ jobs: rows });
  }));
  app.post("/api/projects/:projectId/changeout-reconciliation/:id/retry", auth, handle(async (req: any, res: any) => {
    const { user, project } = await scope(req, true);
    if (!await storage.hasPermission(user, permissionKeys.INVENTORY_RESOLVE_EXCEPTIONS))
      throw new ChangeoutError("Resolve Inventory Exceptions permission required.", 403);
    const id = z.string().uuid().parse(req.params.id);
    const { reason, usage } = z.object({ reason: z.string().trim().min(10).max(2000), usage: z.record(z.unknown()).optional() }).parse(req.body);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`UPDATE public.changeout_completions SET status='pending',attempts=0,error=null,
        next_attempt_at=now(),reviewed_usage=COALESCE($3,reviewed_usage),reviewed_by=$4,review_reason=$5
        WHERE id=$1 AND project_id=$2 AND status='failed' RETURNING *`,
      [id, project.id, usage ? JSON.stringify(usage) : null, user.id, reason]);
      if (!result.rowCount) throw new ChangeoutError("This job is no longer awaiting review.");
      const capture = usage ?? result.rows[0].reviewed_usage ?? result.rows[0].evidence.usage;
      if (capture) {
        const checked = z.object({ mode: z.enum(["changeout", "reading_only"]), used: z.array(allocationSchema),
          dispositions: z.array(dispositionSchema) }).passthrough().parse(capture);
        const state = await inventoryState(project.id, client), admin = await storage.isAdminUser(user);
        for (const line of checked.used) warehouseAccess(state, line.warehouseId, user.id, admin);
        for (const disposition of checked.dispositions)
          if (disposition.warehouseId) warehouseAccess(state, disposition.warehouseId, user.id, admin);
      }
      await insertAuditEvent(client, { action: "workOrder.inventoryReconciliationRetry", entityType: "work_orders",
        entityId: id, projectId: project.id, metadata: { reason, correctedCapture: !!usage } });
      await client.query("COMMIT");
      res.json({ queued: true });
    } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
  }));
}
