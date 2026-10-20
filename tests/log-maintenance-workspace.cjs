// Run both suites only inside the owned disposable PostgreSQL/app harness.
const { spawnSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const config = process.env.WORKSPACE_UI_SANDBOX_CONFIG;
if (!config || !JSON.parse(readFileSync(config,"utf8")).ownedWorkspaceSandbox)
  throw new Error("Run through tests/support/project-workspace-sandbox.mjs.");
for (const args of [
  ["--import","tsx","--test","tests/log-maintenance.test.ts"],
  ["--import","tsx","tests/log-maintenance-ui.cjs"],
]) {
  const result = spawnSync(process.execPath,args,{stdio:"inherit",env:process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
