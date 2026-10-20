import type { Pool, PoolClient } from "pg";
type Connection = Pick<PoolClient, "query">;

export async function installGpsColumns(client: Connection, schema: string) {
  if (!/^project_[a-z0-9_]+$/.test(schema)) throw new Error("Invalid project schema.");
  await client.query(`ALTER TABLE "${schema}".work_orders
    ADD COLUMN IF NOT EXISTS gps_source varchar(20),
    ADD COLUMN IF NOT EXISTS gps_accuracy numeric,
    ADD COLUMN IF NOT EXISTS gps_captured_at timestamptz,
    ADD COLUMN IF NOT EXISTS gps_receiver varchar(20)`);
}

/** Called only by the explicit dev command or an independently hosted instance. */
export async function migrateGpsSchema(pool: Pool) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('meterflo-gps-capture'))");
    await client.query(`ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS wizard_gps_max_accuracy_metres integer;
      ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS wizard_reuse_old_gps boolean NOT NULL DEFAULT false;
      DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.projects'::regclass AND conname='projects_gps_accuracy_range') THEN
        ALTER TABLE public.projects ADD CONSTRAINT projects_gps_accuracy_range CHECK(wizard_gps_max_accuracy_metres BETWEEN 1 AND 100000);
      END IF; END $$`);
    const { rows } = await client.query(`SELECT database_name FROM public.projects WHERE database_name IS NOT NULL`);
    for (const { database_name: schema } of rows) {
      if (!/^project_[a-z0-9_]+$/.test(schema)) continue;
      const exists = await client.query("SELECT to_regclass($1) AS name", [`"${schema}".work_orders`]);
      if (exists.rows[0]?.name) await installGpsColumns(client, schema);
    }
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}

export async function initializeGpsSchema(pool: Pool) {
  // Replit's managed production is migrated by Publish, never startup DDL.
  // Standalone Windows/Linux installations retain their normal additive upgrade.
  if (!process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1") await migrateGpsSchema(pool);
  await pool.query("SELECT wizard_gps_max_accuracy_metres,wizard_reuse_old_gps FROM public.projects LIMIT 0");
}
