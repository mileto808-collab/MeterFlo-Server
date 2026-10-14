import type { Pool, PoolClient } from "pg";
import type { MobileRelease, ApkMetadata } from "../shared/mobile-releases";
import type { ApkStorageRef } from "./mobileReleaseStorage";

export interface StoredRelease extends MobileRelease {
  ref: ApkStorageRef;
  deleted: boolean;
}
export interface ApkUploadSession {
  id: string;
  userId: string;
  fileName: string;
  totalSize: number;
  totalChunks: number;
  metadata: ApkMetadata;
  ref: ApkStorageRef;
  received: number[];
  expiresAt: Date;
}
export class ReleaseError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export class MobileReleaseRepository {
  readonly schema: string;
  constructor(readonly pool: Pool, schema = "public") {
    if (!/^[a-z][a-z0-9_]*$/.test(schema)) throw new Error("Invalid release schema");
    this.schema = schema;
  }
  table(name: string) { return `"${this.schema}"."mobile_apk_${name}"`; }
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  async initialize() {
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(663785751)");
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${this.table("releases")} (
          id text PRIMARY KEY, version varchar(64) NOT NULL,
          build_code integer CHECK(build_code BETWEEN 1 AND 2100000000),
          notes text NOT NULL DEFAULT '', file_name varchar(180) NOT NULL,
          size integer NOT NULL CHECK(size BETWEEN 1 AND 536870912),
          sha256 varchar(64) NOT NULL, provider text NOT NULL CHECK(provider IN ('local','app_storage')),
          location text NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now(),
          published_at timestamptz, deleted boolean NOT NULL DEFAULT false,
          ready boolean NOT NULL DEFAULT false, origin_upload_id text
        );
        CREATE TABLE IF NOT EXISTS ${this.table("publication")} (
          id integer PRIMARY KEY CHECK(id=1),
          release_id text REFERENCES ${this.table("releases")}(id) ON DELETE SET NULL
        );
        INSERT INTO ${this.table("publication")}(id) VALUES(1) ON CONFLICT DO NOTHING;
        CREATE TABLE IF NOT EXISTS ${this.table("uploads")} (
          id text PRIMARY KEY, user_id text NOT NULL, file_name varchar(180) NOT NULL,
          total_size integer NOT NULL, total_chunks integer NOT NULL,
          metadata jsonb NOT NULL, provider text NOT NULL, location text NOT NULL,
          received integer[] NOT NULL DEFAULT '{}',
          expires_at timestamptz NOT NULL DEFAULT now() + interval '1 hour'
        );
        CREATE INDEX IF NOT EXISTS mobile_apk_upload_expiry ON ${this.table("uploads")}(expires_at);
        ALTER TABLE ${this.table("releases")} ADD COLUMN IF NOT EXISTS origin_upload_id text;
      `);
    });
  }
  release(row: any): StoredRelease {
    return { id: row.id, version: row.version, buildCode: row.build_code, notes: row.notes,
      fileName: row.file_name, size: row.size, sha256: row.sha256,
      uploadedAt: new Date(row.uploaded_at).toISOString(),
      publishedAt: row.published_at ? new Date(row.published_at).toISOString() : null,
      ref: { provider: row.provider, location: row.location }, deleted: row.deleted };
  }
  async list() {
    return this.transaction(async client => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      const result = await client.query(`SELECT * FROM ${this.table("releases")}
        WHERE NOT deleted AND ready ORDER BY uploaded_at DESC, id`);
      const latest = await client.query(`SELECT release_id FROM ${this.table("publication")} WHERE id=1`);
      const pending = await client.query(`SELECT count(*)::int AS count FROM ${this.table("releases")} WHERE deleted`);
      const uploads = await client.query(`SELECT count(*)::int AS count FROM ${this.table("uploads")} WHERE expires_at<=now()`);
      return { releases: result.rows.map(row => this.release(row)), latestId: latest.rows[0]?.release_id || null,
        pendingCleanup: pending.rows[0].count + uploads.rows[0].count,
        pendingUploadCleanup: uploads.rows[0].count };
    });
  }
  async get(id: string, client: Pool | PoolClient = this.pool) {
    const result = await client.query(`SELECT * FROM ${this.table("releases")} WHERE id=$1`, [id]);
    return result.rows[0] ? this.release(result.rows[0]) : null;
  }
  async latestId(client: Pool | PoolClient = this.pool) {
    return (await client.query(`SELECT release_id FROM ${this.table("publication")} WHERE id=1`)).rows[0]?.release_id || null;
  }
  async latest() {
    const result = await this.pool.query(`SELECT r.* FROM ${this.table("releases")} r
      JOIN ${this.table("publication")} p ON p.release_id=r.id WHERE p.id=1 AND NOT r.deleted AND r.ready`);
    return result.rows[0] ? this.release(result.rows[0]) : null;
  }
  async insert(client: Pool | PoolClient, release: StoredRelease, uploadId?: string) {
    await client.query(`INSERT INTO ${this.table("releases")}
      (id,version,build_code,notes,file_name,size,sha256,provider,location,origin_upload_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [release.id, release.version, release.buildCode, release.notes, release.fileName, release.size,
        release.sha256, release.ref.provider, release.ref.location,uploadId || null]);
  }
  async publish(id: string, check: (release: StoredRelease) => Promise<void>) {
    return this.transaction(async client => {
      await client.query(`SELECT * FROM ${this.table("publication")} WHERE id=1 FOR UPDATE`);
      const release = await this.get(id, client);
      const ready = (await client.query(`SELECT ready FROM ${this.table("releases")} WHERE id=$1`, [id])).rows[0]?.ready;
      if (!release || release.deleted || !ready) throw new ReleaseError("Ready release not found.", 404);
      await check(release);
      const result = await client.query(`UPDATE ${this.table("releases")} SET published_at=now() WHERE id=$1 RETURNING *`, [id]);
      await client.query(`UPDATE ${this.table("publication")} SET release_id=$1 WHERE id=1`, [id]);
      return this.release(result.rows[0]);
    });
  }
  async withdraw(id: string, confirm: boolean) {
    return this.transaction(async client => {
      await client.query(`SELECT * FROM ${this.table("publication")} WHERE id=1 FOR UPDATE`);
      const release = await this.get(id, client);
      if (!release) throw new ReleaseError("Release not found.", 404);
      const latestId = await this.latestId(client);
      if (latestId === id && !confirm) throw new ReleaseError("Confirm withdrawal of the latest release, or publish a replacement first.", 409);
      if (latestId === id) await client.query(`UPDATE ${this.table("publication")} SET release_id=NULL WHERE id=1`);
      // Durable tombstone: failed byte cleanup can be retried, with no dangling dashboard link.
      await client.query(`UPDATE ${this.table("releases")} SET deleted=true WHERE id=$1`, [id]);
      return release;
    });
  }
  async pendingDeletes() {
    await this.pool.query(`UPDATE ${this.table("releases")} r SET deleted=true
      WHERE NOT ready AND uploaded_at < now()-interval '1 hour'
      AND NOT EXISTS (SELECT 1 FROM ${this.table("uploads")} u WHERE u.id=r.origin_upload_id)`);
    return (await this.pool.query(`SELECT * FROM ${this.table("releases")} WHERE deleted LIMIT 100`)).rows.map(row => this.release(row));
  }
  async abandon(id: string) { await this.pool.query(`UPDATE ${this.table("releases")} SET deleted=true WHERE id=$1 AND NOT ready`, [id]); }
  async isReady(id: string) { return !!(await this.pool.query(`SELECT ready FROM ${this.table("releases")} WHERE id=$1 AND NOT deleted`, [id])).rows[0]?.ready; }
  async deleteTombstone(id: string) { await this.pool.query(`DELETE FROM ${this.table("releases")} WHERE id=$1 AND deleted`, [id]); }
  async createUpload(upload: Omit<ApkUploadSession, "received" | "expiresAt">) {
    await this.transaction(async client => {
      await client.query("SELECT pg_advisory_xact_lock(663785752)");
      const counts = (await client.query(`SELECT count(*)::int AS total,
        count(*) FILTER (WHERE user_id=$1)::int AS own FROM ${this.table("uploads")}`, [upload.userId])).rows[0];
      if (counts.own >= 3 || counts.total >= 20) throw new ReleaseError("Too many pending uploads. Cancel an upload or wait for cleanup.", 429);
      await client.query(`INSERT INTO ${this.table("uploads")}
        (id,user_id,file_name,total_size,total_chunks,metadata,provider,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [upload.id,upload.userId,upload.fileName,upload.totalSize,upload.totalChunks,
          JSON.stringify(upload.metadata), upload.ref.provider,upload.ref.location]);
    });
  }
  upload(row: any): ApkUploadSession {
    return { id: row.id, userId: row.user_id, fileName: row.file_name, totalSize: row.total_size,
      totalChunks: row.total_chunks, metadata: row.metadata, ref: {provider:row.provider, location:row.location},
      received: row.received, expiresAt: new Date(row.expires_at) };
  }
  async withUpload<T>(id: string, userId: string | null, work: (upload: ApkUploadSession, client: PoolClient) => Promise<T>, allowExpired = false) {
    return this.transaction(async client => {
      const result = await client.query(`SELECT * FROM ${this.table("uploads")} WHERE id=$1 FOR UPDATE`, [id]);
      if (!result.rows[0]) throw new ReleaseError("Upload session not found or expired. Start a new upload.", 404);
      const upload = this.upload(result.rows[0]);
      if (userId !== null && upload.userId !== userId) throw new ReleaseError("This upload belongs to another user.", 403);
      if (!allowExpired && upload.expiresAt.getTime() <= Date.now()) throw new ReleaseError("Upload expired. Start a new upload.", 410);
      return work(upload, client);
    });
  }
  async expiredUploads() {
    return (await this.pool.query(`SELECT id FROM ${this.table("uploads")} WHERE expires_at<=now() LIMIT 20`)).rows.map(row => row.id as string);
  }
}
export function publicRelease(release: StoredRelease): MobileRelease {
  const { ref, deleted, ...dto } = release;
  return dto;
}
