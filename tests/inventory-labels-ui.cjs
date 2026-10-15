const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  try {
    const context = await browser.newContext({ baseURL });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    const commands = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(res.status(), 200, `${action}: ${await res.text()}`);
      return (await res.json()).state;
    };
    await commands("warehouse", { id: "main", code: "MAIN", name: "Main warehouse", type: "physical", address: "100 Test Way" });
    await commands("vendor", { id: "vendor", name: "Test supply" });
    // Same UUID-only shape as pre-change saved counts; no migration/reference field.
    const legacyId = crypto.randomUUID();
    await commands("countStart", { id: legacyId, warehouseId: "main" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("heading", { name: "Inventory", exact: true }).waitFor();
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).waitFor();

    const select = async (label, option) => {
      await page.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    const inspectHelp = async () => {
      const dialog = page.getByRole("dialog", { name: "Item details" });
      const issues = await dialog.evaluate(root => [...root.querySelectorAll("input, [role=combobox], [role=checkbox]")].flatMap(control => {
        const ids = (control.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
        const label = control.id && root.querySelector(`label[for="${CSS.escape(control.id)}"]`);
        return (!ids.length || ids.some(id => !document.getElementById(id)?.textContent?.trim()) || !label)
          ? [control.id || control.getAttribute("aria-label") || "unlabelled"] : [];
      }));
      assert.deepEqual(issues, []);
      assert.match(await dialog.innerText(), /not imported or synchronized automatically/);
      await page.getByLabel("Product ID (SKU)", { exact: false }).focus();
      await page.keyboard.press("Tab");
      assert.equal(await page.getByLabel("Product Label (Name)", { exact: false }).evaluate(el => el === document.activeElement), true);
    };
    for (const [sku, name, equipment] of [["METER-UI", "System fixture", "System"], ["RADIO-UI", "Module fixture", "Module"]]) {
      await page.getByRole("button", { name: "New item", exact: true }).click();
      await inspectHelp();
      await page.getByLabel("Product ID (SKU)", { exact: false }).fill(sku);
      await page.getByLabel("Product Label (Name)", { exact: false }).fill(name);
      await page.getByLabel("Product Description", { exact: true }).fill("Fixture product description");
      await page.getByLabel("Barcode", { exact: true }).fill("001234567890");
      await select("Tracking", "Serialized — scan each unit");
      await select("Equipment", equipment);
      await page.getByRole("button", { name: "Save changes", exact: true }).click();
      await page.getByRole("tab", { name: "Items & vendors", exact: true }).click();
      await page.getByText(name, { exact: false }).first().waitFor();
      const state = await snapshot(), item = state.items.find(i => i.sku === sku);
      assert.equal(item.name, name);
      assert.equal(item.description, "Fixture product description");
      assert.equal(item.barcode, "001234567890");
      assert.equal(item.tracking, "serialized");
      assert.equal(item.equipment, equipment.toLowerCase());
    }
    let state = await snapshot();
    const meter = state.items.find(i => i.sku === "METER-UI"), module = state.items.find(i => i.sku === "RADIO-UI");
    // Edit a persisted item through the actual UI and verify unchanged identity.
    await page.getByText("System fixture", { exact: false }).first().locator("../../..").getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByLabel("Product Description", { exact: true }).fill("Updated fixture description");
    await page.getByLabel("Cost", { exact: true }).fill("18.75");
    await page.getByLabel("Reorder point", { exact: true }).fill("6");
    const png = await page.evaluate(() => {
      const canvas = document.createElement("canvas"); canvas.width = 2; canvas.height = 2;
      canvas.getContext("2d").fillRect(0, 0, 2, 2); return canvas.toDataURL("image/png").split(",")[1];
    });
    await page.getByLabel("Product images", { exact: true }).setInputFiles({ name: "fixture.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
    await page.getByRole("img", { name: "Product image 1", exact: true }).waitFor();
    const [savedEdit] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`${endpoint}/commands`) && response.request().method() === "POST"),
      page.getByRole("button", { name: "Save changes", exact: true }).click(),
    ]);
    assert.equal(savedEdit.status(), 200);
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    state = await snapshot();
    const edited = state.items.find(i => i.id === meter.id);
    assert.equal(edited.description, "Updated fixture description");
    assert.equal(edited.cost, 18.75); assert.equal(edited.reorderPoint, 6); assert.equal(edited.images.length, 1);

    await commands("order", { id: "PO-HELP", type: "purchase", vendorId: "vendor", destinationId: "main",
      lines: [{ itemId: meter.id, quantity: 2 }, { itemId: module.id, quantity: 2 }] });
    await commands("release", { orderId: "PO-HELP" });
    await commands("receive", { orderId: "PO-HELP", lines: [
      { itemId: meter.id, quantity: 2, serials: ["000010", "000011"] },
      { itemId: module.id, quantity: 2, serials: ["000020", "000021"] },
    ] });
    const created = await context.request.post(`/api/projects/${fixture.projectId}/work-orders`, { data: {
      customerWoId: "LABELS-WO", customerId: "LABELS-CUSTOMER", customerName: "Fixture customer", address: "Test address",
      serviceType: "Electric", oldSystemId: "OLD-system", oldModuleId: "OLD-module", assignedUserId: fixture.id,
    } });
    assert.equal(created.status(), 201, await created.text());
    const wo = await created.json();
    const used = [{ itemId: meter.id, warehouseId: "main", quantity: 1, serials: ["000010"] },
      { itemId: module.id, warehouseId: "main", quantity: 1, serials: ["000020"] }];
    await commands("assign", { workOrderId: wo.id, lines: used });
    const complete = await context.request.post(`/api/mobile/projects/${fixture.projectId}/work-orders/${wo.id}/complete`, { data: {
      canChange: true, oldSystemReading: "1", newSystemReading: "0", newSystemId: "000010",
      oldModuleRead: "1", newModuleRead: "0", newModuleId: "000020",
      inventoryUsage: { operationId: crypto.randomUUID(), revision: 1, mode: "changeout", used,
        dispositions: [{ equipment: "system", serial: "OLD-system", disposition: "returned", warehouseId: "main" },
          { equipment: "module", serial: "OLD-module", disposition: "returned", warehouseId: "main" }] },
    } });
    assert.equal(complete.status(), 200, await complete.text());
    await page.reload();
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    assert.doesNotMatch(await page.locator("main").last().innerText(), /module meter|Returned meters|removed meter/i);
    await page.getByText("OLD-module", { exact: true }).waitFor();
    const moduleRow = page.locator("div.flex.flex-col.justify-between").filter({ hasText: "OLD-module" });
    await moduleRow.getByRole("button", { name: "Accept into quarantine" }).click();
    await moduleRow.getByText("quarantine", { exact: true }).waitFor();
    await moduleRow.getByRole("combobox").click();
    await page.getByRole("option", { name: "RADIO-UI · Module fixture", exact: true }).click();
    await moduleRow.getByRole("textbox", { name: "Inspection result" }).fill("Fixture inspection passed");
    await moduleRow.getByRole("button", { name: "Release to stock" }).click();
    await moduleRow.getByText("released", { exact: true }).waitFor();

    await page.getByRole("tab", { name: "Counts & assembly", exact: true }).click();
    await page.getByText("Count #1", { exact: true }).waitFor();
    assert.doesNotMatch(await page.locator("main").last().innerText(), new RegExp(legacyId));
    await page.getByRole("button", { name: "Continue count", exact: true }).click();
    await page.getByRole("heading", { name: "Count #1 · Main warehouse", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancel count", exact: true }).click();
    await page.getByText("cancelled", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Start count", exact: true }).click();
    await page.getByRole("heading", { name: "Count #2 · Main warehouse", exact: true }).waitFor();
    state = await snapshot();
    const count = state.counts[1];
    // Untouched displayed serial defaults must be submitted, not replaced by [].
    for (const row of count.snapshot)
      assert.equal(await page.locator(`#countserial-${row.itemId}`).inputValue(), row.serials.join("\n"));
    await page.getByLabel("Count adjustment reason").fill("Fixture count verified");
    const [countPosted] = await Promise.all([
      page.waitForResponse(response => response.url().endsWith(`${endpoint}/commands`) &&
        response.request().method() === "POST" && response.request().postDataJSON()?.action === "countPost"),
      page.getByRole("button", { name: "Post count", exact: true }).click(),
    ]);
    assert.equal(countPosted.status(), 200, await countPosted.text());
    await page.getByText("posted", { exact: true }).waitFor();
    const printed = await context.request.get(`${endpoint}/print/count/${count.id}`);
    assert.equal(printed.status(), 200);
    const html = await printed.text();
    assert.match(html, /Reference: Count #2/);
    assert.match(html, /Main warehouse/); assert.doesNotMatch(html, new RegExp(count.id));
    const [printPage] = await Promise.all([
      context.waitForEvent("page"), page.getByRole("button", { name: "Print", exact: true }).click(),
    ]);
    await printPage.getByText("Reference: Count #2", { exact: false }).waitFor();
    await printPage.close();
    await page.reload();
    await page.getByRole("tab", { name: "Counts & assembly", exact: true }).click();
    await page.getByText("Count #2", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.getByText("countPost · Count #2", { exact: true }).waitFor();
    assert.equal((await snapshot()).counts[0].id, legacyId);

    // Exercise the same item help in a touch-sized dialog and check all controls.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "New item", exact: true }).click();
    await inspectHelp();
    await page.getByRole("button", { name: "Add component" }).click();
    await page.getByLabel("Component product 1", { exact: true }).waitFor();
    await page.getByLabel("Quantity for component 1", { exact: true }).waitFor();
    await fs.mkdir("generated-artifacts/inventory-labels", { recursive: true });
    const dialog = page.getByRole("dialog");
    assert.equal(await dialog.evaluate(el => el.scrollWidth > el.clientWidth + 2), false);
    await page.screenshot({ path: "generated-artifacts/inventory-labels/mobile.jpg" });
    await page.getByRole("button", { name: "Add component" }).scrollIntoViewIfNeeded();
    assert.equal(await dialog.evaluate(el => el.scrollTop > 0), true);
    await page.screenshot({ path: "generated-artifacts/inventory-labels/mobile-bottom.jpg" });
    await page.setViewportSize({ width: 1280, height: 960 });
    await page.getByLabel("Product ID (SKU)", { exact: false }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/inventory-labels/desktop.jpg" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.deepEqual(errors, []);
    console.log("Inventory item create/edit/help accessibility, equipment returns, legacy/new count references, continuation/cancel/post/print and phone layout passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
