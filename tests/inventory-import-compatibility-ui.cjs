// Uses only the disposable inventory-ui-fixture.ts project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const XLSX = require("xlsx");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const f = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1280, height: 900 } });
  const api = async (method, path, data) => {
    const r = await context.request.fetch(path, { method, data });
    assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const errors = [];
  try {
    await api("POST", "/api/auth/local/login", f);
    const service = (await api("GET", "/api/service-types"))[0];
    await api("PUT", `/api/projects/${f.projectId}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", `/api/projects/${f.projectId}`, { changeoutEquipmentType: "both" });
    const systems = (await api("GET", "/api/system-types")).slice(0, 2);
    const modules = (await api("GET", "/api/module-types")).slice(0, 2);
    assert.equal(systems.length, 2); assert.equal(modules.length, 2);
    for (const [kind, types] of [["system", systems], ["module", modules]]) {
      for (const type of types) await api("PATCH", `/api/${kind}-types/${type.id}`, { projectIds: [...new Set([...(type.projectIds || []), f.projectId])] });
    }
    const types = {
      oldSystemType: systems[0].productId, newSystemType: systems[1].productId,
      oldModuleType: modules[0].productId, newModuleType: modules[1].productId,
    };
    const record = id => ({ customerWoId: id, customerId: id, customerName: "Import browser fixture", address: "Test only", serviceType: service.code, status: "Completed", ...types });
    const page = await context.newPage();
    page.on("pageerror", e => errors.push(e.stack || e.message));
    for (const enabled of [true, false]) {
      await api("PATCH", `/api/projects/${f.projectId}`, { inventoryEnabled: enabled });
      for (const format of ["csv", "xlsx", "json"]) {
        const row = record(`${enabled}-${format}`);
        await page.goto(`/projects/${f.projectId}/import`);
        if (format === "json") {
          await page.getByTestId("tab-json").click();
          await page.getByTestId("textarea-json").fill(JSON.stringify([row]));
        } else {
          const sheet = XLSX.utils.json_to_sheet([row]);
          const workbook = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(workbook, sheet, "Import");
          const buffer = format === "csv" ? Buffer.from(XLSX.utils.sheet_to_csv(sheet)) : XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
          await page.getByTestId("input-file-upload").setInputFiles({ name: `fixture.${format}`, mimeType: format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer });
          for (const key of Object.keys(types)) await expect(page.getByTestId(`select-map-${key}`)).toBeEnabled();
          await expect(page.getByRole("cell", { name: types.oldSystemType, exact: true })).toBeVisible();
        }
        const response = page.waitForResponse(r => r.url().endsWith(`/api/projects/${f.projectId}/import`) && r.request().method() === "POST");
        await page.getByTestId(format === "json" ? "button-import-json" : "button-import-file").click();
        const result = await (await response).json();
        assert.equal(result.imported + result.updated, 1, JSON.stringify(result));
        const orders = await api("GET", `/api/projects/${f.projectId}/work-orders`);
        const saved = (orders.workOrders || orders).find(o => o.customerWoId === row.customerWoId);
        assert.ok(saved);
        assert.equal(saved.status, "Completed");
        for (const [key, value] of Object.entries(types)) assert.equal(saved[key], value);
      }
    }
    await api("PATCH", `/api/projects/${f.projectId}`, { inventoryEnabled: true });
    const stock = await api("GET", `/api/projects/${f.projectId}/inventory`);
    assert.equal(stock.state.allocations.length, 0);
    const existing = await api("GET", `/api/projects/${f.projectId}/work-orders`);
    const open = (existing.workOrders || existing).find(o => o.customerWoId === "editor")
      || await api("POST", `/api/projects/${f.projectId}/work-orders`, { ...record("editor"), status: "Open" });
    for (const mobile of [false, true]) {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await page.goto(`/projects/${f.projectId}/work-orders?edit=${open.id}`);
      const accordion = page.getByTestId("accordion-system");
      if (await accordion.getAttribute("data-state") !== "open") await accordion.click();
      await page.getByTestId(mobile ? "button-mobile-system-edit" : "button-desktop-system-edit").click();
      for (const [key, value] of Object.entries(types)) {
        const suffix = key.replace(/([A-Z])/g, "-$1").toLowerCase();
        const trigger = page.getByTestId(`select-${mobile ? "mobile-" : ""}${suffix}`);
        await expect(trigger).toBeEnabled();
        await trigger.click();
        const list = key.includes("System") ? systems : modules;
        await page.getByRole("option", { name: list[mobile ? 0 : 1].productLabel, exact: true }).click();
      }
      const response = page.waitForResponse(r => r.url().endsWith(`/work-orders/${open.id}`) && r.request().method() === "PATCH");
      await page.getByTestId("button-save").click();
      assert.ok((await response).ok());
      const saved = await api("GET", `/api/projects/${f.projectId}/work-orders/${open.id}`);
      for (const key of Object.keys(types)) {
        const list = key.includes("System") ? systems : modules;
        assert.equal(saved[key.replace(/([A-Z])/g, "_$1").toLowerCase()], list[mobile ? 0 : 1].productId);
      }
      await page.screenshot({ path: `generated-artifacts/import-types-${mobile ? "phone" : "desktop"}.jpg`, fullPage: true });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: CSV, Excel and JSON imports with inventory on/off; all four type editors save on desktop and phone; ordinary imports leave stock untouched.");
  } finally {
    await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
