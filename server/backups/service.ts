import * as cron from "node-cron";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pool } from "../db";
import { storage } from "../storage";
import { createPgBackupFile } from "../pgBackup";
import { withAuditContext, serviceAuditContext } from "../auditContext";
import { auditedOperation } from "../auditService";
import { backupDestinationSchema, backupScheduleSchema, type BackupDestination, type BackupRun, type BackupSchedule } from "../../shared/backup-schedules";
import { backupFiles, BackupError, localBackupsAllowed, probeDestination } from "./files";
import { backupLock, withExistingBackupLock } from "./lock";

export function nextBackupTime(expression: string, timezone: string) {
  if (expression.split(/\s+/).length !== 5 || !cron.validate(expression))
    throw new BackupError("Enter a valid five-field cron expression (minute hour day month weekday).");
  const task = cron.schedule(expression, () => {}, { timezone });
  try {
    const next = task.getNextRun();
    if (!next) throw new BackupError("This schedule has no future execution.");
    return next;
  } finally { void task.destroy(); }
}
const iso = (value: any) => value == null ? null : new Date(value).toISOString();
export function scheduleDto(row: any): BackupSchedule {
  return { id: row.id, name: row.name, backupType: row.backup_type, cron: row.cron, timezone: row.timezone,
    enabled: row.enabled, retentionDays: row.retention_days, minimumCopies: row.minimum_copies,
    nextRunAt: iso(row.next_run_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! };
}
export function runDto(row: any): BackupRun {
  return { id: row.id, scheduleId: row.schedule_id, scheduleName: row.schedule_name, backupType: row.backup_type,
    trigger: row.trigger, status: row.status, createdAt: iso(row.created_at)!, startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at), bytes: row.bytes == null ? null : Number(row.bytes), error: row.error,
    cleanupError: row.cleanup_error, destination: { kind: row.destination_kind, path: row.destination_path, bucketId: row.bucket_id } };
}
export async function destination(): Promise<BackupDestination | null> {
  const { rows: [row] } = await pool.query("SELECT * FROM public.backup_destination WHERE id=1");
  return row ? { kind: row.kind, path: row.path, bucketId: row.bucket_id } : null;
}
export async function saveDestination(value: unknown) {
  const checked = await probeDestination(backupDestinationSchema.parse(value));
  await pool.query(`INSERT INTO public.backup_destination(id,kind,path,bucket_id) VALUES(1,$1,$2,$3)
    ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,path=excluded.path,bucket_id=excluded.bucket_id,updated_at=now()`,
  [checked.kind, checked.path, checked.bucketId]);
  return checked;
}
export async function dashboard() {
  const { rows } = await pool.query("SELECT * FROM public.backup_schedules WHERE deleted_at IS NULL ORDER BY created_at DESC");
  return { destination: await destination(), schedules: rows.map(scheduleDto),
    defaultTimezone: await storage.getSetting("default_timezone") || "UTC", localAllowed: localBackupsAllowed(),
    hostingNotice: "Schedules run while this server is running. Replit requires an always-on Reserved VM for reliable unattended schedules; sleeping/Autoscale instances cannot guarantee exact run times. After downtime, each overdue schedule runs once, not once per missed interval." };
}
export async function saveSchedule(id: string | undefined, value: unknown) {
  const input = backupScheduleSchema.parse(value);
  const next = nextBackupTime(input.cron, input.timezone);
  if (input.enabled) {
    const target = await destination();
    if (!target) throw new BackupError("Save and verify a backup destination before enabling schedules.");
    await probeDestination(target);
  }
  if (!id && Number((await pool.query("SELECT count(*) FROM public.backup_schedules WHERE deleted_at IS NULL")).rows[0].count) >= 100)
    throw new BackupError("At most 100 schedules may be configured.");
  const args = [input.name, input.backupType, input.cron, input.timezone, input.enabled, input.retentionDays, input.minimumCopies, input.enabled ? next : null];
  const result = id
    ? await pool.query(`UPDATE public.backup_schedules SET name=$1,backup_type=$2,cron=$3,timezone=$4,enabled=$5,
        retention_days=$6,minimum_copies=$7,next_run_at=$8,updated_at=now() WHERE id=$9 AND deleted_at IS NULL RETURNING *`, [...args, id])
    : await pool.query(`INSERT INTO public.backup_schedules(name,backup_type,cron,timezone,enabled,retention_days,minimum_copies,next_run_at,id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [...args, randomUUID()]);
  if (!result.rows[0]) throw Object.assign(new BackupError("Schedule not found."), { status: 404 });
  if (!input.enabled) await pool.query(`UPDATE public.backup_runs SET status='cancelled',completed_at=now(),
    error='Schedule was paused before execution.' WHERE schedule_id=$1 AND trigger='scheduled' AND status='queued'`, [result.rows[0].id]);
  return scheduleDto(result.rows[0]);
}
export async function deleteSchedule(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(`UPDATE public.backup_schedules SET enabled=false,deleted_at=now(),next_run_at=null,updated_at=now()
      WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id]);
    if (!result.rowCount) throw Object.assign(new BackupError("Schedule not found."), { status: 404 });
    await client.query("UPDATE public.backup_runs SET status='cancelled',completed_at=now(),error='Schedule was deleted before execution.' WHERE schedule_id=$1 AND status='queued'", [id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function insertRun(client: any, schedule: any, kind: string, target: BackupDestination) {
  const result = await client.query(`INSERT INTO public.backup_runs(id,schedule_id,schedule_name,backup_type,trigger,status,destination_kind,destination_path,bucket_id)
    VALUES($1,$2,$3,$4,$5,'queued',$6,$7,$8) RETURNING *`,
  [randomUUID(), schedule.id, schedule.name, schedule.backup_type, kind, target.kind, target.path, target.bucketId]);
  return runDto(result.rows[0]);
}
export async function enqueueBackup(id: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [schedule] } = await client.query("SELECT * FROM public.backup_schedules WHERE id=$1 AND deleted_at IS NULL FOR UPDATE", [id]);
    if (!schedule) throw Object.assign(new BackupError("Schedule not found."), { status: 404 });
    if ((await client.query("SELECT 1 FROM public.backup_runs WHERE schedule_id=$1 AND status IN ('queued','running') LIMIT 1", [id])).rowCount)
      throw Object.assign(new BackupError("This schedule already has a queued or running backup."), { status: 409 });
    const target = await destination();
    if (!target) throw new BackupError("Save a backup destination first.");
    if (target.kind === "local" && !localBackupsAllowed()) throw new BackupError("Save an App Storage destination for this Replit instance first.");
    const run = await insertRun(client, schedule, "manual", target);
    await client.query("COMMIT");
    return run;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
/** Pure selection: retention never deletes all copies, even after long downtime. */
export function expiredBackups(rows: { id: string; completed_at: any }[], days: number, minimum: number, now = Date.now()) {
  return rows.slice(minimum).filter(row => new Date(row.completed_at).getTime() < now - days * 86400000);
}
export async function cleanRetention() {
  const schedules = await pool.query("SELECT id,retention_days,minimum_copies FROM public.backup_schedules");
  for (const schedule of schedules.rows) {
    const { rows } = await pool.query("SELECT * FROM public.backup_runs WHERE schedule_id=$1 AND status='succeeded' ORDER BY completed_at DESC,id DESC", [schedule.id]);
    if (rows.length <= schedule.minimum_copies) continue;
    // Verify the protected newer copies exist before deleting ANY older copy.
    try {
      for (const row of rows.slice(0, schedule.minimum_copies))
        if (!await backupFiles.exists(runDto(row).destination, row.id)) throw new BackupError("A protected recent backup is missing; retention stopped.");
      await pool.query("UPDATE public.backup_runs SET cleanup_error=null WHERE schedule_id=$1 AND status='succeeded'", [schedule.id]);
      for (const row of expiredBackups(rows, schedule.retention_days, schedule.minimum_copies)) {
        try {
          await backupFiles.remove(runDto(row).destination, row.id);
          await pool.query("UPDATE public.backup_runs SET status='expired',cleanup_error=null WHERE id=$1 AND status='succeeded'", [row.id]);
        } catch {
          await pool.query("UPDATE public.backup_runs SET cleanup_error='Retention could not remove this backup; check destination access. It will retry.' WHERE id=$1", [row.id]);
        }
      }
    } catch {
      await pool.query(`UPDATE public.backup_runs SET cleanup_error='Retention paused: protected recent copies could not be verified. Check storage access and missing files.'
        WHERE schedule_id=$1 AND status='succeeded'`, [schedule.id]);
    }
  }
}
let polling = false, lastCleanup = 0;
export async function backupTick() {
  if (polling) return;
  polling = true;
  let client;
  try { client = await pool.connect(); } catch (error) { polling = false; throw error; }
  let locked = false;
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [backupLock])).rows[0].locked;
    if (!locked) return;
    // Holding the global lock proves no cooperating backup is still running.
    await client.query("UPDATE public.backup_runs SET status='interrupted',completed_at=now(),error='Server stopped before backup completion was confirmed. No automatic replay.' WHERE status='running'");
    const target = await destination();
    if (target) {
      await client.query("BEGIN");
      const due = await client.query("SELECT * FROM public.backup_schedules WHERE enabled AND deleted_at IS NULL AND next_run_at<=now() FOR UPDATE");
      for (const schedule of due.rows) {
        if (!(await client.query("SELECT 1 FROM public.backup_runs WHERE schedule_id=$1 AND status IN ('queued','running')", [schedule.id])).rowCount)
          await insertRun(client, schedule, "scheduled", target);
        await client.query("UPDATE public.backup_schedules SET next_run_at=$2 WHERE id=$1",
          [schedule.id, nextBackupTime(schedule.cron, schedule.timezone)]);
      }
      await client.query("COMMIT");
    }
    const { rows: [row] } = await client.query(`UPDATE public.backup_runs SET status='running',started_at=now()
      WHERE id=(SELECT id FROM public.backup_runs WHERE status='queued' ORDER BY created_at LIMIT 1) RETURNING *`);
    if (row) {
      const run = runDto(row);
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-scheduled-backup-"));
      try {
        await withExistingBackupLock(() => withAuditContext(serviceAuditContext("backup-scheduler"), () => auditedOperation("scheduledBackup", run.id, async () => {
          const filename = path.join(temp, "backup.zip");
          await createPgBackupFile(filename, run.backupType);
          const bytes = (await fs.stat(filename)).size;
          await backupFiles.put(run.destination, run.id, filename);
          if (!await backupFiles.exists(run.destination, run.id)) throw new BackupError("The backup upload could not be verified.");
          await client.query("UPDATE public.backup_runs SET status='succeeded',bytes=$2,completed_at=now(),error=null WHERE id=$1", [run.id, bytes]);
        })));
      } catch (error) {
        const message = error instanceof BackupError ? error.message : "Backup failed. Check PostgreSQL backup tools, source-file access and destination permissions.";
        await client.query("UPDATE public.backup_runs SET status='failed',completed_at=now(),error=$2 WHERE id=$1", [run.id, message]);
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
      lastCleanup = 0;
    }
    if (Date.now() - lastCleanup > 3600000) { await cleanRetention(); lastCleanup = Date.now(); }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [backupLock]).catch(() => {});
    client.release(); polling = false;
  }
}
export function startBackupWorker() {
  const tick = () => backupTick().catch(() => console.error("[BackupScheduler] Backup polling failed; check database availability."));
  const timer = setInterval(tick, 15000); timer.unref(); void tick();
}
