import "dotenv/config";
import { pool } from "../server/db";
import { applyInventoryCategorySchema, migrateInventoryCategoryData } from "../server/inventoryCategoryMigration";

const standalone = process.argv.includes("--standalone");
const development = process.argv.includes("--development");
try {
  if (standalone === development || development && (!process.env.REPL_ID || process.env.NODE_ENV === "production"))
    throw new Error("Choose --development in the Replit development workspace, or --standalone during backed-up standalone maintenance. Do not run this against Replit-managed production; use Publish.");
  await applyInventoryCategorySchema(pool);
  const count = await migrateInventoryCategoryData(pool);
  console.log(`Category schema ready. Migrated/verified ${count} project inventories. Stock and receipt history were not changed.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Category migration failed.");
  process.exitCode = 1;
} finally { await pool.end(); }
