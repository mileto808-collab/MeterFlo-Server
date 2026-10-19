// Run with: node --import tsx tests/inventory-receipt-identifiers-ui.cjs <Vite build directory>
// All API requests are mocked. This never changes real inventory or work orders.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const { receiptIdentifierFixture } = require("./support/inventory-receipt-identifiers-fixture.ts");
const dist = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(path.join(dist, "index.html"))) throw Error("Pass an isolated Vite build");
const mime = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml" };
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
    for (const viewport of [{ width: 1280, height: 850 }, { width: 393, height: 850 }]) {
      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${server.address().port}`, viewport });
      const page = await context.newPage(), errors = [], writes = [];
      page.on("pageerror", error => errors.push(error.message));
      const { state, labels, identifiers } = receiptIdentifierFixture();
      await context.addInitScript(() => sessionStorage.setItem("meterflo:inventory-tab:fixture:3", "activity"));
      await context.route("**/api/**", route => {
        const url = new URL(route.request().url()), p = url.pathname;
        if (route.request().method() !== "GET") writes.push(p);
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (p === "/api/auth/user") return json({ id: "fixture", role: "admin", username: "Fixture" });
        if (p === "/api/access-locks/status") return json({ site: { locked: false },
          project: url.searchParams.has("projectId") ? { projectId: Number(url.searchParams.get("projectId")) } : null, blocked: null });
        if (p === "/api/users/fixture/permissions") return json([]);
        const project = { id: 3, name: "Inventory identifier fixture", isActive: true, inventoryEnabled: true, timezone: "America/New_York" };
        if (p === "/api/projects") return json([project]);
        if (p === "/api/projects/3") return json(project);
        if (p === "/api/projects/3/inventory") return json({ enabled: true, projectName: project.name, timezone: project.timezone,
          state, permissions: ["inventory.view"], users: [{ id: "fixture", username: "Fixture" }],
          actors: [{ id: "fixture", username: "Fixture" }], workOrderLabels: labels, workOrderIdentifiers: identifiers });
        return json({ message: "Unrelated fixture service unavailable" }, 503);
      });
      await page.goto("/projects/3/inventory");
      await expect(page.getByTestId("inventory-activity-entries")).toBeVisible();
      const tools = page.getByTestId("inventory-mobile-tools-activity-toggle");
      if (await tools.getAttribute("aria-expanded") === "false") await tools.click();
      await page.getByRole("button", { name: "Filter activity", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByLabel("System work-order ID", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("Customer work-order ID", { exact: true })).toBeVisible();
      await expect(dialog.getByLabel("System / module ID", { exact: true })).toBeVisible();
      await dialog.getByLabel("Customer work-order ID", { exact: true }).fill("0002048");
      await expect(dialog.getByText("3 matching activity of 5", { exact: true })).toBeVisible();
      await dialog.getByLabel("System / module ID", { exact: true }).fill("NEW-MODULE");
      await expect(dialog.getByText("3 matching activity of 5", { exact: true })).toBeVisible();
      await dialog.getByLabel("System work-order ID", { exact: true }).fill("196");
      await expect(dialog.getByText("0 matching activity of 5", { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(dialog.getByLabel("Customer work-order ID", { exact: true })).toHaveValue("");
      await expect(dialog.getByText("5 matching activity of 5", { exact: true })).toBeVisible();
      await dialog.getByLabel("System work-order ID", { exact: true }).fill("195");
      await dialog.getByRole("button", { name: "Show 3 activity", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByTestId("inventory-activity-title").first()).toContainText("Work order 0002048");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      fs.mkdirSync("generated-artifacts/inventory-identifiers", { recursive: true });
      await page.screenshot({ path: `generated-artifacts/inventory-identifiers/activity-${viewport.width}.png` });
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      console.log(`PASS ${viewport.width}px: actual Inventory page identifier filters, combined search, clear, labels, no writes or page overflow`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
