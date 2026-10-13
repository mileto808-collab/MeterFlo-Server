import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { getProjectEquipmentVisibility } from "../shared/project-equipment-scope";

// Exercise the real print click handler and report template. Stub only React
// hooks/UI wrappers and the browser/PDF download boundary; no app auth is changed.
const bundle = await build({
  entryPoints: ["client/src/components/work-order-pdf.tsx"],
  bundle: true, write: false, format: "iife", globalName: "PdfComponent",
  jsx: "transform", jsxFactory: "element", jsxFragment: "Fragment",
  banner: { js: "function element(type, props, ...children) { return {type, props: props || {}, children}; } const Fragment = 'fragment';" },
  plugins: [{
    name: "pdf-boundaries",
    setup(builder) {
      builder.onResolve({ filter: /^(react|html2pdf\.js|lucide-react|@\/components\/ui\/.*)$/ },
        args => ({ path: args.path, namespace: "pdf-boundaries" }));
      builder.onLoad({ filter: /.*/, namespace: "pdf-boundaries" }, args => {
        if (args.path === "react") return { contents: "export const useState = value => [value, () => {}];" };
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

async function print(settings: Parameters<typeof getProjectEquipmentVisibility>[0], workOrder: object, files: string[] = []) {
  let html = "";
  let options: any;
  let saved = false;
  const nodes = new Map<string, any>();
  const document = {
    createElement(tag: string) {
      const attributes: Record<string, string> = {};
      return {
        style: { cssText: "" }, innerHTML: "",
        setAttribute(key: string, value: string) { attributes[key] = value; },
        attributes,
        ...(tag === "iframe" ? { contentDocument: {
          open() {}, close() {},
          write(value: string) { html = value; },
          querySelectorAll() { return []; },
          getElementById(id: string) { return id === "pdf-content" ? { id, html } : null; },
        } } : {}),
      };
    },
    body: {
      appendChild(node: any) {
        const attribute = Object.keys(node.attributes)[0];
        nodes.set(`[${attribute}]`, node);
      },
      querySelector(selector: string) { return nodes.get(selector); },
      removeChild(node: any) {
        for (const [key, value] of nodes) if (value === node) nodes.delete(key);
      },
    },
  };
  const context = vm.createContext({
    document, window: { location: { origin: "https://pdf-fixture.invalid" } },
    console, setTimeout: (callback: () => void) => callback(),
    requestAnimationFrame: (callback: () => void) => callback(),
    capturePdf() {
      const worker = {
        set(value: any) { options = value; return worker; },
        from(value: any) { assert.equal(value.id, "pdf-content"); return worker; },
        async save() { saved = true; },
      };
      return worker;
    },
  });
  vm.runInContext(bundle.outputFiles[0].text, context);
  const props = {
    workOrder, projectId: 42, projectName: "Print fixture",
    workOrderFiles: files, equipmentVisibility: getProjectEquipmentVisibility(settings),
    formatDateTime: () => "FORMATTED-DATE",
    getAssignedUserName: () => "Assigned technician",
    serviceTypes: [], troubleCodes: [],
    timeTracking: { startTime: "2026-01-01T10:00:00Z", endTime: "2026-01-01T10:01:00Z" },
  };
  const tree = context.PdfComponent.WorkOrderPdf(props);
  await find(tree, "button-generate-pdf").props.onClick();
  assert.equal(saved, true, "generation must reach PDF save, not silently fail");
  assert.equal(nodes.size, 0, "print iframe and overlay are cleaned up");
  return { html, options };
}

const record = Object.freeze({
  id: 7, customerWoId: "PRINT-FIXTURE", customerName: "Retained customer",
  notes: "Retained notes", signatureName: "Retained signature",
  oldSystemId: "LEGACY-OLD-SYSTEM", newSystemId: "LEGACY-NEW-SYSTEM",
  oldSystemReading: 0, newSystemReading: "123.123456",
  oldModuleId: "LEGACY-OLD-MODULE", newModuleId: "LEGACY-NEW-MODULE",
  oldModuleRead: 0, newModuleRead: "456.123456",
  oldGps: "40,-74", newGps: "41,-75",
});

test("print handler uses effective scope and retains common report content and PDF options", async () => {
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
    const { html, options } = await print(settings, record, ["fixture-photo.jpg"]);
    const visibility = getProjectEquipmentVisibility(settings);
    assert.equal(html.includes("LEGACY-OLD-SYSTEM"), visibility.showSystem);
    assert.equal(html.includes("LEGACY-NEW-SYSTEM"), visibility.showSystem);
    assert.equal(html.includes("LEGACY-OLD-MODULE"), visibility.showModule);
    assert.equal(html.includes("LEGACY-NEW-MODULE"), visibility.showModule);
    for (const common of ["Retained customer", "Retained notes", "Retained signature",
      "40,-74", "41,-75", "Time Tracking", "1m 0s", "Captured Photos", "fixture-photo.jpg"]) {
      assert.ok(html.includes(common), common);
    }
    assert.equal(options.filename, "WorkOrder_PRINT-FIXTURE.pdf");
    assert.equal(options.jsPDF.format, "a4");
    assert.equal(options.jsPDF.orientation, "portrait");
    assert.equal(options.html2canvas.scale, 2);
    assert.deepEqual(Array.from(options.margin), [8, 8, 8, 8]);
  }
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
