// Built-app UI contract checks with all API traffic mocked. Never restores a
// real database, creates a user, or changes authentication in application code.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium, expect } = require("@playwright/test");
const dist = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(dist, "index.html"))) throw Error("Pass an isolated Vite build directory");
const mime = { ".js": "application/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((req, res) => {
  let file = path.resolve(dist, "." + new URL(req.url, "http://fixture").pathname);
  if (!file.startsWith(dist + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  res.setHeader("Content-Type", mime[path.extname(file)] || "application/octet-stream");
  fs.createReadStream(file).pipe(res);
});
(async () => {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const baseURL = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const mode of ["direct", "chunked", "many-warnings", "no-warnings", "incomplete", "lost", "server-error", "expired", "access-retry"]) {
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();
      let logout = false, restoring = false, calls = 0, release, accessUnavailable = true;
      const waiting = new Promise(resolve => { release = resolve; });
      const errors = [];
      const warnings = mode === "no-warnings" ? [] : [
        'NOTICE: schema "fixture" already exists, skipping',
        'WARNING: <script>window.restoreWarningExecuted=true</script>',
        ...(mode === "many-warnings" ? Array.from({ length: 40 }, (_, i) => `NOTICE ${i}: ${"long_identifier_".repeat(30)}`) : []),
      ];
      page.on("pageerror", error => errors.push(error.stack || error.message));
      await context.route("**/api/**", async route => {
        const url = new URL(route.request().url()), p = url.pathname;
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (p === "/api/auth/user") return logout ? json({ message: "Unauthorized" }, 401) : json({ id: "restore-fixture", role: "admin", username: "fixture", firstName: "Fixture", lastName: "Admin" });
        if (p === "/api/logout") { logout = true; return json({}); }
        if (p === "/api/customer-api-deliveries") return json({ deliveries: [], total: 0 });
        if (p === "/api/access-locks/status") {
          if (mode === "access-retry" && accessUnavailable) return json({ message: "Temporarily unavailable" }, 500);
          return (restoring || mode === "expired") ? json({ message: "Unauthorized" }, 401) : json({ site: { locked: false }, project: null, blocked: null });
        }
        if (p === "/api/system/restore/init") return json({ uploadId: "fixture-upload" });
        if (p === "/api/system/restore/chunk") return json({ success: true });
        if (p === "/api/system/restore" || p === "/api/system/restore/finalize") {
          restoring = true; calls++;
          await waiting;
          if (mode === "lost") return route.abort("failed");
          if (mode === "server-error") return json({ message: "SQL restore failed" }, 500);
          return json({ success: mode !== "incomplete", databaseCommitted: true, format: "pg_dump_sql",
            schemas: ["public"], filesRestored: 2, warnings, errors: mode === "incomplete" ? ["Fixture file failed"] : [] });
        }
        if (["/api/projects", "/api/maintenance/projects", "/api/users/restore-fixture/permissions"].includes(p)) return json([]);
        // Unrelated Settings widgets have different response contracts. Leave
        // them explicitly unavailable instead of inventing malformed payloads.
        return json({ message: "Unrelated service unavailable in this UI fixture" }, 503);
      });
      await page.goto("/settings?section=backup-restore");
      if (mode === "expired") {
        await expect(page.getByRole("heading", { name: "Sign in required" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
        logout = true;
        await page.getByRole("button", { name: "Sign in again", exact: true }).click();
        await expect(page).toHaveURL(/\/login$/);
      } else if (mode === "access-retry") {
        await expect(page.getByRole("heading", { name: "Access status unavailable" })).toBeVisible();
        accessUnavailable = false;
        await page.getByRole("button", { name: "Retry", exact: true }).click();
        await page.getByRole("tab", { name: "Manual system", exact: true }).click();
        await expect(page.getByTestId("button-full-system-restore")).toBeVisible();
        assert.equal(calls, 0);
      } else {
        await page.getByRole("tab", { name: "Manual system", exact: true }).click();
        await page.getByTestId("button-full-system-restore").click({ timeout: 12_000 }).catch(async error => {
          console.error("Fixture page:", await page.locator("body").innerText(), "Browser errors:", errors);
          throw error;
        });
        await page.getByTestId("input-system-restore-file").setInputFiles({
          name: "fixture.zip", mimeType: "application/zip",
          buffer: Buffer.alloc(mode === "chunked" ? 6 * 1024 * 1024 : 32),
        });
        await expect(page.getByTestId("system-restore-screen")).toBeVisible();
        await expect.poll(() => calls).toBe(1);
        await expect(page.getByRole("heading", { name: "Restore in progress" })).toBeVisible();
        await expect(page.getByRole("button", { name: /Log out|Retry|Sign in again/ })).toHaveCount(0);
        assert.equal(await page.evaluate(() => {
          const event = new Event("beforeunload", { cancelable: true });
          window.dispatchEvent(event);
          return event.defaultPrevented;
        }), true, "Leaving an active restore warns before navigation");
        await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
        release();
        const title = mode === "incomplete" ? "Restore incomplete" : ["lost", "server-error"].includes(mode)
          ? "Restore completion not confirmed" : "Restore completed";
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        if (!["lost", "server-error"].includes(mode)) {
          if (warnings.length) {
            await expect(page.getByRole("heading", { name: `Restore warnings (${warnings.length})`, exact: true })).toBeVisible();
            const list = page.getByRole("list", { name: `${warnings.length} restore warnings` });
            await expect(list.locator("li")).toHaveText(warnings);
            assert.equal(await page.evaluate(() => window.restoreWarningExecuted), undefined);
            assert.equal(await page.evaluate(() => sessionStorage.getItem("meterflo:system-restore")), "1");
          } else {
            await expect(page.getByRole("heading", { name: /Restore warnings/ })).toHaveCount(0);
          }
        }
        if (mode === "lost") {
          await page.reload();
          await expect(page.getByRole("heading", { name: "Restore completion not confirmed" })).toBeVisible();
          assert.equal(calls, 1, "Reload must not replay a restore");
        }
        if (mode === "direct" || mode === "many-warnings") {
          for (const width of [1280, 390]) {
            await page.setViewportSize({ width, height: 844 });
            await expect(page.getByTestId("restore-sign-in")).toBeInViewport();
            assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
            fs.mkdirSync("generated-artifacts/restore-ui", { recursive: true });
            await page.screenshot({ path: `generated-artifacts/restore-ui/${mode}-${width}.png` });
          }
        }
        await page.getByTestId("restore-sign-in").click();
        await expect(page).toHaveURL(/\/login$/);
        await expect(page.getByTestId("system-restore-screen")).toHaveCount(0);
        assert.equal(await page.evaluate(() => sessionStorage.getItem("meterflo:system-restore")), null);
        assert.equal(calls, 1);
      }
      assert.deepEqual(errors, [], `${mode}: no uncaught browser errors`);
      console.log(`PASS: ${mode}`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
