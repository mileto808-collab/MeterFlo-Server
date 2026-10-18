// Uses only the disposable inventory-ui-fixture --operations project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 390, height: 720 }, isMobile: true, hasTouch: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const before = await (await context.request.get(endpoint)).json();
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const out = "generated-artifacts/inventory-phone";
    await fs.mkdir(out, { recursive: true });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await expect(page.getByTestId("inventory-mobile-menu")).toBeVisible();
    await expect(page.getByTestId("inventory-stats-region")).toBeHidden();
    const kinds = ["stock", "locations", "items", "vendors", "orders", "exceptions", "counts", "returns", "activity"];
    for (const kind of kinds) {
      await page.getByTestId("inventory-mobile-menu").click();
      await page.getByTestId(`inventory-mobile-menu-item-${kind}`).click();
      const toggle = page.getByTestId(`inventory-mobile-tools-${kind}-toggle`);
      const tools = page.getByTestId(`inventory-mobile-tools-${kind}`);
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await expect(tools).toBeHidden();
      assert.equal(await page.getByRole("tab").count(), 0, "Phone has menu, not wrapped tabs");
      for (const size of [{ width: 390, height: 720 }, { width: 360, height: 640 }, { width: 430, height: 820 }]) {
        console.log(`Checking ${kind} at ${size.width}x${size.height}`);
        await page.setViewportSize(size);
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const header = await page.getByTestId("inventory-sticky-header").boundingBox();
        assert.ok(header.height <= 100, `${kind}: compact global header`);
        if (kind !== "counts") {
          const results = page.getByTestId(kind === "orders" ? "inventory-order-results" : `inventory-${kind}-results`);
          const pager = page.getByTestId(`inventory-${kind}-pagination`);
          await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(size.height * 0.45);
          await expect.poll(async () => { const box = await pager.boundingBox(); return box.y + box.height; }).toBeLessThanOrEqual(size.height);
          if (["locations", "activity"].includes(kind)) {
            await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(1);
          }
        }
      }
      await page.setViewportSize({ width: 390, height: 720 });
      if (kind === "orders" || kind === "locations") {
        const actionName = kind === "orders" ? "Build an order draft" : "Add location";
        const create = page.getByTestId(`inventory-${kind}-subheader`).getByRole("button", { name: actionName, exact: true });
        await expect(create).toBeHidden();
        await toggle.click();
        await expect(create).toBeVisible();
        assert.equal(await tools.getByRole("button").first().getAttribute("aria-label"), actionName, "Create action precedes Refresh like Items and Vendors");
        assert.equal((await create.innerText()).trim(), "", "Phone create action is icon-only");
        const box = await create.boundingBox();
        assert.ok(box.width >= 36 && box.height >= 36, "Create action matches catalog icon sizing");
        await create.click();
        await expect(page.getByTestId("inventory-page-editor")).toBeVisible();
        await page.getByTestId("inventory-editor-back").click();
        await expect(page.getByTestId("inventory-page-editor")).toBeHidden();
        await page.setViewportSize({ width: 844, height: 390 });
        await expect(create).toBeVisible();
        await create.click();
        await expect(page.getByTestId("inventory-page-editor")).toBeVisible();
        await page.getByTestId("inventory-editor-back").click();
        await expect(page.getByTestId("inventory-page-editor")).toBeHidden();
        await page.screenshot({ path: `${out}/${kind}-landscape-create-action.jpg` });
        await page.setViewportSize({ width: 390, height: 720 });
        await page.screenshot({ path: `${out}/${kind}-create-action.jpg` });
        await toggle.click();
      }
      await page.screenshot({ path: `${out}/${kind}.jpg` });
      await toggle.click();
      await expect(tools).toBeVisible();
      const search = tools.getByRole("searchbox");
      if (await search.count()) {
        await search.fill("NO-MATCH-PHONE");
        await toggle.click();
        await expect(tools).toBeHidden();
        await toggle.click();
        await expect(search).toHaveValue("NO-MATCH-PHONE");
        await search.fill("");
      }
      if (kind !== "counts") {
        await expect(tools.getByRole("button", { name: "CSV", exact: true })).toBeVisible();
        await expect(tools.getByRole("button", { name: "Excel", exact: true })).toBeVisible();
        await expect(tools.getByRole("button", { name: "PDF / Print", exact: true })).toBeVisible();
      }
      if (kind === "orders") {
        await tools.getByRole("button", { name: /Saved shipment drafts/ }).click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.keyboard.press("Escape");
      }
      await toggle.click();
    }
    await page.getByTestId("inventory-mobile-menu").click();
    await page.getByTestId("inventory-mobile-menu-item-orders").click();
    const orderTools = page.getByTestId("inventory-mobile-tools-orders-toggle");
    if (await orderTools.getAttribute("aria-expanded") === "false") await orderTools.click();
    await page.getByRole("button", { name: "Build an order draft", exact: true }).click();
    await expect(page.getByTestId("inventory-page-editor")).toBeVisible();
    await page.getByTestId("inventory-editor-back").click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    const desktopCreate = page.getByTestId("inventory-orders-subheader").getByRole("button", { name: "Build an order draft", exact: true });
    await expect(desktopCreate).toHaveText("Build an order draft");
    await desktopCreate.click();
    await expect(page.getByTestId("inventory-page-editor")).toBeVisible();
    await page.getByTestId("inventory-editor-back").click();
    await expect(page.getByTestId("inventory-page-editor")).toBeHidden();
    await expect(page.getByRole("tab", { name: "Locations", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Locations", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "Search locations", exact: true })).toBeVisible();
    await expect(page.getByTestId("inventory-mobile-menu")).toBeHidden();
    assert.deepEqual((await (await context.request.get(endpoint)).json()).state, before.state, "Read-only phone browsing must not alter inventory");
    assert.deepEqual(errors, []);
    console.log("PASS: all nine mobile tabs, compact headers, collapsed/preserved tools, 360/390/430px layouts, usable records, adaptive pagination, drafts and desktop navigation.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
