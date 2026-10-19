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
    for (const delegated of [false, true]) {
      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${server.address().port}` });
      const page = await context.newPage(), errors = [], writes = [];
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
        if (p === "/api/auth/user") return json({ id: "fixture", username: "fixture", role: delegated ? "user" : "admin" });
        if (p === "/api/access-locks/status") return json({ site: { locked: false },
          project: url.searchParams.has("projectId") ? { projectId: Number(url.searchParams.get("projectId")) } : null, blocked: null });
        if (p === "/api/users/fixture/permissions") return json(delegated ? ["settings.customerApiLogs"] : []);
        if (p === "/api/projects") return json([project]);
        if (p === "/api/projects/3") return json(project);
        if (p === "/api/projects/3/customer-api") {
          if (method === "PUT") settings = JSON.parse(route.request().postData());
          return json({ settings, credentialStatus: "not_required", canEdit: !delegated });
        }
        if (p === "/api/customer-api-deliveries") return json({ deliveries: [], total: 0 });
        if (/\/api-import\/(configs|runs)$/.test(p)) return json([]);
        if (["/api/system-types", "/api/module-types", "/api/service-types", "/api/users", "/api/user-groups",
          "/api/projects/3/users", "/api/projects/3/holidays", "/api/projects/3/service-types",
          "/api/projects/3/work-order-sub-statuses", "/api/projects/3/trouble-codes"].includes(p)) return json([]);
        return json({ message: "Unrelated fixture service unavailable" }, 503);
      });
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
        await page.screenshot({ path: "generated-artifacts/projects-ui/integrations.png" });
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
      assert.deepEqual(errors, []);
      console.log(`PASS: ${delegated ? "delegated logs-only integrations access" : "clickable rows, isolated actions, embedded push/pull, independent saves, retained project draft, phone width"}`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
