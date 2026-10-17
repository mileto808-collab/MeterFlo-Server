const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  const base = `/api/projects/${fixture.projectId}/inventory`;
  const errors = [];
  let context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  try {
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const post = async (action, data) => {
      const response = await context.request.post(`${base}/commands`, { data: { action, data, operationId: crypto.randomUUID() } });
      assert.equal(response.status(), 200, `${action}: ${await response.text()}`);
      return (await response.json()).state;
    };
    const snapshot = async () => (await (await context.request.get(base)).json()).state;
    const prefix = `recovery-${crypto.randomUUID().slice(0, 8)}`;
    const serialBarcode = `000123000${prefix}`, inactiveBarcode = `000789000${prefix}`, duplicateBarcode = `duplicate-code-${prefix}`;
    await post("warehouse", { id: prefix, code: prefix, name: "Recovery warehouse", type: "physical", address: "Fixture" });
    for (const [suffix, tracking, barcode, active] of [
      ["serial", "serialized", serialBarcode, true], ["regular", "regular", `000456000${prefix}`, true],
      ["inactive", "regular", inactiveBarcode, false], ["ambiguous-one", "regular", duplicateBarcode, true],
      ["ambiguous-two", "regular", duplicateBarcode, true],
    ]) await post("item", { id: `${prefix}-${suffix}`, sku: `${prefix}-${suffix}`, name: `Recovery ${suffix}`,
      description: suffix === "regular" ? "Copper housing for residential installations" : "", tracking, barcode, active });
    let countId = `${prefix}-count`;
    await post("countStart", { id: countId, warehouseId: prefix, scope: "selected" });
    let page = await context.newPage();
    const connectPage = () => {
      page.on("pageerror", error => errors.push(error.message));
      page.on("dialog", dialog => dialog.accept());
    };
    connectPage();
    const countsTab = async () => {
      await page.getByTestId("inventory-sticky-header").waitFor();
      const banner = page.getByRole("button", { name: "Close banner", exact: true });
      if (await banner.isVisible()) await banner.click();
      const menu = page.getByTestId("inventory-mobile-menu");
      if (await menu.isVisible()) {
        await menu.click();
        await page.getByRole("menuitem", { name: "Cycle counts", exact: true }).click();
      } else await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    };
    const openEditor = async () => {
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      await countsTab();
      await page.locator(`[data-count-id="${countId}"]`).getByRole("button", { name: "Continue count", exact: true }).click();
      await expect(page.getByTestId("inventory-count-editor")).toBeVisible();
    };
    const editor = () => page.getByTestId("inventory-count-editor");
    const scan = async (code, suffix = "Enter", added = false) => {
      const input = page.getByTestId("count-product-scanner").getByLabel("Search products or scan barcode");
      await input.fill(code); await input.press(suffix);
      await expect(input).toBeFocused();
      await expect(input).toHaveValue(added ? "" : code);
    };
    const localRecords = () => page.evaluate(() => Object.keys(localStorage).filter(key =>
      key.startsWith("meterflo:count-capture:")).map(key => JSON.parse(localStorage.getItem(key))));
    const entry = async suffix => {
      const show = editor().getByRole("button", { name: "Show Search & Tools", exact: true });
      if (await show.isVisible()) await show.click();
      await editor().getByLabel("Search products or scan barcode", { exact: true }).fill(`${prefix}-${suffix}`);
      return editor().locator(`#count-${prefix}-${suffix}`);
    };
    await openEditor();
    const master = editor().getByLabel("Search products or scan barcode", { exact: true });
    await expect(editor().locator('input[id$="-input"]')).toHaveCount(1);
    await master.fill("Recovery");
    await master.press("Enter");
    await expect(page.getByTestId("count-product-scanner").getByRole("status")).toContainText("More than one");
    await expect(master).toHaveValue("Recovery");
    await expect(editor().locator('input[id^="count-recovery-"]')).toHaveCount(0);
    await scan(serialBarcode, "Enter", true);
    await master.fill("Copper housing");
    await editor().getByLabel("Discovery product", { exact: true }).click();
    await expect(page.getByRole("option")).toHaveCount(1);
    await expect(page.getByRole("option")).toContainText("Recovery regular");
    await page.keyboard.press("Escape");
    await master.press("Tab");
    await expect(master).toBeFocused();
    await expect(master).toHaveValue("");
    await expect.poll(async () => (await localRecords()).find(record => record.countId === countId)?.rows.length).toBe(2);
    await expect(await entry("regular")).toHaveValue("");
    await scan(serialBarcode);
    await expect(page.getByTestId("count-product-scanner").getByRole("status")).toContainText("already included");
    for (const [code, message] of [[serialBarcode.slice(3), "No catalog item"], [inactiveBarcode, "inactive"], [duplicateBarcode, "More than one"]]) {
      await scan(code);
      await expect(page.getByTestId("count-product-scanner").getByRole("status")).toContainText(message);
    }
    await expect.poll(async () => (await localRecords()).find(record => record.countId === countId)?.rows.length).toBe(2);
    await (await entry("regular")).fill("0");
    await (await entry("serial")).fill("2");
    await editor().getByRole("button", { name: "Scan serials for Recovery serial", exact: true }).click();
    const serialDialog = page.getByRole("dialog", { name: "Review serials", exact: true });
    await expect(serialDialog.getByLabel("Scan serial number")).not.toBeFocused();
    await serialDialog.getByLabel("Scan serial number").fill("00000001");
    await serialDialog.getByLabel("Scan serial number").press("Enter");
    await serialDialog.getByLabel("Scan serial number").fill("00000002");
    await serialDialog.getByLabel("Scan serial number").press("Enter");
    await serialDialog.getByRole("button", { name: /Done/ }).click();
    await editor().getByLabel("Count adjustment reason").fill("Recovered after unexpected browser restart");
    await expect.poll(async () => (await localRecords()).find(record => record.countId === countId)?.reason)
      .toBe("Recovered after unexpected browser restart");
    let saved = (await snapshot()).counts.find(count => count.id === countId);
    assert.equal(saved.draft, undefined, "Local recovery must not save a server draft");
    // Destroy all page/React memory and reopen a fresh context with only browser-persisted state.
    const storageState = await context.storageState();
    await context.close();
    context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, storageState });
    page = await context.newPage(); connectPage();
    await openEditor();
    const recovery = page.getByTestId("count-recovery-notice");
    await expect(recovery).toBeVisible();
    await expect(editor().getByRole("button", { name: "Save draft", exact: true }).first()).toBeDisabled();
    await recovery.getByRole("button", { name: "Restore local entries" }).click();
    await expect(await entry("regular")).toHaveValue("0");
    await expect(await entry("serial")).toHaveValue("2");
    await expect(editor().getByLabel("Count adjustment reason")).toHaveValue("Recovered after unexpected browser restart");
    await expect(editor().getByText("2 serials entered", { exact: true }).last()).toBeVisible();
    await expect.poll(async () => (await localRecords()).filter(record => record.countId === countId).length).toBe(1);
    // Rotation keeps local captures; short screens still have no horizontal overflow.
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(844);
    await expect(editor().locator(`#count-${prefix}-serial`)).toHaveValue("2");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await fs.mkdir("generated-artifacts", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-count-recovery-landscape.png" });
    await page.route(`**${base}/commands`, route => route.fulfill({
      status: 503, contentType: "application/json", body: JSON.stringify({ message: "Fixture save failure" }),
    }));
    await editor().getByRole("button", { name: "Save draft", exact: true }).first().click();
    await expect(editor().getByRole("status").first()).toContainText("Draft not saved");
    assert.ok((await localRecords()).some(record => record.countId === countId), "Failed server save retains recovery");
    await expect(editor().locator(`#count-${prefix}-serial`)).toHaveValue("2");
    await page.unroute(`**${base}/commands`);
    await editor().getByRole("button", { name: "Save draft", exact: true }).first().click();
    await expect(editor().getByRole("status").first()).toContainText("Draft saved");
    await expect.poll(async () => (await localRecords()).filter(record => record.countId === countId).length).toBe(0);
    saved = (await snapshot()).counts.find(count => count.id === countId);
    assert.equal(saved.draft.rows.find(row => row.itemId === `${prefix}-serial`).serials, "00000001\n00000002\n");
    // A newer server draft is never overwritten by restoring an older local capture.
    await (await entry("regular")).fill("4");
    await expect.poll(async () => (await localRecords()).find(record => record.countId === countId)?.rows
      .find(row => row.itemId === `${prefix}-regular`)?.quantity).toBe("4");
    await page.close({ runBeforeUnload: false });
    await post("countSaveDraft", { id: countId, revision: saved.draft.revision,
      reason: "Another operator", rows: [{ itemId: `${prefix}-regular`, quantity: "9", serials: "" }] });
    page = await context.newPage(); connectPage();
    await openEditor();
    await expect(page.getByTestId("count-recovery-notice")).toContainText("different server draft revision");
    await page.getByRole("button", { name: "Restore local entries", exact: true }).click();
    await expect(await entry("regular")).toHaveValue("4");
    await expect(editor().getByRole("button", { name: "Save draft", exact: true }).first()).toBeDisabled();
    await expect(editor().getByRole("button", { name: "Post count", exact: true })).toBeDisabled();
    assert.equal((await snapshot()).counts.find(count => count.id === countId).draft.rows[0].quantity, "9");
    await editor().getByRole("button", { name: "Reload saved draft", exact: true }).click();
    const unsaved = page.getByRole("dialog", { name: "Unsaved count changes", exact: true });
    await unsaved.getByRole("button", { name: "Discard", exact: true }).click();
    await expect(editor().locator(`#count-${prefix}-regular`)).toHaveValue("9");
    await expect.poll(async () => (await localRecords()).filter(record => record.countId === countId).length).toBe(0);
    // Storage failures are explicit, while entries remain editable and server-saveable.
    await page.evaluate(() => { Storage.prototype.setItem = function() { throw new DOMException("Full", "QuotaExceededError"); }; });
    await editor().locator(`#count-${prefix}-regular`).fill("8");
    await expect(editor().getByText("Local recovery unavailable", { exact: true })).toBeVisible();
    await expect(editor().locator(`#count-${prefix}-regular`)).toHaveValue("8");
    await expect(editor().getByRole("button", { name: "Save draft", exact: true }).first()).toBeEnabled();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: "generated-artifacts/inventory-count-recovery-phone.png" });
    // A fresh document restores normal browser storage. Start with scope/location only,
    // then choose products on the count screen and post to verify terminal cleanup.
    await page.close({ runBeforeUnload: false });
    page = await context.newPage(); connectPage();
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await countsTab();
    const header = page.getByTestId("inventory-counts-subheader");
    await expect(header).toBeVisible();
    const tools = header.getByTestId("inventory-mobile-tools-counts-toggle");
    if (await tools.isVisible() && await tools.getAttribute("aria-expanded") === "false") await tools.click();
    await header.getByRole("button", { name: "Start count", exact: true }).click();
    const start = page.getByRole("dialog", { name: "Start cycle count", exact: true });
    await start.getByLabel("Warehouse or vehicle", { exact: true }).click();
    await page.getByRole("option", { name: `${prefix} · Recovery warehouse`, exact: true }).click();
    await expect(start.getByTestId("inventory-count-scope-options")).toBeVisible();
    await expect(start.getByTestId("count-scope-selected")).toBeChecked();
    await expect(start.getByRole("textbox")).toHaveCount(0);
    await expect(start.getByTestId("count-start-product-picker")).toHaveCount(0);
    await page.screenshot({ path: "generated-artifacts/inventory-count-start-phone.png" });
    await start.getByRole("button", { name: "Start count", exact: true }).click();
    await expect(editor()).toBeVisible();
    countId = (await snapshot()).counts.at(-1).id;
    assert.equal((await snapshot()).counts.at(-1).draft?.rows.length ?? 0, 0);
    await scan(`000456000${prefix}`, "Enter", true);
    await expect(await entry("regular")).toHaveValue("");
    await (await entry("regular")).fill("0");
    await editor().getByLabel("Count adjustment reason").fill("Verified physical zero");
    await expect.poll(async () => (await localRecords()).filter(record => record.countId === countId).length).toBe(1);
    await editor().getByRole("button", { name: "Post count", exact: true }).click();
    await expect(editor()).toHaveCount(0);
    assert.equal((await snapshot()).counts.find(count => count.id === countId).status, "posted");
    await expect.poll(async () => (await localRecords()).filter(record => record.countId === countId).length).toBe(0);
    assert.deepEqual(errors, []);
    console.log("PASS: unified barcode/name/description search, dropdown filtering, scope-only start, duplicates/errors, serials, fresh-context recovery, phone/rotation, failed/successful saves, post cleanup, newer-draft safety and storage failure.");
  } finally { await context.close(); await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
