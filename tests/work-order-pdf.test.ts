import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { getProjectEquipmentVisibility } from "../shared/project-equipment-scope";
import type { WorkOrderPrintInventory } from "../client/src/components/work-order-pdf-inventory";

// Exercise the real print click handler and report template. Stub only React
// hooks/UI wrappers and the browser print-window boundary; no app auth is changed.
const bundle = await build({
  entryPoints: ["client/src/components/work-order-pdf.tsx"],
  bundle: true, write: false, format: "iife", globalName: "PdfComponent",
  jsx: "transform", jsxFactory: "element", jsxFragment: "Fragment",
  banner: { js: "function element(type, props, ...children) { return {type, props: props || {}, children}; } const Fragment = 'fragment';" },
  plugins: [{
    name: "pdf-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^(react|@tanstack\/react-query|html2pdf\.js|lucide-react|@\/components\/ui\/.*)$/ },
        args => ({ path: args.path, namespace: "pdf-boundaries" }));
      builder.onLoad({ filter: /.*/, namespace: "pdf-boundaries" }, args => {
        if (args.path === "react") return { contents: "export const useState = value => [value, next => stateUpdates.push(next)];" };
        if (args.path === "@tanstack/react-query") return { contents: "export const useQuery = () => ({data: inventorySnapshot, refetch: async () => { events.push('fetch'); return {data: inventorySnapshot, isError: inventoryFailed}; }});" };
        if (args.path === "html2pdf.js") return { contents: "export default () => capturePdf();" };
        const exports = args.path === "lucide-react" ? ["Loader2", "Printer"]
          : args.path.endsWith("/dialog") ? ["Dialog", "DialogContent", "DialogDescription", "DialogFooter", "DialogHeader", "DialogTitle"]
            : args.path.endsWith("/radio-group") ? ["RadioGroup", "RadioGroupItem"]
              : args.path.endsWith("/label") ? ["Label"] : ["Button"];
        return { contents: exports.map(name => `export const ${name} = '${name}';`).join("\n") };
      });
    },
  }],
});

function find(node: any, testId: string): any {
  if (node?.props?.["data-testid"] === testId) return node;
  for (const child of node?.children?.flat(Infinity) || []) {
    const result = find(child, testId);
    if (result) return result;
  }
}

