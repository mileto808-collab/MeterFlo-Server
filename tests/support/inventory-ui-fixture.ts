import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import { pool } from "../../server/db";
import { storage } from "../../server/storage";
import { createProjectSchema } from "../../server/projectDb";
import { initializeInventory } from "../../server/inventoryMigration";
import { getProjectFilesPath } from "../../server/fileStorage";
import path from "node:path";
import { enableAuditing } from "../../server/auditContext";
import { emptyInventory, itemSchema, warehouseSchema, vendorSchema } from "../../shared/inventory";
import { saveInventory } from "../../server/inventoryService";
const file = "/tmp/meterflo-inventory-ui-fixture.json";
async function main() {
  if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(await fs.readFile(file, "utf8"));
    await fs.rm(path.join(await getProjectFilesPath(), `inventory-${fixture.projectId}`), { recursive: true, force: true });
    await pool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
    for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"]) await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [fixture.projectId]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [fixture.projectId]);
    await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=$1", [fixture.id]);
    await pool.query("DELETE FROM public.users WHERE id=$1", [fixture.id]);
    if (fixture.viewer) {
      await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=$1", [fixture.viewer.id]);
      await pool.query("DELETE FROM public.users WHERE id=$1", [fixture.viewer.id]);
      await pool.query("DELETE FROM public.subrole_permissions WHERE subrole_id=$1", [fixture.viewerRoleId]);
      await pool.query("DELETE FROM public.subroles WHERE id=$1", [fixture.viewerRoleId]);
    }
    await fs.unlink(file); return;
  }
  // Match the running server: audited schemas need their project scope mapping
  // registered at creation, not only during the server's startup scan.
  enableAuditing();
  await initializeInventory(pool);
  const suffix = randomUUID().slice(0, 8), password = `Fixture-${randomUUID()}!`;
  const admin = await storage.ensureAdministratorSubrole();
  const user = await storage.createLocalUser(`inventory-ui-${suffix}`, await bcrypt.hash(password, 4), "admin", "Inventory", "Fixture", null, admin.id);
  const { rows: [project] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Inventory UI fixture ${suffix}`]);
  const schema = await createProjectSchema(project.name, project.id);
  await pool.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
  await storage.assignUserToProject(user.id, project.id);
  if (process.argv.includes("--large-counts") || process.argv.includes("--operations")) {
    const state = emptyInventory();
    state.warehouses.push(warehouseSchema.parse({ id: "large", code: "LARGE", name: "large fixture", type: "physical", address: "Test only" }));
    state.items = Array.from({ length: 3000 }, (_, n) => itemSchema.parse({
      id: `capacity-${n}`, sku: `CAP-${String(n).padStart(4, "0")}`, name: `Capacity product ${n}`, tracking: "regular",
    }));
    state.stock = state.items.slice(0, 600).map(item => ({ warehouseId: "large", itemId: item.id, quantity: 2, serials: [], revision: 0 }));
    if (process.argv.includes("--operations")) {
      state.items = [
        itemSchema.parse({ id: "ops-meter", sku: "000001", name: "Operations meter", tracking: "serialized", equipment: "system" }),
        itemSchema.parse({ id: "ops-bulk", sku: "000002", name: "Operations seals", tracking: "regular" }),
      ];
      state.stock = [];
      state.vendors = [vendorSchema.parse({ id: "ops-vendor", name: "Operations supplier" })];
      state.warehouses = Array.from({ length: 45 }, (_, n) => warehouseSchema.parse({
        id: `ops-location-${n}`, code: `LOC-${String(n).padStart(3, "0")}`, name: `Operations location ${String(n).padStart(3, "0")}`,
        type: n % 2 ? "vehicle" : "physical", address: "100 Fixture Way", city: "Test city", active: n !== 44,
        vin: n % 2 ? "1HGCM82633A004352" : "", plate: n % 2 ? `000${n}` : "", plateState: n % 2 ? "CO" : "",
        assignedUserId: n % 2 ? user.id : null,
      }));
      for (let n = 0; n < 45; n++) {
        const id = String(n).padStart(3, "0"), orderId = `ops-order-${n}`, receiptId = `ops-receipt-${n}`;
        const warehouseId = `ops-location-${n}`;
        const occurredAt = new Date(Date.UTC(2026, 9, 1, 0, n)).toISOString();
        state.orders.push({ id: orderId, type: "purchase", orderNumber: `PO-2026-${id}`, vendorId: "ops-vendor",
          sourceId: null, destinationId: warehouseId, status: "partial", lines: [{ itemId: "ops-meter", quantity: 3, serials: [] }],
          received: [{ itemId: "ops-meter", quantity: 3, serials: [] }], dispatched: [], notes: "Fixture", createdAt: occurredAt });
        state.receipts.push({ id: receiptId, action: n % 2 ? "receive" : "accept", reference: orderId, warehouseId,
          lines: [{ itemId: "ops-meter", quantity: 3, serials: [`HOLD-${id}`] }], actor: user.id, occurredAt, reason: `Fixture movement ${id}` });
        state.shipmentHolds!.push({ id: `ops-hold-${n}`, itemId: "ops-meter", orderId, receiptId, warehouseId, quantity: 3,
          serials: [`HOLD-${id}`], unidentifiedQuantity: 2, expectedSerials: [], reason: `Fixture damage ${id}`,
          status: "held", actor: user.id, occurredAt, dispositions: [] });
        state.returns.push({ id: `ops-return-${n}`, workOrderId: 1000 + n, equipment: n % 2 ? "module" : "system",
          serial: `0000${id}`, disposition: "returned", warehouseId, status: n % 2 ? "pending" : "quarantine" });
      }
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("INSERT INTO public.inventory_state(project_id,state) VALUES($1,$2)", [project.id, JSON.stringify(emptyInventory())]);
      await saveInventory(client, project.id, emptyInventory(), state, randomUUID(), "countCapacityFixture");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
  const viewerRole = await storage.createSubrole({ key: `inventory-viewer-fixture-${suffix}`, label: "Inventory test viewer", baseRole: "user" });
  await storage.setSubrolePermissions(viewerRole.id, ["workOrders.view", "projects.view"]);
  const viewerPassword = `Fixture-${randomUUID()}!`;
  const viewer = await storage.createLocalUser(`inventory-viewer-${suffix}`, await bcrypt.hash(viewerPassword, 4), "user", "Inventory", "Viewer", null, viewerRole.id);
  await storage.assignUserToProject(viewer.id, project.id);
  await fs.writeFile(file, JSON.stringify({ projectId: project.id, schema, id: user.id, username: user.username, password,
    viewerRoleId: viewerRole.id, viewer: { id: viewer.id, username: viewer.username, password: viewerPassword } }), { mode: 0o600 });
  console.log("Isolated inventory UI fixture created.");
}
main().catch(() => { console.error("Inventory fixture setup failed."); process.exitCode = 1; }).finally(() => pool.end());
