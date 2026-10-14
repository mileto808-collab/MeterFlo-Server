import type { PoolClient, Pool } from "pg";
import { exactReadingFields } from "../shared/exact-readings";

/** Additive migration; preserve numeric columns, old rows and missing original formatting. */
export async function initializeExactReadings(client: PoolClient, schema: string) {
  if (!/^[a-zA-Z0-9_]+$/.test(schema)) throw new Error("Invalid project schema");
  await client.query("BEGIN");
  try {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`exact-readings:${schema}`]);
  await client.query(exactReadingFields.map(({column}) =>
    `ALTER TABLE "${schema}".work_orders ADD COLUMN IF NOT EXISTS ${column}_text TEXT;`).join("\n"));
  const body = exactReadingFields.map(({column:c}) => `
    IF NEW.${c} IS NULL THEN
      NEW.${c}_text := NULL;
    ELSIF TG_OP='UPDATE' AND NEW.${c}_text IS NOT DISTINCT FROM OLD.${c}_text
          AND NEW.${c} IS DISTINCT FROM OLD.${c} THEN
      -- A legacy/direct numeric-only update cannot keep an old, inconsistent label.
      NEW.${c}_text := NULL;
    ELSIF NEW.${c}_text IS NOT NULL THEN
      IF NEW.${c}_text::NUMERIC IS DISTINCT FROM NEW.${c}::NUMERIC THEN
        RAISE EXCEPTION 'Reading text does not match numeric value: ${c}';
      END IF;
    END IF;`).join("\n");
  await client.query(`
    CREATE OR REPLACE FUNCTION "${schema}".maintain_exact_readings() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN ${body} RETURN NEW; END $$;
    DROP TRIGGER IF EXISTS maintain_exact_readings ON "${schema}".work_orders;
    CREATE TRIGGER maintain_exact_readings BEFORE INSERT OR UPDATE ON "${schema}".work_orders
      FOR EACH ROW EXECUTE FUNCTION "${schema}".maintain_exact_readings();
  `);
  await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
}

export async function initializeProjectExactReadings(pool: Pool) {
  const client = await pool.connect();
  try {
    const {rows} = await client.query(`SELECT database_name FROM public.projects p
      WHERE EXISTS (SELECT 1 FROM information_schema.tables t
        WHERE t.table_schema=p.database_name AND t.table_name='work_orders')`);
    for (const row of rows) await initializeExactReadings(client,row.database_name);
  } finally { client.release(); }
}
