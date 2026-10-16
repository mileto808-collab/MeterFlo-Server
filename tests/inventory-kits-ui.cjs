// Acceptance runs only against the owned inventory-ui-fixture; never customer data.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");
const { expect } = require("@playwright/test");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/inventory-kits";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  try {
    const context = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}`, viewport: { width: 1440, height: 1000 }, hasTouch: true, isMobile: true });
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const post = async (action, data) => {
      const response = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(response.status(), 200, await response.text()); return response.json();
    };
    const snapshot = async () => (await (await context.request.get(endpoint)).json()).state;
    await post("warehouse", { id: "kits-w", code: "KITS", name: "Kit acceptance warehouse", type: "physical", address: "Disposable fixture" });
    await post("vendor", { id: "kits-v", name: "Kit acceptance supplier" });
    await post("item", { id: "kits-part", sku: "KIT-PART", name: "Recovery component", tracking: "regular" });
    await post("item", { id: "kits-meter", sku: "KIT-METER", name: "Serial component", tracking: "serialized" });
    await post("item", { id: "kits-regular", sku: "KIT-REG", name: "Regular acceptance kit", tracking: "regular", components: [{ itemId: "kits-part", quantity: 2 }] });
    await post("item", { id: "kits-serial", sku: "KIT-SER", name: "Serial acceptance kit", tracking: "serialized", components: [{ itemId: "kits-meter", quantity: 1 }] });
    await post("order", { id: "kits-po", type: "purchase", vendorId: "kits-v", destinationId: "kits-w", lines: [{ itemId: "kits-part", quantity: 20 }, { itemId: "kits-meter", quantity: 3 }] });
    await post("release", { orderId: "kits-po" });
    await post("receive", { orderId: "kits-po", lines: [{ itemId: "kits-part", quantity: 20 }, { itemId: "kits-meter", quantity: 3, serials: ["M1", "M2", "M3"] }] });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    const header = page.getByTestId("inventory-items-subheader");
    await header.getByRole("button", { name: "Assemble kit", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Assemble kit", exact: true });
    await dialog.getByLabel("Stock location", { exact: true }).selectOption("kits-w");
    await dialog.getByLabel("Kit item", { exact: true }).selectOption("kits-regular");
    await dialog.getByLabel("Kit quantity", { exact: true }).fill("3");
    await dialog.getByRole("button", { name: "Review operation", exact: true }).click();
    await expect(dialog.getByLabel("Kit operation review")).toContainText("6");
    await page.screenshot({ path: `${out}/desktop-assembly.jpg` });
    await dialog.getByRole("button", { name: "Confirm assembly", exact: true }).click();
    await expect(dialog).toBeHidden();
    let state = await snapshot();
    const assemblyId = state.receipts.filter(r => r.action === "assemble").at(-1).id;
    assert.equal(state.stock.find(b => b.itemId === "kits-regular").quantity, 3);
    await header.getByRole("button", { name: "Disassemble kit", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Disassemble kit", exact: true });
    await dialog.getByLabel("Stock location", { exact: true }).selectOption("kits-w");
    await dialog.getByLabel("Kit item", { exact: true }).selectOption("kits-regular");
    await dialog.getByLabel("Recorded source assembly").selectOption(assemblyId);
    await dialog.getByLabel("usable", { exact: true }).fill("0");
    await dialog.getByLabel("damaged", { exact: true }).fill("2");
    await dialog.getByLabel("Damage / shortage reason").fill("One component bent");
    await dialog.getByLabel("Disassembly reason", { exact: true }).fill("Recover warehouse stock");
    await dialog.getByRole("button", { name: "Review operation", exact: true }).click();
    // Real commit, deliberately lost confirmation. Retrying must not recover twice.
    let lost = false;
    await page.route(`**${endpoint}/commands`, async route => {
      const body = route.request().postDataJSON();
      if (body.action === "disassemble" && !lost) {
        lost = true; const actual = await route.fetch(); assert.equal(actual.status(), 200);
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Acceptance: confirmation lost" }) });
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Confirm disassembly", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("confirmation lost");
    await dialog.getByRole("button", { name: "Retry same operation", exact: true }).click();
    await expect(dialog).toBeHidden();
    await page.unroute(`**${endpoint}/commands`);
    state = await snapshot();
    assert.equal(state.stock.find(b => b.itemId === "kits-regular").quantity, 2);
    assert.equal(state.receipts.filter(r => r.action === "disassemble").length, 1);
    assert.equal(state.kitHolds.find(h => h.itemId === "kits-part").quantity, 2);
    // A definite validation rejection must keep the editor usable.
    await header.getByRole("button", { name: "Assemble kit", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Assemble kit", exact: true });
    await dialog.getByLabel("Stock location", { exact: true }).selectOption("kits-w");
    await dialog.getByLabel("Kit item", { exact: true }).selectOption("kits-serial");
    const scan = async (label, serial, key = "Enter") => {
      const section = dialog.locator("section").filter({ has: page.getByRole("heading", { name: label, exact: true }) }).last();
      await section.getByRole("button", { name: "Scan serials", exact: true }).click();
      const scanner = page.getByRole("dialog", { name: `${label} scanner`, exact: true });
      await scanner.getByRole("textbox", { name: `${label} serial`, exact: true }).fill(serial);
      await scanner.getByRole("textbox", { name: `${label} serial`, exact: true }).press(key);
      await expect(scanner.getByText("1 of 1 committed", { exact: true })).toBeVisible();
      await scanner.getByRole("button", { name: "Done", exact: true }).click();
    };
    await scan("Serial component", "M1");
    await scan("Finished kit serials", "S1", "Tab");
    await dialog.getByRole("button", { name: "Review operation", exact: true }).click();
    let rejectedOnce = false;
    await page.route(`**${endpoint}/commands`, async route => {
      if (route.request().postDataJSON().action === "assemble" && !rejectedOnce) {
        rejectedOnce = true;
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "Acceptance: stock changed before posting" }) });
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Confirm assembly", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("stock changed");
    await expect(dialog.getByRole("button", { name: "Back to edit", exact: true })).toBeEnabled();
    await dialog.getByRole("button", { name: "Back to edit", exact: true }).click();
    await page.unroute(`**${endpoint}/commands`);
    await dialog.getByRole("button", { name: "Review operation", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm assembly", exact: true }).click();
    await expect(dialog).toBeHidden();
    state = await snapshot();
    assert.ok(state.serialOccupancy.some(o => o.serial === "M1"));
    const serialAssemblyId = state.receipts.filter(r => r.action === "assemble").at(-1).id;
    await header.getByRole("button", { name: "Disassemble kit", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Disassemble kit", exact: true });
    await dialog.getByLabel("Stock location", { exact: true }).selectOption("kits-w");
    await dialog.getByLabel("Kit item", { exact: true }).selectOption("kits-serial");
    await dialog.getByLabel("Recorded source assembly").selectOption(serialAssemblyId);
    await scan("Source kit serials", "S1", "Tab");
    await scan("Serial component · usable recovered", "M1");
    await dialog.getByLabel("Disassembly reason", { exact: true }).fill("Physical serial recovery confirmed");
    await dialog.getByRole("button", { name: "Review operation", exact: true }).click();
    await dialog.getByRole("button", { name: "Confirm disassembly", exact: true }).click();
    await expect(dialog).toBeHidden();
    state = await snapshot();
    assert.ok(state.stock.find(b => b.itemId === "kits-meter").serials.includes("M1"));
    assert.ok(!state.serialOccupancy.some(o => o.serial === "M1"));
    // Phone portrait + landscape: action tools and modals remain inside viewport.
    for (const viewport of [{ width: 390, height: 760 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const tools = header.getByRole("button", { name: /Show Search & Tools/ });
      if (await tools.isVisible()) await tools.click();
      await expect(header.getByRole("button", { name: "Disassemble kit", exact: true })).toBeVisible();
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      await header.getByRole("button", { name: "Disassemble kit", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Disassemble kit", exact: true });
      await expect(dialog).toBeVisible();
      assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().width <= innerWidth));
      assert.ok(await dialog.evaluate(el => el.getBoundingClientRect().height <= innerHeight + 1));
      assert.notEqual(await page.evaluate(() => document.activeElement?.tagName), "INPUT", "phone opening must not summon keyboard");
      await page.screenshot({ path: `${out}/phone-${viewport.width}.jpg` });
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    }
    // Inspection-only mode must expose its exact-operation retry, even if a
    // later permission rejection follows a lost successful confirmation.
    await page.setViewportSize({ width: 1440, height: 1000 });
    await header.getByRole("button", { name: "Inspect kit holds", exact: true }).click();
    dialog = page.getByRole("dialog", { name: "Kit batch inspection", exact: true });
    await dialog.getByLabel("Inspection resolution reason", { exact: true }).fill("Inspected component is usable");
    await dialog.getByLabel(/^Quantity to decide for hold /).fill("1");
    const inspectionIds = [];
    await page.route(`**${endpoint}/commands`, async route => {
      const body = route.request().postDataJSON();
      if (body.action !== "resolveKitHold") return route.continue();
      inspectionIds.push(body.operationId);
      if (inspectionIds.length === 1) {
        assert.equal((await route.fetch()).status(), 200);
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Acceptance: inspection confirmation lost" }) });
      }
      if (inspectionIds.length === 2) return route.fulfill({ status: 403, contentType: "application/json",
        body: JSON.stringify({ message: "Acceptance: temporary permission rejection" }) });
      await route.continue();
    });
    await dialog.getByRole("button", { name: "Release selected to stock", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("inspection confirmation lost");
    const retryInspection = dialog.getByRole("button", { name: "Retry hold resolution", exact: true });
    await retryInspection.click();
    await expect(dialog.getByRole("alert")).toContainText("temporary permission rejection");
    await expect(retryInspection).toBeEnabled();
    await expect(dialog.getByRole("button", { name: "Close", exact: true }).first()).toBeDisabled();
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(dialog).toBeVisible();
    await retryInspection.click();
    await expect(dialog.getByRole("status")).toContainText("receipt confirmed");
    assert.equal(new Set(inspectionIds).size, 1);
    state = await snapshot();
    assert.equal(state.receipts.filter(r => r.action === "resolveKitHold").length, 1);
    assert.equal(state.kitHolds.find(h => h.itemId === "kits-part").status, "held");
    assert.equal(state.stock.find(b => b.itemId === "kits-part").quantity, 15);
    await dialog.getByLabel("Inspection resolution reason", { exact: true }).fill("Remaining damaged component scrapped");
    await dialog.getByLabel(/^Quantity to decide for hold /).fill("1");
    await dialog.getByRole("button", { name: "Scrap selected", exact: true }).click();
    await expect(dialog.getByText("Remaining damaged component scrapped", { exact: true })).toBeVisible();
    state = await snapshot();
    assert.equal(state.kitHolds.find(h => h.itemId === "kits-part").status, "resolved");
    assert.equal(state.kitHolds.find(h => h.itemId === "kits-part").dispositions.length, 2);
    assert.equal(state.stock.find(b => b.itemId === "kits-part").quantity, 15);
    await page.unroute(`**${endpoint}/commands`);
    await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
    await expect(dialog).toBeHidden();
    await post("item", { id: "kits-multi", sku: "KIT-MULTI", name: "Multi serial recovery kit", tracking: "serialized",
      components: [{ itemId: "kits-meter", quantity: 3 }] });
    const multi = await post("assemble", { warehouseId: "kits-w", itemId: "kits-multi", quantity: 1, serials: ["MULTI1"],
      components: [{ itemId: "kits-meter", quantity: 3, serials: ["M1", "M2", "M3"] }] });
    await post("disassemble", { warehouseId: "kits-w", assemblyId: multi.state.receipts.at(-1).id, quantity: 1, serials: ["MULTI1"],
      components: [{ itemId: "kits-meter", usableQuantity: 0, usableSerials: [], damagedQuantity: 2,
        damagedSerials: ["M1", "M2"], missingQuantity: 1, missingSerials: ["M3"], reason: "Two damaged, one missing" }] });
    for (const [index, viewport] of [{ width: 390, height: 760 }, { width: 844, height: 390 }].entries()) {
      await page.setViewportSize(viewport);
      await page.reload();
      if (await page.evaluate(() => matchMedia("(max-width: 767px), (orientation: landscape) and (pointer: coarse) and (max-height: 600px) and (max-width: 960px)").matches)) {
        await page.getByTestId("inventory-mobile-menu").click();
        await page.getByTestId("inventory-mobile-menu-item-items").click();
        await page.getByTestId("inventory-mobile-tools-items-toggle").click();
      } else await page.getByRole("tab", { name: "Items", exact: true }).click();
      await page.getByRole("button", { name: "Inspect kit holds", exact: true }).click();
      dialog = page.getByRole("dialog", { name: "Kit batch inspection", exact: true });
      const serial = index ? "M2" : "M1";
      await expect(dialog.getByRole("checkbox", { name: /^Select serial M3 / })).toHaveCount(0);
      await dialog.getByRole("checkbox", { name: new RegExp(`^Select serial ${serial} `) }).check();
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
      const discard = page.getByRole("dialog", { name: "Discard kit operation draft?", exact: true });
      await expect(discard).toBeVisible();
      await discard.getByRole("button", { name: /keep/i }).click();
      await dialog.getByLabel("Inspection resolution reason", { exact: true }).fill(`Phone ${serial} inspected`);
      const button = dialog.getByRole("button", { name: index ? "Scrap selected" : "Release selected to stock", exact: true });
      await button.scrollIntoViewIfNeeded();
      const overflow = await dialog.evaluate(element => [element, ...element.querySelectorAll("article, fieldset, label, section")].some(node => node.scrollWidth > node.clientWidth + 2));
      assert.equal(overflow, false, "inspection contents fit the phone viewport");
      await page.screenshot({ path: `${out}/phone-inspection-${viewport.width}.jpg` });
      await button.click();
      await expect(dialog.getByText(`Phone ${serial} inspected`, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "Close", exact: true }).last().click();
      await expect(dialog).toBeHidden();
    }
    state = await snapshot();
    const multiHold = state.kitHolds.find(h => h.itemId === "kits-meter");
    assert.equal(multiHold.status, "resolved");
    assert.deepEqual(multiHold.serials, ["M1", "M2"]);
    assert.deepEqual(multiHold.dispositions.map(d => d.serials), [["M1"], ["M2"]]);
    assert.deepEqual(state.stock.find(b => b.itemId === "kits-meter").serials, ["M1"]);
    await page.setViewportSize({ width: 1440, height: 1000 });
    // Grant through normal role management, not direct table seeding.
    const viewer = await browser.newContext({ baseURL: `https://${process.env.REPLIT_DEV_DOMAIN}` });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action: "disassemble", data: {} } })).status(), 403);
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, {
      data: { permissions: ["workOrders.view", "projects.view", "inventory.view", "inventory.assemble"] },
    })).status(), 200);
    const granted = await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action: "disassemble", data: {
      warehouseId: "kits-w", assemblyId, quantity: 1, serials: [], components: [{
        itemId: "kits-part", usableQuantity: 2, damagedQuantity: 0, missingQuantity: 0,
        usableSerials: [], damagedSerials: [], missingSerials: [], reason: "",
      }], reason: "Permission check",
    } } });
    assert.equal(granted.status(), 409, "granted action reaches warehouse access validation, not missing permission");
    await viewer.close();
    assert.deepEqual(errors, []);
    console.log("PASS: kit assembly/modal, HID Enter/Tab, partial disassembly, damaged custody, unknown-outcome replay, role grants, phone portrait/landscape.");
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exit(1); });
