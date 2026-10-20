import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { cleanupFilterSchema, defaultLogPolicy, logPolicySchema, type CleanupFilter, type CleanupPreview, type CleanupResult, type LogPolicy, type LogSummary } from "../shared/log-maintenance";
import { LogFiles, type FileCandidate } from "./logMaintenanceFiles";
import { LogRepository, type RowCandidate } from "./logMaintenanceRepository";

const POLICY = "logMaintenance.policy";
const HISTORY = "logMaintenance.history";
const LOCK = 715294;
type PreviewState = { actor: string; expires: number; policy: string; filter: CleanupFilter; files: FileCandidate[]; rows: RowCandidate[] };
export class MaintenanceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export class LogMaintenanceService {
  private previews = new Map<string, PreviewState>();
  constructor(readonly repository: LogRepository, readonly files = new LogFiles(), readonly applyRotation: (mib: number) => void = () => {}) {}
  async policy(): Promise<LogPolicy> {
    const raw = await this.repository.setting(POLICY);
    return raw ? logPolicySchema.parse(JSON.parse(raw)) : { ...defaultLogPolicy };
  }
  async history(): Promise<CleanupResult[]> {
    const raw = await this.repository.setting(HISTORY);
    return raw ? JSON.parse(raw) : [];
  }
  private async locked<T>(operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.repository.pool.connect();
    let acquired = false;
    try {
      const { rows: [r] } = await client.query("SELECT pg_try_advisory_lock($1) acquired",[LOCK]);
      acquired = r.acquired;
      if (!acquired) throw new MaintenanceError("Another log-maintenance operation is running. Try again later.",409);
      return await operation(client);
    } finally {
      if (acquired) await client.query("SELECT pg_advisory_unlock($1)",[LOCK]).catch(() => {});
      client.release();
    }
  }
  async savePolicy(value: unknown, actor: string) {
    const policy = logPolicySchema.parse(value);
    await this.locked(async client => {
      await client.query("BEGIN");
      try {
        await this.repository.set(client,POLICY,policy);
        const history = await this.history();
        history.unshift({ at:new Date().toISOString(),actor,removed:0,skipped:0,bytes:0,errors:[], action:"policySaved" });
        await this.repository.set(client,HISTORY,history.slice(0,20));
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
    });
    this.applyRotation(policy.rotationMiB);
    this.previews.clear();
    return policy;
  }
  async summary(): Promise<LogSummary> {
    const warnings = [
      "PM2/stdout, reverse-proxy, operating-system and other applications' logs are externally managed; these controls do not clear them.",
      "Delivery/export payloads, files, receipts, checkpoints, active/retryable work and latest completed import/export diagnostics are preserved. Audit and backup retention are separate.",
      "Completed failed/partial import histories require an explicit manual-cleanup selection and confirmation; automatic retention never removes them.",
    ];
    let fileInventory: ReturnType<LogFiles["inventory"]> = [];
    try { fileInventory = this.files.inventory(this.files.list()); } catch { warnings.push("File inventory unavailable: check LOG_DIR, directory limits and filesystem permissions. Symlinks are not supported."); }
    const inventory = [...fileInventory,...await this.repository.inventory()];
    let policy = { ...defaultLogPolicy };
    try { policy = await this.policy(); } catch { warnings.push("Saved retention policy is invalid. Automatic cleanup is disabled until a valid policy is saved."); }
    const n = this.repository.ns;
    const { rows: projects } = await this.repository.pool.query(`SELECT id,name FROM ${n}projects ORDER BY name`);
    const { rows: [payloads] } = await this.repository.pool.query(`SELECT COALESCE(sum(pg_column_size(snapshot)+pg_column_size(payload)),0)::float8 bytes FROM ${n}customer_api_deliveries`);
    return { policy, inventory,projects,history:await this.history(),protectedBytes:payloads.bytes,warnings };
  }
  async preview(value: unknown, actor: string): Promise<CleanupPreview> {
    const filter = cleanupFilterSchema.parse(value);
    if (new Date(filter.before).getTime() > Date.now()) throw new MaintenanceError("Choose a cutoff in the past.");
    if (filter.projectId && filter.categories.some(c => c === "activeError" || c === "errorArchives")) throw new MaintenanceError("File logs are global. Remove the project filter or file categories.");
    const policy = JSON.stringify(await this.policy());
    const files = filter.categories.some(c => c === "activeError" || c === "errorArchives")
      ? this.files.list().filter(f => filter.categories.includes(f.category) && f.mtime < Date.parse(filter.before)).sort((a,b) => a.mtime-b.mtime) : [];
    const rows = await this.repository.candidates(filter,501);
    const selectedFiles = files.slice(0,500);
    const selectedRows = rows.slice(0,500-selectedFiles.length);
    const token = randomUUID(), expires = Date.now()+10*60*1000;
    for (const [key,p] of this.previews) if (p.expires < Date.now()) this.previews.delete(key);
    if (this.previews.size >= 100) this.previews.delete(this.previews.keys().next().value!);
    this.previews.set(token,{ actor,expires,filter,policy,files:selectedFiles,rows:selectedRows });
    return { token,expiresAt:new Date(expires).toISOString(),count:selectedFiles.length+selectedRows.length,
      bytes:[...selectedFiles,...selectedRows].reduce((n,r) => n+r.bytes,0), limited:files.length+rows.length>500,filter };
  }
  async cleanup(token: string, actor: string) {
    const preview = this.previews.get(token);
    if (!preview || preview.actor !== actor || preview.expires < Date.now()) throw new MaintenanceError("Preview expired or belongs to another operator. Preview again.",409);
    return this.locked(async client => {
      if (preview.policy !== JSON.stringify(await this.policy())) throw new MaintenanceError("Retention settings changed. Preview again.",409);
      this.previews.delete(token);
      return this.execute(client,preview,actor);
    });
  }
  private async execute(client: PoolClient, preview: Pick<PreviewState,"filter"|"files"|"rows">, actor: string): Promise<CleanupResult> {
    const result: CleanupResult = { at:new Date().toISOString(),actor,removed:0,skipped:0,bytes:0,errors:[],
      categories:[...new Set([...preview.filter.categories,...preview.files.map(file => file.category)])],includeFailedImports:preview.filter.includeFailedImports === true,
      projectId:preview.filter.projectId,before:preview.filter.before };
    // Audit intent first. A crash leaves an interrupted operation visible.
    const history = await this.history();
    const intent = { ...result, errors:["Cleanup started; completion has not yet been recorded."] };
    await this.repository.set(client,HISTORY,[intent,...history].slice(0,20));
    const deadline = Date.now()+15000;
    for (const [index,row] of preview.rows.entries()) {
      if (Date.now() > deadline) {
        result.skipped += preview.rows.length-index;
        result.errors.push("Cleanup time limit reached; preview again for remaining history.");
        break;
      }
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='5s'");
        const deleted = await this.repository.remove(client,row,preview.filter);
        await client.query("COMMIT");
        if (deleted) { result.removed++; result.bytes += row.bytes; } else result.skipped++;
      } catch {
        await client.query("ROLLBACK");
        result.errors.push(`${row.category}: database cleanup failed; row retained.`);
      }
    }
    for (const file of preview.files) {
      try {
        if (this.files.remove(file)) { result.removed++; result.bytes += file.bytes; } else result.skipped++;
      } catch { result.errors.push(`${file.category}: file cleanup failed; check filesystem permissions.`); }
    }
    result.errors = [...new Set(result.errors)];
    await this.repository.set(client,HISTORY,[result,...history].slice(0,20));
    return result;
  }
  async automatic() {
    const policy = await this.policy();
    this.applyRotation(policy.rotationMiB);
    if (!policy.automatic) return;
    await this.locked(async client => {
      // Re-read under the lock so a disable/save cannot race deletion.
      const current = await this.policy();
      if (!current.automatic) return;
      const now = Date.now();
      const filter: CleanupFilter = { categories:current.historyCategories,before:new Date(now-current.historyDays*86400000).toISOString() };
      // Give each selected history a bounded share, leaving space for archives.
      // A busy API log must not starve other histories or file-budget cleanup.
      const share = Math.floor(400 / Math.max(1, current.historyCategories.length));
      const rows: RowCandidate[] = [];
      for (const category of current.historyCategories) {
        rows.push(...await this.repository.candidates({ ...filter, categories:[category] },share));
      }
      const archives = this.files.list().filter(f => f.category === "errorArchives").sort((a,b) => a.mtime-b.mtime);
      let total = archives.reduce((n,f) => n+f.bytes,0);
      const files = archives.filter(f => {
        if (f.mtime < now-current.archiveDays*86400000 || total > current.archiveBudgetMiB*1048576) { total -= f.bytes; return true; }
        return false;
      }).slice(0,500-rows.length);
      // Preserve quiet audit history rather than overwriting last cleanup every tick.
      if (rows.length || files.length) await this.execute(client,{ filter,files,rows },"scheduled");
    });
  }
}
