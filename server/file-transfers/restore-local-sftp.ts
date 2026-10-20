import type { Pool } from "pg";
import { createHash } from "node:crypto";
import { auditContext } from "../auditContext";
import { TransferError } from "./sftp";
export function chooseSftpRestoreMode(value: unknown) {
  if (value !== undefined && value !== "retain" && value !== "replace")
    throw new TransferError("Choose retain or replace for SFTP restore.", 400);
  const context = auditContext.getStore();
  if (context) context.sftpRestoreMode = value === "replace" ? "replace" : "retain";
  return value === "replace" ? "replace" : "retain";
}

/** Capture only in server memory: never send credential material to UI, logs or audit metadata. */
export async function captureLocalSftp(db: Pool) {
  const mode = auditContext.getStore()?.sftpRestoreMode || "retain";
  const tables = (await db.query("SELECT to_regclass('public.sftp_server_settings') AS settings,to_regclass('public.sftp_server_accounts') AS accounts")).rows[0];
  if (!tables.settings || !tables.accounts) return { mode, settings: undefined, accounts: [] as any[] };
  const settings = (await db.query("SELECT * FROM public.sftp_server_settings WHERE id=1")).rows[0];
  const accounts = (await db.query(`SELECT a.*,p.name AS project_name,p.database_name,p.created_at AS project_created_at
    FROM public.sftp_server_accounts a JOIN public.projects p ON p.id=a.project_id`)).rows;
  return { mode, settings, accounts };
}
function identity(project: any) {
  const created = project.project_created_at;
  if (!project.database_name || !created) return null;
  // Names are editable; use the original schema namespace and creation timestamp as well as ID.
  return createHash("sha256").update(JSON.stringify([project.project_id,
    project.database_name, new Date(created).toISOString()])).digest("hex");
}
export async function restoreLocalSftp(db: Pool, saved: Awaited<ReturnType<typeof captureLocalSftp>>) {
  const retain = saved.mode === "retain" && (!!saved.settings || saved.accounts.length > 0);
  const blocked: { username: string; reason: string }[] = [];
  const client = await db.connect();
  let retained = 0;
  try {
    await client.query("BEGIN");
    // Always pause, including explicit replacement. Only an administrator can restart access.
    await client.query("UPDATE public.sftp_server_settings SET enabled=false,updated_at=now()");
    if (retain) {
      if (saved.settings) await client.query(`INSERT INTO public.sftp_server_settings(id,enabled,host,port,public_host)
        VALUES(1,false,$1,$2,$3) ON CONFLICT(id) DO UPDATE SET enabled=false,host=$1,port=$2,public_host=$3,updated_at=now()`,
      [saved.settings.host, saved.settings.port, saved.settings.public_host]);
      await client.query("DELETE FROM public.sftp_server_accounts");
      const projects = (await client.query(`SELECT id AS project_id,name AS project_name,database_name,
        created_at AS project_created_at FROM public.projects`)).rows;
      for (const account of saved.accounts) {
        const fingerprint = identity(account);
        if (!fingerprint || !projects.some(p => identity(p) === fingerprint)) {
          blocked.push({ username: account.username, reason: "Original project identity is missing or changed; account not restored." });
          continue;
        }
        await client.query(`INSERT INTO public.sftp_server_accounts
          (id,project_id,username,label,auth_type,public_key,password_hash,can_upload,can_download,expires_at,revoked_at,created_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [account.id, account.project_id, account.username,
          account.label, account.auth_type, account.public_key, account.password_hash, account.can_upload,
          account.can_download, account.expires_at, account.revoked_at, account.created_at]);
        retained++;
      }
    }
    const report = { mode: retain ? "retain" : "replace", retained, blocked, requiresReview: true,
      restoredAt: new Date().toISOString(),
      message: "SFTP is paused after restore. Review project accounts, expiry, locks, host/port and the local host fingerprint before enabling. Revocations and expiry remain enforced." };
    await client.query(`INSERT INTO public.system_settings(key,value) VALUES('sftp_restore_review',$1)
      ON CONFLICT(key) DO UPDATE SET value=$1`, [JSON.stringify(report)]);
    await client.query("COMMIT");
    return report;
  } catch (error) {
    await client.query("ROLLBACK");
    // Best effort fail-closed; never turn a failed preservation step into a successful restore.
    await db.query("UPDATE public.sftp_server_settings SET enabled=false").catch(() => {});
    throw new TransferError("Database restore requires attention: local SFTP configuration could not be retained. SFTP remains paused; review server logs without retrying the database restore blindly.", 500);
  } finally { client.release(); }
}
