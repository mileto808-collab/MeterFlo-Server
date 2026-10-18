// Uses only the disposable project from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const size of (process.env.INVENTORY_EDITOR_SIZES || "desktop,phone,landscape").split(",")) {
      const viewport = size === "desktop" ? { width: 1280, height: 900 }
        : size === "phone" ? { width: 390, height: 844 } : { width: 844, height: 390 };
      const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
        viewport, isMobile: size !== "desktop", hasTouch: size !== "desktop" });
      const login = await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } });
      assert.equal(login.status(), 200);
      const endpoint = `/api/projects/${fixture.projectId}/inventory`;
      const command = async (action, data) => {
        const result = await context.request.post(`${endpoint}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
        assert.equal(result.status(), 200, await result.text());
      };
      await command("vendor", { id: `page-vendor-${size}`, name: `Page supplier ${size}` });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      const editor = page.getByTestId("inventory-page-editor");
      const save = page.getByTestId("inventory-editor-save");
      const back = page.getByTestId("inventory-editor-back");
      const tab = async name => {
        // Radix restores the page accessibility tree after its close animation.
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const desktop = page.getByRole("tab", { name, exact: true });
        if (await desktop.isVisible()) await desktop.click();
        else {
          await page.getByTestId("inventory-mobile-menu").click();
          await page.getByRole("menuitem", { name, exact: true }).click();
        }
      };
      const tools = async () => {
        if (size === "desktop") return;
        const button = page.getByRole("button", { name: /^(Show|Hide) Search & Tools$/ });
        await expect(button).toBeVisible();
        if (await button.getAttribute("aria-expanded") === "false") await button.click();
      };
      const checkEditor = async title => {
        await expect(editor.getByRole("heading", { name: title, exact: true })).toBeVisible();
        await expect(page.getByRole("dialog")).toHaveCount(0);
        assert.equal(await page.locator("[data-testid=inventory-sticky-header]").getByRole("button").count(), 0,
          "covered workspace must not expose list actions");
        assert.equal(await back.evaluate(el => document.activeElement === el), true, "opening must not focus an input or summon keyboard");
        await expect(save).toBeVisible();
        const bounds = await editor.boundingBox();
        assert.ok(bounds.x >= -1 && bounds.x + bounds.width <= viewport.width + 1);
        assert.ok(bounds.height > viewport.height * 0.6);
        assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      };
      const saved = async () => {
        const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().method() === "POST");
        await save.click();
        assert.equal((await response).status(), 200);
        await expect(editor).toHaveCount(0);
      };
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      // The shared top header keeps stats/navigation, never creation shortcuts.
      const header = page.getByTestId("inventory-sticky-header");
      await expect(header).toBeVisible();
      await expect(header.getByRole("button", { name: /Add location|Add new item|Build an order draft/ })).toHaveCount(0);
      await tab("Locations");
      await tools();
      await page.getByRole("button", { name: "Add location", exact: true }).click();
      await checkEditor("Add location");
      await editor.getByLabel("Name", { exact: true }).fill(`Page warehouse ${size}`);
      await editor.getByRole("textbox", { name: "Street address", exact: true }).fill("Disposable fixture only");
      await save.click();
      await expect(editor.getByRole("alert")).toContainText("Code");
      await editor.getByRole("textbox", { name: "Code", exact: true }).fill(`PAGE-${size}`);
      await back.click();
      const warning = page.getByRole("dialog", { name: "Unsaved inventory details", exact: true });
      await expect(warning).toBeVisible();
      await warning.getByRole("button", { name: "Stay", exact: true }).click();
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue(`Page warehouse ${size}`);
      await page.screenshot({ path: `generated-artifacts/inventory-location-${size}.jpg` });
      await saved();
      await expect(page.getByRole("heading", { name: "Warehouses & vehicles", exact: true })).toBeVisible();

      await tab("Items");
      await tools();
      await page.getByRole("button", { name: "Add item", exact: true }).click();
      await checkEditor("Add item");
      await editor.getByLabel(/^Product Label \(Name\)/).fill(`Page item ${size}`);
      await editor.getByLabel(/^Product ID \(SKU\)/).fill(`PAGE-${size}`);
      await page.screenshot({ path: `generated-artifacts/inventory-item-${size}.jpg` });
      // Long phone forms must scroll independently while keeping Back/Save visible.
      await editor.evaluate(el => {
        const scroller = el.querySelector("header").nextElementSibling;
        scroller.scrollTop = scroller.scrollHeight;
      });
      await expect(back).toBeVisible();
      await expect(save).toBeVisible();
      await saved();
      await page.getByRole("searchbox", { name: "Search items", exact: true }).fill(`Page item ${size}`);
      const itemRow = page.locator("article").filter({ hasText: `Page item ${size}` });
      await itemRow.getByRole("button", { name: "Edit", exact: true }).click();
      await checkEditor("Edit item");
      await editor.getByLabel(/^Product Label \(Name\)/).fill(`Discarded item ${size}`);
      await back.click();
      await warning.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(editor).toHaveCount(0);
      await expect(itemRow).toContainText(`Page item ${size}`);

      await tab("Orders");
      await tools();
      await page.getByRole("button", { name: "Build an order draft", exact: true }).click();
      await checkEditor("Build an order draft");
      const pick = async (index, text) => {
        await editor.getByRole("combobox").nth(index).click();
        await page.getByRole("option", { name: text, exact: true }).click();
      };
      await pick(1, `PAGE-${size} · Page warehouse ${size}`);
      await pick(2, `Page supplier ${size}`);
      await pick(3, `PAGE-${size} · Page item ${size}`);
      await editor.getByRole("button", { name: "Add line", exact: true }).click();
      await editor.getByLabel("Order notes", { exact: true }).fill(`Page draft ${size}`);
      await page.screenshot({ path: `generated-artifacts/inventory-order-${size}.jpg` });
      await back.click();
      const orderWarning = page.getByRole("dialog", { name: "Unsaved order changes", exact: true });
      await expect(orderWarning).toBeVisible();
      await orderWarning.getByRole("button", { name: "Stay", exact: true }).click();
      await expect(editor.getByLabel("Order notes", { exact: true })).toHaveValue(`Page draft ${size}`);
      await saved();
      const snapshot = await (await context.request.get(endpoint)).json();
      assert.ok(snapshot.state.orders.some(o => o.notes === `Page draft ${size}` && o.status === "draft"));
      assert.equal(snapshot.state.stock.length, 0, "saving catalog and draft forms must not move stock");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS: ${size}: full-page location/item/order forms, validation, guarded Back, saves, sticky actions and no modal/keyboard autofocus.`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