async function print(settings: Parameters<typeof getProjectEquipmentVisibility>[0], workOrder: object, files: string[] = [], inventorySnapshot?: WorkOrderPrintInventory, inventoryFailed = false, blocked = false) {
  let html = "";
  let opened = 0, closed = false, printCalls = 0;
  let printAction: (() => void) | undefined;
  const events: string[] = [], stateUpdates: unknown[] = [];
  const document = {
    title: "", open() {}, close() {}, body: { textContent: "" },
    write(value: string) { html = value; },
    getElementById() {
      return { addEventListener(event: string, callback: () => void) {
        assert.equal(event, "click"); printAction = callback;
      } };
    },
  };
  const popup = { document, opener: {} as unknown, closed: false,
    close() { closed = true; }, focus() {}, print() { printCalls++; } };
  const context = vm.createContext({
    inventorySnapshot, inventoryFailed, stateUpdates, events,
    document, window: { location: { origin: "https://pdf-fixture.invalid" },
      open() { events.push("open"); opened++; return blocked ? null : popup; } },
    console, setTimeout: (callback: () => void) => callback(),
    requestAnimationFrame: (callback: () => void) => callback(),
    capturePdf() { throw new Error("Printing must never trigger a PDF download."); },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const props = {
    workOrder, projectId: 42, projectName: "Print fixture",
    workOrderFiles: files, equipmentVisibility: getProjectEquipmentVisibility(settings),
    inventoryEnabled: !!inventorySnapshot || inventoryFailed,
    formatDateTime: () => "FORMATTED-DATE",
    getAssignedUserName: () => "Assigned technician",
    serviceTypes: [], troubleCodes: [],
    timeTracking: { startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T10:01:00Z" },
  };
  const tree = context.PdfComponent.WorkOrderPdf(props);
  await find(tree, "button-generate-pdf").props.onClick();
  assert.equal(printCalls, 0, "Preview must not automatically open the native print dialog.");
  if (!inventoryFailed && !blocked) assert.equal(opened, 1);
  return { html, opened, closed, popup, printAction, stateUpdates, events, printCalls: () => printCalls };
}

test("real print handler includes unreserved kit components and rejects failed inventory refresh", async () => {
  const inventory = {
    enabled: true, allocation: null, warehouses: [], items: [
      { id: "kit", sku: "KIT", name: "Print kit", unit: "each", components: [{ itemId: "labor", quantity: 1.5 }, { itemId: "seal", quantity: 2 }] },
      { id: "labor", sku: "LABOR", name: "Print labor", kind: "labor", unit: "hours", components: [] },
      { id: "seal", sku: "SEAL", name: "Print seal", unit: "each", components: [] },
    ], requirements: { workOrderId: 7, missing: [], lines: [{ itemId: "kit", quantity: 1 }] },
  } as unknown as WorkOrderPrintInventory;
  const printed = await print({}, record, [], inventory);
  for (const text of ["Print kit", "Print labor", "Print seal", "1.5 hours", "Planned items & labor"]) assert.ok(printed.html.includes(text), text);
  assert.doesNotMatch(printed.html, /background-color:\s*#|border-left:|Reserved stock|Consumed inventory|Reservation record/);
  const failed = await print({}, record, [], undefined, true);
  assert.doesNotMatch(failed.html, /id="pdf-content"|Print \/ Save PDF/, "a failed inventory refresh must not produce an incomplete report");
  assert.equal(failed.closed, true, "a failed inventory refresh closes the loading preview");
  assert.deepEqual(failed.events, ["open", "fetch"], "open synchronously before the inventory request");
});

test("billing-only line items retain ordinary work-order information in an uncolored report", async () => {
  const inventory = {
    enabled: true, warehouses: [], allocation: null, items: [
      { id: "meter", sku: "E460", name: "Electric meter", unit: "each", components: [], cost: 876543.21, billingRate: 125 },
      { id: "labor", sku: "LABOR", name: "Residential changeout labor", kind: "labor", unit: "hours", components: [], cost: 876543.21, billingRate: 45 },
      { id: "kit", sku: "KIT-E460", name: "Residential changeout kit", unit: "each", components: [{ itemId: "meter", quantity: 1 }, { itemId: "labor", quantity: 1.5 }] },
    ], requirements: { workOrderId: 7, missing: [], lines: [{ itemId: "kit", quantity: 1 }] },
  } as unknown as WorkOrderPrintInventory;
  const { html } = await print({}, { ...record, address: "4700 Apple Creek Drive", status: "Open" }, [], inventory);
  assert.match(html, /Billing rate/);
  assert.match(html, /125\.00/);
  assert.match(html, /45\.00/);
  assert.match(html, /1\.5 hours/);
  assert.doesNotMatch(html, /876543|[Cc]ost|background-color:\s*#|border-left:|Reservation record|Reserved stock|Consumed inventory|Removed equipment/);
  await mkdir("generated-artifacts/work-order-print", { recursive: true });
  await writeFile("generated-artifacts/work-order-print/planned.html", html);
  inventory.allocation = { workOrderId: 7, revision: 1, mode: "changeout", status: "consumed", lines: [],
    used: [{ itemId: "kit", warehouseId: "van", quantity: 1, serials: [] }], dispositions: [] };
  inventory.componentTrace = [{ sourceId: "assembled", kitItemId: "kit", quantity: 1, kitSerials: [], partialBatch: false,
    components: [{ itemId: "meter", quantity: 1, serials: [] }] }];
  const completed = await print({}, { ...record, address: "4700 Apple Creek Drive", status: "Completed" }, [], inventory);
  for (const value of ["Electric meter", "Residential changeout labor", "1.5 hours", "125.00", "45.00"]) assert.ok(completed.html.includes(value), value);
  assert.doesNotMatch(completed.html, /876543|[Cc]ost|Reservation record|Reserved stock|Consumed inventory/);
  await writeFile("generated-artifacts/work-order-print/preview.html", completed.html);
});

const record = Object.freeze({
  id: 7, customerWoId: "PRINT-FIXTURE", customerName: "Retained customer",
  notes: "Retained notes", signatureName: "Retained signature",
  oldSystemId: "LEGACY-OLD-SYSTEM", newSystemId: "LEGACY-NEW-SYSTEM",
  oldSystemReading: 0, newSystemReading: "123.123456",
  oldModuleId: "LEGACY-OLD-MODULE", newModuleId: "LEGACY-NEW-MODULE",
  oldModuleRead: 0, newModuleRead: "456.123456",
  oldGps: "40,-74", newGps: "41,-75",
});

test("print handler retains effective scope and opens a browser preview with native print controls", async () => {
  for (const settings of [
    { wizardMode: "changeout", changeoutEquipmentType: "system", readingEquipmentType: "module" },
    { wizardMode: "changeout", changeoutEquipmentType: "module" },
    { wizardMode: "reading_only", readingEquipmentType: "system", changeoutEquipmentType: "module" },
    { wizardMode: "reading_only", readingEquipmentType: "module", changeoutEquipmentType: "system" },
    { wizardMode: "changeout", changeoutEquipmentType: "both" },
    { wizardMode: "changeout", changeoutEquipmentType: "user_choice" },
    { wizardMode: "user_choice", changeoutEquipmentType: "system", readingEquipmentType: "module" },
    { wizardMode: "user_choice", changeoutEquipmentType: "system", readingEquipmentType: "system" },
    { wizardMode: "user_choice", changeoutEquipmentType: "module", readingEquipmentType: "module" },
    {},
  ]) {
    const { html, printAction, printCalls, popup } = await print(settings, record, ["fixture-photo.jpg"]);
    const visibility = getProjectEquipmentVisibility(settings);
    assert.doesNotMatch(html, /background-color:\s*#|border-left:|#7c3aed/);
    assert.equal(html.includes("LEGACY-OLD-SYSTEM"), visibility.showSystem);
    assert.equal(html.includes("LEGACY-NEW-SYSTEM"), visibility.showSystem);
    assert.equal(html.includes("LEGACY-OLD-MODULE"), visibility.showModule);
    assert.equal(html.includes("LEGACY-NEW-MODULE"), visibility.showModule);
    for (const common of ["Retained customer", "Retained notes", "Retained signature",
      "40,-74", "41,-75", "Time Tracking", "1m 0s", "Captured Photos", "fixture-photo.jpg"]) {
      assert.ok(html.includes(common), common);
    }
    assert.match(html, /Print \/ Save PDF/);
    assert.match(html, /@page\s*\{[^}]*size:\s*A4 portrait;[^}]*margin:\s*8mm;/);
    assert.match(html, /@media print/);
    assert.equal(popup.opener, null);
    assert.ok(printAction);
    printAction();
    assert.equal(printCalls(), 1, "Only the preview button opens the native print dialog.");
  }
});

test("blocked popups show an actionable error without a download or inventory request", async () => {
  const result = await print({}, record, [], { enabled: true } as WorkOrderPrintInventory, false, true);
  assert.equal(result.html, "");
  assert.deepEqual(result.events, ["open"]);
  assert.ok(result.stateUpdates.some(value => typeof value === "string" && /allow.*pop|pop.*allow/i.test(value)));
});

test("print preview escapes untrusted work-order and attachment text and rejects SVG signatures", async () => {
  const attack = `<img src=x onerror="window.__unsafe=true"><script>window.__unsafe=true</script>`;
  const { html } = await print({}, { ...record, customerName: attack, notes: attack, signatureName: attack,
    signatureData: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+" }, [`${attack}.jpg`]);
  assert.doesNotMatch(html, /<script|onerror="|data:image\/svg/i);
  assert.match(html, /&lt;img/);
  assert.match(html, /script-src 'none'/);
  assert.match(html, /object-src 'none'/);
});

test("print with only hidden equipment keeps GPS and common sections without irrelevant headings", async () => {
  const { html } = await print({ changeoutEquipmentType: "module" }, {
    id: 8, oldSystemId: "HIDDEN-SYSTEM", oldGps: "40,-74",
    customerName: "Retained customer", notes: "Retained notes", signatureName: "Retained signature",
  });
  assert.doesNotMatch(html, /Old System|New System|Old Module|New Module|HIDDEN-SYSTEM/);
  for (const common of ["Old Location", "40,-74", "Retained customer", "Retained notes", "Retained signature"]) {
    assert.ok(html.includes(common), common);
  }
});

test("detail page passes project visibility to the header print button and refreshes it when scope changes", async () => {
  const source = await readFile("client/src/components/work-order-detail.tsx", "utf8");
  const caller = source.match(/<WorkOrderPdf\b[\s\S]*?\/>/)?.[0];
  assert.ok(caller?.includes("equipmentVisibility={equipmentVisibility}"));
  assert.match(source, /setHeaderContent, handleStartSystemChangeout, equipmentVisibility/);
  const page = await readFile("client/src/pages/project-work-orders.tsx", "utf8");
  assert.match(page, /getProjectEquipmentVisibility\(project\)/);
  assert.match(page, /equipmentVisibility=\{equipmentVisibility\}/);
});
