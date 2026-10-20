import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { pool } from "../db";
import { auditedOperation, insertAuditEvent } from "../auditService";
import { auditContext } from "../auditContext";
import { withBackupExclusive } from "../backups/lock";
import { accountDto, createSftpAccount, serverInput, sftpEvent, sftpSettings, standaloneSftpSupported } from "./embedded-service";
import { disconnectSftpAccount, restartEmbeddedSftp, sftpRuntime } from "./embedded-server";
import { TransferError } from "./sftp";
import { projectZone } from "./exports";
import { sftpEventScope } from "./sftp-event-scope";
type Access = (req: any, projectId: number) => Promise<any>;
export function registerEmbeddedSftpRoutes(app: Express, authenticated: RequestHandler, access: Access) {
  const base = "/api/projects/:projectId/file-transfers/sftp-server";
  function route(method: "get" | "post" | "put" | "delete", suffix: string, mutate: boolean,
    fn: (req: any, res: any, ctx: any) => Promise<any>) {
    app[method](base + suffix, authenticated, async (req: any, res: any) => {
      res.set("Cache-Control", "no-store");
      try {
        const id = z.coerce.number().int().positive().parse(req.params.projectId), ctx = await access(req, id);
        if (!ctx.permissions.canManageConnection) throw new TransferError("SFTP Connections permission required.", 403);
        if (mutate && !req.path.endsWith("/events") && !standaloneSftpSupported()) throw new TransferError("Built-in SFTP is available only on standalone Windows/Linux. Use HTTPS Exchange on this instance.", 400);
        if (mutate) {
          if (req.path.endsWith("/server") || req.path.endsWith("/restart")) {
            if (ctx.user.role !== "admin") throw new TransferError("Only a site administrator can change the shared SFTP listener.", 403);
          }
          await auditedOperation("sftpServer" + method, String(ctx.project.id),
            () => withBackupExclusive(() => fn(req, res, ctx)), ctx.project.id, ctx.project.name);
        } else await fn(req, res, ctx);
      } catch (error) {
        if (res.headersSent) return;
        if (error instanceof z.ZodError) return void res.status(400).json({ message: error.issues.map(i => i.message).join("; ") });
        res.status(error instanceof TransferError ? error.status : 500).json({
          message: error instanceof TransferError ? error.message : "SFTP server operation failed. Review server settings and service-account permissions.",
        });
      }
    });
  }
  route("get", "", false, async (_req, res, ctx) => {
    const accounts = (await pool.query("SELECT * FROM public.sftp_server_accounts WHERE project_id=$1 ORDER BY created_at DESC", [ctx.project.id])).rows.map(accountDto);
    const review = ctx.user.role === "admin" ? JSON.parse((await pool.query("SELECT value FROM public.system_settings WHERE key='sftp_restore_review'")).rows[0]?.value || "null") : null;
    if (review?.requiresReview) review.accounts = (await pool.query(`SELECT a.username,p.id AS "projectId",p.name AS "projectName",
      p.is_active AS "projectActive",a.can_upload AS "canUpload",a.can_download AS "canDownload",
      a.expires_at AS "expiresAt",a.revoked_at AS "revokedAt",
      coalesce(nullif(p.timezone,''),(SELECT value FROM public.system_settings WHERE key='default_timezone'),'UTC') AS timezone
      FROM public.sftp_server_accounts a JOIN public.projects p ON p.id=a.project_id ORDER BY p.name,a.username`)).rows;
    res.json({ supported: standaloneSftpSupported(), isAdmin: ctx.user.role === "admin",
      server: { ...await sftpSettings(), ...sftpRuntime() }, accounts, timezone: await projectZone(ctx.project.id),
      restoreReview: review });
  });
  route("put", "/server", true, async (req, res, ctx) => {
    const settings = serverInput.parse(req.body);
    const review = JSON.parse((await pool.query("SELECT value FROM public.system_settings WHERE key='sftp_restore_review'")).rows[0]?.value || "null");
    if (settings.enabled && review?.requiresReview && req.body.confirmRestoreReview !== true)
      throw new TransferError("Review the restored SFTP setup and confirm before enabling customer access.", 409);
    await pool.query(`INSERT INTO public.sftp_server_settings(id,enabled,host,port,public_host) VALUES(1,$1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET enabled=$1,host=$2,port=$3,public_host=$4,updated_at=now()`,
    [settings.enabled, settings.host, settings.port, settings.publicHost]);
    if (settings.enabled && review?.requiresReview) {
      await pool.query("DELETE FROM public.system_settings WHERE key='sftp_restore_review'");
      await sftpEvent(ctx.project.id, "server", "restore_review_confirmed", "success", "Administrator reviewed restored project accounts, endpoint and local host identity before enabling SFTP.");
    }
    await sftpEvent(ctx.project.id, "server", settings.enabled ? "server_enabled" : "server_disabled", "success",
      settings.enabled ? "Shared listener configuration saved; startup requested." : "Shared listener disabled for all projects.");
    res.json({ ...settings, ...await restartEmbeddedSftp() });
  });
  route("post", "/restart", true, async (_req, res) => res.json(await restartEmbeddedSftp()));
  route("post", "/accounts", true, async (req, res, ctx) => res.status(201).json(await createSftpAccount(ctx.project.id, req.body)));
  route("delete", "/accounts/:id", true, async (req, res, ctx) => {
    const row = (await pool.query(`UPDATE public.sftp_server_accounts SET revoked_at=coalesce(revoked_at,now())
      WHERE id=$1 AND project_id=$2 RETURNING *`, [z.string().uuid().parse(req.params.id), ctx.project.id])).rows[0];
    if (!row) throw new TransferError("SFTP account not found.", 404);
    disconnectSftpAccount(row.id);
    await sftpEvent(ctx.project.id, row.username, "account_revoked", "success", "Account revoked; active sessions disconnected.");
    res.json({ success: true });
  });
  route("get", "/events", false, async (req, res, ctx) => {
    const timezone = await projectZone(ctx.project.id);
    const { args, parameter, where } = sftpEventScope(ctx.project.id, req.query, timezone, ctx.user.role === "admin");
    const total = Number((await pool.query("SELECT count(*) FROM public.sftp_server_events WHERE " + where, args)).rows[0].count);
    const report = req.query.report === "1";
    if (report && total > 25000) throw new TransferError("Narrow filters to at most 25,000 events before exporting.");
    const limit = report ? 25000 : z.coerce.number().int().min(1).max(100).parse(req.query.limit || 25);
    const offset = report ? 0 : z.coerce.number().int().min(0).parse(req.query.offset || 0);
    const rows = (await pool.query(`SELECT id,username,action,status,file_name AS "fileName",bytes,message,created_at AS "createdAt"
      FROM public.sftp_server_events WHERE ${where} ORDER BY created_at DESC,id LIMIT ${parameter(limit)} OFFSET ${parameter(offset)}`, args)).rows;
    res.json({ rows, total, timezone });
  });
  route("get", "/events/delete-preview", false, async (req, res, ctx) => {
    const before = (await pool.query("SELECT clock_timestamp() AS cutoff")).rows[0].cutoff.toISOString(), timezone = await projectZone(ctx.project.id);
    const filters = { search: req.query.search || "", from: req.query.from || "", to: req.query.to || "", includeShared: req.query.includeShared === "true" };
    if (filters.includeShared && ctx.user.role !== "admin") throw new TransferError("Only site administrators can delete shared server logs.", 403);
    const { where, args } = sftpEventScope(ctx.project.id, filters, timezone, filters.includeShared, before);
    const count = Number((await pool.query(`SELECT count(*) FROM public.sftp_server_events WHERE ${where}`, args)).rows[0].count);
    res.json({ before, filters, expectedCount: count, timezone });
  });
  route("delete", "/events", true, async (req, res, ctx) => {
    const input = z.object({ confirmed: z.literal(true), before: z.string().datetime(),
      expectedCount: z.number().int().nonnegative(), filters: z.object({
        search: z.string().max(200), from: z.string(), to: z.string(), includeShared: z.boolean().default(false),
      }) }).parse(req.body);
    if ((await pool.query("SELECT $1::timestamptz > clock_timestamp() AS future", [input.before])).rows[0].future)
      throw new TransferError("Deletion cutoff cannot be in the future.");
    if (input.filters.includeShared && ctx.user.role !== "admin") throw new TransferError("Only site administrators can delete shared server logs.", 403);
    const { where, args, parameter } = sftpEventScope(ctx.project.id, input.filters, await projectZone(ctx.project.id), input.filters.includeShared, input.before);
    const expected = parameter(input.expectedCount);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = (await client.query(`WITH candidates AS MATERIALIZED (
      SELECT id FROM public.sftp_server_events WHERE ${where}
    ), deleted AS (
      DELETE FROM public.sftp_server_events WHERE id IN (SELECT id FROM candidates)
        AND (SELECT count(*) FROM candidates)=${expected} RETURNING id
    ) SELECT (SELECT count(*) FROM candidates)::integer AS matched,count(*)::integer AS deleted FROM deleted`, args)).rows[0];
      if (result.matched !== input.expectedCount) throw new TransferError("Matching logs changed. Preview the deletion again.", 409);
      const actor = auditContext.getStore();
      if (!actor) throw new TransferError("Audit context is unavailable. Logs were not deleted.", 503);
      await insertAuditEvent(client, { action: "sftp.logs.deleted", entityType: "sftpActivity",
        entityId: String(ctx.project.id), projectId: ctx.project.id, projectLabel: ctx.project.name, outcome: "success",
        metadata: { deleted: result.deleted, cutoff: input.before, includedShared: input.filters.includeShared } }, actor);
      await client.query(`INSERT INTO public.sftp_server_events(id,project_id,username,action,status,message)
        VALUES($1,$2,$3,'logs_deleted','success',$4)`, [randomUUID(), ctx.project.id, ctx.user.username || "authorized user",
        `${result.deleted} SFTP activity entries deleted; shared server logs ${input.filters.includeShared ? "included by site administrator" : "preserved"}. Other projects and the security audit trail were preserved.`]);
      await client.query("COMMIT");
      res.json({ deleted: result.deleted });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
}
