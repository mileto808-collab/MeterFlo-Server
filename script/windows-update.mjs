import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { execute, acquireUpdateLock, verifyCheckout } = await import("./windows-update-tools.mjs?bootstrap");

// Dependency-free bootstrap. Import the maintenance runner only AFTER git pull,
// so the update uses the newly pulled implementation, not cached old code.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
try {
  if (process.platform !== "win32") throw new Error("This entry point is for Windows installations only.");
  if (args.length && !(args.length === 1 && args[0] === "--check"))
    throw new Error("Usage: deploy\\Update-MeterFlo.cmd [--check]");
  if (Number(process.versions.node.split(".")[0]) < 20) throw new Error("Node.js 20 or newer is required.");
  if (process.env.REPL_ID || process.env.REPLIT_DEPLOYMENT)
    throw new Error("This updater is for standalone Windows, not a hosted workspace or published app.");
  if (fs.existsSync(path.join(root, "meterflo.activation.json")))
    throw new Error("This instance uses staged customer releases. Follow CUSTOMER_CORE_UPDATES.md instead of in-place updating.");
  const instance = path.join(root, "meterflo.instance.json");
  if (fs.existsSync(instance) && JSON.parse(fs.readFileSync(instance, "utf8")).extensions?.length)
    throw new Error("Customer extension packages require the staged update process in CUSTOMER_CORE_UPDATES.md.");
  verifyCheckout(root, execute);
  for (const tool of ["npm", "pm2"]) execute(tool, ["--version"], root, true);
  // A crashed updater leaves an explicit lock; never run overlapping maintenance.
  const releaseLock = acquireUpdateLock(root);
  try {
    if (!args.includes("--check")) execute("git", ["pull", "--ff-only", "origin", "main"], root);
    const runner = await import("./windows-update-runner.mjs");
    execute("git", ["ls-files", "--error-unmatch", ...runner.requiredUpdateFiles], root, true);
    if (args.includes("--check")) {
      const { verifyPm2 } = await import("./windows-update-tools.mjs");
      verifyPm2(root, execute);
      execute(process.execPath, ["script/check-dependency-portability.mjs", "--files"], root);
      console.log("Preflight passed: update files are tracked, tools available, working tree clean and PM2 points to this installation. No pull, install, migration or restart was performed.");
    } else await runner.completeWindowsUpdate(root);
  } finally { releaseLock(); }
} catch (error) {
  if (error?.code === "EEXIST") console.error("An update lock already exists. Confirm no updater is running before removing generated-artifacts\\windows-update.lock.");
  else console.error(error instanceof Error ? error.message : "Windows update failed.");
  process.exitCode = 1;
}
