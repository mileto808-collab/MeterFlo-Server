import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { pool } from "./db";
import { canStart, ChangeoutError } from "./changeoutService";
import { getProjectWorkOrderStorage } from "./projectDb";
import { createReplacement, replacementContext, cancelReplacement } from "./replacementService";
import { emitWorkOrderCreated, emitWorkOrderUpdated } from "./eventEmitter";
import { replacementReceipt } from "./replacementReceipt";
import { restoreReplacement, deleteUnusedReplacement } from "./replacementRecovery";

export function registerReplacementRoutes(app: Express, auth: any) {
  const route = "/api/projects/:projectId/work-orders/:workOrderId/replacement";
  const handle = (fn: Function) => async (req: any, res: any) => {
    try {
      const user = await storage.getUser(req.user?.claims?.sub);
      if (!user || !await canStart(user)) throw new ChangeoutError("View Work Orders and Start Changeout permissions are required.", 403, "REPLACEMENT_FORBIDDEN");
      const projectId = z.coerce.number().int().positive().parse(req.params.projectId);
      const id = z.coerce.number().int().positive().parse(req.params.workOrderId);
      if (!await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, projectId))
        throw new ChangeoutError("Project access required.", 403, "REPLACEMENT_FORBIDDEN");
      const project = await storage.getProject(projectId);
      if (!project?.databaseName || !/^project_[a-z0-9_]+$/.test(project.databaseName))
        throw new ChangeoutError("Project not found.", 404, "REPLACEMENT_NOT_FOUND");
      const workOrders = getProjectWorkOrderStorage(project.databaseName);
      if (!(await pool.query(`SELECT 1 FROM "${project.databaseName}".work_orders WHERE id=$1`, [id])).rowCount)
        throw new ChangeoutError("Work order not found.", 404, "REPLACEMENT_NOT_FOUND");
      const rawProject = (await pool.query("SELECT * FROM public.projects WHERE id=$1", [projectId])).rows[0];
      res.set("Cache-Control", "no-store");
      await fn(req, res, { project: rawProject, user, id, schema: project.databaseName, workOrders });
    } catch (error) {
      if (error instanceof ChangeoutError) return res.status(error.status).json({ message: error.message, code: error.code });
      if (error instanceof z.ZodError) return res.status(400).json({ message: "Invalid replacement request.", code: "REPLACEMENT_INPUT", errors: error.issues });
      console.error("Replacement request failed", error);
      res.status(500).json({ message: "Replacement request failed. Keep the same operation identity when retrying.", code: "REPLACEMENT_FAILED" });
    }
  };
  app.get(route, auth, handle(async (_req: any, res: any, { project, user, id, schema }: any) => {
    res.json(await replacementContext(pool, schema, project, user, id));
  }));
  app.post(route, auth, handle(async (req: any, res: any, { project, user, id, schema, workOrders }: any) => {
    const result = await createReplacement(schema, project, user, id, req.body);
    const workOrder = await workOrders.getWorkOrder(result.id);
    if (!result.replay) emitWorkOrderCreated(project.id, result.id, user.id);
    res.status(result.replay ? 200 : 201).json({ workOrder, replacementVisit: workOrder.replacementVisit, replay: result.replay });
  }));
  app.post(`${route}/cancel`, auth, handle(async (req: any, res: any, { project, user, id, schema, workOrders }: any) => {
    z.object({}).strict().parse(req.body ?? {});
    const replay = await cancelReplacement(schema, project, user, id);
    emitWorkOrderUpdated(project.id, id, user.id);
    res.json({ workOrder: await workOrders.getWorkOrder(id), replay });
  }));
  app.get(`${route}/operations/:operationId`, auth, handle(async (req: any, res: any, { user, id, schema }: any) => {
    const operationId = z.string().uuid().parse(req.params.operationId);
    const { rows: [row] } = await pool.query(`SELECT * FROM "${schema}".work_orders
      WHERE replacement_operation_id=$1 AND replacement_parent_id=$2`, [operationId, id]);
    if (!row) throw new ChangeoutError("The operation has not been confirmed. Keep its identity when retrying.", 404, "REPLACEMENT_OPERATION_UNKNOWN");
    if (row.replacement_actor_id !== user.id && !await storage.isAdminUser(user))
      throw new ChangeoutError("This request belongs to another user.", 403, "REPLACEMENT_FORBIDDEN");
    res.json({ operationId, workOrderId: row.id, label: row.customer_wo_id || `Work order ${row.id}`,
      status: row.replacement_deleted_at ? "deleted" : row.replacement_cancelled_at ? "cancelled" : row.replacement_active ? "active" : "completed" });
  }));
  app.post(`${route}/restore`, auth, handle(async (req: any, res: any, { project, user, id, schema, workOrders }: any) => {
    const replay = await restoreReplacement(schema, project, user, id, req.body);
    emitWorkOrderUpdated(project.id, id, user.id);
    const workOrder = await workOrders.getWorkOrder(id);
    res.json({ workOrder, replacementVisit: workOrder?.replacementVisit, replay });
  }));
  app.post(`${route}/delete`, auth, handle(async (req: any, res: any, { project, user, id, schema }: any) => {
    const replay = await deleteUnusedReplacement(schema, project, user, id, req.body);
    emitWorkOrderUpdated(project.id, id, user.id);
    res.json({ deleted: true, workOrderId: id, replay });
  }));
  app.get(`${route}/receipt`, auth, handle(async (_req: any, res: any, { project, user, id, schema }: any) => {
    const context = await replacementContext(pool, schema, project, user, id);
    res.type("html").send(replacementReceipt(project.name, context, project.wizard_mode === "reading_only"));
  }));
}
