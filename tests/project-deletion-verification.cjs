const { execFileSync } = require("node:child_process");
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned database sandbox required.");
for (const test of ["tests/project-clean-backup-verification.ts", "tests/project-deletion.test.ts"])
  execFileSync(process.execPath, ["--import", "tsx", test], { stdio: "inherit", timeout: 180000 });
