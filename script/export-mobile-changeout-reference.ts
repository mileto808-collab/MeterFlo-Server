// Export code references and synthetic fixtures only. Never reads env, DBs or user files.
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import assert from "node:assert/strict";
import { itemSchema, warehouseSchema, reservationSchema, emptyInventory } from "../shared/inventory";
import { inventoryCatalogItems } from "../shared/inventory-catalog-projection";
import { initialLocationTypes } from "../shared/inventory-location-types";
import { defaultRemovalRules, removalConfig, removalChoices } from "../shared/inventory-removal-policy";
import { fieldStockSettingsSchema, resolveFieldStock } from "../shared/inventory-field-stock";
import { workOrderInventoryCapabilities } from "../shared/work-order-inventory-capabilities";
import { plannedLineSchema } from "../shared/inventory-planning";
import { plannedUseDrafts, bindWizardEquipmentSerials, actualUseLinesAreValid } from "../shared/inventory-wizard-use";

const out = "generated-artifacts/mobile-changeout-source";
const root = path.join(out, "meterflo-mobile-changeout-reference");
await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });
const emit = async (name: string, content: string) => {
  const destination = path.join(root, name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
};
const parse = (name: string, text: string) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true,
  name.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
const roots = [
  "shared/inventory-wizard-use.ts", "shared/inventory-field-stock.ts",
  "shared/inventory-removal-policy.ts", "shared/inventory-location-types.ts", "shared/inventory.ts",
  "shared/work-order-inventory-capabilities.ts", "shared/inventory-catalog-projection.ts",
  "shared/inventory-dispatch.ts", "shared/reading-precision.ts", "shared/exact-readings.ts",
  "client/src/components/inventory/actual-use-collector.tsx",
];
const visited = new Map<string, string>();
const external = new Set<string>();
const dependencies: Record<string, string[]> = {};
async function collect(file: string) {
  if (visited.has(file)) return;
  assert.ok(file.startsWith("shared/") || file.startsWith("client/src/"), `Disallowed source: ${file}`);
  const text = await fs.readFile(file, "utf8");
  visited.set(file, text);
  const references = new Set<string>();
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      references.add(node.moduleSpecifier.text);
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal))
      references.add(node.argument.literal.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0])) references.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(parse(file, text));
  dependencies[file] = [];
  for (const spec of references) {
    let base: string;
    if (spec.startsWith("@shared/")) base = `shared/${spec.slice(8)}`;
    else if (spec.startsWith("@/")) base = `client/src/${spec.slice(2)}`;
    else if (spec.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
    else { external.add(spec); continue; }
    let resolved: string | undefined;
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}/index.ts`, `${base}/index.tsx`]) {
      try { if ((await fs.stat(candidate)).isFile()) { resolved = candidate; break; } } catch {}
    }
    assert.ok(resolved, `Unresolved local dependency ${spec} in ${file}`);
    dependencies[file].push(resolved);
    await collect(resolved);
  }
}
for (const file of roots) await collect(file);
for (const [file, text] of visited) await emit(file, text);

const wizardPath = "client/src/components/system-changeout-wizard.tsx";
const wizard = await fs.readFile(wizardPath, "utf8");
const wizardAst = parse(wizardPath, wizard);
const snippets: Array<{ title: string; start: number; end: number }> = [];
const add = (title: string, node: ts.Node) => snippets.push({ title, start: node.getStart(wizardAst), end: node.end });
function visitWizard(node: ts.Node) {
  if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) &&
      /inventory|project-equipment-scope|reading-precision|exact-readings/.test(node.moduleSpecifier.text)) add("Inventory-related import", node);
  if (ts.isFunctionDeclaration(node) && node.name?.text === "buildSuccessSteps") add("Step construction and inventory-enabled gate", node);
  if (ts.isCaseClause(node) && ts.isStringLiteral(node.expression) &&
      ["physicalChange", "newSystemId", "inventoryReview", "confirm"].includes(node.expression.text)) add(`Step ${node.expression.text} (validation or rendering)`, node);
  ts.forEachChild(node, visitWizard);
}
visitWizard(wizardAst);
function block(title: string, from: string, until: string) {
  const start = wizard.indexOf(from);
  const end = wizard.indexOf(until, start);
  assert.ok(start >= 0 && end > start, `Missing wizard section: ${title}`);
  snippets.push({ title, start, end });
}
block("Inventory query, actual-use state, source resolution, defaults review and non-destructive initialization",
  "  const inventoryQueryKey =", "  const [data, setData]");
block("Equipment-ID binding before display/review", "  const wizardActualUse =", "  const displayMode");
block("Actual use and removed-equipment submission envelope", "      const mode: \"changeout\" | \"reading_only\" =", "      const ownershipResponse =");
snippets.sort((a, b) => a.start - b.start);
await emit("reference/system-changeout-wizard.inventory-excerpts.md", [
  "# Current web wizard inventory source excerpts",
  `Source: ${wizardPath}. These are verbatim context snippets, not a standalone compilable component.`,
  "Port behavior to native UI; do not copy JSX or assume every web canProceed branch is complete native validation.",
  ...snippets.map(s => {
    const line = wizardAst.getLineAndCharacterOfPosition(s.start).line + 1;
    const endLine = wizardAst.getLineAndCharacterOfPosition(s.end).line + 1;
    return `## ${s.title} — source lines ${line}–${endLine}\n\n\`\`\`tsx\n${wizard.slice(s.start, s.end)}\n\`\`\``;
  }),
].join("\n\n"));

