import "dotenv/config";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID || !process.env.REPLIT_DEV_DOMAIN ||
      process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
    throw new Error("Use this additive migration only in development. Managed production is migrated through Publish.");
  const { pool } = await import("../server/db");
  try { const { migrateFileTransfers } = await import("../server/file-transfers/schema"); await migrateFileTransfers(pool);
    console.log("Development file-transfer schema verified."); }
  finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
