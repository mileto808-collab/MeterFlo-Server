import type { Pool } from "pg";
import { httpsDdl } from "./https-schema";
import { embeddedSftpDdl } from "./embedded-schema";
export const transferDdl = `
ALTER TABLE public.file_import_configs ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'local';
ALTER TABLE public.file_import_configs ADD COLUMN IF NOT EXISTS remote_directory text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS public.project_sftp_connections (
 project_id integer PRIMARY KEY CONSTRAINT ft_sftp_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 name text NOT NULL,host text NOT NULL,port integer NOT NULL,username text NOT NULL,host_fingerprint text NOT NULL,
 auth_type text NOT NULL,encrypted_secret text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.file_exports (
 id uuid PRIMARY KEY,project_id integer NOT NULL CONSTRAINT ft_exports_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 name text NOT NULL,format text NOT NULL,mode text NOT NULL,all_statuses boolean NOT NULL,filename_template text NOT NULL,columns jsonb NOT NULL,
 destination text NOT NULL,remote_directory text NOT NULL DEFAULT '',schedule_frequency text NOT NULL,custom_cron_expression text,
 is_enabled boolean NOT NULL DEFAULT false,next_run_at timestamptz,last_run_at timestamptz,last_run_status text,last_run_message text,
 deleted_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS ft_exports_due ON public.file_exports(next_run_at) WHERE is_enabled AND deleted_at IS NULL;
ALTER TABLE public.file_exports ADD COLUMN IF NOT EXISTS schedule_timezone text;
CREATE TABLE IF NOT EXISTS public.file_export_statuses (
 config_id uuid NOT NULL CONSTRAINT ft_status_config_fk REFERENCES public.file_exports(id) ON DELETE CASCADE,
 status_id integer NOT NULL CONSTRAINT ft_status_value_fk REFERENCES public.work_order_statuses(id) ON DELETE CASCADE,
 PRIMARY KEY(config_id,status_id));
CREATE TABLE IF NOT EXISTS public.file_export_substatuses (
 config_id uuid NOT NULL CONSTRAINT ft_substatus_config_fk REFERENCES public.file_exports(id) ON DELETE CASCADE,
 sub_status_id uuid NOT NULL CONSTRAINT ft_substatus_value_fk REFERENCES public.work_order_sub_statuses(id) ON DELETE CASCADE,
 PRIMARY KEY(config_id,sub_status_id));
CREATE TABLE IF NOT EXISTS public.file_export_runs (
 id uuid PRIMARY KEY,config_id uuid NOT NULL CONSTRAINT ft_run_config_fk REFERENCES public.file_exports(id) ON DELETE CASCADE,
 project_id integer NOT NULL CONSTRAINT ft_run_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 config_name text NOT NULL,snapshot jsonb NOT NULL,file_name text NOT NULL,status text NOT NULL,record_count integer NOT NULL DEFAULT 0,
 attempts integer NOT NULL DEFAULT 0,message text,created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,
 captured boolean NOT NULL DEFAULT false);
CREATE INDEX IF NOT EXISTS ft_runs_history ON public.file_export_runs(project_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS ft_runs_unresolved ON public.file_export_runs(config_id) WHERE status IN ('queued','running','failed','interrupted');
CREATE TABLE IF NOT EXISTS public.file_export_run_items (
 run_id uuid NOT NULL CONSTRAINT ft_item_run_fk REFERENCES public.file_export_runs(id) ON DELETE CASCADE,
 work_order_id integer NOT NULL,content_hash text NOT NULL,payload jsonb NOT NULL,PRIMARY KEY(run_id,work_order_id));
CREATE TABLE IF NOT EXISTS public.file_export_checkpoints (
 config_id uuid NOT NULL CONSTRAINT ft_checkpoint_config_fk REFERENCES public.file_exports(id) ON DELETE CASCADE,
 work_order_id integer NOT NULL,content_hash text NOT NULL,PRIMARY KEY(config_id,work_order_id));
CREATE TABLE IF NOT EXISTS public.file_export_attempts (
 id uuid PRIMARY KEY,run_id uuid NOT NULL CONSTRAINT ft_attempt_run_fk REFERENCES public.file_export_runs(id) ON DELETE CASCADE,
 status text NOT NULL,message text,started_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE INDEX IF NOT EXISTS ft_attempt_run ON public.file_export_attempts(run_id,started_at);
CREATE TABLE IF NOT EXISTS public.file_import_receipts (
 config_id integer NOT NULL CONSTRAINT ft_receipt_config_fk REFERENCES public.file_import_configs(id) ON DELETE CASCADE,
 content_hash text NOT NULL,source_identity text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(config_id,content_hash));
CREATE INDEX IF NOT EXISTS ft_receipts_identity ON public.file_import_receipts(config_id,source_identity);
CREATE TABLE IF NOT EXISTS public.file_import_generated_ids (
 config_id integer NOT NULL CONSTRAINT ft_generated_config_fk REFERENCES public.file_import_configs(id) ON DELETE CASCADE,
 content_hash text NOT NULL,row_number integer NOT NULL,customer_wo_id text NOT NULL,PRIMARY KEY(config_id,content_hash,row_number));
`;
export async function migrateFileTransfers(pool: Pool) {
  const client = await pool.connect();
  try { await client.query("BEGIN"); await client.query("SELECT pg_advisory_xact_lock(hashtext('file-transfer-schema'))"); await client.query(transferDdl + httpsDdl + embeddedSftpDdl); await client.query("COMMIT"); }
  catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function initializeFileTransfers(pool: Pool) {
  if (!process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1") return migrateFileTransfers(pool);
  await pool.query("SELECT source,remote_directory FROM public.file_import_configs LIMIT 0");
  await pool.query("SELECT schedule_timezone FROM public.file_exports LIMIT 0");
  for (const table of ["project_sftp_connections", "file_exports", "file_export_statuses", "file_export_substatuses", "file_export_runs",
    "file_export_run_items", "file_export_checkpoints", "file_export_attempts", "file_import_receipts", "file_import_generated_ids",
    "https_transfer_settings", "https_transfer_credentials", "https_transfer_files", "https_transfer_events",
    "sftp_server_settings", "sftp_server_accounts", "sftp_server_events"])
    await pool.query(`SELECT * FROM public.${table} LIMIT 0`);
}
