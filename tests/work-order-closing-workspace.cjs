const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { request, chromium } = require("@playwright/test");
(async () => {
  const config = process.env.WORKSPACE_UI_SANDBOX_CONFIG;
  assert.equal(JSON.parse(await fs.readFile(config, "utf8")).ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const api = await request.newContext({ baseURL }), viewer = await request.newContext({ baseURL });
  const base = `/api/projects/${fixture.projectId}`, wo = `${base}/work-orders`;
  const helper = mode => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/work-order-closing-data.ts", mode], { env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  };
  async function json(client, method, url, data, status = 200) {
    const response = await client.fetch(url, { method, data });
    const text = await response.text();
    assert.equal(response.status(), status, `${method} ${url}: ${text.slice(0, 800)}`);
    return JSON.parse(text);
  }
  let browser;
  try {
    await json(api, "POST", "/api/auth/local/login", fixture);
    await json(viewer, "POST", "/api/auth/local/login", fixture.viewer);
    helper("seed"); helper("guide");
    const { ids } = JSON.parse(await fs.readFile(path.join(path.dirname(config), "closing-fixture.json"), "utf8"));
    assert.deepEqual(await json(api, "GET", `${base}/work-order-closing`), { enabled: false, afterHours: 168, canManage: true });
    await json(viewer, "PUT", `${base}/work-order-closing`, { enabled: true, afterHours: 1 }, 403);
    await json(api, "PUT", `${base}/work-order-closing`, { enabled: false, afterHours: 0 }, 400);
    await json(api, "PUT", `${base}/work-order-closing`, { enabled: false, afterHours: 1 });
    await json(viewer, "POST", `${wo}/bulk-status`, { workOrderIds: [ids.first], status: "Closed" }, 403);
    const closed = await json(api, "POST", `${wo}/bulk-status`, {
      workOrderIds: [ids.first, ids.second, ids.open, ids.scheduled, ids.trouble], status: "Closed",
    });
    assert.equal(closed.updatedCount, 2, JSON.stringify(closed)); assert.equal(closed.skipped, 3);
    helper("verify-closed");
    await json(api, "PATCH", `${wo}/${ids.first}`, { notes: "Cannot edit Closed" }, 409);
    await json(api, "POST", `${wo}/${ids.first}/time-tracking`, { startTime: new Date().toISOString(), endTime: new Date().toISOString() }, 409);
    await json(api, "POST", `${wo}/${ids.first}/reopen`, { reason: "" }, 400);
    await json(viewer, "POST", `${wo}/${ids.first}/reopen`, { reason: "No permission" }, 403);
    await json(viewer, "GET", `${base}/work-order-history`, undefined, 403);
    const permissions = ["projects.view", "workOrders.view", "workOrders.edit", "workOrders.close"];
    await json(api, "PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions });
    await json(viewer, "POST", `${wo}/${ids.first}/reopen`, { reason: "Close authority is not reopen authority" }, 403);
    await json(api, "PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: [...permissions, "workOrders.reopenClosed", "audit.view"] });
    helper("enable-delivery");
    await json(viewer, "POST", `${wo}/${ids.first}/reopen`, { reason: "Correct the work notes" });
    helper("verify-reopened");
    await json(api, "PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: ["projects.view", "workOrders.view", "workOrders.close", "workOrders.reopenClosed", "audit.view"] });
    await json(viewer, "PATCH", `${wo}/${ids.first}`, { notes: "Not allowed without editing permission" }, 403);
    await json(api, "PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: ["projects.view", "workOrders.view", "workOrders.edit", "workOrders.close", "workOrders.reopenClosed", "audit.view"] });
    await json(viewer, "PATCH", `${wo}/${ids.first}`, { notes: "Corrected after authorized reopening" });
    await json(api, "POST", `${wo}/${ids.second}/reopen`, { reason: "Second review" });
    await json(api, "PUT", `${base}/work-order-closing`, { enabled: true, afterHours: 1 });
    helper("rename-closed");
    const manualEnabled = await json(viewer, "POST", `${wo}/bulk-status`, { workOrderIds: [ids.second], status: "Customer archive" });
    assert.equal(manualEnabled.updatedCount, 1, "Manual close remains available when auto-close is enabled");
    helper("auto");
    const history = await json(api, "GET", `${base}/work-order-history?workOrderId=${ids.first}`);
    assert.equal(history.timezone, "America/New_York");
    assert.ok(history.groups.some(g => g.events.some(e => e.action === "workOrder.close")));
    assert.ok(history.groups.some(g => g.events.some(e => e.action === "workOrder.reopen" && e.metadata.reason === "Correct the work notes")));
    assert.ok(history.groups.some(g => g.events.some(e => e.action === "workOrder.changeBlocked")));
    const closeGroup = history.groups.find(g => g.events.some(e => e.action === "workOrder.close"));
    assert.ok(closeGroup.events.some(e => e.entityLabel === "CUSTOMER-first"));
    assert.ok(closeGroup.events.some(e => e.entityLabel === "CUSTOMER-second"), "Batch full history includes related entries");
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: history.timezone }).format(new Date());
    const filtered = await json(api, "GET", `${base}/work-order-history?from=${date}&to=${date}&action=workOrder.close`);
    assert.ok(filtered.total > 0);
    await json(api, "GET", `${base}/work-order-history?from=2026-10-20&to=2026-10-19`, undefined, 400);
    const printed = await api.get(`${base}/work-order-history?operationId=${closeGroup.operationId}&format=print`);
    assert.equal(printed.status(), 200); assert.ok((await printed.text()).includes("CUSTOMER-first"));
    const csv = await api.get(`${base}/work-order-history?workOrderId=${ids.first}&format=csv`);
    assert.equal(csv.status(), 200); assert.ok((await csv.text()).includes("CUSTOMER-first"));
    helper("roundtrip");
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
    const context = await browser.newContext({ baseURL });
    await context.request.post("/api/auth/local/login", { data: fixture });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByRole("tab", { name: "Work Orders", exact: true }).click();
    await page.getByRole("tab", { name: "Wizard", exact: true }).click();
    await page.getByTestId("input-work-order-close-hours").waitFor();
    await page.screenshot({ path: "generated-artifacts/project-workspace/work-order-closing-settings.jpg", fullPage: true });
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByTestId("button-work-order-history").first().click();
    await page.getByRole("dialog").getByText("CUSTOMER-first", { exact: false }).first().waitFor();
    await page.screenshot({ path: "generated-artifacts/project-workspace/work-order-history-desktop.jpg" });
    const mobile = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 },
      isMobile: true, hasTouch: true, storageState: await context.storageState() });
    const phone = await mobile.newPage();
    phone.on("pageerror", error => errors.push(error.message));
    await phone.goto(`/projects/${fixture.projectId}/work-orders`);
    await phone.getByRole("button", { name: /Show Search.*Tools/i }).click();
    await phone.getByTestId("button-work-order-history").first().click();
    await phone.getByRole("dialog").getByText("CUSTOMER-first", { exact: false }).first().waitFor();
    await phone.screenshot({ path: "generated-artifacts/project-workspace/work-order-history-phone.jpg" });
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.screenshot({ path: "generated-artifacts/project-workspace/work-order-history-landscape.jpg" });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    assert.deepEqual(errors, []);
    console.log("Work-order lifecycle API, permission, inventory preservation, auto-close, history/export and responsive browser acceptance passed.");
  } finally { if (browser) await browser.close(); await api.dispose(); await viewer.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
