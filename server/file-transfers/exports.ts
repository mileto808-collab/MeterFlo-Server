import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import * as cron from "node-cron";
import { pool } from "../db";
import { storage } from "../storage";
import { ensureProjectFtpDirectory } from "../fileStorage";
import { serviceAuditContext, withAuditContext } from "../auditContext";
import { auditedOperation } from "../auditService";
import { backupLock } from "../backups/lock";
import { exportConfigInput, transferSelection, type ExportConfig, type ExportSelection } from "../../shared/file-transfers";
import { TransferError, connectionIdentity, getConnection, remoteDirectory, deliverSftp, digest } from "./sftp";
import { requireExchange, publishHttpsExport, expireExchangeFiles } from "./https-service";

export function schemaIdentifier(value: string) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) throw new TransferError("Invalid project database configuration.");
  return `"${value}"`;
}
export const camel = (value: string) => value.replace(/_([a-z])/g, (_s, c) => c.toUpperCase());
export async function projectZone(projectId: number) { return (await storage.getProject(projectId))?.timezone || await storage.getSetting("default_timezone") || "UTC"; }
export function frequencyCron(frequency: string, custom?: string | null) {
  const expressions: Record<string, string> = { every_15_minutes: "*/15 * * * *", every_30_minutes: "*/30 * * * *", hourly: "0 * * * *",
    every_2_hours: "0 */2 * * *", every_6_hours: "0 */6 * * *", every_12_hours: "0 */12 * * *", daily: "0 0 * * *",
    weekly: "0 0 * * 0", monthly: "0 0 1 * *" };
  if (frequency === "manual") return null;
  const expression = frequency === "custom" ? custom : expressions[frequency];
  if (!expression || expression.trim().split(/\s+/).length !== 5 || !cron.validate(expression))
    throw new TransferError("Use a valid five-field schedule expression.");
  return expression;
}
export function nextTransferTime(frequency: string, custom: string | null, timezone: string) {
  const expression = frequencyCron(frequency, custom);
  if (!expression) return null;
  const task = cron.schedule(expression, () => {}, { timezone });
  const next = task.getNextRun(); void task.destroy();
  if (!next) throw new TransferError("The schedule has no future run.");
  return next;
}
export function exportFilename(template: string, format: string, id: string, timezone: string, now = new Date()) {
  if (!/^[A-Za-z0-9_.{}-]+$/.test(template) || template.includes("..")) throw new TransferError("Use a filename template, not a path.");
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(now).map(part => [part.type, part.value]));
  const tokens: Record<string, string> = { YYYY: parts.year, MM: parts.month, DD: parts.day, HH: parts.hour, mm: parts.minute, ss: parts.second, runId: id };
  let result = template.replace(/\{([^}]+)\}/g, (_whole, token) => {
    if (!(token in tokens)) throw new TransferError(`Unknown filename token: ${token}`); return tokens[token];
  });
  if (/[{}]/.test(result)) throw new TransferError("Invalid filename tokens.");
  const extension = /\.(csv|xlsx|json)$/i.exec(result);
  if (extension && extension[1].toLowerCase() !== format) throw new TransferError("Filename extension must match the export format.");
  if (extension) result = result.slice(0, -extension[0].length);
  if (!template.includes("{runId}")) result += "_" + id;
  result += "." + format;
  if (result.length > 240) throw new TransferError("The generated filename is too long.");
  return result;
}
export async function exportFields(projectId: number) {
  const project = await storage.getProject(projectId);
  if (!project?.databaseName) throw new TransferError("The project has no work-order database.");
  schemaIdentifier(project.databaseName);
  const rows = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders' ORDER BY ordinal_position", [project.databaseName])).rows;
  return rows.map(row => camel(row.column_name));
}
export async function validateSelection(projectId: number, input: ExportSelection) {
  if (!input.allStatuses && !input.statusIds.length && !input.subStatusIds.length) throw new TransferError("Select at least one status/sub-status, or choose All statuses.");
  const statuses = (await pool.query("SELECT id,code FROM public.work_order_statuses WHERE id=ANY($1::int[])", [input.statusIds])).rows;
  const subs = (await pool.query("SELECT id FROM public.work_order_sub_statuses WHERE id=ANY($1::uuid[]) AND active AND (project_id IS NULL OR project_id=$2)", [input.subStatusIds, projectId])).rows;
  if (statuses.length !== new Set(input.statusIds).size || subs.length !== new Set(input.subStatusIds).size) throw new TransferError("One or more selected statuses are unavailable for this project.");
  return statuses.map(row => row.code);
}
export async function getExports(projectId: number): Promise<ExportConfig[]> {
  const { rows } = await pool.query(`SELECT e.*,
    ARRAY(SELECT status_id FROM public.file_export_statuses WHERE config_id=e.id) AS status_ids,
    ARRAY(SELECT sub_status_id FROM public.file_export_substatuses WHERE config_id=e.id) AS sub_status_ids
    FROM public.file_exports e WHERE project_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC`, [projectId]);
  return rows.map(row => ({ id: row.id, projectId: row.project_id, name: row.name, format: row.format, mode: row.mode, allStatuses: row.all_statuses,
    statusIds: row.status_ids, subStatusIds: row.sub_status_ids, columns: row.columns, filenameTemplate: row.filename_template, destination: row.destination,
    remoteDirectory: row.remote_directory, scheduleFrequency: row.schedule_frequency, customCronExpression: row.custom_cron_expression, isEnabled: row.is_enabled,
    nextRunAt: row.next_run_at?.toISOString() || null, lastRunAt: row.last_run_at?.toISOString() || null, lastRunStatus: row.last_run_status,
    lastRunMessage: row.last_run_message, createdAt: row.created_at.toISOString() }));
}
export async function saveExport(projectId: number, body: unknown, id?: string) {
  const input = exportConfigInput.parse(body), timezone = await projectZone(projectId);
  await validateSelection(projectId, input);
  const fields = await exportFields(projectId);
  if (input.columns.some(column => !fields.includes(column))) throw new TransferError("Select available work-order fields.");
  exportFilename(input.filenameTemplate, input.format, randomUUID(), timezone);
  const next = nextTransferTime(input.scheduleFrequency, input.customCronExpression, timezone);
  if (input.destination === "sftp") { remoteDirectory(input.remoteDirectory); connectionIdentity(await getConnection(projectId)); }
  if (input.destination === "https") await requireExchange(projectId);
  const client = await pool.connect(), key = id || randomUUID();
  try {
    await client.query("BEGIN");
    const previous = id ? (await client.query("SELECT * FROM public.file_exports WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, projectId])).rows[0] : null;
    if (id && !previous) throw new TransferError("Export configuration not found.", 404);
    const reset = previous && (JSON.stringify(previous.columns) !== JSON.stringify(input.columns) || previous.format !== input.format ||
      previous.destination !== input.destination || previous.remote_directory !== input.remoteDirectory);
    if (reset) {
      if ((await client.query("SELECT id FROM public.file_export_runs WHERE config_id=$1 AND status IN ('queued','running','failed','interrupted')", [key])).rowCount)
        throw new TransferError("Retry or cancel the unresolved run before changing columns, format or destination.", 409);
      await client.query("DELETE FROM public.file_export_checkpoints WHERE config_id=$1", [key]);
    }
    if (id) await client.query(`UPDATE public.file_exports SET name=$2,format=$3,mode=$4,all_statuses=$5,filename_template=$6,columns=$7::jsonb,
      destination=$8,remote_directory=$9,schedule_frequency=$10,custom_cron_expression=$11,is_enabled=$12,next_run_at=$13,schedule_timezone=$14,updated_at=now() WHERE id=$1`,
    [key, input.name, input.format, input.mode, input.allStatuses, input.filenameTemplate, JSON.stringify(input.columns), input.destination,
      input.remoteDirectory, input.scheduleFrequency, input.customCronExpression, input.isEnabled, input.isEnabled ? next : null, timezone]);
    else {
      if (Number((await client.query("SELECT count(*) FROM public.file_exports WHERE project_id=$1 AND deleted_at IS NULL", [projectId])).rows[0].count) >= 100)
        throw new TransferError("Limit reached: 100 export configurations per project.");
      await client.query(`INSERT INTO public.file_exports(id,project_id,name,format,mode,all_statuses,filename_template,columns,destination,remote_directory,
        schedule_frequency,custom_cron_expression,is_enabled,next_run_at,schedule_timezone) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,$15)`,
      [key, projectId, input.name, input.format, input.mode, input.allStatuses, input.filenameTemplate, JSON.stringify(input.columns),
        input.destination, input.remoteDirectory, input.scheduleFrequency, input.customCronExpression, input.isEnabled, input.isEnabled ? next : null, timezone]);
    }
    await client.query("DELETE FROM public.file_export_statuses WHERE config_id=$1", [key]);
    await client.query("DELETE FROM public.file_export_substatuses WHERE config_id=$1", [key]);
    for (const status of new Set(input.statusIds)) await client.query("INSERT INTO public.file_export_statuses VALUES($1,$2)", [key, status]);
    for (const sub of new Set(input.subStatusIds)) await client.query("INSERT INTO public.file_export_substatuses VALUES($1,$2)", [key, sub]);
    if (id && !input.isEnabled) await client.query(`UPDATE public.file_export_runs SET status='cancelled',message='Scheduled export paused.'
      WHERE config_id=$1 AND status='queued' AND snapshot->>'scheduled'='true' AND snapshot->>'manualRetry' IS DISTINCT FROM 'true'`, [key]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  return (await getExports(projectId)).find(row => row.id === key)!;
}
export async function enqueueExport(projectId: number, id: string, override: unknown = {}, scheduled = false) {
  const config = (await getExports(projectId)).find(row => row.id === id);
  if (!config) throw new TransferError("Export configuration not found.", 404);
  const selection = transferSelection.parse({ ...config, ...(override as object) });
  await validateSelection(projectId, selection);
  const connection = config.destination === "sftp" ? connectionIdentity(await getConnection(projectId)) : null;
  const timezone = await projectZone(projectId), runId = randomUUID();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = (await client.query("SELECT * FROM public.file_exports WHERE id=$1 AND project_id=$2 AND deleted_at IS NULL FOR UPDATE", [id, projectId])).rows[0];
    if (!current || (scheduled && !current.is_enabled)) throw new TransferError("The export is disabled or deleted.", 409);
    const pending = (await client.query("SELECT * FROM public.file_export_runs WHERE config_id=$1 AND status IN ('queued','running','failed','interrupted')", [id])).rows[0];
    if (pending) {
      if (scheduled && ["failed", "interrupted"].includes(pending.status)) {
        await client.query("UPDATE public.file_export_runs SET status='queued',message=null WHERE id=$1", [pending.id]);
      } else if (!scheduled) throw new TransferError("An unresolved run exists. Retry or cancel it in History before starting a new export.", 409);
      await client.query("COMMIT"); return { id: pending.id, status: pending.status };
    }
    const filename = exportFilename(config.filenameTemplate, config.format, runId, timezone);
    await client.query(`INSERT INTO public.file_export_runs(id,config_id,project_id,config_name,snapshot,file_name,status)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,'queued')`, [runId, id, projectId, config.name, JSON.stringify({ ...config, ...selection, connectionIdentity: connection, timezone, scheduled }), filename]);
    await client.query("COMMIT"); return { id: runId, status: "queued" };
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export function encodeExport(rows: any[], columns: string[], format: string) {
  if (format === "json") return Buffer.from(JSON.stringify(rows, null, 2));
  const values = rows.map(row => columns.map(column => {
    const value = row[column];
    const string = value == null ? "" : typeof value === "object" ? JSON.stringify(value) : value;
    return format === "csv" && typeof string === "string" && /^\s*[=+\-@\t\r\n]/.test(string) ? "'" + string : string;
  }));
  const sheet = XLSX.utils.aoa_to_sheet([columns, ...values]);
  if (format === "csv") return Buffer.from("\uFEFF" + XLSX.utils.sheet_to_csv(sheet));
  const book = XLSX.utils.book_new();
  book.Props = { CreatedDate: new Date("2000-01-01T00:00:00Z"), ModifiedDate: new Date("2000-01-01T00:00:00Z") };
  XLSX.utils.book_append_sheet(book, sheet, "Work Orders");
  return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
async function captureRun(run: any) {
  if (run.captured) return;
  const project = await storage.getProject(run.project_id);
  if (!project?.databaseName || project.isActive === false) throw new TransferError("The project is unavailable or inactive.");
  const config = run.snapshot, codes = await validateSelection(run.project_id, config);
  const client = await pool.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const table = `${schemaIdentifier(project.databaseName)}.work_orders`;
    const hash = "encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex')";
    const { rows } = await client.query(`SELECT w.*,${hash} AS "__export_hash" FROM ${table} w
      LEFT JOIN public.file_export_checkpoints c ON c.config_id=$1 AND c.work_order_id=w.id
      WHERE ($2::boolean OR w.status=ANY($3::text[]) OR w.sub_status_id=ANY($4::uuid[]))
      AND ($5::boolean OR c.content_hash IS DISTINCT FROM ${hash}) ORDER BY w.id LIMIT 100001`,
    [run.config_id, config.allStatuses, codes, config.subStatusIds, config.mode === "full"]);
    if (rows.length > 100000) throw new TransferError("More than 100,000 orders match. Narrow the status selection.");
    const fields = rows.length ? Object.keys(rows[0]).map(camel) : await exportFields(run.project_id);
    if (config.columns.some((field: string) => !fields.includes(field))) throw new TransferError("The export contains an unavailable field.");
    await client.query("DELETE FROM public.file_export_run_items WHERE run_id=$1", [run.id]);
    let size = 0;
    for (let offset = 0; offset < rows.length; offset += 300) {
      const chunk = rows.slice(offset, offset + 300).map(row => {
        const record = Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value]));
        const payload = Object.fromEntries(config.columns.map((field: string) => [field, record[field]]));
        size += Buffer.byteLength(JSON.stringify(payload));
        return { id: row.id, hash: row.__export_hash, payload };
      });
      if (size > 50 * 1024 * 1024) throw new TransferError("The export exceeds 50 MB. Narrow the status selection.");
      await client.query(`INSERT INTO public.file_export_run_items(run_id,work_order_id,content_hash,payload)
        SELECT $1,x.id,x.hash,x.payload FROM jsonb_to_recordset($2::jsonb) x(id integer,hash text,payload jsonb)`, [run.id, JSON.stringify(chunk)]);
    }
    await client.query("UPDATE public.file_export_runs SET captured=true,record_count=$2 WHERE id=$1", [run.id, rows.length]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function runBytes(run: any) {
  if (!run.captured) throw new TransferError("This run has not captured an export file yet.", 409);
  const rows = (await pool.query("SELECT payload FROM public.file_export_run_items WHERE run_id=$1 ORDER BY work_order_id", [run.id])).rows.map(row => row.payload);
  const bytes = encodeExport(rows, run.snapshot.columns, run.snapshot.format);
  if (bytes.length > 50 * 1024 * 1024) throw new TransferError("The generated export exceeds 50 MB.");
  return bytes;
}
async function executeRun(run: any) {
  const attempt = randomUUID();
  const claim = await pool.connect();
  try {
    await claim.query("BEGIN");
    const config = (await claim.query("SELECT deleted_at,is_enabled FROM public.file_exports WHERE id=$1 FOR UPDATE", [run.config_id])).rows[0];
    if (!config || config.deleted_at || (run.snapshot.scheduled && !run.snapshot.manualRetry && !config.is_enabled)) {
      await claim.query("UPDATE public.file_export_runs SET status='cancelled',message='Scheduled export disabled or deleted.' WHERE id=$1 AND status='queued'", [run.id]);
      await claim.query("COMMIT"); return;
    }
    const updated = await claim.query("UPDATE public.file_export_runs SET status='running',started_at=now(),completed_at=null,message=null,attempts=attempts+1 WHERE id=$1 AND status='queued' RETURNING *", [run.id]);
    await claim.query("COMMIT");
    if (!updated.rowCount) return;
    run = updated.rows[0];
  } catch (error) { await claim.query("ROLLBACK"); throw error; } finally { claim.release(); }
  await pool.query("INSERT INTO public.file_export_attempts(id,run_id,status) VALUES($1,$2,'running')", [attempt, run.id]);
  try {
    await captureRun(run);
    run = (await pool.query("SELECT * FROM public.file_export_runs WHERE id=$1", [run.id])).rows[0];
    const bytes = await runBytes(run), project = await storage.getProject(run.project_id);
    if (!project || project.isActive === false) throw new TransferError("The project is unavailable or inactive.");
    const folder = await ensureProjectFtpDirectory(project.name, project.id), target = path.join(folder, run.file_name);
    try {
      const current = await fs.readFile(target);
      if (digest(current) !== digest(bytes)) throw new TransferError("A different local file already exists; it was not overwritten.", 409);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
      const partial = target + ".part";
      await fs.writeFile(partial, bytes, { mode: 0o600 });
      try { await fs.copyFile(partial, target, 1); } finally { await fs.unlink(partial).catch(() => {}); }
    }
    if (run.snapshot.destination === "sftp") await deliverSftp(project.id, run.snapshot.remoteDirectory, run.file_name, run.id, bytes, run.snapshot.connectionIdentity);
    if (run.snapshot.destination === "https") await publishHttpsExport(run, bytes);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`INSERT INTO public.file_export_checkpoints(config_id,work_order_id,content_hash)
        SELECT $1,work_order_id,content_hash FROM public.file_export_run_items WHERE run_id=$2
        ON CONFLICT(config_id,work_order_id) DO UPDATE SET content_hash=EXCLUDED.content_hash`, [run.config_id, run.id]);
      await client.query("UPDATE public.file_export_runs SET status='success',completed_at=now(),message='File generated and delivered successfully.' WHERE id=$1", [run.id]);
      await client.query("UPDATE public.file_export_attempts SET status='success',completed_at=now() WHERE id=$1", [attempt]);
      await client.query("UPDATE public.file_exports SET last_run_at=now(),last_run_status='success',last_run_message=$2 WHERE id=$1", [run.config_id, `${run.record_count} orders delivered in ${run.file_name}`]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  } catch (error) {
    const message = error instanceof TransferError ? error.message : "Export failed. Check project storage, database and directory permissions.";
    await pool.query("UPDATE public.file_export_runs SET status='failed',completed_at=now(),message=$2 WHERE id=$1", [run.id, message]);
    await pool.query("UPDATE public.file_export_attempts SET status='failed',completed_at=now(),message=$2 WHERE id=$1", [attempt, message]);
    await pool.query("UPDATE public.file_exports SET last_run_at=now(),last_run_status='failed',last_run_message=$2 WHERE id=$1", [run.config_id, message]);
  }
}
let working = false;
let lastHttpsCleanup = 0;
export async function exportTick() {
  if (working) return;
  working = true; let locked = false;
  const client = await pool.connect().catch(error => { working = false; throw error; });
  try {
    locked = (await client.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", [backupLock])).rows[0].locked;
    if (!locked) return;
    await pool.query("UPDATE public.file_export_runs SET status='interrupted',message='Server stopped during delivery. Retry preserves the same file and snapshot.' WHERE status='running'");
    await pool.query("UPDATE public.file_export_attempts SET status='interrupted',completed_at=now(),message='Server stopped during delivery.' WHERE status='running'");
    const defaultZone = await storage.getSetting("default_timezone") || "UTC";
    const due = (await pool.query(`SELECT e.id,e.project_id,e.schedule_frequency,e.custom_cron_expression,e.schedule_timezone,
      coalesce(nullif(p.timezone,''),$1) AS current_zone FROM public.file_exports e JOIN public.projects p ON p.id=e.project_id
      WHERE e.is_enabled AND e.deleted_at IS NULL AND p.is_active IS DISTINCT FROM false
      AND (e.next_run_at<=now() OR e.schedule_timezone IS DISTINCT FROM coalesce(nullif(p.timezone,''),$1))`, [defaultZone])).rows;
    for (const config of due) {
      try {
        const next = nextTransferTime(config.schedule_frequency, config.custom_cron_expression, config.current_zone);
        if (config.schedule_timezone === config.current_zone) await enqueueExport(config.project_id, config.id, {}, true);
        await pool.query("UPDATE public.file_exports SET next_run_at=$2,schedule_timezone=$3 WHERE id=$1", [config.id, next, config.current_zone]);
      } catch (error) {
        const message = error instanceof TransferError ? error.message : "Scheduled export could not be queued.";
        await pool.query("UPDATE public.file_exports SET last_run_at=now(),last_run_status='failed',last_run_message=$2,next_run_at=now()+interval '5 minutes' WHERE id=$1", [config.id, message]);
      }
    }
    const run = (await pool.query("SELECT * FROM public.file_export_runs WHERE status='queued' ORDER BY created_at LIMIT 1")).rows[0];
    if (run) await auditedOperation("fileExport", run.id, () => executeRun(run), run.project_id);
    if (Date.now() - lastHttpsCleanup > 60000) {
      lastHttpsCleanup = Date.now();
      await expireExchangeFiles();
    }
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock(hashtext($1))", [backupLock]).catch(() => {});
    client.release(); working = false;
  }
}
export function startFileExportWorker() {
  const tick = () => withAuditContext(serviceAuditContext("file-export-scheduler"), () => exportTick()).catch(() => console.error("[FileExports] Worker failed; queued files remain available for retry."));
  setInterval(tick, 5000).unref(); void tick();
}
