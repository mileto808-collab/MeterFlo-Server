import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { initializeInventory } from "../server/inventoryMigration";
import { createProjectSchema, getProjectWorkOrderStorage, backupProjectDatabase, restoreProjectDatabase } from "../server/projectDb";
import { inventoryState, postInventory } from "../server/inventoryService";
import { withAuditContext } from "../server/auditContext";
import type { InventoryCommand } from "../shared/inventory";
import { blankShipmentCapture } from "../shared/inventory-shipment-draft-model";
import { initializeAudit } from "../server/auditMigration";

test("transactional completion, mobile usage, concurrency, import rollback, and inventory-aware restore", async () => {
  await initializeInventory(pool);
  await initializeAudit(pool);
  const suffix = randomUUID().slice(0, 8);
  const administrator = await storage.ensureAdministratorSubrole();
  const user = await storage.createLocalUser(`inventory-fixture-${suffix}`, await bcrypt.hash(randomUUID(), 4), "admin", "Inventory", "Fixture", null, administrator.id);
  const { rows: [project] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Inventory fixture ${suffix}`]);
  const schema = await createProjectSchema(project.name, project.id);
  await pool.query("UPDATE public.projects SET database_name=$2,changeout_equipment_type='system' WHERE id=$1", [project.id, schema]);
  const scope = () => ({ actorId: user.id, actorLabel: "Inventory fixture", actorKind: "user" as const, source: "inventory-test", operationId: randomUUID() });
  const command = (action: InventoryCommand["action"], data: Record<string, unknown>, id = randomUUID()) =>
    withAuditContext(scope(), () => postInventory(project.id, { action, data, operationId: id }, user.id, true));
  const work = getProjectWorkOrderStorage(schema);
  const targets: Array<{ id: number; schema: string }> = [];
  try {
    await command("warehouse", { id: "w", code: "w", name: "Main", type: "physical", address: "Test location" });
    await command("vendor", { id: "v", name: "Vendor" });
    await command("item", { id: "meter", sku: "meter", name: "Meter", tracking: "serialized", equipment: "system" });
    await command("order", { id: "po", type: "purchase", destinationId: "w", vendorId: "v", lines: [{ itemId: "meter", quantity: 2 }] });
    await command("release", { orderId: "po" });
    const receiveId = randomUUID();
    await command("receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: ["0001", "0002"] }] }, receiveId);
    await command("receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: ["0001", "0002"] }] }, receiveId);
    assert.equal((await inventoryState(project.id)).stock[0].quantity, 2);
    await command("order", { id: "amend-po", type: "purchase", destinationId: "w", vendorId: "v", lines: [{ itemId: "meter", quantity: 1 }] });
    await command("release", { orderId: "amend-po" });
    await command("unrelease", { orderId: "amend-po" });
    await command("order", { id: "amend-po", type: "purchase", destinationId: "w", vendorId: "v",
      notes: "Amended before receiving", lines: [{ itemId: "meter", quantity: 3 }] });
    await command("release", { orderId: "amend-po" });
    await command("cancel", { orderId: "amend-po" });
    await command("archiveOrder", { orderId: "amend-po" });
    await command("restoreOrder", { orderId: "amend-po" });
    await command("archiveOrder", { orderId: "amend-po" });
    const { rows: poChanges } = await pool.query(
      "SELECT action,actor_id,changes FROM public.inventory_movements WHERE project_id=$1 AND action=ANY($2::text[]) ORDER BY id",
      [project.id, ["unrelease", "archiveOrder", "restoreOrder"]]);
    assert.deepEqual(poChanges.map(row => row.action), ["unrelease", "archiveOrder", "restoreOrder", "archiveOrder"]);
    assert.ok(poChanges.every(row => row.actor_id === user.id && row.changes.entities.some((change: any) => change.field === "orders/amend-po")));
    const { rows: poAudit } = await pool.query(
      "SELECT action,actor_id FROM meterflo_audit.events WHERE project_id=$1 AND action=ANY($2::text[])",
      [project.id, ["inventory.unrelease", "inventory.archiveOrder", "inventory.restoreOrder"]]);
    assert.equal(poAudit.length, 4);
    assert.ok(poAudit.every(row => row.actor_id === user.id));
    const deleted = await work.createWorkOrder({ customerWoId: "deleted-gap" } as any);
    await pool.query(`DELETE FROM "${schema}".work_orders WHERE id=$1`, [deleted.id]);
    const wo = await withAuditContext(scope(), () => work.createWorkOrder({ customerWoId: "fixture-wo", customerName: "Fixture", serviceType: "Electric", oldSystemId: "OLD1" } as any));
    const competitor = await work.createWorkOrder({ customerWoId: "competitor" } as any);
    const results = await Promise.allSettled([wo.id, competitor.id].map(id => command("assign", { workOrderId: id, lines: [{ itemId: "meter", warehouseId: "w", quantity: 1, serials: ["0001"] }] })));
    assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
    const allocatedId = (await inventoryState(project.id)).allocations[0].workOrderId;
    const current = await work.getWorkOrder(allocatedId);
    const usage = { operationId: randomUUID(), revision: 1, mode: "changeout", used: [{ warehouseId: "w", itemId: "meter", quantity: 1, serials: ["0001"] }],
      dispositions: current?.oldSystemId ? [{ equipment: "system", serial: "OLD1", disposition: "scrapped", warehouseId: null }] : [] };
    await assert.rejects(withAuditContext(scope(), () => work.updateWorkOrder(allocatedId, { status: "Completed", newSystemId: "WRONG", inventoryUsage: usage } as any)), /must match/);
    assert.equal((await inventoryState(project.id)).stock[0].quantity, 2);
    assert.notEqual((await work.getWorkOrder(allocatedId))?.status, "Completed");
    await withAuditContext(scope(), () => work.updateWorkOrder(allocatedId, { status: "Completed", newSystemId: "0001", inventoryUsage: usage } as any));
    await withAuditContext(scope(), () => work.updateWorkOrder(allocatedId, { status: "Completed", newSystemId: "0001", inventoryUsage: usage } as any));
    assert.equal((await inventoryState(project.id)).stock[0].quantity, 1);
    await assert.rejects(work.updateWorkOrder(allocatedId, { status: "Open" } as any), /cannot be reset/);
    await assert.rejects(withAuditContext(scope(), () => work.createWorkOrder({ customerWoId: "bad-import", inventoryItems: JSON.stringify([{ warehouseId: "w", itemId: "meter", quantity: 1, serials: ["MISSING"] }]) } as any)), /unavailable/);
    assert.equal(await work.getWorkOrderByCustomerWoId("bad-import"), undefined);
    await command("countStart", { id: "saved-draft", warehouseId: "w" });
    const draftData = { id: "saved-draft", revision: 0, reason: "Resume after restore",
      rows: [{ itemId: "meter", quantity: "", serials: "0002\npartial" }] };
    const competingDrafts = await Promise.allSettled([
      command("countSaveDraft", draftData), command("countSaveDraft", draftData),
    ]);
    assert.equal(competingDrafts.filter(result => result.status === "fulfilled").length, 1, "only one concurrent editor wins");
    assert.equal((await inventoryState(project.id)).counts[0].draft?.revision, 1);
    const { rows: draftMovements } = await pool.query(
      "SELECT actor_id FROM public.inventory_movements WHERE project_id=$1 AND action='countSaveDraft'", [project.id]);
    assert.deepEqual(draftMovements.map(row => row.actor_id), [user.id], "one deliberate draft save records its actor");
    await command("order", { id: "saved-shipment", type: "purchase", destinationId: "w", vendorId: "v",
      lines: [{ itemId: "meter", quantity: 2 }] });
    await command("release", { orderId: "saved-shipment" });
    await command("shipmentDraftSave", { id: randomUUID(), revision: 0, orderId: "saved-shipment", stage: "receive", capture: {
      ...blankShipmentCapture(), scanBuffers: { "meter-goodSerials": "0000 unfinished " },
    } });
    const { rows: shipmentDraftEvents } = await pool.query("SELECT changes FROM public.inventory_movements WHERE project_id=$1 AND action='shipmentDraftSave'", [project.id]);
    assert.equal(shipmentDraftEvents.length, 1);
    assert.ok(!JSON.stringify(shipmentDraftEvents).includes("0000 unfinished"), "save history summarizes buffers rather than repeatedly copying their raw text");
    await command("order", { id: "inspection-restore", type: "purchase", destinationId: "w", vendorId: "v",
      lines: [{ itemId: "meter", quantity: 4 }] });
    await command("release", { orderId: "inspection-restore" });
    await command("receive", { orderId: "inspection-restore", lines: [], damaged: [{ itemId: "meter", quantity: 4,
      serials: ["INSPECT-0003", "INSPECT-0004"], unidentifiedQuantity: 2, reason: "Damaged shipment" }] });
    const inspectedHold = (await inventoryState(project.id)).shipmentHolds!.find(h => h.orderId === "inspection-restore")!;
    const partialOperation = randomUUID();
    await command("resolveHold", { id: inspectedHold.id, outcome: "released", quantity: 1, serials: ["INSPECT-0003"],
      verifiedSerials: ["INSPECT-0003"], reason: "One unit inspected" }, partialOperation);
    await command("resolveHold", { id: inspectedHold.id, outcome: "returned", quantity: 1, unidentifiedQuantity: 1,
      reference: "RMA-project", reason: "One unreadable unit returned" });
    const { rows: inspectionAudit } = await pool.query(
      "SELECT actor_id,changes FROM meterflo_audit.events WHERE project_id=$1 AND entity_id=$2 AND action='inventory.resolveHold'",
      [project.id, partialOperation]);
    assert.equal(inspectionAudit.length, 1);
    assert.equal(inspectionAudit[0].actor_id, user.id);
    assert.ok(inspectionAudit[0].changes.some((change: any) =>
      change.field === `shipmentHolds/${inspectedHold.id}` && change.after.dispositions[0].quantity === 1));
    const before = await inventoryState(project.id), backup = await backupProjectDatabase(schema);
    assert.ok(backup.inventory);
    assert.ok(backup.inventory.state.orders.find(order => order.id === "amend-po")?.archivedAt, "cleared POs remain in portable backups");
    assert.deepEqual(backup.workOrders.map(w => w.id), [2, 3], "ordered IDs expose the fresh-sequence collision");
    for (const identity of [false, true]) {
      const { rows: [target] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Fresh restore ${suffix} ${identity}`]);
      const targetSchema = await createProjectSchema(target.name, target.id);
      targets.push({ id: target.id, schema: targetSchema });
      await pool.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [target.id, targetSchema]);
      if (identity) {
        await pool.query(`ALTER TABLE "${targetSchema}".work_orders ALTER COLUMN id DROP DEFAULT`);
        await pool.query(`DROP SEQUENCE "${targetSchema}".work_orders_id_seq`);
        await pool.query(`ALTER TABLE "${targetSchema}".work_orders ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY`);
      }
      const restored = await withAuditContext(scope(), () => restoreProjectDatabase(targetSchema, backup, { clearExisting: true }));
      assert.equal(restored.restored, 2);
      assert.deepEqual(await inventoryState(target.id), before, "posted serialized allocations, balances and operations survive");
      const invalidDraft = structuredClone(backup);
      invalidDraft.inventory!.state.counts[0].draft!.rows[0].itemId = "foreign-item";
      await assert.rejects(restoreProjectDatabase(targetSchema, invalidDraft, { clearExisting: true }), /invalid count draft/);
      assert.deepEqual(await inventoryState(target.id), before, "invalid draft restore leaves existing inventory intact");
      const invalidDisposition = structuredClone(backup);
      invalidDisposition.inventory!.state.shipmentHolds![0].dispositions![0].quantity = 4;
      await assert.rejects(withAuditContext(scope(), () => restoreProjectDatabase(targetSchema, invalidDisposition,
        { clearExisting: true })), /disposition|serial|held/i);
      assert.deepEqual(await inventoryState(target.id), before, "invalid partial disposition cannot replace inventory");
      const targetWork = getProjectWorkOrderStorage(targetSchema);
      assert.equal((await targetWork.getWorkOrder(allocatedId))?.newSystemId, "0001");
      const next = await targetWork.createWorkOrder({ customerWoId: "after-restore" } as any);
      assert.equal(next.id, 4, "new work-order sequence starts above the restored maximum");
      const invalid = structuredClone(backup);
      invalid.workOrders[1].customerWoId = invalid.workOrders[0].customerWoId;
      await assert.rejects(withAuditContext(scope(), () => restoreProjectDatabase(targetSchema, invalid, { clearExisting: true })), /duplicate key/);
      assert.ok(await targetWork.getWorkOrder(next.id), "failed replacement rolls back prior work orders");
      assert.deepEqual(await inventoryState(target.id), before);
      const { rows: events } = await pool.query("SELECT actor_id,outcome FROM meterflo_audit.events WHERE entity_type='projectRestore' AND project_id=$1", [target.id]);
      assert.ok(events.some(e => e.actor_id === user.id && e.outcome === "success"), "restore records authenticated initiation");
      assert.ok(events.some(e => e.actor_id === user.id && e.outcome === "failed"), "failure preserves prior audit evidence");
    }
    await assert.rejects(restoreProjectDatabase(schema, { workOrders: backup.workOrders }), /no inventory snapshot/);
    await restoreProjectDatabase(schema, backup, { clearExisting: true });
    assert.deepEqual(await inventoryState(project.id), before);
    assert.equal((await work.getWorkOrder(allocatedId))?.newSystemId, "0001");
    await command("reconcileWorkOrder", { workOrderId: allocatedId, reason: "Fixture physical return confirmed", restoreUsedStock: true });
    assert.equal((await inventoryState(project.id)).stock[0].quantity, 3);
    await work.updateWorkOrder(allocatedId, { status: "Open" } as any);
  } finally {
    for (const target of targets) {
      await pool.query(`DROP SCHEMA IF EXISTS "${target.schema}" CASCADE`);
      for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"]) await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [target.id]);
      await pool.query("DELETE FROM public.projects WHERE id=$1", [target.id]);
    }
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"]) await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [project.id]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    await pool.query("DELETE FROM public.users WHERE id=$1", [user.id]);
    await pool.end();
  }
});
