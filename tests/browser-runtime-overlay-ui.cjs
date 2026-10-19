// Read-only public development UI: no account, project, or business-data writes.
const assert = require("node:assert/strict");
const { chromium, expect } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const page = await browser.newPage();
  try {
    await page.goto("http://127.0.0.1:5000/");
    await expect(page.getByRole("heading", { name: /The work behind/ })).toBeVisible();
    const warning = page.waitForEvent("console", { predicate: message => message.type() === "warning" && message.text().includes("[Layout notice]") });
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "ResizeObserver loop completed with undelivered notifications." })));
    await warning;
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { error: new Error("Runtime diagnostic verification: real exception") })));
    await expect(page.getByText(/Runtime diagnostic verification: real exception/).first()).toBeVisible();
    await page.evaluate(() => document.querySelector("vite-error-overlay")?.remove());
    await page.evaluate(() => window.dispatchEvent(new ErrorEvent("error", { message: "Runtime diagnostic verification: browser message", filename: `${location.origin}/diagnostic.js`, lineno: 12, colno: 3 })));
    await expect(page.getByText(/Runtime diagnostic verification: browser message/).first()).toBeVisible();
    await page.evaluate(() => document.querySelector("vite-error-overlay")?.remove());
    await page.evaluate(() => window.dispatchEvent(new PromiseRejectionEvent("unhandledrejection", { promise: Promise.resolve(), reason: "Runtime diagnostic verification: string rejection" })));
    await expect(page.getByText(/Runtime diagnostic verification: string rejection/).first()).toBeVisible();
    assert.equal(await page.getByText(/\(unknown runtime error\)/).count(), 0);
    console.log("PASS: real development overlay ignores only native layout notices; real exceptions, browser messages and string rejections retain their details.");
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
