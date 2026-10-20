const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { request, chromium, expect } = require("@playwright/test");
(async () => {
  assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG);
  const config = JSON.parse(fs.readFileSync(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL: config.baseURL });
  const owned = [];
  let browser;
  async function json(method, url, data, status = 200) {
    const response = await api.fetch(url, { method, data });
    assert.equal(response.status(), status, `${method} ${url}: ${await response.text()}`);
    return status === 204 ? null : response.json();
  }
  try {
    await json("POST", "/api/auth/local/login", fixture);
    const serviceType = (await json("GET", "/api/service-types"))[0].code;
    for (const scenario of [
      { mode: "automatic", scope: "system" },
      { mode: "manual_step", scope: "module" },
      { mode: "disabled", scope: "both" },
      { mode: "manual_step", scope: "both", customerApiEnabled: false },
    ]) {
      const project = await json("POST", "/api/projects", { name: `GPS reuse ${randomUUID()}`, wizardReuseOldGps: true,
        wizardGpsMode: scenario.mode, wizardGpsMaxAccuracyMetres: 1,
        ...(scenario.customerApiEnabled === undefined ? {} : { customerApiEnabled: false }) }, 201);
      owned.push(project.id);
      const root = `/api/projects/${project.id}`;
      assert.equal((await json("GET", root)).wizardReuseOldGps, true, "Both creation branches retain reuse");
      await json("PATCH", root, { wizardShowSignatureStep: false, wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false });
      assert.equal((await json("GET", root)).wizardReuseOldGps, true, "Unrelated edits retain reuse");
      const make = extra => json("POST", root + "/work-orders", { customerWoId: `REUSE-${randomUUID()}`,
        customerName: "Owned GPS reuse fixture", address: "Fixture only", serviceType, status: "Open",
        ...(scenario.scope !== "module" ? { oldSystemId: `OLD-${randomUUID()}`, newSystemId: `NEW-${randomUUID()}`,
          oldSystemReading: "1", newSystemReading: "2" } : {}),
        ...(scenario.scope !== "system" ? { oldModuleId: `MODULE-${randomUUID()}`, newModuleId: `NEW-MODULE-${randomUUID()}`,
          oldModuleRead: "1", newModuleRead: "2" } : {}),
        oldGps: "41.123456789, -81.123456789", newGps: "20,30", ...extra }, 201);
      const check = async id => {
        const row = await json("GET", `${root}/work-orders/${id}`);
        assert.equal(row.newGps ?? row.new_gps, "41.123456789, -81.123456789");
        assert.equal(row.gpsCapture.source, "reused_old");
        assert.equal(row.gpsCapture.accuracy, null); assert.equal(row.gpsCapture.capturedAt, null);
        return row;
      };
      const patchOrder = await make();
      await json("PATCH", `${root}/work-orders/${patchOrder.id}`, { status: "Completed" });
      await check(patchOrder.id);

      const mobileOrder = await make();
      await json("POST", `/api/mobile/projects/${project.id}/work-orders/${mobileOrder.id}/complete`, {
        isReadingOnly: true, changeoutScope: scenario.scope, newSystemReading: "3", newModuleReading: "4",
        gpsCoordinates: "invalid client position", gpsCapture: { source: "browser" },
      });
      await check(mobileOrder.id);

      const wizardOrder = await make();
      const form = { data: JSON.stringify({ canChange: true, isReadingOnly: true, changeoutScope: scenario.scope,
        oldSystemReading: "1", oldModuleReading: "1", newSystemReading: "3", newModuleReading: "4",
        gpsCoordinates: "invalid client position", gpsCapture: { source: "browser" } }) };
      const wizard = await api.post(`${root}/work-orders/${wizardOrder.id}/system-changeout`, { multipart: form });
      assert.equal(wizard.status(), 200, await wizard.text());
      await check(wizardOrder.id);
      const history = await json("GET", `${root}/work-order-history?workOrderId=${patchOrder.id}`);
      assert.ok(/reused_old|Reused from old equipment/.test(JSON.stringify(history)), "Reuse provenance is in printable history");

      if (scenario.mode === "automatic") {
        browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
        const context = await browser.newContext({ baseURL: config.baseURL, viewport: { width: 1280, height: 900 }, storageState: await api.storageState() });
        const page = await context.newPage();
        await page.goto(`/projects/${project.id}/edit`);
        await page.getByTestId("project-tab-work-orders").click();
        const toggle = page.getByTestId("switch-reuse-old-gps");
        await expect(toggle).toHaveAttribute("data-state", "checked");
        await toggle.click();
        await Promise.all([page.waitForResponse(r => r.url().endsWith(root) && r.request().method() === "PATCH"),
          page.getByRole("button", { name: "Update Project", exact: true }).click()]);
        assert.equal((await json("GET", root)).wizardReuseOldGps, false);
        const unapproved = await make();
        await json("PATCH", `${root}/work-orders/${unapproved.id}`, { status: "Completed",
          newGps: "41.123456789, -81.123456789", gpsCapture: {
            coordinates: "41.123456789, -81.123456789", source: "reused_old", accuracy: null, capturedAt: null, receiver: "unknown",
          } }, 400);
        await json("PATCH", root, { wizardReuseOldGps: true });
        await page.goto(`/projects/${project.id}/edit`);
        await page.getByTestId("project-tab-work-orders").click();
        await expect(toggle).toHaveAttribute("data-state", "checked");
        await toggle.scrollIntoViewIfNeeded();
        await page.screenshot({ path: "generated-artifacts/project-workspace/reuse-gps-project-setting.jpg" });
        await browser.close(); browser = undefined;
      }
      if (scenario.mode !== "disabled") {
        for (const oldGps of [null, "invalid"]) {
          const fallback = await make({ oldGps });
          await json("PATCH", `${root}/work-orders/${fallback.id}`, { status: "Completed" }, 400);
          await json("PATCH", `${root}/work-orders/${fallback.id}`, { status: "Completed", newGps: "42,-82",
            gpsCapture: { coordinates: "42,-82", source: "browser", receiver: "unknown", accuracy: 0.5,
              capturedAt: new Date().toISOString() } });
          assert.equal((await json("GET", `${root}/work-orders/${fallback.id}`)).gpsCapture.source, "browser");
        }
      }
      console.log(`Reuse GPS create/reload/settings/completion/history passed: ${scenario.mode}/${scenario.scope}`);
    }
    const defaultProject = await json("POST", "/api/projects", { name: `Default GPS ${randomUUID()}` }, 201);
    owned.push(defaultProject.id);
    assert.equal(defaultProject.wizardReuseOldGps, false);
  } finally {
    await browser?.close();
    for (const id of owned.reverse()) await json("DELETE", `/api/projects/${id}`, undefined, 204);
    await api.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
