// Navigation-only verification against an owned disposable instance. This test
// never runs backup/restore, retention cleanup or operational-log deletion.
if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Use the owned workspace sandbox.");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const errors = [], mutations = [];
  const output = "generated-artifacts/settings-admin-tools";
  const login = async (context, credentials) => {
    assert.equal((await context.request.post("/api/auth/local/login", { data: credentials })).status(), 200);
  };
  const choose = async (page, group, section, label) => {
    if (await page.getByTestId("settings-mobile-menu").isVisible()) {
      await page.getByTestId("settings-mobile-menu").click();
      await page.getByRole("option", { name: label, exact: true }).click();
    } else {
      await page.getByTestId(`settings-tab-${group}`).click();
      await page.getByTestId(`settings-section-nav-${section}`).click();
    }
    await expect(page.locator(`[data-settings-section="${section}"]`)).toBeVisible();
    await expect(page.locator("[data-settings-section]:visible")).toHaveCount(1);
  };
  const grant = async permissions => {
    assert.equal((await admin.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions },
    })).status(), 200);
  };
  try {
    await login(admin, fixture);
    await fs.mkdir(output, { recursive: true });
    const page = await admin.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => {
      if (!["GET", "HEAD"].includes(request.method()) &&
          /\/api\/(?:maintenance|audit|system|settings)(?:\/|\?)/.test(request.url()))
        mutations.push(`${request.method()} ${new URL(request.url()).pathname}`);
    });
    await page.goto("/maintenance");
    await expect(page).toHaveURL(/\/settings\?section=backup-restore/);
    await expect(page.getByTestId("nav-maintenance")).toHaveCount(0);
    await expect(page.getByTestId("nav-audit-logs")).toHaveCount(0);
    await expect(page.getByTestId("nav-settings")).toBeVisible();
    await expect(page.getByTestId("button-full-system-backup")).toBeVisible();
    await expect(page.getByTestId(`row-project-${fixture.projectId}`)).toBeVisible();
    await page.getByTestId("select-backup-type").click();
    await page.getByTestId("select-item-files").click();
    const backupChoice = await page.getByTestId("select-backup-type").textContent();
    await choose(page, "security", "audit-logs", "Audit logs");
    const search = page.getByRole("textbox", { name: "Search audit events", exact: true });
    await search.fill("Retained audit draft");
    await choose(page, "system", "backup-restore", "Backup & Restore");
    await expect(page.getByTestId("select-backup-type")).toHaveText(backupChoice);
    await choose(page, "security", "audit-logs", "Audit logs");
    await expect(search).toHaveValue("Retained audit draft");
    await page.screenshot({ path: `${output}/audit-desktop.jpg` });

    // Back/forward and refreshed deep links select the same workspace.
    await choose(page, "system", "log-maintenance", "Log Maintenance");
    await expect(page.getByRole("heading", { name: "Log maintenance", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page.locator('[data-settings-section="timezone"]')).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Log maintenance", exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Log maintenance", exact: true })).toBeVisible();
    await page.goto("/maintenance#log-maintenance");
    await expect(page).toHaveURL(/\/settings\?section=log-maintenance/);
    await expect(page.getByRole("heading", { name: "Log maintenance", exact: true })).toBeVisible();
    await page.goto("/audit-logs#retention");
    await expect(page).toHaveURL(/\/settings\?section=audit-logs#retention/);
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId("settings-mobile-menu")).toBeVisible();
    await choose(page, "system", "backup-restore", "Backup & Restore");
    await expect(page.getByTestId("button-full-system-backup")).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/backup-phone.jpg` });
    await choose(page, "security", "audit-logs", "Audit logs");
    await page.getByRole("button", { name: "Show Search & Tools", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Search audit events", exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.screenshot({ path: `${output}/audit-phone.jpg` });

    // Existing delegated grants remain useful without nav.settings or broad
    // security/maintenance permissions. Grant through real role management.
    for (const kind of ["audit", "backup", "none"]) {
      await grant(kind === "audit" ? ["audit.view"] : kind === "backup" ? ["nav.maintenance", "maintenance.projectBackup"] : ["nav.dashboard"]);
      const context = await browser.newContext({ baseURL });
      try {
        await login(context, fixture.viewer);
        const scoped = await context.newPage();
        await scoped.goto(kind === "backup" ? "/maintenance" : "/audit-logs");
        await expect(scoped.locator('[data-settings-section="security-settings"]')).toBeHidden();
        await expect(scoped.locator('[data-settings-section="access-locks"]')).toBeHidden();
        if (kind === "audit") {
          await expect(scoped.getByTestId("nav-settings")).toBeVisible();
          await expect(scoped.getByRole("textbox", { name: "Search audit events", exact: true })).toBeVisible();
          await expect(scoped.getByTestId("settings-section-nav-backup-restore")).toHaveCount(0);
          assert.equal((await context.request.get("/api/audit/retention")).status(), 403);
          assert.equal((await context.request.get("/api/maintenance/projects")).status(), 403);
        } else if (kind === "backup") {
          await expect(scoped.getByTestId("nav-settings")).toBeVisible();
          await expect(scoped.getByTestId(`row-project-${fixture.projectId}`)).toBeVisible();
          await expect(scoped.getByTestId("button-full-system-backup")).toHaveCount(0);
          await expect(scoped.getByTestId("settings-section-nav-audit-logs")).toHaveCount(0);
          assert.equal((await context.request.get("/api/audit")).status(), 403);
        } else {
          await expect(scoped.locator('[data-settings-section="audit-logs"]')).toBeHidden();
          await expect(scoped.getByRole("textbox", { name: "Search audit events", exact: true })).toHaveCount(0);
          assert.equal((await context.request.get("/api/audit")).status(), 403);
        }
      } finally { await context.close(); }
    }
    assert.deepEqual(mutations, [], "Navigating and changing drafts must not run administrative operations");
    assert.deepEqual(errors, [], "No browser runtime errors");
    console.log("PASS: embedded audit/maintenance tools, sidebar removal, legacy/deep links, browser history, retained drafts, phone widths, delegated permissions, no administrative writes.");
  } finally {
    await admin.close();
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
