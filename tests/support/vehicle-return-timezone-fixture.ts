import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import { pool } from "../../server/db";
import { lockInventory, saveInventory } from "../../server/inventoryService";
import { vehicleReturnCaptureSchema } from "../../shared/inventory-vehicle-returns";

async function seed() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned test sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await lockInventory(client, fixture.projectId), after = structuredClone(before);
    for (const kind of ["equipment", "stock", "count"] as const) {
      for (const savedAt of [
        "2026-03-08T06:59:59.000Z", "2026-03-08T07:00:00.000Z",
        "2026-11-01T05:30:00.000Z", "2026-11-01T06:30:00.000Z",
      ]) {
        (after.vehicleReturnDrafts ??= []).push({
          id: randomUUID(), revision: 1, status: "editing", saveId: randomUUID(), savedAt,
          createdBy: fixture.id, updatedBy: fixture.id,
          baseline: structuredClone(after.stock.filter(row => row.warehouseId === "return-van")),
          capture: vehicleReturnCaptureSchema.parse({ kind, sourceId: "return-van",
            destinationId: kind === "count" ? "" : "return-staging",
            itemIds: kind === "equipment" ? [] : ["return-meter"],
            returnIds: kind === "equipment" ? ["return-old"] : [],
            quantities: kind === "equipment" ? {} : { "return-meter": "1" },
            reason: "Timezone boundary verification" }),
        });
      }
    }
    after.revision++;
    await saveInventory(client, fixture.projectId, before, after, randomUUID(), "vehicleReturnTimezoneFixture");
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
seed().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
