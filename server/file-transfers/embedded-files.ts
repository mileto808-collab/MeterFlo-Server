import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import ssh2, { type SFTPWrapper } from "ssh2";
const { utils } = ssh2;
import { ensureProjectFtpDirectory } from "../fileStorage";
import { pool } from "../db";
import { withBackupExclusive } from "../backups/lock";
import { activeSftpAccount, sftpEvent } from "./embedded-service";
import { TransferError } from "./sftp";
import { sftpVirtualPath, sftpFinalUploadName } from "./virtual-path";
export { sftpVirtualPath } from "./virtual-path";
const STATUS = utils.sftp.STATUS_CODE;
const MAX = 25 * 1024 * 1024;
type Handle = { file?: fs.FileHandle; stage?: string; target?: string; name?: string; size: number; offset: number;
  mode: "read" | "write" | "directory"; entries?: any[]; temporary?: boolean; atime?: number; mtime?: number };
const attrs = (directory: boolean, size = 0, modified = Date.now()) => ({
  mode: directory ? 0o40700 : 0o100600, uid: 0, gid: 0, size,
  atime: Math.floor(modified / 1000), mtime: Math.floor(modified / 1000),
});
const listingName = (name: string, directory: boolean, size = 0, modified = Date.now()) => {
  const date = new Date(modified).toUTCString().split(" ");
  return `${directory ? "drwx------" : "-rw-------"} 1 0 0 ${size} ${date[2]} ${date[1]} ${date[3]} ${name}`;
};
async function safeFolder(account: any) {
  const folder = path.resolve(await ensureProjectFtpDirectory(account.project_name, account.project_id));
  const actual = await fs.realpath(folder);
  if ((process.platform === "win32" ? actual.toLowerCase() !== folder.toLowerCase() : actual !== folder))
    throw new TransferError("The transfer directory must not contain symbolic links.", 403);
  return folder;
}
async function generated(account: any, name?: string) {
  return (await pool.query(`SELECT DISTINCT file_name FROM public.file_export_runs
    WHERE project_id=$1 AND status='success' AND snapshot->>'destination'='local'
    AND ($2::text IS NULL OR file_name=$2) LIMIT 5001`, [account.project_id, name || null])).rows.map(row => row.file_name as string);
}
async function outgoingFiles(account: any) {
  const root = await safeFolder(account);
  // Local administrators may deliberately publish supported files here too.
  const names = new Set(await fs.readdir(path.join(root, "outgoing")));
  for (const name of await generated(account)) names.add(name); // existing root-level exports remain available
  const result: string[] = [];
  for (const name of names) {
    try { sftpVirtualPath(`/outgoing/${name}`); }
    catch { continue; }
    result.push(name);
  }
  return result;
}
async function outgoingFile(account: any, name: string) {
  const root = await safeFolder(account), file = path.join(root, "outgoing", name);
  try { await fs.lstat(file); return file; }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if ((await generated(account, name)).length) return path.join(root, name);
  throw new TransferError("File is not available in this project's outgoing folder.", 403);
}
/**
 * A virtual filesystem, not a general-purpose filesystem adapter. No filesystem path supplied by
 * a customer reaches fs directly. Uploads are invisible until CLOSE atomically publishes them.
 */
