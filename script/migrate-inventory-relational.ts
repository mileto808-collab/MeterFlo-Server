import "dotenv/config";
import { pool } from "../server/db";
import { applyInventoryCategorySchema } from "../server/inventoryCategoryMigration";
import { applyInventoryRelationalSchema } from "../server/inventoryRelationalSchema";
import { migrateRelationalInventories } from "../server/inventoryRelational";

const development = process.argv.includes("--development");
const standalone = process.argv.includes("--standalone");
try {
  if (development === standalone ||
      development && (!process.env.REPL_ID || process.env.NODE_ENV === "production") ||
      standalone && !!process.env.REPL_ID)
    throw new Error("Use --development only in the development workspace, or --standalone in backed-up standalone maintenance. Managed production receives schema through Publish.");
  await applyInventoryCategorySchema(pool);
  await applyInventoryRelationalSchema(pool);
  const count = await migrateRelationalInventories(pool);
  console.log(`Relational inventory migration verified for ${count} project inventories. IDs, history, revisions and replay identities retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Relational inventory migration failed.");
  process.exitCode = 1;
} finally { await pool.end(); }
