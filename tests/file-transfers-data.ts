import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
async function main() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const owner = JSON.parse(await readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(owner.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const { pool } = await import("../server/db"), { enableAuditing, withAuditContext, serviceAuditContext } = await import("../server/auditContext");
  enableAuditing();
  const mode = process.argv[2], schema = `"${fixture.schema}"`;
  try {
    await withAuditContext(serviceAuditContext("file-transfer-acceptance"), async () => {
      if (mode === "seed") {
        await pool.query("INSERT INTO public.work_order_statuses(code,label) VALUES('Closed','Closed') ON CONFLICT(code) DO NOTHING");
        for (const status of ["Closed", "Trouble", "Open"]) {
          const { rows: [row] } = await pool.query(`INSERT INTO ${schema}.work_orders(customer_wo_id,customer_id,customer_name,address,service_type,status,created_by,updated_by)
            VALUES($1,$2,$3,'100 Main St','workspace-fixture',$4,$5,$5) RETURNING id`, ["TRANSFER-" + status.toUpperCase(), "customer-" + status, "Test " + status, status === "Closed" ? "Completed" : status, fixture.username]);
          if (status === "Closed") {
            const { lifecycleBatch } = await import("../server/work-order-lifecycle/service");
            assert.equal((await lifecycleBatch(fixture.projectId, [row.id], "close")).updatedCount, 1);
          }
        }
        const { encodeExport, exportFilename, nextTransferTime } = await import("../server/file-transfers/exports");
        assert.equal(exportFilename("orders_{YYYY}{MM}{DD}_{HH}{mm}{ss}", "csv", "id", "America/New_York", new Date("2026-01-01T01:02:03Z")), "orders_20251231_200203_id.csv");
        assert.throws(() => exportFilename("../orders", "csv", "id", "UTC"));
        assert.throws(() => nextTransferTime("custom", "not cron", "UTC"));
        const bytes = encodeExport([{ serial: "00012", note: "=malicious" }], ["serial", "note"], "csv").toString("utf8");
        assert.match(bytes, /00012/); assert.match(bytes, /'=malicious/);
        assert.deepEqual(encodeExport([{ id: "0001" }], ["id"], "xlsx"), encodeExport([{ id: "0001" }], ["id"], "xlsx"));
      } else if (mode === "change") await pool.query(`UPDATE ${schema}.work_orders SET customer_name='Changed Trouble' WHERE customer_wo_id='TRANSFER-TROUBLE'`);
      else if (mode === "assert-checkpoint") {
        const row = (await pool.query(`SELECT c.content_hash=encode(sha256(convert_to(to_jsonb(w)::text,'UTF8')),'hex') AS same
          FROM ${schema}.work_orders w JOIN public.file_export_checkpoints c ON c.work_order_id=w.id AND c.config_id=$1 WHERE customer_wo_id='TRANSFER-TROUBLE'`, [process.argv[3]])).rows[0];
        assert.equal(row.same, false, "failed delivery must not advance checkpoint");
      } else if (mode === "assert-import") {
        const row = (await pool.query(`SELECT * FROM ${schema}.work_orders WHERE customer_wo_id='SFTP-IMPORTED'`)).rows[0];
        assert.equal(row.customer_name, "Customer, Inc.");
      } else if (mode === "schedule") await pool.query("UPDATE public.file_exports SET is_enabled=true,schedule_frequency='hourly',next_run_at=now()-interval '1 minute' WHERE id=$1", [process.argv[3]]);
    });
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
