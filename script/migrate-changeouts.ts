import "dotenv/config";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID ||
      !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
    throw new Error("Changeout schema setup requires the explicit development workspace command. Production uses Publish.");
  const { pool } = await import("../server/db");
  try {
    const { migrateChangeoutSchema } = await import("../server/changeoutSchema");
    await migrateChangeoutSchema(pool);
    console.log("Development changeout schema installed; existing work orders and inventory preserved.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
