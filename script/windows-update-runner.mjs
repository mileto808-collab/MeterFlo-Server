import fs from "node:fs";
import path from "node:path";
import { execute, verifyPm2 } from "./windows-update-tools.mjs";

export const requiredUpdateFiles = [
  "deploy/Update-MeterFlo.cmd", "script/windows-update.mjs",
  "script/windows-update-tools.mjs", "script/windows-update-runner.mjs",
  "script/windows-update-health.mjs", "script/build.ts", "script/build-output.ts",
  "script/migrate-inventory-relational.ts", "server/inventoryRelationalModel.ts",
  "server/inventoryRelationalSchema.ts", "server/inventoryRelationalCodec.ts",
  "migrations/inventory-category-ids.sql", ".gitattributes", "package-lock.json",
  "script/migrate-attachment-folders.ts", "server/attachmentMigration.ts",
  "server/attachmentMigrationCatalog.ts", "server/attachmentPaths.ts",
];

export async function completeWindowsUpdate(root, { run = execute, log = console.log } = {}) {
  for (const file of requiredUpdateFiles)
    if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing update file: ${file}. Nothing has been stopped.`);
  run("git", ["ls-files", "--error-unmatch", ...requiredUpdateFiles], root, true);
  run(process.execPath, ["script/check-dependency-portability.mjs", "--files"], root);
  verifyPm2(root, run);
  log("Stopping MeterFlo for dependency, build and inventory maintenance.");
  run("pm2", ["stop", "meterflo"], root);
  try {
    run("npm", ["ci", "--include=dev", "--include=optional", "--registry=https://registry.npmjs.org"], root);
    run(process.execPath, ["-e", "for (const p of ['tsx','typescript','vite','esbuild']) require.resolve(p)"], root);
    run("npm", ["run", "check"], root);
    run("npm", ["run", "test:windows-updates"], root);
    run("npm", ["run", "build"], root);
    // Invoke the installed executable, never npx's download-on-missing behavior.
    run(process.execPath, ["--import", "tsx", "script/migrate-inventory-relational.ts", "--standalone"], root);
    // Read-only gate. Older folders require explicit, reviewed offline maintenance.
    run(process.execPath, ["--import", "tsx", "script/migrate-attachment-folders.ts", "--check"], root);
    run("pm2", ["restart", "meterflo"], root);
    run(process.execPath, ["script/windows-update-health.mjs"], root);
    const processes = verifyPm2(root, run);
    if (processes.some(process => process.pm2_env?.status !== "online" || !process.pid))
      throw new Error("PM2 did not remain online after the health check.");
    run("pm2", ["save"], root);
    log("SUCCESS: updated build verified by HTTP and saved in PM2. Check the normal Apache URL and sign in.");
  } catch (error) {
    // Also stop an unstable candidate, rather than leaving PM2 in a crash loop.
    try { run("pm2", ["stop", "meterflo"], root); } catch {}
    log("UPDATE FAILED. MeterFlo is stopped. Fix the reported step and rerun the updater. Protected configuration/data were not reset; no migration approvals or database rollbacks were invented.");
    throw error;
  }
}
