import type { Pool } from "pg";

export const CHANGEOUT_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS public.changeout_drafts(
 project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, work_order_id integer NOT NULL,
 user_id text NOT NULL, submission_id uuid NOT NULL, assignment_version integer NOT NULL, revision integer NOT NULL,
 step text NOT NULL, capture jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(project_id,work_order_id,user_id,submission_id));
CREATE TABLE IF NOT EXISTS public.changeout_completions(
 id uuid PRIMARY KEY, project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 work_order_id integer NOT NULL, actor_id text NOT NULL, actor_label text NOT NULL, fingerprint text NOT NULL,
 assignment_version integer NOT NULL, evidence jsonb NOT NULL, status text NOT NULL, attempts integer NOT NULL DEFAULT 0,
 error text, next_attempt_at timestamptz NOT NULL DEFAULT now(), reviewed_usage jsonb, reviewed_by text, review_reason text,
 created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz);
CREATE INDEX IF NOT EXISTS changeout_completion_queue ON public.changeout_completions(status,next_attempt_at);
CREATE INDEX IF NOT EXISTS changeout_completion_project_history ON public.changeout_completions(project_id,created_at);
CREATE TABLE IF NOT EXISTS public.changeout_installation_claims(
 project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE, item_id text NOT NULL, serial text NOT NULL,
 work_order_id integer NOT NULL, completion_id uuid NOT NULL REFERENCES public.changeout_completions(id) ON DELETE CASCADE,
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(project_id,item_id,serial));
CREATE TABLE IF NOT EXISTS public.changeout_events(
 id bigserial PRIMARY KEY,project_id integer NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
 work_order_id integer,type text NOT NULL,actor_id text,operation_id text,created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS changeout_event_operation ON public.changeout_events(project_id,work_order_id,type,operation_id);
CREATE OR REPLACE FUNCTION public.changeout_event_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_notify('meterflo_changeouts',json_build_object('type',NEW.type,'projectId',NEW.project_id,
   'workOrderId',NEW.work_order_id,'userId',NEW.actor_id,'timestamp',NEW.created_at,'id',NEW.id)::text);
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS changeout_event_notify ON public.changeout_events;
CREATE TRIGGER changeout_event_notify AFTER INSERT ON public.changeout_events FOR EACH ROW EXECUTE FUNCTION public.changeout_event_notify();
CREATE OR REPLACE FUNCTION public.changeout_assignment_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id OR OLD.assigned_group_id IS DISTINCT FROM NEW.assigned_group_id
 OR (OLD.status IS DISTINCT FROM NEW.status
   AND lower(COALESCE((SELECT code FROM public.work_order_statuses WHERE lower(code)=lower(OLD.status) OR lower(label)=lower(OLD.status) LIMIT 1),OLD.status)) IN ('completed','closed','cancelled')
   AND lower(COALESCE((SELECT code FROM public.work_order_statuses WHERE lower(code)=lower(NEW.status) OR lower(label)=lower(NEW.status) LIMIT 1),NEW.status)) IN ('open','scheduled')) THEN
   NEW.assignment_version := OLD.assignment_version + 1;
 ELSE NEW.assignment_version := OLD.assignment_version; END IF;
 RETURN NEW;
END $$;`;

export async function installChangeoutProject(client: { query: Function }, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema");
  await client.query(`ALTER TABLE "${schema}".work_orders ADD COLUMN IF NOT EXISTS assignment_version integer NOT NULL DEFAULT 0;
    DROP TRIGGER IF EXISTS changeout_assignment_version ON "${schema}".work_orders;
    CREATE TRIGGER changeout_assignment_version BEFORE UPDATE ON "${schema}".work_orders
    FOR EACH ROW EXECUTE FUNCTION public.changeout_assignment_version()`);
}
export async function migrateChangeoutSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(CHANGEOUT_SCHEMA_SQL);
    const { rows } = await client.query("SELECT database_name FROM public.projects WHERE database_name IS NOT NULL");
    for (const row of rows) {
      const found = await client.query("SELECT to_regclass($1) AS name", [`"${row.database_name}".work_orders`]);
      if (found.rows[0]?.name) await installChangeoutProject(client, row.database_name);
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
}
export async function initializeChangeoutSchema(pool: Pool) {
  // Hosted production schema is transported by Publish, never startup DDL.
  if (!process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1") await migrateChangeoutSchema(pool);
  await pool.query("SELECT id FROM public.changeout_completions LIMIT 0");
}
