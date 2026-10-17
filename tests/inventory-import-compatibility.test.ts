import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { createProjectSchema, getProjectWorkOrderStorage } from "../server/projectDb";
import { initializeInventory } from "../server/inventoryMigration";
import { applyInventoryCategorySchema } from "../server/inventoryCategoryMigration";
import { clearRelationalInventory } from "../server/inventoryRelational";
import { initializeAudit } from "../server/auditMigration";
import { enableAuditing, withAuditContext } from "../server/auditContext";
import { inventoryState, postInventory } from "../server/inventoryService";
import { fileImportScheduler } from "../server/fileImportScheduler";
import { importScheduler } from "../server/importScheduler";
import { ExternalDatabaseService } from "../server/externalDbService";
import { saveProjectFtpFile, ensureProjectDirectory } from "../server/fileStorage";
import fs from "node:fs/promises";

test("legacy imports and type editing are independent of inventory; real stock stays protected", async () => {
  enableAuditing();
  await initializeInventory(pool);
  await applyInventoryCategorySchema(pool);
  await initializeAudit(pool);
  const suffix = randomUUID().slice(0, 8);
  const role = await storage.ensureAdministratorSubrole();
  const user = await storage.createLocalUser(`import-test-${suffix}`, await bcrypt.hash(randomUUID(), 4), "admin", "Import", "Fixture", null, role.id);
  // Isolate fixture IDs from customer-restored identity sequences.
  const catalog = async (table: "system_types" | "module_types", kind: string) => {
    const types: Array<{ id: number; productId: string }> = [];
    for (const n of [1, 2]) {
      const productId = `import-${kind}-${suffix}-${n}`;
      const { rows: [row] } = await pool.query(`INSERT INTO public.${table}(id,product_id,product_label)
        OVERRIDING SYSTEM VALUE VALUES($1,$2,$3) RETURNING id`,
        [-randomInt(1000000, 2000000000), productId, `Import ${kind} ${n}`]);
      types.push({ id: row.id, productId });
    }
    return types;
  };
  const systems = await catalog("system_types", "system");
  const modules = await catalog("module_types", "module");
  const projects: Array<{ id: number; schema: string }> = [];
  const fields = (reverse = false) => ({
    oldSystemType: systems[reverse ? 1 : 0].productId, newSystemType: systems[reverse ? 0 : 1].productId,
    oldModuleType: modules[reverse ? 1 : 0].productId, newModuleType: modules[reverse ? 0 : 1].productId,
  });
  const scope = () => ({ actorId: user.id, actorLabel: "Import fixture", actorKind: "user" as const, source: "import-compatibility-test", operationId: randomUUID() });
  try {
    for (const enabled of [false, true]) {
      const { rows: [p] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,$2) RETURNING id,name", [`Import compatibility ${suffix} ${enabled}`, enabled]);
      const schema = await createProjectSchema(p.name, p.id);
      projects.push({ id: p.id, schema });
      await pool.query("UPDATE public.projects SET database_name=$2,changeout_equipment_type='system' WHERE id=$1", [p.id, schema]);
      const service = (await storage.getServiceTypes())[0];
      await storage.setProjectServiceTypes(p.id, [service.id]);
      const work = getProjectWorkOrderStorage(schema);
      const baseline = { customerId: "C1", customerName: "Import fixture", address: "Test only", serviceType: service.code };
      const ordinary = { ...baseline, customerWoId: "ordinary", status: "Completed", ...fields() };
      // No actor and no inventory.assign permission: ordinary imports must not
      // enter stock completion or manufacture an empty allocation.
      assert.deepEqual(await work.importWorkOrders([ordinary]), { imported: 1, updated: 0, errors: [] });
      let saved = await work.getWorkOrderByCustomerWoId("ordinary");
      assert.equal(saved?.status, "Completed");
      for (const [key, value] of Object.entries(fields())) assert.equal((saved as any)[key], value);
      assert.deepEqual(await work.importWorkOrders([{ ...ordinary, ...fields(true) }]), { imported: 0, updated: 1, errors: [] });
      saved = await work.getWorkOrderByCustomerWoId("ordinary");
      for (const [key, value] of Object.entries(fields(true))) assert.equal((saved as any)[key], value);
      const open = await work.createWorkOrder({ ...baseline, customerWoId: "editable", ...fields() } as any);
      const edited = await work.updateWorkOrder(open.id, fields(true));
      for (const [key, value] of Object.entries(fields(true))) assert.equal((edited as any)[key], value);
      const scheduled = { ...ordinary, customerWoId: "file-scheduled" };
      const columnMapping = Object.fromEntries(Object.keys(scheduled).map(key => [key, key]));
      const config = await storage.createFileImportConfig({
        projectId: p.id, name: "Compatibility file fixture", columnMapping, isEnabled: true, scheduleFrequency: "manual",
        processedFilePattern: "compatibility.json",
      });
      await withAuditContext(scope(), () => saveProjectFtpFile(p.name, p.id, "compatibility.json", Buffer.from(JSON.stringify([scheduled]))));
      const fileResult = await fileImportScheduler.runImport(config.id);
      assert.equal(fileResult.imported, 1, JSON.stringify(fileResult));
      const fromFile = await work.getWorkOrderByCustomerWoId("file-scheduled");
      for (const [key, value] of Object.entries(fields())) assert.equal((fromFile as any)[key], value);
      assert.equal(fromFile?.status, "Completed");
      await storage.deleteFileImportConfig(config.id);
      const dbConfig = await storage.createExternalDatabaseConfig({
        projectId: p.id, name: "Mocked source fixture", databaseType: "postgresql", host: "fixture.invalid",
        port: 5432, databaseName: "fixture", username: "fixture", password: "unused-test-placeholder", isActive: true,
      });
      const dbImport = await storage.createImportConfig({
        externalDbConfigId: dbConfig.id, name: "Compatibility SQL fixture", sqlQuery: "SELECT fixture",
        columnMapping, isEnabled: true, scheduleFrequency: "manual",
      });
      const originalQuery = ExternalDatabaseService.executeQuery;
      ExternalDatabaseService.executeQuery = async () => ({ success: true, data: [{ ...ordinary, customerWoId: "db-scheduled" }] }) as any;
      try {
        const dbResult = await importScheduler.runImport(dbImport.id);
        assert.equal(dbResult.imported, 1, JSON.stringify(dbResult));
        const fromDb = await work.getWorkOrderByCustomerWoId("db-scheduled");
        for (const [key, value] of Object.entries(fields())) assert.equal((fromDb as any)[key], value);
        assert.equal(fromDb?.status, "Completed");
      } finally {
        ExternalDatabaseService.executeQuery = originalQuery;
        await storage.deleteImportConfig(dbImport.id);
        await storage.deleteExternalDatabaseConfig(dbConfig.id);
        await fs.rm(await ensureProjectDirectory(p.name, p.id), { recursive: true, force: true });
      }
      if (!enabled) continue;
      const before = await inventoryState(p.id);
      assert.equal(before.allocations.length, 0);
      assert.equal(before.stock.length, 0);
      assert.equal(before.revision, 0);
      const command = (action: any, data: any) => withAuditContext(scope(), () => postInventory(p.id, { operationId: randomUUID(), action, data }, user.id, true));
      await command("warehouse", { id: "w", code: "W", name: "Test", type: "physical", address: "Test" });
      await command("vendor", { id: "v", name: "Test" });
      await command("item", { id: "meter", sku: "M", name: "Meter", tracking: "serialized", equipment: "system" });
      await command("order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "meter", quantity: 1 }] });
      await command("release", { orderId: "po" });
      await command("receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 1, serials: ["SERIAL-1"] }] });
      const lines = [{ warehouseId: "w", itemId: "meter", quantity: 1, serials: ["SERIAL-1"] }];
      await command("assign", { workOrderId: open.id, lines });
      const assigned = await inventoryState(p.id);
      const failed = await work.importWorkOrders([{ ...baseline, customerWoId: "editable", status: "Completed" }]);
      assert.equal(failed.errors.length, 1, "ordinary import must not bypass a real reservation");
      assert.deepEqual(await inventoryState(p.id), assigned, "failed import leaves stock unchanged");
      await assert.rejects(work.createWorkOrder({ ...baseline, customerWoId: "explicit", inventoryItems: lines } as any, undefined, true), /permission required/);
      assert.equal(await work.getWorkOrderByCustomerWoId("explicit"), undefined);
      const allocation = assigned.allocations.find(a => a.workOrderId === open.id)!;
      await withAuditContext(scope(), () => work.updateWorkOrder(open.id, { status: "Completed", newSystemId: "SERIAL-1", inventoryUsage: {
        operationId: randomUUID(), revision: allocation.revision, mode: "changeout", used: lines, dispositions: [],
      } } as any));
      const consumed = await inventoryState(p.id);
      assert.equal(consumed.stock[0].quantity, 0);
      await assert.rejects(work.updateWorkOrder(open.id, { status: "Open" }, undefined, true), /cannot be reset/);
      await assert.rejects(work.updateWorkOrder(open.id, { newSystemId: "OTHER" }, undefined, true), /Reconcile inventory/);
      await work.updateWorkOrder(open.id, fields(), undefined, true);
      assert.deepEqual(await inventoryState(p.id), consumed, "type-only editing does not alter consumed stock");
    }
  } finally {
    for (const p of projects.reverse()) {
      await pool.query(`DROP SCHEMA "${p.schema}" CASCADE`);
      await clearRelationalInventory(pool, p.id);
      await pool.query("DELETE FROM public.inventory_movements WHERE project_id=$1", [p.id]);
      await pool.query("DELETE FROM public.inventory_state WHERE project_id=$1", [p.id]);
      await pool.query("DELETE FROM public.projects WHERE id=$1", [p.id]);
    }
    for (const type of systems) await storage.deleteSystemType(type.id);
    for (const type of modules) await storage.deleteModuleType(type.id);
    await pool.query("DELETE FROM public.users WHERE id=$1", [user.id]);
    await pool.end();
  }
});
