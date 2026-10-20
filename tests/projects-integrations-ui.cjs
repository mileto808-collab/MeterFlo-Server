// Built-app contract tests: all API traffic is mocked, with no real data writes.
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const assert = require("node:assert/strict");
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
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const mode of ["admin", "logs-only", "editor"]) {
      const delegated = mode === "logs-only", editor = mode === "editor";
      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${server.address().port}` });
      const page = await context.newPage(), errors = [], writes = [], logRequests = [];
      page.on("pageerror", error => errors.push(error.stack));
      const project = { id: 3, name: "Electric Demo", description: "Electric changeout", customerEmail: "fixture@example.invalid",
        databaseName: "project_fixture_3", isActive: true, timezone: "America/New_York", inventoryEnabled: false,
        changeoutEquipmentType: "system", createdAt: "2026-01-21T12:00:00.000Z", updatedAt: "2026-01-21T12:00:00.000Z" };
      let settings = { customerApiEnabled: false, customerApiUrl: "", customerApiAuthType: "none",
        customerApiKeyHeader: "", customerApiSecretEnvVar: "", customerApiSendPhotos: false };
      await context.route("**/api/**", async route => {
        const url = new URL(route.request().url()), p = url.pathname, method = route.request().method();
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (method !== "GET") writes.push({ p, method });
        if (p === "/api/auth/user") return json({ id: "fixture", username: "fixture", role: delegated || editor ? "user" : "admin" });
        if (p === "/api/access-locks/status") return json({ site: { locked: false },
          project: url.searchParams.has("projectId") ? { projectId: Number(url.searchParams.get("projectId")) } : null, blocked: null });
        if (p === "/api/users/fixture/permissions") return json(delegated ? ["settings.customerApiLogs"] : editor ? ["nav.projects", "projects.edit"] : []);
        if (p === "/api/settings/timezone") return json({ timezone: "UTC", isEnabled: true });
        if (p === "/api/projects") return json([project]);
        if (p === "/api/projects/3") return json(project);
        if (p === "/api/projects/3/customer-api") {
          if (method === "PUT") settings = JSON.parse(route.request().postData());
          return json({ settings, credentialStatus: "not_required", canEdit: !delegated });
        }
        if (p === "/api/customer-api-deliveries" || p === "/api/customer-api-logs") {
          assert.equal(url.searchParams.get("projectId"), "3", "Every logs request must be scoped to the open project");
          logRequests.push(p);
          if (p.endsWith("deliveries")) return json({ deliveries: [{
            id: "fixture-delivery", projectName: project.name, workOrderId: 195, customerWoId: "CUSTOMER-2048",
            status: "failed", attemptCount: 1, lastError: "Fixture delivery failure", createdAt: "2026-10-19T03:30:00Z",
          }], total: 1 });
          const rows = [
            { id: 501, projectId: 3, workOrderId: 195, success: false, responseStatus: 503, requestUrl: "https://customer.example.invalid/orders",
              errorMessage: "Fixture attempt failure", requestPayload: '{"workOrder":"CUSTOMER-2048"}', responseBody: '{"accepted":false}', createdAt: "2026-10-19T03:30:00Z" },
            { id: 502, projectId: 3, workOrderId: 196, success: true, responseStatus: 200, createdAt: "2026-10-19T03:31:00Z" },
          ];
          return json(rows.filter(row => !url.searchParams.has("success") || row.success === (url.searchParams.get("success") === "true")));
        }
        if (p === "/api/customer-api-deliveries/fixture-delivery/attempts") return json([]);
        if (p === "/api/customer-api-deliveries/fixture-delivery/retry") {
          assert.equal(mode, "admin", "Only administrators get the retry action");
          return json({ success: true });
        }
        if (/\/api-import\/(configs|runs)$/.test(p)) return json([]);
        if (["/api/system-types", "/api/module-types", "/api/service-types", "/api/users", "/api/user-groups",
          "/api/projects/3/users", "/api/projects/3/holidays", "/api/projects/3/service-types",
          "/api/projects/3/work-order-sub-statuses", "/api/projects/3/trouble-codes"].includes(p)) return json([]);
        return json({ message: "Unrelated fixture service unavailable" }, 503);
      });
      if (editor) {
        await page.goto("/projects/3/edit?section=integrations&direction=logs");
        await expect(page.getByRole("tab", { name: "Push delivery", exact: true })).toBeVisible();
        await expect(page.getByRole("tab", { name: "Customer API Logs", exact: true })).toHaveCount(0);
        assert.equal(logRequests.length, 0);
        await context.close();
        console.log("PASS: project editor without logs permission cannot see or fetch logs");
        continue;
      }
      if (!delegated) {
        await page.goto("/projects");
        const row = page.getByTestId("row-project-3");
        await expect(row).toBeVisible();
        fs.mkdirSync("generated-artifacts/projects-ui", { recursive: true });
        await page.screenshot({ path: "generated-artifacts/projects-ui/desktop.png" });
        await row.click({ position: { x: 12, y: 10 } });
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await expect(page.getByTestId("input-name")).toHaveValue("Electric Demo");
        await page.goto("/projects");
        await row.focus(); await page.keyboard.press("Enter");
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await page.goto("/projects");
        await row.focus(); await page.keyboard.press("Space");
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await page.goto("/projects");
        await page.getByTestId("button-delete-3").click();
        await expect(page).toHaveURL(/\/projects$/);
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await page.getByRole("button", { name: "Cancel", exact: true }).click();
        await page.getByTestId("button-edit-3").click();
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await page.getByTestId("input-name").fill("Unsaved project name");
        await page.getByTestId("project-tab-integrations").click();
      } else await page.goto("/projects/3/edit?section=integrations");
      await expect(page.getByRole("heading", { name: "Customer API", exact: true })).toBeVisible();
      assert.equal(logRequests.length, 0, "Opening push settings does not fetch logs");
      await expect(page.getByTestId("nav-project-3-customer-api")).toHaveCount(0);
      assert.equal(await page.locator("#project-panel-integrations").evaluate(node => !!node.closest("form")), false);
      if (delegated) {
        await expect(page.getByTestId("nav-project-3-settings")).toBeVisible();
        await expect(page.getByTestId("button-save-push")).toHaveCount(0);
        await expect(page.getByRole("tab", { name: "Pull import", exact: true })).toHaveCount(0);
        await expect(page.getByTestId("project-tab-details")).toHaveCount(0);
      } else {
        await page.getByTestId("input-customer-api-url").fill("https://customer.example.invalid/orders");
        await page.getByTestId("button-save-push").click();
        await expect.poll(() => writes.filter(w => w.p.endsWith("/customer-api")).length).toBe(1);
        await expect(page.getByText("Push delivery settings saved", { exact: true })).toBeVisible();
        await page.getByTestId("input-customer-api-url").fill("https://unsaved.example.invalid/orders");
        await page.screenshot({ path: "generated-artifacts/projects-ui/integrations.png" });
      }
      await page.getByRole("tab", { name: "Customer API Logs", exact: true }).click();
      await expect(page.getByTestId("project-customer-api-logs")).toBeVisible();
      await expect(page.getByTestId("row-api-log-501")).toBeVisible();
      await expect(page.getByRole("combobox", { name: "Delivery project" })).toHaveCount(0);
      await expect(page.getByTestId("select-api-log-project-filter")).toHaveCount(0);
      await expect(page.getByTestId("row-api-log-501")).toContainText("10/18/2026");
      await page.getByTestId("row-api-log-501").click();
      await expect(page.getByText("Fixture attempt failure", { exact: true })).toBeVisible();
      await page.getByTestId("select-api-log-status-filter").click();
      await page.getByRole("option", { name: "Failed", exact: true }).click();
      await expect(page.getByTestId("row-api-log-502")).toHaveCount(0);
      const retry = page.getByTestId("button-retry-delivery-fixture-delivery");
      if (delegated) await expect(retry).toHaveCount(0);
      else {
        await retry.click();
        await expect.poll(() => writes.filter(w => w.p.endsWith("/retry")).length).toBe(1);
        await page.getByRole("tab", { name: "Push delivery", exact: true }).click();
        await expect(page.getByTestId("input-customer-api-url")).toHaveValue("https://unsaved.example.invalid/orders");
        await page.getByRole("tab", { name: "Pull import", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Customer API pull" })).toBeVisible();
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await page.getByTestId("project-tab-details").click();
        await expect(page.getByTestId("input-name")).toHaveValue("Unsaved project name");
        assert.equal(writes.filter(w => w.p === "/api/projects/3").length, 0);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto("/projects");
        await expect(page.getByTestId("row-project-3")).toBeVisible();
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        fs.mkdirSync("generated-artifacts/projects-ui", { recursive: true });
        await page.screenshot({ path: "generated-artifacts/projects-ui/phone.png" });
        await page.getByTestId("row-project-3").click({ position: { x: 12, y: 10 } });
        await expect(page).toHaveURL(/\/projects\/3\/edit$/);
        await expect(page.getByTestId("input-name")).toHaveValue("Electric Demo");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/projects/3/edit?section=integrations&direction=logs");
      await expect(page.getByTestId("row-api-log-501")).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByTestId("row-api-log-501").scrollIntoViewIfNeeded();
      await expect(page.getByTestId("row-api-log-501")).toBeInViewport();
      assert.equal(await page.getByTestId("project-customer-api-logs").evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      fs.mkdirSync("generated-artifacts/projects-ui", { recursive: true });
      await page.screenshot({ path: `generated-artifacts/projects-ui/api-logs-${mode}-phone.png` });
      await page.setViewportSize({ width: 844, height: 390 });
      await expect(page.getByTestId("project-customer-api-logs")).toBeVisible();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.screenshot({ path: `generated-artifacts/projects-ui/api-logs-${mode}-desktop.png` });
      await page.goto("/settings?section=contact-support");
      await expect(page.getByTestId("settings-section-customer-api-logs")).toHaveCount(0);
      await expect(page.getByRole("tab", { name: "Customer API Logs", exact: true })).toHaveCount(0);
      assert.deepEqual(errors, []);
      console.log(`PASS: ${delegated ? "delegated logs-only integrations access" : "clickable rows, isolated actions, embedded push/pull, independent saves, retained project draft, phone width"}`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
