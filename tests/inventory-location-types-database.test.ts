import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { emptyInventory, warehouseSchema, type InventoryCommand } from "../shared/inventory";
import { normalizeInventoryLocations, warehouseAccessible, defaultLocationTypeId } from "../shared/inventory-location-types";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { readRelationalInventory } from "../server/inventoryRelational";
import { saveInventory } from "../server/inventoryService";
import { withAuditContext } from "../server/auditContext";
import { exportInventory, restoreInventory } from "../server/inventoryBackup";

test("location type migration, relational constraints, rename, deletion and project restore are atomic", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind: "system", actorLabel: "Location types database fixture", source: "location-types-test", operationId: randomUUID() }, async () => {
      await client.query("BEGIN");
      const { rows: projects } = await client.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true),($2,true) RETURNING id", [`Location fixture ${randomUUID()}`, `Other location fixture ${randomUUID()}`]);
      const [project, other] = projects;
      const schema = `project_location_fixture_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
      const legacy = emptyInventory();
      legacy.warehouses = [warehouseSchema.parse({ id: "main", code: "MAIN", name: "Main", type: "physical", address: "10 Main", assignedUserId: "original", userIds: ["relief"] })];
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2),($3,$4)", [project.id, JSON.stringify(legacy), other.id, JSON.stringify(emptyInventory())]);
      let state = await readRelationalInventory(client, project.id);
      assert.equal(warehouseAccessible(state, state.warehouses[0], "unassigned-project-member", false), true);
      assert.equal(state.warehouses[0].assignedUserId, "original");
      assert.deepEqual(state.warehouses[0].userIds, ["relief"]);
      const first = JSON.stringify(state);
      assert.equal(JSON.stringify(await readRelationalInventory(client, project.id)), first);
      assert.equal((await client.query("SELECT count(*)::int n FROM public.inventory_location_types WHERE project_id=$1", [project.id])).rows[0].n, 2);
      const { rows: baseline } = await client.query("SELECT ctid::text,location_type_id FROM public.inventory_warehouses WHERE project_id=$1", [project.id]);
      const post = async (action: InventoryCommand["action"], data: Record<string, unknown>) => {
        const operationId = randomUUID();
        const result = applyInventoryCommand(state, { action, data, operationId }, "fixture", true);
        await saveInventory(client, project.id, state, result.state, operationId, action);
        state = await readRelationalInventory(client, project.id);
      };
      const typeId = defaultLocationTypeId("physical");
      await post("locationType", { id: typeId, name: "Central depots", kind: "physical", accessPolicy: "shared", expectedRevision: 1 });
      assert.deepEqual((await client.query("SELECT ctid::text,location_type_id FROM public.inventory_warehouses WHERE project_id=$1", [project.id])).rows, baseline, "Rename must not rewrite referencing warehouse rows");
      const expectConstraint = async (sql: string, values: unknown[], code: string, deferred = false) => {
        await client.query("SAVEPOINT expected_constraint");
        await assert.rejects(async () => {
          await client.query(sql, values);
          if (deferred) await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        }, (error: any) => error.code === code);
        await client.query("ROLLBACK TO SAVEPOINT expected_constraint");
      };
      await expectConstraint("UPDATE public.inventory_warehouses SET location_type_id=NULL WHERE project_id=$1", [project.id], "23514");
      await expectConstraint("UPDATE public.inventory_warehouses SET location_type_id=$2 WHERE project_id=$1", [project.id, randomUUID()], "23503", true);
      await expectConstraint("DELETE FROM public.inventory_location_types WHERE project_id=$1 AND id=$2", [project.id, typeId], "23503", true);
      const otherType = randomUUID();
      await client.query(`INSERT INTO public.inventory_location_types(project_id,_key,id,name,kind,access_policy,revision)
        VALUES($1,$2::text,$2::uuid,'Other only','mobile','assigned',1)`, [other.id, otherType]);
      await expectConstraint("UPDATE public.inventory_warehouses SET location_type_id=$2 WHERE project_id=$1", [project.id, otherType], "23503", true);
      await expectConstraint(`INSERT INTO public.inventory_location_types(project_id,_key,id,name,kind,access_policy,revision)
        VALUES($1,$2::text,$2::uuid,' central   depots ','physical','shared',1)`, [project.id, randomUUID()], "23505");
      const backup = (await exportInventory(client, schema))!;
      await post("locationType", { id: typeId, name: "Restricted depots", kind: "physical", accessPolicy: "assigned", expectedRevision: 2, confirmAffectedLocations: ["main"] });
      assert.equal(warehouseAccessible(state, state.warehouses[0], "unassigned-project-member", false), false);
      await restoreInventory(client, schema, backup);
      state = await readRelationalInventory(client, project.id);
      assert.deepEqual(state.locationTypes, backup.state.locationTypes);
      assert.equal(warehouseAccessible(state, state.warehouses[0], "unassigned-project-member", false), true);
      const oldBackup = structuredClone(backup);
      delete oldBackup.state.locationTypes;
      for (const warehouse of oldBackup.state.warehouses) delete warehouse.locationTypeId;
      await restoreInventory(client, schema, oldBackup);
      state = await readRelationalInventory(client, project.id);
      assert.equal(warehouseAccessible(state, state.warehouses[0], "unassigned-project-member", false), false, "Legacy restore must not broaden access");
      assert.deepEqual(state, normalizeInventoryLocations(oldBackup.state, "assigned"));
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
