const { execFileSync } = require("node:child_process");
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
execFileSync(process.execPath, ["--import", "tsx", "tests/project-packages-verification.ts"], { stdio: "inherit", timeout: 240000 });
