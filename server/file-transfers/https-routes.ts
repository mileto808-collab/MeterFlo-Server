import express, { type Express, type RequestHandler } from "express";
import { z } from "zod";
import { pool } from "../db";
import { auditedOperation } from "../auditService";
import { serviceAuditContext, withAuditContext } from "../auditContext";
import { withBackupExclusive } from "../backups/lock";
import { projectZone } from "./exports";
import { exchangeStore } from "./https-storage";
import { exchangeRecords, exchangeReport } from "./https-queries";
import { TransferError } from "./sftp";
import { authenticateExchange, credentialPublic, exchangeEvent, exchangeSettings, filePublic, issueCredential,
  readExchangeFile, receiveUpload, saveExchangeSettings } from "./https-service";
type Access = (req: any, id: number) => Promise<any>;
const id = (value: unknown) => z.string().uuid().parse(value);
const pid = (value: unknown) => z.coerce.number().int().positive().parse(value);
const unavailable = ["expired", "deleted"];
function fail(res: any, error: any) {
  if (res.headersSent) return res.destroy();
  if (error instanceof TransferError) return res.status(error.status).json({ message: error.message });
  if (error instanceof z.ZodError) return res.status(400).json({ message: error.issues.map(i => i.message).join("; ") });
  if (error?.type === "entity.too.large") return res.status(413).json({ message: "Uploads are limited to 25 MB." });
  return res.status(503).json({ message: "HTTPS file exchange is unavailable. Review storage and transfer configuration." });
}
async function fileRow(projectId: number, fileId: unknown) {
  const row = (await pool.query("SELECT * FROM public.https_transfer_files WHERE id=$1 AND project_id=$2", [id(fileId), projectId])).rows[0];
  if (!row) throw new TransferError("Transfer file not found.", 404);
  return row;
}
function sendFile(res: any, row: any, bytes: Buffer) {
  res.set({ "Content-Type": "application/octet-stream", "Content-Length": String(bytes.length), "X-Content-SHA256": row.sha256,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(row.file_name)}`, "X-Content-Type-Options": "nosniff" });
  res.send(bytes);
}
export function registerHttpsTransferRoutes(app: Express, authenticated: RequestHandler, access: Access) {
  const base = "/api/projects/:projectId/file-transfers/https";
  function admin(method: "get" | "post" | "put" | "delete", suffix: string, manage: boolean,
    handler: (req: any, res: any, ctx: any) => Promise<any>) {
    app[method](base + suffix, authenticated, async (req: any, res: any) => {
      res.set("Cache-Control", "no-store");
      try {
        const ctx = await access(req, pid(req.params.projectId)), p = ctx.permissions;
        if (!(manage ? p.canManageHttps : p.canImport || p.canExport || p.canManageHttps)) throw new TransferError("HTTPS exchange permission required.", 403);
        await handler(req, res, ctx);
      } catch (error) { fail(res, error); }
    });
  }
  const mutate = (ctx: any, action: string, fn: () => Promise<any>) => auditedOperation(action, String(ctx.project.id),
    () => withBackupExclusive(fn), ctx.project.id, ctx.project.name);
  const allowed = (ctx: any) => [ctx.permissions.canImport || ctx.permissions.canManageHttps ? "inbox" : "",
    ctx.permissions.canExport || ctx.permissions.canManageHttps ? "outbox" : ""].filter(Boolean);
  admin("get", "", false, async (_req, res, ctx) => {
    const settings = await exchangeSettings(ctx.project.id);
    let storageStatus = { available: false, message: "Exchange disabled. Save and enable to verify private storage write, read and cleanup access." };
    if (settings.enabled) {
      try { await exchangeStore.probe(settings, ctx.project.id); storageStatus = { available: true, message: "Private storage reachable; file integrity is verified on download." }; }
      catch (error) { storageStatus = { available: false, message: error instanceof TransferError ? error.message : "Private storage is unavailable. Review storage settings and service permissions." }; }
    }
    const credentials = ctx.permissions.canManageHttps ? (await pool.query("SELECT * FROM public.https_transfer_credentials WHERE project_id=$1 ORDER BY created_at DESC", [ctx.project.id])).rows.map(credentialPublic) : [];
    res.json({ settings: { ...settings, location: ctx.permissions.canManageHttps ? settings.location : "" },
      storage: storageStatus,
      credentials, timezone: await projectZone(ctx.project.id), apiPath: `/api/file-exchange/v1/projects/${ctx.project.id}`,
      maxUploadMB: 25, canManage: ctx.permissions.canManageHttps, canImport: allowed(ctx).includes("inbox"), canExport: allowed(ctx).includes("outbox") });
  });
  admin("put", "/settings", true, async (req, res, ctx) => res.json(await mutate(ctx, "httpsSettings", () => saveExchangeSettings(ctx.project.id, req.body))));
  admin("post", "/credentials", true, async (req, res, ctx) => res.status(201).json(await mutate(ctx, "httpsCredentialCreate", () => issueCredential(ctx.project.id, req.body))));
  admin("post", "/credentials/:id/rotate", true, async (req, res, ctx) => {
    const row = (await pool.query("SELECT * FROM public.https_transfer_credentials WHERE id=$1 AND project_id=$2", [id(req.params.id), ctx.project.id])).rows[0];
    if (!row) throw new TransferError("Credential not found.", 404);
    const days = z.number().int().min(1).max(365).parse(req.body?.expiresInDays ?? 90);
    res.json(await mutate(ctx, "httpsCredentialRotate", () => issueCredential(ctx.project.id,
      { name: row.name, canUpload: row.can_upload, canDownload: row.can_download, expiresInDays: days }, row.id)));
  });
  admin("post", "/credentials/:id/revoke", true, async (req, res, ctx) => {
    await mutate(ctx, "httpsCredentialRevoke", async () => {
      if (!(await pool.query("UPDATE public.https_transfer_credentials SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND project_id=$2 RETURNING id", [id(req.params.id), ctx.project.id])).rowCount)
        throw new TransferError("Credential not found.", 404);
      await exchangeEvent(ctx.project.id, "credential_revoked", "Transfer credential revoked.", undefined, req.params.id);
    }); res.json({ success: true });
  });
  for (const events of [false, true]) {
    const part = events ? "/events" : "/files";
    admin("get", part, false, async (req, res, ctx) => res.json(await exchangeRecords(ctx.project.id, req.query, { events, directions: allowed(ctx) })));
    for (const format of ["csv", "xlsx", "print"]) admin("get", part + (format === "print" ? "/print" : "/export." + format), false, async (req, res, ctx) => {
      const page = await exchangeRecords(ctx.project.id, req.query, { events, all: true, directions: allowed(ctx) });
      res.type(format === "csv" ? "text/csv" : format === "xlsx" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "html");
      if (format !== "print") res.attachment(`https-exchange-${events ? "history" : "files"}.${format}`);
      res.send(exchangeReport(page, events, format === "csv", format === "xlsx"));
    });
  }
  admin("get", "/files/:id/download", false, async (req, res, ctx) => {
    const row = await fileRow(ctx.project.id, req.params.id);
    if (!allowed(ctx).includes(row.direction)) throw new TransferError("File access denied.", 403);
    sendFile(res, row, await readExchangeFile(row));
  });
  admin("post", "/files/:id/retry", false, async (req, res, ctx) => {
    if (!allowed(ctx).includes("inbox")) throw new TransferError("Import permission required.", 403);
    await mutate(ctx, "httpsImportRetry", async () => {
      const row = await fileRow(ctx.project.id, req.params.id);
      if (row.direction !== "inbox" || !["failed", "partial"].includes(row.status)) throw new TransferError("Only failed or partial incoming files can be retried.", 409);
      await pool.query("UPDATE public.https_transfer_files SET status='received',processing_config_id=null,message='Ready for the next matching manual or scheduled HTTPS import.' WHERE id=$1", [row.id]);
      await exchangeEvent(ctx.project.id, "import_retry", "Incoming file returned to the processing queue.", row.id);
    }); res.json({ success: true });
  });
  admin("delete", "/files/:id", true, async (req, res, ctx) => {
    await mutate(ctx, "httpsFileDelete", async () => {
      const row = await fileRow(ctx.project.id, req.params.id);
      if (row.status === "processing") throw new TransferError("Wait for import processing to finish.", 409);
      if (!unavailable.includes(row.status)) await exchangeStore.remove(row, row.storage_key);
      await pool.query("UPDATE public.https_transfer_files SET status='deleted',message='File content manually removed; history retained.' WHERE id=$1", [row.id]);
      await exchangeEvent(ctx.project.id, "file_deleted", "File content manually removed; history retained.", row.id);
    }); res.json({ success: true });
  });
  registerCustomerExchange(app);
}
const rateWindows = new Map<string, { since: number; count: number }>();
let activeUploads = 0;
function rateLimit(req: any, res: any, next: any) {
  const now = Date.now(), key = req.ip || req.socket.remoteAddress || "unknown";
  if (rateWindows.size > 10000) for (const [ip, value] of rateWindows) if (now - value.since > 60000) rateWindows.delete(ip);
  const current = rateWindows.get(key);
  const entry = current && now - current.since < 60000 ? current : { since: now, count: 0 };
  rateWindows.set(key, entry);
  if (++entry.count > 120) { res.set("Retry-After", "60"); return res.status(429).json({ message: "Transfer request limit reached. Retry shortly." }); }
  next();
}
function registerCustomerExchange(app: Express) {
  const base = "/api/file-exchange/v1/projects/:projectId";
  function external(method: "get" | "put" | "post", suffix: string, scope: "upload" | "download", handler: (req: any, res: any, credential: any) => Promise<any>, upload = false) {
    const authenticate: RequestHandler = async (req: any, res, next) => {
      res.set("Cache-Control", "no-store");
      try {
        if (!req.secure) throw new TransferError("Use HTTPS for customer file exchange. Configure TLS or a trusted HTTPS reverse proxy.", 426);
        res.locals.hxCredential = await withAuditContext(serviceAuditContext("httpsCredentialAuthentication"),
          () => authenticateExchange(pid(req.params.projectId), req.get("authorization"), scope));
        next();
      } catch (error) { fail(res, error); }
    };
    const sizeGate: RequestHandler = (req, res, next) => {
      if (!req.is("application/octet-stream")) return void res.status(415).json({ message: "Use Content-Type: application/octet-stream." });
      if (activeUploads >= 4) { res.set("Retry-After", "5"); return void res.status(429).json({ message: "Upload capacity reached. Retry shortly." }); }
      activeUploads++;
      let released = false;
      const release = () => { if (!released) { released = true; activeUploads--; } };
      res.once("close", release); res.once("finish", release);
      next();
    };
    app[method](base + suffix, rateLimit, authenticate, ...(upload ? [sizeGate, express.raw({ type: "application/octet-stream", limit: "25mb" })] : []),
      async (req: any, res: any) => {
        try {
          const credential = res.locals.hxCredential;
          const context = { ...serviceAuditContext("httpsFileExchange"), actorLabel: `HTTPS transfer ${credential.id}` };
          await withAuditContext(context, () => auditedOperation("httpsCustomerTransfer", credential.id, () => handler(req, res, credential), credential.project_id));
        } catch (error) {
          const credential = res.locals.hxCredential;
          if (credential) {
            await withAuditContext(serviceAuditContext("httpsFileExchangeFailure"), () => exchangeEvent(credential.project_id, "transfer_failed",
              error instanceof TransferError ? error.message : "Customer transfer failed. Review application logs and storage access.", res.locals.hxFileId, credential.id))
              .catch(() => console.warn("[HTTPS Exchange] Could not record transfer failure."));
          }
          fail(res, error);
        }
      },
      (error: any, _req: any, res: any, _next: any) => fail(res, error));
  }
  external("put", "/inbox/:fileName", "upload", async (req, res, credential) => {
    const result = await withBackupExclusive(async () => {
      await authenticateExchange(credential.project_id, req.get("authorization"), "upload");
      return receiveUpload(credential.project_id, credential, req.params.fileName, req.get("Idempotency-Key"), Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0), req.get("X-Content-SHA256"));
    });
    res.status(result.duplicate ? 200 : 201).json(result);
  }, true);
  external("get", "/inbox", "upload", async (req, res, credential) => res.json(await exchangeRecords(credential.project_id, req.query,
    { directions: ["inbox"], credentialId: credential.id })));
  external("get", "/inbox/:id", "upload", async (req, res, credential) => {
    const row = await fileRow(credential.project_id, req.params.id);
    if (row.direction !== "inbox" || row.credential_id !== credential.id) throw new TransferError("Transfer file not found.", 404);
    res.json(filePublic(row));
  });
  external("get", "/outbox", "download", async (req, res, credential) => res.json(await exchangeRecords(credential.project_id, req.query, { directions: ["outbox"] })));
  external("get", "/outbox/:id/download", "download", async (req, res, credential) => {
    const row = await fileRow(credential.project_id, req.params.id);
    if (row.direction !== "outbox") throw new TransferError("Export file not found.", 404);
    res.locals.hxFileId = row.id;
    const bytes = await readExchangeFile(row);
    res.once("finish", () => { if (!res.writableFinished) return;
      void withAuditContext({ ...serviceAuditContext("httpsDownload"), actorLabel: `HTTPS transfer ${credential.id}` },
        () => exchangeEvent(credential.project_id, "file_downloaded", "HTTP download response completed; acknowledgement still required.", row.id, credential.id))
        .catch(() => console.warn("[HTTPS Exchange] Could not record completed download."));
    });
    sendFile(res, row, bytes);
  });
  external("post", "/outbox/:id/ack", "download", async (req, res, credential) => {
    await withBackupExclusive(async () => {
      await authenticateExchange(credential.project_id, req.get("authorization"), "download");
      const row = await fileRow(credential.project_id, req.params.id);
      if (row.direction !== "outbox" || unavailable.includes(row.status)) throw new TransferError("Export is not available for acknowledgement.", 409);
      await pool.query(`UPDATE public.https_transfer_files SET status='acknowledged',acknowledged_at=coalesce(acknowledged_at,now()),
        message='Customer acknowledged receipt.' WHERE id=$1`, [row.id]);
      await exchangeEvent(credential.project_id, "file_acknowledged", "Customer acknowledged export receipt.", row.id, credential.id);
    }); res.json({ success: true });
  });
}
