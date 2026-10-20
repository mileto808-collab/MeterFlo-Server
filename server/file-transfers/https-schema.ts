export const httpsDdl = `
CREATE TABLE IF NOT EXISTS public.https_transfer_settings (
 project_id integer PRIMARY KEY CONSTRAINT hx_settings_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 enabled boolean NOT NULL DEFAULT false,provider text NOT NULL,location text NOT NULL,retention_days integer NOT NULL DEFAULT 30,
 updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS public.https_transfer_credentials (
 id uuid PRIMARY KEY,project_id integer NOT NULL CONSTRAINT hx_credential_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 name text NOT NULL,token_hash text NOT NULL,token_prefix text NOT NULL,can_upload boolean NOT NULL,can_download boolean NOT NULL,
 expires_at timestamptz NOT NULL,revoked_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),last_used_at timestamptz);
CREATE INDEX IF NOT EXISTS hx_credentials_project ON public.https_transfer_credentials(project_id);
CREATE TABLE IF NOT EXISTS public.https_transfer_files (
 id uuid PRIMARY KEY,project_id integer NOT NULL CONSTRAINT hx_file_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 direction text NOT NULL,credential_id uuid CONSTRAINT hx_file_credential_fk REFERENCES public.https_transfer_credentials(id),
 file_name text NOT NULL,size bigint NOT NULL,sha256 text NOT NULL,idempotency_key text,export_run_id uuid,
 provider text NOT NULL,location text NOT NULL,storage_key text NOT NULL,status text NOT NULL,message text,
 created_at timestamptz NOT NULL DEFAULT now(),processed_at timestamptz,acknowledged_at timestamptz,processing_config_id integer);
CREATE INDEX IF NOT EXISTS hx_files_project ON public.https_transfer_files(project_id,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS hx_upload_identity ON public.https_transfer_files(credential_id,idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS hx_export_identity ON public.https_transfer_files(export_run_id);
CREATE TABLE IF NOT EXISTS public.https_transfer_events (
 id uuid PRIMARY KEY,project_id integer NOT NULL CONSTRAINT hx_event_project_fk REFERENCES public.projects(id) ON DELETE CASCADE,
 credential_id uuid,file_id uuid,action text NOT NULL,message text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS hx_events_project ON public.https_transfer_events(project_id,created_at);
`;
