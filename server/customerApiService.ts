import { randomUUID } from "crypto";
import { inventoryCategoryLabels } from "../shared/inventory-categories";
import path from "path";
import type { PoolClient } from "pg";
import { pool } from "./db";
import { CUSTOMER_API_SCHEMA_SQL } from "./customerApiSchema";
import { buildCustomerPayload, customerAuthHeaders, readDeliveryPhotos, retryDelay } from "./customerApiPayload";
import { getProjectFilesPath, getProjectDirectoryName } from "./fileStorage";

export async function initializeCustomerApi() {
  await pool.query(CUSTOMER_API_SCHEMA_SQL);
}

/** The caller's transaction includes both the work-order update and the outbox insert. */
export async function enqueueCustomerDelivery(client: PoolClient, schemaName: string, row: Record<string, any>, versionKey?: string) {
  const { rows: [project] } = await client.query(
    `SELECT id, customer_api_enabled, inventory_enabled FROM public.projects WHERE database_name = $1`, [schemaName]);
  if (!project?.customer_api_enabled) return;
  const { rows: statuses } = await client.query(
    `SELECT code, label FROM public.work_order_statuses WHERE lower(code) = lower($1)`, [row.status]);
  const status = `${row.status} ${statuses[0]?.label ?? ""}`.toLowerCase();
  if (!/\bcompleted\b|\btrouble\b|\bunable\b/.test(status)) return;
  const version = versionKey ?? String(row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at);
  if (project.inventory_enabled) {
    const { rows: [inventory] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [project.id]);
    if (inventory) inventory.state = inventoryCategoryLabels(inventory.state);
    const allocation = inventory?.state.allocations.find((a: any) => a.workOrderId === row.id);
    row = { ...row, inventory: { contractVersion: 1, allocation: allocation || null,
      items: inventory?.state.items.filter((i: any) => [...(allocation?.lines || []), ...(allocation?.used || [])].some((l: any) => l.itemId === i.id)) || [] } };
  }
  await client.query(
    `INSERT INTO public.customer_api_deliveries
     (id, project_id, work_order_id, customer_wo_id, version_key, snapshot, next_attempt_at)
     VALUES ($1,$2,$3,$4,$5,$6,now() + interval '5 seconds')
     ON CONFLICT (project_id,work_order_id,version_key) DO NOTHING`,
    [randomUUID(), project.id, row.id, row.customer_wo_id, version, JSON.stringify(row)]);
}

async function snapshotPayload(job: any, project: any) {
  const payload: Record<string, any> = buildCustomerPayload(job.snapshot, project, job.id);
  payload.deliveryCreatedAt = job.created_at;
  const { rows: [tracking] } = await pool.query(
    `SELECT start_time, end_time FROM public.work_order_time_tracking
     WHERE project_id=$1 AND system_work_order_id=$2 ORDER BY created_at DESC LIMIT 1`,
    [job.project_id, job.customer_wo_id || String(job.work_order_id)]);
  payload.timeTracking = tracking ? {
    startTime: tracking.start_time, endTime: tracking.end_time,
    durationSeconds: Math.max(0, (new Date(tracking.end_time).getTime() - new Date(tracking.start_time).getTime()) / 1000),
  } : null;
  if (project.customer_api_send_photos) {
    const folderName = job.customer_wo_id || String(job.work_order_id);
    // Legacy identifiers must not escape the configured project's work-order folder.
    if (/[\\/]/.test(folderName) || folderName === "..") throw new Error("Unsafe work-order attachment folder identifier");
    const folder = path.join(await getProjectFilesPath(), getProjectDirectoryName(project.name, project.id), "Work Orders", folderName);
    payload.photos = await readDeliveryPhotos(folder);
    for (const [type, key] of [["before", "beforePhoto"], ["after", "afterPhoto"], ["signature", "signature"]]) {
      const found = payload.photos.find((photo: any) => photo.type === type);
      if (found) payload[key] = found.data;
    }
    if (!payload.signature && job.snapshot.signature_data) {
      payload.signature = String(job.snapshot.signature_data).replace(/^data:[^,]*,/, "");
    }
  }
  return JSON.stringify(payload);
}

