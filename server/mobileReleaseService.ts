import { promises as fs, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { APK_CHUNK_SIZE, apkUploadSchema } from "../shared/mobile-releases";
import { validateApk } from "./apkValidation";
import { MobileReleaseRepository, ReleaseError, type ApkUploadSession, type StoredRelease } from "./mobileReleaseRepository";
import { apkFileStore, configuredApkStorage, type ApkFileStore, type ApkStorageRef } from "./mobileReleaseStorage";

export const releaseKey = (id: string) => `releases/${id}.apk`;
const chunkKey = (id: string, index: number) => `uploads/${id}/${index}.part`;
export class MobileReleaseService {
  private finalizationQueue: Promise<void> = Promise.resolve();
  constructor(readonly repo: MobileReleaseRepository, readonly files: ApkFileStore = apkFileStore,
    readonly configure: () => Promise<ApkStorageRef> = configuredApkStorage) {}
  async init(userId: string, data: unknown) {
    const parsed = apkUploadSchema.safeParse(data);
    if (!parsed.success) throw new ReleaseError(parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
    const ref = await this.configure();
    // A failing provider must not silently select local/ephemeral storage.
    await this.files.exists(ref, releaseKey("00000000-0000-0000-0000-000000000000"));
    const id = randomUUID();
    await this.repo.createUpload({ ...parsed.data, id, userId, ref });
    return { uploadId: id };
  }
  async chunk(id: string, userId: string, index: number, bytes: Buffer) {
    if (!Number.isInteger(index) || index < 0) throw new ReleaseError("Invalid chunk index.");
    return this.repo.withUpload(id, userId, async (session, client) => {
      const expected = index === session.totalChunks - 1
        ? session.totalSize - index * APK_CHUNK_SIZE : APK_CHUNK_SIZE;
      if (index >= session.totalChunks || bytes.length !== expected) throw new ReleaseError("Chunk size or index does not match the upload.");
      if (session.received.includes(index)) return { received: true, duplicate: true };
      const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-apk-chunk-"));
      const file = path.join(temp, "chunk.part");
      try {
        await fs.writeFile(file, bytes, { mode: 0o600 });
        await this.files.put(session.ref, chunkKey(id, index), file);
        try {
          await client.query(`UPDATE ${this.repo.table("uploads")} SET received=array_append(received,$2) WHERE id=$1`, [id,index]);
        } catch (error) {
          await this.files.remove(session.ref, chunkKey(id, index)).catch(() => {});
          throw error;
        }
        return { received: true };
      } finally { await fs.rm(temp, { recursive: true, force: true }); }
    });
  }
  async removeChunks(session: ApkUploadSession) {
    // Include unrecorded fragments from an interrupted write, not just received indexes.
    for (let i = 0; i < session.totalChunks; i++) await this.files.remove(session.ref, chunkKey(session.id, i));
  }
  async cancel(id: string, userId: string | null) {
    try {
      // Persist the cancellation before byte cleanup. If the provider is down,
      // leave an expired, visible cleanup job rather than a hidden hour-long lease.
      await this.repo.withUpload(id,userId,async (_session,client) => {
        await client.query(`UPDATE ${this.repo.table("uploads")} SET expires_at=now() WHERE id=$1`,[id]);
      },true);
      await this.repo.withUpload(id, userId, async (session, client) => {
        await this.removeChunks(session);
        await client.query(`DELETE FROM ${this.repo.table("uploads")} WHERE id=$1`, [id]);
      }, true);
    } catch (error) {
      if (error instanceof ReleaseError && error.status === 404) return;
      throw error;
    }
  }
  async finalize(id: string, userId: string, recheckPermission: () => Promise<void>) {
    // Each finalizer holds an upload-row transaction and needs a second connection
    // for a durable draft/permission check. Bound finalization to avoid starving the
    // shared pool when many administrators finish large APKs concurrently.
    const previous = this.finalizationQueue;
    let unlock!: () => void;
    this.finalizationQueue = new Promise<void>(resolve => { unlock = resolve; });
    await previous;
    try { return await this.finishUpload(id,userId,recheckPermission); }
    finally { unlock(); }
  }
  private async finishUpload(id: string, userId: string, recheckPermission: () => Promise<void>) {
    let staged: StoredRelease | null = null;
    try {
      const release = await this.repo.withUpload(id, userId, async (session, client) => {
        if (session.received.length !== session.totalChunks) throw new ReleaseError("Upload is incomplete. Retry the missing chunks or start a new upload.");
        const temp = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-apk-assemble-"));
        const file = path.join(temp, "release.apk");
        try {
          await fs.writeFile(file, "", { mode: 0o600 });
          for (let i = 0; i < session.totalChunks; i++) {
            if (!session.received.includes(i)) throw new ReleaseError("Upload has a missing chunk.");
            await pipeline(await this.files.open(session.ref, chunkKey(id, i)), createWriteStream(file, { flags: "a" }));
            if ((await fs.stat(file)).size > session.totalSize) throw new ReleaseError("Assembled APK exceeds the declared size.");
          }
          if ((await fs.stat(file)).size !== session.totalSize) throw new ReleaseError("Assembled APK size does not match.");
          const integrity = await validateApk(file);
          await recheckPermission();
          staged = { id: randomUUID(), ...session.metadata, fileName: session.fileName,
            ...integrity, ref: session.ref, deleted: false,
            uploadedAt: new Date().toISOString(), publishedAt: null };
          // Commit the invisible draft independently before storing bytes. Crashes/put failures
          // leave a durable cleanup record, never an untracked binary or a publishable half-upload.
          await this.repo.insert(this.repo.pool, staged, id);
          await this.files.put(staged.ref, releaseKey(staged.id), file);
          await recheckPermission();
          const ready = await client.query(`UPDATE ${this.repo.table("releases")} SET ready=true WHERE id=$1 AND NOT deleted`, [staged.id]);
          if (ready.rowCount !== 1) throw new ReleaseError("Upload could not be committed. Retry the upload.", 503);
          // Retain a durable chunk-cleanup record until every fragment has actually gone.
          await client.query(`UPDATE ${this.repo.table("uploads")} SET expires_at=now() WHERE id=$1`, [id]);
          return staged;
        } finally { await fs.rm(temp, { recursive: true, force: true }); }
      });
      await this.cancel(id, userId).catch(() => {});
      return release;
    } catch (error) {
      // Do not delete a successfully committed release on an ambiguous connection failure.
      if (staged) await this.repo.abandon((staged as StoredRelease).id).catch(() => {});
      await this.cancel(id, userId).catch(() => {});
      await this.cleanupDeleted().catch(() => {});
      throw error;
    }
  }
  async publish(id: string, recheckPermission: () => Promise<void>) {
    // Do not acquire another pooled connection while holding the singleton
    // publication lock: concurrent publishers can otherwise exhaust the pool.
    await recheckPermission();
    return this.repo.publish(id, async release => {
      if (!await this.files.exists(release.ref, releaseKey(id))) throw new ReleaseError("APK bytes are missing. Upload the release again.", 503);
    });
  }
  async remove(id: string, withdrawLatest: boolean) {
    await this.repo.withdraw(id, withdrawLatest);
    const pendingCleanup = await this.cleanupDeleted();
    return { pendingCleanup, message: pendingCleanup
      ? "Release removed from the dashboard. Storage cleanup is pending; use Retry storage cleanup."
      : "Release deleted." };
  }
  async cleanupDeleted() {
    for (const release of await this.repo.pendingDeletes()) {
      try {
        await this.files.remove(release.ref, releaseKey(release.id));
        await this.repo.deleteTombstone(release.id);
      } catch { /* Keep tombstone; manager list exposes pending cleanup and explicit retry. */ }
    }
    return (await this.repo.list()).pendingCleanup;
  }
  async cleanup() {
    for (const id of await this.repo.expiredUploads()) {
      await this.cancel(id, null).catch(() => {});
    }
    return this.cleanupDeleted();
  }
  async downloadable(id: string, manager: boolean) {
    const release = await this.repo.get(id);
    if (!release || release.deleted || !await this.repo.isReady(id)) throw new ReleaseError("Release is missing or withdrawn.", 404);
    if (!manager && await this.repo.latestId() !== id) throw new ReleaseError("This release is no longer the latest. Refresh the dashboard.", 410);
    if (!await this.files.exists(release.ref, releaseKey(id))) throw new ReleaseError("APK storage is unavailable or the file is missing. Contact an administrator.", 503);
    return release;
  }
}
