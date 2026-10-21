import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { pool } from "./db";
import { getProjectDirectoryName } from "./fileStorage";
import { insertAuditEvent } from "./auditService";
import { auditingEnabled } from "./auditContext";
import { clearRelationalInventory } from "./inventoryRelational";
import { exchangeStore } from "./file-transfers/https-storage";
import { exchangeFolder, projectExchangeResources, purgeProjectAudit, validateProjectObjects,
  type ProjectObject, type ExchangeCleanupStore } from "./projectDeletionResources";

const prefix = "project_deletion_";
const trash = ".meterflo-project-deletions";
const tokenPattern = /^([1-9]\d*)-([a-f0-9-]{36})$/;
type Cleanup = { projectId: number; projectName: string; root: string; token: string; restore?: boolean;
  folders?: string[]; exchange?: boolean; objects?: ProjectObject[] };
export type PendingProjectCleanup = { key: string; projectId: number; projectName: string; restore: boolean };
export class ProjectDeletionCleanupPending extends Error {
  constructor() { super("Project records were deleted, but file cleanup is pending. Retry cleanup on the Projects page."); }
}
type Dependencies = {
  database?: Pick<Pool, "connect">;
  files?: typeof fs;
  exchangeStore?: ExchangeCleanupStore;
};
const keyFor = (job: Cleanup) => `${prefix}${job.token}`;
const projectFolders = (id: number, name: string) => [getProjectDirectoryName(name, id), `inventory-${id}`, `Secure File Exchange/${id}`];
const stagedName = (index: number) => index === 0 ? "files" : `files-${index}`;
const publicJob = (job: Cleanup): PendingProjectCleanup => ({
  key: keyFor(job), projectId: job.projectId, projectName: job.projectName, restore: !!job.restore,
});
function checkedJob(value: string): Cleanup {
  const job = JSON.parse(value) as Cleanup;
  if (!Number.isSafeInteger(job.projectId) || job.projectId <= 0 || job.projectId > 2147483647 || typeof job.projectName !== "string" ||
      typeof job.root !== "string" || !path.isAbsolute(job.root) ||
      !tokenPattern.test(job.token) || Number(job.token.split("-")[0]) !== job.projectId)
    throw new Error("Invalid project file-cleanup record; no files were removed.");
   if (job.folders !== undefined && (!Array.isArray(job.folders) || (!job.folders.length && !job.objects?.length) ||
      job.folders.length > 4 || new Set(job.folders).size !== job.folders.length ||
      job.folders.some(folder => ![...projectFolders(job.projectId, job.projectName), exchangeFolder(job.projectId)].includes(folder))))
    throw new Error("Invalid project folder scope; no files were removed.");
  if (job.objects !== undefined && !validateProjectObjects(job.objects, job.projectId))
    throw new Error("Invalid project object scope; no files were removed.");
  return job;
}
async function putJob(client: PoolClient, job: Cleanup) {
  await client.query(`INSERT INTO public.system_settings(key,value,description)
    VALUES($1,$2,'Pending project file cleanup; retry from Projects')
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value`, [keyFor(job), JSON.stringify(job)]);
}
async function lock(client: PoolClient, id: number) {
  await client.query("SELECT pg_advisory_xact_lock(195378, $1)", [id]);
}
async function exists(files: typeof fs, target: string) {
  try { return await files.lstat(target); }
  catch (error: any) { if (error.code === "ENOENT") return null; throw error; }
}
async function safeCleanupDirectory(files: typeof fs, root: string, token?: string) {
  for (const target of [path.join(root, trash), ...(token ? [path.join(root, trash, token)] : [])]) {
    const stat = await exists(files, target);
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory()))
      throw new Error("Project cleanup path is unsafe; no files were removed.");
  }
}
async function restoreFiles(files: typeof fs, job: Cleanup) {
  await safeCleanupDirectory(files, job.root, job.token);
  const directory = path.join(job.root, trash, job.token);
  const folders = job.folders ?? [getProjectDirectoryName(job.projectName, job.projectId)];
  for (const [index, folder] of folders.entries()) {
    const staged = path.join(directory, stagedName(index));
    if (await exists(files, staged)) {
      const original = path.join(job.root, folder);
      if (await exists(files, original)) throw new Error("Project files need recovery; refusing to overwrite an existing directory.");
      await files.rename(staged, original);
    }
  }
  await files.rm(directory, { recursive: true, force: true });
}

/** SQL, schema and cascade changes commit together. Files are staged reversibly
 * before commit, then removed from an isolated path with a durable retry record. */
