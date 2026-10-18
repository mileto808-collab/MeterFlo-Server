import "dotenv/config";
import { pool } from "../server/db";
import { initializeReadingPrecision } from "../server/readingPrecisionMigration";

try {
  await initializeReadingPrecision(pool);
  console.log("Reading precision columns and validated range constraints are ready.");
} catch (error) {
  console.error("Reading precision upgrade failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
