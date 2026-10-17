// Development only. Managed production receives these changes through Publish,
// never a build hook, a production URL override, or this command.
import "dotenv/config";

async function main() {
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID ||
      process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1" ||
      process.env.REPLIT_ENVIRONMENT === "production") {
    throw new Error("Visit scheduling setup is restricted to the development workspace. Managed production receives schema through Publish.");
  }
  const { pool } = await import("../server/db");
  try {
    const { initializeVisitScheduling } = await import("../server/visitScheduling");
    await initializeVisitScheduling(pool);
    console.log("Development visit scheduling schema verified. Existing values preserved; legacy defaults remain unset.");
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Development visit scheduling setup failed.");
  process.exitCode = 1;
});
