// Local file diagnostics only: no dotenv, database imports, Git writes, or PM2.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { declaredMigrationFiles, ownedPath } from "../shared/customer-release";
import { inspectMigrationBytes } from "../shared/migration-integrity";

const usage = "Usage: npx --no-install tsx script/migration-checksums.ts --check | --repair-core <core-migration-id>";

function readManifest(file: string) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch { throw new Error("Cannot read migration metadata; inspect local manifests privately."); }
}

export function checkMigrationFiles(root: string, repairId?: string) {
  const core = readManifest(path.join(root, "meterflo.release.json"));
  const declarations = declaredMigrationFiles(root, core.migrations, "core");
  const instanceFile = path.join(root, "meterflo.instance.json");
  const instance = fs.existsSync(instanceFile) ? readManifest(instanceFile) : { extensions: [] };
  if (!Array.isArray(instance.extensions)) throw new Error("Invalid customer extension declarations");
  for (const item of instance.extensions) {
    if (typeof item?.directory !== "string" || !/^customer-packages\/[a-zA-Z0-9._/-]+$/.test(item.directory))
      throw new Error("Extensions must remain in their customer-packages ownership boundary");
    const directory = ownedPath(root, item.directory);
    const extension = readManifest(path.join(directory, "package.json")).meterfloExtension;
    if (!extension || !/^[a-z][a-z0-9-]{1,47}$/.test(extension.id))
      throw new Error("Invalid extension migration owner");
    declarations.push(...declaredMigrationFiles(directory, extension.migrations ?? [], `extension:${extension.id}`));
  }
  if (new Set(declarations.map(x => x.migration.id)).size !== declarations.length)
    throw new Error("Migration identifiers must be unique across owners");
  const results = declarations.map(entry => {
    const bytes = fs.readFileSync(entry.file);
    return { ...entry, bytes, inspection: inspectMigrationBytes(bytes, entry.migration.sha256) };
  });
  const reports = results.map(({ migration, inspection }) => ({
    owner: migration.ownership, id: migration.id, file: migration.file,
    status: inspection.status, expected: inspection.expected, actual: inspection.actual, lfHash: inspection.lfHash,
  }));
  // Preflight the entire catalog before any write. No other mismatched file,
  // including an extension, can be concealed by a successful core repair.
  const target = repairId ? results.find(x => x.migration.id === repairId && x.migration.ownership === "core") : undefined;
  if (repairId && !target) throw new Error("Repair requires the exact ID of a declared core migration; extension repair is not supported.");
  let backup: string | null = null;
  if (target && target.inspection.status !== "match") {
    if (!target.inspection.corrected || results.some(x => x !== target && x.inspection.status !== "match"))
      return { reports, success: false, repaired: false, backup };
    // Open the already ownership-checked file, retain its permissions/ACL, and
    // recheck the bytes immediately before the explicitly requested write.
    const fd = fs.openSync(target.file, "r+");
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || !fs.readFileSync(fd).equals(target.bytes))
        throw new Error("Migration changed or is hard-linked; no repair was performed.");
      const directory = path.join(root, "generated-artifacts", "migration-checksum-backups");
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      backup = path.join(directory, `${target.migration.id}-${randomUUID()}.bin`);
      fs.writeFileSync(backup, target.bytes, { flag: "wx", mode: 0o600 });
      // Positional write because reading the descriptor advanced its offset.
      try {
        let written = 0;
        while (written < target.inspection.corrected.length) {
          const count = fs.writeSync(fd, target.inspection.corrected, written, target.inspection.corrected.length - written, written);
          if (!count) throw new Error("Incomplete file write");
          written += count;
        }
        fs.ftruncateSync(fd, target.inspection.corrected.length);
        fs.fsyncSync(fd);
      } catch {
        throw new Error(`Repair write failed; retain the original-byte backup at ${JSON.stringify(path.relative(root, backup))} and recover the file before building.`);
      }
    } finally { fs.closeSync(fd); }
    if (inspectMigrationBytes(fs.readFileSync(target.file), target.migration.sha256).status !== "match")
      throw new Error(`Repaired file verification failed; retain ${JSON.stringify(path.relative(root, backup!))} and stop.`);
    target.inspection = inspectMigrationBytes(fs.readFileSync(target.file), target.migration.sha256);
  }
  return { reports, success: results.every(x => x.inspection.status === "match"), repaired: backup !== null,
    backup: backup ? path.relative(root, backup) : null };
}

async function main() {
  const args = process.argv.slice(2);
  if (!(args.length === 0 || args.length === 1 && args[0] === "--check" ||
    args.length === 2 && args[0] === "--repair-core")) throw new Error(usage);
  const result = checkMigrationFiles(process.cwd(), args[0] === "--repair-core" ? args[1] : undefined);
  for (const report of result.reports) console.log(JSON.stringify(report));
  if (result.backup) console.log(`Core migration repaired; original-byte backup: ${JSON.stringify(result.backup)}`);
  console.log("No SQL, database changes, approval changes, Git resets or PM2 commands were executed.");
  if (!result.success) {
    console.error("Checksum mismatch remains. Repair only a reported crlf-only CORE migration using --repair-core <id>. Never change the manifest or approvals to hide a mismatch.");
    process.exitCode = 1;
  } else console.log("Migration checksums match. Database/schema readiness and migration approvals still require separate review.");
}

// Importable for isolated tests; only the actual CLI entry invokes main.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href)
  main().catch(error => { console.error(error instanceof Error ? error.message : "Migration checksum check failed."); process.exitCode = 1; });
