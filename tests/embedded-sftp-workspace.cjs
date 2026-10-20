const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const net = require("node:net");
const { randomUUID } = require("node:crypto");
const { spawnSync, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { request, chromium } = require("@playwright/test");
const SftpClient = require("ssh2-sftp-client");
const { Client, utils } = require("ssh2");
(async () => {
  const owner = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG || "", "utf8"));
  assert.equal(owner.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL: owner.baseURL }), viewer = await request.newContext({ baseURL: owner.baseURL });
  const base = `/api/projects/${fixture.projectId}/file-transfers`, root = base + "/sftp-server";
  const clients = [];
  let browser, port;
  let otherProject;
  async function json(method, url, data, status = 200) {
    const response = await api.fetch(url, { method, data }), text = await response.text();
    assert.equal(response.status(), status, `${method} ${url}: ${text.slice(0, 800)}`);
    return text ? JSON.parse(text) : null;
  }
  const key = utils.generateKeyPairSync("ed25519"), password = randomUUID() + randomUUID();
  const accountBody = extra => ({ username: `sx_${randomUUID().replaceAll("-", "").slice(0, 20)}`, label: "Owned test",
    authType: "publicKey", publicKey: key.public, canUpload: true, canDownload: true,
    expiresAt: new Date(Date.now() + 86400000).toISOString(), ...extra });
  const connect = async (account, extra = {}) => {
    const client = new SftpClient(); clients.push(client);
    await client.connect({ host: "127.0.0.1", port, username: account.username, privateKey: key.private, readyTimeout: 5000, ...extra });
    return client;
  };
  const call = (sftp, method, ...args) => new Promise((resolve, reject) => sftp[method](...args, (error, value) => error ? reject(error) : resolve(value)));
  const directoryEntries = async (wire, location) => {
    const handle = await call(wire, "opendir", location);
    const entries = [];
    try {
      while (true) {
        let batch;
        try { batch = await call(wire, "readdir", handle); }
        catch (error) {
          if (error.code === 1) break; // ssh2 reports the protocol EOF status as an error.
          throw error;
        }
        if (batch === false) break;
        entries.push(...batch);
      }
    } finally { await call(wire, "close", handle); }
    return entries.map(row => row.filename).sort();
  };
  async function finished(runId) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const row = (await json("GET", base + "/history?direction=export")).rows.find(r => r.exportRunId === runId);
      if (row && ["success", "failed"].includes(row.status)) { assert.equal(row.status, "success", JSON.stringify(row)); return row; }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    throw new Error("Export timed out.");
  }
  try {
    assert.equal((await api.get(root)).status(), 401);
    await json("POST", "/api/auth/local/login", fixture);
    await viewer.post("/api/auth/local/login", { data: fixture.viewer });
    assert.equal((await viewer.get(root)).status(), 403);
    assert.equal((await viewer.put(root + "/server", { data: {} })).status(), 403);
    const context = await json("GET", root);
    assert.equal(context.supported, true); assert.equal(context.server.enabled, false); assert.equal(context.server.running, false);
    await json("PUT", root + "/server", { enabled: true, host: "127.0.0.1", publicHost: "127.0.0.1",
      port: Number(new URL(owner.baseURL).port) }, 400);
    port = await new Promise(resolve => { const server = net.createServer().listen(0, "127.0.0.1", () => {
      const chosen = server.address().port; server.close(() => resolve(chosen));
    }); });
    const serverBody = { enabled: true, host: "127.0.0.1", publicHost: "127.0.0.1", port };
    const started = await json("PUT", root + "/server", serverBody);
    assert.equal(started.running, true); assert.match(started.fingerprint, /^SHA256:/);
    const fingerprint = started.fingerprint;
    const full = await json("POST", root + "/accounts", accountBody(), 201);
    const download = await json("POST", root + "/accounts", accountBody({ canUpload: false }), 201);
    const upload = await json("POST", root + "/accounts", accountBody({ canDownload: false }), 201);
    const pwd = await json("POST", root + "/accounts", accountBody({ authType: "password", publicKey: undefined, password }), 201);
    await json("POST", root + "/accounts", accountBody({ username: full.username }), 409);
    await json("POST", root + "/accounts", accountBody({ publicKey: key.private }), 400);
    await json("POST", root + "/accounts", accountBody({ expiresAt: new Date(Date.now() - 1000).toISOString() }), 400);
    const saved = JSON.stringify(await json("GET", root));
    assert.ok(!saved.includes(password)); assert.ok(!saved.includes(key.private)); assert.ok(!saved.includes(key.public));
    const sftp = await connect(full);
    const raw = sftp.sftp;
    assert.deepEqual((await sftp.list("/")).map(r => r.name).sort(), ["incoming", "outgoing"]);
    assert.deepEqual(await sftp.list("/incoming"), []);
    // Raw wire replay: high-level clients often normalize these paths before transmitting them.
    // The Windows screenshot does not contain the exact request; exercise each plausible alias.
    for (const location of ["/.", "/./", "//.", "//./", "./.", "/incoming/..", "/outgoing/../."]) {
      assert.equal(await call(raw, "realpath", location), "/", location);
      assert.deepEqual(await directoryEntries(raw, location), ["incoming", "outgoing"], location);
      assert.ok((await call(raw, "stat", location)).isDirectory());
      assert.ok((await call(raw, "lstat", location)).isDirectory());
    }
    for (const location of ["./incoming/.", "/incoming//./", "/outgoing/../incoming/"]) {
      assert.equal(await call(raw, "realpath", location), "/incoming");
      assert.deepEqual(await directoryEntries(raw, location), []);
    }
    const safeDiscovery = await json("GET", root + "/events?report=1");
    assert.ok(!safeDiscovery.rows.some(row => ["realpath", "opendir", "stat", "lstat"].includes(row.action) && row.status === "failed"));
    for (const location of ["/..", "/incoming/../../outgoing", "//server/share", "C:/Windows",
      "\\\\server\\share", "/unknown/../incoming", "/incoming/a.csv/.."]) {
      for (const operation of ["realpath", "stat", "lstat", "opendir"])
        await assert.rejects(call(raw, operation, location), `${operation} must deny ${location}`);
    }
    await assert.rejects(sftp.get("/../../etc/passwd"));
    await assert.rejects(sftp.put(Buffer.from("no"), "/outgoing/not_allowed.csv"));
    await assert.rejects(sftp.mkdir("/incoming/child"));
    await assert.rejects(sftp.put(Buffer.from("no"), "/incoming/not_allowed.exe"));
    const filename = `customer_${randomUUID()}.csv`;
    const csv = Buffer.from('wo,customer,name,address,service\nINBOUND-SFTP-1,C-1,Owned customer,100 Test St,workspace-fixture\n');
    // File OPEN uses the same canonical resolver as discovery; writes cannot bypass custody rules.
    const aliasHandle = await call(raw, "open", "/./incoming//./" + filename, "w");
    await call(raw, "write", aliasHandle, csv, 0, csv.length, 0);
    await call(raw, "close", aliasHandle);
    await assert.rejects(sftp.put(Buffer.from("replacement"), "/incoming/" + filename), "Never overwrite a prior upload");
    await assert.rejects(sftp.get("/incoming/" + filename), "Inbox is upload-only");
    await assert.rejects(sftp.rename("/incoming/" + filename, "/incoming/renamed.csv"));
    await assert.rejects(sftp.delete("/incoming/" + filename));
    const transferContext = await json("GET", base);
    const guide = transferContext.columnGuide;
    const guideCheck = spawnSync(process.execPath, ["--import", "tsx", "tests/https-transfers-data.ts", "guide-contract"], { env: process.env, encoding: "utf8" });
    assert.equal(guideCheck.status, 0, guideCheck.stdout + guideCheck.stderr);
    assert.ok(guide.checkedAgainst.includes("Live"));
    for (const field of ["customerId", "customerName", "address"])
      assert.equal(guide.columns.find(c => c.field === field).requirement, "required");
    assert.equal(guide.columns.find(c => c.field === "customerWoId").requirement, "generated");
    const local = await json("POST", `/api/projects/${fixture.projectId}/file-import-configs`, {
      name: "Embedded SFTP to local importer", source: "local", processedFilePattern: filename, scheduleFrequency: "manual", isEnabled: true,
      delimiter: ",", hasHeader: true, columnMapping: { customerWoId: "wo", customerId: "customer", customerName: "name", address: "address", serviceType: "service" },
    }, 201);
    const imported = await json("POST", `/api/file-import-configs/${local.id}/run`);
    assert.equal(imported.imported, 1, JSON.stringify(imported)); assert.equal(imported.failed, 0);
    assert.equal((await json("POST", `/api/file-import-configs/${local.id}/run`)).imported, 0);
    const config = await json("POST", base + "/exports", { name: "Inbound SFTP download", format: "csv", mode: "full",
      allStatuses: true, statusIds: [], subStatusIds: [], columns: ["customerWoId", "customerName", "address"],
      filenameTemplate: "download_{runId}", destination: "local", remoteDirectory: "", scheduleFrequency: "manual", isEnabled: false }, 201);
    const run = await json("POST", base + `/exports/${config.id}/run`, {}, 202), exported = await finished(run.id);
    assert.ok((await sftp.list("/outgoing")).some(r => r.name === exported.fileName));
    assert.match((await sftp.get("/outgoing/" + exported.fileName)).toString(), /INBOUND-SFTP-1/);
    const readAlias = await call(raw, "open", "./outgoing//./" + exported.fileName, "r");
    const downloadBytes = Buffer.alloc(4096);
    const bytesRead = await new Promise((resolve, reject) => raw.read(readAlias, downloadBytes, 0, downloadBytes.length, 0,
      (error, count) => error ? reject(error) : resolve(count)));
    assert.match(downloadBytes.subarray(0, bytesRead).toString(), /INBOUND-SFTP-1/);
    await call(raw, "close", readAlias);
    otherProject = await json("POST", "/api/projects", { name: "Owned isolated SFTP " + randomUUID() }, 201);
    const otherRoot = `/api/projects/${otherProject.id}/file-transfers/sftp-server`;
    const other = await json("POST", otherRoot + "/accounts", accountBody({ canUpload: false }), 201), isolated = await connect(other);
    assert.deepEqual(await isolated.list("/outgoing"), []);
    await assert.rejects(isolated.get("/outgoing/" + exported.fileName), "Another project cannot read this project's exports");
    await isolated.end();
    const dl = await connect(download), up = await connect(upload);
    assert.deepEqual(await directoryEntries(dl.sftp, "/."), ["outgoing"]);
    assert.deepEqual(await directoryEntries(up.sftp, "/./"), ["incoming"]);
    for (const operation of ["realpath", "stat", "lstat", "opendir"]) {
      await assert.rejects(call(dl.sftp, operation, "/incoming/."), "Download-only cannot discover inbox");
      await assert.rejects(call(up.sftp, operation, "/outgoing/."), "Upload-only cannot discover outbox");
    }
    await assert.rejects(call(dl.sftp, "open", "/outgoing/../incoming/denied.csv", "w"));
    await assert.rejects(call(up.sftp, "open", "/incoming/../outgoing/" + exported.fileName, "r"));
    await assert.rejects(dl.put(csv, "/incoming/denied.csv"));
    await assert.rejects(up.get("/outgoing/" + exported.fileName));
    const pc = await connect(pwd, { privateKey: undefined, password });
    await assert.rejects(connect(pwd, { privateKey: undefined, password: "wrong-password-not-a-secret" }));
    await pc.end();
    // Expiry applies to an already-connected client without restarting MeterFlo.
    const expiring = await json("POST", root + "/accounts", accountBody({ expiresAt: new Date(Date.now() + 2500).toISOString() }), 201);
    const expires = await connect(expiring);
    await new Promise(resolve => setTimeout(resolve, 2700));
    await assert.rejects(expires.list("/")); await expires.end();
    await assert.rejects(connect(expiring));
    const initialLock = await json("GET", `/api/projects/${fixture.projectId}/access-lock`);
    const locked = await json("PUT", `/api/projects/${fixture.projectId}/access-lock`, { locked: true, message: "Owned SFTP lock test", expectedUpdatedAt: initialLock.updatedAt });
    await assert.rejects(sftp.list("/"), "Existing SFTP session respects project lock");
    await json("PUT", `/api/projects/${fixture.projectId}/access-lock`, { locked: false, message: "", expectedUpdatedAt: locked.updatedAt });
    assert.ok((await sftp.list("/")).length);
    // Protocol-level partial uploads are not visible to the importer and are discarded on disconnect.
    const partial = await connect(full), partialName = "partial_" + randomUUID() + ".csv";
    const h = await call(partial.sftp, "open", "/incoming/" + partialName, "w");
    await call(partial.sftp, "write", h, csv, 0, csv.length, 0);
    const pendingImport = await json("POST", `/api/projects/${fixture.projectId}/file-import-configs`, {
      name: "No partial imports", source: "local", processedFilePattern: partialName, scheduleFrequency: "manual", isEnabled: true,
      columnMapping: { customerWoId: "wo", customerId: "customer", customerName: "name", address: "address", serviceType: "service" },
    }, 201);
    assert.equal((await json("POST", `/api/file-import-configs/${pendingImport.id}/run`)).imported, 0);
    await partial.end();
    // Invalid sequential offsets poison the upload: closing cannot publish a truncated file.
    const invalidHandle = await call(raw, "open", "/incoming/invalid_offset.csv", "w");
    await assert.rejects(call(raw, "write", invalidHandle, csv, 0, csv.length, 1));
    await assert.rejects(call(raw, "close", invalidHandle));
    // Real OpenSSH interoperability, including public-key authentication and generated export download.
    const directory = await fs.mkdtemp("/tmp/meterflo-openssh-");
    try {
      const keyfile = path.join(directory, "key"), batch = path.join(directory, "batch");
      await fs.writeFile(keyfile, key.private, { mode: 0o600 });
      await fs.writeFile(path.join(directory, "upload.csv"), csv);
      await fs.writeFile(batch, "ls /outgoing\nget /outgoing/" + exported.fileName + " " + path.join(directory, "download.csv") +
        "\nput " + path.join(directory, "upload.csv") + " /incoming/openssh_" + randomUUID() + ".csv\n");
      await promisify(execFile)("sftp", ["-vvv", "-b", batch, "-P", String(port), "-i", keyfile, "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=no",
        "-o", "UserKnownHostsFile=" + path.join(directory, "known_hosts"), full.username + "@127.0.0.1"], { encoding: "utf8", timeout: 20000 });
      assert.match(await fs.readFile(path.join(directory, "download.csv"), "utf8"), /INBOUND-SFTP-1/);
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
    // No remote commands, shells, or TCP forwarding, even with valid credentials.
    const ssh = new Client();
    await new Promise((resolve, reject) => { ssh.once("ready", resolve).once("error", reject).connect({ host: "127.0.0.1", port, username: full.username, privateKey: key.private }); });
    await assert.rejects(new Promise((resolve, reject) => ssh.exec("whoami", (err, channel) => err ? reject(err) : resolve(channel))));
    await assert.rejects(new Promise((resolve, reject) => ssh.forwardOut("127.0.0.1", 12345, "127.0.0.1", 80, (err, channel) => err ? reject(err) : resolve(channel))));
    ssh.end();
    // Existing sessions stop working immediately when their account is revoked.
    await json("DELETE", root + `/accounts/${upload.id}`);
    await assert.rejects(up.list("/"));
    await assert.rejects(connect(upload));
    await json("POST", root + "/restart");
    assert.equal((await json("GET", root)).server.fingerprint, fingerprint);
    const next = await connect(full); await next.end();
    const history = await json("GET", root + "/events?report=1");
    assert.ok(history.rows.some(e => e.action === "upload" && e.status === "success" && e.fileName === filename));
    assert.ok(history.rows.some(e => e.action === "download" && e.status === "success"));
    assert.ok(history.rows.some(e => e.action === "authentication" && e.status === "failed"));
    assert.ok(!JSON.stringify(history).includes(password)); assert.ok(!JSON.stringify(history).includes(key.private));
    const filtered = await json("GET", root + "/events?search=" + filename);
    assert.ok(filtered.total > 0); assert.equal((await json("GET", root + "/events?from=2099-01-01")).total, 0);
    await json("GET", root + "/events?from=2026-03-31&to=2026-01-01", undefined, 400);
    // Exercise actual authenticated responsive UI, not mocked component snapshots.
    browser = await chromium.launch({ headless: true, executablePath: "/repl/tools/bin/chromium",
      args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const browserContext = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 1280, height: 900 } });
    const page = await browserContext.newPage();
    await page.goto(owner.baseURL + `/projects/${fixture.projectId}/import`);
    await page.getByRole("tab", { name: "SFTP Server", exact: true }).click();
    await page.getByText(full.username, { exact: true }).first().waitFor();
    await page.screenshot({ path: "generated-artifacts/project-workspace/embedded-sftp-desktop.jpg", fullPage: true });
    await page.getByRole("tab", { name: "Server settings", exact: true }).click();
    await page.getByLabel("Public hostname", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Public hostname", { exact: true }).inputValue(), "127.0.0.1");
    await page.screenshot({ path: "generated-artifacts/project-workspace/embedded-sftp-settings.jpg", fullPage: true });
    await browserContext.close();
    const phone = await browser.newContext({ storageState: await api.storageState(), viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const mobile = await phone.newPage();
    await mobile.goto(owner.baseURL + `/projects/${fixture.projectId}/import`);
    const selects = mobile.locator("select");
    await selects.first().selectOption("sftp-server");
    await mobile.getByText(full.username, { exact: true }).first().waitFor();
    assert.ok(await mobile.locator("body").evaluate(el => el.scrollWidth <= innerWidth + 1));
    await mobile.screenshot({ path: "generated-artifacts/project-workspace/embedded-sftp-phone.jpg", fullPage: true });
    await mobile.setViewportSize({ width: 844, height: 390 });
    await mobile.waitForTimeout(300);
    assert.ok(await selects.first().isVisible(), "Touch landscape retains compact tabs");
    await mobile.getByLabel("SFTP Server section", { exact: true }).waitFor();
    await mobile.screenshot({ path: "generated-artifacts/project-workspace/embedded-sftp-landscape.jpg", fullPage: false });
    await phone.close();
    await json("PUT", root + "/server", { ...serverBody, enabled: false });
    assert.equal((await json("GET", root)).server.running, false);
    await assert.rejects(connect(full));
    const rolePermissions = await json("GET", `/api/subroles/${fixture.viewerRoleId}/permissions`);
    await json("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: [...rolePermissions, "project.sftpConnections"] });
    assert.equal((await viewer.get(root)).status(), 200, "Delegated project SFTP permission permits account management");
    assert.equal((await viewer.put(root + "/server", { data: serverBody })).status(), 403, "Delegated SFTP permission cannot enable the shared listener");
    console.log("PASS embedded SFTP: real key/password SSH, OpenSSH compatibility, atomic uploads/imports/exports, isolation, revocation, persistence, reports, responsive UI");
  } finally {
    await api.put(root + "/server", { data: { enabled: false, host: "127.0.0.1", publicHost: "127.0.0.1", port: port || 2222 } }).catch(() => {});
    for (const client of clients) await client.end().catch(() => {});
    if (otherProject) await api.delete(`/api/projects/${otherProject.id}`).catch(() => {});
    if (browser) await browser.close();
    await api.dispose(); await viewer.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
