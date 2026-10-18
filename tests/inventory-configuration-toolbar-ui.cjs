const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");
const baseURL = require("./support/workspace-ui-base.cjs")();
async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const page = await context.newPage();
    const choose = async (kind, name) => {
      const menu = page.getByTestId("inventory-mobile-menu");
      if (await menu.isVisible()) { await menu.click(); await page.getByTestId(`inventory-mobile-menu-item-${kind}`).click(); }
      else await page.getByRole("tab", { name, exact: true }).click();
      const toggle = page.getByTestId(`inventory-mobile-tools-${kind}-toggle`);
      if (await toggle.isVisible() && await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
    };
    for (const viewport of [{ width: 1024, height: 544 }, { width: 780, height: 420 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      await expect(page.getByTestId("inventory-sticky-header")).toBeVisible();
      for (const [kind, name, actions] of [
        ["locations", "Locations", ["Add location", "Manage location types"]],
        ["returns", "Removed Equipment", ["Removal rules"]],
      ]) {
        await choose(kind, name);
        for (const action of actions) {
          const button = page.getByRole("button", { name: action, exact: true });
          await expect(button).toHaveCount(1);
          await expect(page.getByTestId(`inventory-${kind}-action-toolbar`).getByRole("button", { name: action, exact: true })).toBeVisible();
          await button.scrollIntoViewIfNeeded();
          await expect(button).toBeInViewport({ ratio: 1 });
        }
        assert.equal(await page.getByTestId(`inventory-${kind}-action-toolbar`).evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
        await page.screenshot({ path: `generated-artifacts/project-workspace/toolbar-${kind}-${viewport.width}.jpg` });
        if (viewport.width >= 768) {
          await page.getByTestId("button-sidebar-toggle").click();
          for (const action of actions) {
            const button = page.getByRole("button", { name: action, exact: true });
            await button.scrollIntoViewIfNeeded();
            await expect(button).toBeInViewport({ ratio: 1 });
          }
          await page.getByTestId("button-sidebar-toggle").click();
        }
      }
    }
    // Grant ordinary view access through the app's existing role-management API.
    const grants = ["projects.view", "nav.projects", "project.workOrders", "workOrders.view", "inventory.view"];
    assert.ok((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: { permissions: grants } })).ok());
    const member = await browser.newContext({ baseURL });
    assert.equal((await member.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const restricted = await member.newPage();
    await restricted.goto(`/projects/${fixture.projectId}/inventory`);
    await restricted.getByRole("tab", { name: "Locations", exact: true }).click();
    await expect(restricted.getByTestId("inventory-locations-subheader")).toBeVisible();
    await expect(restricted.getByRole("button", { name: "Add location", exact: true })).toHaveCount(0);
    await expect(restricted.getByRole("button", { name: "Manage location types", exact: true })).toHaveCount(0);
    await restricted.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    await expect(restricted.getByTestId("inventory-returns-subheader")).toBeVisible();
    await expect(restricted.getByRole("button", { name: "Removal rules", exact: true })).toHaveCount(0);
    console.log("Inventory configuration toolbar placement, wrapping and permissions passed");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
