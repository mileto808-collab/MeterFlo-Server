import type { Express, RequestHandler } from "express";
import { z } from "zod";
import { pipeline } from "node:stream/promises";
import { pool } from "../db";
import { storage } from "../storage";
import { auditedOperation } from "../auditService";
import { backupTypeLabels } from "../../shared/backup-schedules";
import { backupFiles, BackupError } from "./files";
import * as backups from "./service";

const base = "/api/maintenance/backups";
const uuid = z.string().uuid();
const text = (value: unknown) => typeof value === "string" ? value : "";
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export async function runQuery(query: Record<string, any>, exportAll = false) {
  const timezone = await storage.getSetting("default_timezone") || "UTC";
  const where: string[] = [], values: any[] = [];
  const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll("?", `$${values.length}`)); };
  if (query.search) add("(schedule_name ILIKE ? OR id::text ILIKE ? OR COALESCE(error,'') ILIKE ?)", `%${text(query.search).slice(0, 200)}%`);
  if (query.status) add("status=?", z.enum(["queued", "running", "succeeded", "failed", "interrupted", "cancelled", "expired"]).parse(query.status));
  if (query.backupType) add("backup_type=?", z.enum(["database", "clean", "files", "project"]).parse(query.backupType));
  if (query.scheduleId) add("schedule_id=?", uuid.parse(query.scheduleId));
  for (const [key, comparator] of [["from", ">="], ["to", "<"]] as const) {
    if (!query[key]) continue;
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query[key]);
    if (!Number.isFinite(new Date(date).getTime()) || new Date(date).toISOString().slice(0, 10) !== date) throw new BackupError("Invalid date range.");
    values.push(date, timezone);
    where.push(`created_at ${comparator} (($${values.length - 1}::date${key === "to" ? " + 1" : ""})::timestamp AT TIME ZONE $${values.length})`);
  }
  if (query.from && query.to && query.from > query.to) throw new BackupError("From date must be on or before To date.");
  const clause = where.length ? " WHERE " + where.join(" AND ") : "";
  const total = Number((await pool.query("SELECT count(*) FROM public.backup_runs" + clause, values)).rows[0].count);
  if (exportAll && total > 25000) throw new BackupError("This export exceeds 25,000 records. Narrow the date range or filters.");
  const limit = exportAll ? 25000 : z.coerce.number().int().min(1).max(100).parse(query.limit ?? 25);
  const offset = exportAll ? 0 : z.coerce.number().int().min(0).parse(query.offset ?? 0);
  const { rows } = await pool.query("SELECT * FROM public.backup_runs" + clause + ` ORDER BY created_at DESC,id DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`, [...values, limit, offset]);
  return { rows: rows.map(backups.runDto), total, timezone };
}
export function registerBackupRoutes(app: Express, authenticated: RequestHandler) {
  const guard: RequestHandler = async (req: any, res, next) => {
    try {
      const user = await storage.getUser(req.user.claims.sub);
      if (!user || !await storage.hasPermission(user, "maintenance.systemBackup"))
        return void res.status(403).json({ message: "System backup permission required." });
      next();
    } catch { res.status(503).json({ message: "Backup authorization could not be verified." }); }
  };
  const route = (handler: (req: any, res: any) => Promise<unknown>): RequestHandler => async (req, res) => {
    try { await handler(req, res); }
    catch (error: any) {
      if (res.headersSent) { res.destroy(); return; }
      const message = error instanceof z.ZodError ? error.issues.map(issue => issue.message).join(" ")
        : error instanceof BackupError ? error.message : "Backup operation failed. Check database, storage access and server backup tools.";
      res.status(error instanceof z.ZodError ? 400 : error instanceof BackupError ? error.status : 500).json({ message });
    }
  };
  app.get(base, authenticated, guard, route(async (_req, res) => res.json(await backups.dashboard())));
  app.put(base + "/destination", authenticated, guard, route(async (req, res) => {
    res.json(await auditedOperation("backupDestinationUpdate", "backup-destination", () => backups.saveDestination(req.body)));
  }));
  app.post(base + "/schedules", authenticated, guard, route(async (req, res) => {
    res.status(201).json(await auditedOperation("backupScheduleCreate", "schedule", () => backups.saveSchedule(undefined, req.body)));
  }));
  app.patch(base + "/schedules/:id", authenticated, guard, route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.json(await auditedOperation("backupScheduleUpdate", id, () => backups.saveSchedule(id, req.body)));
  }));
  app.delete(base + "/schedules/:id", authenticated, guard, route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    await auditedOperation("backupScheduleDelete", id, () => backups.deleteSchedule(id));
    res.sendStatus(204);
  }));
  app.post(base + "/schedules/:id/run", authenticated, guard, route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    res.status(202).json(await auditedOperation("backupQueued", id, () => backups.enqueueBackup(id)));
  }));
  app.get(base + "/runs", authenticated, guard, route(async (req, res) => res.json(await runQuery(req.query))));
  app.get(base + "/runs/export", authenticated, guard, route(async (req, res) => {
    const { rows, timezone } = await runQuery(req.query, true);
    const format = z.enum(["csv", "xlsx", "print"]).parse(req.query.format);
    const date = (value: string | null) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: timezone }).format(new Date(value)) : "";
    const headers = ["Run ID", "Schedule", "Backup type", "Trigger", "Status", "Created", "Started", "Completed", "Bytes", "Destination", "Error", "Retention warning"];
    const data = rows.map(row => [row.id, row.scheduleName, backupTypeLabels[row.backupType], row.trigger, row.status,
      date(row.createdAt), date(row.startedAt), date(row.completedAt), row.bytes ?? "", `${row.destination.kind}: ${row.destination.path}`, row.error || "", row.cleanupError || ""]);
    res.setHeader("Cache-Control", "no-store");
    if (format === "print") {
      res.type("html").send(`<!doctype html><html><head><meta charset="utf-8"><title>Backup history</title><style>body{font:12px Arial}table{border-collapse:collapse;width:100%}td,th{padding:5px;border:1px solid #bbb;text-align:left;overflow-wrap:anywhere}@media print{button{display:none}thead{display:table-header-group}}</style></head><body><button onclick="window.print()">Print / Save PDF</button><h1>Backup history</h1><p>${rows.length} matching records · Timezone: ${escapeHtml(timezone)}</p><table><thead><tr>${headers.map(v => `<th>${v}</th>`).join("")}</tr></thead><tbody>${data.map(row => `<tr>${row.map(v => `<td>${escapeHtml(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
    } else if (format === "xlsx") {
      const xlsx = await import("xlsx");
      const book = xlsx.utils.book_new(); xlsx.utils.book_append_sheet(book, xlsx.utils.aoa_to_sheet([headers, ...data]), "Backup history");
      res.setHeader("Content-Disposition", 'attachment; filename="backup-history.xlsx"');
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet").send(xlsx.write(book, { type: "buffer", bookType: "xlsx" }));
    } else {
      const csv = (v: unknown) => `"${String(v ?? "").replace(/^[=+\-@\t\r]/, "'$&").replaceAll('"', '""')}"`;
      res.setHeader("Content-Disposition", 'attachment; filename="backup-history.csv"');
      res.type("text/csv").send("\uFEFF" + [headers, ...data].map(row => row.map(csv).join(",")).join("\r\n"));
    }
  }));
  app.get(base + "/runs/:id/download", authenticated, guard, route(async (req, res) => {
    const id = uuid.parse(req.params.id);
    const { rows: [row] } = await pool.query("SELECT * FROM public.backup_runs WHERE id=$1", [id]);
    if (!row) return res.status(404).json({ message: "Backup not found." });
    if (row.status !== "succeeded") return res.status(409).json({ message: "Only completed, retained backups can be downloaded." });
    const run = backups.runDto(row);
    if (!await backupFiles.exists(run.destination, id)) return res.status(404).json({ message: "The backup file is missing or no longer accessible." });
    const stream = await backupFiles.open(run.destination, id);
    res.type("application/zip"); res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="meterflo-${run.backupType}-${id}.zip"`);
    await pipeline(stream, res);
  }));
}
