const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required; never run against user data.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-dates";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
    const errors = [];
    const api = async (method, url, data) => {
      const response = await context.request.fetch(url, { method, data });
      assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
      return response.json();
    };
    await api("POST", "/api/auth/local/login", fixture);
    const root = `/api/projects/${fixture.projectId}`;
    await api("PATCH", root, { timezone: "America/Denver" });
    const command = (action, data) => api("POST", `${root}/inventory/commands`,
      { operationId: crypto.randomUUID(), action, data });
    const initial = await api("GET", `${root}/inventory`);
    const warehouseId = initial.state.warehouses.find(warehouse => warehouse.type === "physical").id;
    await command("vendor", { id: "date-vendor", name: "Date test supplier" });
    await command("item", { id: "date-item", sku: "DATE", name: "Date test stock", tracking: "regular" });
    await command("order", { id: "date-order", type: "purchase", vendorId: "date-vendor", destinationId: warehouseId,
      lines: [{ itemId: "date-item", quantity: 1 }] });
    await command("release", { orderId: "date-order" });
    await command("receive", { orderId: "date-order", lines: [{ itemId: "date-item", quantity: 1, serials: [] }] });
    const snapshot = await api("GET", `${root}/inventory`);
    assert.equal(snapshot.timezone, "America/Denver");
    const receipt = snapshot.state.receipts.find(record => record.action === "receive");
    assert.ok(receipt);
    const readable = value => new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Denver", year: "numeric", month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short",
    }).format(new Date(value));
    const print = await context.newPage();
    print.on("pageerror", error => errors.push(error.message));
    await print.goto(`${root}/inventory/print/receipt/${receipt.id}`);
    await expect(print.locator("body")).toContainText(`Date: ${readable(receipt.occurredAt)}`);
    await expect(print.locator("body")).not.toContainText(receipt.occurredAt);
    await print.screenshot({ path: `${out}/receipt.jpg`, fullPage: true });

    // Rendering-only custody fixture: no synthetic removal or stock adjustment
    // is written to the database to exercise this display component.
    const occurredAt = "2026-10-19T03:01:17.028Z";
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.route(`**${root}/inventory`, async route => {
      const response = await route.fetch(), json = await response.json();
      json.state.returns = [{ id: "date-return", serial: "DATE-OLD", workOrderId: 777, equipment: "system",
        disposition: "returned", status: "scrapped", warehouseId, history: [{
          operationId: "date-history", outcome: "scrapped", ruleName: "Scrap after inspection",
          reason: "Date rendering fixture", actor: fixture.id, occurredAt,
        }] }];
      await route.fulfill({ response, json });
    });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    await page.getByText("Custody & decision history", { exact: true }).click();
    await expect(page.locator("time")).toHaveText(readable(occurredAt));
    await expect(page.locator("time")).toHaveAttribute("datetime", occurredAt);
    await page.screenshot({ path: `${out}/custody-history.jpg`, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("time")).toBeVisible();
    await page.screenshot({ path: `${out}/custody-history-phone.jpg`, fullPage: true });
    assert.deepEqual(errors, []);
    assert.deepEqual((await api("GET", `${root}/inventory`)).state, snapshot.state,
      "Formatting and viewing must not change stored inventory evidence");
    console.log("PASS: real receipt uses project timezone; desktop/phone custody history is readable; stored evidence unchanged.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
