// Isolated cookie-policy/browser test. Password/lock checks use the REAL local
// login endpoint. No live environment flags or existing user accounts are changed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const express = require("express");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

(async () => {
  const { setupAuth } = await import("../server/replitAuth.ts");
  const { pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { default: bcrypt } = await import("bcryptjs");
  const base = process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000";
  const accounts = [], servers = [];
  let browser;
  const password = `Recovery-test-${randomUUID()}!`;
  try {
    const adminRole = await storage.getAdministratorSubrole();
    for (const role of ["admin", "user"]) {
      accounts.push(await storage.createLocalUser(`recovery-${role}-${randomUUID().slice(0, 8)}`,
        await bcrypt.hash(password, 10), role, "Recovery", "Test", null, role === "admin" ? adminRole.id : null));
    }
    const [admin, user] = accounts;
    const start = async environment => {
      const app = express();
      app.use(express.json());
      await setupAuth(app, environment); // Inject ONLY non-secret cookie flags.
      app.post("/api/auth/local/login", async (req, res, next) => {
        try {
          // Exercise actual password validation and account-lock enforcement.
          const upstream = await fetch(`${base}/api/auth/local/login`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body),
          });
          const body = await upstream.json();
          if (!upstream.ok) return res.status(upstream.status).json({ message: body.message });
          req.login({ claims: { sub: body.user.id }, expires_at: Math.floor(Date.now() / 1000) + 3600 }, error => {
            if (error) return next(error);
            res.json({ message: "Login successful" });
          });
        } catch (error) { next(error); }
      });
      app.use("/api", async (req, res) => {
        const upstream = await fetch(`${base}${req.originalUrl}`, { headers: { cookie: req.headers.cookie || "" } });
        res.status(upstream.status).type("json").send(await upstream.text());
      });
      app.use(express.static(path.resolve("dist/public")));
      app.get("*", (_, res) => res.sendFile(path.resolve("dist/public/index.html")));
      const server = app.listen(0, "127.0.0.1");
      servers.push(server);
      await new Promise(resolve => server.once("listening", resolve));
      return `http://127.0.0.1:${server.address().port}`;
    };
    const recovery = await start({ COOKIE_SECURE: "true", EMERGENCY_HTTP_LOGIN: "true" });
    const normal = await start({ COOKIE_SECURE: "true", EMERGENCY_HTTP_LOGIN: "false" });
    const intentionallyHttp = await start({ COOKIE_SECURE: "false", EMERGENCY_HTTP_LOGIN: "false" });
    const login = (url, account, headers = {}, supplied = password) => fetch(`${url}/api/auth/local/login`, {
      method: "POST", headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ username: account.username, password: supplied }),
    });
    assert.equal((await login(recovery, admin, {}, "wrong-password")).status, 401);
    await pool.query("UPDATE public.users SET is_locked=true WHERE id=$1", [user.id]);
    assert.equal((await login(recovery, user)).status, 403);
    await pool.query("UPDATE public.users SET is_locked=false WHERE id=$1", [user.id]);
    const httpSecure = await login(normal, admin);
    assert.equal(httpSecure.headers.get("set-cookie"), null, "Secure cookies must not be issued over HTTP");
    const recovered = await login(recovery, admin);
    const setCookie = recovered.headers.get("set-cookie");
    assert.ok(setCookie && !/;\s*Secure/i.test(setCookie));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0];
    const enabled = await fetch(`${recovery}/api/security/http-login-recovery`, { headers: { cookie } });
    assert.deepEqual(await enabled.json(), { enabled: true });
    assert.equal(enabled.headers.get("cache-control"), "no-store");
    assert.equal((await fetch(`${recovery}/api/security/http-login-recovery`)).status, 401);
    const userLogin = await login(recovery, user);
    const userCookie = userLogin.headers.get("set-cookie").split(";")[0];
    assert.equal((await fetch(`${recovery}/api/security/http-login-recovery`, { headers: { cookie: userCookie } })).status, 403);
    const restored = await fetch(`${normal}/api/security/http-login-recovery`, {
      headers: { cookie, "X-Forwarded-Proto": "https" },
    });
    assert.deepEqual(await restored.json(), { enabled: false });
    assert.match(restored.headers.get("set-cookie"), /;\s*Secure/i, "Stored recovery sessions must regain secure cookies");
    const httpsLogin = await login(normal, admin, { "X-Forwarded-Proto": "https" });
    assert.match(httpsLogin.headers.get("set-cookie"), /;\s*Secure/i);
    assert.ok((await login(intentionallyHttp, admin)).headers.get("set-cookie"));
    // Expiry checks remain enforced (use only this disposable test session).
    const expiredLogin = await login(recovery, user);
    const expiredCookie = expiredLogin.headers.get("set-cookie").split(";")[0];
    await pool.query(`UPDATE public.sessions SET sess=jsonb_set(sess::jsonb,
      '{passport,user,expires_at}', '1'::jsonb)::json
      WHERE sess->'passport'->'user'->'claims'->>'sub'=$1`, [user.id]);
    assert.equal((await fetch(`${recovery}/api/security/http-login-recovery`, { headers: { cookie: expiredCookie } })).status, 401);
    console.log("PASS cookie policy: HTTP recovery, restored HTTPS/new and persisted cookies, deliberate HTTP, passwords, locks, roles and expiry");

    browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    assert.equal((await context.request.post(`${recovery}/api/auth/local/login`,
      { data: { username: admin.username, password } })).status(), 200);
    const page = await context.newPage();
    await page.goto(`${recovery}/projects`);
    const alert = page.getByTestId("alert-http-login-recovery");
    await alert.waitFor();
    assert.ok((await alert.textContent()).includes("all users"));
    assert.equal(await alert.getByRole("button").count(), 0);
    await page.screenshot({ path: "/tmp/http-recovery-desktop.png" });
    await alert.getByRole("link").click();
    await page.locator("#temporary-http-login-recovery").waitFor();
    await page.goto(`${recovery}/projects`);
    await page.setViewportSize({ width: 402, height: 874 });
    await alert.waitFor();
    assert.ok(await alert.evaluate(el => el.scrollWidth <= el.clientWidth + 1));
    await page.screenshot({ path: "/tmp/http-recovery-phone.png" });
    // A separate non-admin browser must not request the admin status API.
    const userContext = await browser.newContext();
    await userContext.request.post(`${recovery}/api/auth/local/login`, { data: { username: user.username, password } });
    const userPage = await userContext.newPage();
    const statusRequests = [];
    userPage.on("request", request => {
      if (request.url().includes("/api/security/http-login-recovery")) statusRequests.push(request.url());
    });
    await userPage.goto(`${recovery}/`);
    await userPage.getByTestId("button-sidebar-toggle").waitFor();
    assert.equal(await userPage.getByTestId("alert-http-login-recovery").count(), 0);
    assert.deepEqual(statusRequests, []);
    const disabledContext = await browser.newContext();
    await disabledContext.request.post(`${intentionallyHttp}/api/auth/local/login`,
      { data: { username: admin.username, password } });
    const disabledPage = await disabledContext.newPage();
    const disabledStatus = disabledPage.waitForResponse(r => r.url().includes("/api/security/http-login-recovery") && r.status() === 200);
    await disabledPage.goto(`${intentionallyHttp}/projects`);
    await disabledStatus;
    assert.equal(await disabledPage.getByTestId("alert-http-login-recovery").count(), 0);
    const unknownPage = await disabledContext.newPage();
    await unknownPage.route("**/api/security/http-login-recovery", route =>
      route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"Test-only unavailable status"}' }));
    await unknownPage.goto(`${intentionallyHttp}/projects`);
    await unknownPage.getByText("Unable to confirm HTTP login recovery status", { exact: true }).waitFor();
    console.log("PASS signed-in UI: persistent admin warning, documentation link, phone layout, non-admin exclusion, disabled warning and explicit failed-status warning");
  } finally {
    if (browser) await browser.close();
    for (const server of servers) await new Promise(resolve => server.close(resolve));
    for (const account of accounts) {
      await pool.query(`DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=$1`, [account.id]);
      await pool.query("DELETE FROM public.users WHERE id=$1", [account.id]);
    }
    await pool.end();
  }
})().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); });