const routes = await fs.readFile("server/inventoryRoutes.ts", "utf8");
const routeAst = parse("server/inventoryRoutes.ts", routes);
let routeNode: ts.CallExpression | undefined;
function visitRoute(node: ts.Node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "get" &&
      node.arguments[0] && ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === "/api/projects/:projectId/work-orders/:workOrderId/inventory") routeNode = node;
  ts.forEachChild(node, visitRoute);
}
visitRoute(routeAst);
assert.ok(routeNode, "Work-order inventory route must exist");
await emit("reference/work-order-inventory-route.ts.txt", routeNode.getText(routeAst) + ";\n");

const actor = "example-technician";
const permissions = ["workOrders.view", "workOrders.edit", "inventory.view", "inventory.assign", "inventory.plan"];
const locationTypes = initialLocationTypes();
const vehicle = warehouseSchema.parse({ id: "example-vehicle", code: "EXAMPLE-VAN", name: "Example service vehicle",
  type: "vehicle", locationTypeId: locationTypes.find(t => t.kind === "vehicle")!.id,
  vin: "1HGCM82633A004352", plate: "EXAMPLE", plateState: "CO", userIds: [actor] });
const returns = warehouseSchema.parse({ id: "example-returns", code: "EXAMPLE-RETURNS", name: "Example returns staging",
  type: "physical", locationTypeId: locationTypes.find(t => t.name === "Staging")!.id,
  address: "Synthetic warehouse address — not customer data" });
const items = [
  itemSchema.parse({ id: "example-system", sku: "EXAMPLE-SYS", name: "Example serialized system", tracking: "serialized", equipment: "system", kind: "stock" }),
  itemSchema.parse({ id: "example-module", sku: "EXAMPLE-MOD", name: "Example serialized module", tracking: "serialized", equipment: "module", kind: "stock" }),
  itemSchema.parse({ id: "example-seal", sku: "EXAMPLE-SEAL", name: "Example safety seal", tracking: "regular", equipment: "none", kind: "stock" }),
  itemSchema.parse({ id: "example-kit", sku: "EXAMPLE-KIT", name: "Example changeout kit", tracking: "regular", equipment: "none", kind: "stock",
    components: [{ itemId: "example-system", quantity: 1 }, { itemId: "example-module", quantity: 1 }] }),
];
const fieldSettings = [fieldStockSettingsSchema.parse({ id: "field-defaults", sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "components" })];
const removalRules = defaultRemovalRules();
const removalPolicies = [removalConfig({}).policy];
const fieldRemovalChoices = ["system", "module"].map(equipment => ({
  id: `${equipment}:${removalRules[0].id}`, equipment: equipment as "system" | "module", ruleId: removalRules[0].id,
}));
const allocation = { workOrderId: 123, lines: [
  reservationSchema.parse({ itemId: "example-system", warehouseId: vehicle.id, quantity: 1, serials: ["EXAMPLE-SYS-NEW-001"] }),
  reservationSchema.parse({ itemId: "example-module", warehouseId: vehicle.id, quantity: 1, serials: ["EXAMPLE-MOD-NEW-001"] }),
  reservationSchema.parse({ itemId: "example-seal", warehouseId: vehicle.id, quantity: 1, serials: [] }),
], used: [], dispositions: [], mode: null, status: "reserved", revision: 1, assignmentVersion: 4 };
const manualLines = [plannedLineSchema.parse({
  id: "11111111-1111-4111-8111-111111111111", itemId: "example-seal", quantity: 1, kind: "addition",
})];
const response = {
  enabled: true, canSelect: true, canManageInventory: true,
  capabilities: workOrderInventoryCapabilities(permissions, { enabled: true, editable: true, readingOnly: false, consumed: false, stockEditable: true }),
  planRecovery: { version: 1, modes: ["lookup", "resolve"] },
  allocation,
  inventoryDispatch: { batchId: "example-batch", batchName: "Example route", receiptNumber: "PICK-2026-000001",
    vehicleId: vehicle.id, vehicleName: vehicle.name, stage: "ready_for_field", canStart: true },
  editable: true, workOrderStatus: "Open", timezone: "America/Denver",
  plan: { workOrderId: 123, revision: 1, lines: manualLines },
  stagingReceipts: [], reservationNeedsReview: false,
  requirements: { workOrderId: 123, lines: [{ itemId: "example-kit", quantity: 1 }, { itemId: "example-seal", quantity: 1 }],
    missing: [], automaticLines: [{ itemId: "example-kit", quantity: 1 }],
    manualLines, planRevision: 1 },
  items: inventoryCatalogItems(items, false), warehouses: [vehicle, returns], locationTypes, fieldSettings,
  revision: 12, canChangeFieldStock: false, componentTrace: [], stockDiscrepancies: [],
  removalRules, removalPolicies, fieldRemovalChoices,
  workflow: { wizardMode: "changeout", equipment: "both", readingEquipment: "both" },
};
// Check the full example's top-level projection against the current route itself.
const keys = new Set<string>();
const findProjection = (node: ts.Node) => {
  if (ts.isReturnStatement(node) && node.expression && ts.isObjectLiteralExpression(node.expression) &&
      node.expression.properties.some(p => p.name?.getText(routeAst) === "canChangeFieldStock"))
    node.expression.properties.forEach(p => { if (p.name) keys.add(p.name.getText(routeAst)); });
  ts.forEachChild(node, findProjection);
};
findProjection(routeNode);
assert.deepEqual(Object.keys(response).sort(), [...keys].sort());
const stockState = { ...emptyInventory(), ...response };
const resolved = resolveFieldStock(stockState, actor, false, vehicle.id);
assert.equal(resolved.source?.id, vehicle.id);
for (const equipment of ["system", "module"] as const)
  assert.ok(removalChoices(stockState, equipment, "field").some(r => r.outcome === "returned"));
