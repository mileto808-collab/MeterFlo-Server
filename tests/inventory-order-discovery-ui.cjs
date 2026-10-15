// Run after inventory-order-ui.cjs, using its disposable project fixture only.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => {
      const response = await context.request.get(endpoint);
      assert.equal(response.status(), 200);
      return response.json();
    };
    const before = await snapshot();
    assert.equal(typeof before.timezone, "string", "inventory carries display timezone without admin settings access");
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.setDefaultTimeout(15000);
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Orders", exact: true }).click();
    const builder = page.locator("fieldset");
    const selectBuilder = async (index, name) => {
      await builder.getByRole("combobox").nth(index).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await selectBuilder(1, "ORDER-MAIN · order-main");
    await selectBuilder(2, "Order supplier");
    await builder.getByLabel("Supplier/customer reference", { exact: true }).fill("DISCOVERY-000042");
    await selectBuilder(3, "ORDER-BULK · Order bulk");
    await builder.getByRole("button", { name: "Add line", exact: true }).click();
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText(/^Order .+Reference DISCOVERY-000042 saved as a draft/).waitFor();
    const created = await snapshot();
    const order = created.state.orders.find(order => order.reference === "DISCOVERY-000042");
    assert.ok(order);
    assert.notEqual(order.id, order.reference);
    assert.match(order.orderNumber, /^PO-\d{4}-\d{6,9}$/);
    assert.equal(created.state.orders.length, before.state.orders.length + 1);
    assert.deepEqual(created.state.stock, before.state.stock);
    const controls = page.getByRole("region", { name: "Filter inventory orders" });
    const search = controls.getByLabel("Search orders", { exact: true });
    const cards = page.locator("div.rounded-lg.border.p-4");
    const count = async expected => {
      await page.waitForFunction(expected => document.querySelectorAll("div.rounded-lg.border.p-4").length === expected, expected);
      assert.equal(await cards.count(), expected);
    };
    for (const term of [order.orderNumber, order.id, "DISCOVERY-000042"]) {
      await search.fill(term); await count(1);
      assert.ok((await cards.innerText()).includes(order.orderNumber));
    }
    await cards.getByRole("button", { name: "Edit draft", exact: true }).click();
    await builder.getByLabel("Supplier/customer reference", { exact: true }).fill("DISCOVERY-000043");
    await builder.getByRole("button", { name: "Save draft", exact: true }).click();
    await page.getByText(/^Order .+Reference DISCOVERY-000043 saved as a draft/).waitFor();
    const edited = await snapshot();
    assert.equal(edited.state.orders.length, created.state.orders.length);
    const updated = edited.state.orders.find(value => value.reference === "DISCOVERY-000043");
    assert.equal(updated.id, order.id);
    assert.equal(updated.orderNumber, order.orderNumber);
    assert.deepEqual(edited.state.stock, before.state.stock);
    await search.fill("DISCOVERY-000042"); await count(0);
    await search.fill("DISCOVERY-000043"); await count(1);
    const selectFilter = async (label, name) => {
      await controls.getByRole("combobox", { name: label, exact: true }).click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    await selectFilter("Order type", "Transfer"); await count(0);
    await controls.getByRole("button", { name: "Reset filters", exact: true }).click();
    for (const term of ["ORDER-BULK", "Order bulk", "Order supplier", "order-main"]) {
      await search.fill(term);
      await page.waitForFunction(() => document.querySelectorAll("div.rounded-lg.border.p-4").length > 0);
      assert.ok((await cards.allTextContents()).join(" ").toLowerCase().includes(term.toLowerCase()));
    }
    await search.fill("DISCOVERY-000043"); await count(1);
    await selectFilter("Order type", "Purchase");
    await selectFilter("Order status", "Draft");
    await selectFilter("Vendor filter", "Order supplier");
    // Options show warehouse code and name, just like the order builder.
    await controls.getByRole("combobox", { name: "Destination filter", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "ORDER-MAIN" }).click();
    await count(1);
    await controls.getByRole("combobox", { name: "Source filter", exact: true }).click();
    await page.getByRole("option").filter({ hasText: "ORDER-MAIN" }).click();
    await count(0);
    await controls.getByRole("button", { name: "Reset filters", exact: true }).click();
    await search.fill("DISCOVERY-000043"); await count(1);
    await controls.getByLabel("From date", { exact: true }).fill("2099-01-02");
    await controls.getByLabel("To date", { exact: true }).fill("2000-01-01");
    await count(0);
    await controls.getByRole("alert").waitFor();
    await controls.getByRole("button", { name: "Reset filters", exact: true }).click();
    await search.fill("DISCOVERY-000043"); await count(1);
    for (const sort of ["Oldest first", "Order number", "Newest first"]) await selectFilter("Sort orders", sort);
    await count(1);
    const printed = await context.request.get(`${endpoint}/print/order/${encodeURIComponent(order.id)}`);
    assert.equal(printed.status(), 200);
    const html = await printed.text();
    assert.ok(html.includes(order.orderNumber));
    assert.ok(html.includes("DISCOVERY-000043"));
    assert.ok(html.includes(order.id));
    await fs.mkdir("generated-artifacts/order-discovery", { recursive: true });
    await controls.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/order-discovery/desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await controls.scrollIntoViewIfNeeded();
    const widths = await page.evaluate(() => ({
      viewport: innerWidth, body: document.documentElement.scrollWidth,
      clipped: [...document.querySelectorAll('section[aria-label="Filter inventory orders"], div.rounded-lg.border.p-4')]
        .filter(element => element.scrollWidth > element.clientWidth + 2).map(element => element.className),
    }));
    assert.ok(widths.body <= widths.viewport + 2, JSON.stringify(widths));
    assert.deepEqual(widths.clipped, [], "filter and card contents must not be clipped in nested containers");
    await page.screenshot({ path: "generated-artifacts/order-discovery/phone.png" });
    assert.deepEqual(errors, []);
    // A normal delegated inventory user can read timezone without settings access.
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const viewerSnapshot = await viewer.request.get(endpoint);
    assert.equal(viewerSnapshot.status(), 200);
    assert.equal((await viewerSnapshot.json()).timezone, before.timezone);
    const denied = await viewer.request.post(`${endpoint}/commands`, { data: { action: "numberOrders", data: {}, operationId: crypto.randomUUID() } });
    assert.equal(denied.status(), 403, "view-only user cannot number historical orders");
    await viewer.close();
    console.log("Order discovery: creation, reference correction/stable identity, combined search/filters, dates, prints, role scope, and desktop/phone width checks passed.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
