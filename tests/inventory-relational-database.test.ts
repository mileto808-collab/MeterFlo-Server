import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pool } from "../server/db";
import { emptyInventory, itemSchema, warehouseSchema, type InventoryCommand } from "../shared/inventory";
import { applyInventoryCommand } from "../shared/inventory-engine";
import { readRelationalInventory } from "../server/inventoryRelational";
import { saveInventory } from "../server/inventoryService";
import { exportInventory, restoreInventory } from "../server/inventoryBackup";
import { storedCategoryState } from "../server/inventoryCategories";
import { withAuditContext } from "../server/auditContext";
import { savedVehicleTransferDraftSchema, vehicleTransferDraftCaptureSchema } from "../shared/inventory-vehicle-transfer-drafts";

test("relational migration, authoritative posting, constraints, rollback, replay and portable restore", async () => {
  const client = await pool.connect();
  try {
    await withAuditContext({ actorKind: "system", actorLabel: "Relational inventory fixture", source: "relational-test", operationId: randomUUID() }, async () => {
      await client.query("BEGIN");
      const { rows: [project] } = await client.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id", [`Relational fixture ${randomUUID()}`]);
      const schema = `project_rel_fixture_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`CREATE TABLE "${schema}".work_orders(id integer PRIMARY KEY)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
      const legacy = emptyInventory();
      legacy.categories = ["Meters", "Unused"];
      legacy.orderNumberCounters = { "2026": 1 };
      legacy.warehouses = [warehouseSchema.parse({ id: "w", code: "W", name: "Warehouse", type: "physical", address: "Fixture" })];
      legacy.items = [itemSchema.parse({ id: "meter", sku: "METER", name: "Meter", category: "Meters", tracking: "serialized" })];
      legacy.orders = [{ id: "order", type: "purchase", sourceId: null, vendorId: null, destinationId: "w", status: "released", notes: "", createdAt: "2026-01-01T00:00:00.000Z",
        orderNumber: "PO-2026-000001", lines: [{ itemId: "meter", quantity: 2, serials: [] }], received: [], dispatched: [] }];
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [project.id, JSON.stringify(legacy)]);
      let state = await readRelationalInventory(client, project.id);
      assert.equal(state.categoryCatalog!.length, 2);
      const post = async (action: InventoryCommand["action"], data: Record<string, unknown>, operationId = randomUUID()) => {
        const result = applyInventoryCommand(state, { action, data, operationId }, "fixture", true);
        if (!result.replay) await saveInventory(client, project.id, state, result.state, operationId, action);
        state = await readRelationalInventory(client, project.id);
        assert.deepEqual(storedCategoryState(state), storedCategoryState(result.state));
        return result;
      };
      const receiveId = randomUUID(), receive = { orderId: "order", lines: [{ itemId: "meter", quantity: 1, serials: ["SERIAL-001"] }] };
      await post("receive", receive, receiveId);
      const revision = state.revision;
      assert.equal((await post("receive", receive, receiveId)).replay, true);
      assert.equal(state.revision, revision);
      assert.equal(state.stock[0].quantity, 1);
      const { rows: [archive] } = await client.query("SELECT state FROM public.inventory_state WHERE project_id=$1", [project.id]);
      assert.equal(archive.state.stock.length, 0, "The retained pre-cutover archive is not updated by posts");
      const { rows: [serial] } = await client.query("SELECT serial FROM public.inventory_stock_serials WHERE project_id=$1", [project.id]);
      assert.equal(serial.serial, "SERIAL-001");
      await client.query("UPDATE public.inventory_items SET name='Authoritative relational name' WHERE project_id=$1 AND id='meter'", [project.id]);
      state = await readRelationalInventory(client, project.id);
      assert.equal(state.items[0].name, "Authoritative relational name");
      const constraint = async (sql: string, args: unknown[], code: string) => {
        await client.query("SAVEPOINT expected_failure");
        await client.query("SET CONSTRAINTS ALL IMMEDIATE");
        await assert.rejects(client.query(sql, args), (error: any) => error.code === code);
        await client.query("ROLLBACK TO SAVEPOINT expected_failure");
      };
      await constraint("DELETE FROM public.inventory_items WHERE project_id=$1 AND id='meter'", [project.id], "23503");
      await constraint("DELETE FROM public.inventory_orders WHERE project_id=$1 AND id='order'", [project.id], "23503");
      await constraint("DELETE FROM public.inventory_categories WHERE project_id=$1 AND name='Meters'", [project.id], "23503");
      await constraint("UPDATE public.inventory_order_lines SET item_id='not-in-this-project' WHERE project_id=$1", [project.id], "23503");
      await constraint("UPDATE public.inventory_state SET state=state||'{\"revision\":999}'::jsonb WHERE project_id=$1", [project.id], "23514");
      await constraint("DELETE FROM public.inventory_state WHERE project_id=$1", [project.id], "23514");
      await constraint("INSERT INTO public.inventory_stock_serials(project_id,warehouse_id,item_id,serial,_position) VALUES($1,'w','meter','SERIAL-001',1)", [project.id], "23505");
      await assert.rejects(post("itemDelete", { id: "meter" }), /Cannot delete/);
      const unusedCategory = state.categoryCatalog!.find(category => category.name === "Unused")!.id;
      await post("item", { id: "unused", sku: "UNUSED", name: "Unused item", tracking: "regular", categoryId: unusedCategory });
      await assert.rejects(post("categoryDelete", { id: unusedCategory }), /Assigned to 1 item/);
      const deletedId = randomUUID();
      await post("itemDelete", { id: "unused" }, deletedId);
      assert.equal((await post("itemDelete", { id: "unused" }, deletedId)).replay, true);
      await post("categoryDelete", { id: unusedCategory });
      assert.equal(state.items.some(item => item.id === "unused"), false);
      assert.equal(state.categoryCatalog!.some(category => category.id === unusedCategory), false);
      const { rows: [deletedAudit] } = await client.query("SELECT changes FROM public.inventory_movements WHERE project_id=$1 AND operation_id=$2", [project.id, deletedId]);
      assert.equal(deletedAudit.changes.entities[0].before.name, "Unused item");
      assert.equal(deletedAudit.changes.entities[0].after, null);
      await client.query("SAVEPOINT rollback_post");
      const baseline = structuredClone(state);
      await post("category", { name: "Rolled back" });
      await client.query("ROLLBACK TO SAVEPOINT rollback_post");
      state = await readRelationalInventory(client, project.id);
      assert.deepEqual(state, baseline);
      const beforeDrafts = structuredClone(state);
      const draftId = randomUUID(), pendingDraftId = randomUUID();
      const capture = vehicleTransferDraftCaptureSchema.parse({ mode: "stock", sourceId: "w", destinationId: "retired-vehicle",
        quantities: { meter: "1" }, scans: { meter: "SERIAL-001\nSERIAL-PART" }, reason: "Unfinished scanner capture" });
      state.vehicleTransferDrafts = [
        savedVehicleTransferDraftSchema.parse({ id: draftId, revision: 2, status: "editing", createdBy: "fixture",
          updatedBy: "fixture", savedAt: new Date().toISOString(), saveId: randomUUID(), capture }),
        savedVehicleTransferDraftSchema.parse({ id: pendingDraftId, revision: 1, status: "submitting", createdBy: "fixture",
          updatedBy: "fixture", savedAt: new Date().toISOString(), saveId: randomUUID(),
          capture: { ...capture, scans: { meter: "SERIAL-001" } }, command: {
            operationId: randomUUID(), action: "vehicleTransfer", data: {
              mode: "stock", revision: state.revision + 1, sourceId: "w", destinationId: "retired-vehicle",
              workOrders: [], lines: [{ itemId: "meter", quantity: 1, serials: ["SERIAL-001"] }],
              reason: capture.reason, physicallyConfirmed: true, draftId: pendingDraftId, draftRevision: 1,
            },
          } }),
      ];
      state.revision++;
      await saveInventory(client, project.id, beforeDrafts, state, randomUUID(), "vehicleTransferDraftSave");
      const expectedDrafts = structuredClone(state.vehicleTransferDrafts);
      state = await readRelationalInventory(client, project.id);
      assert.deepEqual(state.vehicleTransferDrafts, expectedDrafts, "database retains partial and exact-pending captures");
      const backup = JSON.parse(JSON.stringify(await exportInventory(client, schema)));
      assert.equal(backup.state.stock[0].serials[0], "SERIAL-001");
      await restoreInventory(client, schema, backup);
      assert.deepEqual(storedCategoryState(await readRelationalInventory(client, project.id)), backup.state);
      const { rows: [target] } = await client.query("INSERT INTO public.projects(name,inventory_enabled) VALUES('Fresh relational restore fixture',true) RETURNING id");
      const targetSchema = `${schema}_fresh`;
      await client.query(`CREATE SCHEMA "${targetSchema}"`);
      await client.query(`CREATE TABLE "${targetSchema}".work_orders(id integer PRIMARY KEY)`);
      await client.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [target.id, targetSchema]);
      await restoreInventory(client, targetSchema, backup);
      assert.deepEqual(storedCategoryState(await readRelationalInventory(client, target.id)), backup.state);
      await client.query("SET CONSTRAINTS ALL IMMEDIATE");
      await client.query("ROLLBACK");
    });
  } finally { await client.query("ROLLBACK"); client.release(); await pool.end(); }
});
