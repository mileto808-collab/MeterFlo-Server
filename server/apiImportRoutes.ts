import type { Express, Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { isAuthenticated } from "./replitAuth";
import { storage } from "./storage";
import { pool } from "./db";
import { permissionKeys } from "../shared/schema";
import { ImportFetchError } from "./apiImportFetch";
import {
  ApiImportError, listApiImportConfigs, saveApiImportConfig, deleteApiImportConfig,
  previewApiImport, enqueueApiImport, listApiImportRuns, getApiImportConfig,
} from "./apiImportService";

type ImportRequest = Request & { importProjectId: number; importActor: string; importAdmin: boolean };
export function registerApiImportRoutes(app: Express) {
  const base = "/api/projects/:projectId/api-import";
  const access = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = Number(req.params.projectId);
      if (!Number.isSafeInteger(projectId) || projectId <= 0) return res.status(400).json({ message: "Invalid project ID" });
      const user = await storage.getUser((req.user as any)?.claims?.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Unauthorized" });
      const admin = user.role === "admin" || await storage.isAdminUser(user);
      if (!admin && !await storage.hasPermission(user, permissionKeys.PROJECT_API_IMPORT)) return res.status(403).json({ message: "API Import permission is required" });
      if (!admin && !await storage.isUserAssignedToProject(user.id, projectId)) return res.status(403).json({ message: "You are not assigned to this project" });
      if (!await storage.getProject(projectId)) return res.status(404).json({ message: "Project not found" });
      Object.assign(req, { importProjectId: projectId, importActor: user.id, importAdmin: admin });
      next();
    } catch { res.status(500).json({ message: "Could not verify project access" }); }
  };
  const handler = (adminOnly: boolean, action: (req: ImportRequest, res: Response) => Promise<unknown>) =>
    [isAuthenticated, access, async (request: Request, res: Response) => {
      const req = request as ImportRequest;
      if (adminOnly && !req.importAdmin) return res.status(403).json({ message: "Only administrators can configure API imports, preview unsaved endpoints, or retry failed runs" });
      try { await action(req, res); }
      catch (error) {
        if (error instanceof ZodError) return res.status(400).json({ message: "Invalid import configuration. Check the required fields, mapping, authentication, and pagination settings." });
        if (error instanceof ApiImportError) return res.status(error.status).json({ message: error.message });
        if (error instanceof ImportFetchError) return res.status(400).json({ message: error.message });
        // Auth/fetch messages never include remote bodies or credential values.
        if (error instanceof Error && /Customer API|credentials.*not configured|secret.*not configured|configured records|Next-page|Pagination URL|authentication|API key header/i.test(error.message)) {
          return res.status(400).json({ message: error.message });
        }
        res.status(500).json({ message: "API import could not complete. Check the configuration and server/database availability." });
      }
    }] as const;
  const id = (value: string) => {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new ApiImportError("Invalid configuration ID");
    return parsed;
  };
  app.get(`${base}/configs`, ...handler(false, async (req, res) => res.json(await listApiImportConfigs(req.importProjectId))));
  app.post(`${base}/configs`, ...handler(true, async (req, res) => res.status(201).json(await saveApiImportConfig(req.importProjectId, req.body))));
  app.patch(`${base}/configs/:id`, ...handler(true, async (req, res) => res.json(await saveApiImportConfig(req.importProjectId, req.body, id(req.params.id)))));
  app.delete(`${base}/configs/:id`, ...handler(true, async (req, res) => { await deleteApiImportConfig(req.importProjectId, id(req.params.id)); res.sendStatus(204); }));
  app.post(`${base}/preview`, ...handler(true, async (req, res) => res.json(await previewApiImport(req.importProjectId, req.body))));
  app.post(`${base}/configs/:id/preview`, ...handler(false, async (req, res) => {
    const config = await getApiImportConfig(req.importProjectId, id(req.params.id));
    res.json(await previewApiImport(req.importProjectId, config.settings));
  }));
  app.post(`${base}/configs/:id/run`, ...handler(false, async (req, res) => res.status(202).json(await enqueueApiImport(req.importProjectId, id(req.params.id), `manual:${req.importActor}`))));
  app.get(`${base}/runs`, ...handler(false, async (req, res) => {
    const limit = Number(req.query.limit ?? 25), offset = Number(req.query.offset ?? 0);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || !Number.isInteger(offset) || offset < 0) throw new ApiImportError("Invalid history pagination");
    res.json(await listApiImportRuns(req.importProjectId, limit, offset));
  }));
  app.post(`${base}/runs/:runId/retry`, ...handler(true, async (req, res) => {
    const { rows: [run] } = await pool.query(`SELECT config_id FROM public.api_import_runs WHERE id=$1 AND project_id=$2`, [req.params.runId, req.importProjectId]);
    if (!run) throw new ApiImportError("Import run not found", 404);
    if (!run.config_id) throw new ApiImportError("The configuration was removed; create a new configuration to import again", 409);
    res.status(202).json(await enqueueApiImport(req.importProjectId, run.config_id, `retry:${req.importActor}`, req.params.runId));
  }));
}