export function serveSftpFiles(stream: SFTPWrapper, accountId: string) {
  const handles = new Map<string, Handle>();
  const temporaryUploads = new Map<string, Handle>();
  const completedUploads = new Set<string>();
  let queue = Promise.resolve(), pending = 0, ended = false, cleaning = false;
  const handle = (buffer: Buffer) => {
    const found = handles.get(buffer.toString("hex"));
    if (!found) throw new TransferError("Unknown file handle.", 400);
    return found;
  };
  const authorizePath = (account: any, value: string) => {
    const virtual = sftpVirtualPath(value);
    if ((virtual === "/incoming" || virtual.startsWith("/incoming/")) && !account.can_upload ||
      (virtual === "/outgoing" || virtual.startsWith("/outgoing/")) && !account.can_download)
      throw new TransferError("Directory unavailable for this account.", 403);
    return virtual;
  };
  const putHandle = (entry: Handle) => {
    const id = Buffer.from(randomUUID());
    handles.set(id.toString("hex"), entry);
    return id;
  };
  const request = (event: string, fn: (account: any, id: number, ...args: any[]) => Promise<void>) => {
    stream.on(event as any, (id: number, ...args: any[]) => {
      if (ended) return;
      if (++pending > 128) { ended = true; stream.destroy(); return; }
      queue = queue.then(async () => {
        if (ended) return;
        try {
          const account = await activeSftpAccount(accountId);
          await fn(account, id, ...args);
        } catch (error: any) {
          const status = error.code === "ENOENT" ? STATUS.NO_SUCH_FILE : error instanceof TransferError && error.status === 403 ? STATUS.PERMISSION_DENIED : STATUS.FAILURE;
          const message = error instanceof TransferError ? error.message
            : error.code === "EEXIST" ? "A file with this name already exists. Use a new filename; existing files are never overwritten."
              : ["EACCES", "EPERM"].includes(error.code) ? "MeterFlo's service account cannot access the project transfer folders. Check host filesystem permissions."
                : error.code === "ENOSPC" ? "The MeterFlo storage volume is full."
                  : "Transfer failed. Check directory permissions or filename conflicts.";
          stream.status(id, status, message);
          const account = await pool.query("SELECT project_id,username FROM public.sftp_server_accounts WHERE id=$1", [accountId]).catch(() => null);
          if (account?.rows[0]) await sftpEvent(account.rows[0].project_id, account.rows[0].username, event.toLowerCase(), "failed",
            message).catch(() => {});
        }
      }).catch(() => { ended = true; stream.destroy(); }).finally(() => { pending--; });
    });
  };
  request("REALPATH", async (account, id, value) => {
    const name = authorizePath(account, value);
    const directory = ["/", "/incoming", "/outgoing"].includes(name);
    stream.name(id, [{ filename: name, longname: listingName(name, directory), attrs: attrs(directory) }]);
  });
  const stat = async (account: any, id: number, value: string) => {
    const virtual = authorizePath(account, value);
    if (["/", "/incoming", "/outgoing"].includes(virtual)) return void stream.attrs(id, attrs(true));
    const name = virtual.split("/")[2];
    if (virtual.startsWith("/incoming/")) {
      if (!account.can_upload) throw new TransferError("Inbox access denied.", 403);
      // Upload clients inspect their destination before writing. Metadata is not read access:
      // no inbox listing or file download is allowed, and publication still refuses overwrites.
    } else if (!account.can_download || !virtual.startsWith("/outgoing/"))
      throw new TransferError("Outbox access denied.", 403);
    const temporary = temporaryUploads.get(virtual);
    if (temporary) return void stream.attrs(id, attrs(false, temporary.size));
    const file = virtual.startsWith("/incoming/")
      ? path.join(await safeFolder(account), "incoming", name) : await outgoingFile(account, name);
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new TransferError("Not a regular export file.", 403);
    stream.attrs(id, attrs(false, info.size, info.mtimeMs));
  };
  request("STAT", stat); request("LSTAT", stat);
  request("OPENDIR", async (account, id, value) => {
    if (handles.size >= 16) throw new TransferError("Too many open handles.");
    const virtual = authorizePath(account, value);
    await safeFolder(account);
    let names: string[];
    if (virtual === "/") names = [account.can_upload ? "incoming" : "", account.can_download ? "outgoing" : ""].filter(Boolean);
    else if (virtual === "/incoming" && account.can_upload) names = [];
    else if (virtual === "/outgoing" && account.can_download) names = await outgoingFiles(account);
    else throw new TransferError("Directory unavailable.", 403);
    if (names.length > 5000) throw new TransferError("Too many exports to list; archive older exports through MeterFlo.");
    const entries: any[] = [];
    for (const name of names) {
      if (virtual === "/") entries.push({ filename: name, longname: listingName(name, true), attrs: attrs(true) });
      else {
        try {
          sftpVirtualPath(`/outgoing/${name}`);
          const info = await fs.lstat(await outgoingFile(account, name));
          if (info.isFile() && !info.isSymbolicLink()) entries.push({ filename: name, longname: listingName(name, false, info.size, info.mtimeMs), attrs: attrs(false, info.size, info.mtimeMs) });
        } catch (error: any) { if (error.code !== "ENOENT") throw error; }
      }
    }
    stream.handle(id, putHandle({ mode: "directory", size: 0, offset: 0, entries }));
  });
  request("READDIR", async (_a, id, buffer) => {
    const entry = handle(buffer);
    if (entry.mode !== "directory") throw new TransferError("Not a directory.");
    const rows = entry.entries!.splice(0, 100);
    if (rows.length) stream.name(id, rows); else stream.status(id, STATUS.EOF);
  });
  request("OPEN", async (account, id, value: string, flags: number) => {
    if (handles.size >= 16) throw new TransferError("Too many open handles.");
    const virtual = authorizePath(account, value), name = virtual.split("/")[2], folder = await safeFolder(account);
    const F = utils.sftp.OPEN_MODE;
    if (!name) throw new TransferError("Choose a file, not a directory.");
    if (virtual.startsWith("/incoming/") && account.can_upload && (flags & F.WRITE) &&
      (flags & F.CREAT) && !(flags & (F.READ | F.APPEND))) {
      // Block all generated names, even failed exports; import discovery excludes these names.
      const finalName = sftpFinalUploadName(name);
      if ((await pool.query("SELECT 1 FROM public.file_export_runs WHERE project_id=$1 AND file_name=$2 LIMIT 1", [account.project_id, finalName])).rowCount)
        throw new TransferError("That filename is reserved for generated exports.", 403);
      if (temporaryUploads.has(virtual)) throw new TransferError("That temporary upload is already awaiting rename.", 409);
      const stageFolder = path.join(folder, ".meterflo-sftp-staging");
      await fs.mkdir(stageFolder, { recursive: true, mode: 0o700 });
      const actual = await fs.realpath(stageFolder);
      if (process.platform === "win32" ? actual.toLowerCase() !== stageFolder.toLowerCase() : actual !== stageFolder)
        throw new TransferError("Staging links are not permitted.", 403);
      const stage = path.join(stageFolder, randomUUID());
      const file = await fs.open(stage, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
      stream.handle(id, putHandle({ file, stage, target: path.join(folder, "incoming", name), name, temporary: finalName !== name, mode: "write", size: 0, offset: 0 }));
    } else if (virtual.startsWith("/outgoing/") && account.can_download && flags === F.READ) {
      const target = await outgoingFile(account, name), info = await fs.lstat(target);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 50 * 1024 * 1024) throw new TransferError("Export file unavailable.", 403);
      const file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
      if (!(await file.stat()).isFile()) { await file.close(); throw new TransferError("Not a regular export file.", 403); }
      stream.handle(id, putHandle({ file, name, mode: "read", size: info.size, offset: 0 }));
    } else throw new TransferError("Upload to /incoming or download from /outgoing using your granted permissions. Resume is not supported.", 403);
  });
  request("WRITE", async (account, id, buffer, offset: number, bytes: Buffer) => {
    const entry = handle(buffer);
    if (entry.mode !== "write" || !account.can_upload || offset !== entry.size || bytes.length > 256 * 1024 || offset + bytes.length > MAX) {
      // Invalid/oversized writes poison the handle so CLOSE cannot publish a truncated file.
      handles.delete(buffer.toString("hex"));
      await entry.file?.close();
      if (entry.stage) await fs.unlink(entry.stage).catch(() => {});
      throw new TransferError("Only sequential uploads up to 25 MB are allowed; restart the complete upload.");
    }
    let written = 0;
    try {
      while (written < bytes.length) written += (await entry.file!.write(bytes, written, bytes.length - written, offset + written)).bytesWritten;
      entry.size += bytes.length;
      stream.status(id, STATUS.OK);
    } catch (error) {
      handles.delete(buffer.toString("hex")); await entry.file?.close(); await fs.unlink(entry.stage!).catch(() => {}); throw error;
    }
  });
  request("READ", async (account, id, buffer, offset: number, length: number) => {
    const entry = handle(buffer);
    if (entry.mode !== "read" || !account.can_download || !Number.isSafeInteger(offset) || offset < 0)
      throw new TransferError("Download unavailable.", 403);
    const bytes = Buffer.alloc(Math.min(length, 32768)), read = await entry.file!.read(bytes, 0, bytes.length, offset);
    if (!read.bytesRead) stream.status(id, STATUS.EOF); else {
      if (offset <= entry.offset) entry.offset = Math.max(entry.offset, offset + read.bytesRead);
      stream.data(id, bytes.subarray(0, read.bytesRead));
    }
  });
  request("FSTAT", async (_account, id, buffer) => {
    const entry = handle(buffer); stream.attrs(id, attrs(entry.mode === "directory", entry.size));
  });
  const publishUpload = async (account: any, entry: Handle, name: string) => {
    await withBackupExclusive(async () => {
      await activeSftpAccount(accountId);
      const root = await safeFolder(account), target = path.join(root, "incoming", name);
      if (path.dirname(entry.target!) !== path.join(root, "incoming"))
        throw new TransferError("Project storage changed during upload; restart the complete upload.");
      if (entry.atime !== undefined || entry.mtime !== undefined) {
        const now = Date.now() / 1000;
        await fs.utimes(entry.stage!, entry.atime ?? now, entry.mtime ?? now);
      }
      // Atomic no-replace publication; partial uploads never reach import discovery.
      await fs.link(entry.stage!, target);
      completedUploads.add(`/incoming/${name}`);
      await sftpEvent(account.project_id, account.username, "upload", "success",
        "Complete file accepted into Project FTP Files/incoming. Import processing is separate.", name, entry.size);
    });
  };
  request("CLOSE", async (account, id, buffer) => {
    const entry = handle(buffer);
    handles.delete(buffer.toString("hex"));
    try {
      if (entry.mode === "write") {
        await entry.file!.sync(); await entry.file!.close();
        if (!entry.size) throw new TransferError("Empty uploads are not accepted.");
        if (entry.temporary) {
          if (temporaryUploads.size >= 16) throw new TransferError("Too many temporary uploads awaiting rename.");
          temporaryUploads.set(`/incoming/${entry.name}`, entry);
        } else await publishUpload(account, entry, entry.name!);
      } else {
        await entry.file?.close();
        if (entry.mode === "read") await sftpEvent(account.project_id, account.username, "download", entry.offset >= entry.size ? "success" : "partial",
          entry.offset >= entry.size ? "Export read completed and handle closed; customer receipt is not separately acknowledged."
            : "Export handle closed before a complete sequential read.", entry.name, entry.offset);
      }
      stream.status(id, STATUS.OK);
    } finally {
      if (entry.stage && temporaryUploads.get(`/incoming/${entry.name}`) !== entry) await fs.unlink(entry.stage).catch(() => {});
      await entry.file?.close().catch(() => {});
    }
  });
  request("RENAME", async (account, id, from: string, to: string) => {
    const source = authorizePath(account, from), target = authorizePath(account, to);
    const entry = temporaryUploads.get(source);
    if (!entry || target !== `/incoming/${sftpFinalUploadName(entry.name!)}`)
      throw new TransferError("Only this session's completed temporary upload can be renamed to its final filename.", 403);
    try {
      await publishUpload(account, entry, sftpFinalUploadName(entry.name!));
      stream.status(id, STATUS.OK);
    } finally { temporaryUploads.delete(source); await fs.unlink(entry.stage!).catch(() => {}); }
  });
  const timestampAttributes = (entry: Handle, attributes: any) => {
    // ssh2 Stats owns undefined mode/uid/gid/etc. even when the client only sent times.
    if (Object.keys(attributes).some(key => attributes[key] !== undefined && !["atime", "mtime", "size"].includes(key)) ||
      attributes.size !== undefined && attributes.size !== entry.size ||
      ["atime", "mtime"].some(key => attributes[key] !== undefined &&
        (!Number.isFinite(attributes[key]) || attributes[key] < 0)))
      throw new TransferError("Only upload timestamps may be changed; permissions, ownership and file resizing are not permitted.", 403);
    if (attributes.atime !== undefined) entry.atime = attributes.atime;
    if (attributes.mtime !== undefined) entry.mtime = attributes.mtime;
  };
  request("FSETSTAT", async (_account, id, buffer: Buffer, attributes: any) => {
    const entry = handle(buffer);
    if (entry.mode !== "write") throw new TransferError("Only upload metadata may be changed.", 403);
    timestampAttributes(entry, attributes);
    stream.status(id, STATUS.OK);
  });
  request("SETSTAT", async (account, id, value: string, attributes: any) => {
    const virtual = authorizePath(account, value), temporary = temporaryUploads.get(virtual);
    if (temporary) timestampAttributes(temporary, attributes);
    else {
      if (!completedUploads.has(virtual)) throw new TransferError("Only this session's uploads may have their timestamps changed.", 403);
      const file = await fs.open(path.join(await safeFolder(account), virtual.slice(1)), constants.O_RDWR | (constants.O_NOFOLLOW || 0));
      try {
        const info = await file.stat(), entry: Handle = { mode: "write", size: info.size, offset: 0 };
        if (!info.isFile()) throw new TransferError("Not a regular upload file.", 403);
        timestampAttributes(entry, attributes);
        await file.utimes(entry.atime ?? info.atimeMs / 1000, entry.mtime ?? info.mtimeMs / 1000);
      } finally { await file.close(); }
    }
    stream.status(id, STATUS.OK);
  });
  for (const event of ["REMOVE", "MKDIR", "RMDIR", "SYMLINK", "READLINK", "EXTENDED"])
    request(event, async (_a, id) => { stream.status(id, STATUS.OP_UNSUPPORTED, "Deletion, rename, links, attributes, and extensions are disabled."); });
  const cleanup = () => {
    if (cleaning) return;
    cleaning = true;
    ended = true;
    void queue.finally(async () => {
      for (const entry of [...handles.values(), ...temporaryUploads.values()]) {
        await entry.file?.close().catch(() => {});
        if (entry.stage) await fs.unlink(entry.stage).catch(() => {});
        if (entry.stage || entry.mode === "read") {
          const row = (await pool.query("SELECT project_id,username FROM public.sftp_server_accounts WHERE id=$1", [accountId]).catch(() => ({ rows: [] }))).rows[0];
          if (row) await sftpEvent(row.project_id, row.username, entry.stage ? "upload" : "download", "failed",
            entry.stage ? "Connection closed before upload completion; partial file discarded." : "Connection closed before the export handle was closed.",
            entry.name, entry.stage ? entry.size : entry.offset).catch(() => {});
        }
      }
      handles.clear();
      temporaryUploads.clear();
    }).catch(() => {});
  };
  stream.on("close", cleanup); stream.on("error", cleanup);
  stream.on("end", () => {
    // ssh2 emits EOF without automatically closing its server SFTP channel. OpenSSH waits
    // for CHANNEL_CLOSE after its batch, even when every file transfer already succeeded.
    cleanup();
    void queue.finally(() => stream.end()).catch(() => {});
  });
}
