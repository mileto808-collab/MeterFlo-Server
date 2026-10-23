const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { execFileSync } = require("node:child_process");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  for (const helper of ["vehicle-return-ui-fixture", "vehicle-return-timezone-fixture"]) {
    execFileSync(process.execPath, ["--import", "tsx", `tests/support/${helper}.ts`], { stdio: "inherit" });
  }
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const root = `/api/projects/${fixture.projectId}`, prefix = `${root}/inventory/vehicle-return-workflows`;
  const snapshots = new Map();
  try {
    for (const timezoneId of ["Asia/Tokyo", "Pacific/Honolulu"]) {
      const context = await browser.newContext({ baseURL, timezoneId });
      const api = async (method, url, data) => {
        const response = await context.request.fetch(url, { method, data });
        assert.ok(response.ok(), `${method} ${url}: ${response.status()}`);
        return response.json();
      };
      await api("POST", "/api/auth/local/login", fixture);
      await api("PATCH", root, { timezone: "America/New_York" });
      for (const isEnabled of [true, false]) {
        await api("PUT", "/api/settings/timezone", { timezone: "America/Denver", isEnabled });
        for (const kind of ["equipment", "stock", "count"]) {
          const data = await api("GET", `${prefix}?kind=${kind}`);
          assert.equal(data.timezone, "America/New_York", "Project timezone wins over browser and site settings");
          assert.equal(data.drafts.length, 4);
          if (!snapshots.has(kind)) snapshots.set(kind, data.drafts);
          else assert.deepEqual(data.drafts, snapshots.get(kind), "Timezone display never rewrites UTC timestamps or draft identities");
        }
      }
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      await page.getByTestId("button-start-inventory-desktop").click();
      for (const [kind, screen] of [["equipment", "return-equipment"], ["stock", "return-stock"], ["count", "vehicle-count"]]) {
        await page.getByTestId(`inventory-task-${screen}`).click();
        const body = page.getByTestId("vehicle-return-content");
        for (const label of [
          "Mar 8, 2026, 1:59:59 AM EST", "Mar 8, 2026, 3:00:00 AM EDT",
          "Nov 1, 2026, 1:30:00 AM EDT", "Nov 1, 2026, 1:30:00 AM EST",
        ]) await expect(body.getByText(label, { exact: false })).toBeVisible();
        assert.deepEqual((await api("GET", `${prefix}?kind=${kind}`)).drafts, snapshots.get(kind));
        await page.getByRole("button", { name: "Back to tasks", exact: true }).click();
      }
      assert.deepEqual(errors, []);
      // An unset project timezone follows the existing UTC contract, not site/browser time.
      await api("PATCH", root, { timezone: null });
      assert.equal((await api("GET", `${prefix}?kind=stock`)).timezone, "UTC");
      await context.close();
    }
    console.log("PASS: all vehicle-return draft lists use project timezone across DST boundaries; UTC evidence and identities unchanged.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
