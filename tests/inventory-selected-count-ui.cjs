// Run with the disposable fixture from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

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
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${mode}: warehouse chooser → empty selected count page → add/save/back/continue/post; unselected serial stock untouched.`);
    }
  } finally { await browser.close(); }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
