// Optional signed-in integration/browser harness. Requires the running dev app,
// Playwright/Chromium, and tsx. Uses disposable records, a local receiver and
// test-process-only dummy credentials; never contacts a customer endpoint.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { createServer } = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

(async () => {
  await import("dotenv/config");
  const { default: express } = await import("express");
  const { default: bcrypt } = await import("bcryptjs");
  const { pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { setupAuth } = await import("../server/replitAuth.ts");
  const { registerCustomerApiSettings } = await import("../server/customerApiSettings.ts");
  const { customerPushSettings } = await import("../shared/customer-api-settings.ts");
  const { enqueueCustomerDelivery, runCustomerApiWorker } = await import("../server/customerApiService.ts");
  const { getProjectFilesPath } = await import("../server/fileStorage.ts");
  const { getProjectDirectoryName } = await import("../server/fileStorage.ts");
  const realURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const tag = randomUUID().slice(0, 8);
  const users = [], roles = [], received = [];
  let browser, server, project, files, sessionStore;
  let responseStatus = 200;
  process.env.METERFLO_TEST_KEY = "dummy-integration-key";
  process.env.METERFLO_TEST_TOKEN = "dummy-integration-token";
  process.env.METERFLO_TEST_BASIC = "dummy-user:dummy-password";
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const adminRole = await storage.getAdministratorSubrole();
    assert.ok(adminRole, "Start the app before running this harness");
    const password = `Fixture-${randomUUID()}!`;
    const admin = await storage.createLocalUser(`hub-admin-${tag}`, await bcrypt.hash(password, 10),
      "admin", "API", "Fixture", null, adminRole.id);
    users.push(admin.id);
    const adminReal = await browser.newContext({ baseURL: realURL });
    assert.equal((await adminReal.request.post("/api/auth/local/login", { data: { username: admin.username, password } })).status(), 200);
    const permissionResponse = await adminReal.request.get("/api/permissions");
    const permissionList = await permissionResponse.json();
    for (const key of ["projects.edit", "project.apiImport", "settings.customerApiLogs"]) {
      assert.ok(permissionList.some(p => p.key === key), `Permission must be discoverable: ${key}`);
    }
    const schemaName = `hub_fixture_${tag}`;
    project = await storage.createProjectWithFullData({ name: `Customer API hub fixture ${tag}`, databaseName: schemaName, isActive: true });
    const endpoint = `/api/projects/${project.id}/customer-api`;

    // Normal session middleware verifies the real app's signed cookies. Only
    // this test process has dummy credential variables; the running app does not.
    const app = express();
    app.use(express.json({ limit: "2mb" }));
    await setupAuth(app);
    app.use((req, _res, next) => { sessionStore = req.sessionStore; next(); });
    registerCustomerApiSettings(app);
    app.post("/receiver", (req, res) => {
      received.push({ headers: req.headers, body: req.body });
      res.status(responseStatus).json({ accepted: responseStatus === 200 });
    });
    app.use("/api", async (req, res) => {
      try {
        const upstream = await fetch(realURL + req.originalUrl, {
          method: req.method, headers: {
            ...(req.headers.cookie ? { cookie: req.headers.cookie } : {}),
            ...(req.body && Object.keys(req.body).length ? { "content-type": "application/json" } : {}),
          },
          ...(req.method !== "GET" && req.method !== "HEAD" ? { body: JSON.stringify(req.body ?? {}) } : {}),
          redirect: "manual",
        });
        res.status(upstream.status);
        for (const key of ["content-type", "location"]) {
          if (upstream.headers.has(key)) res.setHeader(key, upstream.headers.get(key));
        }
        res.send(Buffer.from(await upstream.arrayBuffer()));
      } catch { res.status(502).send("Test frontend proxy failed"); }
    });
    // Exercise the shipped UI, not Vite's HMR client through an HTTP-only proxy.
    app.use(express.static(path.resolve("dist/public")));
    app.get("*", (_req, res) => res.sendFile(path.resolve("dist/public/index.html")));
    server = createServer(app);
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const baseURL = `http://127.0.0.1:${server.address().port}`;
    const authenticated = async realContext => {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
      await context.addCookies((await realContext.cookies(realURL)).map(cookie => ({
        name: cookie.name, value: cookie.value, domain: "127.0.0.1", path: "/", httpOnly: true, secure: false,
      })));
      return context;
    };
    const adminContext = await authenticated(adminReal);
    const settings = { ...customerPushSettings({}), customerApiEnabled: true, customerApiUrl: `${baseURL}/receiver` };
    const save = async data => {
      const response = await adminContext.request.put(endpoint, { data });
      assert.equal(response.status(), 200, "Valid push settings must save");
      const saved = await response.json();
      assert.deepEqual(saved.settings, data);
      assert.deepEqual((await (await adminContext.request.get(endpoint)).json()).settings, data);
      return saved;
    };
    assert.equal((await (await browser.newContext({ baseURL })).request.get(endpoint)).status(), 401);
    assert.equal((await adminContext.request.put(endpoint, { data: { ...settings, customerApiUrl: "ftp://bad" } })).status(), 400);
    assert.equal((await adminContext.request.put(endpoint, { data: { ...settings, customerApiAuthType: "bearer_token", customerApiSecretEnvVar: "ABSENT_HUB_FIXTURE" } })).status(), 400);
    assert.equal((await adminContext.request.put(endpoint, { data: { ...settings, customerApiAuthType: "api_key", customerApiSecretEnvVar: "METERFLO_TEST_KEY", customerApiKeyHeader: "Idempotency-Key" } })).status(), 400);
    assert.equal((await adminReal.request.patch(`/api/projects/${project.id}`, { data: { customerApiEnabled: true, customerApiUrl: "not-a-url" } })).status(), 400);
    assert.equal((await adminReal.request.post("/api/projects", { data: { name: `Invalid hub fixture ${tag}`, customerApiEnabled: true, customerApiUrl: "bad" } })).status(), 400);

    // Preserve an existing pull source byte-for-byte while repeatedly saving push.
    const sourceResponse = await adminReal.request.post(`/api/projects/${project.id}/api-import/configs`, { data: {
      name: "Disabled fixture source", endpoint: `${baseURL}/receiver`, authType: "none",
      recordsPath: "", fieldMapping: { id: "customerWoId", customer: "customerId", name: "customerName", address: "address", service: "serviceType" },
      queryParams: {}, pagination: "none", intervalMinutes: 0, isEnabled: false, updateMode: "create_only", updateFields: [],
    } });
    assert.equal(sourceResponse.status(), 201);
    const source = await sourceResponse.json();
    const sourceBefore = (await pool.query("SELECT settings FROM public.api_import_configs WHERE id=$1", [source.id])).rows[0].settings;

    files = path.join(await getProjectFilesPath(), getProjectDirectoryName(project.name, project.id));
    const workOrderId = 707;
    const customerWoId = `FIXTURE-${tag}`;
    for (const category of ["before", "after", "trouble", "signature", "other"]) {
      const dir = path.join(files, "Work Orders", customerWoId, category);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, `${category}.png`), Buffer.from("fixture-image-bytes"));
    }
    let revision = 0;
    const enqueue = async (status = "Completed") => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await enqueueCustomerDelivery(client, schemaName, {
          id: workOrderId, customer_wo_id: customerWoId, customer_id: "FIXTURE-CUSTOMER", status,
          new_system_id: "NEW-FIXTURE", new_module_id: "MODULE-FIXTURE", new_gps: "3,4",
          signature_name: "Fixture signer", notes: `Fixture revision ${++revision}`, updated_at: new Date(),
        });
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
      return (await pool.query("SELECT * FROM public.customer_api_deliveries WHERE project_id=$1 ORDER BY created_at DESC LIMIT 1", [project.id])).rows[0];
    };
    const send = async job => {
      await pool.query("UPDATE public.customer_api_deliveries SET next_attempt_at=now() WHERE id=$1", [job.id]);
      await runCustomerApiWorker(project.id);
      for (let attempt = 0; attempt < 100; attempt++) {
        const saved = (await pool.query("SELECT * FROM public.customer_api_deliveries WHERE id=$1", [job.id])).rows[0];
        if (saved.status !== "processing") return saved;
        await new Promise(resolve => setTimeout(resolve, 20));
      }
      throw new Error("Fixture delivery did not finish its processing claim");
    };
    for (const [auth, variable, header, expected] of [
      ["none", "", "authorization", undefined],
      ["api_key", "METERFLO_TEST_KEY", "x-api-key", process.env.METERFLO_TEST_KEY],
      ["bearer_token", "METERFLO_TEST_TOKEN", "authorization", `Bearer ${process.env.METERFLO_TEST_TOKEN}`],
      ["basic_auth", "METERFLO_TEST_BASIC", "authorization", `Basic ${Buffer.from(process.env.METERFLO_TEST_BASIC).toString("base64")}`],
    ]) {
      const mode = { ...settings, customerApiAuthType: auth, customerApiSecretEnvVar: variable };
      assert.equal((await save(mode)).credentialStatus, auth === "none" ? "not_required" : "available");
      assert.equal((await send(await enqueue())).status, "delivered");
      const request = received.at(-1);
      assert.equal(request.headers[header], expected);
      assert.equal(request.headers["content-type"], "application/json");
      assert.equal(request.body.newSystemId, "NEW-FIXTURE");
      assert.equal(request.body.newGps, "3,4");
      assert.deepEqual(new Set(request.body.photos.map(p => p.type)), new Set(["before", "after", "trouble", "signature", "photo"]));
      assert.ok(request.body.signature);
    }
    await save({ ...settings, customerApiAuthType: "api_key", customerApiSecretEnvVar: "METERFLO_TEST_KEY", customerApiKeyHeader: "X-Customer-Key", customerApiSendPhotos: false });
    assert.equal((await send(await enqueue("Trouble"))).status, "delivered");
    assert.equal(received.at(-1).headers["x-customer-key"], process.env.METERFLO_TEST_KEY);
    assert.equal(received.at(-1).body.photos, undefined);
    assert.equal(received.at(-1).body.signature, undefined);
    assert.equal(received.at(-1).body.signatureName, "Fixture signer");
    await save({ ...settings, customerApiEnabled: false, customerApiUrl: "" });
    const before = received.length;
    const count = Number((await pool.query("SELECT count(*) FROM public.customer_api_deliveries WHERE project_id=$1", [project.id])).rows[0].count);
    await enqueue();
    assert.equal(Number((await pool.query("SELECT count(*) FROM public.customer_api_deliveries WHERE project_id=$1", [project.id])).rows[0].count), count);
    assert.equal(received.length, before);
    assert.deepEqual((await pool.query("SELECT settings FROM public.api_import_configs WHERE id=$1", [source.id])).rows[0].settings, sourceBefore);

    await save({ ...settings, customerApiSendPhotos: false });
    responseStatus = 503;
    const retryJob = await enqueue();
    assert.equal((await send(retryJob)).status, "retrying");
    responseStatus = 200;
    assert.equal((await send(retryJob)).status, "delivered");
    await pool.query("UPDATE public.customer_api_deliveries SET status='failed' WHERE id=$1", [retryJob.id]);
    assert.equal((await adminReal.request.post(`/api/customer-api-deliveries/${retryJob.id}/retry`, { data: {} })).status(), 202);
    assert.equal((await send(retryJob)).status, "delivered");
    assert.equal((await adminReal.request.get(`/api/customer-api-deliveries/${retryJob.id}/attempts`)).status(), 200);
    // Ordinary project edits must not overwrite integration settings.
    const savedBefore = (await (await adminContext.request.get(endpoint)).json()).settings;
    assert.equal((await adminReal.request.patch(`/api/projects/${project.id}`, { data: { description: "Fixture details changed" } })).status(), 200);
    assert.deepEqual((await (await adminContext.request.get(endpoint)).json()).settings, savedBefore);
    console.log("PASS saved settings and local delivery: four auth modes, default/custom headers, all image categories, images off, disabled drafts, preserved pull source, automatic/admin retries");

    await pool.query("UPDATE public.customer_api_deliveries SET status='failed' WHERE id=$1", [retryJob.id]);
    const page = await adminContext.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${project.id}/customer-api`);
    await page.getByTestId("input-customer-api-url").waitFor();
    const choose = async name => {
      await page.getByTestId("select-customer-api-auth-type").click();
      await page.getByRole("option", { name, exact: true }).click();
    };
    for (const [label, variable] of [["API key header", "METERFLO_TEST_KEY"], ["Bearer token", "METERFLO_TEST_TOKEN"], ["Basic authentication", "METERFLO_TEST_BASIC"], ["No authentication", ""]]) {
      await choose(label);
      assert.equal(await page.getByTestId("input-customer-api-key-header").count(), label === "API key header" ? 1 : 0);
      assert.equal(await page.getByTestId("input-customer-api-secret-env-var").count(), variable ? 1 : 0);
      if (variable) await page.getByTestId("input-customer-api-secret-env-var").fill(variable);
      const saved = page.waitForResponse(response => response.url().endsWith(endpoint) && response.request().method() === "PUT");
      await page.getByTestId("button-save-push").click();
      assert.equal((await saved).status(), 200);
      await page.reload();
      await page.getByTestId("select-customer-api-auth-type").filter({ hasText: label }).waitFor();
    }
    await page.getByTestId("input-customer-api-url").fill("bad");
    await page.getByTestId("button-save-push").click();
    await page.getByText(/Enter a complete HTTP/).waitFor();
    await page.getByTestId("input-customer-api-url").fill(`${baseURL}/receiver`);
    await choose("Bearer token");
    await page.getByTestId("input-customer-api-secret-env-var").fill("ABSENT_HUB_FIXTURE");
    await page.getByTestId("button-save-push").click();
    await page.getByText(/server variable is not configured/i).waitFor();
    await page.reload();
    await page.getByRole("tab", { name: "Pull import", exact: true }).click();
    await page.getByRole("heading", { name: "Customer API pull", exact: true }).waitFor();
    assert.ok(page.url().includes("section=pull"));
    await page.goto(`/projects/${project.id}/api-import`);
    await page.getByRole("heading", { name: "Customer API pull", exact: true }).waitFor();
    await page.goto(`/projects/${project.id}/edit`);
    await page.getByRole("link", { name: "Open Customer API setup", exact: true }).waitFor();
    assert.equal(await page.getByTestId("switch-customer-api-enabled").count(), 0);
    await page.goto(`/projects/${project.id}/customer-api`);
    const retryResponse = page.waitForResponse(response => response.url().endsWith(`/api/customer-api-deliveries/${retryJob.id}/retry`) && response.request().method() === "POST");
    await page.getByTestId(`button-retry-delivery-${retryJob.id}`).click();
    assert.equal((await retryResponse).status(), 202);
    assert.equal((await send(retryJob)).status, "delivered");
    await page.getByRole("button", { name: "View attempts" }).first().click();
    await page.getByRole("dialog").getByText(/Attempt 1/).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Close" }).click();
    await page.setViewportSize({ width: 402, height: 874 });
    await fs.mkdir("/tmp/customer-api-hub-checks", { recursive: true });
    await page.screenshot({ path: "/tmp/customer-api-hub-checks/phone.png", fullPage: true });
    const widths = await page.evaluate(() => ({
      outer: document.documentElement.scrollWidth, viewport: innerWidth,
      main: document.querySelector("main").getBoundingClientRect().width,
    }));
    assert.ok(widths.outer <= widths.viewport + 1 && widths.main <= widths.viewport + 1, "Phone content must fit the viewport");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "/tmp/customer-api-hub-checks/phone-top.png" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({ path: "/tmp/customer-api-hub-checks/desktop.png" });
    console.log("PASS signed-in browser: conditional controls, all four save/reload paths, URL/missing-credential errors, Push/Pull tabs, legacy bookmark, canonical edit link, attempts, 402px layout");

    for (const [name, permissions] of [
      ["pull", ["project.apiImport"]], ["editor", ["projects.edit"]], ["logs", ["settings.customerApiLogs"]],
    ]) {
      const roleResponse = await adminReal.request.post("/api/subroles", { data: { key: `hub_${name}_${tag}`, label: `Hub fixture ${name}`, baseRole: "user" } });
      assert.equal(roleResponse.status(), 201);
      const role = await roleResponse.json(); roles.push(role.id);
      assert.equal((await adminReal.request.put(`/api/subroles/${role.id}/permissions`, { data: { permissions } })).status(), 200);
      const user = await storage.createLocalUser(`hub-${name}-${tag}`, await bcrypt.hash(password, 10), "user", "API", name, null, role.id);
      users.push(user.id);
      const realContext = await browser.newContext({ baseURL: realURL });
      assert.equal((await realContext.request.post("/api/auth/local/login", { data: { username: user.username, password } })).status(), 200);
      const context = await authenticated(realContext);
      assert.equal((await context.request.get(endpoint)).status(), 403, "Unassigned accounts must be denied");
      assert.equal((await realContext.request.patch(`/api/projects/${project.id}`, { data: { customerApiEnabled: false } })).status(), 403);
      await storage.assignUserToProject(user.id, project.id);
      assert.equal((await context.request.get(endpoint)).status(), name === "pull" ? 403 : 200);
      assert.equal((await context.request.put(endpoint, { data: settings })).status(), name === "editor" ? 200 : 403);
      assert.equal((await realContext.request.patch(`/api/projects/${project.id}`, { data: { customerApiEnabled: false } })).status(), name === "editor" ? 200 : 403);
      assert.equal((await realContext.request.post(`/api/customer-api-deliveries/${retryJob.id}/retry`, { data: {} })).status(), 403);
      assert.equal((await realContext.request.get(`/api/projects/${project.id}/api-import/configs`)).status(), name === "pull" ? 200 : 403);
      await pool.query("UPDATE public.customer_api_deliveries SET status='failed' WHERE id=$1", [retryJob.id]);
      const restrictedPage = await context.newPage();
      let pushRequests = 0;
      restrictedPage.on("request", request => { if (request.url().endsWith(endpoint)) pushRequests++; });
      await restrictedPage.goto(`/projects/${project.id}/customer-api`);
      if (name === "pull") {
        await restrictedPage.getByRole("heading", { name: "Customer API pull", exact: true }).waitFor();
        assert.equal(await restrictedPage.getByRole("tab", { name: "Push delivery", exact: true }).count(), 0);
        assert.equal(pushRequests, 0);
      } else {
        await restrictedPage.getByTestId("input-customer-api-url").waitFor();
        assert.equal(await restrictedPage.getByRole("tab", { name: "Pull import", exact: true }).count(), 0);
        if (name === "logs") {
          assert.equal(await restrictedPage.getByTestId("switch-customer-api-enabled").isDisabled(), true);
          assert.equal(await restrictedPage.getByTestId("button-save-push").count(), 0);
          assert.equal(await restrictedPage.locator('[data-testid^="button-retry-delivery-"]').count(), 0);
        }
      }
      await context.close(); await realContext.close();
    }
    console.log("PASS normal role-management grants and authorization: unassigned denial, independent pull/editor/log permissions, no pull-only push fetch, read-only logs, admin-only retry");
  } finally {
    await browser?.close();
    server?.closeAllConnections();
    if (server) await new Promise(resolve => server.close(resolve));
    if (sessionStore?.close) await sessionStore.close();
    if (project) await pool.query("DELETE FROM public.projects WHERE id=$1", [project.id]);
    if (files) await fs.rm(files, { recursive: true, force: true });
    for (const id of users) {
      await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->>'user'=$1 OR sess->'passport'->'user'->'claims'->>'sub'=$1", [id]);
      await pool.query("DELETE FROM public.users WHERE id=$1", [id]);
    }
    for (const id of roles) await pool.query("DELETE FROM public.subroles WHERE id=$1", [id]);
    await pool.end();
  }
})().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
