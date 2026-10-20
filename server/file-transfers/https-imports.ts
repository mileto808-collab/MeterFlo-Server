import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { minimatch } from "minimatch";
import { pool } from "../db";
import { exchangeEvent, readExchangeFile, requireExchange } from "./https-service";
import type { ImportCandidate } from "./imports";
export async function httpsImportCandidate(config: any, project: any, pattern: string, known: Set<string>): Promise<ImportCandidate | null> {
  await requireExchange(project.id);
  // Caller holds the shared file-operation advisory lock. No live importer can
  // own a processing row while this caller holds it, so interrupted claims are recoverable.
  await pool.query(`UPDATE public.https_transfer_files SET status='received',message='Interrupted processing recovered for retry.'
    WHERE project_id=$1 AND status='processing'`, [project.id]);
  const rows = (await pool.query(`SELECT * FROM public.https_transfer_files WHERE project_id=$1 AND direction='inbox'
    AND status='received' AND (processing_config_id IS NULL OR processing_config_id=$2) ORDER BY created_at,id`, [project.id, config.id])).rows;
  for (const row of rows) {
    if (!minimatch(row.file_name, pattern, { nocase: true, dot: false })) continue;
    if (known.has(row.sha256)) {
      await pool.query(`UPDATE public.https_transfer_files SET status='processed',processed_at=now(),processing_config_id=$2,
        message='Identical content was already imported successfully by this configuration.' WHERE id=$1`, [row.id, config.id]);
      await exchangeEvent(project.id, "duplicate_skipped", "Identical content already processed; no work orders applied again.", row.id, row.credential_id);
      continue;
    }
    const bytes = await readExchangeFile(row);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-https-import-"));
    const name = row.file_name.replace(/\.[^.]+$/, "") + "__https_" + row.sha256.slice(0, 16) + path.extname(row.file_name).toLowerCase();
    try {
      await fs.writeFile(path.join(folder, name), bytes, { mode: 0o600, flag: "wx" });
      await pool.query(`UPDATE public.https_transfer_files SET status='processing',processing_config_id=$2,
        message='Import processing started.' WHERE id=$1`, [row.id, config.id]);
      return { name, size: bytes.length, modifiedAt: row.created_at, filePath: path.join(folder, name), hash: row.sha256,
        identity: "https:" + row.id, metadata: { originalName: row.file_name, source: "https" }, httpsFileId: row.id, tempDir: folder };
    } catch (error) { await fs.rm(folder, { recursive: true, force: true }); throw error; }
  }
  return null;
}
export async function completeHttpsImport(candidate: ImportCandidate, status: string, message: string) {
  if (!candidate.httpsFileId) return;
  const result = await pool.query(`UPDATE public.https_transfer_files SET status=$2,message=$3,
    processed_at=CASE WHEN $2='processed' THEN now() ELSE NULL END WHERE id=$1 RETURNING project_id,credential_id`,
  [candidate.httpsFileId, status, message.slice(0, 2000)]);
  const row = result.rows[0];
  if (row) await exchangeEvent(row.project_id, status === "processed" ? "import_succeeded" : "import_failed", message.slice(0, 2000), candidate.httpsFileId, row.credential_id);
}
