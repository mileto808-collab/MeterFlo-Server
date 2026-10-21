import type { PoolClient } from "pg";
import { quote } from "./catalog";

/** Call only while holding the instance's shared backup-execution lock. */
export async function cleanupPackageStages(client: PoolClient) {
  const { rows } = await client.query(`SELECT nspname FROM pg_namespace
    WHERE nspname ~ '^mf_pkg_[0-9a-f]{16}_(data|work|history)$'
      AND nspowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)`);
  for (const row of rows) await client.query(`DROP SCHEMA ${quote(row.nspname)} CASCADE`);
}
