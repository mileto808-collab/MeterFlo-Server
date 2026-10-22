const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL }), tech = await browser.newContext({ baseURL });
  const url = `/api/projects/${fixture.projectId}/inventory`;
  const request = async (context, method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  try {
    await request(admin, "POST", "/api/auth/local/login", fixture);
    const field = ["inventory.view", "inventory.assign", "workOrders.view", "nav.projects"];
    const warehouse = [...field, "inventory.receive", "inventory.transfer", "inventory.purchase",
      "inventory.count", "inventory.maintain", "inventory.resolveExceptions", "inventory.resolveReturns"];
    const role = await request(admin, "POST", "/api/subroles", { key: `inv_visibility_${crypto.randomUUID().slice(0, 8)}`,
      label: "Inventory visibility test", baseRole: "user", permissions: field });
    const credentials = { username: `visibility-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    await request(admin, "POST", "/api/users", { ...credentials, firstName: "Inventory", lastName: "Tech",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request(tech, "POST", "/api/auth/local/login", credentials);
    const page = await tech.newPage();
    const noWarehouse = async () => {
      await expect(page.getByRole("tab", { name: "Stock & search", exact: true })).toBeVisible();
      for (const name of ["Locations", "Items", "Categories", "Vendors", "Orders", "Shipment exceptions",
        "Cycle counts", "Removed Equipment", "Activity", "Stock discrepancies"])
        await expect(page.getByRole("tab", { name, exact: true })).toHaveCount(0);
      await expect(page.locator('[data-testid^="button-start-inventory-"]')).toHaveCount(0);
      await expect(page.getByRole("button", { name: /Show Stats|Hide Stats/ })).toHaveCount(0);
    };
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    await noWarehouse();
    assert.equal((await tech.request.get(`${url}/stock/context`)).status(), 200);
    for (const endpoint of ["/fulfillment", "/fulfillment/00000000-0000-4000-8000-000000000000/pick-ticket",
      "/print/fulfillment/00000000-0000-4000-8000-000000000000"]) {
      assert.equal((await tech.request.get(url + endpoint)).status(), 403, endpoint);
    }
    const denied = await tech.request.post(`${url}/commands`, { data: { operationId: crypto.randomUUID(),
      action: "vendor", data: { id: crypto.randomUUID(), name: "Unauthorized vendor", active: true } } });
    assert.equal(denied.status(), 403);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("inventory-mobile-menu").click();
    const menu = page.getByRole("menu");
    await expect(menu.getByRole("menuitem", { name: "Stock & search", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await fs.mkdir("generated-artifacts/inventory-permission-visibility", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-permission-visibility/field-phone.png" });
    await request(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: warehouse });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.reload();
    await expect(page.getByRole("tab", { name: "Orders", exact: true })).toBeVisible();
    await expect(page.getByTestId("button-start-inventory-desktop")).toBeVisible();
    await page.getByTestId("button-start-inventory-desktop").click();
    await expect(page.getByTestId("inventory-task-fulfillment")).toBeVisible();
    await page.getByRole("button", { name: "Back to Inventory", exact: true }).click();
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    await request(admin, "PUT", `/api/subroles/${role.id}/permissions`, { permissions: field });
    await page.getByRole("button", { name: "Refresh orders", exact: true }).click();
    await noWarehouse();
    await page.screenshot({ path: "generated-artifacts/inventory-permission-visibility/field-desktop.png" });
    assert.equal((await tech.request.get(`${url}/fulfillment`)).status(), 403);
    console.log("PASS role-managed field view/assign stock-only navigation, desktop/mobile action hiding, fulfillment API denial, warehouse grants, and permission revocation.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