const drafts = plannedUseDrafts(response.requirements.lines, items, vehicle.id, "components", allocation.lines);
const bound = bindWizardEquipmentSerials(drafts, items, { system: "EXAMPLE-SYS-NEW-001", module: "EXAMPLE-MOD-NEW-001" });
assert.ok(actualUseLinesAreValid(bound, items));
assert.ok(!actualUseLinesAreValid(bound.map(r => r.itemId === "example-system" ? { ...r, serials: "WRONG-SERIAL" } : r), items));
await emit("examples/technician-work-order-inventory.json", JSON.stringify(response, null, 2) + "\n");
await emit("examples/technician-context.json", JSON.stringify({
  synthetic: true, role: "user", actorId: actor, permissions,
  projectId: 7, workOrderId: 123, assignmentVersion: 4,
  projectSettings: { inventoryEnabled: true, wizardMode: "changeout", changeoutEquipmentType: "both",
    readingEquipmentType: "both", systemReadingDecimalPlaces: 3, moduleReadingDecimalPlaces: 0 },
  note: "Synthetic source-checked example, not a captured customer response. VIN/plate/address/IDs are synthetic. Never assume all technicians have these grants.",
}, null, 2) + "\n");

for (const name of ["CHANGEOUT_WIZARD_INVENTORY_ADDENDUM.md", "MOBILE_SUBMISSION_CONTRACT.md",
  "MOBILE_READ_CONTRACT.md", "WORK_ORDER_INVENTORY_PLANNING_CONTRACT.md", "INVENTORY_PLAN_RECOVERY_CONTRACT.md"])
  await emit(`docs/${name}`, await fs.readFile(`review-deliverables/meterflo-mobile/${name}`, "utf8"));
await emit("README.md", await fs.readFile("review-deliverables/meterflo-mobile/CHANGEOUT_SOURCE_BUNDLE_GUIDE.md", "utf8"));
await emit("DEPENDENCIES.json", JSON.stringify({ local: dependencies, externalPackages: [...external].sort() }, null, 2) + "\n");
const allFiles = async (dir: string): Promise<string[]> => (await Promise.all((await fs.readdir(dir, { withFileTypes: true }))
  .map(entry => entry.isDirectory() ? allFiles(path.join(dir, entry.name)) : [path.join(dir, entry.name)]))).flat();
const manifest = await Promise.all((await allFiles(root)).sort().map(async file => {
  const bytes = await fs.readFile(file);
  return { path: path.relative(root, file), bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
}));
await emit("MANIFEST.json", JSON.stringify({ generatedAt: new Date().toISOString(),
  source: "Current workspace source; no production publication claim", sourceRoots: roots,
  excluded: ["Environment files and values", "Credentials", "Databases", "Customer records", "Uploads", "Logs", "Git history", "node_modules"],
  files: manifest,
}, null, 2) + "\n");
const archive = path.join(out, "meterflo-mobile-changeout-inventory-source.zip");
await fs.rm(archive, { force: true });
execFileSync("python3", ["-c",
  "import pathlib,sys,zipfile; r=pathlib.Path(sys.argv[1]); z=zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED); [z.write(p,str(p.relative_to(r.parent))) for p in sorted(r.rglob('*')) if p.is_file()]; z.close()",
  root, archive]);
console.log(JSON.stringify({ archive, sharedAndClientSourceFiles: visited.size, archiveFiles: manifest.length + 1,
  bytes: (await fs.stat(archive)).size, validation: "Route top-level keys, source access, field removal choices, actual-use serial binding and reservation rejection checked" }, null, 2));
