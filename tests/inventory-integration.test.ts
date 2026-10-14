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

test("transactional completion, mobile usage, concurrency, import rollback, and inventory-aware restore", async () => {
  await initializeInventory(pool);
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
    const before = await inventoryState(project.id), backup = await backupProjectDatabase(schema);
    assert.ok(backup.inventory);
    await assert.rejects(restoreProjectDatabase(schema, { workOrders: backup.workOrders }), /no inventory snapshot/);
    await restoreProjectDatabase(schema, backup, { clearExisting: true });
    assert.deepEqual(await inventoryState(project.id), before);
    assert.equal((await work.getWorkOrder(allocatedId))?.newSystemId, "0001");
    await command("reconcileWorkOrder", { workOrderId: allocatedId, reason: "Fixture physical return confirmed", restoreUsedStock: true });
    assert.equal((await inventoryState(project.id)).stock[0].quantity, 2);
    await work.updateWorkOrder(allocatedId, { status: "Open" } as any);
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"]) await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [project.id]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    await pool.query("DELETE FROM public.users WHERE id=$1", [user.id]);
    await pool.end();
  }
});
