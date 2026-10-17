import type { PoolClient } from "pg";
import { pool } from "./db";
import { validateVisitScheduling } from "../shared/visitScheduling";

export async function installVisitScheduling(client: Pick<PoolClient, "query">, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  await client.query(`ALTER TABLE "${schema}".work_orders
    ADD COLUMN IF NOT EXISTS service_duration_minutes integer,
    ADD COLUMN IF NOT EXISTS appointment_window_start timestamptz,
    ADD COLUMN IF NOT EXISTS appointment_window_end timestamptz;
    DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"${schema}".work_orders'::regclass AND conname='visit_duration_range') THEN
      ALTER TABLE "${schema}".work_orders ADD CONSTRAINT visit_duration_range CHECK(service_duration_minutes BETWEEN 1 AND 480);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='"${schema}".work_orders'::regclass AND conname='visit_window_pair') THEN
      ALTER TABLE "${schema}".work_orders ADD CONSTRAINT visit_window_pair CHECK(
        (appointment_window_start IS NULL AND appointment_window_end IS NULL) OR
        (appointment_window_start IS NOT NULL AND appointment_window_end IS NOT NULL AND appointment_window_end >= appointment_window_start));
    END IF; END $$;`);
}

export async function initializeVisitScheduling(connection: Pick<PoolClient, "query"> = pool) {
  // Keep schema-tool-first standalone upgrades safe too: adding these columns
  // must never backfill old projects. New-project defaults belong to creation,
  // not SQL column defaults that would also affect legacy restores.
  await connection.query(`ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS default_service_minutes integer,
    ADD COLUMN IF NOT EXISTS default_appointment_tolerance_minutes integer;
    DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.projects'::regclass AND conname='visit_default_duration_range') THEN
      ALTER TABLE public.projects ADD CONSTRAINT visit_default_duration_range CHECK(default_service_minutes BETWEEN 1 AND 480);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.projects'::regclass AND conname='visit_default_tolerance_range') THEN
      ALTER TABLE public.projects ADD CONSTRAINT visit_default_tolerance_range CHECK(default_appointment_tolerance_minutes BETWEEN 0 AND 240);
    END IF; END $$;
    ALTER TABLE public.projects ALTER COLUMN default_service_minutes DROP DEFAULT;
    ALTER TABLE public.projects ALTER COLUMN default_appointment_tolerance_minutes DROP DEFAULT;`);
  const { rows } = await connection.query("SELECT database_name FROM public.projects WHERE database_name IS NOT NULL");
  for (const row of rows) {
    if (!/^project_[a-z0-9_]+$/.test(row.database_name)) continue;
    const exists = await connection.query("SELECT to_regclass($1) AS name", [`"${row.database_name}".work_orders`]);
    if (exists.rows[0].name) await installVisitScheduling(connection, row.database_name);
  }
}

export async function writeVisitScheduling(client: Pick<PoolClient, "query">, schema: string, id: number, value: unknown) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  const fields = validateVisitScheduling(value);
  await client.query(`UPDATE "${schema}".work_orders SET service_duration_minutes=$2,
    appointment_window_start=$3,appointment_window_end=$4 WHERE id=$1`,
    [id, fields.serviceDurationMinutes ?? null, fields.appointmentWindowStart ?? null, fields.appointmentWindowEnd ?? null]);
}
