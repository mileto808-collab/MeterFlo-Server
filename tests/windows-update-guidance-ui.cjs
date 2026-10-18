const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({
      baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 1440, height: 1000 },
      permissions: ["clipboard-read", "clipboard-write"],
    });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("/settings");
    await page.getByTestId("settings-tab-updates").click();
    await page.getByTestId("settings-section-nav-web-updates").click();
    const card = page.getByTestId("settings-section-web-updates");
    await expect(card.getByTestId("windows-update-instructions")).toBeVisible();
    await card.getByTestId("copy-windows-update").click();
    const routine = String.raw`cd /d C:\xampp\htdocs\meterflo && deploy\Update-MeterFlo.cmd`;
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), routine);

    const checkResponse = page.waitForResponse(response => response.url().endsWith("/api/system/update-check"));
    await card.getByTestId("button-check-updates").click();
    const checked = await checkResponse;
    assert.equal(checked.status(), 200);
    const status = await checked.json();
    assert.equal(status.configurationRequired, true, "Acceptance workspace has no approved numbered release source");
    await expect(page.getByText("Numbered release checks need configuration", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Core update status could not be verified", { exact: true })).toHaveCount(0);

    await card.getByRole("button", { name: "Preview Changes", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Update Preview" });
    await expect(dialog.getByTestId("windows-update-instructions")).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Numbered customer-release verification" })).toBeVisible();
    await expect(dialog.getByText(/Staged release preparation is blocked/)).toBeVisible();
    await expect(dialog.getByTestId("button-copy-update-command")).toHaveCount(0);
    await dialog.getByTestId("copy-windows-update").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), routine);
    await dialog.locator("summary").click();
    await dialog.getByTestId("copy-windows-bootstrap").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()),
      String.raw`cd /d C:\xampp\htdocs\meterflo && git pull --ff-only origin main && deploy\Update-MeterFlo.cmd`);
    await dialog.getByTestId("copy-windows-preflight").click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), routine + " --check");
    await dialog.locator("summary").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await dialog.getByTestId("windows-routine-command").scrollIntoViewIfNeeded();
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    assert.ok(await dialog.getByTestId("windows-routine-command").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
    await fs.mkdir("generated-artifacts/windows-update-guidance", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/windows-update-guidance/mobile-preview.jpg" });
    assert.deepEqual(errors, []);
    console.log("PASS: authenticated Settings/Preview commands and clipboard, configuration notice, retained staged safety guards and mobile width.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
