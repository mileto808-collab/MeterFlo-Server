// Optional real-browser verification. Uses a disposable local administrator,
// normal session login, and read-only documentation routes; no project or
// work-order fixtures are created. No auth bypass is installed.
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || "playwright");

(async () => {
  const { pool } = await import("../server/db.ts");
  const { storage } = await import("../server/storage.ts");
  const { default: bcrypt } = await import("bcryptjs");
  const baseURL = process.env.DOCUMENTATION_TEST_BASE_URL ||
    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:5000");
  let browser, account;
  try {
    const password = `Documentation-test-only-${randomUUID()}!`;
    const role = await storage.getAdministratorSubrole();
    assert.ok(role, "Start the application to initialize its administrator role.");
    account = await storage.createLocalUser(`docs-test-${randomUUID().slice(0, 8)}`,
      await bcrypt.hash(password, 10), "admin", "Documentation", "Test", null, role.id);
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
      headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    const login = await context.request.post("/api/auth/local/login", { data: { username: account.username, password } });
    assert.equal(login.status(), 200, "Normal local login should succeed.");
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/documentation");
    await page.locator('[data-testid="card-doc-customer-api"]').click();
    const article = page.locator('[data-testid="text-doc-content"]');
    await article.locator("#api-import-field-reference").waitFor();
    assert.equal(await article.locator('code.language-json').count(), 13);
    assert.ok(await article.locator("table").count() >= 10);
    const missingAnchors = await article.evaluate(element => [...element.querySelectorAll('a[href^="#"]')]
      .map(link => link.getAttribute("href").slice(1)).filter(id => !document.getElementById(id)));
    assert.deepEqual(missingAnchors, [], "Every customer-guide section link should resolve.");
    await article.getByRole("link", { name: "Every API Import field and option", exact: true }).click();
    await page.waitForFunction(() => {
      const target = document.getElementById("api-import-field-reference");
      return target && target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().top < innerHeight;
    });
    await page.screenshot({ path: "/tmp/documentation-fields-desktop.jpg", type: "jpeg", quality: 65 });
    await page.getByTestId("button-back-to-docs").click();
    assert.equal(new URL(page.url()).search, "");
    await page.getByTestId("card-doc-system-admin").click();
    await article.getByRole("link", { name: "API Import field reference", exact: true }).first().click();
    await page.waitForURL("**/documentation?doc=customer-api#api-import-field-reference");
    await page.waitForFunction(() => {
      const target = document.getElementById("api-import-field-reference");
      return target && target.getBoundingClientRect().top >= 0 && target.getBoundingClientRect().top < innerHeight;
    });
    assert.equal(await page.getByTestId("text-doc-title").textContent(), "Customer API Integration");
    await page.setViewportSize({ width: 402, height: 874 });
    await page.goto("/documentation?doc=customer-api#mapping-targets-and-update-checkboxes");
    await article.locator("#mapping-targets-and-update-checkboxes").waitFor();
    const widths = await page.evaluate(() => ({
      viewport: innerWidth, page: document.documentElement.scrollWidth,
      article: document.querySelector("article").scrollWidth,
      articleViewport: document.querySelector("article").clientWidth,
    }));
    console.log("Mobile documentation widths:", JSON.stringify(widths));
    assert.ok(widths.page <= widths.viewport + 1, "Documentation must not overflow the phone viewport.");
    assert.ok(widths.articleViewport <= widths.viewport, "Scroll container must not hide an intrinsically wide article.");
    assert.ok(widths.article <= widths.articleViewport + 1, "Wide tables/code must scroll locally instead of clipping guide text.");
    await page.screenshot({ path: "/tmp/documentation-fields-mobile.jpg", type: "jpeg", quality: 65 });
    await page.goto("/documentation?doc=not-a-guide");
    await page.getByTestId("card-doc-customer-api").waitFor();
    await page.goto("/documentation?doc=customer-api#%not-valid");
    await article.locator("#api-import-field-reference").waitFor();
    assert.deepEqual(errors, [], "Documentation must not throw browser errors.");
    console.log("Passed: authenticated guides, JSON/tables, all section anchors, administrator cross-links, deep links, phone layout, and invalid URL handling.");
  } finally {
    if (browser) await browser.close();
    if (account) {
      await pool.query(`DELETE FROM public.sessions
        WHERE sess->'passport'->>'user'=$1
          OR sess->'passport'->'user'->'claims'->>'sub'=$1`, [account.id]);
      await pool.query("DELETE FROM public.users WHERE id=$1", [account.id]);
    }
    await pool.end();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
