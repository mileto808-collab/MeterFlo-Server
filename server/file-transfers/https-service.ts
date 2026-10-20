import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { pool } from "../db";
import { storage } from "../storage";
import { httpsCredentialInput, httpsSettingsInput, type HttpsCredential, type HttpsFile } from "../../shared/https-transfers";
import { defaultExchangeRef, exchangeProvider, exchangeStore, type ExchangeRef } from "./https-storage";
import { digest, TransferError } from "./sftp";
export async function exchangeSettings(projectId: number) {
  const row = (await pool.query("SELECT * FROM public.https_transfer_settings WHERE project_id=$1", [projectId])).rows[0];
  const ref = row || await defaultExchangeRef(projectId);
  return { enabled: !!row?.enabled, provider: ref.provider as ExchangeRef["provider"], location: ref.location,
    retentionDays: row?.retention_days || 30 };
}
export async function requireExchange(projectId: number) {
  const settings = await exchangeSettings(projectId);
  if (!settings.enabled) throw new TransferError("HTTPS file exchange is disabled for this project.", 409);
  if (settings.provider !== exchangeProvider()) throw new TransferError("Reconfigure HTTPS storage for this instance before enabling transfers.", 409);
  const project = await storage.getProject(projectId);
  if (!project || project.isActive === false) throw new TransferError("Project is inactive or unavailable.", 403);
  return settings;
}
export async function exchangeEvent(projectId: number, action: string, message: string, fileId?: string, credentialId?: string, executor: any = pool) {
  await executor.query(`INSERT INTO public.https_transfer_events(id,project_id,action,message,file_id,credential_id)
    VALUES($1,$2,$3,$4,$5,$6)`, [randomUUID(), projectId, action, message, fileId || null, credentialId || null]);
}
export function credentialPublic(row: any): HttpsCredential {
  return { id: row.id, name: row.name, canUpload: row.can_upload, canDownload: row.can_download, tokenPrefix: row.token_prefix,
    expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at, lastUsedAt: row.last_used_at };
}
export function filePublic(row: any): HttpsFile {
  return { id: row.id, direction: row.direction, fileName: row.file_name, size: Number(row.size), sha256: row.sha256,
    status: row.status, message: row.message, credentialName: row.credential_name || null, exportRunId: row.export_run_id,
    createdAt: row.created_at, processedAt: row.processed_at, acknowledgedAt: row.acknowledged_at };
}
export async function saveExchangeSettings(projectId: number, input: unknown) {
  const data = httpsSettingsInput.parse(input), fallback = await defaultExchangeRef(projectId);
  const ref = { provider: fallback.provider, location: data.location || fallback.location };
  if (data.enabled) await exchangeStore.check(ref, projectId);
  await pool.query(`INSERT INTO public.https_transfer_settings(project_id,enabled,provider,location,retention_days)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(project_id) DO UPDATE SET enabled=EXCLUDED.enabled,provider=EXCLUDED.provider,
    location=EXCLUDED.location,retention_days=EXCLUDED.retention_days,updated_at=now()`,
  [projectId, data.enabled, ref.provider, ref.location, data.retentionDays]);
  await exchangeEvent(projectId, "settings_saved", data.enabled ? "HTTPS exchange enabled; storage write/read/delete verified." : "HTTPS exchange disabled.");
  return exchangeSettings(projectId);
}
export async function issueCredential(projectId: number, input: unknown, rotateId?: string) {
  const data = httpsCredentialInput.parse(input), id = rotateId || randomUUID();
  const secret = randomBytes(32).toString("base64url"), token = `mft_${id}.${secret}`;
  let result;
  if (rotateId) {
    result = await pool.query(`UPDATE public.https_transfer_credentials SET token_hash=$3,token_prefix=$4,expires_at=now()+($5*interval '1 day'),
      last_used_at=null WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL RETURNING *`,
    [id, projectId, digest(Buffer.from(token)), token.slice(0, 12), data.expiresInDays]);
    if (!result.rowCount) throw new TransferError("Active transfer credential not found.", 404);
  } else result = await pool.query(`INSERT INTO public.https_transfer_credentials
    (id,project_id,name,token_hash,token_prefix,can_upload,can_download,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,now()+($8*interval '1 day')) RETURNING *`,
  [id, projectId, data.name, digest(Buffer.from(token)), token.slice(0, 12), data.canUpload, data.canDownload, data.expiresInDays]);
  await exchangeEvent(projectId, rotateId ? "credential_rotated" : "credential_created", "Project transfer credential " + (rotateId ? "rotated." : "created."), undefined, id);
  return { credential: credentialPublic(result.rows[0]), token };
}
export async function authenticateExchange(projectId: number, authorization: string | undefined, scope: "upload" | "download") {
  const match = /^Bearer (mft_([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\.[A-Za-z0-9_-]{43})$/.exec(authorization || "");
  if (!match) throw new TransferError("Valid transfer credentials required.", 401);
  const row = (await pool.query(`SELECT * FROM public.https_transfer_credentials
    WHERE id=$1 AND project_id=$2 AND revoked_at IS NULL AND expires_at>now()`, [match[2], projectId])).rows[0];
  const actual = digest(Buffer.from(match[1])), expected = row?.token_hash || "0".repeat(64);
  if (!timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex")) || !row) throw new TransferError("Valid transfer credentials required.", 401);
  if (!row[scope === "upload" ? "can_upload" : "can_download"]) throw new TransferError("Transfer credential does not allow this operation.", 403);
  if ((await pool.query("SELECT 1 FROM public.access_locks WHERE locked=true AND (project_id IS NULL OR project_id=$1)", [projectId])).rowCount)
    throw new TransferError("Project access is locked.", 423);
  await requireExchange(projectId);
  await pool.query("UPDATE public.https_transfer_credentials SET last_used_at=now() WHERE id=$1", [row.id]);
  return row;
}
export function incomingName(value: unknown) {
  if (typeof value !== "string" || value.length > 180 || !/^[A-Za-z0-9][A-Za-z0-9._ -]*\.(csv|xlsx?|json)$/i.test(value) || value.includes(".."))
    throw new TransferError("Use a CSV, XLS, XLSX or JSON filename with letters, numbers, spaces, underscores, dots or hyphens.");
  return value;
}
export async function receiveUpload(projectId: number, credential: any, filename: string, key: string, bytes: Buffer, checksum?: string) {
  incomingName(filename);
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key || "")) throw new TransferError("Provide an Idempotency-Key of 8–128 letters, numbers, underscores or hyphens.");
  if (!bytes.length || bytes.length > 25 * 1024 * 1024) throw new TransferError("Upload must contain 1 byte to 25 MB.", 413);
  const sha256 = digest(bytes);
  if (checksum && (!/^[a-f0-9]{64}$/i.test(checksum) || checksum.toLowerCase() !== sha256)) throw new TransferError("File SHA256 checksum does not match.", 422);
  const previous = (await pool.query("SELECT * FROM public.https_transfer_files WHERE credential_id=$1 AND idempotency_key=$2", [credential.id, key])).rows[0];
  if (previous) {
    if (previous.sha256 !== sha256 || previous.file_name !== filename) throw new TransferError("This Idempotency-Key belongs to a different file. Use the original file or a new key.", 409);
    return { file: filePublic(previous), duplicate: true };
  }
  const settings = await requireExchange(projectId), id = randomUUID(), storageKey = `meterflo-exchange/${projectId}/${id}.bin`;
  await exchangeStore.put(settings, storageKey, bytes);
  const client = await pool.connect(); let committing = false;
  try {
    await client.query("BEGIN");
    const result = await client.query(`INSERT INTO public.https_transfer_files
      (id,project_id,direction,credential_id,file_name,size,sha256,idempotency_key,provider,location,storage_key,status,message)
      VALUES($1,$2,'inbox',$3,$4,$5,$6,$7,$8,$9,$10,'received','File received; awaiting a matching HTTPS import configuration.')
      RETURNING *`, [id, projectId, credential.id, filename, bytes.length, sha256, key, settings.provider, settings.location, storageKey]);
    await exchangeEvent(projectId, "file_received", "Complete upload received and checksum recorded; not yet imported.", id, credential.id, client);
    committing = true; await client.query("COMMIT");
    return { file: filePublic(result.rows[0]), duplicate: false };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    // A lost COMMIT acknowledgement must never delete possibly committed bytes.
    if (!committing) await exchangeStore.remove(settings, storageKey).catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function readExchangeFile(row: any) {
  if (["expired", "deleted"].includes(row.status)) throw new TransferError("File content has expired or been deleted. Transfer history is retained.", 410);
  const bytes = await exchangeStore.read(row, row.storage_key);
  if (Number(row.size) !== bytes.length || digest(bytes) !== row.sha256) throw new TransferError("Stored file failed integrity verification.", 503);
  return bytes;
}
export async function publishHttpsExport(run: any, bytes: Buffer) {
  const previous = (await pool.query("SELECT * FROM public.https_transfer_files WHERE export_run_id=$1", [run.id])).rows[0];
  if (previous) {
    if (["deleted", "expired"].includes(previous.status)) throw new TransferError("The previously published export was removed. Cancel the pending run and create a new export.", 409);
    if (previous.sha256 !== digest(bytes)) throw new TransferError("Published export content differs from this retry.", 409);
    return;
  }
  const settings = await requireExchange(run.project_id), id = randomUUID(), key = `meterflo-exchange/${run.project_id}/${id}.bin`;
  await exchangeStore.put(settings, key, bytes);
  const client = await pool.connect(); let committing = false;
  try {
    await client.query("BEGIN");
    await client.query(`INSERT INTO public.https_transfer_files
      (id,project_id,direction,file_name,size,sha256,export_run_id,provider,location,storage_key,status,message)
      VALUES($1,$2,'outbox',$3,$4,$5,$6,$7,$8,$9,'available','Export available for customer download; not yet acknowledged.')`,
    [id, run.project_id, run.file_name, bytes.length, digest(bytes), run.id, settings.provider, settings.location, key]);
    await exchangeEvent(run.project_id, "export_available", "Generated export published to HTTPS outbox.", id, undefined, client);
    committing = true; await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (!committing) await exchangeStore.remove(settings, key).catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function expireExchangeFiles() {
  const rows = (await pool.query(`SELECT f.* FROM public.https_transfer_files f JOIN public.https_transfer_settings s ON s.project_id=f.project_id
    WHERE s.enabled AND ((f.status='processed' AND f.processed_at<now()-(s.retention_days*interval '1 day'))
      OR(f.status='acknowledged' AND f.acknowledged_at<now()-(s.retention_days*interval '1 day')))
    ORDER BY f.created_at LIMIT 100`)).rows;
  for (const row of rows) {
    try {
      await exchangeStore.remove(row, row.storage_key);
      await pool.query("UPDATE public.https_transfer_files SET status='expired',message='Content expired under the retention policy; history retained.' WHERE id=$1", [row.id]);
      await exchangeEvent(row.project_id, "file_expired", "Processed or acknowledged content removed under the retention policy.", row.id);
    } catch {
      await exchangeEvent(row.project_id, "retention_failed", "Retention cleanup failed. Content and metadata retained for another attempt; check storage access.", row.id);
    }
  }
}
