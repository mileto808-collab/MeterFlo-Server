const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { randomUUID, createHash } = require("node:crypto");
const { request, chromium } = require("@playwright/test");
(async () => {
  const owner = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG || "", "utf8"));
  assert.equal(owner.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const api = await request.newContext({ baseURL }), viewer = await request.newContext({ baseURL });
  const customer = await request.newContext({ baseURL, extraHTTPHeaders: { "X-Forwarded-Proto": "https" } });
  const base = `/api/projects/${fixture.projectId}/file-transfers`, hx = base + "/https";
  const ext = `/api/file-exchange/v1/projects/${fixture.projectId}`;
  let browser;
  const helper = (mode, args = [], script = "tests/https-transfers-data.ts") => {
    const result = spawnSync(process.execPath, ["--import", "tsx", script, mode, ...args], { env: process.env, encoding: "utf8" });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  };
  async function json(method, url, data, expected = 200) {
    const response = await api.fetch(url, { method, data }), text = await response.text();
    assert.equal(response.status(), expected, `${method} ${url}: ${text.replace(/"token":"[^"]*"/g, '"token":"[redacted]"').slice(0, 600)}`);
    return text ? JSON.parse(text) : null;
  }
  async function external(method, url, token, data, expected = 200, extra = {}) {
    const response = await customer.fetch(url, { method, headers: { Authorization: "Bearer " + token, ...extra }, data });
    assert.equal(response.status(), expected, `${method} ${url}: ${response.status()} ${expected === 200 && url.endsWith("/download") ? "" : (await response.text()).slice(0, 350)}`);
    return response;
  }
  async function finished(runId) {
    for (let count = 0; count < 65; count++) {
      const row = (await json("GET", base + "/history?direction=export")).rows.find(r => r.exportRunId === runId);
      if (row && ["success", "failed"].includes(row.status)) { assert.equal(row.status, "success", JSON.stringify(row)); return; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("HTTPS export did not finish.");
  }
  try {
    assert.equal((await api.get(hx)).status(), 401);
    await json("POST", "/api/auth/local/login", fixture);
    await viewer.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await viewer.get(hx)).status(), 403);
    helper("seed", [], "tests/file-transfers-data.ts"); helper("setup");
    const services = await json("GET", "/api/service-types");
    await json("PUT", `/api/projects/${fixture.projectId}/service-types`, { serviceTypeIds: [services.find(s => s.code === "workspace-fixture").id] });
    helper("guide-contract");
    const guide = (await json("GET", base)).columnGuide;
    assert.equal(guide.columns.find(c => c.field === "customerWoId").requirement, "generated");
    const caseImport = await json("POST", `/api/projects/${fixture.projectId}/import`, { workOrders: [{
      customerWoId: "CASE-OWNED-1", customerId: "CASE-1", customerName: "Custom service code", address: "Test address", serviceType: "WORKSPACE-FIXTURE",
    }], fileName: "case.csv" });
    assert.equal(caseImport.imported, 1, JSON.stringify(caseImport));
    assert.equal((await json("GET", hx)).settings.enabled, false);
    const setting = await json("PUT", hx + "/settings", { enabled: true, location: "", retentionDays: 30 });
    assert.equal(setting.provider, "local"); assert.equal(setting.enabled, true);
    const ctx = await json("GET", hx); assert.equal(ctx.storage.available, true); assert.equal(ctx.timezone, "America/New_York");
    const issued = await json("POST", hx + "/credentials", { name: "Customer primary", canUpload: true, canDownload: true, expiresInDays: 90 }, 201);
    let token = issued.token; assert.match(token, /^mft_/); helper("verify-hash", [issued.credential.id]);
    assert.equal(JSON.stringify(await json("GET", hx)).includes(token), false);
    const upOnly = await json("POST", hx + "/credentials", { name: "Upload only", canUpload: true, canDownload: false, expiresInDays: 1 }, 201);
    await external("GET", ext + "/outbox", upOnly.token, undefined, 403);
    await external("GET", `/api/file-exchange/v1/projects/${fixture.projectId + 10000}/inbox`, token, undefined, 401);
    assert.equal((await api.get(ext + "/inbox", { headers: { Authorization: "Bearer " + token } })).status(), 426);
    const csv = Buffer.from('wo,customer,name,address,service\nHTTPS-OWNED-1,H-1,"Customer, Inc.","100 Main St",workspace-fixture\n');
    const uploadKey = randomUUID(), headers = { "Content-Type": "application/octet-stream", "Idempotency-Key": uploadKey,
      "X-Content-SHA256": createHash("sha256").update(csv).digest("hex") };
    const upload = await (await external("PUT", ext + "/inbox/customer_orders.csv", token, csv, 201, headers)).json();
    assert.equal(upload.file.status, "received");
    const repeated = await (await external("PUT", ext + "/inbox/customer_orders.csv", token, csv, 200, headers)).json();
    assert.equal(repeated.file.id, upload.file.id); assert.equal(repeated.duplicate, true);
    await external("PUT", ext + "/inbox/changed.csv", token, Buffer.from("different"), 409, { ...headers, "X-Content-SHA256": "" });
    await external("PUT", ext + "/inbox/bad.csv", token, csv, 422, { ...headers, "Idempotency-Key": randomUUID(), "X-Content-SHA256": "0".repeat(64) });
    await external("GET", ext + "/inbox/" + upload.file.id, upOnly.token, undefined, 404);
    const importConfig = await json("POST", `/api/projects/${fixture.projectId}/file-import-configs`, {
      name: "HTTPS Incoming", isEnabled: true, source: "https", processedFilePattern: "customer_*.csv", scheduleFrequency: "manual",
      columnMapping: { customerWoId: "wo", customerId: "customer", customerName: "name", address: "address", serviceType: "service" },
    }, 201);
    const imported = await json("POST", `/api/file-import-configs/${importConfig.id}/run`);
    assert.equal(imported.imported, 1, JSON.stringify(imported)); assert.equal(imported.failed, 0);
    helper("verify-import", [upload.file.id]);
    assert.equal((await (await external("GET", ext + "/inbox/" + upload.file.id, token)).json()).status, "processed");
    const duplicate = await (await external("PUT", ext + "/inbox/customer_again.csv", token, csv, 201, { ...headers, "Idempotency-Key": randomUUID() })).json();
    assert.equal((await json("POST", `/api/file-import-configs/${importConfig.id}/run`)).imported, 0);
    assert.equal((await (await external("GET", ext + "/inbox/" + duplicate.file.id, token)).json()).status, "processed");
    const pending = await (await external("PUT", ext + "/inbox/other_pending.csv", token, Buffer.from("wo,customer,name,address,service\nPENDING,P-1,Pending,Somewhere,workspace-fixture\n"), 201,
      { ...headers, "Idempotency-Key": randomUUID(), "X-Content-SHA256": "" })).json();
    const exportConfig = await json("POST", base + "/exports", { name: "HTTPS customer exports", columns: ["customerWoId", "customerName", "status"],
      format: "csv", mode: "full", allStatuses: true, destination: "https", scheduleFrequency: "manual", filenameTemplate: "customer_export_{runId}" }, 201);
    const run = await json("POST", base + `/exports/${exportConfig.id}/run`, {}, 202); await finished(run.id);
    let outbox = await (await external("GET", ext + "/outbox", token)).json();
    const file = outbox.rows[0]; assert.equal(file.status, "available");
    const downloaded = await external("GET", ext + `/outbox/${file.id}/download`, token);
    assert.ok((await downloaded.text()).includes("HTTPS-OWNED-1"));
    assert.equal(downloaded.headers()["x-content-sha256"], file.sha256);
    await external("POST", ext + `/outbox/${file.id}/ack`, token);
    await external("POST", ext + `/outbox/${file.id}/ack`, token);
    const secondRun = await json("POST", base + `/exports/${exportConfig.id}/run`, {}, 202); await finished(secondRun.id);
    outbox = await (await external("GET", ext + "/outbox", token)).json();
    const unack = outbox.rows.find(r => r.exportRunId === secondRun.id);
    helper("tamper", [unack.id]);
    await external("GET", ext + `/outbox/${unack.id}/download`, token, undefined, 503);
    const rotated = await json("POST", hx + `/credentials/${issued.credential.id}/rotate`, { expiresInDays: 90 });
    await external("GET", ext + "/inbox", token, undefined, 401); token = rotated.token;
    assert.equal((await external("GET", ext + "/inbox", token)).status(), 200);
    helper("expire-credential", [upOnly.credential.id]); await external("GET", ext + "/inbox", upOnly.token, undefined, 401);
    for (const section of ["files", "events"]) {
      const csvResponse = await api.get(hx + `/${section}/export.csv?search=customer`);
      assert.equal(csvResponse.status(), 200); assert.equal((await csvResponse.text()).includes(token), false);
      assert.equal((await api.get(hx + `/${section}/export.xlsx`)).status(), 200);
      const print = await api.get(hx + `/${section}/print`);
      assert.equal(print.status(), 200); assert.ok((await print.text()).includes("America/New_York"));
    }
    helper("retention");
    assert.equal((await (await external("GET", ext + "/inbox/" + pending.file.id, token)).json()).status, "received");
    const permissions = await api.get(`/api/subroles/${fixture.viewerRoleId}/permissions`).then(r => r.json());
    await json("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: [...permissions, "project.httpsTransfers"] });
    assert.equal((await viewer.get(hx)).status(), 200);
    browser = await chromium.launch({ headless: true, executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const page = await browser.newPage({ storageState: await api.storageState(), viewport: { width: 1440, height: 1000 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.goto(baseURL + `/projects/${fixture.projectId}/import`);
    await page.getByTestId("input-file-upload").setInputFiles({ name: "manual-no-wo-id.csv", mimeType: "text/csv",
      buffer: Buffer.from("customer_id,customer_name,address\nMANUAL-CSV,Manual CSV Customer,21 Test Street\n") });
    const manualResponse = page.waitForResponse(response => response.url().endsWith(`/api/projects/${fixture.projectId}/import`) && response.request().method() === "POST");
    await page.getByRole("button", { name: "Import 1 Work Orders", exact: true }).click();
    assert.equal((await (await manualResponse).json()).imported, 1);
    helper("verify-manual");
    await page.getByRole("region", { name: "Manual CSV / Excel field guide" }).getByRole("button", { name: "View fields & database" }).click();
    await page.getByText("Database comparison", { exact: true }).first().waitFor();
    await page.getByRole("tab", { name: "HTTPS Exchange", exact: true }).click();
    await page.getByText("Exchange files", { exact: true }).waitFor();
    await page.getByText("customer_orders.csv", { exact: true }).first().waitFor();
    await fs.mkdir("generated-artifacts/https-transfers", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/https-transfers/desktop.jpg" });
    const phone = await browser.newPage({ storageState: await api.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await phone.goto(baseURL + `/projects/${fixture.projectId}/import`);
    const nav = phone.getByRole("combobox", { name: "File transfer section", exact: true });
    await nav.selectOption("https"); await phone.getByText("Exchange files", { exact: true }).waitFor();
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await phone.screenshot({ path: "generated-artifacts/https-transfers/mobile.jpg" });
    await phone.setViewportSize({ width: 844, height: 390 });
    await phone.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await nav.isVisible(), true);
    await phone.screenshot({ path: "generated-artifacts/https-transfers/landscape.jpg" });
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    await json("POST", hx + `/credentials/${issued.credential.id}/revoke`, {});
    await external("GET", ext + "/inbox", token, undefined, 401);
    console.log("HTTPS exchange: scopes/isolation, TLS, hashes, complete/idempotent uploads, mapped/deduplicated imports, export delivery/acknowledgements, integrity failures, rotation/expiry/revocation, retention, role grants, reports and responsive UI passed.");
  } finally { await browser?.close(); await api.dispose(); await viewer.dispose(); await customer.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
