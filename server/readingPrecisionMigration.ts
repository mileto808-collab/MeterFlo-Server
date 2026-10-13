import type { Pool } from "pg";

/** Additive upgrade also runs on independently hosted Windows installations. */
export async function initializeReadingPrecision(pool: Pool): Promise<void> {
  const existing = await pool.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name='projects'
        AND column_name IN ('system_reading_decimal_places', 'module_reading_decimal_places')`,
  );
  // A DBA can pre-apply the upgrade for a runtime role without ALTER rights.
  if (existing.rows.length === 2) return;
  await pool.query(`
    ALTER TABLE public.projects
      ADD COLUMN IF NOT EXISTS system_reading_decimal_places integer NOT NULL DEFAULT 3
        CHECK (system_reading_decimal_places BETWEEN 0 AND 6),
      ADD COLUMN IF NOT EXISTS module_reading_decimal_places integer NOT NULL DEFAULT 3
        CHECK (module_reading_decimal_places BETWEEN 0 AND 6);
  `);
}
