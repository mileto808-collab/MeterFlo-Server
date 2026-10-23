// Run in the owned project-workspace sandbox, never against customer data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({
    baseURL: require("./support/workspace-ui-base.cjs")(),
    viewport: { width: 844, height: 390 }, hasTouch: false,
  });
  const errors = [];
  const out = "generated-artifacts/inventory-short-desktop";
  await fs.mkdir(out, { recursive: true });
  try {
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, {
        data: { action, data, operationId: crypto.randomUUID() },
      });
      assert.equal(response.status(), 200, await response.text());
    };
    await command("vendor", { id: "short-vendor", name: "Short window supplier" });
    await command("item", { id: "short-item", sku: "SHORT", name: "Short window item", tracking: "regular" });
    for (let n = 0; n < 16; n++) {
      await command("warehouse", { id: `short-${n}`, code: `SHORT-${n}`, name: `Short window location ${n}`, type: "physical", address: "100 Test Way", active: true });
      await command("order", { id: `short-po-${n}`, type: "purchase", vendorId: "short-vendor",
        destinationId: `short-${n}`, lines: [{ itemId: "short-item", quantity: 2 }] });
      await command("release", { orderId: `short-po-${n}` });
      await command("receive", { orderId: `short-po-${n}`, lines: [{ itemId: "short-item", quantity: 2 }] });
    }
    const before = (await (await context.request.get(endpoint)).json()).state;
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await expect(page.getByTestId("inventory-workspace")).toBeVisible();
    // Record the original wrapping-header failure at the exact fine-pointer
    // viewport, then restore the live policy without remounting the workspace.
    const baseline = await page.getByTestId("inventory-workspace").evaluate(main => {
      const compact = main.dataset.compactDesktop;
      delete main.dataset.compactDesktop;
      const headerHeight = main.querySelector('[data-testid="inventory-sticky-header"]').getBoundingClientRect().height;
      main.dataset.compactDesktop = compact;
      return { headerHeight, availableWidth: main.clientWidth, availableHeight: main.clientHeight };
    });
    console.log("Original fine-pointer wrapping header:", baseline);
    assert.ok(baseline.headerHeight > 180);
    assert.equal(await page.evaluate(() => matchMedia("(pointer: fine)").matches), true);
    const menu = page.getByTestId("inventory-mobile-menu");
    const choose = async kind => {
      await expect.poll(async () => await menu.isVisible() || await page.getByRole("tab").count() > 0).toBe(true);
      if (await menu.isVisible()) {
        await menu.click();
        await page.getByTestId(`inventory-mobile-menu-item-${kind}`).click();
        await expect(page.getByRole("menu")).toBeHidden();
      } else {
        const names = { stock: "Stock & search", locations: "Locations", items: "Items", vendors: "Vendors",
          categories: "Categories", orders: "Orders", exceptions: "Shipment exceptions", counts: "Cycle counts",
          returns: "Removed Equipment", activity: "Activity", "stock-discrepancies": "Stock discrepancies" };
        await page.getByRole("tab", { name: names[kind], exact: true }).click();
      }
    };
    const bounds = async locator => {
      await expect(locator).toBeVisible();
      await expect.poll(async () => {
        const r = await locator.boundingBox();
        return r.y >= 0 && r.y + r.height <= await page.evaluate(() => innerHeight) + 1;
      }).toBe(true);
    };
    const resize = async size => {
      await page.setViewportSize(size);
      await expect.poll(() => page.getByTestId("inventory-workspace").evaluate(main => {
        const r = main.getBoundingClientRect();
        return main.dataset.compactDesktop === String(r.width < 900 || innerHeight - r.top < 520);
      })).toBe(true);
    };
    for (const sidebarOpen of [true, false]) {
      // Desktop sidebar is open by default; use its real control, not CSS overrides.
      if (!sidebarOpen) await page.getByTestId("button-sidebar-toggle").click();
      for (const size of [{ width: 844, height: 390 }, { width: 1024, height: 500 },
        { width: 768, height: 420 }, { width: 1280, height: 720 }, { width: 1440, height: 900 },
        // 800x450 CSS pixels also models a 1280x720 desktop at 160% zoom.
        { width: 800, height: 450 }]) {
        await resize(size);
        for (const kind of ["stock", "locations", "items", "categories", "vendors", "orders", "exceptions", "counts", "returns", "activity", "stock-discrepancies"]) {
          console.log(`Checking ${kind} ${size.width}x${size.height}, sidebar ${sidebarOpen}`);
          await choose(kind);
          const toggle = page.getByTestId(`inventory-mobile-tools-${kind}-toggle`);
          await expect(toggle).toBeVisible();
          const tools = page.getByTestId(`inventory-mobile-tools-${kind}`);
          // Exercise expanded and collapsed tools without remounting the section.
          for (const open of [true, false]) {
            if ((await toggle.getAttribute("aria-expanded") === "true") !== open) await toggle.click();
            await bounds(toggle);
            if (open) {
              await expect(tools).toBeVisible();
              const search = tools.getByRole("searchbox");
              if (sidebarOpen && size.width === 844 && await search.count()) {
                await search.fill("short");
                await toggle.click();
                await toggle.click();
                await expect(search).toHaveValue("short");
                await search.fill("");
              }
            }
            if (kind !== "stock-discrepancies") {
              const results = page.getByTestId(kind === "orders" ? "inventory-order-results" : `inventory-${kind}-results`);
              const pager = page.getByTestId(`inventory-${kind}-pagination`);
              if ((await results.boundingBox()).height <= 40) {
                console.log(await page.locator('[data-testid="inventory-sticky-header"], [data-testid$="-subheader"], [data-testid="inventory-workspace"], [data-testid="inventory-scroll-content"]').evaluateAll(nodes => nodes.map(n => ({ id: n.dataset.testid, rect: n.getBoundingClientRect().toJSON(), scrollHeight: n.scrollHeight }))));
                await page.screenshot({ path: `${out}/failure-${kind}.jpg` });
              }
              await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(40);
              await bounds(pager);
              if (["stock", "locations", "orders", "activity"].includes(kind)) {
                await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(0);
              }
            } else {
              await page.getByTestId("stock-discrepancy-empty").scrollIntoViewIfNeeded();
              await bounds(page.getByTestId("stock-discrepancy-empty"));
            }
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        }
        console.log(`PASS fine-pointer ${size.width}x${size.height}, sidebar ${sidebarOpen ? "open" : "closed"}: every section`);
      }
    }
    await resize({ width: 844, height: 390 });
    await page.getByTestId("button-sidebar-toggle").click();
    await expect.poll(() => page.getByTestId("inventory-workspace").evaluate(main => main.clientWidth)).toBeLessThan(600);
    await choose("locations");
    const results = page.getByTestId("inventory-locations-results");
    const toolsToggle = page.getByTestId("inventory-mobile-tools-locations-toggle");
    if (await toolsToggle.getAttribute("aria-expanded") === "false") await toolsToggle.click();
    await page.getByTestId("button-toggle-inventory-stats").click();
    await bounds(page.getByTestId("inventory-locations-pagination"));
    await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(40);
    await page.screenshot({ path: `${out}/locations-stats-and-tools.jpg` });
    await toolsToggle.click();
    const withStats = (await results.boundingBox()).height;
    await page.getByTestId("button-toggle-inventory-stats").click();
    await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(withStats);
    await resize({ width: 1280, height: 900 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeGreaterThan(2);
    const tallCapacity = Number(await results.getAttribute("data-page-size"));
    await resize({ width: 844, height: 390 });
    await expect.poll(async () => Number(await results.getAttribute("data-page-size"))).toBeLessThan(tallCapacity);
    await toolsToggle.click();
    await page.getByRole("button", { name: "Add location", exact: true }).click();
    const editor = page.getByTestId("inventory-page-editor");
    await editor.getByLabel("Name", { exact: true }).fill("Unsaved short-window location");
    // Ordinary desktop -> short sidebar-open desktop -> phone -> desktop.
    for (const size of [{ width: 1440, height: 900 }, { width: 844, height: 390 }, { width: 390, height: 720 }]) {
      await resize(size);
      await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unsaved short-window location");
      await bounds(page.getByTestId("inventory-editor-back"));
      await bounds(page.getByTestId("inventory-editor-save"));
    }
    await page.getByTestId("inventory-editor-back").click();
    await page.getByRole("dialog").getByRole("button", { name: "Stay", exact: true }).click();
    await expect(editor.getByLabel("Name", { exact: true })).toHaveValue("Unsaved short-window location");
    await page.getByTestId("inventory-editor-back").click();
    await page.getByRole("dialog").getByRole("button", { name: "Discard", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(editor).toBeHidden();
    await resize({ width: 844, height: 390 });
    // Model additional hosting chrome using its occupied document space,
    // rather than subtracting a guessed fixed app-header height.
    await page.addStyleTag({ content: "body { padding-top: 28px; }" });
    await page.evaluate(() => window.dispatchEvent(new Event("resize")));
    await bounds(page.getByTestId("inventory-locations-pagination"));
    await expect.poll(async () => (await results.boundingBox()).height).toBeGreaterThan(40);
    await page.screenshot({ path: `${out}/locations-short-desktop.jpg` });
    console.log("PASS statistics/tools capacity, unsaved editor resizing, zoom-equivalent viewport and hosting chrome");
    assert.deepEqual((await (await context.request.get(endpoint)).json()).state, before);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
