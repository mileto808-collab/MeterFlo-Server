import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
async function main() {
  const owner = JSON.parse(await readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG || "", "utf8"));
  assert.equal(owner.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const { pool } = await import("../server/db");
  const { enableAuditing, serviceAuditContext, withAuditContext } = await import("../server/auditContext");
  const { withBackupExclusive } = await import("../server/backups/lock");
  enableAuditing();
  try {
    await withAuditContext(serviceAuditContext("https-transfer-acceptance"), () => withBackupExclusive(async () => {
      const mode = process.argv[2], target = process.argv[3];
      if (mode === "setup") {
        await pool.query("UPDATE public.projects SET timezone='America/New_York' WHERE id=$1", [fixture.projectId]);
      } else if (mode === "guide-contract") {
        const { workOrderColumnGuide } = await import("../server/file-transfers/column-guide");
        const guide = await workOrderColumnGuide(fixture.projectId);
        const actual = (await pool.query("SELECT column_name,is_nullable FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders' ORDER BY ordinal_position", [fixture.schema])).rows;
        assert.deepEqual(guide.columns.map(c => c.databaseColumn), actual.map(c => c.column_name));
        for (const column of guide.columns) assert.equal(column.databaseNullable, actual.find(c => c.column_name === column.databaseColumn).is_nullable === "YES");
        const column = (field: string) => { const found = guide.columns.find(c => c.field === field); assert.ok(found); return found; };
        assert.equal(column("customerId").requirement, "required"); assert.equal(column("customerId").databaseNullable, true);
        assert.equal(column("customerWoId").requirement, "generated"); assert.equal(column("serviceType").requirement, "conditional");
        assert.equal(column("createdBy").manualCsv, false); assert.equal(column("createdBy").scheduled, false);
        assert.equal(column("newSystemId").manualJson, true); assert.equal(column("newSystemId").manualCsv, false);
        assert.equal(column("completedAt").manualJson, false); assert.equal(column("completedAt").scheduled, true);
        assert.equal(column("gpsAccuracy").scheduled, false); assert.equal(column("gpsAccuracy").exportable, true);
      } else if (mode === "verify-manual") {
        const rows = (await pool.query(`SELECT customer_wo_id,service_type FROM "${fixture.schema}".work_orders WHERE customer_id='MANUAL-CSV'`)).rows;
        assert.equal(rows.length, 1); assert.match(rows[0].customer_wo_id, /^\d+$/); assert.equal(rows[0].service_type, "workspace-fixture");
      } else if (mode === "verify-import") {
        const result = await pool.query(`SELECT customer_name FROM "${fixture.schema}".work_orders WHERE customer_wo_id='HTTPS-OWNED-1'`);
        assert.equal(result.rowCount, 1); assert.equal(result.rows[0].customer_name, "Customer, Inc.");
        const file = (await pool.query("SELECT * FROM public.https_transfer_files WHERE id=$1", [target])).rows[0];
        assert.equal(file.status, "processed");
      } else if (mode === "verify-hash") {
        const row = (await pool.query("SELECT * FROM public.https_transfer_credentials WHERE id=$1", [target])).rows[0];
        assert.match(row.token_hash, /^[a-f0-9]{64}$/); assert.equal(row.token_hash.includes("mft_"), false);
      } else if (mode === "expire-credential") await pool.query("UPDATE public.https_transfer_credentials SET expires_at=now()-interval '1 second' WHERE id=$1", [target]);
      else if (mode === "tamper") {
        const row = (await pool.query("SELECT * FROM public.https_transfer_files WHERE id=$1", [target])).rows[0];
        assert.equal(row.provider, "local");
        await writeFile(path.join(row.location, row.storage_key), "tampered");
      } else if (mode === "retention") {
        await pool.query(`UPDATE public.https_transfer_files SET created_at=now()-interval '45 days',
          processed_at=CASE WHEN status='processed' THEN now()-interval '45 days' ELSE processed_at END,
          acknowledged_at=CASE WHEN status='acknowledged' THEN now()-interval '45 days' ELSE acknowledged_at END WHERE project_id=$1`, [fixture.projectId]);
        const { expireExchangeFiles } = await import("../server/file-transfers/https-service");
        await expireExchangeFiles();
        const rows = (await pool.query("SELECT status,direction FROM public.https_transfer_files WHERE project_id=$1", [fixture.projectId])).rows;
        assert.ok(rows.some(r => r.status === "expired")); assert.ok(rows.some(r => r.status === "received"));
        assert.ok(rows.some(r => r.direction === "outbox" && r.status === "available"));
      }
    }));
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
