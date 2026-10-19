// Run with: node --import tsx tests/inventory-receipt-identifiers-ui.cjs <Vite build directory>
// All API requests are mocked. This never changes real inventory or work orders.
const fs = require("node:fs"), path = require("node:path"), http = require("node:http");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");
const { receiptIdentifierFixture } = require("./support/inventory-receipt-identifiers-fixture.ts");
const { activityBatchFixture } = require("./support/inventory-activity-groups-fixture.ts");
const { inventoryActivityGroups } = require("../shared/inventory-activity-groups.ts");
const { inventoryActivityPrint } = require("../server/inventoryActivityPrint.ts");
const { execFileSync } = require("node:child_process");
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
    for (const scenario of [
      { name: "single", fixture: receiptIdentifierFixture, groups: 3, transactions: 3 },
      { name: "batch-scan", fixture: () => activityBatchFixture("scan"), groups: 2, transactions: 5 },
      { name: "batch-visual", fixture: () => activityBatchFixture("visual"), groups: 2, transactions: 5 },
    ]) for (const viewport of [{ width: 1280, height: 850 }, { width: 393, height: 850 }]) {
      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${server.address().port}`, viewport });
      const page = await context.newPage(), errors = [], writes = [];
      page.on("pageerror", error => errors.push(error.message));
      const { state, labels, identifiers } = scenario.fixture();
      await context.addInitScript(() => sessionStorage.setItem("meterflo:inventory-tab:fixture:3", "activity"));
      await context.route("**/api/**", route => {
        const url = new URL(route.request().url()), p = url.pathname;
        if (route.request().method() !== "GET") writes.push(p);
        const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
        if (p === "/api/auth/user") return json({ id: "fixture", role: "admin", username: "Fixture" });
        if (p === "/api/access-locks/status") return json({ site: { locked: false },
          project: url.searchParams.has("projectId") ? { projectId: Number(url.searchParams.get("projectId")) } : null, blocked: null });
        if (p === "/api/users/fixture/permissions") return json([]);
        if (p === "/api/security/http-login-recovery") return json({ enabled: false });
        const project = { id: 3, name: "Inventory identifier fixture", isActive: true, inventoryEnabled: true, timezone: "America/New_York" };
        if (p === "/api/projects") return json([project]);
        if (p === "/api/projects/3") return json(project);
        if (p === "/api/projects/3/inventory") return json({ enabled: true, projectName: project.name, timezone: project.timezone,
          state, permissions: ["inventory.view"], users: [{ id: "fixture", username: "Fixture" }],
          actors: [{ id: "fixture", username: "Fixture" }], workOrderLabels: labels, workOrderIdentifiers: identifiers });
        if (p.startsWith("/api/projects/3/inventory/print/activity/")) {
          const id = decodeURIComponent(p.split("/").at(-1));
          const group = inventoryActivityGroups(state, labels).find(value => value.receipts.some(receipt => receipt.id === id));
          if (!group) return json({ message: "Not found" }, 404);
          return route.fulfill({ contentType: "text/html", body: inventoryActivityPrint(group, state, project.name,
            [{ id: "fixture", username: "Fixture" }], project.timezone, labels) });
        }
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
      await expect(dialog.getByText(`1 matching activity of ${scenario.groups}`, { exact: true })).toBeVisible();
      await dialog.getByLabel("System / module ID", { exact: true }).fill("NEW-MODULE");
      await expect(dialog.getByText(`1 matching activity of ${scenario.groups}`, { exact: true })).toBeVisible();
      await dialog.getByLabel("System work-order ID", { exact: true }).fill("196");
      // A batch receipt can legitimately reference multiple work orders.
      await expect(dialog.getByText(`${scenario.name === "single" ? 0 : 1} matching activity of ${scenario.groups}`, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Clear filters", exact: true }).click();
      await expect(dialog.getByLabel("Customer work-order ID", { exact: true })).toHaveValue("");
      await expect(dialog.getByText(`${scenario.groups} matching activity of ${scenario.groups}`, { exact: true })).toBeVisible();
      await dialog.getByLabel("System work-order ID", { exact: true }).fill("195");
      await dialog.getByRole("button", { name: "Show 1 activity", exact: true }).click();
      await expect(dialog).toBeHidden();
      const group = page.getByTestId("inventory-activity-group");
      await expect(group).toHaveCount(1);
      await expect(group.getByTestId("inventory-activity-title")).toContainText(scenario.name === "single" ? "Work order 0002048" : "Customer return batch");
      await group.locator("summary").click();
      await expect(group.getByTestId("inventory-activity-transaction")).toHaveCount(scenario.transactions);
      await expect(group).toContainText("Work order 0002048");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-testid="inventory-activity-group"],[data-testid="inventory-activity-transaction"]')]
        .filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.getAttribute("data-testid"))), []);
      fs.mkdirSync("generated-artifacts/inventory-identifiers", { recursive: true });
      await page.screenshot({ path: `generated-artifacts/inventory-identifiers/activity-${scenario.name}-${viewport.width}.png` });
      const [popup] = await Promise.all([context.waitForEvent("page"), group.getByRole("button", { name: "Print history", exact: true }).click()]);
      await expect(popup.getByRole("heading", { name: "Activity history", exact: true })).toBeVisible();
      await expect(popup.locator("[data-receipt-id]")).toHaveCount(scenario.transactions);
      if (viewport.width === 1280) {
        const pdf = `generated-artifacts/inventory-identifiers/history-${scenario.name}.pdf`;
        await popup.pdf({ path: pdf, format: "Letter", printBackground: true });
        const info = execFileSync("pdfinfo", [pdf], { encoding: "utf8" });
        assert.ok(Number(/^Pages:\s+(\d+)/m.exec(info)?.[1]) >= scenario.transactions + 1);
        const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
        assert.ok(text.includes("0002048"));
        if (scenario.name !== "single") {
          await expect(popup.getByRole("heading", { name: "Customer return serials", exact: true })).toBeVisible();
          assert.ok(text.split("\f").some(sheet => sheet.includes("Customer return serials") && sheet.includes("OLD001") && sheet.includes("OLD002")));
        }
      }
      await popup.close();
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, []);
      console.log(`PASS ${scenario.name} ${viewport.width}px: grouped filters, expanded history, full print/PDF, no writes or clipped content`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
