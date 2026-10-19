const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const { request, chromium } = require("@playwright/test");
const { spawnSync } = require("node:child_process");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const config = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL }), viewer = await request.newContext({ baseURL });
  const base = `/api/projects/${fixture.projectId}/file-transfers`;
  const ssh = await require("./support/owned-sftp.cjs")();
  const uiOnly = process.argv.includes("--ui-only");
  const importsOnly = process.argv.includes("--imports-only") || uiOnly;
  let browser;
  async function json(method, url, data, status = 200) {
    const response = await api.fetch(url, { method, data }), text = await response.text();
    assert.equal(response.status(), status, `${method} ${url}: ${text.slice(0, 700)}`);
    return text && response.status() !== 204 ? JSON.parse(text) : null;
  }
  async function finished(id, expected = "success") {
    let latest;
    for (let count = 0; count < 70; count++) {
      latest = (await json("GET", base + "/history?direction=export")).rows.find(row => row.exportRunId === id);
      if (latest && ["success", "failed", "interrupted", "cancelled"].includes(latest.status)) {
        assert.equal(latest.status, expected, JSON.stringify(latest)); return latest;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Export did not finish: " + JSON.stringify(latest));
  }
  const helper = (mode, args = []) => {
    const result = spawnSync(process.execPath, ["--import", "tsx", "tests/file-transfers-data.ts", mode, ...args], { env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr); return result.stdout;
  };
  try {
    assert.equal((await api.get(base)).status(), 401);
    await json("POST", "/api/auth/local/login", fixture);
    await viewer.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await viewer.get(base)).status(), 403);
    assert.equal((await viewer.put(base + "/connection", { data: {} })).status(), 403);
    helper("seed");
    const context = await json("GET", base);
    assert.ok(context.fields.includes("customerWoId")); assert.ok(context.permissions.canExport);
    const trouble = context.statuses.find(row => row.code === "Trouble"), closed = context.statuses.find(row => row.code === "Closed");
    assert.ok(trouble && closed, "configured custom statuses included");
    const connection = { name: "Owned fixture", host: "127.0.0.1", port: ssh.port, username: "fixture",
      hostFingerprint: ssh.fingerprint, authType: "password", password: "synthetic-fixture-only" };
    const saved = await json("PUT", base + "/connection", connection);
    assert.equal(saved.hasCredentials, true); assert.equal(saved.password, undefined);
    await json("POST", base + "/connection/test");
    await json("PUT", base + "/connection", { ...connection, hostFingerprint: "SHA256:" + "A".repeat(43) });
    await json("POST", base + "/connection/test", undefined, 502);
    await json("PUT", base + "/connection", connection);
    await json("PUT", base + "/connection", { ...connection, password: undefined, host: "localhost" }, 400);
    const exp = await json("POST", base + "/exports", { name: "Closed and Trouble", format: "csv", mode: "changed",
      allStatuses: false, statusIds: [closed.id, trouble.id], subStatusIds: [], columns: ["customerWoId", "status", "customerName", "address", "newSystemId"],
      filenameTemplate: "customer_{YYYY}{MM}{DD}_{runId}", destination: "sftp", remoteDirectory: "/outbound", scheduleFrequency: "manual", isEnabled: false }, 201);
    if (!importsOnly) {
    const run = await json("POST", base + `/exports/${exp.id}/run`, {}, 202), result = await finished(run.id);
    assert.equal(result.recordCount, 2);
    const remote = ssh.files.get("/outbound/" + result.fileName).toString("utf8");
    assert.match(remote, /TRANSFER-CLOSED/); assert.match(remote, /TRANSFER-TROUBLE/); assert.doesNotMatch(remote, /TRANSFER-OPEN/);
    assert.equal((await api.get(base + `/runs/${run.id}/download`)).status(), 200);
    const second = await json("POST", base + `/exports/${exp.id}/run`, {}, 202);
    assert.equal((await finished(second.id)).recordCount, 0, "unchanged rows not redelivered");
    const full = await json("POST", base + `/exports/${exp.id}/run`, { mode: "full", allStatuses: false, statusIds: [closed.id], subStatusIds: [] }, 202);
    assert.equal((await finished(full.id)).recordCount, 1, "manual status override independent of saved config");
    assert.deepEqual((await json("GET", base)).exports[0].statusIds.sort(), [closed.id, trouble.id].sort());
    helper("change");
    ssh.setWritable(false);
    const failedRun = await json("POST", base + `/exports/${exp.id}/run`, {}, 202);
    const failed = await finished(failedRun.id, "failed"); assert.equal(failed.recordCount, 1);
    await json("POST", base + `/exports/${exp.id}/run`, {}, 409);
    helper("assert-checkpoint", [exp.id]);
    ssh.setWritable(true);
    await json("POST", base + `/runs/${failedRun.id}/retry`, {}, 202);
    const retry = await finished(failedRun.id); assert.equal(retry.fileName, failed.fileName); assert.equal(retry.attempts, 2);
    assert.equal(retry.attemptLog.length, 2);
    const localImport = await json("POST", `/api/projects/${fixture.projectId}/file-import-configs`, {
      name: "Do not re-import exports", source: "local", processedFilePattern: "customer_*.csv", scheduleFrequency: "manual", isEnabled: true }, 201);
    const noReimport = await json("POST", `/api/file-import-configs/${localImport.id}/run`);
    assert.equal(noReimport.imported, 0); assert.equal(noReimport.failed, 0);
    }
    if (!uiOnly) {
    const importConfig = await json("POST", `/api/projects/${fixture.projectId}/file-import-configs`, {
      name: "SFTP incoming", source: "sftp", remoteDirectory: "/inbound", processedFilePattern: "customer_*.csv", scheduleFrequency: "manual", isEnabled: true,
      delimiter: ",", hasHeader: true, columnMapping: { customerWoId: "wo", customerId: "customer", customerName: "name", address: "address", serviceType: "service" } }, 201);
    ssh.files.set("/inbound/ignore.csv", Buffer.from("no matching file"));
    ssh.files.set("/inbound/customer_orders.csv", Buffer.from('wo,customer,name,address,service\nSFTP-IMPORTED,SC-1,"Customer, Inc.","100 Main St",workspace-fixture\n'));
    const imported = await json("POST", `/api/file-import-configs/${importConfig.id}/run`);
    assert.equal(imported.imported, 1, JSON.stringify({ imported, history: await json("GET", `/api/file-import-configs/${importConfig.id}/history`) })); assert.equal(imported.failed, 0);
    const repeat = await json("POST", `/api/file-import-configs/${importConfig.id}/run`);
    assert.equal(repeat.imported, 0, "unchanged SFTP files deduplicated");
    helper("assert-import");
    ssh.files.set("/inbound/customer_invalid.csv", Buffer.from("wo,customer,name,address,service\nBAD-SERVICE,SC-2,Test,200 Main St,not-a-known-service\n"));
    const invalidImport = await json("POST", `/api/file-import-configs/${importConfig.id}/run`);
    assert.equal(invalidImport.success, false); assert.equal(invalidImport.failed, 1);
    ssh.files.delete("/inbound/customer_invalid.csv");
    const history = await json("GET", base + "/history?search=customer_orders&direction=import");
    assert.ok(history.total >= 1); assert.equal(history.rows[0].destination, "sftp");
    }
    assert.equal((await api.get(base + "/history/export?direction=export")).status(), 200);
    const existingPermissions = await json("GET", `/api/subroles/${fixture.viewerRoleId}/permissions`);
    await json("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: [...existingPermissions, "project.fileExports"] });
    const delegatedResponse = await viewer.get(base);
    assert.equal(delegatedResponse.status(), 200, "permission granted through normal role management");
    const delegated = await delegatedResponse.json();
    assert.equal(delegated.permissions.canExport, true); assert.equal(delegated.permissions.canManageConnection, false);
    assert.equal((await viewer.put(base + "/connection", { data: connection })).status(), 403);
    await json("POST", base + "/exports", { ...exp, name: "Empty selection", allStatuses: false, statusIds: [], subStatusIds: [] }, 400);
    if (!importsOnly) {
    helper("schedule", [exp.id]);
    for (let i = 0; i < 30 && (await json("GET", base + "/history?direction=export")).total < 5; i++) await new Promise(resolve => setTimeout(resolve, 500));
    assert.ok((await json("GET", base + "/history?direction=export")).total >= 5, "due schedule runs without manual click");
    }
    browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", headless: true, args: ["--no-sandbox"] });
    const page = await browser.newPage({ storageState: await api.storageState() });
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(baseURL + `/projects/${fixture.projectId}/import`);
    await page.getByRole("tab", { name: "Exports", exact: true }).click();
    await page.getByText("Closed and Trouble", { exact: true }).first().waitFor();
    await fs.mkdir("generated-artifacts/file-transfers", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/file-transfers/desktop.jpg", fullPage: true });
    await page.getByRole("button", { name: /new export/i }).click();
    await page.getByRole("dialog").waitFor();
    await page.screenshot({ path: "generated-artifacts/file-transfers/editor.jpg", fullPage: true });
    await page.keyboard.press("Escape");
    const phoneContext = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await phoneContext.newPage();
    await phone.goto(baseURL + `/projects/${fixture.projectId}/import`);
    await phone.getByRole("combobox", { name: "File transfer section", exact: true }).waitFor();
    await phone.getByRole("combobox", { name: "File transfer section", exact: true }).selectOption("exports");
    await phone.getByText("Closed and Trouble", { exact: true }).waitFor();
    await phone.screenshot({ path: "generated-artifacts/file-transfers/mobile.jpg" });
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "phone does not overflow");
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await phone.getByRole("combobox", { name: "File transfer section", exact: true }).waitFor();
    await phone.screenshot({ path: "generated-artifacts/file-transfers/landscape.jpg" });
    assert.equal(await phone.getByRole("combobox", { name: "File transfer section", exact: true }).isVisible(), true);
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "landscape does not overflow");
    await phoneContext.close();
    assert.deepEqual(errors, []);
    console.log(uiOnly ? "File transfer signed-in UI, role grants and portrait/landscape compact navigation passed." :
      importsOnly ? "SFTP imports, custom service codes, host-key rejection, patterns/deduplication, failure logs, role grants and responsive UI passed." :
      "File transfers: authenticated permissions, custom statuses, full/delta, manual overrides, real SSH/SFTP, retries/checkpoints, import patterns/deduplication, schedules and responsive UI passed.");
  } finally { if (browser) await browser.close(); await ssh.close(); await api.dispose(); await viewer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
