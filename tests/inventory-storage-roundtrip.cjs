// Use the same owned PostgreSQL sandbox as the signed-in inventory acceptance checks.
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
const result = require("node:child_process").spawnSync(process.execPath, [
  "--import", "tsx", "--test",
  "tests/inventory-system-backup.test.ts", "tests/inventory-relational-database.test.ts",
], { stdio: "inherit" });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