export async function deleteProjectCompletely(id: number, filesRoot: string, dependencies: Dependencies = {}): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) throw new Error("Invalid project ID.");
  const database = dependencies.database ?? pool, files = dependencies.files ?? fs;
  const client = await database.connect();
  const stagedJobs: Cleanup[] = [];
  let committed = false;
  let released = false;
  try {
    await client.query("BEGIN");
    await lock(client, id);
    const { rows: [project] } = await client.query("SELECT id,name,database_name FROM public.projects WHERE id=$1 FOR UPDATE", [id]);
    if (!project) { await client.query("ROLLBACK"); return false; }
    const resources = await projectExchangeResources(client, id, filesRoot, dependencies.exchangeStore);
    // Same lock order as inventory enablement/commands; wait for current writers.
    await client.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [id]);
    const schema = project.database_name as string | null;
    if (schema) {
      if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Unsafe project schema name; deletion was cancelled.");
      const shared = await client.query("SELECT id FROM public.projects WHERE left(database_name,63)=left($1,63) AND id<>$2", [schema, id]);
      if (shared.rows.length) throw new Error("Project schema is shared; deletion was cancelled.");
    }
    // Clear nested relational children explicitly: some integrity FKs are
    // deferred NO ACTION, not cascades. Categories must be removed last.
    await clearRelationalInventory(client, id);
    await client.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [id]);
    // The root intentionally has ON DELETE RESTRICT; only explicit project
    // deletion is allowed to remove the complete graph and then this root.
    await client.query("DELETE FROM public.inventory_state WHERE project_id=$1", [id]);
    // Be explicit for upgraded/restored databases whose historical import FK is
    // missing. Delete while parent scope still exists, so capture remains scoped.
    await client.query(`DELETE FROM public.import_history h USING public.import_configs c,public.external_database_configs d
      WHERE h.import_config_id=c.id AND c.external_db_config_id=d.id AND d.project_id=$1`, [id]);
    if (schema) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    if (auditingEnabled) {
      if (schema) await insertAuditEvent(client, { action: "schema.deleted", entityType: "projectSchema", entityId: String(id),
        projectId: id, projectLabel: project.name });
      await client.query("DELETE FROM meterflo_audit.project_scopes WHERE project_id=$1", [id]);
    }
    // Remaining project, import, API, membership, scheduling and dispatch FKs
    // cascade here. Shared users, equipment types and core statuses are retained.
    await client.query("DELETE FROM public.projects WHERE id=$1", [id]);
    const { rows: [ftpSetting] } = await client.query("SELECT value FROM public.system_settings WHERE key='ftp_files_path'");
    const roots = [...new Set([path.resolve(filesRoot), path.resolve(ftpSetting?.value?.trim() || filesRoot)])];
    for (const root of [...new Set([...roots, ...resources.local])]) {
    const folders: string[] = [];
    const exchange = resources.local.includes(root) && !roots.includes(root);
    const candidates = [...(root === path.resolve(filesRoot) ? projectFolders(id, project.name) :
      roots.includes(root) ? [getProjectDirectoryName(project.name, id)] : []),
      ...(resources.local.includes(root) ? [exchangeFolder(id)] : [])];
    for (const folder of candidates) {
      // A namespace's parent must not redirect deletion through a symlink.
      if (folder.includes("/")) {
        const parent = await exists(files, path.dirname(path.join(root, folder)));
        if (parent?.isSymbolicLink()) throw new Error("Project exchange parent is unsafe; deletion was cancelled.");
      }
      const stat = await exists(files, path.join(root, folder));
      if (!stat) continue;
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Project directory is not a regular directory; deletion was cancelled.");
      folders.push(folder);
    }
    const objects = root === path.resolve(filesRoot) ? resources.objects : [];
    if (folders.length || objects.length) {
      const parent = await exists(files, path.join(root, trash));
      if (parent && (parent.isSymbolicLink() || !parent.isDirectory()))
        throw new Error("Project cleanup directory is unsafe; deletion was cancelled.");
      const staged: Cleanup = { projectId: id, projectName: project.name, root, token: `${id}-${randomUUID()}`,
        folders, ...(exchange ? { exchange: true } : {}), ...(objects.length ? { objects } : {}) };
      stagedJobs.push(staged);
      const directory = path.join(root, trash, staged.token);
      await files.mkdir(directory, { recursive: true, mode: 0o700 });
      // A journal also permits recovery after process termination before COMMIT.
      await files.writeFile(path.join(directory, "manifest.json"), JSON.stringify(staged), { flag: "wx", mode: 0o600 });
      for (const [index, folder] of folders.entries())
        await files.rename(path.join(root, folder), path.join(directory, stagedName(index)));
      await putJob(client, staged);
    }
    }
    if (auditingEnabled) await purgeProjectAudit(client, id);
    await client.query("COMMIT");
    committed = true;
  } catch (error) {
    const rolledBack = await client.query("ROLLBACK").then(() => true, () => false);
    client.release(!rolledBack); released = true;
    if (stagedJobs.length) {
      // COMMIT can fail after the server committed. Check authoritative state;
      // never restore deleted files into a project whose deletion committed.
      const probe = await database.connect();
      try {
        await probe.query("BEGIN"); await lock(probe, id);
        const { rows } = await probe.query("SELECT id FROM public.projects WHERE id=$1 FOR UPDATE", [id]);
        for (const staged of stagedJobs) {
        if (rows.length) {
          try { await restoreFiles(files, staged); }
          catch { await putJob(probe, { ...staged, restore: true }); }
        } else {
          await putJob(probe, staged);
          committed = true;
        }
        }
        await probe.query("COMMIT");
      } catch (recoveryError) {
        await probe.query("ROLLBACK").catch(() => {});
        throw new Error("Project deletion outcome needs recovery. Refresh Projects to recover the file journal.", { cause: recoveryError });
      } finally { probe.release(); }
    }
    if (!committed) throw error;
  } finally { if (!released) client.release(); }
  for (const staged of stagedJobs) {
    try { await retryProjectFileCleanup(keyFor(staged), dependencies); }
    catch { throw new ProjectDeletionCleanupPending(); }
  }
  return true;
}

