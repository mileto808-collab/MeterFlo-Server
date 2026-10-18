// The owned sandbox supplies a disposable DB, app, accounts and IPC permission.
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Run through the owned workspace sandbox.");
const { execFileSync } = require("node:child_process");
for (const file of ["tests/work-order-routing-api.test.ts", "tests/technician-routing-api.test.ts"]) {
  execFileSync(process.execPath, ["--import", "tsx", "--test", file], { stdio: "inherit", env: process.env });
}
