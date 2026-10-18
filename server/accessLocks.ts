import type { Express, RequestHandler } from "express";
import { pool } from "./db";
import { storage } from "./storage";
import { accessLockContext } from "./accessLockContext";
import { insertAuditEvent } from "./auditService";
import { isAuthenticated } from "./replitAuth";
import { accessLockPermissions, accessLockUpdate, type AccessLock } from "../shared/access-locks";

const empty = (projectId: number | null): AccessLock => ({
  scope: projectId === null ? "site" : "project", projectId, locked: false,
  message: "", updatedAt: null, updatedBy: null,
});
const dto = (row: any): AccessLock => ({
  scope: row.project_id === null ? "site" : "project", projectId: row.project_id,
  locked: row.locked, message: row.message,
  updatedAt: new Date(row.updated_at).toISOString(), updatedBy: row.updated_by,
});
const key = (id: number | null) => id === null ? "site" : `project:${id}`;

export async function initializeAccessLocks() {
  await pool.query(`CREATE TABLE IF NOT EXISTS public.access_locks (
    id varchar(80) PRIMARY KEY,
    project_id integer REFERENCES public.projects(id) ON DELETE CASCADE,
    locked boolean NOT NULL DEFAULT false,
    message varchar(1000) NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    updated_by varchar REFERENCES public.users(id) ON DELETE SET NULL,
    CONSTRAINT access_lock_scope CHECK (
      (project_id IS NULL AND id='site') OR (project_id IS NOT NULL AND id='project:'||project_id::text))
  );
  CREATE INDEX IF NOT EXISTS access_locks_active ON public.access_locks(project_id) WHERE locked=true`);
}
export async function readAccessLock(projectId: number | null) {
  const { rows } = await pool.query("SELECT * FROM public.access_locks WHERE id=$1", [key(projectId)]);
  return rows.length ? dto(rows[0]) : empty(projectId);
}
export async function accessLockCapabilities(user: any) {
  const permissions = user ? await storage.getUserEffectivePermissions(user) : [];
  return { site: permissions.includes(accessLockPermissions.site),
    project: permissions.includes(accessLockPermissions.project) || permissions.includes(accessLockPermissions.site) };
}
export function sendAccessLocked(res: any, lock: AccessLock) {
  return res.status(423).set("Cache-Control", "no-store").json({
    code: "ACCESS_LOCKED", scope: lock.scope, projectId: lock.projectId,
    message: lock.message || "Access is temporarily locked. Contact an administrator.",
  });
}
export async function loginAccessLock(user: any) {
  const lock = await readAccessLock(null);
  return lock.locked && !(await accessLockCapabilities(user)).site ? lock : null;
}

