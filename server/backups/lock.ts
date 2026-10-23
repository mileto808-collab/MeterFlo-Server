import { pool } from "../db";
import { AsyncLocalStorage } from "node:async_hooks";
const lockContext = new AsyncLocalStorage<boolean>();
export const backupLock = "meterflo-backup-execution";
/** Scheduler only: enter after acquiring backupLock on its existing session.
 * Nested exporters must reuse that ownership, not wait on a second connection.
 */
export function withExistingBackupLock<T>(fn: () => Promise<T>): Promise<T> {
  return lockContext.run(true, fn);
}
/** Session lock coordinates workers, manual backups and audited system restores. */
export async function withBackupExclusive<T>(fn: () => Promise<T>): Promise<T> {
  if (lockContext.getStore()) return fn();
  const connection = await pool.connect();
  try {
    await connection.query("SELECT pg_advisory_lock(hashtext($1))", [backupLock]);
    return await lockContext.run(true, fn);
  } finally {
    await connection.query("SELECT pg_advisory_unlock(hashtext($1))", [backupLock]).catch(() => {});
    connection.release();
  }
}
