// Use only the disposable tests/support/inventory-ui-fixture.ts project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1440, height: 1000 }, hasTouch: true,
    });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const base = `/api/projects/${fixture.projectId}/inventory`;
    const { projectName } = await (await context.request.get(`${base}/stock/context`)).json();
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const snapshotRequests = [];
    page.on("request", request => {
      if (request.method() === "GET" && new URL(request.url()).pathname === base) snapshotRequests.push(request.url());
    });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const header = page.getByTestId("button-sidebar-toggle").locator("xpath=ancestor::header");
    await expect(header.getByText(projectName, { exact: true })).toBeVisible();
    await expect(header.getByText("Inventory", { exact: true })).toBeVisible();
    assert.equal(snapshotRequests.length, 0, "project header preserves lazy Stock loading");
    const tabs = ["Locations", "Items", "Categories", "Vendors", "Orders", "Shipment exceptions", "Cycle counts", "Removed Equipment", "Activity", "Stock & search"];
    for (const name of tabs) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(header.getByText(projectName, { exact: true })).toBeVisible();
      await expect(header.getByText("Inventory", { exact: true })).toBeVisible();
    }
    await page.setViewportSize({ width: 402, height: 874 });
    await page.getByTestId("inventory-mobile-menu").click();
    await page.getByRole("menuitem", { name: "Cycle counts", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inventory-mobile-menu")).toContainText("Cycle counts");
    await expect(header.getByText(projectName, { exact: true })).toBeVisible();
    await expect(header.getByText("Inventory", { exact: true })).toBeVisible();
    for (const [name, viewport] of [
      ["phone", { width: 402, height: 874 }],
      ["landscape", { width: 874, height: 402 }],
      ["desktop", { width: 1440, height: 1000 }],
    ]) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(250);
      const size = await header.evaluate(element => ({ width: element.clientWidth, content: element.scrollWidth }));
      assert.ok(size.content <= size.width + 1, `${name}: header must not overflow`);
      await fs.mkdir("generated-artifacts/inventory-project-header", { recursive: true });
      await page.screenshot({ path: `generated-artifacts/inventory-project-header/${name}.png` });
    }
    await page.setViewportSize({ width: 402, height: 874 });
    // Invalid or removed tabs fall back safely rather than rendering a blank panel.
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith("meterflo:inventory-tab:")) sessionStorage.setItem(key, "not-a-tab");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inventory-mobile-menu")).toContainText("Stock & search");
    await page.goto("/projects");
    await expect(header.getByText(projectName, { exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log("PASS: all tabs and mobile retain selection/project header; header fits portrait/landscape/desktop and clears on exit; Stock stays lazy.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
