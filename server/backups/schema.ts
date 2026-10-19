import type { Pool } from "pg";

export const backupDdl = `
CREATE TABLE IF NOT EXISTS public.backup_destination (
  id integer PRIMARY KEY CHECK(id=1), kind text NOT NULL CHECK(kind IN ('local','app_storage')),
  path text NOT NULL, bucket_id text NOT NULL DEFAULT '', updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.backup_schedules (
  id uuid PRIMARY KEY, name text NOT NULL, backup_type text NOT NULL CHECK(backup_type IN ('database','clean','files','project')),
  cron text NOT NULL, timezone text NOT NULL, enabled boolean NOT NULL DEFAULT false,
  retention_days integer NOT NULL CHECK(retention_days BETWEEN 1 AND 3650),
  minimum_copies integer NOT NULL CHECK(minimum_copies BETWEEN 1 AND 100),
  next_run_at timestamptz, deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.backup_runs (
  id uuid PRIMARY KEY, schedule_id uuid NOT NULL CONSTRAINT backup_runs_schedule_id_backup_schedules_id_fk REFERENCES public.backup_schedules(id),
  schedule_name text NOT NULL, backup_type text NOT NULL CHECK(backup_type IN ('database','clean','files','project')),
  trigger text NOT NULL CHECK(trigger IN ('scheduled','manual')),
  status text NOT NULL CHECK(status IN ('queued','running','succeeded','failed','interrupted','cancelled','expired')),
  destination_kind text NOT NULL CHECK(destination_kind IN ('local','app_storage')),
  destination_path text NOT NULL, bucket_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, completed_at timestamptz,
  bytes bigint, error text, cleanup_error text
);
CREATE INDEX IF NOT EXISTS backup_schedules_due ON public.backup_schedules(next_run_at) WHERE enabled AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS backup_runs_history ON public.backup_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS backup_runs_schedule ON public.backup_runs(schedule_id,completed_at DESC);
`;
export async function migrateBackupSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('meterflo-backup-schema'))");
    await client.query(backupDdl);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function initializeBackupSchema(pool: Pool) {
  if (!process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1") await migrateBackupSchema(pool);
  await pool.query("SELECT id FROM public.backup_schedules LIMIT 0");
  await pool.query("SELECT id FROM public.backup_destination LIMIT 0");
  await pool.query("SELECT id FROM public.backup_runs LIMIT 0");
}