async function boundedResponse(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  let bytes = 0;
  const buffers: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = 65536 - bytes;
      buffers.push(next.value.subarray(0, remaining));
      bytes += next.value.length;
      if (bytes > 65536) { await reader.cancel(); break; }
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(buffers).toString("utf8") + (bytes > 65536 ? "\n[Response truncated at 64 KiB]" : "");
}

function safeRequestUrl(value: string) {
  try {
    const url = new URL(value);
    url.username = ""; url.password = "";
    for (const key of Array.from(url.searchParams.keys())) url.searchParams.set(key, "[redacted]");
    return url.toString();
  } catch { return "Invalid or missing URL"; }
}

function redactCredentials(value: string | null, config: any) {
  if (!value) return value;
  const secret = process.env[config.customer_api_secret_env_var];
  if (!secret) return value;
  for (const token of [secret, Buffer.from(secret).toString("base64")]) value = value.split(token).join("[redacted]");
  return value;
}

async function processDelivery(job: any) {
  const { rows: [project] } = await pool.query(`SELECT * FROM public.projects WHERE id=$1`, [job.project_id]);
  if (!project) return;
  if (!project.customer_api_enabled) {
    await pool.query(`UPDATE public.customer_api_deliveries SET status='paused', next_attempt_at=now()+interval '1 minute',
      locked_at=NULL, lock_token=NULL, updated_at=now() WHERE id=$1 AND lock_token=$2`, [job.id, job.lock_token]);
    return;
  }
  let payload = job.payload;
  let url = project.customer_api_url || "";
  let status: number | null = null;
  let body: string | null = null;
  let error: string | null = null;
  let retryAfter: string | null = null;
  let success = false;
  try {
    const endpoint = new URL(url);
    if (!["http:", "https:"].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
      throw new Error("Customer API URL must be HTTP(S) without embedded credentials");
    }
    const headers = customerAuthHeaders(project, process.env);
    headers["Idempotency-Key"] = job.id;
    headers["X-MeterFlo-Delivery-Id"] = job.id;
    if (!payload) {
      payload = await snapshotPayload(job, project);
      await pool.query(`UPDATE public.customer_api_deliveries SET payload=$2 WHERE id=$1 AND lock_token=$3`,
        [job.id, payload, job.lock_token]);
    }
    const response = await fetch(url, {
      method: "POST", headers, body: payload, redirect: "error", signal: AbortSignal.timeout(30_000),
    });
    status = response.status;
    retryAfter = response.headers.get("retry-after");
    body = await boundedResponse(response);
    success = response.ok;
    if (!success) error = `HTTP ${response.status}: ${response.statusText}`;
  } catch (failure) {
    error = failure instanceof Error ? failure.message : "Customer API delivery failed";
  }
  const attempt = job.attempt_count + 1;
  const cycleAttempt = job.cycle_attempts + 1;
  const nextStatus = success ? "delivered" : cycleAttempt >= 5 ? "failed" : "retrying";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rowCount } = await client.query(
      `UPDATE public.customer_api_deliveries SET status=$3::varchar, attempt_count=$4, cycle_attempts=$5,
       next_attempt_at=$6, last_error=$7, last_response_status=$8,
       delivered_at=CASE WHEN $3::varchar='delivered' THEN now() ELSE NULL END,
       requested_by=NULL, locked_at=NULL, lock_token=NULL, updated_at=now()
       WHERE id=$1 AND lock_token=$2`,
      [job.id, job.lock_token, nextStatus, attempt, cycleAttempt,
        new Date(Date.now() + retryDelay(cycleAttempt, retryAfter)), error, status]);
    if (rowCount) {
      await client.query(
        `INSERT INTO public.customer_api_logs
        (project_id,work_order_id,customer_wo_id,request_url,request_method,request_payload,
         response_status,response_body,success,error_message,retry_count,delivery_id,attempt_number,triggered_by)
        VALUES ($1,$2,$3,$4,'POST',$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [job.project_id, job.work_order_id, job.customer_wo_id, safeRequestUrl(url), payload,
          status, redactCredentials(body, project), success, redactCredentials(error, project), attempt - 1,
          job.id, attempt, job.requested_by ? `manual:${job.requested_by}` : "automatic"]);
    }
    await client.query("COMMIT");
  } catch (failure) {
    await client.query("ROLLBACK");
    throw failure;
  } finally { client.release(); }
}

/** SKIP LOCKED + expiring claim token prevents overlapping workers/manual retries. */
export async function runCustomerApiWorker(projectId?: number) {
  for (let i = 0; i < 5; i++) {
    const { rows: [job] } = await pool.query(
      `UPDATE public.customer_api_deliveries SET status='processing', locked_at=now(), lock_token=$1, updated_at=now()
       WHERE id=(SELECT d.id FROM public.customer_api_deliveries d
         WHERE ($2::int IS NULL OR d.project_id=$2)
           AND ((d.status IN ('pending','retrying','paused') AND d.next_attempt_at<=now())
             OR (d.status='processing' AND d.locked_at<now()-interval '2 minutes'))
           AND NOT EXISTS (SELECT 1 FROM public.customer_api_deliveries older
             WHERE older.project_id=d.project_id AND older.work_order_id=d.work_order_id
               AND older.status IN ('pending','retrying','processing','paused')
               AND (older.created_at,older.id)<(d.created_at,d.id))
         ORDER BY d.next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING *`, [randomUUID(), projectId ?? null]);
    if (!job) return;
    await processDelivery(job);
  }
}

let workerTimer: ReturnType<typeof setInterval> | undefined;
let running = false;
export function startCustomerApiWorker() {
  if (workerTimer) return;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runCustomerApiWorker(); }
    catch (error) { console.error("[CustomerAPI] Queue worker failed; delivery will be recovered:", error); }
    finally { running = false; }
  };
  workerTimer = setInterval(tick, 5_000);
  workerTimer.unref();
  void tick();
}

export async function retryCustomerDelivery(id: string, actorId: string) {
  const { rows: [row] } = await pool.query(
    `UPDATE public.customer_api_deliveries d SET status='pending', cycle_attempts=0, next_attempt_at=now(),
     requested_by=$2, last_error=NULL, updated_at=now()
     FROM public.projects p WHERE d.id=$1 AND p.id=d.project_id AND p.customer_api_enabled=true
       AND d.status IN ('failed','retrying','paused') RETURNING d.*`, [id, actorId]);
  return row;
}

/** Historical fire-and-forget failures are only replayed after explicit admin action. */
export async function retryLegacyCustomerLog(logId: number, actorId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: [log] } = await client.query(
      `SELECT l.*,p.customer_api_enabled,p.name AS project_name FROM public.customer_api_logs l
       JOIN public.projects p ON p.id=l.project_id WHERE l.id=$1 FOR UPDATE OF l`, [logId]);
    if (!log) throw new Error("Log entry not found");
    if (log.success || log.delivery_id) throw new Error("Only failed legacy log entries can be replayed");
    if (!log.customer_api_enabled) throw new Error("Enable this project's Customer API before retrying");
    if (!log.request_payload) throw new Error("This log has no saved payload to replay");
    const original = JSON.parse(log.request_payload);
    if (!original || typeof original !== "object" || Array.isArray(original)) throw new Error("Saved payload is not a JSON object");
    const id = randomUUID();
    const payload = original.workOrderId != null ? original :
      buildCustomerPayload(original, { id: log.project_id, name: log.project_name }, id);
    await client.query(
      `INSERT INTO public.customer_api_deliveries (id,project_id,work_order_id,customer_wo_id,version_key,snapshot,payload,requested_by,attempt_count)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,1)`,
      [id,log.project_id,log.work_order_id,log.customer_wo_id,`legacy-log:${log.id}`,JSON.stringify(original),JSON.stringify(payload),actorId]);
    await client.query(`UPDATE public.customer_api_logs SET delivery_id=$2,attempt_number=1,triggered_by='legacy' WHERE id=$1`, [log.id,id]);
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}
