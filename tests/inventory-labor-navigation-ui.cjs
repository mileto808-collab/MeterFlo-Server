// Run against a disposable tests/support/inventory-ui-fixture.ts fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
(async () => {
  const f = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1440, height: 1000 } });
  const root = `/api/projects/${f.projectId}`, base = `${root}/inventory`, errors = [];
  const request = async (method, path, data, status = 200) => {
    const res = await context.request.fetch(path, { method, data });
    assert.equal(res.status(), status, await res.text()); return res.json();
  };
  const command = (action, data, operationId = randomUUID()) => request("POST", `${base}/commands`, { action, data, operationId });
  const state = async () => (await request("GET", base)).state;
  try {
    await request("POST", "/api/auth/local/login", f);
    const project = await request("GET", root);
    const service = (await request("GET", "/api/service-types"))[0].code;
    await request("POST", `${root}/work-orders`, { customerWoId: `ROUTE-${Date.now()}`, customerName: "Route fixture",
      customerId: "TEST", address: "Fixture only", serviceType: service, status: "Scheduled", assignedUserId: f.id,
      scheduledAt: new Date(Date.now() + 86400000).toISOString() }, 201);
    const page = await context.newPage(); page.on("pageerror", e => errors.push(e.message));
    page.setDefaultTimeout(15000);
    const cacheKey = `meterflo:active-route:${f.id}:${f.projectId}`;
    await page.goto(`/projects/${f.projectId}/inventory`);
    await page.evaluate(key => sessionStorage.setItem(key, "{}"), cacheKey);
    await page.goto(`/projects/${f.projectId}/work-orders`);
    await expect(page.getByRole("button", { name: "New Work Order", exact: true })).toBeVisible();
    assert.equal(await page.evaluate(key => sessionStorage.getItem(key), cacheKey), "{}", "List navigation must not consume or open saved routes");
    await page.getByRole("button", { name: /Optimize route/i }).click();
    await expect(page.getByTestId("route-setup-dialog")).toBeVisible();
    const nav = page.getByTestId(`nav-project-${f.projectId}-work-orders`);
    // No external routing request is needed to test the mounted planner's
    // same-URL menu handler. Dispatch its click while setup overlays the page.
    if (!await nav.isVisible()) await page.getByText(project.name, { exact: true }).first().dispatchEvent("click");
    await nav.dispatchEvent("click");
    await expect(page.getByRole("button", { name: "New Work Order", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Scheduled stops", exact: true })).toHaveCount(0);
    await command("warehouse", { id: "w", code: "W", name: "Rate warehouse", type: "physical", address: "Fixture only" });
    await command("vendor", { id: "v", name: "Rate supplier" });
    await command("item", { id: "part", sku: "PART", name: "Pricing material", tracking: "regular", cost: 12, billingRate: 24 });
    await page.goto(`/projects/${f.projectId}/inventory`);
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    const addItem = async () => {
      const button = page.getByRole("button", { name: "Add item", exact: true });
      if (!await button.isVisible()) await page.getByRole("button", { name: /Search.*Tools/i }).first().click();
      await button.click();
    };
    await addItem();
    const editor = page.getByTestId("inventory-page-editor");
    const choose = async (id, name) => { await editor.locator(id).click(); await page.getByRole("option", { name, exact: true }).click(); };
    const save = async () => {
      const posted = page.waitForResponse(r => r.request().method() === "POST" && r.url().endsWith(`${base}/commands`));
      await page.getByTestId("inventory-editor-save").click();
      const res = await posted; assert.equal(res.status(), 200, await res.text());
      await expect(editor).toHaveCount(0);
    };
    await editor.getByLabel(/Product ID \(SKU\)/).fill("LABOR");
    await editor.getByLabel(/Product Label \(Name\)/).fill("Installation labor");
    await choose("#item-kind", "Labor — non-stock service");
    await expect(editor.locator("#item-unit")).toHaveValue("hour");
    await editor.locator("#item-cost").fill("22.5");
    await editor.locator("#item-billing-rate").fill("65");
    await expect(editor.locator("#item-tracking")).toHaveCount(0);
    fs.mkdirSync("generated-artifacts/labor-navigation", { recursive: true });
    await editor.locator("#item-billing-rate").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/labor-navigation/phone-pricing.jpg" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await save();
    let current = await state(), labor = current.items.find(i => i.sku === "LABOR");
    assert.equal(labor.kind, "labor"); assert.equal(labor.billingRate, 65); assert.equal(labor.cost, 22.5);
    // Reopen/edit persists a daily basis and both independent rates.
    await page.locator("[data-catalog-row]").filter({ hasText: "Installation labor" }).getByRole("button", { name: "Edit", exact: true }).click();
    await expect(editor.locator("#item-billing-rate")).toHaveValue("65");
    await editor.locator("#item-unit").fill("day");
    await save();
    labor = (await state()).items.find(i => i.id === labor.id);
    assert.equal(labor.unit, "day");
    await addItem();
    await editor.getByLabel(/Product ID \(SKU\)/).fill("KIT");
    await editor.getByLabel(/Product Label \(Name\)/).fill("Labor and materials kit");
    await editor.getByRole("button", { name: "Add component", exact: true }).click();
    await choose("#kit-component-0", "PART · Pricing material");
    await editor.getByLabel("Quantity for component 1", { exact: true }).fill("2");
    await editor.getByRole("button", { name: "Add component", exact: true }).click();
    await choose("#kit-component-1", "LABOR · Installation labor · Labor / day");
    await editor.getByLabel("Quantity for component 2", { exact: true }).fill("1.5");
    await expect(editor.getByTestId("kit-recipe-rates")).toContainText("57.75");
    await editor.getByRole("button", { name: "Use recipe cost", exact: true }).click();
    await editor.getByRole("button", { name: "Use recipe billing rate", exact: true }).click();
    await expect(editor.locator("#item-cost")).toHaveValue("57.75");
    await expect(editor.locator("#item-billing-rate")).toHaveValue("145.5");
    await save();
    current = await state();
    const kit = current.items.find(i => i.sku === "KIT");
    assert.equal(kit.components.find(c => c.itemId === labor.id).quantity, 1.5);
    assert.equal(kit.billingRate, 145.5);
    await command("order", { id: "po", type: "purchase", vendorId: "v", destinationId: "w", lines: [{ itemId: "part", quantity: 6 }] });
    await command("release", { orderId: "po" });
    await command("receive", { orderId: "po", lines: [{ itemId: "part", quantity: 6 }] });
    const assemblyId = randomUUID();
    await command("assemble", { warehouseId: "w", itemId: kit.id, quantity: 2, components: [{ itemId: "part", quantity: 4, serials: [] }] }, assemblyId);
    current = await state();
    assert.ok(!current.stock.some(s => s.itemId === labor.id));
    assert.equal(current.receipts.find(r => r.id === assemblyId).labor[0].quantity, 3);
    const printed = await context.request.get(`${base}/print/receipt/${assemblyId}`);
    assert.equal(printed.status(), 200);
    assert.match(await printed.text(), /Labor pricing snapshot/);
    assert.deepEqual(errors, []);
    console.log("PASS: Work Orders menu from active routes/saved-route cache; mobile labor create/edit; all-item rates; daily units; fractional kit labor; relational persistence and receipt printing; no labor stock.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
