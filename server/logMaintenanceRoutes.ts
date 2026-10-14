import type { Express } from "express";
import { z, ZodError } from "zod";
import { isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import { pool } from "./db";
import { setLogRotationMiB } from "./logger";
import { LogMaintenanceService, MaintenanceError } from "./logMaintenanceService";
import { LogRepository } from "./logMaintenanceRepository";
import { auditInventory } from "./auditService";

export const logMaintenance = new LogMaintenanceService(new LogRepository(pool),undefined,setLogRotationMiB);
export function registerLogMaintenanceRoutes(app: Express, service = logMaintenance) {
  const base = "/api/maintenance/logs";
  app.use(base,isAuthenticated,async (req:any,res,next) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || !(await storage.hasPermission(user,"maintenance.logManagement"))) return res.status(403).json({ message:"Log management permission required." });
      next();
    } catch { res.status(500).json({ message:"Could not verify log-management permission." }); }
  });
  const handle = (fn: (req:any) => Promise<unknown>) => async (req:any,res:any) => {
    try { res.json(await fn(req)); }
    catch (e) {
      if (e instanceof ZodError) return res.status(400).json({ message:"Invalid log-maintenance settings or filters." });
      if (e instanceof MaintenanceError) return res.status(e.status).json({ message:e.message });
      res.status(500).json({ message:"Log maintenance unavailable. Check database availability, LOG_DIR permissions and directory limits." });
    }
  };
  app.get(base,handle(async req => {
    const summary=await service.summary(),user=await storage.getUser(req.user.claims.sub);
    if (user && await storage.hasPermission(user,"audit.view") && await storage.hasPermission(user,"audit.viewAllProjects")
      && await storage.hasPermission(user,"audit.manageRetention")) {
      const audit=await auditInventory();
      return {...summary,auditInventory:{count:audit.count,bytes:audit.bytes,oldest:audit.oldest,newest:audit.newest}};
    }
    return summary;
  }));
  app.put(`${base}/policy`,handle(req => service.savePolicy(req.body,req.user.claims.sub)));
  app.post(`${base}/preview`,handle(req => service.preview(req.body,req.user.claims.sub)));
  app.post(`${base}/cleanup`,handle(req => {
    const body = z.object({ token:z.string().uuid(),confirm:z.literal(true) }).strict().parse(req.body);
    return service.cleanup(body.token,req.user.claims.sub);
  }));
}
export function startLogMaintenance() {
  // Rotation policy is loaded without changing settings or deleting anything.
  logMaintenance.policy().then(p => setLogRotationMiB(p.rotationMiB)).catch(() => console.warn("[Log maintenance] Invalid policy; defaults retained."));
  const timer = setInterval(() => {
    logMaintenance.automatic().catch(() => console.warn("[Log maintenance] Scheduled cleanup did not complete; check settings, database and LOG_DIR."));
  },60*60*1000);
  timer.unref();
}
