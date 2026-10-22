const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL });
  try {
    const login = await context.request.post("/api/auth/local/login", { data: fixture });
    assert.ok(login.ok(), "Fixture administrator can sign in");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    const chooser = page.getByRole("heading", { name: "Choose an inventory task", exact: true });
    const wizard = page.getByRole("heading", { name: "Fulfill / Stage Work Orders", exact: true });
    const stock = page.getByRole("tab", { name: "Stock & search", exact: true });
    await page.getByTestId("button-start-inventory-desktop").click();
    await expect(chooser).toBeVisible();
    await expect(stock).toBeHidden();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const transferCard = page.getByTestId("inventory-task-vehicle-transfer");
    await transferCard.click();
    await expect(page.getByTestId("vehicle-transfer-dialog")).toBeVisible();
    await expect(page.getByTestId("vehicle-transfer-dialog")).toHaveCount(1);
    await page.getByTestId("vehicle-transfer-dialog").getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(transferCard).toBeFocused();
    await page.reload();
    await expect(chooser).toBeVisible();
    await expect(stock).toBeHidden();
    await page.getByTestId("inventory-task-fulfillment").click();
    await expect(wizard).toBeVisible();
    await expect(chooser).toHaveCount(0);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await expect(wizard).toBeVisible();
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(chooser).toBeVisible();
    await page.getByRole("button", { name: /Back to Inventory$/i }).click();
    await expect(stock).toBeVisible();
    await page.reload();
    await expect(stock).toBeVisible();
    await expect(chooser).toHaveCount(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByTestId("button-start-inventory-mobile").click();
    await expect(chooser).toBeVisible();
    await transferCard.click();
    await expect(page.getByTestId("vehicle-transfer-dialog")).toBeVisible();
    await page.getByTestId("vehicle-transfer-dialog").getByRole("button", { name: "Close", exact: true }).first().click();
    await expect(chooser).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      "Task page does not overflow the phone viewport");
    await fs.mkdir("generated-artifacts/inventory-task-page", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-task-page/phone.jpg" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "generated-artifacts/inventory-task-page/desktop.jpg" });
    const request = async (method, path, data) => {
      const response = await context.request.fetch(path, { method, data });
      assert.ok(response.ok(), `${method} ${path}: ${response.status()}`);
      return response.json();
    };
    const role = await request("POST", "/api/subroles", {
      key: `transfer_only_${crypto.randomUUID().slice(0, 8)}`, label: "Stock transfer worker", baseRole: "user",
      permissions: ["nav.projects", "inventory.view", "inventory.transfer", "inventory.receive"],
    });
    const credentials = { username: `transfer-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const stockUser = await request("POST", "/api/users", { ...credentials, firstName: "Transfer", lastName: "Worker",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    const stockContext = await browser.newContext({ baseURL });
    assert.ok((await stockContext.request.post("/api/auth/local/login", { data: credentials })).ok());
    const stockPage = await stockContext.newPage();
    await stockPage.goto(`/projects/${fixture.projectId}/inventory`);
    await stockPage.getByTestId("button-start-inventory-desktop").click();
    await expect(stockPage.getByTestId("inventory-task-fulfillment")).toHaveCount(0);
    await stockPage.evaluate(({ userId, projectId }) => {
      localStorage.setItem(`meterflo:fulfillment-workspace:${encodeURIComponent(String(userId))}:${projectId}`,
        JSON.stringify({ workspace: "fulfillment", open: true }));
    }, { userId: stockUser.id, projectId: fixture.projectId });
    await stockPage.reload();
    await expect(stockPage.getByRole("heading", { name: "Choose an inventory task", exact: true })).toBeVisible();
    await stockPage.getByTestId("inventory-task-vehicle-transfer").click();
    await expect(stockPage.getByTestId("vehicle-transfer-dialog")).toBeVisible();
    await expect(stockPage.getByRole("button", { name: "Transfer outstanding work and stock", exact: true })).toHaveCount(0);
    assert.deepEqual(errors, []);
    console.log("PASS task page, both wizard launches, transfer-only permissions, refresh restoration, return navigation and phone layout.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
