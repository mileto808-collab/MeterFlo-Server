import { randomUUID, createHash } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { storage } from "./storage";
import { getProjectFilesPath, getProjectDirectoryName } from "./fileStorage";
import { API_IMPORT_SCHEMA_SQL } from "./apiImportSchema";
import { emitWorkOrderCreated, emitWorkOrderUpdated } from "./eventEmitter";
import { apiImportConfigSchema, type ApiImportSettings, type ApiImportConfig, type ApiImportRun, type ImportMessage } from "../shared/customer-api-import";
import { fetchImportPage, firstImportUrl, mapImportRecord, nextImportPage, redactImportMessage, ImportFetchError, type ImportRules } from "./apiImportFetch";

const LOCK_NAMESPACE = 715293;
const ACTIVE = ["queued", "running", "retrying"];
export class ApiImportError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const runDto = (row: any): ApiImportRun => ({
  id: row.id, configId: row.config_id, configName: row.config_name, status: row.status,
  triggeredBy: row.triggered_by, created: row.created_count, updated: row.updated_count,
  skipped: row.skipped_count, failed: row.failed_count, pages: row.page_number,
  fetchAttempts: row.fetch_attempts, messages: row.messages, startedAt: row.started_at,
  completedAt: row.completed_at, nextAttemptAt: row.status === "retrying" ? row.next_attempt_at : null,
});
export async function initializeApiImports() { await pool.query(API_IMPORT_SCHEMA_SQL); }
export async function listApiImportConfigs(projectId: number): Promise<ApiImportConfig[]> {
  const { rows } = await pool.query(`SELECT c.*,row_to_json(r) last_run FROM public.api_import_configs c
    LEFT JOIN LATERAL (SELECT * FROM public.api_import_runs WHERE config_id=c.id ORDER BY started_at DESC LIMIT 1) r ON true
    WHERE c.project_id=$1 ORDER BY c.id`, [projectId]);
  return rows.map(row => ({ ...row.settings, id: row.id, projectId: row.project_id, cursor: row.cursor,
    watermark: row.watermark, nextRunAt: row.next_run_at, lastRun: row.last_run ? runDto(row.last_run) : null }));
}
export async function getApiImportConfig(projectId: number, id: number) {
  const { rows: [config] } = await pool.query(`SELECT * FROM public.api_import_configs WHERE project_id=$1 AND id=$2`, [projectId, id]);
  if (!config) throw new ApiImportError("API import configuration not found", 404);
  return config;
}
export async function saveApiImportConfig(projectId: number, data: unknown, id?: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [existing] } = id ? await client.query(`SELECT * FROM public.api_import_configs WHERE project_id=$1 AND id=$2 FOR UPDATE`, [projectId, id]) : { rows: [] };
    if (id && !existing) throw new ApiImportError("API import configuration not found", 404);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new ApiImportError("Provide import configuration settings");
    const settings = apiImportConfigSchema.parse({ ...existing?.settings, ...data as object });
    const pauseOnly = existing && Object.keys(data).length === 1 && (data as any).isEnabled === false;
    if (existing && !pauseOnly) {
      const { rows } = await client.query(`SELECT id FROM public.api_import_runs WHERE config_id=$1 AND status=ANY($2)`, [id, ACTIVE]);
      if (rows.length) throw new ApiImportError("Wait for the active import to finish or disable it before editing", 409);
    }
    const changed = existing && JSON.stringify({ ...existing.settings, isEnabled: settings.isEnabled }) !== JSON.stringify(settings);
    const next = settings.isEnabled && settings.intervalMinutes ? new Date(Date.now() + settings.intervalMinutes * 60000) : null;
    const result = existing ? await client.query(`UPDATE public.api_import_configs SET settings=$3,next_run_at=$4,
      cursor=CASE WHEN $5 THEN NULL ELSE cursor END,watermark=CASE WHEN $5 THEN NULL ELSE watermark END,updated_at=now()
      WHERE project_id=$1 AND id=$2 RETURNING id`, [projectId, id, JSON.stringify(settings), next, !!changed])
      : await client.query(`INSERT INTO public.api_import_configs(project_id,settings,next_run_at) VALUES($1,$2,$3) RETURNING id`,
        [projectId, JSON.stringify(settings), next]);
    if (!settings.isEnabled) await client.query(`UPDATE public.api_import_runs SET status='cancelled',completed_at=now(),
      messages=messages || '[{"action":"cancelled","message":"Configuration disabled by an administrator"}]'::jsonb
      WHERE config_id=$1 AND status IN ('queued','retrying')`, [result.rows[0].id]);
    await client.query("COMMIT");
    return (await listApiImportConfigs(projectId)).find(config => config.id === result.rows[0].id)!;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function deleteApiImportConfig(projectId: number, id: number) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(`SELECT id FROM public.api_import_configs WHERE project_id=$1 AND id=$2 FOR UPDATE`, [projectId, id]);
    if (!rows.length) throw new ApiImportError("API import configuration not found", 404);
    const active = await client.query(`SELECT id FROM public.api_import_runs WHERE config_id=$1 AND status=ANY($2)`, [id, ACTIVE]);
    if (active.rows.length) throw new ApiImportError("Disable the configuration and wait for cancellation before removing it", 409);
    await client.query(`DELETE FROM public.api_import_configs WHERE id=$1`, [id]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function importRules(projectId: number): Promise<ImportRules> {
  const [assigned, services, statuses, systems, modules] = await Promise.all([
    storage.getProjectServiceTypes(projectId), storage.getServiceTypes(), storage.getWorkOrderStatuses(),
    storage.getSystemTypes(projectId), storage.getModuleTypes(projectId),
  ]);
  const open = statuses.find(status => status.code.toLowerCase() === "open");
  if (!open) throw new ApiImportError("Configure an Open status code before importing");
  return { services: (assigned.length ? assigned : services).map(service => service.code),
    statuses: statuses.map(status => status.code), systems: systems.map(system => system.productId),
    modules: modules.map(module => module.productId), openStatus: open.code };
}
export async function previewApiImport(projectId: number, data: unknown) {
  const config = apiImportConfigSchema.parse(data);
  const rules = await importRules(projectId);
  const { records, body } = await fetchImportPage(config, firstImportUrl(config, {}));
  const next = nextImportPage(config, body, records, firstImportUrl(config, {}), config.startPage);
  return { records: records.slice(0, 20).map(record => {
    const { mapped, errors } = mapImportRecord(record, config, rules);
    // Even a backend that accidentally echoes authentication cannot leak it through previews.
    for (const field of Object.keys(mapped)) if (mapped[field]) mapped[field] = redactImportMessage(mapped[field]!, config);
    return { mapped, valid: errors.length === 0, errors };
  }), sampleCount: Math.min(records.length, 20), hasMore: records.length > 20 || !!next.url,
    message: "Connection successful. Preview shows at most 20 records from the first page; no work orders were changed." };
}
export async function enqueueApiImport(projectId: number, configId: number, actor: string, retryRunId?: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [config] } = await client.query(`SELECT c.*,p.is_active,p.database_name FROM public.api_import_configs c
      JOIN public.projects p ON p.id=c.project_id WHERE c.project_id=$1 AND c.id=$2 FOR UPDATE OF c`, [projectId, configId]);
    if (!config) throw new ApiImportError("API import configuration not found", 404);
    if (!config.settings.isEnabled || !config.is_active || !config.database_name) throw new ApiImportError("Enable the import and activate a project with a database before pulling", 409);
    if (actor === "scheduled" && (!config.next_run_at || new Date(config.next_run_at).getTime() > Date.now())) throw new ApiImportError("Schedule already advanced", 409);
    let checkpoint = { cursor: config.cursor, watermark: config.watermark };
    if (retryRunId) {
      const { rows: [prior] } = await client.query(`SELECT * FROM public.api_import_runs WHERE id=$1 AND project_id=$2 AND config_id=$3`,
        [retryRunId, projectId, configId]);
      if (!prior) throw new ApiImportError("Import run not found", 404);
      if (!["failed", "partial", "interrupted", "cancelled"].includes(prior.status)) throw new ApiImportError("Only unsuccessful import runs can be retried", 409);
      if (prior.settings.endpoint === config.settings.endpoint && prior.settings.pagination === config.settings.pagination) checkpoint = prior.checkpoint;
    }
    const { rows: [run] } = await client.query(`INSERT INTO public.api_import_runs
      (id,config_id,project_id,config_name,settings,checkpoint,triggered_by,current_url,page_value)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [randomUUID(), configId, projectId, config.settings.name, JSON.stringify(config.settings), JSON.stringify(checkpoint), actor,
        firstImportUrl(config.settings, checkpoint), config.settings.startPage]);
    if (config.settings.intervalMinutes) await client.query(`UPDATE public.api_import_configs SET next_run_at=now()+($2 * interval '1 minute') WHERE id=$1`, [configId, config.settings.intervalMinutes]);
    await client.query("COMMIT");
    return runDto(run);
  } catch (error: any) {
    await client.query("ROLLBACK");
    if (error.code === "23505") throw new ApiImportError("An import is already queued or running for this configuration", 409);
    throw error;
  } finally { client.release(); }
}
export async function listApiImportRuns(projectId: number, limit = 25, offset = 0) {
  const { rows } = await pool.query(`SELECT * FROM public.api_import_runs WHERE project_id=$1 ORDER BY started_at DESC,id DESC LIMIT $2 OFFSET $3`, [projectId, limit, offset]);
  return rows.map(runDto);
}

export function capturedWorkOrder(row: Record<string, any>, openStatus: string) {
  const protectedFields = ["new_system_id", "new_system_reading", "new_system_type", "new_module_id", "new_module_read", "new_module_type",
    "new_gps", "signature_data", "signature_name", "notes", "trouble", "assigned_user_id", "assigned_group_id", "scheduled_at",
    "scheduled_by", "completed_at", "completed_by", "updated_by"];
  return row.status !== openStatus || protectedFields.some(field => row[field] !== null && row[field] !== undefined && row[field] !== "")
    || (Array.isArray(row.attachments) && row.attachments.length > 0);
}
const column = (key: string) => key.replace(/[A-Z]/g, character => `_${character.toLowerCase()}`);
async function hasFiles(project: any, row: any) {
  const projectRoot = path.join(await getProjectFilesPath(), getProjectDirectoryName(project.name, project.id));
  for (const root of [path.join(projectRoot, "Work Orders"), projectRoot]) {
    for (const name of [String(row.customer_wo_id).replace(/[^a-zA-Z0-9._-]/g, "_"), String(row.id)]) {
      try { if ((await fs.readdir(path.join(root, name))).length) return true; }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
  }
  return false;
}
async function writeImportRecord(client: PoolClient, project: any, config: ApiImportSettings, mapped: Record<string, string | null>, rules: ImportRules) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(project.database_name)) throw new ApiImportError("Invalid project database schema name");
  const table = `"${project.database_name}".work_orders`;
  const { rows: [existing] } = await client.query(`SELECT *,updated_at::text row_version FROM ${table} WHERE customer_wo_id=$1 FOR UPDATE`, [mapped.customerWoId]);
  if (existing) {
    if (config.updateMode !== "safe_update") return { action: "skipped", message: "Customer work-order ID already exists (create-only mode)" };
    const version = await client.query(`SELECT 1 FROM public.api_import_versions
      WHERE project_id=$1 AND work_order_id=$2 AND customer_wo_id=$3 AND row_version=$4`,
      [project.id, existing.id, existing.customer_wo_id, existing.row_version]);
    if (!version.rows.length) return { action: "skipped", message: "Work order was not created by API Import or changed outside API Import; protected" };
    const tracking = await client.query(`SELECT 1 FROM public.work_order_time_tracking WHERE project_id=$1 AND system_work_order_id=ANY($2) LIMIT 1`,
      [project.id, [mapped.customerWoId, String(existing.id)]]);
    if (capturedWorkOrder(existing, rules.openStatus) || tracking.rows.length || await hasFiles(project, existing)) {
      return { action: "skipped", message: "Existing work order has field work, notes, assignment, files, scheduling, timing, or a non-Open outcome; protected" };
    }
    const fields = config.updateFields.filter(field => Object.hasOwn(mapped, field) && String(existing[column(field)] ?? "") !== String(mapped[field] ?? ""));
    if (!fields.length) return { action: "skipped", message: "Selected baseline fields are unchanged" };
    const result = await client.query(`UPDATE ${table} SET ${fields.map((field, index) => `"${column(field)}"=$${index + 2}`).join(",")},updated_at=now() WHERE id=$1 RETURNING updated_at::text row_version`,
      [existing.id, ...fields.map(field => mapped[field])]);
    await client.query(`UPDATE public.api_import_versions SET row_version=$3 WHERE project_id=$1 AND work_order_id=$2`,
      [project.id, existing.id, result.rows[0].row_version]);
    return { action: "updated", id: existing.id as number, message: "Updated selected baseline fields on an untouched Open work order" };
  }
  const fields = Object.keys(mapped);
  const result = await client.query(`INSERT INTO ${table} (${fields.map(field => `"${column(field)}"`).join(",")},created_by)
    VALUES (${fields.map((_, index) => `$${index + 1}`).join(",")},NULL) ON CONFLICT(customer_wo_id) DO NOTHING RETURNING id,updated_at::text row_version`,
    fields.map(field => mapped[field]));
  if (result.rows.length) await client.query(`INSERT INTO public.api_import_versions(project_id,work_order_id,customer_wo_id,row_version)
    VALUES($1,$2,$3,$4) ON CONFLICT(project_id,work_order_id) DO UPDATE SET customer_wo_id=EXCLUDED.customer_wo_id,row_version=EXCLUDED.row_version`,
    [project.id, result.rows[0].id, mapped.customerWoId, result.rows[0].row_version]);
  return result.rows.length ? { action: "created", id: result.rows[0].id as number, message: "Created Open work order" } : { action: "skipped", message: "Customer work-order ID was imported concurrently" };
}
async function cancelRun(client: PoolClient, run: any) {
  await client.query(`UPDATE public.api_import_runs SET status='cancelled',completed_at=now(),
    messages=messages || $2::jsonb WHERE id=$1`, [run.id, JSON.stringify([{ action: "cancelled", message: "Configuration disabled/removed or project inactive" }])]);
}
async function processImportPage(client: PoolClient, run: any) {
  const config: ApiImportSettings = run.settings;
  const { rows: [project] } = await client.query(`SELECT p.*,c.settings current_settings FROM public.projects p
    JOIN public.api_import_configs c ON c.project_id=p.id WHERE c.id=$1`, [run.config_id]);
  if (!project?.is_active || !project.current_settings.isEnabled) { await cancelRun(client, run); return; }
  if (run.page_number >= 100 || run.created_count + run.updated_count + run.skipped_count + run.failed_count >= 50000) {
    throw new ImportFetchError("Import safety limit reached (100 pages or 50,000 records); checkpoint was not advanced");
  }
  await client.query(`UPDATE public.api_import_runs SET status='running',heartbeat_at=now(),fetch_attempts=fetch_attempts+1 WHERE id=$1`, [run.id]);
  const { records, body } = await fetchImportPage(config, run.current_url);
  if (run.created_count + run.updated_count + run.skipped_count + run.failed_count + records.length > 50000) {
    throw new ImportFetchError("Import exceeds the 50,000-record safety limit; checkpoint was not advanced");
  }
  const next = nextImportPage(config, body, records, run.current_url, run.page_value);
  const fingerprint = createHash("sha256").update(run.current_url).digest("hex");
  if (run.visited.includes(fingerprint) || (next.url && (next.url === run.current_url || run.visited.includes(createHash("sha256").update(next.url).digest("hex"))))) {
    throw new ImportFetchError("Pagination loop detected; checkpoint was not advanced");
  }
  const rules = await importRules(project.id);
  const counts = { created: 0, updated: 0, skipped: 0, failed: 0 };
  const messages: ImportMessage[] = [...run.messages];
  const events: { action: string; id: number }[] = [];
  await client.query("BEGIN");
  try {
    const current = await client.query(`SELECT c.settings,p.is_active FROM public.api_import_configs c JOIN public.projects p ON p.id=c.project_id
      WHERE c.id=$1 FOR SHARE OF c,p`, [run.config_id]);
    if (!current.rows[0]?.settings.isEnabled || !current.rows[0]?.is_active) {
      await cancelRun(client, run); await client.query("COMMIT"); return;
    }
    for (let i = 0; i < records.length; i++) {
      const { mapped, errors } = mapImportRecord(records[i], config, rules);
      let outcome: { action: string; message: string; id?: number };
      if (errors.length) outcome = { action: "failed", message: errors.join("; ") };
      else {
        await client.query("SAVEPOINT api_import_record");
        try { outcome = await writeImportRecord(client, project, config, mapped, rules); }
        catch (error: any) {
          await client.query("ROLLBACK TO SAVEPOINT api_import_record");
          // No remote values, SQL parameters, or filesystem paths in diagnostics.
          outcome = { action: "failed", message: error instanceof ApiImportError ? error.message : `Record violates project constraints or could not be stored (${error.code || "storage error"})` };
        }
        await client.query("RELEASE SAVEPOINT api_import_record");
      }
      counts[outcome.action as keyof typeof counts]++;
      if (outcome.id) events.push({ action: outcome.action, id: outcome.id });
      if (["failed", "skipped"].includes(outcome.action)) {
        if (outcome.action === "failed" && messages.length >= 100) {
          const skippedIndex = messages.findIndex(message => message.action === "skipped");
          messages.splice(skippedIndex === -1 ? 0 : skippedIndex, 1);
        }
        if (messages.length < 100 && (outcome.action === "failed" || messages.filter(message => message.action === "skipped").length < 50)) messages.push({
          page: run.page_number + 1, row: i + 1, action: outcome.action, message: redactImportMessage(outcome.message, config),
        });
      }
    }
    const failed = run.failed_count + counts.failed;
    const status = next.url ? "queued" : failed ? (run.created_count + counts.created + run.updated_count + counts.updated + run.skipped_count + counts.skipped ? "partial" : "failed") : "succeeded";
    await client.query(`UPDATE public.api_import_runs SET status=$2,current_url=$3,page_number=page_number+1,page_value=page_value+1,
      visited=visited || $4::jsonb,candidate_cursor=COALESCE($5,candidate_cursor),
      created_count=created_count+$6,updated_count=updated_count+$7,skipped_count=skipped_count+$8,failed_count=failed_count+$9,
      messages=$10,page_attempts=0,next_attempt_at=now(),heartbeat_at=now(),completed_at=CASE WHEN $3::text IS NULL THEN now() ELSE NULL END WHERE id=$1`,
      [run.id, status, next.url, JSON.stringify([fingerprint]), next.cursor, counts.created, counts.updated, counts.skipped, counts.failed, JSON.stringify(messages)]);
    if (!next.url && !failed) {
      await client.query(`UPDATE public.api_import_configs SET
        cursor=CASE WHEN $2 THEN COALESCE($3,cursor) ELSE cursor END,
        watermark=CASE WHEN $4 THEN $5::timestamptz ELSE watermark END WHERE id=$1`,
        [run.config_id, config.resumeCursor, next.cursor || run.candidate_cursor || run.checkpoint.cursor, !!config.watermarkParam, run.started_at]);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  for (const event of events) {
    if (event.action === "created") emitWorkOrderCreated(project.id, event.id);
    else emitWorkOrderUpdated(project.id, event.id);
  }
}

/** A session advisory lock fences all workers, even if a HTTP request outlasts recovery thresholds. */
export async function runApiImportWorker(projectId?: number) {
  const client = await pool.connect();
  try {
    const { rows } = await client.query(`SELECT * FROM public.api_import_runs WHERE ($1::int IS NULL OR project_id=$1) AND
      ((status IN ('queued','retrying') AND next_attempt_at<=now()) OR (status='running' AND heartbeat_at<now()-interval '2 minutes'))
      ORDER BY next_attempt_at LIMIT 10`, [projectId ?? null]);
    for (const candidate of rows) {
      const lock = await client.query(`SELECT pg_try_advisory_lock($1,$2) acquired`, [LOCK_NAMESPACE, candidate.config_id]);
      if (!lock.rows[0].acquired) continue;
      try {
        const { rows: [run] } = await client.query(`SELECT * FROM public.api_import_runs WHERE id=$1`, [candidate.id]);
        if (!run || !ACTIVE.includes(run.status)) continue;
        if (run.status !== "running" && new Date(run.next_attempt_at).getTime() > Date.now()) continue;
        if (run.status === "running") {
          await client.query(`UPDATE public.api_import_runs SET status='interrupted',completed_at=now(),
            messages=messages || $2::jsonb WHERE id=$1`, [run.id, JSON.stringify([{ action: "interrupted", message: "Worker stopped before finishing this page. Committed pages remain; retry safely from the original checkpoint." }])]);
          continue;
        }
        try { await processImportPage(client, run); }
        catch (error) {
          const attempts = run.page_attempts + 1;
          const transient = error instanceof ImportFetchError && error.transient && attempts < 4;
          const retrySeconds = error instanceof ImportFetchError && error.retryAfter ? Number(error.retryAfter) : NaN;
          const retryDate = error instanceof ImportFetchError && error.retryAfter ? Date.parse(error.retryAfter) : NaN;
          const delay = Math.min(86400000, Math.max([60000, 300000, 900000][Math.min(attempts - 1, 2)],
            Number.isFinite(retrySeconds) ? retrySeconds * 1000 : Number.isFinite(retryDate) ? retryDate - Date.now() : 0));
          const safe = error instanceof ImportFetchError || error instanceof ApiImportError ? error.message
            : error instanceof Error && /credential|secret|authentication|header/i.test(error.message) ? error.message : "Import worker failed; retry the run after checking server/database availability";
          const messages = [...run.messages, { action: transient ? "retrying" : "failed", page: run.page_number + 1,
            message: redactImportMessage(safe, run.settings) }].slice(-100);
          await client.query(`UPDATE public.api_import_runs SET status=$2,page_attempts=$3,next_attempt_at=$4,messages=$5,
            completed_at=CASE WHEN $2::text='failed' THEN now() ELSE NULL END,heartbeat_at=now() WHERE id=$1`,
            [run.id, transient ? "retrying" : "failed", attempts, new Date(Date.now() + delay), JSON.stringify(messages)]);
        }
      } finally { await client.query(`SELECT pg_advisory_unlock($1,$2)`, [LOCK_NAMESPACE, candidate.config_id]); }
    }
  } finally { client.release(); }
}
export async function scheduleDueApiImports() {
  const { rows } = await pool.query(`SELECT c.id,c.project_id FROM public.api_import_configs c JOIN public.projects p ON p.id=c.project_id
    WHERE (c.settings->>'isEnabled')::boolean=true AND (c.settings->>'intervalMinutes')::int>0 AND p.is_active=true
    AND c.next_run_at<=now() AND NOT EXISTS(SELECT 1 FROM public.api_import_runs r WHERE r.config_id=c.id AND r.status=ANY($1)) LIMIT 20`, [ACTIVE]);
  for (const config of rows) {
    try { await enqueueApiImport(config.project_id, config.id, "scheduled"); }
    catch (error) { if (!(error instanceof ApiImportError)) throw error; }
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
let ticking = false;
export function startApiImportWorker() {
  if (timer) return;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try { await scheduleDueApiImports(); await runApiImportWorker(); }
    catch { console.error("[APIImport] Worker unavailable; queued runs remain persisted for recovery"); }
    finally { ticking = false; }
  };
  timer = setInterval(tick, 3000); timer.unref(); void tick();
}
