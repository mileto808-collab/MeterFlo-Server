const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    for (const [index, mode] of ["desktop", "phone", "landscape"].entries()) {
      const viewport = mode === "desktop" ? { width: 1280, height: 900 }
        : mode === "phone" ? { width: 390, height: 844 } : { width: 844, height: 390 };
      const context = await browser.newContext({
        baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport,
        hasTouch: mode !== "desktop", isMobile: mode !== "desktop",
      });
      assert.equal((await context.request.post("/api/auth/local/login", {
        data: { username: fixture.username, password: fixture.password },
      })).status(), 200);
      const base = `/api/projects/${fixture.projectId}/inventory`;
      const state = async () => (await (await context.request.get(base)).json()).state;
      const command = async (action, data) => {
        const response = await context.request.post(`${base}/commands`, {
          data: { operationId: crypto.randomUUID(), action, data },
        });
        assert.equal(response.status(), 200, await response.text());
      };
      const suffix = `${mode}-${crypto.randomUUID().slice(0, 8)}`;
      const warehouseId = `review-wh-${suffix}`, itemId = `review-meter-${suffix}`;
      const first = `00${index}00001`, missing = `00${index}00002`, unexpected = `00${index}00003`;
      await command("warehouse", { id: warehouseId, code: suffix, name: `Review warehouse ${mode}`, type: "physical", address: "Fixture only" });
      await command("vendor", { id: suffix, name: `Supplier ${mode}` });
      await command("item", { id: itemId, sku: suffix, name: "Review meter", tracking: "serialized" });
      await command("order", { id: suffix, type: "purchase", vendorId: suffix, destinationId: warehouseId, lines: [{ itemId, quantity: 3 }] });
      await command("release", { orderId: suffix });
      await command("receive", { orderId: suffix, lines: [{ itemId, quantity: 2, serials: [first, missing] }] });
      const countId = `count-${suffix}`;
      await command("countStart", { id: countId, warehouseId });
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/inventory`);
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
      const openCount = async id => {
        await tools();
        const snapshot = await state();
        const ordinal = snapshot.counts.findIndex(count => count.id === id) + 1;
        await page.getByRole("searchbox").fill(`Count #${ordinal}`);
        await page.getByRole("button", { name: "Continue count", exact: true }).click();
        await expect(page.getByTestId("inventory-count-editor")).toBeVisible();
      };
      await openCount(countId);
      const editor = page.getByTestId("inventory-count-editor");
      const review = page.getByTestId("inventory-count-discrepancy-review");
      const serialDialog = page.getByTestId("inventory-count-serials-dialog");
      const editSerials = async value => {
        await editor.getByRole("button", { name: "Scan serials for Review meter", exact: true }).click();
        await serialDialog.getByRole("textbox", { name: "Serials, one per line", exact: true }).fill(value);
        await serialDialog.getByRole("button", { name: "Done", exact: true }).click();
        await expect(serialDialog).toHaveCount(0);
      };
      await editSerials(`${first}\n${unexpected}`);
      await editor.getByLabel("Count adjustment reason", { exact: true }).fill("Physically verified serial swap");
      const originalStock = structuredClone((await state()).stock);
      let posts = 0;
      page.on("request", request => {
        if (request.url().endsWith(`${base}/commands`) && request.method() === "POST" && request.postDataJSON()?.action === "countPost") posts++;
      });
      const openReview = async () => {
        await editor.getByRole("button", { name: "Post count", exact: true }).click();
        await expect(review).toBeVisible();
        await expect(review.getByRole("heading", { name: "Review serial discrepancies", exact: true })).toBeFocused();
      };
      await openReview();
      const confirm = review.getByRole("button", { name: "Confirm and post count", exact: true });
      const acknowledge = review.getByRole("checkbox", { name: "I reviewed the serial changes", exact: true });
      await expect(confirm).toBeDisabled();
      await expect(review.getByRole("region", { name: "Missing serials — will be removed", exact: true }).getByText(missing, { exact: true })).toBeVisible();
      await expect(review.getByRole("region", { name: "Unexpected serials — will be added", exact: true }).getByText(unexpected, { exact: true })).toBeVisible();
      assert.equal(posts, 0);
      assert.deepEqual((await state()).stock, originalStock);
      assert.equal(await review.evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
      const bounds = await review.boundingBox();
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height + 1);
      await page.screenshot({ path: `generated-artifacts/count-discrepancies-${mode}.jpg` });
      await review.getByRole("button", { name: "Back to count", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(editor.getByLabel("Count adjustment reason", { exact: true })).toHaveValue("Physically verified serial swap");
      await openReview();
      await expect(acknowledge).not.toBeChecked();
      await acknowledge.check();
      await expect(confirm).toBeEnabled();

      // Another session saves the same count while the review is open.
      await command("countSaveDraft", { id: countId, revision: 0, reason: "Other operator verification",
        rows: [{ itemId, quantity: "2", serials: `${first}\n${unexpected}` }] });
      await expect(review.getByText("This review is no longer current", { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      assert.equal(posts, 0);
      assert.deepEqual((await state()).stock, originalStock);
      await review.getByRole("button", { name: "Back to count", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(editor.getByLabel("Count adjustment reason", { exact: true })).toHaveValue("Physically verified serial swap");
      await editor.getByRole("button", { name: "Reload saved draft", exact: true }).click();
      await page.getByRole("button", { name: "Discard", exact: true }).click();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(editor.getByLabel("Count adjustment reason", { exact: true })).toHaveValue("Other operator verification");
      await openReview();
      await acknowledge.check();
      const posted = page.waitForResponse(response => response.url().endsWith(`${base}/commands`) && response.request().postDataJSON()?.action === "countPost");
      await confirm.click();
      assert.equal((await posted).status(), 200);
      await expect(review).toHaveCount(0);
      await expect(editor).toHaveCount(0);
      assert.equal(posts, 1);
      const after = await state();
      assert.deepEqual(after.stock.find(row => row.itemId === itemId).serials, [first, unexpected]);
      assert.equal(after.stock.find(row => row.itemId === itemId).quantity, 2);
      assert.equal(after.counts.find(count => count.id === countId).status, "posted");

      // Identical serial sets require no discrepancy acknowledgement.
      const unchangedId = `unchanged-${suffix}`;
      await command("countStart", { id: unchangedId, warehouseId });
      await page.reload();
      await expect(page.getByTestId("inventory-sticky-header")).toBeVisible();
      await openCount(unchangedId);
      await editor.getByLabel("Count adjustment reason", { exact: true }).fill("Verified unchanged");
      const unchangedPost = page.waitForResponse(response => response.url().endsWith(`${base}/commands`) && response.request().postDataJSON()?.action === "countPost");
      await editor.getByRole("button", { name: "Post count", exact: true }).click();
      assert.equal((await unchangedPost).status(), 200);
      await expect(editor).toHaveCount(0);
      await expect(review).toHaveCount(0);

      // Large discrepancy lists remain complete and pageable; a stock change invalidates acknowledgement.
      const largeId = `large-${suffix}`;
      await command("countStart", { id: largeId, warehouseId });
      await page.reload();
      await expect(page.getByTestId("inventory-sticky-header")).toBeVisible();
      await openCount(largeId);
      const largeSerials = Array.from({ length: 1001 }, (_, i) => `${index}${String(i).padStart(9, "0")}`);
      await editSerials(largeSerials.join("\n"));
      await editor.locator(`#count-${itemId}`).fill("1001");
      await editor.getByLabel("Count adjustment reason", { exact: true }).fill("Large list review");
      await openReview();
      const nextSerialPage = review.getByRole("button", { name: /^Next unexpected serials/ });
      let pages = 1;
      while (await nextSerialPage.isEnabled()) {
        await nextSerialPage.click();
        assert.ok(++pages <= 13);
      }
      assert.equal(pages, 13);
      await expect(review.getByText(largeSerials.at(-1), { exact: true })).toBeVisible();
      assert.ok(await review.locator("li").count() <= 162, "Serial review must not mount the entire large list");
      await acknowledge.check();
      await command("receive", { orderId: suffix, lines: [{ itemId, quantity: 1, serials: [`late-${suffix}`] }] });
      await expect(review.getByText("This review is no longer current", { exact: true })).toBeVisible();
      await expect(confirm).toBeDisabled();
      assert.equal(posts, 2);
      await review.getByRole("button", { name: "Back to count", exact: true }).click();
      await expect(review).toHaveCount(0);
      await expect(editor.locator(`#count-${itemId}`)).toHaveValue("1001");
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS ${mode}: explicit serial review, cancel preserves entries, SSE draft/stock staleness blocks confirmation, one confirmed swap, unchanged direct post, 1001-serial pagination.`);
    }
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
