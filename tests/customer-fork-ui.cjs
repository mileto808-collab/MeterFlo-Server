const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(),
      viewport: { width: 1440, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const viewer = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.post("/api/system/update-preview")).status(), 403);
    assert.equal((await viewer.request.get("/api/documentation/core-updates")).status(), 403);
    const doc = await context.request.get("/api/documentation/core-updates");
    assert.equal(doc.status(), 200);
    assert.ok((await doc.text()).includes("Guided direct-code updates: exact administrator procedure"));
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings");
    await page.getByTestId("settings-tab-updates").click();
    await page.getByTestId("settings-section-nav-web-updates").click();
    const card = page.getByTestId("settings-section-web-updates");
    const response = page.waitForResponse(result => result.url().endsWith("/api/system/update-preview"));
    await card.getByRole("button", { name: "Preview Changes", exact: true }).click();
    const actual = await response;
    assert.equal(actual.status(), 200);
    const preview = await actual.json();
    assert.equal(preview.forkReview.canPrepare, false, "Workspace is not a configured customer fork");
    const dialog = page.getByRole("dialog", { name: "Update Preview" });
    const guidance = dialog.getByTestId("customer-fork-instructions");
    await expect(guidance.getByText("Fork review preparation is blocked", { exact: true })).toBeVisible();
    await expect(guidance.getByTestId("copy-customer-fork-command")).toHaveCount(0);
    await expect(guidance.getByRole("link", { name: "Read deployment documentation" })).toHaveAttribute("href", "/documentation");
    await fs.mkdir("generated-artifacts/customer-forks", { recursive: true });
    await guidance.getByRole("heading", { name: "Keep three update paths separate" }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/customer-forks/blocked-desktop.jpg" });
    await dialog.getByRole("button", { name: "Close", exact: true }).first().click();
    // Availability presentation only is mocked; verified core identity and fork
    // preparation are exercised against real disposable Git repositories.
    const command = `npm run prepare:customer-fork -- --tag v1.1.0 --commit ${"a".repeat(40)} --target "ABSOLUTE_NEW_REVIEW_DIRECTORY"`;
    await page.route("**/api/system/update-preview", route => route.fulfill({ json: {
      ...preview, forkReview: { canPrepare: true, blockers: [], command },
    } }));
    await card.getByRole("button", { name: "Preview Changes", exact: true }).click();
    await guidance.getByTestId("copy-customer-fork-command").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), command);
    await page.setViewportSize({ width: 390, height: 844 });
    await guidance.getByRole("heading", { name: "Keep three update paths separate" }).scrollIntoViewIfNeeded();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    assert.ok(await guidance.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await expect(guidance.getByText(/operator attestations/)).toBeVisible();
    await page.screenshot({ path: "generated-artifacts/customer-forks/available-mobile.jpg" });
    assert.deepEqual(errors, []);
    await context.close(); await viewer.close();
    console.log("PASS: normal admin/viewer authorization, served guide, real blocked preview, copy command UI, and phone-width layout. Available command UI is simulated.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
