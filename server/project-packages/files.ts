import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { getProjectFilesPath, getFtpFilesPath, getProjectDirectoryName } from "../fileStorage";
import { exchangeStore, defaultExchangeRef, type ExchangeRef } from "../file-transfers/https-storage";
import type { PoolClient } from "pg";

export type PackageFile = { path: string; size: number; sha256: string; kind?: string; relative?: string; ref?: ExchangeRef; key?: string };
export const safeRelative = (name: string) => typeof name === "string" && !!name && !name.includes("\\") && !name.includes("\0") &&
  !name.startsWith("/") && name.split("/").every(part => !!part && part !== "." && part !== ".." && !/[:<>\"|?*\x00-\x1f]|[. ]$/.test(part) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part));
export async function digest(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}
async function walk(root: string, exclude?: string, sub = ""): Promise<{ relative: string; size: number; stamp: string }[]> {
  let entries;
  try {
    const stat = await fs.lstat(path.join(root, sub));
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Project backup refuses linked or non-directory storage.");
    entries = await fs.readdir(path.join(root, sub), { withFileTypes: true });
  } catch (error: any) { if (error.code === "ENOENT" && !sub) return []; throw error; }
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!sub && entry.name === exclude) continue;
    const relative = sub ? `${sub}/${entry.name}` : entry.name;
    if (!safeRelative(relative) || entry.isSymbolicLink()) throw new Error("Unsafe or linked project file; backup was cancelled.");
    if (entry.isDirectory()) result.push(...await walk(root, exclude, relative));
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, relative));
      result.push({ relative, size: stat.size, stamp: `${stat.size}:${stat.mtimeMs}:${stat.ino}` });
    } else throw new Error("Unsupported project file type.");
  }
  return result;
}
export async function captureFiles(client: PoolClient, project: any, directory: string) {
  const root = path.resolve(await getProjectFilesPath()), ftp = path.resolve(await getFtpFilesPath());
  const folder = getProjectDirectoryName(project.name, project.id);
  const roots = { documents: path.join(root, folder), ftp: path.join(ftp, folder, "Project FTP Files"), inventory: path.join(root, `inventory-${project.id}`) };
  const files: PackageFile[] = [], inventories = [];
  for (const [kind, source] of Object.entries(roots)) {
    const before = await walk(source, kind === "documents" && path.relative(roots.documents, roots.ftp) === "Project FTP Files" ? "Project FTP Files" : undefined);
    for (const entry of before) {
      const name = `files/${kind}/${entry.relative}`, target = path.join(directory, name);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.copyFile(path.join(source, entry.relative), target);
      if ((await fs.stat(target)).size !== entry.size) throw new Error("Project files changed during backup. Please retry.");
      files.push({ path: name, kind, relative: entry.relative, size: entry.size, sha256: await digest(target) });
    }
    inventories.push({ kind, source, before });
  }
  const refs = await client.query(`SELECT provider,location FROM public.https_transfer_settings WHERE project_id=$1
    UNION SELECT provider,location FROM public.https_transfer_files WHERE project_id=$1`, [project.id]);
  for (const ref of refs.rows as ExchangeRef[]) {
    const recorded = await client.query("SELECT storage_key FROM public.https_transfer_files WHERE project_id=$1 AND provider=$2 AND location=$3",
      [project.id, ref.provider, ref.location]);
    const keys = new Set<string>(recorded.rows.map(row => row.storage_key));
    for (const key of await exchangeStore.projectKeys(ref, project.id)) keys.add(key);
    if (ref.provider === "local") {
      const local = await walk(path.join(ref.location, "meterflo-exchange", String(project.id)));
      for (const entry of local) keys.add(`meterflo-exchange/${project.id}/${entry.relative}`);
    }
    for (const key of keys) {
      if (!new RegExp(`^meterflo-exchange/${project.id}/[a-f0-9-]{36}\\.bin$`).test(key)) throw new Error("Invalid project exchange object scope.");
      const bytes = await exchangeStore.read(ref, key);
      const name = `files/exchange/${createHash("sha256").update(`${ref.provider}:${ref.location}:${key}`).digest("hex")}.bin`;
      await fs.mkdir(path.join(directory, "files/exchange"), { recursive: true, mode: 0o700 });
      await fs.writeFile(path.join(directory, name), bytes, { mode: 0o600 });
      files.push({ path: name, kind: "exchange", ref, key, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
    }
  }
  for (const item of inventories) if (JSON.stringify(item.before) !== JSON.stringify(await walk(item.source,
    item.kind === "documents" && path.relative(roots.documents, roots.ftp) === "Project FTP Files" ? "Project FTP Files" : undefined)))
    throw new Error("Project files changed during backup. Please retry.");
  return { files, roots, folder };
}

/** New project only: no overwrite of an existing file, including orphaned files. */
export async function restoreFiles(files: PackageFile[], directory: string, target: any) {
  const root = path.resolve(await getProjectFilesPath()), ftp = path.resolve(await getFtpFilesPath());
  const folder = getProjectDirectoryName(target.name, target.id);
  const roots: Record<string, string> = { documents: path.join(root, folder), ftp: path.join(ftp, folder, "Project FTP Files"), inventory: path.join(root, `inventory-${target.id}`) };
  const exchange = await defaultExchangeRef(target.id), written: string[] = [], objects: string[] = [];
  const keys = new Map<string, string>();
  async function safeAncestors(directory: string) {
    for (let current = directory; current !== path.dirname(current); current = path.dirname(current)) {
      try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Linked restore directory is not permitted."); }
      catch (error: any) { if (error.code !== "ENOENT") throw error; }
    }
  }
  async function rollback() {
    const failed: string[] = [];
    for (const name of written.reverse()) await fs.unlink(name).catch(error => { if (error.code !== "ENOENT") failed.push(name); });
    for (const key of objects) await exchangeStore.remove(exchange, key).catch(() => failed.push(key));
    if (failed.length) throw Object.assign(new Error("Restore did not commit, but some restore-owned files could not be removed. Administrator file cleanup is required."), { cleanupPending: true });
  }
  try {
    for (const directory of [...Object.values(roots), ...(exchange.provider === "local" ? [exchange.location] : [])])
      await safeAncestors(directory);
    for (const [kind, directory] of Object.entries(roots))
      if ((await walk(directory, kind === "documents" && path.relative(roots.documents, roots.ftp) === "Project FTP Files" ? "Project FTP Files" : undefined)).length)
        throw new Error("Destination project files are not empty. Use a new empty project; existing files are never overwritten.");
    if (exchange.provider === "app_storage" && (await exchangeStore.projectKeys(exchange, target.id)).length)
      throw new Error("Destination exchange storage is not empty.");
    for (const directory of [path.join(roots.documents, "Project Documents"), path.join(roots.ftp, "incoming"), path.join(roots.ftp, "outgoing"), roots.inventory])
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    for (const file of files.filter(file => file.kind)) {
      if (file.kind === "exchange") {
        const key = `meterflo-exchange/${target.id}/${path.basename(file.key!)}`;
        if (objects.includes(key)) throw new Error("Duplicate exchange object identity needs storage review.");
        // A dedicated empty project has a new namespace. Never replace existing bytes.
        if (exchange.provider === "local") {
          const targetFile = path.join(exchange.location, key);
          await fs.mkdir(path.dirname(targetFile), { recursive: true, mode: 0o700 });
          await fs.copyFile(path.join(directory, file.path), targetFile, (await import("node:fs")).constants.COPYFILE_EXCL);
          written.push(targetFile);
        } else {
          await exchangeStore.put(exchange, key, await fs.readFile(path.join(directory, file.path)));
          objects.push(key);
        }
        keys.set(`${file.ref!.provider}:${file.ref!.location}:${file.key}`, key);
      } else {
        if (!roots[file.kind!] || !safeRelative(file.relative!)) throw new Error("Invalid project file destination.");
        const destination = path.join(roots[file.kind!], file.relative!);
        // Verify each existing ancestor; a symlink must not redirect a restore.
        let ancestor = path.dirname(destination);
        while (ancestor !== path.dirname(ancestor)) {
          try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error("Linked restore directory is not permitted."); }
          catch (error: any) { if (error.code !== "ENOENT") throw error; }
          ancestor = path.dirname(ancestor);
        }
        await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        await fs.copyFile(path.join(directory, file.path), destination, (await import("node:fs")).constants.COPYFILE_EXCL);
        written.push(destination);
      }
    }
    return { rollback, roots, folder, exchange, keys, written: written.length + objects.length };
  } catch (error) { await rollback(); throw error; }
}
