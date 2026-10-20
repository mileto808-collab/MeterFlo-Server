import { promises as fs } from "node:fs";
import path from "node:path";
import { minimatch } from "minimatch";
import { pool } from "../db";
import { ensureProjectFtpDirectory, getProjectFtpFiles } from "../fileStorage";
import { withSftp, remoteDirectory, digest, TransferError, readSftpFile } from "./sftp";
import { httpsImportCandidate } from "./https-imports";
export interface ImportCandidate {
  name: string; size: number; modifiedAt: Date; filePath: string; hash: string; identity: string;
  metadata: Record<string, unknown>; httpsFileId?: string; tempDir?: string;
}
export function validateImportPattern(value: unknown, required = false) {
  if ((typeof value !== "string" || !value.trim()) && required) throw new TransferError("SFTP imports require a filename-matching pattern.");
  const pattern = typeof value === "string" && value.trim() ? value.trim() : "*";
  if (pattern.length > 255 || /[/\\\0]/.test(pattern) || pattern.includes("..")) throw new TransferError("Use a filename pattern without a directory path.");
  return pattern;
}
export async function importCandidate(config: any, project: any): Promise<ImportCandidate | null> {
  const remote = config.source === "sftp", pattern = validateImportPattern(config.processedFilePattern, remote || config.source === "https");
  const generated = new Set((await pool.query("SELECT file_name FROM public.file_export_runs WHERE project_id=$1", [project.id])).rows.map(row => row.file_name));
  const receipts = (await pool.query("SELECT content_hash,source_identity FROM public.file_import_receipts WHERE config_id=$1", [config.id])).rows;
  const known = new Set(receipts.map(row => row.content_hash)), seen = new Set(receipts.map(row => row.source_identity));
  if (config.source === "https") return httpsImportCandidate(config, project, pattern, known);
  const folder = await ensureProjectFtpDirectory(project.name, project.id);
  const discover = async (files: any[], read: (file: any) => Promise<Buffer>) => {
    const matches = files.filter(file => file.type !== "d" && !generated.has(file.name) && !file.name.includes("/") && !file.name.includes("\\") &&
      minimatch(file.name, pattern, { nocase: true, dot: false }) && /\.(csv|xlsx?|json)$/i.test(file.name))
      .sort((a, b) => remote ? a.modified - b.modified : b.modified - a.modified);
    for (const file of matches) {
      const identity = JSON.stringify([remote ? config.remoteDirectory : "local", file.name, file.size, file.modified]);
      // Recheck the newest file even with unchanged metadata to catch a replaced file.
      if (seen.has(identity) && file !== matches[remote ? matches.length - 1 : 0]) continue;
      if (file.size > 25 * 1024 * 1024) throw new TransferError("A matching import file exceeds 25 MB.");
      const bytes = await read(file);
      if (bytes.length > 25 * 1024 * 1024) throw new TransferError("A matching import file exceeds 25 MB.");
      const hash = digest(bytes);
      if (known.has(hash)) continue;
      if (!remote && config.lastProcessedFile === file.name && !receipts.length) continue;
      let name = file.name;
      if (remote) {
        const extension = path.extname(name), base = path.basename(name, extension).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 130);
        name = `${base}__sftp_${hash.slice(0, 16)}${extension.toLowerCase()}`;
        const target = path.join(folder, name);
        try { await fs.writeFile(target, bytes, { flag: "wx", mode: 0o600 }); }
        catch (error: any) {
          if (error.code !== "EEXIST") throw error;
          if (digest(await fs.readFile(target)) !== hash) throw new TransferError("A different staged import file already exists.");
        }
      }
      return { name, size: bytes.length, modifiedAt: new Date(file.modified), filePath: path.join(folder, name), hash, identity,
        metadata: { originalName: file.name, source: remote ? "sftp" : "local" } };
    }
    return null;
  };
  if (!remote) {
    const files = (await getProjectFtpFiles(project.name, project.id)).map(file => ({ ...file, modified: new Date(file.modifiedAt).getTime() }));
    return discover(files, file => fs.readFile(path.join(folder, file.name)));
  }
  const directory = remoteDirectory(config.remoteDirectory);
  return withSftp(project.id, async client => {
    const files = (await client.list(directory)).filter(file => file.type === "-").map(file => ({ ...file, modified: file.modifyTime }));
    return discover(files, async file => {
      return readSftpFile(client, path.posix.join(directory, file.name), 25 * 1024 * 1024);
    });
  });
}
export async function rememberImport(configId: number, candidate: NonNullable<Awaited<ReturnType<typeof importCandidate>>>) {
  await pool.query(`INSERT INTO public.file_import_receipts(config_id,content_hash,source_identity,metadata)
    VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(config_id,content_hash) DO NOTHING`, [configId, candidate.hash, candidate.identity, JSON.stringify(candidate.metadata)]);
}
export async function generatedImportId(configId: number, hash: string, rowNumber: number, proposed: string) {
  await pool.query(`INSERT INTO public.file_import_generated_ids(config_id,content_hash,row_number,customer_wo_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(config_id,content_hash,row_number) DO NOTHING`, [configId, hash, rowNumber, proposed]);
  return (await pool.query("SELECT customer_wo_id FROM public.file_import_generated_ids WHERE config_id=$1 AND content_hash=$2 AND row_number=$3", [configId, hash, rowNumber])).rows[0].customer_wo_id as string;
}
