import type { Pool } from "pg";

const limits = [
  { column: "system_reading_decimal_places", constraint: "projects_system_reading_decimal_places_check" },
  { column: "module_reading_decimal_places", constraint: "projects_module_reading_decimal_places_check" },
] as const;

// Compare PostgreSQL's deparsed expression, not just a possibly misleading name.
const normalize = (expression: string) => expression.replace(/[()\s"]/g, "").toLowerCase();

/** Additive upgrade also runs on independently hosted Windows installations. */
export async function initializeReadingPrecision(pool: Pool): Promise<void> {
  const client = await pool.connect();
  const inspect = async () => {
    const columns = await client.query(
      `SELECT attname FROM pg_attribute
        WHERE attrelid='public.projects'::regclass AND attnum > 0 AND NOT attisdropped
          AND attname = ANY($1::text[])`, [limits.map(limit => limit.column)],
    );
    const constraints = await client.query(
      `SELECT conname, contype, convalidated, connoinherit,
              pg_get_expr(conbin, conrelid) AS expression
         FROM pg_constraint WHERE conrelid='public.projects'::regclass
          AND conname = ANY($1::text[])`, [limits.map(limit => limit.constraint)],
    );
    for (const limit of limits) {
      const constraint = constraints.rows.find(row => row.conname === limit.constraint);
      if (constraint && (constraint.contype !== "c" || constraint.connoinherit ||
          normalize(constraint.expression ?? "") !== normalize(`${limit.column} >= 0 AND ${limit.column} <= 6`))) {
        throw new Error(`Reading precision upgrade: constraint ${limit.constraint} has an unexpected definition. Ask the database administrator to inspect it; no settings were changed.`);
      }
    }
    return {
      columns: new Set(columns.rows.map(row => row.attname)),
      constraints: new Map(constraints.rows.map(row => [row.conname, row.convalidated])),
    };
  };
  let inTransaction = false;
  try {
    const prepared = await inspect();
    // No DDL, locks or data scans for fully DBA-prepared/read-only runtimes.
    if (limits.every(limit => prepared.columns.has(limit.column) &&
        prepared.constraints.get(limit.constraint) === true)) return;

    await client.query("BEGIN");
    inTransaction = true;
    // Serialize installers, and prevent writes between inspection and validation.
    await client.query("LOCK TABLE public.projects IN ACCESS EXCLUSIVE MODE");
    const current = await inspect();
    for (const { column } of limits) {
      if (!current.columns.has(column)) {
        await client.query(`ALTER TABLE public.projects ADD COLUMN ${column} integer NOT NULL DEFAULT 3`);
      }
    }
    const invalid = await client.query(`
      SELECT id, system_reading_decimal_places, module_reading_decimal_places,
             count(*) OVER () AS invalid_count
        FROM public.projects
       WHERE system_reading_decimal_places NOT BETWEEN 0 AND 6
          OR module_reading_decimal_places NOT BETWEEN 0 AND 6
       ORDER BY id LIMIT 20`);
    if (invalid.rows.length) {
      throw new Error(`Reading precision upgrade: ${invalid.rows[0].invalid_count} project(s) have settings outside 0–6. Ask the database administrator to review and explicitly correct these settings, then retry. No settings were changed. First affected projects: ${JSON.stringify(invalid.rows.map(({ invalid_count, ...row }) => row))}`);
    }
    for (const { column, constraint } of limits) {
      if (!current.constraints.has(constraint)) {
        await client.query(`ALTER TABLE public.projects ADD CONSTRAINT ${constraint} CHECK (${column} BETWEEN 0 AND 6)`);
      } else if (!current.constraints.get(constraint)) {
        await client.query(`ALTER TABLE public.projects VALIDATE CONSTRAINT ${constraint}`);
      }
    }
    await client.query("COMMIT");
    inTransaction = false;
  } catch (error) {
    if (inTransaction) await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