// Enforcement precedes feature routers, uploads, exports and mobile endpoints.
// Read fresh shared DB state on every request: no process-local lock cache.
export const accessLockMiddleware: RequestHandler = async (req: any, res, next) => {
  let path: string;
  try { path = decodeURIComponent(req.path).toLowerCase().replace(/\/+$/, ""); }
  catch { return void res.status(400).json({ message: "Invalid request path." }); }
  if (!path.startsWith("/api/")) return next();
  const safe = [
    "/api/auth/local/login", "/api/auth/user", "/api/logout",
    "/api/access-locks/status", "/api/access-locks/site",
    "/api/security/turnstile-config", "/api/security/turnstile/status", "/api/security/turnstile/verify",
    "/api/system/version",
  ];
  if (safe.includes(path)) return next();
  try {
    const { rows } = await pool.query("SELECT * FROM public.access_locks WHERE locked=true");
    if (!rows.length) return accessLockContext.run(new Map(), () => next());
    const validSession = req.isAuthenticated?.() && req.user?.expires_at >= Math.floor(Date.now() / 1000);
    const user = validSession && req.user?.claims?.sub ? await storage.getUser(req.user.claims.sub) : undefined;
    if (user?.isLocked) return void res.status(403).json({ message: "Account is locked." });
    const caps = await accessLockCapabilities(user);
    const site = rows.find(row => row.project_id === null);
    if (site && !caps.site) {
      if (!user) return void res.status(401).json({ message: "Unauthorized" });
      return void sendAccessLocked(res, dto(site));
    }
    const blocked = new Map<number, AccessLock>();
    if (!caps.project) {
      for (const row of rows) if (row.project_id !== null) blocked.set(row.project_id, dto(row));
    }
    const projectIds: number[] = [];
    const pathId = path.match(/\/projects\/([^/]+)(?:\/|$)/);
    if (pathId && (!/^\d+$/.test(pathId[1]) || !Number.isSafeInteger(Number(pathId[1])) || Number(pathId[1]) < 1))
      return void res.status(400).json({ message: "Invalid project ID." });
    const values = [pathId?.[1], req.query.projectId, req.query.project_id,
      req.body?.projectId, req.body?.project_id, ...(Array.isArray(req.body?.projectIds) ? req.body.projectIds : [])];
    for (const value of values) if (value !== undefined && /^\d+$/.test(String(value))) projectIds.push(Number(value));
    // Legacy/global operations whose identity is stored outside their URL.
    const indirect = path.match(/^\/api\/(import-configs|file-import-configs|database-configs|customer-api-deliveries|customer-api-logs)\/([a-f0-9-]+)(?:\/|$)/);
    const tables: Record<string, string> = {
      "import-configs": "import_configs", "file-import-configs": "file_import_configs",
      "database-configs": "database_configs", "customer-api-deliveries": "customer_api_deliveries",
      "customer-api-logs": "customer_api_logs",
    };
    if (blocked.size && indirect) {
      const result = await pool.query(`SELECT to_jsonb(t)->>'project_id' AS project_id FROM public.${tables[indirect[1]]} t WHERE id::text=$1`, [indirect[2]]);
      if (result.rows[0]?.project_id) projectIds.push(Number(result.rows[0].project_id));
    }
    const admin = !!user && (user.role === "admin" || await storage.isAdminUser(user));
    for (const id of projectIds) if (blocked.has(id)) {
      if (!user) return void res.status(401).json({ message: "Unauthorized" });
      if (!admin && !await storage.isUserAssignedToProject(user.id, id)) return void res.status(403).json({ message: "Project access required." });
      return void sendAccessLocked(res, blocked.get(id)!);
    }
    // Cross-project backup/restore and ambiguous legacy writes cannot safely
    // operate on a partial scope. Explicit project endpoints remain available.
    const crossProject = /^\/api\/(?:system\/(?:backup|restore)|audit(?:\/|$)|maintenance(?:\/|$)|project-deletion-cleanups|mobile\/workorders\/)/.test(path) ||
      (!projectIds.length && /^\/api\/(?:events|customer-api-(?:deliveries|logs)|(?:file-)?import-history)(?:\/|$)/.test(path));
    let affected = false;
    if (blocked.size && crossProject && user) {
      if (admin) affected = true;
      else for (const id of blocked.keys()) if (await storage.isUserAssignedToProject(user.id, id)) { affected = true; break; }
    }
    if (affected) return void sendAccessLocked(res, {
      ...empty(null), scope: "project", locked: true,
      message: "Project access is locked. This cross-project operation is unavailable; use an unlocked project's scoped tools.",
    });
    return accessLockContext.run(blocked, () => next());
  } catch {
    res.status(503).set("Cache-Control", "no-store").json({
      code: "ACCESS_LOCK_CHECK_FAILED", message: "Access could not be verified. Please retry.",
    });
  }
};

