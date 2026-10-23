// Source allowlist + synthetic owned-test examples only. No env, DB or credential reads.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import ts from "typescript";
import { execFileSync } from "node:child_process";

const output = "generated-artifacts/mobile-replacement-source";
const root = path.join(output, "meterflo-mobile-replacement-reference");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
async function emit(name: string, bytes: string | Buffer) {
  const target = path.join(root, name);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bytes);
}
const roots = [
  "shared/defective-replacement.ts", "shared/mobile-read-contract.ts", "shared/mobile-submission-contract.ts",
  "shared/inventory-wizard-use.ts", "shared/inventory-field-stock.ts", "shared/inventory-removal-policy.ts",
  "shared/inventory-location-types.ts", "shared/inventory-dispatch.ts", "shared/reading-precision.ts",
  "shared/exact-readings.ts", "shared/inventory.ts",
  "client/src/components/defective-replacement-panel.tsx", "client/src/components/system-changeout-wizard.tsx",
  "client/src/components/inventory/actual-use-collector.tsx", "client/src/hooks/use-changeout-draft.ts",
];
const serverFiles = [
  "server/replacementRoutes.ts", "server/replacementService.ts", "server/replacementSchema.ts",
  "server/replacementBackup.ts", "server/replacementReceipt.ts", "server/inventoryRequirements.ts",
  "server/changeoutService.ts", "server/changeoutWorker.ts", "server/inventoryDispatch.ts",
  "server/mobileSubmissions.ts",
  "server/projectDb.ts", "server/inventoryRoutes.ts",
  "client/src/components/work-order-detail.tsx", "client/src/components/start-system-changeout-dialog.tsx",
];
const seen = new Set<string>(), external = new Set<string>();
const manifest: { path: string; sha256: string; bytes: number }[] = [];
async function copy(file: string, follow = true) {
  file = path.normalize(file);
  if (seen.has(file)) return;
  if (!/^(shared|client\/src|server)\/[\w/.-]+\.(ts|tsx)$/.test(file)) throw new Error(`Source outside allowlist: ${file}`);
  const bytes = await fs.readFile(file);
  seen.add(file);
  await emit(`source/${file}`, bytes);
  manifest.push({ path: file, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
  if (!follow) return;
  for (const dependency of ts.preProcessFile(bytes.toString()).importedFiles) {
    const specifier = dependency.fileName;
    const base = specifier.startsWith("@shared/") ? path.join("shared", specifier.slice(8))
      : specifier.startsWith("@/") ? path.join("client/src", specifier.slice(2))
      : specifier.startsWith(".") ? path.join(path.dirname(file), specifier) : null;
    if (!base) { external.add(specifier); continue; }
    const candidates = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")];
    let resolved: string | undefined;
    for (const candidate of candidates) {
      try { if ((await fs.stat(candidate)).isFile()) { resolved = candidate; break; } } catch {}
    }
    if (!resolved) throw new Error(`Missing local source dependency: ${file} -> ${specifier}`);
    await copy(resolved);
  }
}
for (const file of roots) await copy(file);
for (const file of serverFiles) await copy(file, false);
for (const name of [
  "DEFECTIVE_EQUIPMENT_REPLACEMENT_HANDOFF.md", "MOBILE_READ_CONTRACT.md",
  "MOBILE_SUBMISSION_CONTRACT.md", "INVENTORY_PLAN_RECOVERY_CONTRACT.md", "CHANGEOUT_WIZARD_INVENTORY_ADDENDUM.md",
]) await emit(`docs/${name}`, await fs.readFile(`review-deliverables/meterflo-mobile/${name}`));
await emit("examples/technician-api.json", await fs.readFile("generated-artifacts/project-workspace/replacement-mobile-examples.json"));
await emit("SOURCE_MANIFEST.json", JSON.stringify({ sourceOnly: true, publicationVerified: false,
  customerData: false, files: manifest.sort((a, b) => a.path.localeCompare(b.path)),
  externalImports: [...external].sort() }, null, 2));
await emit("README.md", `# MeterFlo mobile defective-equipment replacement\n\nStart with docs/DEFECTIVE_EQUIPMENT_REPLACEMENT_HANDOFF.md.\n\nSource is for reference/adaptation, not an Expo dependency. Examples are synthetic owned-test HTTP responses. No credentials or customer data are included. Publication is not verified.\n`);
const zip = path.resolve(output, "meterflo-mobile-replacement-reference.zip");
await fs.rm(zip, { force: true });
execFileSync("zip", ["-q", "-r", zip, path.basename(root)], { cwd: output });
console.log(`${path.relative(process.cwd(), zip)}: ${manifest.length} source files, synthetic HTTP examples and contracts.`);
