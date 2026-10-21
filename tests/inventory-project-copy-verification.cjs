const { execFileSync } = require("node:child_process");
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned database sandbox required.");
execFileSync(process.execPath, ["--import", "tsx", "tests/inventory-project-copy-verification.ts"], { stdio: "inherit", timeout: 120000 });
