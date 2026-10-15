// Task 98: real authenticated dismissal/navigation checks for each shipment stage.
// Use only the disposable fixture created by tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium",
    args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({
      baseURL: process.env.INVENTORY_UI_BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`,
      viewport: { width: 1280, height: 950 },
    });
    assert.equal((await context.request.post("/api/auth/local/login", {
      data: { username: fixture.username, password: fixture.password },
    })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const url = `/projects/${fixture.projectId}/inventory`;
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    const post = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, {
        data: { action, data, operationId: crypto.randomUUID() },
      });
      assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
    };
    for (const id of ["dismiss-main", "dismiss-van"])
      await post("warehouse", { id, code: id.toUpperCase(), name: id, type: "physical", address: "Disposable fixture" });
    await post("vendor", { id: "dismiss-vendor", name: "Dismissal test vendor" });
    await post("item", { id: "dismiss-meter", sku: "DISMISS-METER", name: "Dismissal meter", tracking: "serialized" });
    const order = async (id, type) => {
      await post("order", { id, type, destinationId: type === "purchase" ? "dismiss-main" : "dismiss-van",
        ...(type === "purchase" ? { vendorId: "dismiss-vendor" } : { sourceId: "dismiss-main" }),
        lines: [{ itemId: "dismiss-meter", quantity: 2 }] });
      await post("release", { orderId: id });
    };
    await order("DISMISS-STOCK", "purchase");
    await post("receive", { orderId: "DISMISS-STOCK",
      lines: [{ itemId: "dismiss-meter", quantity: 2, serials: ["000700", "000701"] }] });
    await order("DISMISS-RECEIVE", "purchase");
    await order("DISMISS-DISPATCH", "transfer");
    await order("DISMISS-ARRIVAL", "transfer");
    await post("dispatch", { orderId: "DISMISS-ARRIVAL",
      lines: [{ itemId: "dismiss-meter", quantity: 1, serials: ["000701"] }] });
    const page = await context.newPage();
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let commands = 0;
    page.on("request", request => {
      if (request.method() === "POST" && request.url().endsWith("/inventory/commands")) commands++;
    });
    for (const [id, button, heading] of [
      ["DISMISS-RECEIVE", "Receive", /^Receive purchase/],
      ["DISMISS-DISPATCH", "Dispatch", /^Dispatch transfer/],
      ["DISMISS-ARRIVAL", "Accept arrival", /^Accept transfer arrival/],
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "Orders", exact: true }).click();
      const open = () => page.locator("div.rounded-lg.border.p-4").filter({ hasText: id })
        .getByRole("button", { name: button, exact: true }).click();
      await open();
      const dialog = page.getByRole("dialog", { name: heading });
      const scans = async () => {
        await dialog.getByRole("button", { name: "Scan / edit serials for Dismissal meter", exact: true }).click();
        return page.getByRole("dialog", { name: "Scan serials for Dismissal meter", exact: true });
      };
      const before = await snapshot();
      await dialog.locator("#dismiss-meter-goodQuantity").fill("1");
      let child = await scans();
      let scanner = child.getByRole("textbox", { name: "Good serial scanner for Dismissal meter", exact: true });
      await scanner.fill("0007");
      await scanner.press("Escape");
      await child.waitFor({ state: "detached" });
      assert.equal(await dialog.getByText("Discard movement edits?", { exact: true }).count(), 0);
      // Each way of closing the parent must offer Stay without losing raw text.
      for (const [method, dismiss] of [
        ["Cancel", () => dialog.getByRole("button", { name: "Cancel", exact: true }).click()],
        ["Escape", () => dialog.press("Escape")],
        // Target the live parent overlay and wait for its closing child layer
        // to stop intercepting pointers, rather than firing a raw mouse event.
        ["Outside", () => dialog.locator('xpath=preceding-sibling::div[@data-state="open"]')
          .click({ position: { x: 3, y: 3 } })],
        ["Close", () => dialog.getByRole("button", { name: "Close", exact: true }).click()],
      ]) {
        console.log(`Checking ${button}: ${method}`);
        await dismiss();
        await dialog.getByText("Discard movement edits?", { exact: true }).waitFor();
        await dialog.getByRole("button", { name: "Stay", exact: true }).click();
        assert.equal(await dialog.locator("#dismiss-meter-goodQuantity").inputValue(), "1");
        child = await scans();
        scanner = child.getByRole("textbox", { name: "Good serial scanner for Dismissal meter", exact: true });
        assert.equal(await scanner.inputValue(), "0007", `${button}: Stay preserves unfinished HID text`);
        await scanner.press("Escape");
        await child.waitFor({ state: "detached" });
      }
      assert.equal(await page.evaluate(() => {
        const event = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(event);
        return event.defaultPrevented;
      }), true, `${button}: refresh/tab close is guarded`);
      await page.evaluate(() => window.history.pushState({}, "", "/projects"));
      const warning = page.getByRole("dialog", { name: "Unsaved movement scans", exact: true });
      await warning.getByRole("button", { name: "Stay", exact: true }).click();
      await warning.waitFor({ state: "hidden" });
      assert.ok(page.url().endsWith(url), `${button}: Stay cancels navigation`);
      await page.evaluate(() => window.history.pushState({}, "", "/projects"));
      await warning.getByRole("button", { name: "Discard movement", exact: true }).click();
      await page.waitForURL("**/projects");
      assert.deepEqual(await snapshot(), before, `${button}: navigation never posts or changes inventory`);
      // Explicit local Discard closes; reopening starts clean (no stock command).
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.getByRole("tab", { name: "Orders", exact: true }).click();
      await open();
      await dialog.locator("#dismiss-meter-goodQuantity").fill("1");
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.getByRole("button", { name: "Discard", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      await open();
      assert.equal(await dialog.locator("#dismiss-meter-goodQuantity").inputValue(), "0");
      // A note alone is an edit, and reverting it restores a clean close.
      await dialog.locator("#shipment-reason").fill("Keep the damaged carton for inspection");
      await dialog.press("Escape");
      await dialog.getByText("Discard movement edits?", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Stay", exact: true }).click();
      assert.equal(await dialog.locator("#shipment-reason").inputValue(), "Keep the damaged carton for inspection");
      await dialog.locator("#shipment-reason").fill("");
      // Raw input alone must also protect the form, even without a quantity.
      child = await scans();
      scanner = child.getByRole("textbox", { name: "Good serial scanner for Dismissal meter", exact: true });
      await scanner.fill("000-unfinished");
      await scanner.press("Escape");
      await child.waitFor({ state: "detached" });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.getByText("Discard movement edits?", { exact: true }).waitFor();
      await dialog.getByRole("button", { name: "Stay", exact: true }).click();
      child = await scans();
      scanner = child.getByRole("textbox", { name: "Good serial scanner for Dismissal meter", exact: true });
      assert.equal(await scanner.inputValue(), "000-unfinished");
      await scanner.fill("");
      await scanner.press("Escape");
      await child.waitFor({ state: "detached" });
      await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
      await dialog.waitFor({ state: "hidden" });
      assert.deepEqual(await snapshot(), before);
    }
    assert.equal(commands, 0, "Stay, Discard and navigation never send movement or draft commands");
    assert.deepEqual(errors, []);
    console.log("Shipment dismissal acceptance passed: all three stages, Cancel/Escape/outside/close, raw HID retention, unload and navigation, no stock commands.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
