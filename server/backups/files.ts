import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import type { BackupDestination } from "../../shared/backup-schedules";
import { getProjectFilesPath } from "../fileStorage";

export const BACKUP_DIRECTORY = "meterflo-scheduled-backups";
export class BackupError extends Error { status = 400; }
export function localBackupsAllowed() { return !process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1"; }
function safeId(id: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new BackupError("Invalid backup identifier.");
  return id;
}
export function cloudKey(destination: BackupDestination, id: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9/_-]{0,199}$/.test(destination.path))
    throw new BackupError("Cloud prefixes may contain letters, numbers, /, - and _.");
  return `${destination.path.replace(/\/+$/, "")}/${BACKUP_DIRECTORY}/${safeId(id)}.zip`;
}
async function cloud(destination: BackupDestination) {
  if (!destination.bucketId) throw new BackupError("A private App Storage bucket ID is required.");
  const { Client } = await import("@replit/object-storage");
  return new Client({ bucketId: destination.bucketId });
}
function within(target: string, root: string) {
  const relative = path.relative(root, target);
  return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}
async function directory(destination: BackupDestination, create = false) {
  if (!path.isAbsolute(destination.path)) throw new BackupError("Enter an absolute folder path on this server.");
  const raw = path.resolve(destination.path);
  if (create) await fs.mkdir(raw, { recursive: true, mode: 0o700 });
  const root = await fs.realpath(raw);
  // Services may start with a working directory different from the compiled app.
  const entryDirectory = path.dirname(path.resolve(process.argv[1] || "."));
  for (const blocked of ["public", "dist", "client/public", "server/public", "uploads", "node_modules", ".git", "generated-artifacts",
    path.join(entryDirectory, "public"), await getProjectFilesPath()]) {
    const resolved = await fs.realpath(path.resolve(blocked)).catch(() => path.resolve(blocked));
    if (within(root, resolved)) throw new BackupError("Choose a private backup folder outside application documents, public files, builds and dependencies.");
  }
  const folder = path.join(root, BACKUP_DIRECTORY);
  if (create) await fs.mkdir(folder, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(folder)).isSymbolicLink() || await fs.realpath(folder) !== folder)
    throw new BackupError("The managed backup directory must not be a symbolic link.");
  return folder;
}
async function localFile(destination: BackupDestination, id: string) {
  return path.join(await directory(destination), `${safeId(id)}.zip`);
}
export async function probeDestination(destination: BackupDestination): Promise<BackupDestination> {
  const probe = randomUUID();
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-backup-probe-"));
  const filename = path.join(temp, "probe");
  await fs.writeFile(filename, "MeterFlo backup destination check", { mode: 0o600 });
  try {
    if (destination.kind === "local") {
      if (!localBackupsAllowed()) throw new BackupError("Replit requires durable App Storage; deployment folders are not a persistent backup destination.");
      const folder = await directory(destination, true);
      const target = path.join(folder, `.probe-${probe}`);
      await fs.copyFile(filename, target, 1);
      try { await fs.readFile(target); } finally { await fs.unlink(target); }
      return { ...destination, path: path.dirname(folder) };
    }
    const client = await cloud(destination), key = cloudKey(destination, probe);
    const uploaded = await client.uploadFromFilename(key, filename, { compress: false });
    if (!uploaded.ok) throw new BackupError("App Storage write failed. Check the private bucket ID and service access.");
    try {
      const read = await client.downloadAsText(key);
      if (!read.ok || read.value !== "MeterFlo backup destination check")
        throw new BackupError("App Storage read verification failed.");
    } finally {
      const removed = await client.delete(key, { ignoreNotFound: true });
      if (!removed.ok) throw new BackupError("App Storage delete permission is required for retention.");
    }
    return destination;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
export const backupFiles = {
  async put(destination: BackupDestination, id: string, source: string) {
    if (destination.kind === "local") {
      if (!localBackupsAllowed()) throw new BackupError("Local backup destinations cannot run on Replit.");
      const target = await localFile(destination, id);
      const partial = target + ".partial";
      try {
        await fs.copyFile(source, partial, 1);
        const handle = await fs.open(partial, "r+");
        try { await handle.chmod(0o600); await handle.sync(); } finally { await handle.close(); }
        try {
          await fs.link(partial, target); // atomic, exclusive publication where supported
        } catch (error: any) {
          if (!["ENOTSUP", "EOPNOTSUPP", "EPERM", "EXDEV"].includes(error.code)) throw error;
          // FAT and some Windows/network shares do not support hard links.
          // Exclusive copy still refuses existing identities; downloads remain
          // disabled until the complete file is synced and the run succeeds.
          await fs.copyFile(partial, target, 1);
          const published = await fs.open(target, "r+");
          try { await published.sync(); } finally { await published.close(); }
        }
      } finally { await fs.unlink(partial).catch(() => {}); }
    } else {
      const client = await cloud(destination), key = cloudKey(destination, id);
      const existing = await client.exists(key);
      if (!existing.ok) throw new BackupError("App Storage is unavailable.");
      if (existing.value) throw new BackupError("A backup with this identity already exists; it will not be overwritten.");
      const result = await client.uploadFromFilename(key, source, { compress: false });
      if (!result.ok) throw new BackupError("App Storage upload failed. Check bucket access and retry.");
    }
  },
  async exists(destination: BackupDestination, id: string) {
    if (destination.kind === "local") {
      try { return (await fs.lstat(await localFile(destination, id))).isFile(); }
      catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
    }
    const result = await (await cloud(destination)).exists(cloudKey(destination, id));
    if (!result.ok) throw new BackupError("App Storage is unavailable.");
    return result.value;
  },
  async open(destination: BackupDestination, id: string) {
    if (destination.kind === "local") {
      const filename = await localFile(destination, id);
      if (!(await fs.lstat(filename)).isFile()) throw new BackupError("Backup file is unavailable.");
      const handle = await fs.open(filename, "r");
      return handle.createReadStream();
    }
    return (await cloud(destination)).downloadAsStream(cloudKey(destination, id), { decompress: false });
  },
  async remove(destination: BackupDestination, id: string) {
    if (destination.kind === "local") {
      await fs.unlink(await localFile(destination, id)).catch(error => { if (error.code !== "ENOENT") throw error; });
    } else {
      const result = await (await cloud(destination)).delete(cloudKey(destination, id), { ignoreNotFound: true });
      if (!result.ok) throw new BackupError("App Storage retention cleanup failed.");
    }
  },
};
