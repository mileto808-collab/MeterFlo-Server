import "dotenv/config";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID || !process.env.REPLIT_DEV_DOMAIN ||
      process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
    throw new Error("Run this explicit migration only in development. Managed production is migrated through Publish.");
  const { pool } = await import("../server/db");
  try {
    const { migrateBackupSchema } = await import("../server/backups/schema");
    await migrateBackupSchema(pool);
    console.log("Backup scheduling development schema verified.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
