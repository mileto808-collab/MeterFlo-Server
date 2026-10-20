import "dotenv/config";
async function main() {
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID ||
      !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1")
    throw new Error("GPS schema setup is restricted to the development workspace. Managed production receives schema through Publish.");
  const { pool } = await import("../server/db");
  try {
    const { migrateGpsSchema } = await import("../server/gpsSchema");
    await migrateGpsSchema(pool);
    console.log("Development GPS schema verified; existing coordinates and policies preserved. Old-GPS reuse defaults off.");
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
