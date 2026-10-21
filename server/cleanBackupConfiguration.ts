import type { Pool, PoolClient } from "pg";

type QueryClient = Pick<Pool | PoolClient, "query">;
/** Configuration-only export: project policies and cleanup journals are not portable configuration. */
export async function cleanConfigurationInserts(client: QueryClient): Promise<string> {
  const statements: string[] = [];
  for (const table of ["work_order_sub_statuses", "trouble_codes", "system_settings"]) {
    const predicate = table === "system_settings"
      ? "NOT starts_with(key,'project_deletion_')"
      : "project_id IS NULL";
    const { rows } = await client.query(`SELECT format(
      'INSERT INTO public.${table} OVERRIDING SYSTEM VALUE SELECT * FROM json_populate_record(NULL::public.${table}, %L::json);',
      row_to_json(t)::text) AS statement FROM public.${table} t WHERE ${predicate} ORDER BY ${table === "system_settings" ? "key" : "id"}`);
    statements.push(...rows.map(row => row.statement));
    // Selective inserts omit pg_dump's sequence state. This includes the settings
    // identity used immediately by the post-restore Turnstile override.
    const { rows: [identity] } = await client.query("SELECT pg_get_serial_sequence($1,'id') IS NOT NULL AS present", [`public.${table}`]);
    if (identity.present) statements.push(`SELECT setval(pg_get_serial_sequence('public.${table}','id'),
      COALESCE((SELECT max(id) FROM public.${table}),1),EXISTS(SELECT 1 FROM public.${table}));`);
  }
  return statements.join("\n") + "\n";
}

/** Clean configuration restore is not an implicit factory reset of an occupied instance. */
export async function requireFreshCleanDestination(client: QueryClient) {
  // Inspect metadata first: a genuinely empty database has no projects table yet.
  // Also reject orphan project history rather than silently retaining it in what
  // the administrator expects to be a fresh installation.
  const { rows: tables } = await client.query(`SELECT table_schema,table_name FROM information_schema.columns
    WHERE column_name='project_id' AND table_schema IN ('public','meterflo_audit')
    UNION SELECT table_schema,table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_name IN ('projects','import_history')`);
  const checks = tables.map(table => `EXISTS(SELECT 1 FROM "${table.table_schema.replaceAll('"', '""')}"."${table.table_name.replaceAll('"', '""')}"${
    table.table_schema === "public" && ["projects", "import_history"].includes(table.table_name) ? "" : " WHERE project_id IS NOT NULL"})`);
  const { rows: [row] } = await client.query(`SELECT
    EXISTS(SELECT 1 FROM pg_namespace WHERE nspname ~ '^project_[a-z0-9_]+$')${checks.map(check => ` OR ${check}`).join("")} AS occupied`);
  if (row.occupied) throw new Error("Clean configuration backups are for fresh installations. This destination contains project data; no restore was started. Use a new database or the appropriate full restore.");
}
