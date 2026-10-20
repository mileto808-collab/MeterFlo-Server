// Real wizard + mocked APIs and native/browser location; no user data is changed.
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const { chromium, expect } = require("@playwright/test");
(async () => {
  const dist = "/tmp/meterflo-gps-ui";
  const { build } = await import("vite");
  await build({ configFile: path.resolve("vite.config.ts"), root: process.cwd(), logLevel: "warn",
    build: { outDir: dist, emptyOutDir: true, rollupOptions: { input: path.resolve("tests/support/gps-wizard-fixture.html") } } });
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, "http://fixture").pathname;
    const file = path.resolve(dist, "." + name);
    if (!file.startsWith(dist + path.sep) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.setHeader("Content-Type", file.endsWith(".js") ? "application/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const results = [];
  try {
    const scenarios = [
      { name: "native-desktop", native: true, width: 1280, height: 900 },
      { name: "browser-phone-portrait", width: 393, height: 850 },
      { name: "browser-phone-landscape", width: 850, height: 393 },
      { name: "browser-tablet-portrait", width: 768, height: 1024 },
      { name: "browser-tablet-landscape", width: 1024, height: 768 },
      { name: "manual-step", mode: "manual_step", width: 1280, height: 900 },
      { name: "disabled", mode: "disabled", width: 393, height: 850 },
      { name: "permission-denied", denied: true, saved: "40.1,-80.2", width: 393, height: 850 },
      { name: "required-coarse", accuracy: 80, limit: 10, width: 393, height: 850 },
      { name: "required-good", accuracy: 3, limit: 10, width: 1024, height: 768 },
      { name: "pending-submission", pending: true, width: 393, height: 850 },
      { name: "reuse-auto-phone", reuse: true, native: true, saved: "10,20", width: 393, height: 850 },
      { name: "reuse-manual-landscape", reuse: true, native: true, mode: "manual_step", limit: 1, width: 850, height: 393 },
      { name: "reuse-disabled", reuse: true, mode: "disabled", width: 1024, height: 768 },
      { name: "reuse-missing-fallback", reuse: true, old: "", width: 393, height: 850 },
      { name: "reuse-invalid-fallback", reuse: true, old: "invalid", width: 1280, height: 900 },
    ];
    for (const scenario of scenarios) {
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height } });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.addInitScript(s => {
        window.gpsCalls = { native: 0, browser: 0, cleared: 0 };
        const position = () => ({ coords: { latitude: 41.4412345678901, longitude: -81.7245123456789, accuracy: s.accuracy ?? 4 }, timestamp: Date.now() });
        Object.defineProperty(navigator, "geolocation", { value: {
          watchPosition(success, failure) {
            window.gpsCalls.browser++;
            window.lateGps = () => success(position());
            if (!s.pending) queueMicrotask(() => {
              if (s.denied) failure({ code: 1 });
              else { success(position()); if ((s.accuracy ?? 4) > 20) failure({ code: 3 }); }
            });
            return 9;
          },
          clearWatch() { window.gpsCalls.cleared++; },
        }, configurable: true });
        if (s.native) window.meterfloGps = { version: 1, origin: location.origin, capture: async request => {
          window.gpsCalls.native++;
          return { ...request, fix: { coordinates: "41.4412345678901, -81.7245123456789",
            source: "native", receiver: "external", accuracy: 2, capturedAt: new Date().toISOString() } };
        }, cancel() {} };
      }, scenario);
      await context.route("**/api/**", route => {
        const p = new URL(route.request().url()).pathname;
        const json = body => route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
        if (p === "/api/auth/user") return json({ id: "fixture", role: "admin", username: "Fixture" });
        if (p.includes("permissions")) return json([]);
        if (p === "/api/system-types") return json([{ id: 1, productId: "E460", model: "Test system", projectIds: [3], isActive: true }]);
        if (p === "/api/projects/3") return json({ id: 3, name: "GPS fixture", inventoryEnabled: false, changeoutEquipmentType: "system" });
        if (p.includes("search-settings")) return json({ systemIdEntryMethods: ["hid", "manual"], allowManualEntry: true });
        return json([]);
      });
      const params = new URLSearchParams({ mode: scenario.mode || "automatic" });
      if (scenario.limit) params.set("limit", scenario.limit);
      if (scenario.saved) params.set("saved", scenario.saved);
      if (scenario.reuse) params.set("reuse", "true");
      if (scenario.old !== undefined) params.set("old", scenario.old);
      const reusing = scenario.reuse && scenario.old === undefined;
      await page.goto(`http://127.0.0.1:${server.address().port}/tests/support/gps-wizard-fixture.html?${params}`);
      const next = page.getByTestId("button-wizard-next");
      await page.getByTestId("button-system-can-change").click();
      await page.getByTestId("input-old-system-reading").fill("123.4567");
      await expect(page.getByText("GPS Captured", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "GPS location review" })).toHaveCount(0);
      await next.click();
      await expect(page.getByText("Perform Physical Changeout", { exact: true })).toBeVisible();
      await next.click();
      await page.getByTestId("button-hid-id").click();
      await page.getByTestId("input-hid-system-id").pressSequentially("NEW-SYSTEM", { delay: 2 });
      await page.getByTestId("button-confirm-hid-id").click();
      await next.click();
      await page.getByTestId("input-new-system-reading").fill("0.0039");
      await next.click();
      if (scenario.mode === "manual_step" && !reusing) {
        assert.equal((await page.evaluate(() => window.gpsCalls)).browser, 0);
        await page.getByTestId("input-gps-coordinates-capture").click();
        await expect(page.getByTestId("input-gps-coordinates")).toHaveValue("41.4412345678901, -81.7245123456789");
        await next.click();
      }
      const review = page.getByRole("region", { name: "GPS location review" });
      const submit = page.getByTestId("button-wizard-submit");
      if (reusing) {
        await expect(review).toContainText("Reused from old equipment");
        await expect(review).toContainText("40, -80");
        const calls = await page.evaluate(() => window.gpsCalls);
        assert.equal(calls.native, 0); assert.equal(calls.browser, 0);
        await expect(review.getByRole("button")).toHaveCount(0);
        fs.mkdirSync("generated-artifacts/gps", { recursive: true });
        await page.screenshot({ path: `generated-artifacts/gps/${scenario.name}.jpg` });
      } else if (scenario.mode === "disabled") {
        await expect(review).toHaveCount(0);
        assert.equal((await page.evaluate(() => window.gpsCalls)).browser, 0);
      } else {
        await expect(review).toBeVisible();
        if (!scenario.denied && !scenario.pending) {
          await expect(review).toContainText(scenario.native ? "External GNSS receiver" : "Browser location");
          await expect(review).toContainText("America/New_York");
          await expect(review).toContainText("41.4412345678901");
        }
        if (scenario.denied) {
          await expect(review).toContainText("Location unavailable");
          await expect(review).toContainText("Saved coordinates");
        }
        if (scenario.pending) await expect(review).toContainText("Capturing location");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      if (scenario.limit && scenario.accuracy > scenario.limit) {
        await expect(submit).toBeDisabled();
        await expect(review).toContainText("requires");
      } else {
        await expect(submit).toBeEnabled();
        if (scenario.name === "browser-phone-portrait") {
          fs.mkdirSync("generated-artifacts/gps", { recursive: true });
          await page.screenshot({ path: "generated-artifacts/gps/review-phone.jpg", fullPage: true });
        }
        await submit.click();
        const submitted = await page.evaluate(() => window.submissions);
        assert.equal(submitted.length, 1);
        if (reusing) {
          assert.equal(submitted[0].gpsCapture.source, "reused_old");
          assert.equal(submitted[0].gpsCoordinates, "40, -80");
          assert.equal(submitted[0].gpsCapture.accuracy, null);
          assert.equal(submitted[0].gpsCapture.capturedAt, null);
        } else if (!scenario.denied && !scenario.pending && scenario.mode !== "disabled")
          assert.equal(submitted[0].gpsCapture.source, scenario.native ? "native" : "browser");
        if (scenario.pending) {
          assert.equal(submitted[0].gpsCoordinates, "");
          await page.evaluate(() => window.lateGps());
          assert.equal((await page.evaluate(() => window.submissions))[0].gpsCoordinates, "");
          assert.ok((await page.evaluate(() => window.gpsCalls)).cleared > 0);
        }
      }
      assert.deepEqual(errors, []);
      if (scenario.native) assert.equal((await page.evaluate(() => window.gpsCalls)).browser, 0);
      results.push(scenario.name); await context.close();
    }
    console.log("GPS wizard scenarios passed:", results.join(", "));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
