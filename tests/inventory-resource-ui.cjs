const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`, pattern = `**${endpoint}/commands`;
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(res.status(), 200, action);
    };
    await command("warehouse", { id: "main", code: "MAIN", name: "Main fixture", type: "physical", address: "Test only" });
    await command("item", { id: "base", sku: "BASE", name: "Base stocked", tracking: "regular" });
    await command("countStart", { id: "seed", warehouseId: "main" });
    await command("countPost", { id: "seed", reason: "Fixture only", lines: [{ itemId: "base", quantity: 2 }] });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const dialog = () => page.getByRole("dialog");
    const alert = () => dialog().getByRole("alert");
    const save = async status => {
      const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().method() === "POST");
      await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
      assert.equal((await response).status(), status);
      if (status === 200) await dialog().waitFor({ state: "hidden" });
      else await alert().waitFor();
    };
    const choose = async (label, option) => {
      await dialog().getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    const editBase = async () => {
      await page.getByRole("tab", { name: "Items", exact: true }).click();
      await page.getByRole("searchbox", { name: "Search items" }).fill("BASE");
      await page.locator("[data-catalog-row]").filter({ hasText: "Base stocked" }).getByRole("button", { name: "Edit", exact: true }).click();
    };

    // Required fields: local error, accessible focus, same open dialog.
    await page.getByRole("button", { name: "New item", exact: true }).click();
    await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
    await alert().waitFor();
    assert.match(await alert().innerText(), /Product ID \(SKU\)/);
    assert.equal(await alert().evaluate(el => el === document.activeElement), true);
    await page.getByLabel("Product ID (SKU)", { exact: false }).fill("base");
    await page.getByLabel("Product Label (Name)", { exact: false }).fill("Preserved product");
    await page.getByLabel("Product Description", { exact: true }).fill("Keep this description");
    await page.getByLabel("Cost", { exact: true }).fill("18.75");
    const png = await page.evaluate(() => {
      const c = document.createElement("canvas"); c.width = 2; c.height = 2;
      c.getContext("2d").fillRect(0, 0, 2, 2); return c.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Product images", { exact: true }).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.getByRole("img", { name: "Product image 1", exact: true }).waitFor();
    await save(409);
    assert.match(await alert().innerText(), /SKU already exists/);
    assert.equal(await page.getByLabel("Product Label (Name)", { exact: false }).inputValue(), "Preserved product");
    assert.equal(await page.getByLabel("Product Description", { exact: true }).inputValue(), "Keep this description");
    assert.equal(await page.getByRole("img", { name: "Product image 1", exact: true }).count(), 1);
    await page.setViewportSize({ width: 390, height: 844 });
    await alert().scrollIntoViewIfNeeded();
    await fs.mkdir("generated-artifacts/inventory-resource", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-resource/error-mobile.jpg" });
    await page.getByLabel("Product ID (SKU)", { exact: false }).fill("NEW");
    await save(200);
    const created = (await state()).items.find(i => i.sku === "NEW");
    assert.equal(created.cost, 18.75); assert.equal(created.images.length, 1);
    assert.equal(created.description, "Keep this description");

    // Stock/kit/deactivation restrictions remain enforced; corrections retry.
    await editBase();
    await choose("Tracking", "Serialized — scan each unit");
    await save(409);
    assert.match(await alert().innerText(), /Cannot change tracking/);
    assert.match(await page.getByRole("combobox", { name: "Tracking", exact: true }).innerText(), /Serialized/);
    await choose("Tracking", "Quantity tracked");
    await page.getByRole("button", { name: "Add component", exact: true }).click();
    await save(409);
    assert.match(await alert().innerText(), /kit definition/);
    assert.equal(await page.getByLabel("Quantity for component 1", { exact: true }).inputValue(), "1");
    await page.getByRole("button", { name: "Remove component 1", exact: true }).click();
    await page.getByRole("checkbox", { name: /^Active product/ }).uncheck();
    await save(409);
    assert.match(await alert().innerText(), /Item has stock/);
    assert.equal(await page.getByRole("checkbox", { name: /^Active product/ }).isChecked(), false);
    await page.getByRole("checkbox", { name: /^Active product/ }).check();
    await save(200);
    assert.equal((await state()).stock.find(b => b.itemId === "base").quantity, 2);

    // Invalid vehicle data and duplicate codes retain all location fields.
    await page.getByRole("tab", { name: "Locations", exact: true }).click();
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    await page.getByLabel("Code", { exact: true }).fill("MAIN");
    await page.getByLabel("Name", { exact: true }).fill("Preserved van");
    await dialog().getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Service vehicle", exact: true }).click();
    await page.getByLabel("VIN", { exact: true }).fill("bad-vin");
    await page.getByLabel("Plate", { exact: true }).fill("TEST-1");
    await page.getByLabel("Plate jurisdiction", { exact: true }).fill("CO");
    await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
    await alert().waitFor();
    assert.match(await alert().innerText(), /VIN/);
    assert.equal(await page.getByLabel("Plate", { exact: true }).inputValue(), "TEST-1");
    await page.getByLabel("VIN", { exact: true }).fill("1HGCM82633A004352");
    await save(409);
    assert.match(await alert().innerText(), /Warehouse code already exists/);
    await page.getByLabel("Code", { exact: true }).fill("VAN");
    await save(200);
    assert.equal((await state()).warehouses.find(w => w.code === "VAN").plate, "TEST-1");

    await page.getByRole("tab", { name: "Vendors", exact: true }).click();
    await page.getByRole("button", { name: "Add vendor", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Network supplier");
    await page.getByLabel("Email", { exact: true }).fill("invalid");
    await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
    await alert().waitFor(); assert.match(await alert().innerText(), /Email/);
    await page.getByLabel("Email", { exact: true }).fill("supplier@example.test");

    // Unknown server diagnostics must not appear in the dialog.
    await page.route(pattern, route => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "do-not-display-private-diagnostics" }) }));
    await save(500);
    assert.doesNotMatch(await alert().innerText(), /private-diagnostics/);
    await page.unroute(pattern);
    await page.route(pattern, route => route.abort("failed"));
    await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
    await alert().waitFor();
    assert.equal(await page.getByLabel("Email", { exact: true }).inputValue(), "supplier@example.test");
    await page.unroute(pattern);

    // Drop response AFTER commit: identical retry uses the same operation/resource IDs.
    let committedPayload;
    await page.route(pattern, async route => {
      committedPayload = route.request().postDataJSON();
      assert.equal((await route.fetch()).status(), 200);
      await route.abort("failed");
    });
    await dialog().getByRole("button", { name: "Save changes", exact: true }).click();
    await alert().waitFor();
    assert.equal((await state()).vendors.filter(v => v.name === "Network supplier").length, 1);
    await page.unroute(pattern);
    const retried = page.waitForRequest(r => r.url().endsWith(`${endpoint}/commands`) && r.method() === "POST");
    await save(200);
    assert.deepEqual((await retried).postDataJSON(), committedPayload);
    assert.equal((await state()).vendors.filter(v => v.name === "Network supplier").length, 1);

    // Pending saves lock inputs and dismissal; immediate duplicate clicks send once.
    await page.getByRole("button", { name: "Add vendor", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Slow supplier");
    let release, posts = 0;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(pattern, async route => { posts++; await gate; await route.continue(); });
    await dialog().getByRole("button", { name: "Save changes", exact: true }).evaluate(el => { el.click(); el.click(); });
    await page.getByRole("button", { name: "Saving...", exact: true }).waitFor();
    assert.equal(await page.getByLabel("Name", { exact: true }).isDisabled(), true);
    assert.equal(await dialog().getByRole("button", { name: "Cancel", exact: true }).isDisabled(), true);
    await page.keyboard.press("Escape");
    assert.equal(await dialog().isVisible(), true);
    await dialog().getByRole("button", { name: "Close", exact: true }).click();
    assert.equal(await dialog().isVisible(), true);
    const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().method() === "POST");
    release();
    assert.equal((await response).status(), 200);
    await dialog().waitFor({ state: "hidden" });
    assert.equal(posts, 1);
    await page.unroute(pattern);
    assert.equal((await state()).vendors.filter(v => v.name === "Slow supplier").length, 1);
    const granted = await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`,
      { data: { permissions: ["projects.view", "workOrders.view", "inventory.view"] } });
    assert.equal(granted.status(), 200);
    const viewer = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    try {
      assert.equal((await viewer.request.post("/api/auth/local/login", { data: {
        username: fixture.viewer.username, password: fixture.viewer.password,
      } })).status(), 200);
      assert.equal((await viewer.request.get(endpoint)).status(), 200);
      assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: {
        operationId: crypto.randomUUID(), action: "item",
        data: { id: "denied", sku: "DENIED", name: "Denied fixture", tracking: "regular" },
      } })).status(), 403);
      const readPage = await viewer.newPage();
      await readPage.goto(`/projects/${fixture.projectId}/inventory`);
      await readPage.getByRole("tab", { name: "Items", exact: true }).click();
      assert.equal(await readPage.getByRole("button", { name: "Add item", exact: true }).count(), 0);
      assert.equal(await readPage.getByRole("button", { name: "Add vendor", exact: true }).count(), 0);
      assert.equal(await readPage.getByRole("button", { name: "Edit", exact: true }).count(), 0);
      await readPage.getByRole("tab", { name: "Vendors", exact: true }).click();
      assert.equal(await readPage.getByRole("button", { name: "Add vendor", exact: true }).count(), 0);
      assert.equal(await readPage.getByRole("button", { name: "Edit", exact: true }).count(), 0);
      assert.equal((await state()).items.some(i => i.id === "denied"), false);
    } finally { await viewer.close(); }
    assert.deepEqual(errors, []);
    console.log("Resource form UI passed: required fields, duplicate SKU/code, preserved image/values, vehicle/vendor validation, stock/kit restrictions, network/lost-response retry, error privacy, duplicate/dismissal protection and normal role permissions.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
