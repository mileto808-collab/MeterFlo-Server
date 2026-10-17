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
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const tabs = ["Locations", "Items", "Categories", "Vendors", "Orders", "Shipment exceptions", "Cycle counts", "Removed Equipment", "Activity", "Stock & search"];
    for (const name of tabs) {
      await page.getByRole("tab", { name, exact: true }).click();
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    }
    await page.setViewportSize({ width: 402, height: 874 });
    await page.getByTestId("inventory-mobile-menu").click();
    await page.getByRole("menuitem", { name: "Cycle counts", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inventory-mobile-menu")).toContainText("Cycle counts");
    // Invalid or removed tabs fall back safely rather than rendering a blank panel.
    await page.evaluate(() => {
      for (const key of Object.keys(sessionStorage))
        if (key.startsWith("meterflo:inventory-tab:")) sessionStorage.setItem(key, "not-a-tab");
    });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("inventory-mobile-menu")).toContainText("Stock & search");
    assert.deepEqual(errors, []);
    console.log("PASS: all 10 tabs survive refresh; mobile selection survives refresh; invalid saved tab defaults safely.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
