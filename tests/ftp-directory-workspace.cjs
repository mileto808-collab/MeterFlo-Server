const { chromium, request } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
(async () => {
  const configPath = process.env.WORKSPACE_UI_SANDBOX_CONFIG;
  assert.ok(configPath);
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  let browser;
  const baseURL = config.baseURL;
  try {
    const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
    const api = await request.newContext({ baseURL }), viewer = await request.newContext({ baseURL });
    await api.post("/api/auth/local/login", { data: fixture });
    await viewer.post("/api/auth/local/login", { data: fixture.viewer });
    const endpoint = "/api/settings/ftp-files-path", ftp = `/api/projects/${fixture.projectId}/ftp-files`;
    const get = async () => { const r = await api.get(endpoint); assert.equal(r.status(), 200); return r.json(); };
    const set = async (value, status = 200) => { const r = await api.put(endpoint, { data: { path: value } }); assert.equal(r.status(), status, await r.text()); return r; };
    const initial = await get();
    assert.equal(initial.usesProjectFilesPath, true); assert.equal(initial.path, "");
    assert.equal((await viewer.get(endpoint)).status(), 403);
    assert.equal((await viewer.put(endpoint, { data: { path: "forbidden" } })).status(), 403);
    const upload = async name => {
      const r = await api.post(ftp, { multipart: { file: { name, mimeType: "text/csv", buffer: Buffer.from("customer_wo_id,address\nTEST,100 Main St\n") } } });
      assert.equal(r.status(), 200, await r.text());
    };
    await upload("original.csv");
    const granted = await api.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["projects.view", "workOrders.view", "settings.projectFiles"] } });
    assert.equal(granted.status(), 200);
    assert.equal((await viewer.get(endpoint)).status(), 200, "Normal permission grants enable delegated configuration");
    const custom = path.join(path.dirname(configPath), "custom-ftp");
    assert.equal((await viewer.put(endpoint, { data: { path: custom } })).status(), 200);
    assert.equal((await get()).effectivePath, custom);
    await set("\u0000bad", 400); await set(25, 400);
    assert.equal((await get()).path, custom);
    await upload("custom.csv");
    const list = await api.get(ftp);
    assert.equal(list.status(), 200);
    assert.ok((await list.text()).includes("custom.csv"));
    assert.equal((await api.get(`${ftp}/custom.csv/download`)).status(), 200);
    assert.equal((await api.get(`${ftp}/original.csv/download`)).status(), 404, "Changing roots does not move old files");
    const helper = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "--tsconfig",
      path.resolve("tsconfig.json"), "tests/ftp-directory-data.ts"], { env: process.env, encoding: "utf8" });
    assert.equal(helper.status, 0, helper.stdout + helper.stderr);
    await set("");
    assert.equal((await api.get(`${ftp}/original.csv/download`)).status(), 200);
    await set(custom);
    const renamed = await api.patch(`/api/projects/${fixture.projectId}`, { data: { name: "Renamed FTP fixture" } });
    assert.equal(renamed.status(), 200, await renamed.text());
    assert.equal((await api.get(`${ftp}/custom.csv/download`)).status(), 200, "Rename preserves custom FTP files");
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 }, storageState: await api.storageState() });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto("/settings?section=ftp-files");
    const input = page.getByTestId("input-ftp-files-path");
    await input.waitFor();
    await page.waitForFunction(value => document.querySelector('[data-testid="input-ftp-files-path"]')?.value === value, custom);
    const changed = path.join(path.dirname(configPath), "ui-ftp");
    await input.fill(changed);
    await Promise.all([page.waitForResponse(r => r.url().includes("/api/settings/ftp-files-path") && r.request().method() === "PUT" && r.status() === 200),
      page.getByTestId("button-save-ftp-files-path").click()]);
    assert.equal((await get()).path, changed);
    await page.getByTestId("text-ftp-files-effective-path").filter({ hasText: changed }).waitFor();
    await page.screenshot({ path: "generated-artifacts/project-workspace/ftp-settings-desktop.jpg" });
    const mobile = await browser.newContext({ baseURL, isMobile: true, hasTouch: true, viewport: { width: 390, height: 844 }, storageState: await api.storageState() });
    const phone = await mobile.newPage();
    await phone.goto("/settings?section=ftp-files");
    await phone.getByTestId("input-ftp-files-path").waitFor();
    await phone.waitForFunction(value => document.querySelector('[data-testid="input-ftp-files-path"]')?.value === value, changed);
    await phone.screenshot({ path: "generated-artifacts/project-workspace/ftp-settings-phone.jpg" });
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await Promise.all([phone.waitForResponse(r => r.url().includes("/api/settings/ftp-files-path") && r.request().method() === "PUT" && r.status() === 200),
      phone.getByTestId("button-reset-ftp-files-path").click()]);
    assert.equal((await get()).usesProjectFilesPath, true);
    await set(custom);
    const sibling = path.join(custom, "unrelated-project", "keep.txt");
    await fs.mkdir(path.dirname(sibling), { recursive: true }); await fs.writeFile(sibling, "keep");
    assert.equal((await api.delete(`/api/projects/${fixture.projectId}`)).status(), 204);
    await fs.access(sibling);
    assert.deepEqual((await fs.readdir(custom)).filter(name => name !== ".meterflo-project-deletions"), ["unrelated-project"]);
    assert.deepEqual(await fs.readdir(path.join(custom, ".meterflo-project-deletions")), []);
    assert.deepEqual(errors, []);
    console.log("FTP directory settings, permissions, uploads/downloads, inheritance, backup/restore, rename/deletion and responsive UI passed.");
  } finally { await browser?.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
