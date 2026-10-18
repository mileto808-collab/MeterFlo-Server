if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Use the owned workspace sandbox.");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const viewer = await browser.newContext({ baseURL });
  const anon = await browser.newContext({ baseURL });
  try {
    assert.equal((await admin.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const endpoint = "/api/settings/web-updates/status";
    assert.equal((await anon.request.get(endpoint)).status(), 401);
    assert.equal((await viewer.request.get(endpoint)).status(), 403);
    const status = await admin.request.get(endpoint);
    assert.equal(status.status(), 200);
    assert.deepEqual(Object.keys(await status.json()).sort(), ["cachedRelease", "lastCheck"]);
    const p = fixture.projectId, base = `/api/projects/${p}`;
    for (const [method, url] of [
      ["GET", "/api/settings/web-update-config"], ["PUT", "/api/settings/web-update-config"],
      ["POST", "/api/customer-api-logs/1/retry"],
      ["POST", "/api/mobile/workorders/1/trouble"], ["POST", "/api/mobile/workorders/1/complete"],
      ["GET", `${base}/work-orders/by-meter/missing`],
    ]) {
      const r = await admin.request.fetch(url, { method, data: method === "GET" ? undefined : {} });
      assert.equal(r.status(), 404, `Removed API ${url} must be gone`);
      assert.match(r.headers()["content-type"], /application\/json/);
    }
    const service = (await (await admin.request.get("/api/service-types")).json())[0].code;
    const definition = await admin.request.post(`${base}/trouble-codes`, {
      data: { code: `CURRENT_${p}`, label: "Current mobile choice" },
    });
    assert.equal(definition.status(), 201);
    const code = await definition.json();
    const create = await admin.request.post(`${base}/work-orders`, { data: {
      customerWoId: `CLEANUP_${p}`, customerId: "CLEANUP", customerName: "Cleanup fixture",
      address: "100 Fixture Street", serviceType: service, status: "Open",
    } });
    assert.equal(create.status(), 201);
    const order = await create.json();
    const troubleUrl = `/api/mobile/projects/${p}/work-orders/${order.id}/trouble`;
    assert.equal((await viewer.request.post(troubleUrl, { data: { troubleCode: code.ruleKey } })).status(), 403);
    const result = await admin.request.post(troubleUrl, { data: {
      troubleCode: code.ruleKey, notes: "Current project-scoped mobile route", oldSystemReading: "12",
    } });
    assert.equal(result.status(), 200);
    const saved = (await result.json()).workOrder;
    assert.equal(saved.trouble, code.ruleKey);
    assert.match(saved.notes, /Current mobile choice/);
    const page = await admin.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/settings?tab=updates");
    await page.getByTestId("settings-tab-updates").click();
    await page.getByTestId("settings-section-nav-web-updates").click();
    await expect(page.getByRole("button", { name: "Check numbered releases", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Preview Changes", exact: true })).toBeVisible();
    await expect(page.locator("#webUpdateUrl")).toHaveCount(0);
    await expect(page.getByTestId("button-save-web-update-config")).toHaveCount(0);
    await fs.mkdir("generated-artifacts/compatibility-cleanup", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/compatibility-cleanup/settings-desktop.jpg" });
    assert.deepEqual(errors, []);
    console.log("PASS: obsolete endpoints return JSON 404, status permissions remain enforced, current mobile UUID/reading flow works, old Settings controls are absent, current checks and previews remain.");
    require("node:child_process").execFileSync(process.execPath,
      ["--import", "tsx", "--test",
        "tests/reading-precision.test.ts"], { stdio: "inherit", env: process.env });
  } finally {
    await admin.close(); await viewer.close(); await anon.close(); await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
