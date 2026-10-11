/** Additive, idempotent bootstrap for existing independent installations. */
export const CUSTOMER_API_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.customer_api_deliveries (
  id text PRIMARY KEY,
  project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  work_order_id integer NOT NULL,
  customer_wo_id varchar(100),
  version_key text NOT NULL,
  snapshot jsonb NOT NULL,
  payload text,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempt_count integer NOT NULL DEFAULT 0,
  cycle_attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  lock_token text,
  last_error text,
  last_response_status integer,
  requested_by text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, work_order_id, version_key)
);
CREATE INDEX IF NOT EXISTS customer_api_deliveries_due ON public.customer_api_deliveries(status, next_attempt_at);
ALTER TABLE public.customer_api_logs ADD COLUMN IF NOT EXISTS delivery_id text;
ALTER TABLE public.customer_api_logs ADD COLUMN IF NOT EXISTS attempt_number integer;
ALTER TABLE public.customer_api_logs ADD COLUMN IF NOT EXISTS triggered_by text;
CREATE INDEX IF NOT EXISTS customer_api_logs_delivery ON public.customer_api_logs(delivery_id);
`;
