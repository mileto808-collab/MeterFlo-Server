import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { emptyInventory, warehouseSchema, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand, completeInventoryWorkOrder } from "../shared/inventory-engine";
import { removalConfig, removalChoices } from "../shared/inventory-removal-policy";
import { readRelationalInventory } from "../server/inventoryRelational";
import { saveInventory } from "../server/inventoryService";
import { exportInventory, restoreInventory } from "../server/inventoryBackup";
import { withAuditContext } from "../server/auditContext";

test("removal rules, FK isolation, historical rename and restore retain original custody", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind: "system", actorLabel: "Removal rule database fixture", source: "removal-test", operationId: randomUUID() }, async () => {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id", [`Removal test ${randomUUID()}`]);
      const schema = `removal_fixture_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY)`);
      await client.query(`INSERT INTO "${schema}".work_orders VALUES(1)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
      const legacy = emptyInventory();
      legacy.warehouses = [warehouseSchema.parse({ id: "w", code: "W", name: "Warehouse", type: "physical", address: "Fixture" })];
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [project.id, JSON.stringify(legacy)]);
      let state = await readRelationalInventory(client, project.id);
      const post = async (action: InventoryCommand["action"], data: Record<string, unknown>) => {
        const operationId = randomUUID();
        const result = applyInventoryCommand(state, { action, data, operationId }, "fixture", true);
        await saveInventory(client, project.id, state, result.state, operationId, action);
        state = await readRelationalInventory(client, project.id);
      };
      const rule = { ...removalConfig(state).rules[0], id: randomUUID(), name: "Contract return" };
      await post("removalRule", rule);
      await post("prepareUse", { workOrderId: 1, revision: 0, mode: "changeout", used: [], dispositions: [
        { equipment: "system", serial: "REMOVED-01", disposition: "returned", warehouseId: "w", ruleId: rule.id, ruleRevision: 1 },
      ] });
      const completed = completeInventoryWorkOrder(state, 1, false, "installer");
      await saveInventory(client, project.id, state, completed, randomUUID(), "workOrderCompleted");
      state = await readRelationalInventory(client, project.id);
      const before = (await client.query("SELECT ctid::text,rule_name FROM public.inventory_returns WHERE project_id=$1", [project.id])).rows;
      await post("removalRule", { ...rule, name: "Contract warehouse return" });
      assert.deepEqual((await client.query("SELECT ctid::text,rule_name FROM public.inventory_returns WHERE project_id=$1", [project.id])).rows, before);
      const expectFK = async (sql: string, params: unknown[]) => {
        await client.query("SAVEPOINT invalid_rule");
        await assert.rejects(async () => { await client.query(sql, params); await client.query("SET CONSTRAINTS ALL IMMEDIATE"); }, (error: any) => error.code === "23503");
        await client.query("ROLLBACK TO SAVEPOINT invalid_rule");
      };
      await expectFK("UPDATE public.inventory_returns SET rule_id=$2 WHERE project_id=$1", [project.id, randomUUID()]);
      await expectFK("DELETE FROM public.inventory_removal_rules WHERE project_id=$1 AND id=$2", [project.id, rule.id]);
      const backup = await exportInventory(client, schema);
      assert.ok(backup);
      const beforeRestore = structuredClone(state);
      await restoreInventory(client, schema, backup!);
      state = await readRelationalInventory(client, project.id);
      assert.deepEqual(state.removalRules, beforeRestore.removalRules);
      assert.deepEqual(state.removalPolicies, beforeRestore.removalPolicies);
      assert.deepEqual(state.returns, beforeRestore.returns);
      await post("returnAccept", { id: state.returns[0].id });
      const scrap = removalChoices(state, "system", "warehouse").find(r => r.outcome === "scrapped")!;
      await post("returnDecide", { id: state.returns[0].id, ruleId: scrap.id, ruleRevision: scrap.revision, reason: "Inspected, not repairable" });
      assert.equal(state.returns[0].history!.length, 3);
      assert.equal(state.stock.length, 0);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("ROLLBACK");
    });
  } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); await pool.end(); }
});
