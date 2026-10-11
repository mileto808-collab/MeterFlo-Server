export const API_IMPORT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.api_import_configs (
  id serial PRIMARY KEY, project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  settings jsonb NOT NULL, cursor text, watermark timestamptz, next_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.api_import_runs (
  id text PRIMARY KEY, config_id integer REFERENCES public.api_import_configs(id) ON DELETE SET NULL,
  project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  config_name text NOT NULL, settings jsonb NOT NULL, checkpoint jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'queued', triggered_by text NOT NULL,
  current_url text, page_number integer NOT NULL DEFAULT 0, page_value integer NOT NULL DEFAULT 1,
  candidate_cursor text, visited jsonb NOT NULL DEFAULT '[]',
  created_count integer NOT NULL DEFAULT 0, updated_count integer NOT NULL DEFAULT 0,
  skipped_count integer NOT NULL DEFAULT 0, failed_count integer NOT NULL DEFAULT 0,
  fetch_attempts integer NOT NULL DEFAULT 0, page_attempts integer NOT NULL DEFAULT 0,
  messages jsonb NOT NULL DEFAULT '[]', heartbeat_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS api_import_one_active_run ON public.api_import_runs(config_id)
  WHERE status IN ('queued','running','retrying');
CREATE INDEX IF NOT EXISTS api_import_due ON public.api_import_runs(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS api_import_project_history ON public.api_import_runs(project_id,started_at DESC);
CREATE TABLE IF NOT EXISTS public.api_import_versions (
  project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_order_id integer NOT NULL, customer_wo_id text NOT NULL, row_version text NOT NULL,
  PRIMARY KEY(project_id,work_order_id)
);
`;
