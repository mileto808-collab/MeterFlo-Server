import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../../server/db";
import { lockInventory, saveInventory } from "../../server/inventoryService";
import { warehouseSchema } from "../../shared/inventory";

async function seed() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockInventory(client, fixture.projectId), after = structuredClone(before);
    after.warehouses.push(warehouseSchema.parse({ id: "private-van", name: "Other crew private vehicle", code: "PRIVATE",
      type: "vehicle", vin: "1HGCM82633A004353", plate: "PRIVATE", plateState: "CO",
      locationTypeId: "57e15eca-f991-4328-a091-000000000002" }));
    after.stock.push({ warehouseId: "private-van", itemId: "return-part", quantity: 9, serials: [], revision: 1 });
    after.items.find(row => row.id === "return-part")!.name = "<Vehicle spare & part>";
    after.allocations.push({ workOrderId: 123, status: "reserved", revision: 1, mode: null, used: [], dispositions: [], lines: [
      { warehouseId: "return-van", itemId: "return-meter", quantity: 1, serials: ["RETURN-A"] }
    ] });
    after.revision++;
    await saveInventory(client, fixture.projectId, before, after, randomUUID(), "vehicleStockFixture");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
