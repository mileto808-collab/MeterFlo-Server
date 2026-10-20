import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";
import { storage } from "../storage";
import { auditedOperation } from "../auditService";
import { withBackupExclusive } from "../backups/lock";
import { insertFileImportConfigSchema, updateFileImportConfigSchema } from "../../shared/schema";
import { exportRunInput } from "../../shared/file-transfers";
import { exportFields, getExports, saveExport, enqueueExport, projectZone, frequencyCron, runBytes } from "./exports";
import { getConnection, publicConnection, saveConnection, withSftp, remoteDirectory, TransferError } from "./sftp";
import { validateImportPattern } from "./imports";
import { registerHttpsTransferRoutes } from "./https-routes";
import { registerEmbeddedSftpRoutes } from "./embedded-routes";
import { requireExchange } from "./https-service";
import { workOrderColumnGuide } from "./column-guide";
const uuid = (value: unknown) => z.string().uuid().parse(value);
const projectId = (value: unknown) => z.coerce.number().int().positive().parse(value);
function fail(res: any, error: unknown) {
  if (error instanceof TransferError) return res.status(error.status).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map(item => item.message).join("; ") });
  return res.status(500).json({ message: "File transfer operation failed. Review permissions and configuration." });
}
export async function transferAccess(req: any, id: number) {
  const user = await storage.getUser(req.user?.claims?.sub);
  if (!user) throw new TransferError("Unauthorized", 401);
  if (user.role === "customer" || (user.role !== "admin" && !await storage.isUserAssignedToProject(user.id, id)))
    throw new TransferError("Project access denied.", 403);
  const project = await storage.getProject(id);
  if (!project) throw new TransferError("Project not found.", 404);
  const permissions = {
    canImport: await storage.hasPermission(user, "project.import"),
    canExport: await storage.hasPermission(user, "project.fileExports"),
    canManageConnection: await storage.hasPermission(user, "project.sftpConnections"),
    canManageHttps: await storage.hasPermission(user, "project.httpsTransfers"),
  };
  return { user, project, permissions };
}
async function history(project: number, canImport: boolean, canExport: boolean, query: any, csv = false) {
  const timezone = await projectZone(project), args: any[] = [project, canImport, canExport], where: string[] = [];
  const parameter = (value: unknown) => { args.push(value); return `$${args.length}`; };
  const direction = z.enum(["all", "import", "export"]).parse(query.direction || "all");
  if (direction !== "all") where.push(`direction=${parameter(direction)}`);
  if (query.status) where.push(`status=${parameter(z.string().regex(/^[a-z_]{1,30}$/).parse(query.status))}`);
  if (query.search) {
    const term = parameter("%" + z.string().max(200).parse(query.search) + "%");
    where.push(`concat_ws(' ',config_name,file_name,message) ILIKE ${term}`);
  }
  for (const [key, op] of [["from", ">="], ["to", "<"]] as const) if (query[key]) {
    const value = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query[key]), parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new TransferError("Invalid history date.");
    where.push(`created_at ${op} ((${parameter(value)}::date${key === "to" ? "+1" : ""})::timestamp AT TIME ZONE ${parameter(timezone)})`);
  }
  if (query.from && query.to && query.from > query.to) throw new TransferError("From date must not follow To date.");
  const cte = `WITH history AS (
    SELECT 'import:'||h.id AS id,'import'::text AS direction,coalesce(c.name,'Manual import') AS config_name,h.file_name,
      h.status,coalesce(h.records_imported,0) AS record_count,coalesce(h.records_failed,0) AS records_failed,h.error_details AS message,
      h.started_at AT TIME ZONE 'UTC' AS created_at,h.completed_at AT TIME ZONE 'UTC' AS completed_at,
      CASE WHEN h.import_source LIKE '%sftp%' THEN 'sftp' WHEN h.import_source='https' THEN 'https' ELSE 'local' END AS destination,
      null::uuid AS export_run_id,1 AS attempts,'[]'::jsonb AS attempt_log
    FROM public.file_import_history h LEFT JOIN public.file_import_configs c ON c.id=h.file_import_config_id WHERE h.project_id=$1 AND $2
    UNION ALL SELECT e.id::text,'export',e.config_name,e.file_name,e.status,e.record_count,0,e.message,e.created_at,e.completed_at,
      e.snapshot->>'destination',e.id,e.attempts,
      coalesce((SELECT jsonb_agg(jsonb_build_object('status',a.status,'message',a.message,'startedAt',a.started_at,'completedAt',a.completed_at) ORDER BY a.started_at)
        FROM public.file_export_attempts a WHERE a.run_id=e.id),'[]'::jsonb)
    FROM public.file_export_runs e WHERE e.project_id=$1 AND $3
  )`;
  const filtered = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = Number((await pool.query(cte + " SELECT count(*) FROM history" + filtered, args)).rows[0].count);
  if (csv && total > 25000) throw new TransferError("More than 25,000 history entries match. Narrow the filters before exporting.");
  const limit = csv ? 25000 : z.coerce.number().int().min(1).max(100).parse(query.limit || 25);
  const offset = csv ? 0 : z.coerce.number().int().min(0).parse(query.offset || 0);
  const { rows } = await pool.query(cte + " SELECT * FROM history" + filtered + ` ORDER BY created_at DESC,id LIMIT ${parameter(limit)} OFFSET ${parameter(offset)}`, args);
  return { rows: rows.map(row => ({ id: row.id, direction: row.direction, configName: row.config_name, fileName: row.file_name,
    status: row.status, recordCount: row.record_count, recordsFailed: row.records_failed, message: row.message, createdAt: row.created_at,
    completedAt: row.completed_at, destination: row.destination, exportRunId: row.export_run_id, attempts: row.attempts, attemptLog: row.attempt_log })), total, timezone };
}
export function registerFileTransferRoutes(app: Express, authenticated: RequestHandler) {
  registerHttpsTransferRoutes(app, authenticated, transferAccess);
  registerEmbeddedSftpRoutes(app, authenticated, transferAccess);
  const base = "/api/projects/:projectId/file-transfers";
  const route = (method: "get" | "post" | "put" | "patch" | "delete", suffix: string, permission: "canImport" | "canExport" | "canManageConnection" | null,
    handler: (req: any, res: any, context: Awaited<ReturnType<typeof transferAccess>>) => Promise<any>) => {
    app[method](base + suffix, authenticated, async (req: any, res: any) => {
      try {
        const context = await transferAccess(req, projectId(req.params.projectId));
        if (permission ? !context.permissions[permission] : !Object.values(context.permissions).some(Boolean)) throw new TransferError("File transfer permission required.", 403);
        await handler(req, res, context);
      } catch (error) { fail(res, error); }
    });
  };
  // Existing import routes retain their URL, but may not bypass import permission
  // or accept unvalidated project/secret fields through their previous broad body.
  const importGuard: RequestHandler = async (req: any, res, next) => {
    try {
      const config = req.params.id ? await storage.getFileImportConfig(projectId(req.params.id)) : undefined;
      if (req.params.id && !config) throw new TransferError("Import configuration not found.", 404);
      const id = config?.projectId || projectId(req.params.projectId), context = await transferAccess(req, id);
      if (!context.permissions.canImport) throw new TransferError("File import permission required.", 403);
      if (req.method === "POST" && !req.params.id || req.method === "PATCH") {
        req.body = req.method === "PATCH" ? updateFileImportConfigSchema.parse(req.body) : insertFileImportConfigSchema.omit({ projectId: true }).parse(req.body);
        const merged = { ...config, ...req.body };
        frequencyCron(merged.scheduleFrequency || "manual", merged.customCronExpression);
        validateImportPattern(merged.processedFilePattern, ["sftp", "https"].includes(merged.source));
        if (merged.source === "https") await requireExchange(id);
        if (merged.source === "sftp") { remoteDirectory(merged.remoteDirectory); if (!await getConnection(id)) throw new TransferError("Save the project's SFTP connection first."); }
      }
      next();
    } catch (error) { fail(res, error); }
  };
  app.use("/api/projects/:projectId/file-import-configs", authenticated, importGuard);
  app.use("/api/file-import-configs/:id", authenticated, importGuard);

  route("get", "", null, async (_req, res, { project, permissions }) => {
    const statuses = (await pool.query("SELECT id,code,label FROM public.work_order_statuses ORDER BY sort_order,id")).rows;
    const subStatuses = (await pool.query(`SELECT id,label,parent_status_id AS "parentStatusId" FROM public.work_order_sub_statuses
      WHERE active AND (project_id IS NULL OR project_id=$1) ORDER BY sort_order,label`, [project.id])).rows;
    res.json({ connection: publicConnection(await getConnection(project.id)), exports: permissions.canExport ? await getExports(project.id) : [],
      statuses, subStatuses, fields: permissions.canExport ? await exportFields(project.id) : [], columnGuide: await workOrderColumnGuide(project.id),
      timezone: await projectZone(project.id), permissions });
  });
  route("put", "/connection", "canManageConnection", async (req, res, { project }) => {
    res.json(await auditedOperation("projectSftpUpdate", String(project.id), () => withBackupExclusive(() => saveConnection(project.id, req.body)), project.id, project.name));
  });
  route("post", "/connection/test", "canManageConnection", async (_req, res, { project }) => {
    await withSftp(project.id, async client => { await client.cwd(); });
    res.json({ success: true, message: "SFTP authentication and SSH server host-key verification succeeded." });
  });
  route("delete", "/connection", "canManageConnection", async (_req, res, { project }) => {
    await auditedOperation("projectSftpDelete", String(project.id), () => withBackupExclusive(async () => {
      if ((await pool.query(`SELECT 1 FROM public.file_exports WHERE project_id=$1 AND destination='sftp' AND is_enabled AND deleted_at IS NULL
        UNION ALL SELECT 1 FROM public.file_import_configs WHERE project_id=$1 AND source='sftp' AND is_enabled
        UNION ALL SELECT 1 FROM public.file_export_runs WHERE project_id=$1 AND snapshot->>'destination'='sftp'
        AND status IN ('queued','running','failed','interrupted') LIMIT 1`, [project.id])).rowCount)
        throw new TransferError("Disable SFTP schedules and cancel unresolved SFTP runs before removing the connection.", 409);
      await pool.query("DELETE FROM public.project_sftp_connections WHERE project_id=$1", [project.id]);
    }), project.id, project.name);
    res.sendStatus(204);
  });
  route("post", "/exports", "canExport", async (req, res, { project }) => res.status(201).json(
    await auditedOperation("fileExportConfigCreate", project.id.toString(), () => saveExport(project.id, req.body), project.id, project.name)));
  route("patch", "/exports/:id", "canExport", async (req, res, { project }) => res.json(
    await auditedOperation("fileExportConfigUpdate", uuid(req.params.id), () => saveExport(project.id, req.body, req.params.id), project.id, project.name)));
  route("delete", "/exports/:id", "canExport", async (req, res, { project }) => {
    const id = uuid(req.params.id);
    await auditedOperation("fileExportConfigDelete", id, async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        if (!(await client.query("SELECT id FROM public.file_exports WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, project.id])).rowCount) throw new TransferError("Export configuration not found.", 404);
        if ((await client.query("SELECT id FROM public.file_export_runs WHERE config_id=$1 AND status='running'", [id])).rowCount) throw new TransferError("Wait for the running export to finish before deleting its configuration.", 409);
        await client.query("UPDATE public.file_export_runs SET status='cancelled',message='Export configuration deleted.' WHERE config_id=$1 AND status IN ('queued','failed','interrupted')", [id]);
        await client.query("UPDATE public.file_exports SET deleted_at=now(),is_enabled=false,next_run_at=null WHERE id=$1", [id]); await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    }, project.id, project.name);
    res.sendStatus(204);
  });
  route("post", "/exports/:id/run", "canExport", async (req, res, { project }) => res.status(202).json(
    await auditedOperation("fileExportQueue", uuid(req.params.id), () => enqueueExport(project.id, req.params.id, exportRunInput.parse(req.body || {})), project.id, project.name)));
  for (const action of ["retry", "cancel"] as const) route("post", `/runs/:id/${action}`, "canExport", async (req, res, { project }) => {
    const id = uuid(req.params.id);
    const run = await auditedOperation("fileExport" + action, id, () => pool.query(`UPDATE public.file_export_runs
      SET status=$3,message=$4,snapshot=CASE WHEN $3='queued' THEN jsonb_set(snapshot,'{manualRetry}','true'::jsonb) ELSE snapshot END
      WHERE id=$1 AND project_id=$2 AND status=ANY($5::text[]) RETURNING id,status`,
    [id, project.id, action === "retry" ? "queued" : "cancelled", action === "retry" ? null : "Cancelled by user.",
      action === "retry" ? ["failed", "interrupted"] : ["queued", "failed", "interrupted"]]), project.id, project.name);
    if (!run.rowCount) throw new TransferError("This run is no longer available for that action.", 409);
    res.status(action === "retry" ? 202 : 200).json(run.rows[0]);
  });
  route("get", "/runs/:id/download", "canExport", async (req, res, { project }) => {
    const run = (await pool.query("SELECT * FROM public.file_export_runs WHERE id=$1 AND project_id=$2", [uuid(req.params.id), project.id])).rows[0];
    if (!run || run.status !== "success") throw new TransferError("A successful generated export is required.", 404);
    res.setHeader("Cache-Control", "private, no-store"); res.attachment(run.file_name).send(await runBytes(run));
  });
  route("get", "/history", null, async (req, res, { project, permissions }) => res.json(await history(project.id, permissions.canImport, permissions.canExport, req.query)));
  route("get", "/history/export", null, async (req, res, { project, permissions }) => {
    const result = await history(project.id, permissions.canImport, permissions.canExport, req.query, true);
    const rows = result.rows.map(row => ({ ...row, createdAt: new Date(row.createdAt).toLocaleString("en-US", { timeZone: result.timezone }),
      completedAt: row.completedAt ? new Date(row.completedAt).toLocaleString("en-US", { timeZone: result.timezone }) : "" }));
    const { encodeExport } = await import("./exports");
    res.type("text/csv").attachment("file-transfer-history.csv").send(encodeExport(rows,
      ["direction", "configName", "fileName", "status", "recordCount", "recordsFailed", "destination", "createdAt", "completedAt", "attempts", "message"], "csv"));
  });
}
