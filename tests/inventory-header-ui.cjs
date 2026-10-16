// Uses only the disposable accounts/project created by inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    const response = await context.request.post("/api/auth/local/login", { data: fixture });
    assert.equal(response.status(), 200, "Disposable admin can sign in");
    // Populate enough real catalog rows to verify scrolling, without changing real projects.
    for (let i = 0; i < 18; i++) {
      const saved = await context.request.post(`/api/projects/${fixture.projectId}/inventory/commands`, {
        data: { operationId: crypto.randomUUID(), action: "item",
          data: { id: `header-item-${i}`, sku: `HEADER-${i}`, name: `Header test item ${i}`, tracking: "regular" } },
      });
      assert.equal(saved.status(), 200, await saved.text());
    }
    await fs.mkdir("generated-artifacts/inventory-header", { recursive: true });
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.setViewportSize(viewport);
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      const toggle = page.getByTestId("button-toggle-inventory-stats");
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", "Stats start collapsed");
      const stats = page.locator(`#${await toggle.getAttribute("aria-controls")}`);
      assert.equal(await stats.isVisible(), false);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-expanded"), "true");
      assert.equal(await stats.isVisible(), true);
      await page.getByRole("tab", { name: "Items & vendors", exact: true }).click();
      const menu = page.getByRole("tablist");
      const before = await menu.boundingBox();
      // Scroll the application's actual main scroll container, not an assumed window.
      const scrolled = await page.getByTestId("inventory-scroll-content").evaluate(element => {
        element.scrollTop = 650;
        return element.scrollTop;
      });
      assert.ok(scrolled > 100, "Content really scrolls");
      await page.waitForFunction(y => {
        const menu = document.querySelector('[role="tablist"]');
        return menu && menu.getBoundingClientRect().y <= y + 2;
      }, before.y);
      const after = await menu.boundingBox();
      assert.ok(Math.abs(after.y - before.y) <= 1, "Header stays fixed while the content scrolls");
      assert.ok(after.y >= 0 && after.y <= before.y + 2, "Menu remains in viewport");
      assert.ok(after.y + after.height < viewport.height, "Entire menu is visible");
      await toggle.click();
      assert.equal(await stats.isVisible(), false, "Stats can collapse while scrolled");
      for (const tab of await menu.getByRole("tab").all()) {
        const box = await tab.boundingBox();
        assert.ok(box.x >= 0 && box.x + box.width <= viewport.width + 1, "Every menu tab fits the viewport");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const build = page.getByTestId("inventory-sticky-header").getByRole("button", { name: "Build an order draft", exact: true });
      assert.equal(await build.count(), 1, "Order draft action lives in the persistent header");
      const buildBox = await build.boundingBox();
      assert.ok(buildBox.y >= 0 && buildBox.y + buildBox.height <= viewport.height, "Order draft action stays visible after scrolling");
      await page.screenshot({ path: `generated-artifacts/inventory-header/${viewport.width}-collapsed-scrolled.jpg` });
      await build.click();
      const dialog = page.getByTestId("inventory-order-dialog");
      await dialog.waitFor();
      assert.equal(await page.locator('[role="tab"][aria-selected="true"]').textContent(), "Orders", "Header shortcut opens Orders from another tab");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.equal(await page.getByRole("button", { name: "Build an order draft", exact: true }).count(), 1, "Orders content does not duplicate the header action");
      await page.reload();
      await toggle.waitFor();
      assert.equal(await toggle.getAttribute("aria-expanded"), "false", "Fresh visits start collapsed");
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("Inventory header: desktop/mobile collapsed default, stats toggle, scrolling, all tabs, and modal access passed.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
