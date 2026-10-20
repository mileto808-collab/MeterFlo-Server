import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
async function main() {
  const config = process.env.WORKSPACE_UI_SANDBOX_CONFIG;
  if (!config) throw new Error("Owned sandbox required.");
  assert.equal(JSON.parse(await readFile(config, "utf8")).ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const stateFile = path.join(path.dirname(config), "closing-fixture.json");
  const { pool } = await import("../server/db");
  const { withAuditContext, enableAuditing } = await import("../server/auditContext");
  const { readRelationalInventory } = await import("../server/inventoryRelational");
  const { saveInventory } = await import("../server/inventoryService");
  const { itemSchema } = await import("../shared/inventory");
  enableAuditing();
  try {
    await withAuditContext({ actorId: fixture.id, actorLabel: fixture.username, actorKind: "user",
      source: "closingAcceptance", operationId: randomUUID() }, async () => {
      const schema = `"${fixture.schema}"`;
      if (process.argv[2] === "seed") {
        await pool.query("UPDATE public.projects SET timezone='America/New_York',wizard_gps_mode='disabled' WHERE id=$1", [fixture.projectId]);
        const { rows: [group] } = await pool.query("INSERT INTO public.user_groups(name) VALUES($1) RETURNING name", [`closing-${fixture.projectId}`]);
        const ids: Record<string, number> = {};
        for (const [name, status] of [["first", "Completed"], ["second", "Completed"], ["open", "Open"],
          ["scheduled", "Scheduled"], ["trouble", "Trouble"], ["auto", "Completed"], ["early", "Completed"], ["missingTime", "Completed"]]) {
          const { rows: [row] } = await pool.query(`INSERT INTO ${schema}.work_orders(customer_wo_id,customer_id,customer_name,address,status,
            completed_at,completed_by,assigned_user_id,assigned_group_id,notes,new_system_id,new_system_reading,
            new_system_reading_text,new_gps,signature_data,signature_name,created_by,updated_by,old_system_id,old_system_reading,old_system_reading_text)
            VALUES($1,$1,'Closing fixture','100 Main St',$2::varchar,CASE WHEN $2::varchar='Completed' AND $3<>'missingTime' THEN now()-interval '7 days' END,
              $4,$4,$5,'Preserve this evidence',$6::text,0.0039,'00000.0039','40.1,-70.2','fixture-signature','Fixture signer',$7,$7,
              'OLD-'||$6::text,234000.0020,'234000.0020') RETURNING *`,
          [`CUSTOMER-${name}`, status, name, fixture.id, group.name, `SERIAL-${name}`, fixture.username]);
          ids[name] = row.id;
        }
        await pool.query(`UPDATE ${schema}.work_orders SET completed_at=now()-interval '30 minutes' WHERE id=$1`, [ids.early]);
        const client = await pool.connect();
        let inventory: any;
        try {
          await client.query("BEGIN");
          const before = await readRelationalInventory(client, fixture.projectId);
          const next = structuredClone(before);
          const item = itemSchema.parse({ id: randomUUID(), sku: "CLOSING-SEAL", name: "Consumed stock fixture", tracking: "regular" });
          next.items.push(item);
          next.stock.push({ warehouseId: next.warehouses[0].id, itemId: item.id, quantity: 4, serials: [], revision: 0 });
          const line = { warehouseId: next.warehouses[0].id, itemId: item.id, quantity: 1, serials: [] };
          next.allocations.push({ workOrderId: ids.first, lines: [line], used: [line], dispositions: [], mode: "changeout", status: "consumed", revision: 1 });
          next.revision++;
          await saveInventory(client, fixture.projectId, before, next, randomUUID(), "closingFixture");
          inventory = await readRelationalInventory(client, fixture.projectId);
          await client.query("COMMIT");
        } catch (e) { await client.query("ROLLBACK"); throw e; } finally { client.release(); }
        const rows = (await pool.query(`SELECT * FROM ${schema}.work_orders ORDER BY id`)).rows;
        await writeFile(stateFile, JSON.stringify({ ids, rows, inventory }), { mode: 0o600 });
      } else {
        const saved = JSON.parse(await readFile(stateFile, "utf8"));
        if (process.argv[2] === "verify-closed") {
          const { rows: [row] } = await pool.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1`, [saved.ids.first]);
          const original = saved.rows.find((r: any) => r.id === row.id);
          assert.equal(row.status, "Closed"); assert.equal(row.assigned_user_id, null); assert.equal(row.assigned_group_id, null);
          assert.ok(row.closed_at); assert.equal(row.closed_by, fixture.username);
          for (const key of ["completed_at", "completed_by", "notes", "new_system_id", "new_system_reading_text", "new_gps", "signature_data", "signature_name"])
            assert.equal(JSON.stringify(row[key]), JSON.stringify(original[key]), key);
          const client = await pool.connect();
          try { assert.deepEqual(JSON.parse(JSON.stringify(await readRelationalInventory(client, fixture.projectId))), saved.inventory); }
          finally { client.release(); }
          await assert.rejects(pool.query(`UPDATE ${schema}.work_orders SET notes='forbidden' WHERE id=$1`, [row.id]), /explicitly reopened/);
          await assert.rejects(pool.query(`DELETE FROM ${schema}.work_orders WHERE id=$1`, [row.id]), /explicitly reopened/);
          await assert.rejects(pool.query(`INSERT INTO ${schema}.work_orders(status) VALUES('Closed')`), /authorized close/);
          await assert.rejects(pool.query(`INSERT INTO public.work_order_time_tracking(project_id,system_work_order_id,start_time,end_time)
            VALUES($1,$2,now(),now())`, [fixture.projectId, row.customer_wo_id]), /Reopen Closed/);
        } else if (process.argv[2] === "verify-reopened") {
          const { rows: [row] } = await pool.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1`, [saved.ids.first]);
          assert.equal(row.status, "Completed"); assert.equal(row.closed_at, null); assert.ok(row.review_started_at);
          assert.equal(row.new_system_reading_text, "00000.0039");
          assert.equal(row.completed_at.toISOString(), saved.rows.find((r: any) => r.id === row.id).completed_at);
          const client = await pool.connect();
          try { assert.deepEqual(JSON.parse(JSON.stringify(await readRelationalInventory(client, fixture.projectId))), saved.inventory); }
          finally { client.release(); }
          assert.equal((await pool.query("SELECT count(*)::int n FROM public.customer_api_deliveries WHERE project_id=$1 AND work_order_id=$2",
            [fixture.projectId, saved.ids.first])).rows[0].n, 1);
          await pool.query("UPDATE public.projects SET customer_api_enabled=false WHERE id=$1", [fixture.projectId]);
        } else if (process.argv[2] === "rename-closed") {
          await pool.query("UPDATE public.work_order_statuses SET label='Customer archive' WHERE code='Closed'");
        } else if (process.argv[2] === "enable-delivery") {
          await pool.query("UPDATE public.projects SET customer_api_enabled=true WHERE id=$1", [fixture.projectId]);
        } else if (process.argv[2] === "auto") {
          await pool.query("UPDATE public.work_order_closing_policy SET enabled_at=now()-interval '10 days' WHERE project_id=$1", [fixture.projectId]);
          const { runAutomaticClosing } = await import("../server/work-order-lifecycle/service");
          await runAutomaticClosing();
          const rows = (await pool.query(`SELECT id,status FROM ${schema}.work_orders`)).rows;
          assert.equal(rows.find(r => r.id === saved.ids.auto)?.status, "Closed");
          for (const name of ["early", "missingTime", "first"]) assert.equal(rows.find(r => r.id === saved.ids[name])?.status, "Completed", name);
          for (const name of ["open", "scheduled", "trouble"]) assert.notEqual(rows.find(r => r.id === saved.ids[name])?.status, "Closed", name);
        } else if (process.argv[2] === "guide") {
          const { workOrderColumnGuide } = await import("../server/file-transfers/column-guide");
          const guide = await workOrderColumnGuide(fixture.projectId);
          const actual = (await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders'", [fixture.schema])).rows;
          assert.equal(guide.columns.length, actual.length);
          for (const field of ["closedAt", "closedBy", "reviewStartedAt"]) {
            const row = guide.columns.find(c => c.field === field)!;
            assert.ok(row); assert.equal(row.requirement, "managed"); assert.equal(row.scheduled, false); assert.equal(row.exportable, true);
          }
          assert.match(guide.columns.find(c => c.field === "status")!.note, /cannot.*Closed/);
        } else if (process.argv[2] === "roundtrip") {
          const { backupProjectDatabase, restoreProjectDatabase } = await import("../server/projectDb");
          const backup = await backupProjectDatabase(fixture.schema);
          const closed = backup.workOrders.find(w => w.id === saved.ids.auto)!;
          assert.ok(closed.closedAt); assert.equal(closed.closedBy, "System");
          const result = await withAuditContext({ actorId: fixture.id, actorLabel: fixture.username, actorKind: "user",
            source: "restore", operationId: randomUUID() }, () =>
            restoreProjectDatabase(fixture.schema, backup, { clearExisting: true }));
          assert.deepEqual(result.errors, []); assert.equal(result.restored, backup.workOrders.length);
          const { rows: [after] } = await pool.query(`SELECT * FROM ${schema}.work_orders WHERE id=$1`, [saved.ids.auto]);
          assert.equal(after.closed_at.toISOString(), new Date(closed.closedAt!).toISOString());
          assert.equal(after.closed_by, "System");
          assert.equal((await pool.query("SELECT enabled FROM public.work_order_closing_policy WHERE project_id=$1", [fixture.projectId])).rows[0].enabled, false);
        }
      }
    });
  } finally { await pool.end(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
