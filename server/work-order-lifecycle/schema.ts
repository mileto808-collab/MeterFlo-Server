import type { Pool, PoolClient } from "pg";
type Connection = Pick<PoolClient, "query">;
export function projectSchema(schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  return `"${schema}"`;
}
export async function installWorkOrderLifecycle(client: Connection, schema: string) {
  const name = projectSchema(schema);
  await client.query(`ALTER TABLE ${name}.work_orders
    ADD COLUMN IF NOT EXISTS closed_at timestamptz,
    ADD COLUMN IF NOT EXISTS closed_by varchar(100),
    ADD COLUMN IF NOT EXISTS review_started_at timestamptz`);
  await client.query(`CREATE INDEX IF NOT EXISTS work_orders_closing_candidates ON ${name}.work_orders(status,completed_at)`);
  await client.query(`DROP TRIGGER IF EXISTS meterflo_closed_guard ON ${name}.work_orders;
    CREATE TRIGGER meterflo_closed_guard BEFORE INSERT OR UPDATE OR DELETE ON ${name}.work_orders
    FOR EACH ROW EXECUTE FUNCTION public.meterflo_closed_guard()`);
}
/** Explicit development migration; standalone upgrades use the same additive migration. */
export async function migrateWorkOrderLifecycle(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('meterflo-work-order-lifecycle'))");
    await client.query(`INSERT INTO public.work_order_statuses(code,label,color,is_default,sort_order)
      VALUES('Closed','Closed','gray',false,5) ON CONFLICT(code) DO NOTHING;
    CREATE TABLE IF NOT EXISTS public.work_order_closing_policy (
      project_id integer PRIMARY KEY REFERENCES public.projects(id) ON DELETE CASCADE,
      enabled boolean NOT NULL DEFAULT false,
      after_hours integer NOT NULL DEFAULT 168 CHECK(after_hours BETWEEN 1 AND 87600),
      enabled_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE OR REPLACE FUNCTION public.meterflo_work_order_status_is(value text, core text)
    RETURNS boolean LANGUAGE sql STABLE AS $$
      SELECT lower(value)=lower(core) OR EXISTS(SELECT 1 FROM public.work_order_statuses s
        WHERE lower(s.code)=lower(core) AND (value=s.code OR value=s.label))
    $$;
    CREATE OR REPLACE FUNCTION public.meterflo_closed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE authorized boolean := coalesce(current_setting('meterflo.lifecycle_write',true),'')='authorized';
      source text := coalesce(nullif(current_setting('meterflo.audit_context',true),'')::jsonb->>'source','');
    BEGIN
      -- Explicit restores preserve historical Closed records; normal imports never do.
      IF source='restore' THEN
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;
      IF TG_OP<>'INSERT' AND public.meterflo_work_order_status_is(OLD.status,'Closed') AND NOT authorized THEN
        RAISE EXCEPTION 'Closed work orders must be explicitly reopened by an authorized user before corrections.'
          USING ERRCODE='P0001';
      END IF;
      IF TG_OP<>'DELETE' AND public.meterflo_work_order_status_is(NEW.status,'Closed') AND NOT authorized THEN
        RAISE EXCEPTION 'Use the authorized close action. Only Completed work orders can be closed.'
          USING ERRCODE='P0001';
      END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$;
    CREATE OR REPLACE FUNCTION public.meterflo_closed_time_guard() RETURNS trigger LANGUAGE plpgsql AS $$
    DECLARE ref jsonb; dbname text; locked boolean;
    BEGIN
      IF coalesce(nullif(current_setting('meterflo.audit_context',true),'')::jsonb->>'source','')='restore' THEN
        IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
      END IF;
      FOR ref IN SELECT value FROM jsonb_array_elements(
        CASE WHEN TG_OP='INSERT' THEN jsonb_build_array(to_jsonb(NEW))
          WHEN TG_OP='DELETE' THEN jsonb_build_array(to_jsonb(OLD))
          ELSE jsonb_build_array(to_jsonb(OLD),to_jsonb(NEW)) END) LOOP
        SELECT database_name INTO dbname FROM public.projects WHERE id=(ref->>'project_id')::integer;
        IF dbname IS NOT NULL THEN
          EXECUTE format('SELECT bool_or(public.meterflo_work_order_status_is(status,''Closed''))
            FROM (SELECT status FROM %I.work_orders WHERE coalesce(nullif(customer_wo_id,''''),id::text)=$1 FOR SHARE) w',dbname)
            INTO locked USING ref->>'system_work_order_id';
          IF locked THEN RAISE EXCEPTION 'Reopen Closed work orders before changing time records.' USING ERRCODE='P0001'; END IF;
        END IF;
      END LOOP;
      IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
    END $$;
    DROP TRIGGER IF EXISTS meterflo_closed_time_guard ON public.work_order_time_tracking;
    CREATE TRIGGER meterflo_closed_time_guard BEFORE INSERT OR UPDATE OR DELETE ON public.work_order_time_tracking
    FOR EACH ROW EXECUTE FUNCTION public.meterflo_closed_time_guard()`);
    const { rows } = await client.query("SELECT database_name FROM public.projects WHERE database_name IS NOT NULL");
    for (const row of rows) {
      if (!/^project_[a-z0-9_]+$/.test(row.database_name)) continue;
      if ((await client.query("SELECT to_regclass($1) name", [`"${row.database_name}".work_orders`])).rows[0]?.name)
        await installWorkOrderLifecycle(client, row.database_name);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
export async function initializeWorkOrderLifecycle(pool: Pool) {
  // Managed production uses Publish's schema diff, not startup DDL.
  if (!process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1") await migrateWorkOrderLifecycle(pool);
  await pool.query("SELECT enabled,after_hours FROM public.work_order_closing_policy LIMIT 0");
}
