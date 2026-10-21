const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { chromium, expect } = require("@playwright/test");
const XLSX = require("xlsx");
const { Client } = require("pg");
const baseURL = require("./support/workspace-ui-base.cjs")();
assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Use the disposable owned workspace sandbox.");
const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
const base = `/api/projects/${fixture.projectId}/inventory`;
const sampleSerials = Array.from({ length: 50 }, (_, i) => `MF26${String(i + 1).padStart(8, "0")}`);

(async () => {
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const databaseURL = new URL(process.env.DATABASE_URL);
  assert.equal(databaseURL.hostname, "127.0.0.1");
  assert.equal(databaseURL.username, "workspace_ui");
  const db = new Client({ connectionString: databaseURL.toString() });
  await db.connect();
  try {
    const columns = await db.query(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name IN ('inventory_receipt_pallets','inventory_receipt_pallets_values','inventory_receipt_lines_values')`);
    assert.ok(columns.rows.some(row => row.table_name === "inventory_receipt_pallets" && row.column_name === "expected_quantity" && row.data_type === "integer"));
    assert.ok(columns.rows.some(row => row.table_name === "inventory_receipt_pallets_values" && row.column_name === "value" && row.data_type === "text"));
    assert.ok(columns.rows.some(row => row.table_name === "inventory_receipt_lines_values" && row.column_name === "value" && row.data_type === "text"));
    for (const phone of [false, true]) {
      const suffix = phone ? "PHONE" : "DESKTOP";
      const context = await browser.newContext({ baseURL, viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 900 } });
      const login = await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } });
      assert.equal(login.status(), 200);
      const state = async () => (await (await context.request.get(base)).json()).state;
      const command = async (action, data, operationId = crypto.randomUUID()) => {
        const response = await context.request.post(`${base}/commands`, { data: { operationId, action, data } });
        assert.ok(response.ok(), `${action}: ${await response.text()}`);
        return (await response.json()).state;
      };
      const warehouse = (await state()).warehouses[0].id, itemId = `pallet-meter-${suffix}`;
      const itemName = `Pallet meter ${suffix}`, orderId = `PALLET-PO-${suffix}`, occupied = `OCCUPIED-${suffix}`;
      await command("vendor", { id: `vendor-${suffix}`, name: `Pallet vendor ${suffix}` });
      await command("item", { id: itemId, sku: `PAL-${suffix}`, name: itemName, tracking: "serialized" });
      await command("order", { id: `SEED-PO-${suffix}`, type: "purchase", vendorId: `vendor-${suffix}`, destinationId: warehouse, lines: [{ itemId, quantity: 1 }] });
      await command("release", { orderId: `SEED-PO-${suffix}` });
      await command("receive", { orderId: `SEED-PO-${suffix}`, lines: [{ itemId, quantity: 1, serials: [occupied] }] });
      await command("order", { id: orderId, type: "purchase", vendorId: `vendor-${suffix}`, destinationId: warehouse, lines: [{ itemId, quantity: 100 }] });
      await command("release", { orderId });
      // The API, not just the wizard, enforces membership and discrepancy reasons.
      for (const group of [
        { serials: ["WRONG"], expectedQuantity: 1 },
        { serials: [`REJECT-${suffix}`], expectedQuantity: 2 },
      ]) {
        const response = await context.request.post(`${base}/commands`, { data: { operationId: crypto.randomUUID(), action: "receive",
          data: { orderId, lines: [{ itemId, quantity: 1, serials: [`REJECT-${suffix}`] }],
            pallets: [{ id: crypto.randomUUID(), itemId, label: "Invalid pallet", exceptionReason: "", ...group }] } } });
        assert.equal(response.status(), 409, await response.text());
      }
      const page = await context.newPage();
      page.on("dialog", dialog => dialog.accept());
      const selectTab = async name => {
        if (phone) { await page.getByTestId("inventory-mobile-menu").click(); await page.getByRole("menuitem", { name, exact: true }).click(); }
        else await page.getByRole("tab", { name, exact: true }).click();
        if (phone) {
          const tools = page.getByTestId(`inventory-mobile-tools-${name.toLowerCase()}-toggle`);
          await tools.waitFor({ state: "visible" });
          if (await tools.getAttribute("aria-expanded") === "false") await tools.click();
        }
      };
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      await selectTab("Orders");
      const mainOrder = (await state()).orders.find(order => order.id === orderId);
      const label = mainOrder.number || mainOrder.displayNumber || orderId;
      const receive = page.getByRole("button", { name: "Receive", exact: true });
      // Previous desktop partial receipt leaves one open order on the phone pass.
      await receive.last().click();
      let parent = page.getByRole("dialog", { name: /^Receive purchase/ });
      await parent.locator(`[id="${itemId}-goodQuantity"]`).fill("3");
      await parent.locator(`[id="${itemId}-damagedQuantity"]`).fill("1");
      await parent.locator(`[id="${itemId}-damage-reason"]`).fill("Scuffed meter held for inspection.");
      const openScanner = async () => {
        await parent.getByRole("button", { name: `Scan / edit serials for ${itemName}`, exact: true }).click();
        return page.getByRole("dialog", { name: `Scan serials for ${itemName}`, exact: true });
      };
      let child = await openScanner();
      const createPallet = async (name, expected) => {
        const panel = child.locator("details").first();
        if (!(await panel.evaluate(node => node.open))) await panel.locator("summary").click();
        await child.getByLabel("New pallet ID / label", { exact: true }).fill(name);
        await child.getByLabel("Expected serials", { exact: true }).fill(String(expected));
        await child.getByRole("button", { name: "Create pallet", exact: true }).click();
      };
      const scan = async (serial, damaged = false) => {
        const input = child.getByRole("textbox", { name: `${damaged ? "Known damaged" : "Good"} serial scanner for ${itemName}`, exact: true });
        await input.fill(serial); await input.press("Enter");
        if (await input.count()) await expect(input).toHaveValue("");
        else await expect(child.getByRole("textbox", { name: `Known damaged serial scanner for ${itemName}`, exact: true })).toBeVisible();
      };
      const a1 = `A1-${suffix}`, a2 = `A2-${suffix}`, b1 = `B1-${suffix}`, b2 = `B2-${suffix}`;
      await createPallet(`PAL-A-${suffix}`, 2); await scan(a1);
      await createPallet(`PAL-B-${suffix}`, 2); await scan(b1); await scan(b2);
      await expect(child.getByLabel("Pallet counts")).toContainText(`PAL-A-${suffix}: 1 / 2 scanned · 1 missing`);
      await child.getByRole("button", { name: "Done", exact: true }).click();
      await parent.getByRole("button", { name: "Review movement", exact: true }).click();
      await expect(parent.getByRole("alert")).toContainText(/1 \/ 2 scanned/);
      await parent.getByRole("button", { name: "Save draft", exact: true }).click();
      await expect.poll(async () => (await state()).shipmentDrafts?.find(draft => draft.orderId === orderId)?.capture.entries[itemId]?.pallets?.length).toBe(2);
      await page.reload(); await selectTab("Orders");
      await page.getByRole("button", { name: "Saved shipment drafts", exact: true }).click();
      await page.getByRole("button", { name: "Resume", exact: true }).click();
      parent = page.getByRole("dialog", { name: /^Receive purchase/ });
      child = await openScanner();
      await expect(child.getByLabel("Pallet counts")).toContainText(`PAL-A-${suffix}: 1 / 2`);
      await child.getByLabel("Scan into / view pallet", { exact: true }).click();
      await page.getByRole("option", { name: `PAL-A-${suffix} · 1 / 2`, exact: true }).click();
      await page.getByRole("option", { name: `PAL-A-${suffix} · 1 / 2`, exact: true }).waitFor({ state: "hidden" });
      // Restored draft still has one known-damaged target to capture.
      await child.getByRole("button", { name: /^Known damaged\s/ }).click();
      await scan(a2, true);
      await expect(child.getByLabel("Pallet counts")).toContainText(`PAL-A-${suffix}: 2 / 2 scanned · Complete`);
      await child.getByRole("button", { name: /^Good\s/ }).click();
      const pendingScan = child.getByRole("textbox", { name: `Good serial scanner for ${itemName}`, exact: true });
      await pendingScan.fill("UNCOMMITTED-SCAN");
      await child.getByRole("button", { name: "Import serials from file", exact: true }).click();
      const serialFile = child.getByLabel("Serials file", { exact: true });
      await serialFile.setInputFiles({ name: "serials.csv", mimeType: "text/csv", buffer: Buffer.from(
        `Serial\n${a1}\nNEW-1-${suffix}\nNEW-1-${suffix}\n${occupied}\n${"X".repeat(101)}\nNEW-2-${suffix}\n000789-${suffix}\n`) });
      await child.getByRole("checkbox", { name: /Set Good quantity/ }).check();
      await child.getByRole("button", { name: /Add .*serials/ }).click();
      const importResult = child.getByRole("status").filter({ hasText: /added · \d+ skipped/ });
      await expect(importResult).toContainText("3 added");
      await expect(importResult).toContainText("4 skipped");
      const book = XLSX.utils.book_new();
      const exactSerials = sampleSerials.map(serial => `${serial}-${suffix}`);
      XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Serial"], ...exactSerials.map(serial => [serial])]), "Meters");
      await serialFile.setInputFiles({ name: "meters.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: XLSX.write(book, { type: "buffer", bookType: "xlsx" }) });
      await expect(child.getByText(/50 file serials ready to check/)).toBeVisible();
      await child.getByRole("button", { name: "Add serials to Good", exact: true }).click();
      await expect(importResult).toContainText("50 added");
      await expect(pendingScan).toHaveValue("UNCOMMITTED-SCAN");
      await pendingScan.fill("");
      await expect(child.getByLabel("Pallet counts")).toContainText(`PAL-B-${suffix}: 2 / 2`);
      await expect(child.locator('[id$="-pallet-active"]')).toContainText("No pallet");
      assert.ok(await child.evaluate(node => node.scrollWidth <= node.clientWidth + 1), "Scanner dialog does not overflow");
      assert.equal(await child.evaluate(node => node.scrollTop), 0, "Focus scrolls only the inner scanner pane, not its fixed header/footer");
      const dialogBox = await child.boundingBox();
      const headingBox = await child.getByRole("heading", { name: `Scan serials for ${itemName}`, exact: true }).boundingBox();
      assert.ok(headingBox.y >= dialogBox.y && headingBox.y + headingBox.height <= dialogBox.y + dialogBox.height, "Scanner heading remains visible after large imports");
      fs.mkdirSync("generated-artifacts/receiving-pallets", { recursive: true });
      await page.screenshot({ path: `generated-artifacts/receiving-pallets/${suffix.toLowerCase()}.png` });
      await child.getByRole("button", { name: "Done", exact: true }).click();
      await expect(parent.locator(`[id="${itemId}-goodQuantity"]`)).toHaveValue("56");
      await parent.getByRole("button", { name: "Review movement", exact: true }).click();
      await parent.getByRole("button", { name: "Post movement", exact: true }).click();
      await expect(parent).toHaveCount(0, { timeout: 30000 });
      const saved = await state(), receipt = saved.receipts.find(receipt => receipt.reference === orderId && receipt.action === "receive");
      assert.equal(receipt.pallets.length, 2);
      assert.deepEqual(receipt.pallets[0].serials, [a1, a2]);
      assert.deepEqual(receipt.pallets[1].serials, [b1, b2]);
      assert.equal(receipt.lines[0].serials.length, 56);
      assert.equal(receipt.damaged[0].serials[0], a2);
      const persisted = await db.query("SELECT label,expected_quantity FROM public.inventory_receipt_pallets WHERE project_id=$1 AND parent_id=$2 ORDER BY line_no", [fixture.projectId, receipt.id]);
      assert.equal(persisted.rows.length, 2);
      assert.equal(persisted.rows[0].expected_quantity, 2);
      const members = await db.query("SELECT value FROM public.inventory_receipt_pallets_values WHERE project_id=$1 AND parent_id=$2 ORDER BY line_no,value_no", [fixture.projectId, receipt.id]);
      assert.deepEqual(members.rows.map(row => row.value), [a1, a2, b1, b2]);
      assert.ok(!saved.shipmentDrafts.some(draft => draft.orderId === orderId), "Posting clears saved receiving capture");
      for (const serial of exactSerials) assert.ok(receipt.lines[0].serials.includes(serial));
      const print = await context.request.get(`${base}/print/receipt/${receipt.id}`);
      assert.equal(print.status(), 200);
      const html = await print.text();
      assert.ok(html.includes("Receiving pallet scan history") && html.includes(`PAL-A-${suffix}`) && html.includes("Known damaged"));
      await selectTab("Activity");
      const transaction = page.getByTestId("inventory-activity-group").first();
      await transaction.locator("summary").first().click();
      await transaction.getByText("Receiving pallets (2)", { exact: true }).click();
      await expect(transaction).toContainText(`PAL-A-${suffix}`);
      await command("closeOrder", { orderId, reason: "Owned UI fixture closes the unshipped remainder after verification." });
      console.log(`${suffix}: CSV/Excel import, duplicates, occupied identities, pallet counts, draft reload, relational receipt and printing passed`);
      await context.close();
    }
  } finally { await db.end(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
