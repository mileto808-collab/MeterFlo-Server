// Run only with the disposable project from tests/support/inventory-ui-fixture.ts.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({
    headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"],
  });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const send = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, {
        data: { operationId: crypto.randomUUID(), action, data },
      });
      assert.equal(response.status(), 200, await response.text());
      return (await response.json()).state;
    };
    for (const id of ["activity-source", "activity-destination"])
      await send("warehouse", { id, code: id.toUpperCase(), name: id, type: "physical", address: "Disposable fixture" });
    await send("vendor", { id: "activity-vendor", name: "Activity vendor" });
    await send("item", { id: "activity-seal", sku: "ACT-SEAL", name: "Activity seal", tracking: "serialized" });
    const purchaseId = crypto.randomUUID(), transferId = crypto.randomUUID();
    const lines = [{ itemId: "activity-seal", quantity: 2, serials: ["0000ACT-01", "0000ACT-02"] }];
    const plannedLines = lines.map(({ itemId, quantity }) => ({ itemId, quantity }));
    await send("order", { id: purchaseId, type: "purchase", vendorId: "activity-vendor", destinationId: "activity-source", lines: plannedLines });
    await send("release", { orderId: purchaseId });
    await send("receive", { orderId: purchaseId, lines });
    await send("order", { id: transferId, type: "transfer", sourceId: "activity-source", destinationId: "activity-destination", lines: plannedLines });
    await send("release", { orderId: transferId });
    await send("dispatch", { orderId: transferId, lines });
    const before = await send("accept", { orderId: transferId, lines });
    const purchase = before.orders.find(order => order.id === purchaseId);
    const transfer = before.orders.find(order => order.id === transferId);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    const titles = page.getByTestId("inventory-activity-title");
    await titles.first().waitFor();
    const displayed = await titles.allTextContents();
    for (const [action, order] of [["receive", purchase], ["dispatch", transfer], ["accept", transfer]]) {
      assert.ok(displayed.includes(`${action} · ${order.orderNumber}`), `${action} displays readable order number`);
      assert.ok(!displayed.some(text => text.includes(order.id)), "Title does not expose internal order UUID");
    }
    const activityText = await page.getByTestId("inventory-activity-entries").innerText();
    assert.ok(activityText.includes(fixture.username), "Activity details show the actor username, including an unassigned administrator");
    for (const receipt of before.receipts)
      assert.ok(!activityText.includes(receipt.actor), "Activity details do not display actor UUIDs");
    const decodeBarcodes = async document => {
      await document.addScriptTag({ path: "node_modules/html5-qrcode/third_party/zxing-js.umd.js" });
      return document.locator(".internal-barcode").evaluateAll(async figures => {
        const results = {};
        for (const figure of figures) {
          const svg = figure.querySelector("svg");
          const image = new Image();
          image.width = svg.viewBox.baseVal.width;
          image.height = svg.viewBox.baseVal.height;
          image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
          await image.decode();
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = "white";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const luminance = new Uint8ClampedArray(canvas.width * canvas.height);
          for (let i = 0; i < luminance.length; i++) luminance[i] = pixels[i * 4];
          const source = new ZXing.RGBLuminanceSource(luminance, canvas.width, canvas.height);
          const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
          results[figure.querySelector("figcaption").textContent] = new ZXing.MultiFormatReader().decode(bitmap, new Map()).getText();
        }
        return results;
      });
    };
    const popupPromise = page.waitForEvent("popup");
    await page.getByTestId("inventory-activity-entries").getByRole("button", { name: "Print", exact: true }).first().click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    assert.ok((await popup.locator("body").innerText()).includes(transfer.orderNumber), "Print still resolves the transfer");
    const receipt = before.receipts.find(receipt => receipt.action === "accept" && receipt.reference === transferId);
    assert.ok(popup.url().includes(encodeURIComponent(receipt.id)), "Print uses the immutable receipt ID");
    await fs.mkdir("generated-artifacts/inventory-activity", { recursive: true });
    for (const movement of before.receipts) {
      await popup.goto(`${endpoint}/print/receipt/${movement.id}`);
      const text = await popup.locator("body").innerText();
      assert.ok(text.includes(fixture.username), "Printed receipt shows the actor username");
      for (const id of [movement.id, movement.reference, movement.actor])
        assert.ok(!text.includes(id), "Receipt text contains no raw tracking or actor UUID");
      assert.match(text, /Receipt #\d+/);
      assert.deepEqual(await popup.locator("#serial-details .serial-text").allTextContents(), lines[0].serials,
        "Authenticated receipt route renders only the movement's exact serials");
      const summary = await popup.locator("table").first().innerText();
      assert.ok(summary.includes("2 serials"));
      assert.ok(!summary.includes(lines[0].serials[0]), "Summary keeps serial detail in the appendix");
      const decoded = await decodeBarcodes(popup);
      assert.deepEqual(decoded, { "Internal receipt ID": movement.id, "Internal order ID": movement.reference },
        "Independent scanner decodes barcodes to original immutable identifiers");
      await popup.emulateMedia({ media: "print" });
      assert.equal(await popup.getByRole("button").isVisible(), false);
      await popup.screenshot({ path: `generated-artifacts/inventory-activity/${movement.action}-receipt-print.jpg`, fullPage: true });
      await popup.emulateMedia({ media: "screen" });
    }
    await popup.close();
    const after = (await (await context.request.get(endpoint)).json()).state;
    assert.deepEqual(after.receipts, before.receipts, "Displaying labels never rewrites receipt references");
    await page.screenshot({ path: "generated-artifacts/inventory-activity/readable-order-labels.jpg" });
    assert.deepEqual(errors, []);
    console.log("Activity uses readable PO/transfer numbers for receive, dispatch and accept; print links and stored references preserved.");
  } finally {
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
