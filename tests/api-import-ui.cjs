// Optional signed-in browser smoke test. Start support/api-import-ui-fixture.ts first.
// Requires an installed Playwright runtime (or PLAYWRIGHT_MODULE_PATH).
// TEST_APP_URL defaults to the workspace development domain; CHROMIUM_PATH is optional.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-api-import-ui-fixture.json", "utf8"));
const base = process.env.TEST_APP_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const api = `/api/projects/${fixture.projectId}/api-import`;
async function main() {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const errors = [];
  try {
    const context = await browser.newContext({ baseURL: base });
    const login = await context.request.post("/api/auth/local/login", { data: { username: fixture.admin.username, password: fixture.admin.password } });
    assert.equal(login.status(), 200);
    for (const config of await (await context.request.get(`${api}/configs`)).json()) {
      assert.equal((await context.request.delete(`${api}/configs/${config.id}`)).status(), 204);
    }
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    const available = await (await context.request.get("/api/permissions")).json();
    assert.ok(available.some(permission => permission.key === "project.apiImport" && permission.label === "Customer API Import"));
    const grantedBefore = await (await context.request.get(`/api/subroles/${fixture.viewerSubroleId}/permissions`)).json();
    assert.ok(!grantedBefore.includes("project.apiImport"), "Fixture must begin without API Import access");
    await page.goto("/settings");
    await page.locator(`[data-testid="button-edit-access-level-${fixture.viewerSubroleId}"]`).click();
    const roleDialog = page.getByRole("dialog");
    const apiPermission = roleDialog.locator('[data-testid="checkbox-perm-project.apiImport"]');
    assert.equal(await apiPermission.getAttribute("data-state"), "unchecked");
    await apiPermission.click();
    await roleDialog.locator('[data-testid="button-save-subrole"]').click();
    await roleDialog.waitFor({ state: "hidden" });
    const grantedAfter = await (await context.request.get(`/api/subroles/${fixture.viewerSubroleId}/permissions`)).json();
    assert.ok(grantedAfter.includes("project.apiImport"), "Administrator role management must persist the API Import grant");
    await page.goto(`/projects/${fixture.projectId}/api-import`);
    await page.getByRole("heading", { name: "Customer API pull", exact: true }).waitFor();
    const field = (dialog, name) => dialog.getByText(name, { exact: true }).locator("..").locator("input,textarea");
    await page.getByRole("button", { name: /add.*source/i }).click();
    let dialog = page.getByRole("dialog");
    await field(dialog, "Source name").fill(fixture.settings.name);
    await field(dialog, "Endpoint URL").fill(fixture.sourceUrl);
    await field(dialog, "Records path").fill("data");
    await field(dialog, "Field mapping JSON").fill(JSON.stringify(fixture.settings.fieldMapping));
    await dialog.getByRole("button", { name: "Test & preview unsaved settings" }).click();
    const preview = page.getByRole("dialog").last();
    await preview.getByText("0.001", { exact: false }).first().waitFor();
    assert.equal((await (await context.request.get(`${api}/runs`)).json()).length, 0);
    await preview.getByRole("button", { name: "Close", exact: true }).first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Create source", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /pull now/i }).waitFor();
    let config = (await (await context.request.get(`${api}/configs`)).json())[0];
    const latest = async () => (await (await context.request.get(`${api}/runs`)).json())[0];
    const waitRun = async (previousId, expected) => {
      for (let i = 0; i < 45; i++) {
        const run = await latest();
        if (run && run.id !== previousId && !["queued", "running", "retrying"].includes(run.status)) {
          assert.equal(run.status, expected); return run;
        }
        await page.waitForTimeout(500);
      }
      throw new Error("Browser flow: import did not finish");
    };
    await page.getByRole("button", { name: /pull now/i }).click();
    let run = await waitRun(null, "succeeded"); assert.equal(run.created, 1);
    await page.getByRole("button", { name: /pull now/i }).waitFor({ state: "visible" });
    await page.waitForTimeout(5500);
    await page.getByRole("button", { name: /pull now/i }).click();
    run = await waitRun(run.id, "succeeded"); assert.equal(run.skipped, 1); assert.equal(run.created, 0);
    await page.waitForTimeout(5500);
    await page.getByRole("button", { name: `Edit ${fixture.settings.name}`, exact: true }).click();
    dialog = page.getByRole("dialog");
    await field(dialog, "Endpoint URL").fill(`${fixture.sourceUrl}?fail=1`);
    await dialog.getByRole("button", { name: "Save changes", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /pull now/i }).click();
    run = await waitRun(run.id, "failed");
    await page.waitForTimeout(5500);
    await page.getByRole("button", { name: `Edit ${fixture.settings.name}`, exact: true }).click();
    await field(page.getByRole("dialog"), "Endpoint URL").fill(fixture.sourceUrl);
    await page.getByRole("dialog").getByRole("button", { name: "Save changes", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /retry/i }).first().click();
    run = await waitRun(run.id, "succeeded");
    await page.waitForTimeout(5500);
    const toggles = page.getByRole("switch");
    await toggles.first().click();
    for (let i = 0; i < 20; i++) {
      config = (await (await context.request.get(`${api}/configs`)).json())[0];
      if (!config.isEnabled) break; await page.waitForTimeout(200);
    }
    assert.equal(config.isEnabled, false);
    assert.equal(await page.getByRole("button", { name: /pull now/i }).isDisabled(), true);
    await toggles.first().click();
    const viewerContext = await browser.newContext({ baseURL: base });
    const viewerLogin = await viewerContext.request.post("/api/auth/local/login", { data: { username: fixture.viewer.username, password: fixture.viewer.password } });
    assert.equal(viewerLogin.status(), 200);
    const viewer = await viewerContext.newPage();
    viewer.on("pageerror", error => errors.push(error.message));
    await viewer.goto(`/projects/${fixture.projectId}/api-import`);
    await viewer.getByRole("button", { name: /test \/ preview/i }).waitFor();
    assert.equal(await viewer.getByRole("button", { name: /add.*source/i }).count(), 0);
    assert.equal(await viewer.getByRole("button", { name: /retry/i }).count(), 0);
    assert.equal(await viewer.getByRole("button", { name: `Edit ${fixture.settings.name}`, exact: true }).count(), 0);
    await viewer.getByRole("button", { name: /test \/ preview/i }).click();
    await viewer.getByRole("dialog").getByText("0.001", { exact: false }).first().waitFor();
    await viewer.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).first().click();
    await viewer.getByRole("button", { name: /pull now/i }).click();
    run = await waitRun(run.id, "succeeded"); assert.equal(run.skipped, 1);
    await page.setViewportSize({ width: 402, height: 874 });
    await page.screenshot({ path: "/tmp/api-import-mobile.jpg", fullPage: true });
    const viewportWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(scrollWidth <= viewportWidth + 1, `Horizontal overflow: ${scrollWidth} > ${viewportWidth}`);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/api-import-desktop.jpg", fullPage: true });
    await page.getByRole("button", { name: `Remove ${fixture.settings.name}`, exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: /remove/i }).click();
    for (let i = 0; i < 20; i++) {
      if ((await (await context.request.get(`${api}/configs`)).json()).length === 0) break;
      await page.waitForTimeout(200);
    }
    assert.equal((await (await context.request.get(`${api}/configs`)).json()).length, 0);
    assert.ok((await (await context.request.get(`${api}/runs`)).json()).length >= 5);
    const workOrders = await context.request.get(`/api/projects/${fixture.projectId}/work-orders`);
    assert.equal(workOrders.status(), 200);
    assert.match(await workOrders.text(), /API-UI-0001/);
    assert.deepEqual(errors, []);
    console.log("Signed-in API Import browser flow passed: preview/create/pull/deduplicate/edit/fail/retry/disable/enable/viewer/delete/retained work orders; mobile layout has no overflow.");
  } catch (error) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) await page.screenshot({ path: "/tmp/api-import-ui-failure.jpg", fullPage: true }).catch(() => {});
    throw error;
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
