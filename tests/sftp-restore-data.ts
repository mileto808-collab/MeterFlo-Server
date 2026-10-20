import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";

async function main() {
  const owner = JSON.parse(await readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG || "", "utf8"));
  assert.equal(owner.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const { pool } = await import("../server/db");
  const { captureLocalSftp, restoreLocalSftp } = await import("../server/file-transfers/restore-local-sftp");
  const { enableAuditing, serviceAuditContext, withAuditContext } = await import("../server/auditContext");
  enableAuditing();
  try {
    await withAuditContext(serviceAuditContext("owned-sftp-restore-tests"), async () => {
      if (process.argv[2] === "seed-logs") {
        await pool.query("UPDATE public.projects SET timezone='America/New_York' WHERE id=$1", [fixture.projectId]);
        await pool.query(`INSERT INTO public.sftp_server_events(id,project_id,username,action,status,message,created_at)
          VALUES($1,$2,'owned-timezone','test','success','Owned boundary fixture','2026-10-19T03:30:00Z'),
          ($3,NULL,'owned-timezone','test','success','Owned shared fixture','2026-10-19T03:30:00Z')`,
        [randomUUID(), fixture.projectId, randomUUID()]);
        return;
      }
      const auditCount = Number((await pool.query("SELECT count(*) FROM meterflo_audit.events WHERE action='sftp.logs.deleted'")).rows[0].count);
      assert.ok(auditCount >= 2, "Confirmed cleanup has independent audit evidence");
      const original = await captureLocalSftp(pool);
      assert.ok(original.accounts.length);
      const project = (await pool.query("SELECT created_at FROM public.projects WHERE id=$1", [fixture.projectId])).rows[0];
      const identity = (rows: any[]) => rows.map(row => [row.id, row.username, row.password_hash, row.public_key,
        new Date(row.expires_at).toISOString(), row.revoked_at && new Date(row.revoked_at).toISOString()]).sort();
      let dump: string | undefined;
      try {
        // Actual pg_dump + SQL restore: source resembles hosted Replit, with no local accounts.
        await pool.query("DELETE FROM public.sftp_server_accounts");
        await pool.query("UPDATE public.sftp_server_settings SET enabled=false,host='0.0.0.0',port=2222,public_host=''");
        const { createPgBackup, restorePgBackup } = await import("../server/pgBackup");
        const source = await createPgBackup();
        assert.equal(source.success, true);
        dump = source.backupFile;
        await restoreLocalSftp(pool, original);
        const restored = await restorePgBackup(dump, { disableForeignKeys: true, clearExisting: true });
        assert.equal(restored.success, true, restored.error);
        const after = await captureLocalSftp(pool);
        assert.equal(after.settings.port, original.settings.port);
        assert.equal(after.settings.public_host, original.settings.public_host);
        assert.equal(after.settings.enabled, false);
        assert.ok(JSON.stringify(identity(after.accounts)) === JSON.stringify(identity(original.accounts)), "Credentials, expiry and revocations retained");
        const review = JSON.parse((await pool.query("SELECT value FROM public.system_settings WHERE key='sftp_restore_review'")).rows[0].value);
        assert.equal(review.requiresReview, true);
        assert.equal(review.retained, original.accounts.length);
        assert.ok(!JSON.stringify(review).includes("password_hash"));

        // Numeric IDs and names alone must never attach credentials to a recreated project.
        await pool.query("UPDATE public.projects SET created_at=created_at+interval '1 second' WHERE id=$1", [fixture.projectId]);
        const blocked = await restoreLocalSftp(pool, original);
        assert.ok(blocked.blocked.length);
        assert.ok(!(await captureLocalSftp(pool)).accounts.some(a => a.project_id === fixture.projectId));
        await pool.query("UPDATE public.projects SET created_at=$2 WHERE id=$1", [fixture.projectId, project.created_at]);
        await restoreLocalSftp(pool, original);

        await pool.query("UPDATE public.projects SET name=name || ' renamed' WHERE id=$1", [fixture.projectId]);
        const renamed = await restoreLocalSftp(pool, original);
        assert.equal(renamed.blocked.length, 0, "Editable project labels are not identity");
        await pool.query("UPDATE public.projects SET name=$2 WHERE id=$1", [fixture.projectId, original.accounts.find(a => a.project_id === fixture.projectId).project_name]);

        // Explicit replacement keeps backed-up endpoints/accounts, but never starts the listener.
        await pool.query("UPDATE public.sftp_server_settings SET public_host='source.example'");
        const replacement = await restoreLocalSftp(pool, { ...original, mode: "replace" });
        assert.equal(replacement.mode, "replace");
        assert.equal((await captureLocalSftp(pool)).settings.public_host, "source.example");
        assert.equal((await captureLocalSftp(pool)).settings.enabled, false);
        const fresh = await restoreLocalSftp(pool, { mode: "retain", settings: undefined, accounts: [] });
        assert.equal(fresh.mode, "replace", "Fresh instances pause the backed-up setup for review");

        // Refused restores must not delete credentials or un-revoke accounts.
        const { auditedOperation } = await import("../server/auditService");
        const failed = await auditedOperation("systemRestore", "owned-refusal", async () => ({ success: false }));
        assert.equal(failed.success, false);
        assert.ok(JSON.stringify(identity((await captureLocalSftp(pool)).accounts)) === JSON.stringify(identity(original.accounts)), "Refusal preserves account credentials and revocations");
      } finally {
        await pool.query("UPDATE public.projects SET name=$2 WHERE id=$1", [fixture.projectId, original.accounts.find(a => a.project_id === fixture.projectId).project_name]);
        await pool.query("UPDATE public.projects SET created_at=$2 WHERE id=$1", [fixture.projectId, project.created_at]);
        await restoreLocalSftp(pool, original);
        if (dump) await unlink(dump).catch(() => {});
      }
      console.log("PASS owned SQL restore, retained credentials, project identity collision, explicit replacement and refusal safety");
    });
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
