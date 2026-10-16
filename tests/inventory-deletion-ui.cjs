// Uses only the disposable inventory-ui-fixture project; never real catalog data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] });
  const directory = "generated-artifacts/inventory-relational-delete";
  await fs.mkdir(directory, { recursive: true });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data) => {
      const result = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(result.status(), 200, action);
    };
    const linked = crypto.randomUUID(), unused = crypto.randomUUID();
    const warehouse = crypto.randomUUID(), vendor = crypto.randomUUID();
    await command("category", { name: "AAB deletion assigned" });
    await command("category", { name: "AAA deletion empty" });
    const categories = (await state()).categoryCatalog;
    const assignedCategory = categories.find(category => category.name === "AAB deletion assigned").id;
    const emptyCategory = categories.find(category => category.name === "AAA deletion empty").id;
    await command("warehouse", { id: warehouse, code: "DEL-TEST", name: "Deletion fixture", type: "physical", address: "Fixture" });
    await command("vendor", { id: vendor, name: "Deletion fixture vendor" });
    await command("item", { id: linked, sku: "DEL-LINKED", name: "AAA deletion linked", tracking: "regular", categoryId: assignedCategory });
    await command("item", { id: unused, sku: "DEL-UNUSED", name: "AAB deletion unused", tracking: "regular" });
    await command("order", { id: crypto.randomUUID(), type: "purchase", vendorId: vendor, destinationId: warehouse, lines: [{ itemId: linked, quantity: 1, serials: [] }] });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const tab = async (target, label) => {
      const menu = target.getByTestId("inventory-mobile-menu");
      await menu.waitFor({ state: "attached" });
      if (await menu.isVisible()) {
        await menu.click();
        await target.getByRole("menuitem", { name: label, exact: true }).click();
      } else await target.getByRole("tab", { name: label, exact: true }).click();
    };
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await tab(page, "Items");
    await page.getByRole("button", { name: "Delete item AAB deletion unused", exact: true }).click();
    await page.getByTestId("item-delete-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    assert.ok((await state()).items.some(item => item.id === unused));

    const attempts = [];
    await page.route(`**${endpoint}/commands`, async route => {
      const body = route.request().postDataJSON();
      if (body.action === "itemDelete" && body.data.id === unused) {
        attempts.push(body.operationId);
        if (attempts.length === 1) return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture temporary rejection" }) });
      }
      await route.continue();
    });
    await page.getByRole("button", { name: "Delete item AAB deletion unused", exact: true }).click();
    await page.getByTestId("item-delete-confirm").click();
    await expect(page.getByTestId("item-delete-dialog").getByRole("alert")).toContainText("Fixture temporary rejection");
    assert.ok((await state()).items.some(item => item.id === unused));
    await page.getByTestId("item-delete-confirm").click();
    await expect(page.getByTestId("item-delete-dialog")).toBeHidden();
    assert.equal(attempts.length, 2);
    assert.equal(attempts[0], attempts[1], "unknown-outcome retry preserves identity");
    assert.equal((await state()).items.some(item => item.id === unused), false);

    await page.getByRole("button", { name: "Delete item AAA deletion linked", exact: true }).click();
    await expect(page.getByTestId("item-delete-confirm")).toBeDisabled();
    await expect(page.getByTestId("item-delete-dialog")).toContainText("Linked to an order");
    await page.screenshot({ path: `${directory}/desktop-blocked.png` });
    await page.getByTestId("item-delete-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await tab(page, "Categories");
    await page.getByRole("button", { name: "Delete category AAB deletion assigned", exact: true }).click();
    await expect(page.getByTestId("category-delete-confirm")).toBeDisabled();
    await expect(page.getByTestId("category-delete-dialog")).toContainText("Assigned to 1 item");
    await page.getByTestId("category-delete-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Delete category AAA deletion empty", exact: true }).click();
    await page.getByTestId("category-delete-confirm").click();
    await expect(page.getByTestId("category-delete-dialog")).toBeHidden();
    assert.equal((await state()).categoryCatalog.some(category => category.id === emptyCategory), false);

    const mobile = await browser.newContext({ baseURL, isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      const id = crypto.randomUUID(), name = `000 phone unused ${size.width}`;
      await command("item", { id, sku: `PHONE-${size.width}`, name, tracking: "regular" });
      await phone.setViewportSize(size);
      await phone.goto(`/projects/${fixture.projectId}/inventory`);
      await tab(phone, "Items");
      const trigger = phone.getByRole("button", { name: `Delete item ${name}`, exact: true });
      await expect(trigger).toBeVisible();
      assert.ok((await trigger.boundingBox()).width >= 44);
      await trigger.click();
      const dialog = phone.getByTestId("item-delete-dialog");
      await expect(dialog).toBeVisible();
      await expect.poll(async () => {
        const bounds = await dialog.boundingBox();
        return bounds.x >= -1 && bounds.y >= -1 && bounds.x + bounds.width <= size.width + 1 && bounds.y + bounds.height <= size.height + 1;
      }, { message: `Dialog fits ${size.width}×${size.height} after opening animation` }).toBe(true);
      await phone.screenshot({ path: `${directory}/phone-${size.width}.png` });
      await phone.getByTestId("item-delete-confirm").click();
      await expect(dialog).toBeHidden();
      assert.equal((await state()).items.some(item => item.id === id), false);
      assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    }
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["workOrders.view", "projects.view", "inventory.view"] },
    })).status(), 200, "grant view through normal role management");
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: { username: fixture.viewer.username, password: fixture.viewer.password } })).status(), 200);
    for (const action of ["itemDelete", "categoryDelete"])
      assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { action, operationId: crypto.randomUUID(), data: { id: linked } } })).status(), 403);
    const readOnly = await viewer.newPage();
    await readOnly.goto(`/projects/${fixture.projectId}/inventory`);
    await tab(readOnly, "Items");
    await expect(readOnly.getByTestId("item-delete-trigger")).toHaveCount(0);
    await tab(readOnly, "Categories");
    await expect(readOnly.getByTestId("category-delete-trigger")).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log("Catalog deletion verified: confirmation, blockers, failure/retry identity, role restrictions, portrait and landscape.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
