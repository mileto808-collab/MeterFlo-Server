// Run only against the disposable inventory-ui-fixture.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-categories";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const post = (action, data) => context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Categories", exact: true }).click();
    const header = page.getByTestId("inventory-categories-subheader");
    const add = header.getByRole("button", { name: "Add category", exact: true });
    const create = async name => {
      await add.click();
      const dialog = page.getByRole("dialog", { name: "Add category", exact: true });
      await dialog.getByLabel("Category name", { exact: true }).fill(name);
      await dialog.getByRole("button", { name: "Save category", exact: true }).click();
      await expect(dialog).toBeHidden();
    };
    await create("Meters");
    await create("None"); // Not confused with the unselected empty value.
    await page.reload();
    await page.getByRole("tab", { name: "Categories", exact: true }).click();
    await expect(page.getByTestId("inventory-categories-results")).toContainText("Meters");
    const revision = (await state()).revision;
    await add.click();
    let dialog = page.getByRole("dialog", { name: "Add category", exact: true });
    await expect(dialog.getByRole("button", { name: "Save category", exact: true })).toBeDisabled();
    await dialog.getByLabel("Category name", { exact: true }).fill(" meters ");
    await dialog.getByRole("button", { name: "Save category", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("already exists");
    await expect(dialog.getByLabel("Category name", { exact: true })).toHaveValue(" meters ");
    assert.equal((await state()).revision, revision, "Failed creation does not mutate inventory");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    const csvDownload = page.waitForEvent("download");
    await header.getByRole("button", { name: "CSV", exact: true }).click();
    const download = await csvDownload;
    assert.ok(download.suggestedFilename().endsWith(".csv"));
    await download.saveAs(`${out}/categories.csv`);
    assert.ok((await fs.readFile(`${out}/categories.csv`, "utf8")).includes("Meters"));
    await page.screenshot({ path: `${out}/desktop.jpg` });
    const select = async value => {
      await page.getByRole("tab", { name: "Items", exact: true }).click();
      await page.getByTestId("inventory-items-subheader").getByRole("button", { name: "Add item", exact: true }).click();
      const itemDialog = page.getByRole("dialog", { name: "Item details", exact: true });
      await expect(itemDialog.getByLabel("Category", { exact: true })).toHaveValue("");
      await expect(itemDialog.locator('#item-category option[value="None"]')).toHaveText("None (category)");
      await itemDialog.getByLabel(/^Product ID \(SKU\)/).fill(`CAT-${value || "EMPTY"}`);
      await itemDialog.getByLabel(/^Product Label \(Name\)/).fill(`Category item ${value || "none"}`);
      await itemDialog.getByLabel("Category", { exact: true }).selectOption({ value });
      await itemDialog.getByRole("button", { name: "Save changes", exact: true }).click();
      await expect(itemDialog).toBeHidden();
      return (await state()).items.find(item => item.sku === `CAT-${value || "EMPTY"}`);
    };
    const meter = await select("Meters");
    assert.equal(meter.category, "Meters");
    const none = await select("");
    assert.equal(none.category, "");
    const namedNone = await select("None");
    assert.equal(namedNone.category, "None");
    const invalid = await post("item", { ...meter, category: "Unknown category" });
    assert.equal(invalid.status(), 409);
    await page.getByRole("tab", { name: "Categories", exact: true }).click();
    await page.getByRole("button", { name: "Edit category Meters", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Edit category", exact: true });
    await expect(dialog.getByLabel("Category name", { exact: true })).toHaveValue("Meters");
    await dialog.getByLabel("Category name", { exact: true }).fill("None");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("already exists");
    await expect(dialog.getByLabel("Category name", { exact: true })).toHaveValue("None");
    assert.equal((await state()).items.find(item => item.id === meter.id).category, "Meters");
    await dialog.getByLabel("Category name", { exact: true }).fill("Electric meters");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Edit category Electric meters", exact: true })).toBeVisible();
    assert.equal((await state()).items.find(item => item.id === meter.id).category, "Electric meters");
    await page.screenshot({ path: `${out}/desktop-edit.jpg` });
    await page.reload();
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    const card = page.locator("article").filter({ has: page.getByRole("heading", { name: "Category item Meters", exact: true }) });
    await card.getByRole("button", { name: /Edit/ }).click();
    dialog = page.getByRole("dialog", { name: "Item details", exact: true });
    await expect(dialog.getByLabel("Category", { exact: true })).toHaveValue("Electric meters");
    await dialog.getByLabel("Category", { exact: true }).selectOption("");
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(dialog).toBeHidden();
    assert.equal((await state()).items.find(item => item.id === meter.id).category, "");
    await page.getByRole("tab", { name: "Categories", exact: true }).click();
    await expect(page.getByTestId("inventory-categories-results")).toContainText("Electric meters");
    // Grant through normal role management, not direct permission-table inserts.
    const grant = await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["workOrders.view", "projects.view", "inventory.view", "inventory.maintain"] },
    });
    assert.equal(grant.status(), 200);
    const allowed = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await allowed.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const permitted = await allowed.request.post(`${endpoint}/commands`, {
      data: { action: "category", operationId: crypto.randomUUID(), data: { name: "Maintainer category" } },
    });
    assert.equal(permitted.status(), 200, await permitted.text());
    await allowed.close();
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["workOrders.view", "projects.view", "inventory.view"] },
    })).status(), 200);
    const readonly = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await readonly.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const denied = await readonly.request.post(`${endpoint}/commands`, {
      data: { action: "category", operationId: crypto.randomUUID(), data: { name: "Forbidden" } },
    });
    assert.equal(denied.status(), 403);
    const deniedRename = await readonly.request.post(`${endpoint}/commands`, {
      data: { action: "categoryRename", operationId: crypto.randomUUID(), data: { name: "Electric meters", newName: "Forbidden rename" } },
    });
    assert.equal(deniedRename.status(), 403);
    const reader = await readonly.newPage();
    await reader.goto(`/projects/${fixture.projectId}/inventory`);
    await reader.getByRole("tab", { name: "Categories", exact: true }).click();
    await expect(reader.getByRole("button", { name: "Add category", exact: true })).toHaveCount(0);
    await expect(reader.getByRole("button", { name: /^Edit category / })).toHaveCount(0);
    await expect(reader.getByTestId("inventory-categories-results")).toContainText("Maintainer category");
    await readonly.close();
    // The same page supports compact menu navigation on portrait and rotated phones.
    const phoneContext = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 390, height: 720 }, isMobile: true, hasTouch: true });
    assert.equal((await phoneContext.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const phone = await phoneContext.newPage();
    await phone.goto(`/projects/${fixture.projectId}/inventory`);
    await phone.getByTestId("inventory-mobile-menu").click();
    await phone.getByTestId("inventory-mobile-menu-item-categories").click();
    const toggle = phone.getByTestId("inventory-mobile-tools-categories-toggle");
    await expect(phone.getByTestId("inventory-categories-subheader").getByRole("button", { name: "Add category", exact: true })).toBeHidden();
    await toggle.click();
    await expect(phone.getByTestId("inventory-categories-subheader").getByRole("button", { name: "Add category", exact: true })).toBeVisible();
    await toggle.click();
    await phone.getByRole("button", { name: "Edit category Electric meters", exact: true }).click();
    await expect(phone.getByRole("dialog", { name: "Edit category", exact: true })).toBeVisible();
    await phone.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(phone.getByRole("dialog")).toBeHidden();
    for (const size of [{ width: 390, height: 720 }, { width: 844, height: 390 }]) {
      await phone.setViewportSize(size);
      await expect(phone.getByTestId("inventory-mobile-menu")).toBeVisible();
      const bounds = await phone.getByTestId("inventory-categories-pagination").boundingBox();
      assert.ok(bounds.y + bounds.height <= size.height + 1);
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await phone.screenshot({ path: `${out}/phone-${size.width}.jpg` });
    }
    await phoneContext.close();
    assert.deepEqual(errors, []);
    assert.deepEqual((await state()).stock, []);
    console.log("PASS: create/edit categories, atomic item rename, duplicate retention, dropdown/None, clear/reopen, scoped permissions, CSV, portrait and landscape.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
