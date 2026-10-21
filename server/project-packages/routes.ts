import type { Express, RequestHandler } from "express";
import multer from "multer";
import os from "node:os";
import fs from "node:fs/promises";
import { storage } from "../storage";
import { isAuthenticated } from "../replitAuth";
import { permissionKeys } from "../../shared/schema";
import { createProjectPackage } from "./archive";
import { restoreProjectPackage } from "./restore";

const upload = multer({ dest: os.tmpdir(), limits: { fileSize: 2 * 1024 ** 3, files: 1, fields: 3 } });
export function registerProjectPackageRoutes(app: Express) {
  const authorize = (permission: string): RequestHandler => async (req: any, res, next) => {
    try {
      const id = Number(req.params.projectId), user = await storage.getUser(req.user.claims.sub);
      if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return void res.status(400).json({ message: "Invalid project." });
      if (!user || !await storage.hasPermission(user, permission) ||
        !await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, id))
        return void res.status(403).json({ message: "Project backup/restore permission and project access are required." });
      if (!await storage.getProject(id)) return void res.status(404).json({ message: "Project not found." });
      next();
    } catch { res.status(500).json({ message: "Could not verify project backup access." }); }
  };
  app.get("/api/projects/:projectId/package", isAuthenticated, authorize(permissionKeys.MAINTENANCE_PROJECT_BACKUP), async (req, res) => {
    let directory: string | undefined;
    try {
      const result = await createProjectPackage(Number(req.params.projectId)); directory = result.directory;
      const filename = `project_${result.manifest.project.name.replace(/[^a-z0-9_-]/gi, "_")}_${new Date().toISOString().slice(0, 10)}.zip`;
      await new Promise<void>((resolve, reject) => res.download(result.zip, filename, error => error ? reject(error) : resolve()));
    } catch (error: any) {
      console.error("Project package backup failed", { type: error.name, code: error.code });
      if (!res.headersSent) res.status(500).json({ message: error.code ? "Project package creation failed. Check database/file access and PostgreSQL tool compatibility." : error.message });
    } finally { if (directory) await fs.rm(directory, { recursive: true, force: true }); }
  });
  app.post("/api/projects/:projectId/package/restore", isAuthenticated, authorize(permissionKeys.MAINTENANCE_PROJECT_RESTORE),
    (req, res, next) => upload.single("backup")(req, res, error => {
      if (error) { res.status(400).json({ message: "Project ZIP upload failed. Select one ZIP no larger than 2 GiB." }); return; } next();
    }),
    async (req, res) => {
      try {
        if (!req.file?.path) return void res.status(400).json({ message: "Select a complete project ZIP." });
        const result = await restoreProjectPackage(req.file.path, Number(req.params.projectId));
        res.json({ ...result, message: "Complete project restored. Review inactive identities, assignments and paused integrations." });
      } catch (error: any) {
        console.error("Project package restore failed", { type: error.name, code: error.code, databaseCommitted: error.databaseCommitted });
        res.status(/empty project|already has|nonempty|disabled/.test(error.message) ? 409 : 400).json({
          message: error.code ? "Restore failed schema or data validation. Check MeterFlo version compatibility." : error.message,
          databaseCommitted: error.databaseCommitted ?? false });
      } finally { if (req.file?.path) await fs.unlink(req.file.path).catch(() => {}); }
    });
}
