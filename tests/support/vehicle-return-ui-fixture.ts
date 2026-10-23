import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../../server/db";
import { lockInventory, saveInventory } from "../../server/inventoryService";
import { warehouseSchema, itemSchema } from "../../shared/inventory";

async function seed() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned test sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockInventory(client, fixture.projectId), after = structuredClone(before);
    after.warehouses.push(warehouseSchema.parse({ id: "return-van", code: "RETURN-VAN", name: "Return vehicle",
      type: "vehicle", vin: "1HGCM82633A004352", plate: "RTN-1", plateState: "CO" }));
    after.warehouses.push(warehouseSchema.parse({ id: "return-staging", code: "RETURNS", name: "Returns",
      type: "physical", locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "Test returns staging area" }));
    after.items.push(itemSchema.parse({ id: "return-meter", sku: "RETURN-M", name: "Return meter", tracking: "serialized" }),
      itemSchema.parse({ id: "return-part", sku: "RETURN-P", name: "Return parts", tracking: "regular" }));
    after.stock.push({ warehouseId: "return-van", itemId: "return-meter", quantity: 2, serials: ["RETURN-A", "RETURN-B"], revision: 1 },
      { warehouseId: "return-van", itemId: "return-part", quantity: 5, serials: [], revision: 1 });
    after.returns.push({ id: "return-old", workOrderId: 123, equipment: "system", serial: "REMOVED-001",
      disposition: "returned", status: "pending", warehouseId: before.warehouses.find(row => row.type === "physical")!.id });
    after.revision++;
    await saveInventory(client, fixture.projectId, before, after, randomUUID(), "vehicleReturnFixture");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
