import "dotenv/config";
import { pool } from "../server/db";
import { getProjectFilesPath } from "../server/fileStorage";
import { applyAttachmentMigration, readAttachmentJournal } from "../server/attachmentMigration";
import { assertAttachmentLayoutReady, inventoryInstanceAttachments } from "../server/attachmentMigrationCatalog";

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set(["--dry-run", "--check", "--apply", "--resume", "--offline"]);
  if (args.some(arg => !allowed.has(arg)) ||
      args.filter(arg => arg !== "--offline").length > 1 ||
      (args.includes("--offline") && !args.some(arg => arg === "--apply" || arg === "--resume"))) {
    throw new Error("Usage: --dry-run (default), --check, --apply --offline, or --resume --offline.");
  }
  const mode = args.find(arg => arg !== "--offline") ?? "--dry-run";
  if ((mode === "--apply" || mode === "--resume") && !args.includes("--offline")) {
    throw new Error("Stop all MeterFlo processes before using --apply --offline or --resume --offline.");
  }
  if (mode === "--check") {
    await assertAttachmentLayoutReady();
    console.log("Attachment layout verified. No files changed.");
    return;
  }
  const plan = mode === "--resume"
    ? await readAttachmentJournal(await getProjectFilesPath())
    : await inventoryInstanceAttachments();
  console.log(JSON.stringify({ mode, filesToMove: plan.moves.length,
    directoriesToMigrate: plan.directories.length, blockers: plan.blockers,
    unclaimedProjectDirectories: plan.unclaimedRoots }, null, 2));
  if (plan.blockers.length) throw new Error("Resolve all ownership, symlink and collision blockers first; no migration applied.");
  if (mode === "--dry-run") {
    if (plan.unclaimedRoots.length) console.log("Unclaimed root directories were not assigned by ID suffix. Review/archive them before applying migration; existing canonical projects are unaffected.");
    console.log("Read-only dry run. Stop MeterFlo before applying; no journal or directories were created.");
    return;
  }
  if (plan.unclaimedRoots.length) throw new Error("Review/archive unclaimed project directories before applying. No files changed.");
  if (mode === "--apply" && !plan.moves.length && !plan.directories.length) {
    await assertAttachmentLayoutReady();
    console.log("Already canonical; nothing to migrate.");
    return;
  }
  const result = await applyAttachmentMigration(plan, { offline: true });
  await assertAttachmentLayoutReady();
  console.log(`Verified ${result.moved} migrated files. Journal retained in the configured root's .meterflo-attachment-migration directory.`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; })
  .finally(() => pool.end());
