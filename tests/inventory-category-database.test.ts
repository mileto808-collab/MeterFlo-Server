import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { emptyInventory, itemSchema } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { readInventoryCategories, storedCategoryState } from "../server/inventoryCategories";
import { saveInventory } from "../server/inventoryService";
import { exportInventory, restoreInventory } from "../server/inventoryBackup";
import { withAuditContext } from "../server/auditContext";

test("category migration, rename, relational constraints, rollback and project restore", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind: "system", actorLabel: "Category database fixture", source: "category-test", operationId: randomUUID() }, async () => {
      await client.query("BEGIN");
      const { rows: projects } = await client.query(
        "INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true),($2,true) RETURNING id",
        [`Category fixture ${randomUUID()}`, `Other category fixture ${randomUUID()}`]);
      const [project, other] = projects;
      const schema = `project_category_fixture_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
      const legacy = emptyInventory();
      legacy.categories = ["Meters", "Unused"];
      legacy.items = [itemSchema.parse({ id: "one", sku: "ONE", name: "First", category: " meters ", tracking: "regular" }),
        itemSchema.parse({ id: "two", sku: "TWO", name: "Second", category: "METERS", tracking: "regular" })];
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2),($3,$4)",
        [project.id, JSON.stringify(legacy), other.id, JSON.stringify(emptyInventory())]);
      for (const item of legacy.items) await client.query(
        "INSERT INTO public.inventory_items(project_id,id,sku,data) VALUES($1,$2,$3,$4)",
        [project.id, item.id, item.sku, JSON.stringify(item)]);
      let state = await readInventoryCategories(client, project.id, legacy);
      assert.equal(state.categoryCatalog!.length, 2);
      const id = state.categoryCatalog!.find(c => c.name === "Meters")!.id;
      assert.ok(state.items.every(item => item.categoryId === id));
      const { rows: itemRows } = await client.query(
        "SELECT id,ctid::text,data,category_id FROM public.inventory_items WHERE project_id=$1 ORDER BY id", [project.id]);
      const operationId = randomUUID();
      const renamed = applyInventoryCommand(state, { action: "categoryRename", operationId, data: { id, newName: "Electric meters" } }, "fixture", true).state;
      await saveInventory(client, project.id, state, renamed, operationId, "categoryRename");
      const { rows: unchanged } = await client.query(
        "SELECT id,ctid::text,data,category_id FROM public.inventory_items WHERE project_id=$1 ORDER BY id", [project.id]);
      assert.deepEqual(unchanged, itemRows, "Rename must not rewrite item rows or relationships");
      state = await readInventoryCategories(client, project.id, renamed);
      assert.equal(state.items[0].category, "Electric meters");
      assert.equal(state.items[0].categoryId, id);
      const { rows: [audit] } = await client.query(
        "SELECT changes FROM public.inventory_movements WHERE project_id=$1 AND operation_id=$2", [project.id, operationId]);
      assert.deepEqual(audit.changes.stock, []);
      assert.deepEqual(audit.changes.entities.map((change: any) => change.field), ["categoryCatalog"]);
      const expectConstraint = async (sql: string, values: unknown[], code: string) => {
        await client.query("SAVEPOINT expected_constraint");
        await assert.rejects(client.query(sql, values), (error: any) => error.code === code);
        await client.query("ROLLBACK TO SAVEPOINT expected_constraint");
      };
      await expectConstraint("UPDATE public.inventory_items SET category_id=$2 WHERE project_id=$1", [project.id, randomUUID()], "23503");
      const foreignId = randomUUID();
      await client.query("INSERT INTO public.inventory_categories(project_id,id,name) VALUES($1,$2,'Foreign')", [other.id, foreignId]);
      await expectConstraint("UPDATE public.inventory_items SET category_id=$2 WHERE project_id=$1", [project.id, foreignId], "23503");
      await expectConstraint("DELETE FROM public.inventory_categories WHERE project_id=$1 AND id=$2", [project.id, id], "23503");
      await expectConstraint("INSERT INTO public.inventory_categories(project_id,id,name) VALUES($1,$2,'electric meters')",
        [project.id, randomUUID()], "23505");
      await client.query("SAVEPOINT failed_post");
      const failedId = randomUUID();
      const failed = applyInventoryCommand(state, { action: "categoryRename", operationId: failedId, data: { id, newName: "Rolled back" } }, "fixture", true).state;
      await saveInventory(client, project.id, state, failed, failedId, "categoryRename");
      await client.query("ROLLBACK TO SAVEPOINT failed_post");
      assert.equal((await readInventoryCategories(client, project.id, state)).categoryCatalog!.find(c => c.id === id)!.name, "Electric meters");
      const backup = JSON.parse(JSON.stringify(await exportInventory(client, schema)));
      assert.equal(backup.state.items[0].category, "", "Backups store IDs, not redundant relationship names");
      await restoreInventory(client, schema, backup);
      const restored = await readInventoryCategories(client, project.id, backup.state);
      assert.deepEqual(storedCategoryState(restored), backup.state);
      assert.equal(restored.items[0].categoryId, id);
      const otherSchema = `${schema}_other`;
      await client.query(`CREATE SCHEMA "${otherSchema}"`);
      await client.query(`CREATE TABLE "${otherSchema}".work_orders(id integer PRIMARY KEY)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [other.id, otherSchema]);
      await restoreInventory(client, otherSchema, backup);
      const imported = await readInventoryCategories(client, other.id, backup.state);
      assert.equal(imported.items[0].categoryId, id, "Restore into a fresh project retains portable IDs");
      assert.equal(imported.items[0].category, "Electric meters");
      const oldBackup = { state: legacy, movements: [], enabled: true };
      await restoreInventory(client, schema, oldBackup);
      const { rows: [oldRestored] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [project.id]);
      const upgraded = await readInventoryCategories(client, project.id, oldRestored.state);
      assert.equal(upgraded.categoryCatalog!.length, 2);
      assert.equal(upgraded.items[0].categoryId, upgraded.items[1].categoryId);
      assert.equal(upgraded.items[0].category, "Meters");
      await client.query("ROLLBACK");
    });
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
