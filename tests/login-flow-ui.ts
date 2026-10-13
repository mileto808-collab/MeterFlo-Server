/**
 * Portable built-UI acceptance checks with disposable, normal Passport sessions.
 * No production DB, credentials or auth bypasses in shipped code.
 * Build first. Optional CLI args: Playwright module path, Chromium executable.
 */
import assert from "node:assert/strict";
import express from "express";
import session from "express-session";
import { Passport } from "passport";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { registerLogoutRoute } from "../server/replitAuth";

const { chromium } = await import(process.argv[2] || "playwright");
const app = express();
const passport = new Passport();
passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user: Express.User, done) => done(null, user));
app.use(express.json());
app.use(session({ secret: "public-ui-fixture-only-secret", resave: false, saveUninitialized: false }));
app.use(passport.initialize());
app.use(passport.session());

type FixtureMode = "disabled" | "enabled" | "bypassed" | "verified" | "missing-key" |
  "status-error" | "config-error" | "malformed" | "hang" | "verify-fail" | "unconfirmed";
let mode: FixtureMode = "disabled";
let verified = false;
let statusCalls = 0;
let loginCalls = 0;
const account = { id: "ui-fixture", username: "navigation-fixture", role: "user" };

app.get("/api/auth/user", (req, res) => req.isAuthenticated()
  ? res.json(account) : res.status(401).json({ message: "Unauthorized" }));
app.post("/api/auth/local/login", (req, res, next) => {
  loginCalls++;
  if (req.body.username !== account.username || req.body.password !== "FixtureOnly1!") {
    return res.status(401).json({ message: "Invalid username or password" });
  }
  req.login(account, error => {
    if (error) return next(error);
    res.json({ message: "Login successful", user: account });
  });
});
registerLogoutRoute(app);
app.get("/api/security/turnstile/status", (_req, res) => {
  statusCalls++;
  res.set("Cache-Control", "no-store");
  if (mode === "hang") return;
  if (mode === "status-error") return res.status(503).json({ message: "Fixture unavailable" });
  if (mode === "malformed") return res.json({ required: "false" });
  res.json({ required: !["disabled", "bypassed"].includes(mode), verified: verified || mode === "verified",
    ...(mode === "bypassed" ? { bypassed: true } : {}) });
});
app.get("/api/security/turnstile-config", (_req, res) => {
  if (mode === "config-error") return res.status(503).json({ message: "Fixture unavailable" });
  res.json({ enabled: mode !== "disabled", siteKey: mode === "missing-key" ? "" : "public-fixture-site",
    challengePoint: "login" }); // deliberately exercise legacy location compatibility
});
app.post("/api/security/turnstile/verify", (_req, res) => {
  if (mode === "verify-fail") return res.status(400).json({ success: false, message: "Fixture verification rejected" });
  if (mode !== "unconfirmed") verified = true;
  res.json({ success: true });
});
app.get("/api/events/global", (_req, res) => {
  res.set("Content-Type", "text/event-stream");
  res.write(": fixture connected\n\n");
});
app.get(/^\/api\/.*/, (_req, res) => res.json([]));
app.use(express.static(resolve("dist/public")));
app.get(/.*/, (_req, res) => res.sendFile(resolve("dist/public/index.html")));
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const browser = await chromium.launch({
  ...(process.argv[3] ? { executablePath: process.argv[3] } : {}),
  headless: true, args: ["--no-sandbox"],
});
await mkdir("generated-artifacts/login-flow", { recursive: true });
const errors: string[] = [];
const vendorScript = `
window.turnstile = {
 render(el, opts) {
   el.innerHTML = '';
   const button = document.createElement('button');
   button.textContent = 'Complete fixture challenge';
   button.onclick = () => opts.callback('public-fixture-token');
   const expire = document.createElement('button');
   expire.textContent = 'Expire fixture challenge';
   expire.onclick = () => opts['expired-callback']();
   el.append(button, expire);
   return 'fixture-widget';
 },
 reset() {}, remove() {}
};
if (window.onTurnstileLoad) window.onTurnstileLoad();
`;

async function fixture(next: FixtureMode, width = 1280, blockedVendor = false) {
  mode = next; verified = false; statusCalls = 0; loginCalls = 0;
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  let block = blockedVendor;
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route: any) =>
    block ? route.abort() : route.fulfill({ contentType: "application/javascript", body: vendorScript }));
  return { context, page, allowVendor: () => { block = false; } };
}

