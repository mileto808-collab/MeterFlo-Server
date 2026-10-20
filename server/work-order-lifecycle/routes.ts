import type { Express } from "express";
import { z } from "zod";
import { pool } from "../db";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";
import { auditContext, withAuditContext } from "../auditContext";
import { insertAuditEvent } from "../auditService";
import { getProjectWorkOrderStorage } from "../projectDb";
import { closingPolicy, lifecycleBatch, lifecycleError, saveClosingPolicy } from "./service";
import { historyCsv, historyPrint, workOrderHistory } from "./history";
import { projectSchema } from "./schema";
import { withBackupExclusive } from "../backups/lock";

export function registerWorkOrderLifecycleRoutes(app: Express) {
  registerWorkOrderGuard(app);
  const access = async (req: any, permissions: string[] = []) => {
    const user = await storage.getUser(req.user?.claims?.sub);
    const id = z.coerce.number().int().positive().parse(req.params.projectId);
    if (!user) throw lifecycleError("Unauthorized.", 401);
    if (!await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, id)) throw lifecycleError("Project access required.", 403);
    for (const permission of permissions)
      if (!await storage.hasPermission(user, permission)) throw lifecycleError(`Permission required: ${permission}`, 403);
    const project = await storage.getProject(id);
    if (!project?.databaseName) throw lifecycleError("Project not found.", 404);
    return { user, project, id };
  };
  const handler = (fn: (req: any, res: any) => Promise<unknown>) => async (req: any, res: any) => {
    try { await fn(req, res); }
    catch (e: any) { res.status(e instanceof z.ZodError ? 400 : e.status || 500).json({
      message: e instanceof z.ZodError ? "Invalid closing settings, reason, or history filters." : e.status ? e.message : "Work-order lifecycle action failed. No success is assumed." }); }
  };
  app.get("/api/projects/:projectId/work-order-closing", isAuthenticated, handler(async (req, res) => {
    const { user, id } = await access(req);
    res.json({ ...await closingPolicy(id), canManage: await storage.hasPermission(user, "projects.edit") && await storage.hasPermission(user, "workOrders.close") });
  }));
  app.put("/api/projects/:projectId/work-order-closing", isAuthenticated, handler(async (req, res) => {
    const { id, project } = await access(req, ["projects.edit", "workOrders.close"]);
    if (project.isActive === false) throw lifecycleError("Inactive projects cannot be changed.");
    res.json({ ...await withBackupExclusive(() => saveClosingPolicy(id, req.body)), canManage: true });
  }));
  app.post("/api/projects/:projectId/work-orders/:workOrderId/reopen", isAuthenticated, handler(async (req, res) => {
    const { id, project } = await access(req, ["workOrders.edit", "workOrders.reopenClosed"]);
    const woId = z.coerce.number().int().positive().parse(req.params.workOrderId);
    const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(req.body);
    const result = await withBackupExclusive(() => lifecycleBatch(id, [woId], "reopen", reason));
    if (!result.updatedCount) throw lifecycleError(result.skippedReasons[0] || "Reopen failed.");
    res.json(await getProjectWorkOrderStorage(project.databaseName!).getWorkOrder(woId));
  }));
  app.post("/api/projects/:projectId/work-orders/:workOrderId/close", isAuthenticated, handler(async (req, res) => {
    const { id, project } = await access(req, ["workOrders.edit", "workOrders.close"]);
    const woId = z.coerce.number().int().positive().parse(req.params.workOrderId);
    const result = await withBackupExclusive(() => lifecycleBatch(id, [woId], "close"));
    if (!result.updatedCount) throw lifecycleError(result.skippedReasons[0] || "Close failed.");
    res.json(await getProjectWorkOrderStorage(project.databaseName!).getWorkOrder(woId));
  }));
  app.get("/api/projects/:projectId/work-order-history", isAuthenticated, handler(async (req, res) => {
    const { id } = await access(req, ["audit.view"]);
    const data = await workOrderHistory(id, req.query);
    res.set("Cache-Control", "no-store");
    if (req.query.format === "print") res.type("html").send(historyPrint(data));
    else if (req.query.format === "csv") res.set("Content-Disposition", 'attachment; filename="work-order-history.csv"').type("text/csv").send(historyCsv(data));
    else res.json(data);
  }));
}
function registerWorkOrderGuard(app: Express) {
  // Protect files/signatures and other non-row side effects before handlers run.
  // Database triggers remain the final guard for bulk, SQL, import and sync paths.
  app.use(async (req: any, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    const match = req.path.match(/^\/api\/(?:mobile\/)?projects\/(\d+)\/(?:mobile\/)?work-orders\/(\d+|bulk-[a-z-]+)(\/.*)?$/);
    if (!match || !req.isAuthenticated?.()) return next();
    const context = auditContext.getStore(), id = Number(match[1]), woId = Number(match[2]);
    const auditAction = (action: string, outcome: string) => {
      if (!context) return;
      void withAuditContext(context, async () => {
        const client = await pool.connect();
        try { await insertAuditEvent(client, { action, entityType: Number.isFinite(woId) ? "work_orders" : "workOrderBatch",
          entityId: Number.isFinite(woId) ? String(woId) : "batch", projectId: id, outcome,
          metadata: { method: req.method, responseStatus: res.statusCode,
            ...(!Number.isFinite(woId) && Array.isArray(req.body?.workOrderIds) ? {
              workOrderIds: req.body.workOrderIds.filter((id: unknown) => Number.isSafeInteger(id) && Number(id) > 0).slice(0, 5000),
            } : {}) } }); }
        finally { client.release(); }
      }).catch(() => console.error("[work-order-history] Could not record action outcome."));
    };
    res.once("finish", () => {
      if (res.statusCode >= 400) auditAction("workOrder.changeBlocked", "failed");
      else if (/\/(?:files|photos|signature)(?:\/|$)/.test(match[3] || "")) auditAction(
        req.method === "DELETE" ? "workOrder.evidenceRemoved" : "workOrder.evidenceAdded", "success");
    });
    if (!Number.isFinite(woId) || match[3] === "/reopen" || match[3] === "/close") return next();
    try {
      const user = context?.actorId ? await storage.getUser(context.actorId) : undefined;
      if (!user || (!await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, id))) return next();
      const project = await storage.getProject(id);
      if (!project?.databaseName) return next();
      const { rows: [row] } = await pool.query(`SELECT public.meterflo_work_order_status_is(status,'Closed') closed,
        public.meterflo_work_order_status_is(status,'Completed') completed,review_started_at
        FROM ${projectSchema(project.databaseName)}.work_orders WHERE id=$1`, [woId]);
      if (row?.closed) return res.status(409).json({ message: "Closed work orders must be explicitly reopened by an authorized user before corrections." });
      if (row?.completed && row.review_started_at && !await storage.hasPermission(user, "workOrders.edit"))
        return res.status(403).json({ message: "Edit Work Orders permission is required to correct a reopened work order." });
      next();
    } catch { res.status(503).json({ message: "Could not verify work-order edit access. Try again." }); }
  });
}