export function registerAccessLockRoutes(app: Express) {
  app.get("/api/access-locks/status", isAuthenticated, async (req: any, res) => {
    res.set("Cache-Control", "no-store");
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || user.isLocked) return res.status(401).json({ message: "Unauthorized" });
      let projectId: number | null = null;
      if (req.query.projectId !== undefined) {
        if (!/^[1-9]\d*$/.test(String(req.query.projectId))) return res.status(400).json({ message: "Invalid project ID" });
        projectId = Number(req.query.projectId);
        if (!Number.isSafeInteger(projectId)) return res.status(400).json({ message: "Invalid project ID" });
        if (!(await storage.isAdminUser(user)) && user.role !== "admin" &&
          !await storage.isUserAssignedToProject(user.id, projectId)) return res.status(403).json({ message: "Project access required" });
        if (!await storage.getProject(projectId)) return res.status(404).json({ message: "Project not found" });
      }
      const caps = await accessLockCapabilities(user);
      const site = await readAccessLock(null), project = projectId === null ? null : await readAccessLock(projectId);
      const denied = site.locked && !caps.site ? site : project?.locked && !caps.project ? project : null;
      res.json({ site, project, canManageSite: caps.site, canManageProject: caps.project,
        blocked: denied ? { scope: denied.scope, projectId: denied.projectId, message: denied.message } : null });
    } catch { res.status(503).json({ message: "Access lock status could not be checked." }); }
  });
  for (const scope of ["site", "project"] as const) {
    const path = scope === "site" ? "/api/access-locks/site" : "/api/projects/:projectId/access-lock";
    const authorize: RequestHandler = async (req: any, res, next) => {
      try {
        const user = await storage.getUser(req.user.claims.sub);
        if (!user || user.isLocked) return void res.status(401).json({ message: "Unauthorized" });
        const caps = await accessLockCapabilities(user);
        if (!caps[scope]) return void res.status(403).json({ message: "Access-lock management permission required." });
        const id = scope === "site" ? null : Number(req.params.projectId);
        if (id !== null) {
          if (!Number.isSafeInteger(id) || id < 1) return void res.status(400).json({ message: "Invalid project ID" });
          if (!await storage.isAdminUser(user) && user.role !== "admin" &&
            !await storage.isUserAssignedToProject(user.id, id)) return void res.status(403).json({ message: "Project access required." });
          if (!await storage.getProject(id)) return void res.status(404).json({ message: "Project not found." });
        }
        Object.assign(req, { lockScopeId: id, lockActor: user });
        next();
      } catch { res.status(503).json({ message: "Unable to verify lock-management authority." }); }
    };
    app.get(path, isAuthenticated, authorize, async (req: any, res) => {
      try { res.set("Cache-Control", "no-store").json({ ...await readAccessLock(req.lockScopeId), canManage: true }); }
      catch { res.status(503).json({ message: "Access lock could not be loaded." }); }
    });
    app.put(path, isAuthenticated, authorize, async (req: any, res) => {
      const parsed = accessLockUpdate.safeParse(req.body);
      if (!parsed.success) return void res.status(400).json({ message: "Check the access-lock settings.", errors: parsed.error.flatten() });
      const client = await pool.connect().catch(() => null);
      if (!client) return void res.status(503).json({ message: "Access lock was not changed. Please retry." });
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`access-lock:${key(req.lockScopeId)}`]);
        const existing = await client.query("SELECT * FROM public.access_locks WHERE id=$1 FOR UPDATE", [key(req.lockScopeId)]);
        const before = existing.rows[0] ? dto(existing.rows[0]) : empty(req.lockScopeId);
        if (before.updatedAt !== parsed.data.expectedUpdatedAt) {
          await client.query("ROLLBACK");
          return void res.status(409).json({ message: "This access lock changed. Reload and review it before saving." });
        }
        const saved = await client.query(`INSERT INTO public.access_locks(id,project_id,locked,message,updated_by)
          VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET locked=EXCLUDED.locked,
          message=EXCLUDED.message,updated_by=EXCLUDED.updated_by,
          updated_at=GREATEST(clock_timestamp(),access_locks.updated_at+interval '1 millisecond') RETURNING *`,
        [key(req.lockScopeId), req.lockScopeId, parsed.data.locked, parsed.data.message, req.lockActor.id]);
        await insertAuditEvent(client, {
          action: parsed.data.locked ? "access.lock" : "access.unlock", entityType: "access_lock",
          entityId: key(req.lockScopeId), projectId: req.lockScopeId,
          changes: [{ field: "locked", before: before.locked, after: parsed.data.locked }],
          metadata: { scope, messageChanged: before.message !== parsed.data.message },
        });
        await client.query("COMMIT");
        res.set("Cache-Control", "no-store").json({ ...dto(saved.rows[0]), canManage: true });
      } catch {
        await client.query("ROLLBACK");
        res.status(500).json({ message: "Access lock was not changed. Please retry." });
      } finally { client.release(); }
    });
  }
}
