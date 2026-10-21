import { promises as fs } from "node:fs";
import path from "node:path";
import { getProjectFilesPath } from "../fileStorage";
import { TransferError } from "./sftp";
import { assertPrivateApkDirectory } from "../mobileReleaseStorage";
export interface ExchangeRef { provider: "local" | "app_storage"; location: string }
export function exchangeProvider(): ExchangeRef["provider"] {
  return process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT ? "app_storage" : "local";
}
export async function defaultExchangeRef(projectId: number): Promise<ExchangeRef> {
  const provider = exchangeProvider();
  return { provider, location: provider === "local" ? path.resolve(await getProjectFilesPath(), "Secure File Exchange", String(projectId)) : "" };
}
function keyPath(ref: ExchangeRef, key: string) {
  if (!/^meterflo-exchange\/\d+\/[a-f0-9-]{36}\.bin$/.test(key)) throw new TransferError("Invalid exchange storage key.");
  if (ref.provider === "app_storage") return key;
  if (!path.isAbsolute(ref.location)) throw new TransferError("Use an absolute private storage directory.");
  assertPrivateApkDirectory(ref.location);
  return path.join(ref.location, key);
}
async function cloud(ref: ExchangeRef) {
  const { Client } = await import("@replit/object-storage");
  return new Client(ref.location ? { bucketId: ref.location } : {});
}
export const exchangeStore = {
  async projectKeys(ref: ExchangeRef, projectId: number): Promise<string[]> {
    if (ref.provider !== "app_storage") return [];
    const prefix = `meterflo-exchange/${projectId}/`, keys = new Set<string>();
    let startOffset: string | undefined;
    for (;;) {
      const result = await (await cloud(ref)).list({ prefix, maxResults: 1000, startOffset });
      if (!result.ok) throw new TransferError("Cannot verify project exchange storage. Project deletion was cancelled.", 503);
      const names = result.value.map(object => object.name).sort();
      for (const name of names) {
        if (!name.startsWith(prefix) || !/^[a-f0-9-]{36}\.bin$/.test(name.slice(prefix.length)))
          throw new TransferError("Unrecognized project exchange content requires administrator review before deletion.");
        keys.add(name);
      }
      if (keys.size > 50000) throw new TransferError("Project exchange cleanup is too large; contact an administrator.");
      if (names.length < 1000) return [...keys];
      const next = names.at(-1);
      if (!next || next === startOffset) throw new TransferError("Could not enumerate all project exchange files.");
      startOffset = next;
    }
  },
  async probe(ref: ExchangeRef, projectId: number) {
    if (ref.provider !== exchangeProvider()) throw new TransferError("Storage provider does not match this instance. Review and save storage settings.", 503);
    const key = `meterflo-exchange/${projectId}/00000000-0000-0000-0000-000000000000.bin`;
    const filename = keyPath(ref, key);
    if (ref.provider === "local") await fs.access(ref.location, 6);
    else {
      const result = await (await cloud(ref)).exists(filename);
      if (!result.ok) throw new TransferError("Private App Storage is unavailable. Attach a private bucket or enter its bucket ID, then verify access.", 503);
    }
  },
  async put(ref: ExchangeRef, key: string, bytes: Buffer) {
    const filename = keyPath(ref, key);
    if (ref.provider === "app_storage") {
      const result = await (await cloud(ref)).uploadFromBytes(key, bytes, { compress: false });
      if (!result.ok) throw new TransferError("Private App Storage upload failed. Check bucket access.", 503);
    } else {
      await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      const partial = filename + ".part";
      try { await fs.writeFile(partial, bytes, { mode: 0o600, flag: "wx" }); await fs.copyFile(partial, filename, 1); }
      finally { await fs.rm(partial, { force: true }); }
    }
  },
  async read(ref: ExchangeRef, key: string): Promise<Buffer> {
    const filename = keyPath(ref, key);
    if (ref.provider === "local") return fs.readFile(filename);
    const result = await (await cloud(ref)).downloadAsBytes(key, { decompress: false });
    if (!result.ok) throw new TransferError("Private App Storage download failed. Check bucket access.", 503);
    return result.value[0];
  },
  async remove(ref: ExchangeRef, key: string) {
    const filename = keyPath(ref, key);
    if (ref.provider === "local") return fs.rm(filename, { force: true });
    const result = await (await cloud(ref)).delete(key, { ignoreNotFound: true });
    if (!result.ok) throw new TransferError("Private App Storage cleanup failed. Retry when storage is available.", 503);
  },
  async check(ref: ExchangeRef, projectId: number) {
    if (ref.provider !== exchangeProvider()) throw new TransferError("Storage must match this instance: private App Storage on Replit, local private storage on standalone servers.");
    const { randomUUID } = await import("node:crypto");
    const key = `meterflo-exchange/${projectId}/${randomUUID()}.bin`, bytes = Buffer.from(randomUUID());
    try {
      await exchangeStore.put(ref, key, bytes);
      if (!(await exchangeStore.read(ref, key)).equals(bytes)) throw new TransferError("Storage read verification failed.", 503);
    } finally { await exchangeStore.remove(ref, key); }
  },
};
