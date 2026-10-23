const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  for (const file of ["vehicle-return-ui-fixture.ts", "vehicle-stock-ui-fixture.ts"])
    execFileSync(process.execPath, ["--import", "tsx", `tests/support/${file}`], { stdio: "inherit" });
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL });
  const api = async (ctx, method, path, data, status = 200) => {
    const response = await ctx.request[method](path, data === undefined ? {} : { data });
    if (status === 200) assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    else assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
    return response.headers()["content-type"]?.includes("json") ? response.json() : response.text();
  };
  const endpoint = `/api/projects/${fixture.projectId}/inventory/vehicle-stock`;
  const command = (action, data) => api(admin, "post", `/api/projects/${fixture.projectId}/inventory/commands`, { action, data, operationId: randomUUID() });
  try {
    await api(admin, "post", "/api/auth/local/login", fixture);
    const createWorker = async (extra = []) => {
      const role = await api(admin, "post", "/api/subroles", { key: `stock_${randomUUID().slice(0, 8)}`, label: "Vehicle stock viewer",
        baseRole: "user", permissions: ["nav.projects", "projects.view", "workOrders.view", "inventory.view", ...extra] });
      const credentials = { username: `vehicle-${randomUUID().slice(0, 8)}`, password: `Aa1!${randomUUID()}` };
      const user = await api(admin, "post", "/api/users", { ...credentials, firstName: "Vehicle", lastName: "Viewer",
        role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
      const context = await browser.newContext({ baseURL });
      await api(context, "post", "/api/auth/local/login", credentials);
      return { user, context };
    };
    const tech = await createWorker(), manager = await createWorker(["inventory.manageLocationTypes"]);
    const warehouseData = { id: "return-van", name: "Return vehicle", code: "RETURN-VAN", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "RTN-1", plateState: "CO", expectedLocationTypeRevision: 1 };
    await command("warehouse", { ...warehouseData, userIds: [tech.user.id] });
    const before = await api(admin, "get", `/api/projects/${fixture.projectId}/inventory`);
    const directory = await api(tech.context, "get", "/api/inventory/vehicles");
    assert.deepEqual(directory.vehicles.map(row => row.id), ["return-van"]);
    const all = await api(manager.context, "get", `/api/inventory/vehicles?projectId=${fixture.projectId}`);
    assert.ok(all.vehicles.some(row => row.id === "private-van"), "location-access managers can review all project vehicles");
    const stock = await api(tech.context, "get", `${endpoint}?vehicle=return-van`);
    assert.equal(stock.total, 2, "do not expose counts from other locations");
    const meter = stock.rows.find(row => row.itemId === "return-meter");
    assert.equal(meter.quantity, 2); assert.equal(meter.reserved, 1); assert.equal(meter.available, 1);
    const match = await api(tech.context, "get", `${endpoint}?vehicle=return-van&q=RETURN-A`);
    assert.equal(match.filtered, 1); assert.equal(match.rows[0].itemId, "return-meter");
    assert.deepEqual((await api(tech.context, "get", `${endpoint}/serials?vehicle=return-van&item=return-meter`)).serials, ["RETURN-A", "RETURN-B"]);
    await api(tech.context, "get", `${endpoint}?vehicle=private-van`, undefined, 403);
    await api(tech.context, "get", `${endpoint}/serials?vehicle=private-van&item=return-part`, undefined, 403);
    await api(tech.context, "get", `${endpoint}/print?vehicle=private-van`, undefined, 403);
    await api(tech.context, "get", `${endpoint}?vehicle=return-van&offset=-1`, undefined, 400);
    const ownReport = await api(tech.context, "get", `/api/inventory/vehicles/print`);
    assert.match(ownReport, /RETURN-A/); assert.match(ownReport, /&lt;Vehicle spare &amp; part&gt;/);
    assert.ok(!ownReport.includes("Other crew private vehicle"));
    const fleetReport = await api(manager.context, "get", `/api/inventory/vehicles/print?projectId=${fixture.projectId}`);
    assert.ok(fleetReport.includes("Other crew private vehicle"));
    const filteredReport = await api(tech.context, "get", `${endpoint}/print?vehicle=return-van&q=RETURN-A`);
    assert.ok(!filteredReport.includes("&lt;Vehicle spare"));
    const afterReads = await api(admin, "get", `/api/projects/${fixture.projectId}/inventory`);
    assert.equal(afterReads.state.revision, before.state.revision, "reviews and reports must never change inventory");

    let page = await tech.context.newPage();
    const errors = [];
    await fs.mkdir("generated-artifacts/vehicle-stock", { recursive: true });
    const checkScroll = async (label) => {
      const review = page.getByTestId("vehicle-stock-review");
      const meterRow = page.getByTestId("vehicle-stock-item-return-meter");
      const toggle = meterRow.getByRole("button").first();
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      await expect(review.locator("code").getByText("RETURN-B", { exact: true })).toBeVisible();
      const scroller = review.locator("xpath=..");
      assert.ok(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 1),
        `${label}: the full stock content must create a scrollable area`);
      await scroller.evaluate(element => { element.scrollTop = 0; });
      const bounds = await scroller.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, Math.max(bounds.y, 0) + Math.min(bounds.height / 2, 100));
      await page.mouse.wheel(0, 2000);
      await expect.poll(() => scroller.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
      const footer = review.getByText(/Vehicle stock is the system-expected balance/);
      await expect(footer).toBeInViewport({ ratio: 1 });
      assert.ok(await review.getByText(/Showing .* of/).evaluate(element => {
        const card = element.parentElement.parentElement.parentElement;
        const rect = element.getBoundingClientRect(), container = card.getBoundingClientRect();
        return rect.bottom <= container.bottom + 1 && card.scrollHeight <= card.clientHeight + 1;
      }), `${label}: stock pagination must not be clipped inside the card`);
      assert.ok(await review.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
        `${label}: stock content must fit its actual container`);
      await page.screenshot({ path: `generated-artifacts/vehicle-stock/${label}.jpg`, animations: "disabled" });
    };
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByTestId("button-vehicle-stock").click();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await page.getByTestId("vehicle-stock-item-return-meter").getByRole("button").first().click();
    await expect(page.locator("code").getByText("RETURN-A", { exact: true })).toBeVisible();
    await page.getByTestId("vehicle-stock-search").fill("RETURN-A");
    await page.getByTestId("vehicle-stock-search").press("Enter");
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await expect(page.getByTestId("vehicle-stock-item-return-part")).toHaveCount(0);
    await page.getByTestId("vehicle-stock-search").fill("");
    await expect(page.getByTestId("vehicle-stock-item-return-part")).toBeVisible();
    const stockUrl = url => url.pathname === endpoint;
    await page.route(stockUrl, route => route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ message: "Owned fixture connection interruption" }) }));
    await page.getByTestId("vehicle-stock-refresh").click();
    await expect(page.getByTestId("vehicle-stock-live-state")).toContainText(/stale/i);
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toHaveCount(0);
    await page.unroute(stockUrl);
    await page.getByTestId("vehicle-stock-refresh").click();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    const started = await command("countStart", { id: "live-stock-count", warehouseId: "return-van", scope: "selected", itemIds: ["return-part"] });
    await command("countPost", { id: "live-stock-count", draftRevision: started.state.counts.find(row => row.id === "live-stock-count").draft?.revision ?? 0,
      lines: [{ itemId: "return-part", quantity: 6, serials: [] }],
      reason: "Owned fixture checks live vehicle stock refresh" });
    await expect(page.getByTestId("vehicle-stock-item-return-part")).toContainText("6 each", { timeout: 15000 });
    await page.setViewportSize({ width: 1024, height: 600 });
    await checkScroll("desktop-popup");
    await page.keyboard.press("Escape");
    await page.getByTestId("button-start-inventory-desktop").click();
    await page.getByTestId("inventory-task-vehicle-stock").click();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await checkScroll("desktop-page");
    const phone = await browser.newContext({ baseURL, storageState: await tech.context.storageState(),
      viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    page = await phone.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("button", { name: "Back to inventory tasks", exact: true }).click();
    await page.getByRole("button", { name: "Back to Inventory", exact: true }).click();
    await page.getByTestId("button-vehicle-stock").click();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await checkScroll("phone-popup");
    await expect(page.getByRole("dialog")).toBeInViewport({ ratio: 1 });
    assert.ok(await page.getByTestId("vehicle-stock-review").evaluate(element => element.scrollWidth <= element.clientWidth + 1),
      "phone content must fit its own scroll container, not just the document");
    await fs.mkdir("generated-artifacts/vehicle-stock", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/vehicle-stock/phone.jpg" });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.keyboard.press("Escape");
    await page.getByTestId("button-start-inventory-mobile").click();
    await page.getByTestId("inventory-task-vehicle-stock").click();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toBeVisible();
    await checkScroll("phone-page");
    await page.setViewportSize({ width: 844, height: 390 });
    await checkScroll("phone-landscape-page");
    await expect(page.getByTestId("inventory-task-fulfillment")).toHaveCount(0);
    await command("warehouse", { ...warehouseData, userIds: [] });
    await expect(page.getByText("No accessible vehicles", { exact: true })).toBeVisible();
    await expect(page.getByTestId("vehicle-stock-refresh")).toBeEnabled();
    await expect(page.getByTestId("vehicle-stock-item-return-meter")).toHaveCount(0);
    await api(tech.context, "get", `${endpoint}?vehicle=return-van`, undefined, 403);
    assert.deepEqual(errors, []);
    await phone.close(); await tech.context.close(); await manager.context.close();
    console.log("Vehicle stock access, manager reports, serial search, read-only snapshots, live refresh, phone layout and task/refresh recovery passed.");
  } finally { await admin.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
