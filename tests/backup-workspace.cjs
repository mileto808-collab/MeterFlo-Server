// Real routes, archives and responsive UI in the owned disposable PostgreSQL sandbox.
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { request, chromium } = require("@playwright/test");
const unzipper = require("unzipper");
const { randomUUID } = require("node:crypto");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL });
  const viewer = await request.newContext({ baseURL });
  const base = "/api/maintenance/backups";
  async function json(method, url, data, status = 200) {
    const response = await api.fetch(url, { method, data });
    const text = await response.text();
    assert.equal(response.status(), status, `${method} ${url}: ${text.slice(0, 500)}`);
    return text && response.status() !== 204 ? JSON.parse(text) : null;
  }
  let browser;
  try {
    assert.equal((await api.get(base)).status(), 401);
    await json("POST", "/api/auth/local/login", fixture);
    await viewer.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await viewer.get(base)).status(), 403);
    assert.equal((await viewer.post(base + "/schedules", { data: {} })).status(), 403);
    const folder = path.join(path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG), "private-backups");
    const documents = path.join(path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG), "files");
    await fs.mkdir(documents, { recursive: true });
    await fs.writeFile(path.join(documents, "backup-fixture.txt"), "Owned project document backup fixture");
    const saved = await json("PUT", base + "/destination", { kind: "local", path: folder, bucketId: "" });
    assert.equal(saved.path, folder);
    await json("PUT", base + "/destination", { kind: "local", path: path.join(process.cwd(), "dist/public"), bucketId: "" }, 400);
    const created = [];
    for (const type of ["database", "clean", "project", "recovery"]) {
      const schedule = await json("POST", base + "/schedules", {
        name: `Backup ${type}`, backupType: type, cron: "0 2 * * *", timezone: "America/New_York",
        enabled: false, retentionDays: 7, minimumCopies: 2,
      }, 201);
      created.push(schedule);
      assert.equal(schedule.retentionDays, 7);
      const run = await json("POST", base + `/schedules/${schedule.id}/run`, {}, 202);
      await json("POST", base + `/schedules/${schedule.id}/run`, {}, 409);
      let finished;
      for (let i = 0; i < 90; i++) {
        const history = await json("GET", base + "/runs?scheduleId=" + schedule.id);
        finished = history.rows.find(row => row.id === run.id);
        if (finished && !["queued", "running"].includes(finished.status)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      assert.equal(finished.status, "succeeded", JSON.stringify(finished));
      const download = await api.get(base + `/runs/${run.id}/download`);
      assert.equal(download.status(), 200);
      const contents = await download.body();
      assert.equal(contents.length, finished.bytes);
      const archive = await unzipper.Open.buffer(contents);
      const metadata = JSON.parse((await archive.files.find(file => file.path === "backup_metadata.json").buffer()).toString());
      assert.equal(metadata.backupType, type);
      if (type === "database" || type === "recovery") {
        const sql = (await archive.files.find(file => file.path === "database_backup.sql").buffer()).toString();
        assert.ok(sql.includes("backup_schedules"));
      }
      if (type === "recovery") {
        assert.equal(metadata.includesDatabase, true);
        assert.equal(metadata.includesProjectFiles, true);
        assert.equal(metadata.format, "pg_dump_full");
        const document = archive.files.find(file => file.path === "project_files/backup-fixture.txt");
        assert.ok(document, "Complete recovery includes uploaded project documents");
        assert.equal((await document.buffer()).toString(), "Owned project document backup fixture");
        assert.ok(archive.files.some(file => file.path === "RESTORE_INSTRUCTIONS.txt"));
        const filtered = await json("GET", base + "/runs?backupType=recovery");
        assert.ok(filtered.rows.some(row => row.id === run.id));
      }
      console.log(`Saved scheduled ${type} backup is downloadable and restorable-format metadata is valid.`);
    }
    const enabled = await json("PATCH", base + `/schedules/${created[0].id}`, {
      ...created[0], enabled: true, retentionDays: 14, minimumCopies: 1,
    });
    assert.ok(new Date(enabled.nextRunAt) > new Date());
    const dashboard = await json("GET", base);
    assert.equal(dashboard.schedules.find(row => row.id === enabled.id).retentionDays, 14);
    const history = await json("GET", base + "/runs?backupType=database&status=succeeded&search=Backup");
    assert.equal(history.total, 1);
    for (const format of ["csv", "xlsx", "print"]) {
      const exported = await api.get(base + `/runs/export?format=${format}&backupType=database`);
      assert.equal(exported.status(), 200);
      if (format === "csv") assert.ok((await exported.text()).includes("Backup database"));
      if (format === "print") assert.ok((await exported.text()).includes("1 matching records"));
      if (format === "xlsx") assert.ok((await exported.body()).length > 100);
    }
    // Actual retention with aged, tracked copies; unrelated files are untouched.
    {
      const original = (await json("GET", base + "/runs?backupType=database")).rows[0];
      const managed = path.join(folder, "meterflo-scheduled-backups");
      const old = randomUUID();
      await fs.copyFile(path.join(managed, original.id + ".zip"), path.join(managed, old + ".zip"));
      await fs.writeFile(path.join(managed, "unrelated.txt"), "do not remove");
      const maintenance = spawnSync(process.execPath, ["--import", "tsx", "tests/backup-retention-helper.ts", old, enabled.id, folder], { env: process.env, encoding: "utf8", timeout: 30000 });
      assert.equal(maintenance.status, 0, maintenance.stderr);
      assert.equal((await json("GET", base + "/runs?status=expired")).total, 1);
      await assert.rejects(fs.access(path.join(managed, old + ".zip")));
      assert.equal(await fs.readFile(path.join(managed, "unrelated.txt"), "utf8"), "do not remove");
      let automatic;
      for (let i = 0; i < 60; i++) {
        automatic = (await json("GET", base + "/runs?backupType=database")).rows.find(row => row.trigger === "scheduled" && row.status !== "expired");
        if (automatic && !["queued", "running"].includes(automatic.status)) break;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      assert.equal(automatic?.status, "succeeded", "An overdue schedule must execute without a Run now request");
      assert.ok(new Date((await json("GET", base)).schedules.find(row => row.id === enabled.id).nextRunAt) > new Date());
    }
    const source = spawnSync(process.execPath, ["--import", "tsx", "tests/backup-source-archive.ts"], { env: process.env, encoding: "utf8", timeout: 30000 });
    assert.equal(source.status, 0, source.stderr);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
    const context = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + "/settings?section=backup-restore");
    await page.getByTestId("backup-workspace").waitFor();
    assert.ok(await page.getByRole("searchbox", { name: "Search schedules" }).evaluate(element => element.getBoundingClientRect().width > 180));
    await fs.mkdir("generated-artifacts/backups", { recursive: true });
    await page.getByRole("button", { name: "New schedule", exact: true }).click();
    assert.equal(await page.getByLabel("Backup type", { exact: true }).inputValue(), "recovery");
    assert.equal(await page.getByText(/One ZIP with database_backup.sql/).isVisible(), true);
    await page.screenshot({ path: "generated-artifacts/backups/complete-recovery.png" });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.screenshot({ path: "generated-artifacts/backups/desktop.png" });
    assert.equal(errors.length, 0, errors.join("\n"));
    await context.close();
    const phone = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
    const mobile = await phone.newPage();
    await mobile.goto(baseURL + "/settings?section=backup-restore");
    const workspace = mobile.getByTestId("backup-workspace");
    await workspace.waitFor();
    await mobile.waitForTimeout(400);
    assert.equal(await workspace.getAttribute("data-screen-mode"), "compact");
    assert.equal(await mobile.getByLabel("Backup section", { exact: true }).isVisible(), true);
    await mobile.screenshot({ path: "generated-artifacts/backups/phone.png" });
    await mobile.setViewportSize({ width: 874, height: 402 });
    await mobile.waitForTimeout(400);
    assert.equal(await workspace.getAttribute("data-screen-mode"), "compact", "Landscape must retain the mobile tab/menu behavior");
    assert.equal(await mobile.getByLabel("Backup section", { exact: true }).isVisible(), true);
    await mobile.screenshot({ path: "generated-artifacts/backups/landscape.png" });
    await phone.close();
    await json("DELETE", base + `/schedules/${created[0].id}`, undefined, 204);
    assert.ok(!(await json("GET", base)).schedules.some(row => row.id === created[0].id));
    assert.ok((await json("GET", base + "/runs")).total >= 4, "Schedule deletion retains history");
    console.log("Backup authorization, policy persistence, queue, retention, exports and responsive UI passed.");
  } finally {
    if (browser) await browser.close();
    await api.dispose(); await viewer.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
