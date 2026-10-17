// Run with the disposable fixture from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });

async function main() {
  const f = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const mode of ["desktop", "phone", "landscape"]) {
      const viewport = mode === "desktop" ? { width: 1280, height: 900 }
        : mode === "phone" ? { width: 390, height: 844 } : { width: 844, height: 390 };
      const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`,
        viewport, hasTouch: mode !== "desktop", isMobile: mode !== "desktop" });
      assert.equal((await context.request.post("/api/auth/local/login", { data: { username: f.username, password: f.password } })).status(), 200);
      const base = `/api/projects/${f.projectId}/inventory`;
      const state = async () => (await (await context.request.get(base)).json()).state;
      const command = async (action, data) => {
        const result = await context.request.post(`${base}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
        assert.equal(result.status(), 200, await result.text());
      };
      if (mode === "desktop" && !(await state()).orders.some(order => order.id === "count-po")) {
        await command("warehouse", { id: "count-wh", code: "COUNT", name: "Count warehouse", type: "physical", address: "Fixture only" });
        await command("vendor", { id: "count-vendor", name: "Fixture supplier" });
        await command("item", { id: "count-a", sku: "COUNT-A", name: "Counted product", tracking: "regular" });
        await command("item", { id: "count-b", sku: "COUNT-B", name: "Unselected product", tracking: "serialized" });
        await command("order", { id: "count-po", type: "purchase", vendorId: "count-vendor", destinationId: "count-wh",
          lines: [{ itemId: "count-a", quantity: 5 }, { itemId: "count-b", quantity: 2 }] });
        await command("release", { orderId: "count-po" });
        await command("receive", { orderId: "count-po", lines: [
          { itemId: "count-a", quantity: 5 }, { itemId: "count-b", quantity: 2, serials: ["COUNT-S1", "COUNT-S2"] },
        ] });
      }
      const page = await context.newPage(), errors = [];
      page.on("pageerror", e => errors.push(e.message));
      await page.goto(`/projects/${f.projectId}/inventory`);
      await expect(page.getByTestId("inventory-sticky-header")).toBeVisible();
      if (mode === "desktop") await page.getByRole("tab", { name: "Cycle counts", exact: true }).click();
      else {
        await page.getByTestId("inventory-mobile-menu").click();
        await page.getByRole("menuitem", { name: "Cycle counts", exact: true }).click();
      }
      const tools = async () => {
        if (mode === "desktop") return;
        const toggle = page.getByRole("button", { name: /^(Show|Hide) Search & Tools$/ });
        await expect(toggle).toBeVisible();
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      };
      await tools();
      await page.getByRole("button", { name: "Start count", exact: true }).click();
      const chooser = page.getByRole("dialog", { name: "Start selected-item count", exact: true });
      await chooser.getByRole("combobox").click();
      await page.getByRole("option", { name: "COUNT · Count warehouse", exact: true }).click();
      await chooser.getByRole("button", { name: "Start count", exact: true }).click();
      const editor = page.getByTestId("inventory-count-editor");
      await expect(editor).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(editor.locator('input[id^="count-count-"]')).toHaveCount(0);
      await expect(editor.getByLabel("Find discovery product", { exact: true })).toBeVisible();
      const panel = editor.locator("#count-search-tools");
      const toolsMetrics = await panel.evaluate(el => ({
        height: el.clientHeight, fullHeight: el.scrollHeight,
        overflow: getComputedStyle(el).overflowY, maxHeight: getComputedStyle(el).maxHeight,
      }));
      assert.equal(toolsMetrics.maxHeight, "none", `${mode}: tools must not be height-capped`);
      assert.ok(toolsMetrics.fullHeight <= toolsMetrics.height + 1, `${mode}: all tools must fit their panel`);
      assert.ok(!["auto", "scroll", "hidden"].includes(toolsMetrics.overflow), `${mode}: no internal tools scrolling/clipping`);
      assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      await page.screenshot({ path: `generated-artifacts/count-tools-expanded-${mode}.jpg` });
      assert.equal(await page.evaluate(() => document.activeElement?.tagName === "INPUT"), false);
      await expect(editor.getByRole("button", { name: "Post count", exact: true })).toBeDisabled();
      await editor.getByLabel("Find discovery product", { exact: true }).fill("COUNT-A");
      await editor.getByLabel("Discovery product", { exact: true }).click();
      await page.getByRole("option", { name: "COUNT-A · Counted product", exact: true }).click();
      await editor.getByRole("button", { name: "Add discovery to count", exact: true }).click();
      await expect(editor.locator("#count-count-a")).toHaveValue("");
      await expect(editor.locator("#expected-count-count-a")).toHaveText(mode === "desktop" ? "5" : "4");
      await editor.locator("#count-count-a").fill("4");
      await editor.getByRole("button", { name: "Hide Search & Tools", exact: true }).click();
      await expect(panel).toHaveCount(0);
      await editor.getByRole("button", { name: "Show Search & Tools", exact: true }).click();
      await expect(editor.getByLabel("Find discovery product", { exact: true })).toHaveValue("COUNT-A");
      await expect(editor.locator("#count-count-a")).toHaveValue("4");
      await editor.getByRole("button", { name: "Hide Search & Tools", exact: true }).click();
      await editor.getByLabel("Count adjustment reason", { exact: true }).fill("Selected product physically verified");
      const unselected = structuredClone((await state()).stock.find(row => row.itemId === "count-b"));
      const saved = page.waitForResponse(r => r.url().endsWith(`${base}/commands`) && r.request().postDataJSON()?.action === "countSaveDraft");
      await editor.getByRole("button", { name: "Save draft", exact: true }).click();
      assert.equal((await saved).status(), 200);
      await expect(editor.getByText(/Draft saved, revision/).first()).toBeVisible();
      await page.screenshot({ path: `generated-artifacts/selected-count-${mode}.jpg` });
      assert.equal(await editor.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      await expect(editor.getByRole("button", { name: "Post count", exact: true })).toBeVisible();
      await page.getByTestId("inventory-editor-back").click();
      await expect(editor).toHaveCount(0);
      await tools();
      const snapshot = await state();
      const ordinal = snapshot.counts.length;
      await page.getByRole("searchbox").fill(`Count #${ordinal}`);
      await page.getByRole("button", { name: "Continue count", exact: true }).click();
      await expect(editor).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(editor.locator("#count-count-a")).toHaveValue("4");
      await expect(editor.locator("#count-count-b")).toHaveCount(0);
      const posted = page.waitForResponse(r => r.url().endsWith(`${base}/commands`) && r.request().postDataJSON()?.action === "countPost");
      await editor.getByRole("button", { name: "Post count", exact: true }).click();
      assert.equal((await posted).status(), 200);
      await expect(editor).toHaveCount(0);
      const after = await state();
      assert.equal(after.stock.find(row => row.itemId === "count-a").quantity, 4);
      assert.deepEqual(after.stock.find(row => row.itemId === "count-b"), unselected);

      // Legacy counts still expose their existing serial list through the compact trigger.
      const serialCountId = `serial-modal-${mode}`;
      await command("countStart", { id: serialCountId, warehouseId: "count-wh" });
      const serialOrdinal = (await state()).counts.length;
      await page.reload();
      await expect(page.getByTestId("inventory-sticky-header")).toBeVisible();
      await tools();
      await page.getByRole("searchbox").fill(`Count #${serialOrdinal}`);
      await page.getByRole("button", { name: "Continue count", exact: true }).click();
      await expect(editor).toBeVisible();
      const serialTrigger = editor.getByRole("button", { name: "Scan serials for Unselected product", exact: true });
      await expect(editor.locator('textarea[id^="countserial-"]')).toHaveCount(0);
      await serialTrigger.click();
      const serialDialog = page.getByTestId("inventory-count-serials-dialog");
      const serialText = serialDialog.getByRole("textbox", { name: "Serials, one per line", exact: true });
      const scan = serialDialog.getByRole("textbox", { name: "Scan serial number", exact: true });
      await expect(serialDialog).toBeVisible();
      await expect(serialDialog.getByRole("heading", { name: "Review serials", exact: true })).toBeFocused();
      await expect(serialText).toHaveValue("COUNT-S1\nCOUNT-S2");
      await serialText.fill("");
      await scan.click();
      for (const serial of ["000001", "000002", "000002"]) {
        // A keyboard-wedge HID scanner emits these same key events and an Enter suffix.
        await page.keyboard.type(serial, { delay: 0 });
        await page.keyboard.press("Enter");
        await expect(scan).toHaveValue("");
        await expect(scan).toBeFocused();
      }
      await expect(serialText).toHaveValue("000001\n000002\n000002\n");
      await expect(serialDialog.getByText("3 entered", { exact: true })).toBeVisible();
      await serialDialog.getByRole("button", { name: "Done", exact: true }).click();
      await expect(serialDialog).toHaveCount(0);
      await expect(editor.locator("#count-count-b")).toHaveValue("2");
      await editor.getByLabel("Count adjustment reason", { exact: true }).fill("Serial modal regression");
      let postRequests = 0;
      const watchPost = request => {
        if (request.url().endsWith(`${base}/commands`) && request.method() === "POST" && request.postDataJSON()?.action === "countPost") postRequests++;
      };
      page.on("request", watchPost);
      await editor.getByRole("button", { name: "Post count", exact: true }).click();
      await expect(page.getByText(/record one distinct serial per counted unit/).last()).toBeVisible();
      assert.equal(postRequests, 0, "Duplicate serials must block posting without losing entries");
      page.off("request", watchPost);
      await serialTrigger.click();
      await expect(serialText).toHaveValue("000001\n000002\n000002\n");
      const manySerials = Array.from({ length: 1000 }, (_, i) => String(i + 100).padStart(8, "0")).join("\n");
      await serialText.fill(manySerials);
      await scan.click();
      await page.keyboard.type("00123456");
      await page.keyboard.press("Enter");
      const expectedText = `${manySerials}\n00123456\n`;
      await expect(serialText).toHaveValue(expectedText);
      await expect(serialDialog.getByText("1001 entered", { exact: true })).toBeVisible();
      assert.equal(await serialDialog.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      const modalBounds = await serialDialog.boundingBox();
      assert.ok(modalBounds.y >= 0 && modalBounds.y + modalBounds.height <= viewport.height + 1, "Modal fits available screen height");
      await page.screenshot({ path: `generated-artifacts/count-serials-${mode}.jpg` });
      await page.keyboard.press("Escape");
      await expect(serialDialog).toHaveCount(0);
      const saveSerials = page.waitForResponse(r => r.url().endsWith(`${base}/commands`) && r.request().postDataJSON()?.action === "countSaveDraft");
      await editor.getByRole("button", { name: "Save draft", exact: true }).click();
      assert.equal((await saveSerials).status(), 200);
      await expect(editor.getByText(/Draft saved, revision/).first()).toBeVisible();
      assert.equal((await state()).counts.find(count => count.id === serialCountId).draft.rows.find(row => row.itemId === "count-b").serials, expectedText);
      await page.getByTestId("inventory-editor-back").click();
      await expect(editor).toHaveCount(0);
      await tools();
      await page.getByRole("button", { name: "Continue count", exact: true }).click();
      await serialTrigger.click();
      await expect(serialText).toHaveValue(expectedText);
      await expect(editor.locator("#count-count-b")).toHaveValue("2");
      await serialDialog.getByRole("button", { name: "Close", exact: true }).click();
      await expect(serialDialog).toHaveCount(0);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${mode}: selected count workflow, icon serial modal, repeated HID/Enter, leading zeros, duplicate rejection, 1001 serials, save/reload, no input autofocus.`);
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
