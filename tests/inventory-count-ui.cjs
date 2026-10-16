const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium } = require("playwright");

async function main() {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`;
  let context, navigationProjectId;
  try {
    context = await browser.newContext({ baseURL });
    assert.equal((await context.request.post("/api/auth/local/login", { data: { username: fixture.username, password: fixture.password } })).status(), 200);
    const endpoint = `/api/projects/${fixture.projectId}/inventory`;
    const state = async () => (await (await context.request.get(endpoint)).json()).state;
    const command = async (action, data) => {
      const res = await context.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
      assert.equal(res.status(), 200, action);
      return (await res.json()).state;
    };
    for (const id of ["main", "empty"])
      await command("warehouse", { id, code: id.toUpperCase(), name: `${id} fixture`, type: "physical", address: "Test only" });
    await command("vendor", { id: "vendor", name: "Fixture supplier" });
    for (const [id, tracking] of [["bulk", "regular"], ["serial", "serialized"], ["zero", "regular"], ["cancel-discovery", "regular"]])
      await command("item", { id, sku: id.toUpperCase(), name: `${id} fixture`, tracking });
    await command("order", { id: "po", type: "purchase", vendorId: "vendor", destinationId: "main",
      lines: [{ itemId: "bulk", quantity: 5 }, { itemId: "serial", quantity: 2 }] });
    await command("release", { orderId: "po" });
    await command("receive", { orderId: "po", lines: [
      { itemId: "bulk", quantity: 5 }, { itemId: "serial", quantity: 2, serials: ["000001", "000002"] },
    ] });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", e => errors.push(e.message));
    const openCounts = async (target = page) => {
      await target.getByTestId("inventory-workspace").waitFor();
      const menu = target.getByTestId("inventory-mobile-menu");
      if (await menu.isVisible()) {
        await menu.click();
        await target.getByTestId("inventory-mobile-menu-item-counts").click();
      } else await target.getByRole("tab", { name: "Cycle counts", exact: true }).click();
    };
    const unsaved = page.getByRole("dialog", { name: "Unsaved count changes", exact: true });
    const choose = async name => {
      await unsaved.getByRole("button", { name, exact: true }).click();
      if (name !== "Save draft") await unsaved.waitFor({ state: "hidden" });
    };
    const assertUnload = async dirty => assert.equal(await page.evaluate(() => {
      const event = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    }), dirty, "beforeunload reflects only unsaved count values");
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await openCounts();
    const addProduct = async id => {
      await page.getByLabel("Find discovery product", { exact: true }).fill(id);
      await page.getByRole("combobox", { name: "Discovery product", exact: true }).click();
      await page.getByRole("option", { name: new RegExp(`^${id.toUpperCase()} ·`) }).click();
      await page.getByRole("button", { name: "Add discovery to count", exact: true }).click();
    };
    const start = async (location, addBaselineDiscoveries = true) => {
      const header = page.getByTestId("inventory-counts-subheader");
      const tools = header.getByRole("button", { name: /Search & Tools/ });
      if (await tools.isVisible() && await tools.getAttribute("aria-expanded") === "false") await tools.click();
      await header.getByRole("button", { name: "Start count", exact: true }).click();
      const startDialog = page.getByRole("dialog", { name: "Start count", exact: true });
      await startDialog.getByRole("combobox", { name: "Warehouse or vehicle" }).click();
      await page.getByRole("option", { name: `${location.toUpperCase()} · ${location} fixture`, exact: true }).click();
      const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().method() === "POST" && r.request().postDataJSON().action === "countStart");
      await startDialog.getByRole("button", { name: "Start count", exact: true }).click();
      assert.equal((await response).status(), 200);
      await page.getByLabel("Count adjustment reason").waitFor();
      if (addBaselineDiscoveries) for (const id of ["bulk", "serial", "zero"])
        if (!await page.locator(`#count-${id}`).count()) await addProduct(id);
      return (await state()).counts.at(-1);
    };
    const post = async (expectedStatus = 200) => {
      const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) && r.request().method() === "POST" && r.request().postDataJSON().action === "countPost");
      await page.getByRole("button", { name: "Post count", exact: true }).click();
      const res = await response, body = await res.json();
      assert.equal(res.status(), expectedStatus, body.message);
      if (expectedStatus === 200) await page.getByLabel("Count adjustment reason").waitFor({ state: "hidden" });
      return { body, submitted: res.request().postDataJSON().data };
    };
    const continueCount = async number => {
      const id = (await state()).counts[number - 1].id;
      const header = page.getByTestId("inventory-counts-subheader");
      const search = header.getByRole("searchbox", { name: "Search counts", exact: true });
      const tools = header.getByRole("button", { name: /Search & Tools/ });
      if (await tools.isVisible() && await tools.getAttribute("aria-expanded") === "false") await tools.click();
      await search.fill(`Count #${number}`);
      const row = page.locator(`[data-count-id="${id}"]`);
      await row.getByRole("button", { name: "Continue count", exact: true }).click();
      await page.getByLabel("Count adjustment reason").waitFor();
    };

    // Empty warehouse: both regular and serialized discoveries previously disappeared.
    const empty = await start("empty");
    assert.equal(empty.snapshot.length, 0);
    await page.locator("#count-bulk").fill("7");
    await page.locator("#count-serial").fill("2");
    await page.locator("#countserial-serial").fill("000010\n000011");
    await page.getByLabel("Count adjustment reason").fill("Physical discoveries");
    const found = await post();
    assert.equal(found.submitted.lines.length, 3);
    assert.equal(found.body.state.stock.find(b => b.warehouseId === "empty" && b.itemId === "bulk").quantity, 7);
    assert.deepEqual(found.body.state.stock.find(b => b.warehouseId === "empty" && b.itemId === "serial").serials, ["000010", "000011"]);
    assert.equal(found.body.state.counts[0].lines.find(l => l.itemId === "zero").quantity, 0);

    // Item introduced AFTER snapshot creation is rendered and submitted too.
    const existing = await start("main", false);
    assert.equal(await page.locator("#count-bulk").inputValue(), "5");
    assert.equal(await page.locator("#countserial-serial").inputValue(), "000001\n000002");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "");
    await command("item", { id: "late", sku: "LATE", name: "Late discovery", tracking: "regular" });
    await page.reload();
    await openCounts();
    await continueCount(2);
    await addProduct("zero");
    await addProduct("late");
    assert.equal(await page.locator("#count-late").inputValue(), "0");
    await page.locator("#count-late").fill("3");
    await page.getByLabel("Count adjustment reason").fill("New catalog discovery");
    const added = await post();
    assert.deepEqual(added.submitted.lines.find(l => l.itemId === "serial").serials, ["000001", "000002"]);
    assert.equal(added.body.state.stock.find(b => b.warehouseId === "main" && b.itemId === "late").quantity, 3);
    assert.ok(!existing.snapshot.some(b => b.itemId === "late"));

    // A completely untouched stock/scan default set posts without rescanning.
    await start("main");
    const before = (await state()).stock;
    await page.getByLabel("Count adjustment reason").fill("Unchanged physical stock verified");
    const unchanged = await post();
    assert.deepEqual(unchanged.body.state.stock, before);
    assert.equal(unchanged.submitted.lines.length, 4);

    // Close offers all choices. Failed saves retain entries AND the destination.
    await start("main");
    await page.locator("#count-bulk").fill("123");
    await page.getByLabel("Count adjustment reason").fill("Main draft");
    await assertUnload(true);
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await choose("Stay");
    assert.equal(await page.locator("#count-bulk").inputValue(), "123");
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    const failSave = route => route.request().postDataJSON()?.action === "countSaveDraft"
      ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Temporary fixture failure" }) })
      : route.continue();
    await page.route(`**${endpoint}/commands`, failSave);
    await choose("Save draft");
    await unsaved.getByText(/Draft not saved/).waitFor();
    assert.equal(await page.locator("#count-bulk").inputValue(), "123");
    await assertUnload(true);
    await page.unroute(`**${endpoint}/commands`, failSave);
    const abortSave = route => route.request().postDataJSON()?.action === "countSaveDraft" ? route.abort("failed") : route.continue();
    await page.route(`**${endpoint}/commands`, abortSave);
    await choose("Save draft");
    await page.getByRole("button", { name: "Save draft", exact: true }).waitFor();
    await page.waitForFunction(() => !Array.from(document.querySelectorAll('button')).find(b => b.textContent === "Save draft")?.disabled);
    assert.equal(await unsaved.isVisible(), true);
    await page.unroute(`**${endpoint}/commands`, abortSave);
    await choose("Save draft");
    await unsaved.waitFor({ state: "hidden" });
    await page.getByLabel("Count adjustment reason").waitFor({ state: "hidden" });
    await assertUnload(false);
    await continueCount(4);
    assert.equal(await page.locator("#count-bulk").inputValue(), "123");
    await assertUnload(false);
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await start("empty");
    assert.equal(await page.locator("#count-bulk").inputValue(), "7");
    assert.equal(await page.locator("#countserial-serial").inputValue(), "000010\n000011");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "");
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    if (await unsaved.isVisible()) await choose("Discard");
    await continueCount(4);
    assert.equal(await page.locator("#count-bulk").inputValue(), "123");

    // Blank is not zero: fail locally, keeping all entries and reason.
    await page.locator("#count-bulk").fill("");
    await page.getByLabel("Count adjustment reason").fill("Keep this draft");
    let posts = 0;
    const recordPost = request => { if (request.url().endsWith(`${endpoint}/commands`) && request.postDataJSON()?.action === "countPost") posts++; };
    page.on("request", recordPost);
    await page.getByRole("button", { name: "Post count", exact: true }).click();
    await page.getByText(/Blank is not zero/).first().waitFor();
    assert.equal(posts, 0);
    assert.equal(await page.locator("#count-bulk").inputValue(), "");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Keep this draft");
    page.off("request", recordPost);

    // Persist incomplete scans and blank quantities, reload/resume, then reject
    // a second editor instead of silently replacing their saved work.
    const saveDraft = async status => {
      const response = page.waitForResponse(r => r.url().endsWith(`${endpoint}/commands`) &&
        r.request().postDataJSON()?.action === "countSaveDraft");
      await page.getByRole("button", { name: "Save count draft", exact: true }).click();
      const res = await response;
      assert.equal(res.status(), status);
      if (status === 200) await page.getByText(/Draft saved, revision/).waitFor();
    };
    await page.locator("#countserial-serial").fill("000001\npartial-scan");
    const stockBeforeDraft = (await state()).stock;
    await saveDraft(200);
    assert.deepEqual((await state()).stock, stockBeforeDraft);
    await page.reload();
    await openCounts();
    await continueCount(4);
    assert.equal(await page.locator("#count-bulk").inputValue(), "");
    assert.equal(await page.locator("#countserial-serial").inputValue(), "000001\npartial-scan");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Keep this draft");
    const savedCount = (await state()).counts.find(count => count.draft?.reason === "Keep this draft");
    assert.ok(savedCount?.draft, "saved draft belongs to the resumed count");
    await command("countSaveDraft", { id: savedCount.id, revision: savedCount.draft.revision,
      rows: savedCount.draft.rows, reason: "Other operator saved" });
    await page.getByLabel("Count adjustment reason").fill("Unsaved local correction");
    await saveDraft(409);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved local correction");
    // Discard is conditional on the replacement actually loading. A failed
    // refetch must not erase the older editor's edits or hide the editor.
    const failReload = route => route.fulfill({ status: 503, contentType: "application/json",
      body: JSON.stringify({ message: "Temporary fixture reload failure" }) });
    await page.route(`**${endpoint}`, failReload);
    await page.getByRole("button", { name: "Reload saved draft", exact: true }).click();
    await choose("Discard");
    await page.getByText("The saved draft could not be loaded, or the count is no longer open. Your entries were kept.", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved local correction");
    assert.equal(await page.locator("#count-bulk").inputValue(), "");
    assert.equal(await page.locator("#countserial-serial").inputValue(), "000001\npartial-scan");
    await assertUnload(true);
    await page.unroute(`**${endpoint}`, failReload);
    await page.getByRole("button", { name: "Reload saved draft", exact: true }).click();
    await choose("Discard");
    await page.getByText(`Loaded saved draft revision ${savedCount.draft.revision + 1}.`, { exact: true }).waitFor();
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Other operator saved");
    await page.getByLabel("Count adjustment reason").fill("Keep this draft");
    await page.locator("#countserial-serial").fill("000001\n000002");

    // Server reservation safeguards still reject without changing stock/draft.
    const woRes = await context.request.post(`/api/projects/${fixture.projectId}/work-orders`, { data: {
      customerWoId: "COUNT-WO", customerId: "COUNT-CUSTOMER", customerName: "Fixture only", address: "Test only", serviceType: "Electric",
    } });
    assert.equal(woRes.status(), 201);
    const wo = await woRes.json();
    await command("assign", { workOrderId: wo.id, lines: [{ itemId: "bulk", warehouseId: "main", quantity: 2 }] });
    await page.locator("#count-bulk").fill("0");
    const reservedBefore = (await state()).stock;
    const reserved = await post(409);
    assert.match(reserved.body.message, /reserved stock/);
    assert.deepEqual((await state()).stock, reservedBefore);
    assert.equal(await page.locator("#count-bulk").inputValue(), "0");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Keep this draft");
    await command("assign", { workOrderId: wo.id, lines: [] });
    await page.locator("#count-bulk").fill("5");
    await post();

    // Explicit zero removes the serials only after the user clears the scan list.
    await continueCount(5);
    await page.locator("#count-bulk").fill("0");
    await page.locator("#count-serial").fill("0");
    await page.locator("#countserial-serial").fill("");
    await page.getByLabel("Count adjustment reason").fill("Physical zero verified");
    const zero = await post();
    assert.ok(zero.body.state.stock.filter(b => b.warehouseId === "empty").every(b => b.quantity === 0 && b.serials.length === 0));

    // An actual receipt after starting a count cannot be overwritten.
    await start("main");
    await page.getByLabel("Count adjustment reason").fill("Stale attempt");
    await command("order", { id: "po2", type: "purchase", vendorId: "vendor", destinationId: "main", lines: [{ itemId: "bulk", quantity: 1 }] });
    await command("release", { orderId: "po2" });
    await command("receive", { orderId: "po2", lines: [{ itemId: "bulk", quantity: 1 }] });
    const movedBefore = (await state()).stock;
    const stale = await post(409);
    assert.match(stale.body.message, /Stock moved/);
    assert.deepEqual((await state()).stock, movedBefore);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Stale attempt");

    const handoffCount = (await state()).counts.at(-1);
    await command("countSaveDraft", { id: handoffCount.id, revision: 0,
      rows: [{ itemId: "bulk", quantity: "", serials: "" }], reason: "Authorized handoff" });
    // Normal role management grants read access, not counting permission.
    const grant = await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: { permissions: ["projects.view", "workOrders.view", "inventory.view"] } });
    assert.equal(grant.status(), 200);
    const viewer = await browser.newContext({ baseURL });
    assert.equal((await viewer.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    assert.equal((await viewer.request.get(endpoint)).status(), 200);
    const visible = (await (await viewer.request.get(endpoint)).json()).state;
    assert.equal(visible.counts.find(c => c.id === handoffCount.id).draft, undefined);
    assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(),
      action: "countSaveDraft", data: { id: handoffCount.id, revision: 1, rows: [], reason: "Unauthorized" } } })).status(), 403);
    assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(), action: "countPost", data: {
      id: (await state()).counts.at(-1).id, lines: stale.submitted.lines, reason: "Unauthorized attempt",
    } } })).status(), 403);
    const readPage = await viewer.newPage();
    await readPage.goto(`/projects/${fixture.projectId}/inventory`);
    await openCounts(readPage);
    await readPage.getByRole("button", { name: "Continue count", exact: true }).first().click();
    assert.equal(await readPage.getByRole("button", { name: "Post count", exact: true }).isDisabled(), true);
    assert.equal(await readPage.getByRole("button", { name: "Save count draft", exact: true }).isDisabled(), true);
    // Count permission alone is not warehouse access; grant it through normal role management.
    assert.equal((await context.request.put(`/api/subroles/${fixture.viewerRoleId}/permissions`, { data: {
      permissions: ["projects.view", "workOrders.view", "inventory.view", "inventory.count"],
    } })).status(), 200);
    assert.equal((await (await viewer.request.get(endpoint)).json()).state.counts.find(c => c.id === handoffCount.id).draft, undefined);
    assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(),
      action: "countSaveDraft", data: { id: handoffCount.id, revision: 1, rows: [], reason: "No warehouse access" } } })).status(), 409);
    const handoffWarehouse = (await state()).warehouses.find(w => w.id === handoffCount.warehouseId);
    await command("warehouse", { ...handoffWarehouse, userIds: [...handoffWarehouse.userIds, fixture.viewer.id] });
    const resumed = (await (await viewer.request.get(endpoint)).json()).state.counts.find(c => c.id === handoffCount.id);
    assert.equal(resumed.draft.reason, "Authorized handoff");
    assert.equal((await viewer.request.post(`${endpoint}/commands`, { data: { operationId: crypto.randomUUID(),
      action: "countSaveDraft", data: { id: resumed.id, revision: resumed.draft.revision,
        rows: resumed.draft.rows, reason: "Warehouse operator resumed" } } })).status(), 200);
    await viewer.close();

    // Optional isolated capacity fixture: 3,000 catalog products and 600 on-hand
    // products. Paging/filtering never changes the complete submitted set.
    if ((await state()).warehouses.some(w => w.id === "large")) {
      await page.getByRole("button", { name: "Close", exact: true }).first().click();
      await choose("Discard");
      await start("large", false);
      await page.getByText("600 total count entries", { exact: false }).waitFor();
      assert.equal(await page.locator('input[id^="count-capacity-"]').count(), 50);
      assert.equal(await page.locator("#count-bulk").count(), 0);
      await page.locator("#count-capacity-0").fill("0");
      await page.getByRole("button", { name: "Next count entries page", exact: true }).click();
      await page.locator("#count-capacity-50").fill("9");
      await page.getByLabel("Search count entries", { exact: true }).fill("CAP-0599");
      await page.locator("#count-capacity-599").fill("7");
      await addProduct("CAP-2999");
      await page.locator("#count-capacity-2999").fill("4");
      await page.getByLabel("Count adjustment reason").fill("Large warehouse capacity verified");
      await saveDraft(200);
      const largeSaved = (await state()).counts.at(-1);
      assert.equal(largeSaved.draft.rows.length, 601);
      await page.reload();
      await openCounts();
      await continueCount((await state()).counts.length);
      await page.getByLabel("Search count entries", { exact: true }).fill("CAP-2999");
      assert.equal(await page.locator("#count-capacity-2999").inputValue(), "4");
      const largeResult = await post();
      assert.equal(largeResult.submitted.lines.length, 601);
      for (const [id, quantity] of [["capacity-0", 0], ["capacity-50", 9], ["capacity-599", 7], ["capacity-2999", 4]]) {
        assert.equal(largeResult.body.state.stock.find(row => row.warehouseId === "large" && row.itemId === id).quantity, quantity);
      }
      assert.equal(largeResult.body.state.stock.some(row => row.itemId === "capacity-2500"), false);
      console.log("Large count browser passed: 3,000 catalog products, 600 snapshot items, 601 saved/restored/posted rows, 50 mounted rows.");
      await start("large", false);
    }

    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    if (await unsaved.isVisible()) await choose("Discard");
    await start("main", false);
    await fs.mkdir("generated-artifacts/inventory-counts", { recursive: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByLabel("Count adjustment reason").scrollIntoViewIfNeeded();
    await page.screenshot({ path: "generated-artifacts/inventory-counts/mobile.jpg" });

    // True reverts and display-only filters are clean; editing never autosaves.
    const oldQuantity = await page.locator("#count-bulk").inputValue();
    await page.getByRole("button", { name: "Reload saved draft", exact: true }).click();
    if (await unsaved.isVisible()) await choose("Discard");
    await page.getByText("Unsaved count changes. Save the draft to keep your entries.", { exact: true }).waitFor({ state: "hidden" });
    await page.getByLabel("Count adjustment reason").fill("Reverted edit");
    await page.getByLabel("Count adjustment reason").fill((await state()).counts.at(-1).draft?.reason ?? "");
    await assertUnload(false);
    await page.locator("#count-bulk").fill("999");
    await assertUnload(true);
    await page.locator("#count-bulk").fill(oldQuantity);
    await assertUnload(false);
    const baselineSerials = await page.locator("#countserial-serial").inputValue();
    await page.locator("#countserial-serial").fill("000001\nunfinished");
    await assertUnload(true);
    await page.locator("#countserial-serial").fill(baselineSerials);
    await assertUnload(false);
    await page.getByLabel("Search count entries", { exact: true }).fill("bulk");
    await assertUnload(false);
    await page.getByLabel("Search count entries", { exact: true }).fill("");
    let draftWrites = 0;
    const recordDraft = request => { if (request.url().endsWith(`${endpoint}/commands`) && request.postDataJSON()?.action === "countSaveDraft") draftWrites++; };
    page.on("request", recordDraft);
    await page.getByLabel("Count adjustment reason").fill("Unsaved project correction");
    await assertUnload(true);
    assert.equal(draftWrites, 0);
    page.off("request", recordDraft);

    // The modal prevents accidentally starting/switching/cancelling another
    // record underneath the editor. Close and Escape still require a choice.
    const activeNumber = (await state()).counts.length;
    await page.keyboard.press("Escape");
    await choose("Stay");
    assert.equal((await state()).counts.length, activeNumber);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved project correction");
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await choose("Stay");
    assert.equal((await state()).counts.at(-1).status, "open");
    await addProduct("cancel-discovery");
    const quantityBeforeCancel = await page.locator("#count-bulk").inputValue();
    const serialsBeforeCancel = await page.locator("#countserial-serial").inputValue();
    const failCloseSave = route => route.request().postDataJSON()?.action === "countSaveDraft"
      ? route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ message: "Fixture cancellation rejected" }) })
      : route.continue();
    await page.route(`**${endpoint}/commands`, failCloseSave);
    await page.getByRole("button", { name: "Close", exact: true }).first().click();
    await choose("Save draft");
    await page.getByText(/Fixture cancellation rejected/).first().waitFor();
    await choose("Stay");
    assert.equal((await state()).counts.at(-1).status, "open");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved project correction");
    assert.equal(await page.locator("#count-bulk").inputValue(), quantityBeforeCancel);
    assert.equal(await page.locator("#countserial-serial").inputValue(), serialsBeforeCancel);
    assert.equal(await page.locator("#count-cancel-discovery").inputValue(), "0", "discovery survives rejected close/save");
    await assertUnload(true);
    await page.unroute(`**${endpoint}/commands`, failCloseSave);

    // Actual refresh warning can be cancelled without losing entries.
    const refreshWarning = page.waitForEvent("dialog");
    await page.evaluate(() => { setTimeout(() => window.location.reload(), 0); });
    const warning = await refreshWarning;
    assert.equal(warning.type(), "beforeunload");
    await warning.dismiss();
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved project correction");

    // An SPA project change waits for a choice, and never leaks project values.
    const navigationProject = await context.request.post("/api/projects", { data: {
      name: `Count navigation fixture ${fixture.projectId}`, inventoryEnabled: true,
    } });
    assert.equal(navigationProject.status(), 201);
    navigationProjectId = (await navigationProject.json()).id;
    await page.evaluate(url => {
      window.history.pushState({}, "", url);
    }, `/projects/${navigationProjectId}/inventory`);
    await choose("Stay");
    assert.ok(page.url().endsWith(`/projects/${fixture.projectId}/inventory`));
    await page.evaluate(url => window.history.pushState({}, "", url), `/projects/${navigationProjectId}/inventory`);
    await choose("Save draft");
    await unsaved.waitFor({ state: "hidden" });
    await page.waitForURL(`**/projects/${navigationProjectId}/inventory`);
    await openCounts();
    assert.equal(await page.getByLabel("Count adjustment reason").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Post count", exact: true }).count(), 0);
    const newProjectState = (await (await context.request.get(`/api/projects/${navigationProjectId}/inventory`)).json()).state;
    assert.equal(newProjectState.counts.length, 0);
    await page.goBack();
    await openCounts();
    await continueCount(activeNumber);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Unsaved project correction");
    await assertUnload(false);
    // An app navigation event must use the same guard while the modal is open.
    // Trigger the link event directly because the editor blocks pointer access.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel("Count adjustment reason").fill("Saved before app link");
    await page.getByRole("link", { name: "Projects", exact: true, includeHidden: true }).evaluate(link => link.click());
    await choose("Save draft");
    await page.waitForURL("**/projects");
    assert.equal(await unsaved.isVisible(), false);
    assert.equal((await state()).counts.at(-1).draft.reason, "Saved before app link");
    await page.goBack();
    await openCounts();
    await continueCount(activeNumber);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Saved before app link");
    await assertUnload(false);
    // Recreate a forward project entry after following the app link.
    await page.evaluate(url => window.history.pushState({}, "", url), `/projects/${navigationProjectId}/inventory`);
    await page.waitForURL(`**/projects/${navigationProjectId}/inventory`);
    await page.goBack();
    await openCounts();
    await continueCount(activeNumber);
    await page.getByLabel("Count adjustment reason").fill("Forward local change");
    await page.evaluate(() => window.history.forward());
    await unsaved.waitFor();
    assert.ok(page.url().endsWith(`/projects/${fixture.projectId}/inventory`));
    await choose("Stay");
    await page.evaluate(() => window.history.forward());
    await choose("Discard");
    await page.waitForURL(`**/projects/${navigationProjectId}/inventory`);
    await page.goBack();
    await openCounts();
    await continueCount(activeNumber);
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Saved before app link");
    // Push a same-route entry so Back also exercises a dirty transition.
    await page.evaluate(() => window.history.pushState({}, "", window.location.href));
    await page.getByLabel("Count adjustment reason").fill("Back local change");
    await page.evaluate(() => window.history.back());
    await choose("Stay");
    assert.equal(await page.getByLabel("Count adjustment reason").inputValue(), "Back local change");
    await page.evaluate(url => window.history.replaceState({}, "", url), `/projects/${navigationProjectId}/inventory`);
    await choose("Discard");
    await page.waitForURL(`**/projects/${navigationProjectId}/inventory`);
    assert.deepEqual(errors, []);
    console.log("Real stock-count UI passed: dirty/clean navigation, refresh, save/discard/stay, failed saves, history, project isolation, discoveries, save/reload/resume, conflicting editors, permissions and stock safeguards.");
  } finally {
    try {
      if (navigationProjectId) {
        const removed = await context.request.delete(`/api/projects/${navigationProjectId}`);
        assert.ok([200, 204].includes(removed.status()), "Own navigation fixture cleanup failed");
      }
    } finally { await browser.close(); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
