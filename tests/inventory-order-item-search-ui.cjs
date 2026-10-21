const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Use the owned database sandbox.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const mobile of [false, true]) {
      const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
        viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 },
        isMobile: mobile, hasTouch: mobile });
      assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
      if (!mobile) {
        const categoryId = crypto.randomUUID();
        const category = await context.request.post(`/api/projects/${fixture.projectId}/inventory/commands`,
          { data: { operationId: categoryId, action: "category", data: { name: "Residential" } } });
        assert.equal(category.status(), 200, await category.text());
        for (const data of [
          { id: "search-meter", sku: "SKU-METER", name: "Utility meter", description: "Copper outdoor assembly", barcode: "99887766", manufacturer: "SearchMaker", model: "TestModel", categoryId },
          { id: "search-seal", sku: "SKU-SEAL", name: "Safety seal", description: "Blue security band" },
          { id: "search-inactive", sku: "INACTIVE", name: "Retired item", active: false },
          { id: "search-labor", sku: "LABOR", name: "Installation labor", kind: "labor" },
        ]) {
          const result = await context.request.post(`/api/projects/${fixture.projectId}/inventory/commands`,
            { data: { operationId: crypto.randomUUID(), action: "item", data: { tracking: "regular", ...data } } });
          assert.equal(result.status(), 200, await result.text());
        }
      }
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      const orders = page.getByRole("tab", { name: "Orders", exact: true });
      if (mobile) {
        await page.getByTestId("inventory-mobile-menu").click();
        await page.getByRole("menuitem", { name: "Orders", exact: true }).click();
        const tools = page.getByRole("button", { name: /^(Show|Hide) Search & Tools$/ });
        if (await tools.getAttribute("aria-expanded") === "false") await tools.click();
      } else await orders.click();
      await page.getByRole("button", { name: "Build an order draft", exact: true }).click();
      const picker = page.locator("#draft-line-item");
      await picker.click();
      const search = page.getByRole("combobox", { name: "Search order items", exact: true });
      await expect(page.getByRole("option")).toHaveCount(2);
      for (const query of ["sku-meter", "COPPER", "99887766", "SearchMaker", "TestModel", "Residential", "copper meter"]) {
        await search.fill(query);
        await expect(page.getByRole("option")).toHaveCount(1);
        await expect(page.getByRole("option")).toContainText("SKU-METER");
      }
      await search.fill("no-such-product");
      await expect(page.getByText("No matching items.", { exact: true })).toBeVisible();
      await expect(page.getByRole("option")).toHaveCount(0);
      await search.fill("");
      await expect(page.getByRole("option")).toHaveCount(2);
      await search.fill("outdoor");
      await page.screenshot({ path: `/tmp/meterflo-order-item-search-${mobile ? "phone" : "desktop"}.png` });
      await search.press("ArrowDown");
      await search.press("Enter");
      await expect(picker).toContainText("SKU-METER");
      await expect(search).toHaveCount(0);
      await page.locator("#draft-line-quantity").fill("3");
      await page.getByRole("button", { name: "Add line", exact: true }).click();
      await expect(page.locator("#draft-line-quantity-0")).toHaveValue("3");
      await picker.click();
      await expect(search).toHaveValue("");
      await expect(page.getByRole("option")).toHaveCount(2);
      await search.fill("blue");
      await page.getByRole("option").click();
      await expect(picker).toContainText("SKU-SEAL");
      await expect(search).toHaveCount(0);
      await expect(page.locator("#draft-line-quantity-0")).toHaveValue("3");
      await picker.click();
      await search.fill("copper");
      await search.press("Escape");
      await expect(picker).toBeFocused();
      await picker.click();
      await expect(search).toHaveValue("");
      const bounds = await page.locator("[data-radix-popper-content-wrapper]").boundingBox();
      assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= page.viewportSize().width + 1, "Dropdown fits viewport");
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log("PASS: Desktop and phone order item search; blank list, SKU/name/description/barcode/category/manufacturer/model, case-insensitive mixed terms, no results, keyboard selection, selection labels, preserved quantities, reset on close and viewport fit.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