export async function retryProjectFileCleanup(key: string, dependencies: Dependencies = {}): Promise<boolean> {
  if (!key.startsWith(prefix) || !tokenPattern.test(key.slice(prefix.length))) throw new Error("Invalid cleanup ID.");
  const client = await (dependencies.database ?? pool).connect(), files = dependencies.files ?? fs;
  try {
    await client.query("BEGIN");
    await lock(client, Number(key.slice(prefix.length).split("-")[0]));
    const { rows: [row] } = await client.query("SELECT value FROM public.system_settings WHERE key=$1 FOR UPDATE", [key]);
    if (!row) { await client.query("ROLLBACK"); return false; }
    const job = checkedJob(row.value);
    if (keyFor(job) !== key) throw new Error("Cleanup identity mismatch.");
    await safeCleanupDirectory(files, job.root, job.token);
    if (job.restore) {
      const { rows } = await client.query("SELECT id FROM public.projects WHERE id=$1 FOR UPDATE", [job.projectId]);
      if (!rows.length) throw new Error("File recovery requires an existing project; no files were removed.");
      await restoreFiles(files, job);
    } else {
      for (const object of job.objects ?? []) await (dependencies.exchangeStore ?? exchangeStore).remove(object, object.key);
      await files.rm(path.join(job.root, trash, job.token), { recursive: true, force: true });
    }
    await client.query("DELETE FROM public.system_settings WHERE key=$1", [key]);
    // Only the old journal's events: a portable restore can reuse the project ID.
    if (auditingEnabled) {
      await client.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
      await client.query("DELETE FROM meterflo_audit.events WHERE entity_type='system_settings' AND entity_id=$1", [key]);
      await client.query("SELECT set_config('meterflo.audit_retention','',true)");
    }
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }
}

/** Recover only this application's journal format under the configured root.
 * Row/advisory locks prevent recovery from racing an in-progress deletion. */
export async function pendingProjectFileCleanups(filesRoot: string, dependencies: Dependencies = {}): Promise<PendingProjectCleanup[]> {
  const database = dependencies.database ?? pool, files = dependencies.files ?? fs;
  const settingsClient = await database.connect();
  let ftpRoot: string | undefined;
  let exchangeRoots: string[] = [];
  try {
    ftpRoot = (await settingsClient.query("SELECT value FROM public.system_settings WHERE key='ftp_files_path'")).rows[0]?.value;
    exchangeRoots = (await settingsClient.query(`SELECT location FROM public.https_transfer_settings WHERE provider='local'
      UNION SELECT location FROM public.https_transfer_files WHERE provider='local'`)).rows.map(row => row.location);
  }
  finally { settingsClient.release(); }
  for (const root of new Set([path.resolve(filesRoot), path.resolve(ftpRoot?.trim() || filesRoot),
    ...exchangeRoots.filter(root => typeof root === "string" && path.isAbsolute(root))])) {
  await safeCleanupDirectory(files, root);
  let entries: string[] = [];
  try { entries = await files.readdir(path.join(root, trash)); }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  for (const token of entries.filter(name => tokenPattern.test(name))) {
    const client = await database.connect();
    try {
      await client.query("BEGIN"); await lock(client, Number(token.split("-")[0]));
      const { rows: existing } = await client.query("SELECT key FROM public.system_settings WHERE key=$1", [prefix + token]);
      if (!existing.length) {
        await safeCleanupDirectory(files, root, token);
        let job: Cleanup | undefined;
        try { job = checkedJob(await files.readFile(path.join(root, trash, token, "manifest.json"), "utf8")); }
        catch (error: any) { if (error.code !== "ENOENT") throw error; }
        if (job && job.root === root && job.token === token) {
          const { rows } = await client.query("SELECT id FROM public.projects WHERE id=$1 FOR UPDATE", [job.projectId]);
          if (rows.length) {
            try { await restoreFiles(files, job); }
            catch { await putJob(client, { ...job, restore: true }); }
          } else await putJob(client, job);
        }
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
    finally { client.release(); }
  }
  }
  const client = await database.connect();
  try {
    const { rows } = await client.query("SELECT value FROM public.system_settings WHERE starts_with(key,$1) ORDER BY key", [prefix]);
    return rows.map(row => publicJob(checkedJob(row.value)));
  } finally { client.release(); }
}
