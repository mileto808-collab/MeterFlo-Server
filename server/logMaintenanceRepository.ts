import type { Pool, PoolClient } from "pg";
import type { CleanupFilter, LogCategory, LogInventory } from "../shared/log-maintenance";
import { databaseLogCategories } from "../shared/log-maintenance";

export interface RowCandidate { category: LogCategory; id: string; bytes: number }
export const databaseCategories = databaseLogCategories;
// Namespace injection is only for isolated test fixtures; never derived from requests.
export class LogRepository {
  readonly ns: string;
  constructor(readonly pool: Pool, namespace = "public") {
    if (!/^[a-z_][a-z0-9_]*$/.test(namespace)) throw new Error("Invalid internal namespace");
    this.ns = `"${namespace}".`;
  }
  spec(category: LogCategory, includeFailedImports = false) {
    const n = this.ns;
    switch (category) {
      case "customerApi": return {
        table: "customer_api_logs", from: `${n}customer_api_logs h LEFT JOIN ${n}customer_api_deliveries d ON d.id=h.delivery_id`,
        eligible: "((h.delivery_id IS NULL AND h.success=true) OR d.status='delivered')", date: "h.created_at", project: "h.project_id",
      };
      case "apiImports": return {
        table: "api_import_runs", from: `${n}api_import_runs h`,
        // Failed/partial configured API runs remain manually retryable: their
        // stored checkpoints/settings are recovery state, not disposable logs.
        eligible: `${includeFailedImports ? "(h.status='succeeded' OR (h.config_id IS NULL AND h.status IN ('failed','partial')))" : "h.status='succeeded'"} AND h.completed_at IS NOT NULL AND (h.config_id IS NULL OR EXISTS (SELECT 1 FROM ${n}api_import_runs newer WHERE newer.config_id=h.config_id AND newer.completed_at IS NOT NULL AND (newer.started_at,newer.id)>(h.started_at,h.id)))`,
        date: "h.started_at", project: "h.project_id",
      };
      case "databaseImports": return {
        table: "import_history", from: `${n}import_history h JOIN ${n}import_configs c ON c.id=h.import_config_id JOIN ${n}external_database_configs e ON e.id=c.external_db_config_id`,
        eligible: `${includeFailedImports ? "h.status IN ('success','failed','partial')" : "h.status='success' AND COALESCE(h.records_failed,0)=0"} AND h.completed_at IS NOT NULL AND EXISTS (SELECT 1 FROM ${n}import_history newer WHERE newer.import_config_id=h.import_config_id AND newer.completed_at IS NOT NULL AND (newer.started_at,newer.id)>(h.started_at,h.id))`,
        date: "h.started_at", project: "e.project_id",
      };
      case "fileImports": return {
        table: "file_import_history", from: `${n}file_import_history h`,
        eligible: `${includeFailedImports ? "h.status IN ('success','failed','partial')" : "h.status='success' AND COALESCE(h.records_failed,0)=0"} AND h.completed_at IS NOT NULL AND (h.file_import_config_id IS NULL OR EXISTS (SELECT 1 FROM ${n}file_import_history newer WHERE newer.file_import_config_id=h.file_import_config_id AND newer.completed_at IS NOT NULL AND (newer.started_at,newer.id)>(h.started_at,h.id)))`,
        date: "h.started_at", project: "h.project_id",
      };
      case "fileExports": return {
        table: "file_export_attempts", from: `${n}file_export_attempts h JOIN ${n}file_export_runs r ON r.id=h.run_id`,
        eligible: `r.status='success' AND r.completed_at IS NOT NULL AND h.completed_at IS NOT NULL AND h.status IN ('success','failed')
          AND EXISTS (SELECT 1 FROM ${n}file_export_runs newer WHERE newer.config_id=r.config_id AND newer.completed_at IS NOT NULL AND (newer.created_at,newer.id)>(r.created_at,r.id))`,
        date: "h.started_at", project: "r.project_id",
      };
      case "sftpActivity": return {
        table: "sftp_server_events", from: `${n}sftp_server_events h`, eligible: "true", date: "h.created_at", project: "h.project_id",
      };
      case "httpsActivity": return {
        table: "https_transfer_events", from: `${n}https_transfer_events h`, eligible: "true", date: "h.created_at", project: "h.project_id",
      };
      default: throw new Error("Not a database history category");
    }
  }
  async inventory(): Promise<LogInventory[]> {
    return Promise.all(databaseCategories.map(async category => {
      const s = this.spec(category);
      const manual = this.spec(category, true);
      const { rows: [r] } = await this.pool.query(`SELECT count(*)::int count,
        COALESCE(sum(pg_column_size(h)),0)::float8 bytes,
        count(*) FILTER (WHERE NOT COALESCE((${manual.eligible}),false))::int protected,
        count(*) FILTER (WHERE COALESCE((${manual.eligible}),false) AND NOT COALESCE((${s.eligible}),false))::int manual_only,
        min(${s.date}) oldest,max(${s.date}) newest FROM ${s.from}`);
      return { category, count:r.count, bytes:r.bytes, protectedCount:r.protected, manualOnlyCount:r.manual_only, oldest:r.oldest?.toISOString() || null, newest:r.newest?.toISOString() || null };
    }));
  }
  async candidates(filter: CleanupFilter, limit = 501): Promise<RowCandidate[]> {
    const result: RowCandidate[] = [];
    for (const category of databaseCategories.filter(c => filter.categories.includes(c))) {
      if (result.length >= limit) break;
      const s = this.spec(category, filter.includeFailedImports === true);
      const { rows } = await this.pool.query(`SELECT h.id::text id,pg_column_size(h)::float8 bytes FROM ${s.from}
        WHERE (${s.eligible}) AND ${s.date}<$1 AND ($2::integer IS NULL OR ${s.project}=$2)
        ORDER BY ${s.date},h.id LIMIT $3`, [filter.before,filter.projectId || null,limit-result.length]);
      result.push(...rows.map(r => ({ category,...r })));
    }
    return result;
  }
  async remove(client: PoolClient, row: RowCandidate, filter: CleanupFilter): Promise<boolean> {
    const s = this.spec(row.category, filter.includeFailedImports === true);
    // Delivered parents are terminal. Lock one anyway so concurrent queue changes
    // cannot invalidate the eligibility check between SELECT and DELETE.
    if (row.category === "customerApi") {
      await client.query(`SELECT d.id FROM ${this.ns}customer_api_deliveries d JOIN ${this.ns}customer_api_logs h ON h.delivery_id=d.id WHERE h.id::text=$1 FOR SHARE OF d`, [row.id]);
    }
    if (row.category === "fileExports") {
      await client.query(`SELECT r.id FROM ${this.ns}file_export_runs r JOIN ${this.ns}file_export_attempts h ON h.run_id=r.id WHERE h.id::text=$1 FOR SHARE OF r`, [row.id]);
    }
    const { rows } = await client.query(`SELECT h.id FROM ${s.from} WHERE h.id::text=$1 AND (${s.eligible})
      AND ${s.date}<$2 AND ($3::integer IS NULL OR ${s.project}=$3) FOR UPDATE OF h SKIP LOCKED`, [row.id,filter.before,filter.projectId || null]);
    if (!rows.length) return false;
    const deleted = await client.query(`DELETE FROM ${this.ns}${s.table} WHERE id=$1`, [rows[0].id]);
    return deleted.rowCount === 1;
  }
  async setting(key: string) {
    const { rows } = await this.pool.query(`SELECT value FROM ${this.ns}system_settings WHERE key=$1`, [key]);
    return rows[0]?.value;
  }
  async set(client: PoolClient, key: string, value: unknown) {
    await client.query(`INSERT INTO ${this.ns}system_settings(key,value) VALUES($1,$2)
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,[key,JSON.stringify(value)]);
  }
}
