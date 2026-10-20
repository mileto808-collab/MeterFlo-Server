import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";
import { auditedOperation } from "../auditService";
import { withBackupExclusive } from "../backups/lock";
import { accountDto, createSftpAccount, serverInput, sftpEvent, sftpSettings, standaloneSftpSupported } from "./embedded-service";
import { disconnectSftpAccount, restartEmbeddedSftp, sftpRuntime } from "./embedded-server";
import { TransferError } from "./sftp";
import { projectZone } from "./exports";
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
        if (mutate && !standaloneSftpSupported()) throw new TransferError("Built-in SFTP is available only on standalone Windows/Linux. Use HTTPS Exchange on this instance.", 400);
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
    res.json({ supported: standaloneSftpSupported(), isAdmin: ctx.user.role === "admin",
      server: { ...await sftpSettings(), ...sftpRuntime() }, accounts, timezone: await projectZone(ctx.project.id) });
  });
  route("put", "/server", true, async (req, res, ctx) => {
    const settings = serverInput.parse(req.body);
    await pool.query(`INSERT INTO public.sftp_server_settings(id,enabled,host,port,public_host) VALUES(1,$1,$2,$3,$4)
      ON CONFLICT(id) DO UPDATE SET enabled=$1,host=$2,port=$3,public_host=$4,updated_at=now()`,
    [settings.enabled, settings.host, settings.port, settings.publicHost]);
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
    const args: any[] = [ctx.project.id], terms = ["project_id=$1"];
    // Only site admins see listener events and unknown-user authentication attempts.
    if (ctx.user.role === "admin") terms[0] = "(project_id=$1 OR project_id IS NULL)";
    const parameter = (value: any) => { args.push(value); return `$${args.length}`; };
    if (req.query.search) terms.push(`concat_ws(' ',username,action,status,file_name,message) ILIKE ${parameter("%" + z.string().max(200).parse(req.query.search) + "%")}`);
    const timezone = await projectZone(ctx.project.id);
    for (const [key, op] of [["from", ">="], ["to", "<"]] as const) if (req.query[key]) {
      const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(req.query[key]), parsed = new Date(date);
      if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new TransferError("Invalid filter date.");
      terms.push(`created_at ${op} ((${parameter(date)}::date${key === "to" ? "+1" : ""})::timestamp AT TIME ZONE ${parameter(timezone)})`);
    }
    if (req.query.from && req.query.to && req.query.from > req.query.to) throw new TransferError("From date must not follow To date.");
    const where = terms.join(" AND "), total = Number((await pool.query("SELECT count(*) FROM public.sftp_server_events WHERE " + where, args)).rows[0].count);
    const report = req.query.report === "1";
    if (report && total > 25000) throw new TransferError("Narrow filters to at most 25,000 events before exporting.");
    const limit = report ? 25000 : z.coerce.number().int().min(1).max(100).parse(req.query.limit || 25);
    const offset = report ? 0 : z.coerce.number().int().min(0).parse(req.query.offset || 0);
    const rows = (await pool.query(`SELECT id,username,action,status,file_name AS "fileName",bytes,message,created_at AS "createdAt"
      FROM public.sftp_server_events WHERE ${where} ORDER BY created_at DESC,id LIMIT ${parameter(limit)} OFFSET ${parameter(offset)}`, args)).rows;
    res.json({ rows, total, timezone });
  });
}
