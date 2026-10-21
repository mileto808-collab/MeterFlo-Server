import type { Pool, PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { bootstrapAdminHash } from "./bootstrapAdmin";

type QueryClient = Pick<Pool | PoolClient, "query">;

/** A clean installation gets a new admin, never the source admin's credentials/profile/locks. */
export async function cleanDefaultAdministratorInsert(): Promise<string> {
  const hash = await bootstrapAdminHash(), id = randomUUID();
  return `
-- Fresh-install administrator. Change the installation default password before use.
INSERT INTO public.subroles(key,label,base_role,description)
VALUES('administrator','Administrator','admin','Full system access with all permissions')
ON CONFLICT(key) DO UPDATE SET base_role='admin';
INSERT INTO public.subrole_permissions(subrole_id,permission_key)
SELECT s.id,p.key FROM public.subroles s CROSS JOIN public.permissions p
WHERE s.key='administrator' AND NOT EXISTS(
  SELECT 1 FROM public.subrole_permissions sp WHERE sp.subrole_id=s.id AND sp.permission_key=p.key);
INSERT INTO public.users(id,username,password_hash,first_name,role,subrole_id,is_locked)
VALUES('${id}','admin','${hash}','Administrator','admin',
  (SELECT id FROM public.subroles WHERE key='administrator'),false)
ON CONFLICT(username) DO UPDATE SET
  password_hash=EXCLUDED.password_hash,first_name='Administrator',last_name=NULL,email=NULL,profile_image_url=NULL,
  role='admin',subrole_id=EXCLUDED.subrole_id,is_locked=false,locked_at=NULL,locked_reason=NULL,last_login_at=NULL,
  address=NULL,city=NULL,state=NULL,zip=NULL,phone=NULL,website=NULL,notes=NULL,created_at=now(),updated_at=now();
`;
}

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