try {
  for (const width of [1280, 390]) {
    const { page, context } = await fixture("enabled", width);
    await page.goto(base);
    await page.getByTestId("img-meterflo-logo").waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal(await page.locator("form").count(), 0);
    assert.equal(statusCalls, 0, "Home must not perform verification checks");
    await page.screenshot({ path: `generated-artifacts/login-flow/home-${width}.png` });
    await page.getByTestId(width < 600 ? "link-login-phone" : "link-login-desktop").click();
    await page.waitForURL(`${base}/turnstile`);
    await page.getByRole("button", { name: "Complete fixture challenge" }).click();
    await page.waitForURL(`${base}/login`);
    await page.getByTestId("input-username").waitFor();
    await page.screenshot({ path: `generated-artifacts/login-flow/login-${width}.png` });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByTestId("input-username").fill(account.username);
    await page.getByTestId("input-password").fill("wrong-fixture-password");
    await page.getByTestId("button-toggle-password").click();
    assert.equal(await page.getByTestId("input-password").getAttribute("type"), "text");
    await page.getByTestId("button-login-submit").click();
    await page.getByRole("alert").filter({ hasText: "Invalid username or password" }).waitFor();
    await page.getByTestId("input-password").fill("FixtureOnly1!");
    await page.getByTestId("button-login-submit").click();
    await page.getByTestId("text-dashboard-title").waitFor();
    await page.goto(`${base}/login`);
    await page.getByTestId("text-dashboard-title").waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    if (width < 600) await page.getByTestId("button-sidebar-toggle").click();
    await page.getByTestId("button-logout").click();
    await page.getByTestId("img-meterflo-logo").waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    assert.equal((await context.request.get(`${base}/api/auth/user`)).status(), 401);
    await page.goto(`${base}/projects`);
    await page.getByTestId("img-meterflo-logo").waitFor();
    assert.equal(await page.getByTestId("text-dashboard-title").count(), 0);
    await page.goto(`${base}/login`);
    await page.getByTestId("input-username").fill(account.username);
    await page.getByTestId("input-password").fill("FixtureOnly1!");
    await page.getByTestId("button-login-submit").click();
    await page.getByTestId("text-dashboard-title").waitFor();
    // Model restoration of a cached signed-in document after the server session
    // has gone away. Playwright's normal launch disables browser BFCache, so
    // ordinary goBack alone would not exercise the persisted-pageshow handler.
    await context.request.get(`${base}/api/logout`);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
    await page.getByTestId("img-meterflo-logo").waitFor();
    assert.equal(await page.getByTestId("text-dashboard-title").count(), 0);
    await context.close();
    console.log(`PASS ${width}px: public Home, challenge, login, wrong password, signed-in redirect, logout, private-page and cached-document protection`);
  }

  for (const next of ["disabled", "bypassed", "verified"] as FixtureMode[]) {
    const { page, context } = await fixture(next);
    await page.goto(`${base}/auth`);
    await page.getByTestId("input-username").waitFor();
    assert.equal(new URL(page.url()).pathname, "/login");
    await page.reload();
    await page.getByTestId("input-username").waitFor();
    await page.goto(`${base}/turnstile`);
    await page.getByTestId("input-username").waitFor();
    assert.equal(new URL(page.url()).pathname, "/login");
    await context.close();
    console.log(`PASS ${next}: legacy/direct routes reach Login without repeated challenge`);
  }

  const homeFailure = await fixture("status-error");
  await homeFailure.page.goto(base);
  await homeFailure.page.getByTestId("link-login-desktop").click();
  await homeFailure.page.getByRole("alert").waitFor();
  assert.equal(new URL(homeFailure.page.url()).pathname, "/");
  mode = "disabled";
  await homeFailure.page.getByRole("button", { name: "Retry check" }).click();
  await homeFailure.page.getByTestId("input-username").waitFor();
  await homeFailure.context.close();
  console.log("PASS failed Home login navigation stays on Home and retries safely");

  const expired = await fixture("verified");
  await expired.page.goto(`${base}/login`);
  await expired.page.getByTestId("input-username").fill(account.username);
  await expired.page.getByTestId("input-password").fill("FixtureOnly1!");
  mode = "enabled"; // verification expires while the form remains open
  await expired.page.getByTestId("button-login-submit").click();
  await expired.page.waitForURL(`${base}/turnstile`);
  assert.equal(loginCalls, 0, "Expired verification must not submit credentials");
  await expired.page.getByRole("button", { name: "Expire fixture challenge" }).click();
  await expired.page.getByRole("alert").filter({ hasText: "expired" }).waitFor();
  await expired.context.close();
  console.log("PASS expired verification redirects before credential submission; widget expiry is recoverable");

  for (const next of ["status-error", "malformed", "missing-key", "config-error", "hang"] as FixtureMode[]) {
    const { page, context } = await fixture(next);
    await page.goto(`${base}/login`);
    await page.getByRole("alert").waitFor({ timeout: 15000 });
    assert.equal(await page.getByTestId("input-username").count(), 0);
    mode = "disabled";
    const retry = page.getByRole("button", { name: /Retry (check|verification)/ });
    await retry.click();
    await page.getByTestId("input-username").waitFor();
    await context.close();
    console.log(`PASS ${next}: fail closed, bounded error and working retry`);
  }

  for (const next of ["verify-fail", "unconfirmed"] as FixtureMode[]) {
    const { page, context } = await fixture(next);
    await page.goto(`${base}/login`);
    await page.getByRole("button", { name: "Complete fixture challenge" }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(new URL(page.url()).pathname, "/turnstile");
    mode = "enabled";
    await page.getByRole("button", { name: "Retry verification" }).click();
    await page.getByRole("button", { name: "Complete fixture challenge" }).click();
    await page.getByTestId("input-username").waitFor();
    await context.close();
    console.log(`PASS ${next}: failed/unpersisted verification cannot open Login; retry succeeds`);
  }

  const blocked = await fixture("enabled", 390, true);
  await blocked.page.goto(`${base}/login`);
  await blocked.page.getByRole("alert").filter({ hasText: "could not be loaded" }).waitFor();
  blocked.allowVendor();
  await blocked.page.getByRole("button", { name: "Retry verification" }).click();
  await blocked.page.getByRole("button", { name: "Complete fixture challenge" }).click();
  await blocked.page.getByTestId("input-username").waitFor();
  await blocked.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS blocked vendor script recovers on retry; no browser runtime errors");
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}
