// Development only. Managed production receives these changes through Publish,
// never a build hook, a production URL override, or this command.
import "dotenv/config";

async function main() {
  // REPLIT_ENVIRONMENT describes Replit's platform environment, not whether
  // this process is a published app; it can be "production" in the editor too.
  // REPLIT_DEPLOYMENT is the documented published-runtime flag. The dev domain
  // is an additional workspace-only signal and is unavailable in published apps.
  if (process.argv.slice(2).join(" ") !== "--development" || !process.env.REPL_ID ||
      !process.env.REPLIT_DEV_DOMAIN || process.env.NODE_ENV === "production" ||
      process.env.REPLIT_DEPLOYMENT === "1") {
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
