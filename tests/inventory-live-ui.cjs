// Uses only the disposable inventory-ui-fixture.ts project.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");
const { Pool } = require("pg");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const remote = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const base = `/api/projects/${fixture.projectId}/inventory`;
  const out = "generated-artifacts/inventory-live";
  try {
    await fs.mkdir(out, { recursive: true });
    for (const c of [context, remote]) assert.equal((await c.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const command = async (action, data, operationId = crypto.randomUUID()) => {
      const result = await remote.request.post(`${base}/commands`, { data: { action, data, operationId } });
      assert.equal(result.status(), 200, await result.text());
      return result.json();
    };
    await command("warehouse", { id: "live-main", code: "LIVE", name: "Live warehouse", type: "physical", address: "Fixture" });
    await command("vendor", { id: "live-vendor", name: "Live vendor" });
    await command("item", { id: "live-meter", sku: "LIVE-001", name: "Live meter", tracking: "serialized" });
    const receive = async (id, serial) => {
      await command("order", { id, type: "purchase", vendorId: "live-vendor", destinationId: "live-main",
        lines: [{ itemId: "live-meter", quantity: 1 }] });
      await command("release", { orderId: id });
      await command("receive", { orderId: id, lines: [{ itemId: "live-meter", quantity: 1, serials: [serial] }] });
    };
    await receive("live-po-1", "00001");
    await context.addInitScript(() => {
      window.inventoryTestEvents = [];
      window.inventoryTestConnections = 0;
      const Native = window.EventSource;
      window.EventSource = class extends Native {
        constructor(url, options) {
          super(url, options);
          if (String(url).endsWith("/inventory/events")) {
            window.inventoryTestConnections++;
            this.addEventListener("message", event => {
              try { window.inventoryTestEvents.push(JSON.parse(event.data)); } catch {}
            });
          }
        }
      };
    });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const stockRequests = [];
    page.on("request", request => { if (new URL(request.url()).pathname === `${base}/stock`) stockRequests.push(request.url()); });
    await page.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await expect(page.getByTestId("inventory-live-indicator")).toContainText(/Live/i);
    await expect(page.locator("[data-stock-row]")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => window.inventoryTestEvents.some(event => event.type === "resync"))).toBe(true);
    assert.equal(await page.evaluate(() => window.inventoryTestConnections), 1);
    await page.getByRole("button", { name: /^View serials \(1\) for/ }).click();
    const serialDialog = page.getByRole("dialog");
    await expect(serialDialog).toContainText("00001");
    await receive("live-po-2", "00002");
    await expect(serialDialog).toContainText("00002");
    await command("item", { id: "live-meter", sku: "LIVE-001", name: "Live meter renamed", tracking: "serialized" });
    await expect(serialDialog).toContainText("Live meter renamed");
    await expect.poll(() => page.evaluate(() => window.inventoryTestEvents.some(event => event.type === "inventory_updated"))).toBe(true);
    assert.equal(await page.evaluate(() => window.inventoryTestConnections), 1, "opening details shares the page's connection");
    await page.keyboard.press("Escape");
    const editor = await remote.newPage();
    await editor.goto(`/projects/${fixture.projectId}/inventory`, { waitUntil: "domcontentloaded", timeout: 60000 });
    await editor.getByRole("tab", { name: "Items", exact: true }).click();
    await editor.locator("article").filter({ hasText: "Live meter renamed" }).getByRole("button", { name: "Edit", exact: true }).click();
    const editDialog = editor.getByRole("dialog", { name: "Item details" });
    await editDialog.getByLabel(/^Product Label \(Name\)/).fill("Local unsaved name");
    await command("item", { id: "live-meter", sku: "LIVE-001", name: "Remote name", tracking: "serialized" });
    await expect(editDialog.getByTestId("inventory-external-change")).toBeVisible();
    await expect(editDialog.getByLabel(/^Product Label \(Name\)/)).toHaveValue("Local unsaved name");
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    await expect(page.locator("article").filter({ hasText: "Remote name" })).toBeVisible();
    await command("vendor", { id: "live-vendor", name: "Live vendor changed" });
    await page.getByRole("tab", { name: "Vendors", exact: true }).click();
    await expect(page.getByText("Live vendor changed", { exact: true })).toBeVisible();
    await command("category", { name: "Live category" });
    await page.getByRole("tab", { name: "Categories", exact: true }).click();
    await expect(page.getByText("Live category", { exact: true })).toBeVisible();
    await command("countStart", { id: "live-count", warehouseId: "live-main" });
    await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    await expect(page.getByRole("button", { name: "Continue count", exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "Stock & search", exact: true }).click();
    // A rolled-back SQL notification cannot produce a live event or a refetch.
    await page.waitForTimeout(400);
    const eventCount = await page.evaluate(() => window.inventoryTestEvents.length);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_notify('meterflo_inventory',$1)", [JSON.stringify({ projectId: fixture.projectId, revision: 99999 })]);
      await client.query("ROLLBACK");
      await page.waitForTimeout(350);
      assert.equal(await page.evaluate(() => window.inventoryTestEvents.length), eventCount);
      await client.query("BEGIN");
      await client.query("SELECT pg_notify('meterflo_inventory',$1)", [JSON.stringify({ projectId: fixture.projectId })]);
      await client.query("COMMIT");
      await expect.poll(() => page.evaluate(() => window.inventoryTestEvents.length)).toBeGreaterThan(eventCount);
    } finally { client.release(); }
    // Catch missed writes on reconnect, including same-account tabs/devices.
    await context.setOffline(true);
    await receive("live-po-3", "00003");
    await context.setOffline(false);
    await expect(page.getByTestId("inventory-live-indicator")).toContainText(/Live/i, { timeout: 15000 });
    await expect(page.getByRole("button", { name: /^View serials \(3\) for/ })).toBeVisible({ timeout: 15000 });
    await page.screenshot({ path: `${out}/stock.png` });
    await editor.screenshot({ path: `${out}/dirty-editor.png` });
    // A changed order must not erase unfinished HID scanner text, even while
    // its nested serial dialog is open and automatic checkpoints are unavailable.
    await command("order", { id: "live-pending", type: "purchase", vendorId: "live-vendor", destinationId: "live-main",
      lines: [{ itemId: "live-meter", quantity: 1 }] });
    await command("release", { orderId: "live-pending" });
    const shipmentPage = await context.newPage();
    await shipmentPage.route(`**${base}/commands`, route => {
      if (route.request().postDataJSON().action === "shipmentDraftSave")
        return route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Fixture checkpoint outage"}' });
      return route.continue();
    });
    await shipmentPage.goto(`/projects/${fixture.projectId}/inventory`);
    await shipmentPage.getByRole("tab", { name: "Orders", exact: true }).click();
    await shipmentPage.getByRole("button", { name: "Receive", exact: true }).click();
    await shipmentPage.locator("#live-meter-goodQuantity").fill("1");
    await shipmentPage.getByRole("button", { name: "Scan / edit serials for Remote name", exact: true }).click();
    const scanner = shipmentPage.getByRole("textbox", { name: "Good serial scanner for Remote name", exact: true });
    await scanner.fill("UNCOMMITTED-HID");
    await command("unrelease", { orderId: "live-pending" });
    await expect(shipmentPage.getByTestId("inventory-external-change")).toBeVisible();
    await expect(scanner).toHaveValue("UNCOMMITTED-HID");
    await expect(shipmentPage.locator("#live-meter-goodQuantity")).toHaveValue("1");
    await shipmentPage.screenshot({ path: `${out}/retained-scan.png` });
    await shipmentPage.close();
    const events = await page.evaluate(() => window.inventoryTestEvents);
    for (const event of events) {
      assert.equal(event.projectId, fixture.projectId);
      assert.ok(Object.keys(event).every(key => ["type", "projectId", "revision"].includes(key)), "stream carries metadata only");
    }
    // Normal role grants control the SSE endpoint as well as ordinary reads.
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.get(`${base}/events?probe=1`)).status(), 403);
    assert.ok((await remote.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view", "inventory.view"] },
    })).ok());
    assert.equal((await viewer.request.get(`${base}/events?probe=1`)).status(), 200);
    const viewerPage = await viewer.newPage();
    await viewerPage.goto(`/projects/${fixture.projectId}/inventory`);
    await expect(viewerPage.getByTestId("inventory-live-indicator")).toContainText(/Live/i);
    await command("warehouse", { id: "live-main", code: "LIVE", name: "Renamed warehouse", type: "physical", address: "Fixture" });
    await expect(viewerPage.getByText("Renamed warehouse", { exact: true })).toBeVisible();
    assert.ok((await remote.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["projects.view", "workOrders.view"] },
    })).ok());
    await command("vendor", { id: "live-vendor", name: "Permission revocation trigger" });
    await expect(viewerPage.getByTestId("inventory-live-indicator")).not.toBeVisible({ timeout: 15000 });
    assert.equal((await viewer.request.get(`${base}/events?probe=1`)).status(), 403);
    await viewer.close();
    assert.ok(stockRequests.length < 35, "coalesced events avoid an uncontrolled refetch loop");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, events: events.length, stockRequests: stockRequests.length,
      checks: "same-user/cross-user live updates, read-only dialog, dirty editor/scans, tabs, commit/rollback, reconnect, revocation" }));
  } finally {
    await context.close(); await remote.close(); await browser.close(); await pool.end();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
