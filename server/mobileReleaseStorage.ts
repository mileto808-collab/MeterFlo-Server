import { promises as fs } from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";
import { getProjectFilesPath } from "./fileStorage";

export type ApkStorageRef = { provider: "local" | "app_storage"; location: string };
export interface ApkFileStore {
  put(ref: ApkStorageRef, key: string, filename: string): Promise<void>;
  open(ref: ApkStorageRef, key: string): Promise<Readable>;
  exists(ref: ApkStorageRef, key: string): Promise<boolean>;
  remove(ref: ApkStorageRef, key: string): Promise<void>;
}
export class ApkStorageError extends Error {
  status = 503;
}
export function assertPrivateApkDirectory(location: string) {
  for (const folder of ["dist", "public", "client/public", "server/public", "node_modules", "generated-artifacts"]) {
    const relative = path.relative(path.resolve(folder), path.resolve(location));
    if (relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative))) {
      throw new ApkStorageError("Choose a protected APK data directory outside public, build, dependency and generated-output folders.");
    }
  }
}
function safeKey(key: string) {
  if (!/^(releases\/[a-f0-9-]+\.apk|uploads\/[a-f0-9-]+\/\d+\.part)$/.test(key)) {
    throw new Error("Invalid internal APK storage key");
  }
  return key;
}
export function apkStorageProvider(env: NodeJS.ProcessEnv = process.env) {
  return env.MOBILE_APK_STORAGE || ((env.REPL_ID || env.REPLIT_DEPLOYMENT) ? "app_storage" : "local");
}
export async function configuredApkStorage(env: NodeJS.ProcessEnv = process.env): Promise<ApkStorageRef> {
  const provider = apkStorageProvider(env);
  if (provider === "app_storage") {
    return { provider, location: env.MOBILE_APK_BUCKET_ID || "" };
  }
  if (provider !== "local") throw new ApkStorageError("MOBILE_APK_STORAGE must be local or app_storage.");
  if (env.REPLIT_DEPLOYMENT) {
    throw new ApkStorageError("Published Replit APK releases require App Storage, not the deployment filesystem.");
  }
  const location = env.MOBILE_APK_LOCAL_DIR || path.resolve(await getProjectFilesPath(), "Mobile APK Releases");
  if (!path.isAbsolute(location)) throw new ApkStorageError("MOBILE_APK_LOCAL_DIR must be an absolute path.");
  assertPrivateApkDirectory(location);
  return { provider, location };
}
async function client(ref: ApkStorageRef) {
  // Standalone servers do not initialize Replit credentials or require a Replit login.
  const { Client } = await import("@replit/object-storage");
  return new Client(ref.location ? { bucketId: ref.location } : {});
}
function localPath(ref: ApkStorageRef, key: string) {
  if (!path.isAbsolute(ref.location)) throw new ApkStorageError("Invalid APK storage directory.");
  return path.join(ref.location, safeKey(key));
}
export const apkFileStore: ApkFileStore = {
  async put(ref, key, filename) {
    safeKey(key);
    if (ref.provider === "local") {
      const destination = localPath(ref, key);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      // Do not overwrite an already committed file/chunk.
      await fs.copyFile(filename, destination, 1 /* COPYFILE_EXCL */);
    } else {
      const result = await (await client(ref)).uploadFromFilename(key, filename, { compress: false });
      if (!result.ok) throw new ApkStorageError("App Storage upload failed. Check the configured bucket and service access.");
    }
  },
  async open(ref, key) {
    safeKey(key);
    if (ref.provider === "local") {
      const handle = await fs.open(localPath(ref, key), "r");
      return handle.createReadStream(); // open before returning so missing files fail before headers
    }
    return (await client(ref)).downloadAsStream(key, { decompress: false });
  },
  async exists(ref, key) {
    safeKey(key);
    if (ref.provider === "local") {
      try { return (await fs.stat(localPath(ref, key))).isFile(); }
      catch (error: any) { if (error.code === "ENOENT") return false; throw error; }
    }
    const result = await (await client(ref)).exists(key);
    if (!result.ok) throw new ApkStorageError("App Storage is unavailable. Check the configured bucket and service access.");
    return result.value;
  },
  async remove(ref, key) {
    safeKey(key);
    if (ref.provider === "local") {
      const filename = localPath(ref, key);
      await fs.rm(filename, { force: true });
      // Empty upload folders are temporary and safe to remove.
      if (key.startsWith("uploads/")) await fs.rmdir(path.dirname(filename)).catch(() => {});
    } else {
      const result = await (await client(ref)).delete(key, { ignoreNotFound: true });
      if (!result.ok) throw new ApkStorageError("App Storage cleanup failed. Retry when the bucket is available.");
    }
  },
};
export async function apkStorageStatus() {
  try {
    const ref = await configuredApkStorage();
    if (ref.provider === "local") {
      await fs.mkdir(ref.location, { recursive: true, mode: 0o700 });
      await fs.access(ref.location, 2 /* W_OK */);
    } else {
      // This is only an existence probe; no dummy object is written.
      await apkFileStore.exists(ref, "releases/00000000-0000-0000-0000-000000000000.apk");
    }
    return { provider: ref.provider, available: true, message: ref.provider === "local"
      ? "Persistent local storage. Back up the release directory together with the database."
      : "Durable App Storage. Back up this bucket together with the database.", maxSizeMB: 512 };
  } catch (error) {
    const provider = apkStorageProvider();
    return { provider, available: false, message: provider === "local"
      ? `${error instanceof ApkStorageError ? error.message : "Local APK storage is unavailable."} Set an absolute MOBILE_APK_LOCAL_DIR and grant the Windows/Linux service account read/write access. Restart after configuration changes. No Replit account or bucket is required.`
      : "Replit-hosted APK storage is unavailable. Create/attach a private App Storage bucket and check its service access. Standalone Windows/Linux installations instead use local storage, without a Replit bucket.", maxSizeMB: 512 };
  }
}
