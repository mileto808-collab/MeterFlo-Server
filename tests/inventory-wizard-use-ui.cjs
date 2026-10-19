const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const { chromium, expect } = require("@playwright/test");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required; never run against user data.");
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 1280, height: 900 } });
  const api = async (method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const root = `/api/projects/${fixture.projectId}`;
  const command = (action, data) => api("POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data });
  try {
    await api("POST", "/api/auth/local/login", fixture);
    await api("PATCH", root, { inventoryEnabled: true, wizardMode: "changeout", changeoutEquipmentType: "system",
      wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false, wizardShowGpsStep: true,
      wizardGpsMode: "manual_step", wizardShowSignatureStep: true, wizardShowNotesStep: false });
    const service = (await api("GET", "/api/service-types"))[0];
    const type = (await api("GET", "/api/system-types"))[0];
    await api("PUT", `${root}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", `/api/system-types/${type.id}`, { projectIds: [...new Set([...(type.projectIds || []), fixture.projectId])] });
    await command("warehouse", { id: "wizard-w", code: "WIZ", name: "Wizard stock", type: "physical", address: "Test only" });
    await command("vendor", { id: "wizard-v", name: "Wizard supplier" });
    const removalRules = (await api("GET", `${root}/inventory`)).state.removalRules;
    const fieldRule = removalRules.find(rule => rule.stage === "field" && rule.outcome === "returned");
    const warehouseRule = removalRules.find(rule => rule.stage === "warehouse" && rule.outcome === "scrapped");
    const recordedFieldName = "Customer depot return";
    let fieldDispositionName = recordedFieldName;
    const warehouseDecisionName = "Customer authorized recycling";
    await command("removalRule", { ...fieldRule, name: fieldDispositionName });
    await command("removalRule", { ...warehouseRule, name: warehouseDecisionName });
    for (const item of [
      { id: "qty-system", sku: "QTY-S", name: "Quantity system", equipment: "system" },
      { id: "serial-system", sku: "SER-S", name: "Serialized system", equipment: "system", tracking: "serialized" },
      { id: "serial-module", sku: "SER-M", name: "Serialized module", equipment: "module", tracking: "serialized" },
      { id: "seal", sku: "SEAL", name: "Safety seal" },
      { id: "labor", sku: "LABOR", name: "Changeout labor", kind: "labor", unit: "job" },
      { id: "planned-kit", sku: "PLAN-K", name: "Long project kit title should not appear in planned inventory",
        components: [{ itemId: "qty-system", quantity: 1 }, { itemId: "seal", quantity: 1 }, { itemId: "labor", quantity: 1 }] },
      { id: "manual-kit", sku: "MAN-K", name: "Manual serialized kit", tracking: "serialized",
        components: [{ itemId: "serial-system", quantity: 1 }, { itemId: "serial-module", quantity: 1 }, { itemId: "seal", quantity: 1 }, { itemId: "labor", quantity: 1 }] },
    ]) await command("item", { tracking: "regular", ...item });
    const received = [
      { itemId: "qty-system", quantity: 2, serials: [] },
      { itemId: "serial-system", quantity: 2, serials: ["SYS-LOOSE", "SYS-KIT"] },
      { itemId: "serial-module", quantity: 2, serials: ["MOD-LOOSE", "MOD-KIT"] },
      { itemId: "seal", quantity: 6, serials: [] },
    ];
    await command("order", { id: "wizard-po", type: "purchase", vendorId: "wizard-v", destinationId: "wizard-w",
      lines: received.map(({ itemId, quantity }) => ({ itemId, quantity })) });
    await command("release", { orderId: "wizard-po" });
    await command("receive", { orderId: "wizard-po", lines: received });
    await command("assemble", { warehouseId: "wizard-w", itemId: "manual-kit", quantity: 1, serials: ["KIT-ONE"],
      components: [{ itemId: "serial-system", quantity: 1, serials: ["SYS-KIT"] },
        { itemId: "serial-module", quantity: 1, serials: ["MOD-KIT"] }, { itemId: "seal", quantity: 1, serials: [] }] });
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: "planned-kit" });
    let page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    fs.mkdirSync("generated-artifacts/wizard-use", { recursive: true });
    let next = page.getByTestId("button-wizard-next");
    const choose = async (trigger, option) => {
      await trigger.click();
      await page.getByRole("option", { name: option }).click();
    };
    const makeWork = async (name, both = false, planned = false, assignee) => api("POST", `${root}/work-orders`, {
      customerWoId: `wizard-${name}-${crypto.randomUUID()}`, customerName: "Wizard use fixture", serviceType: service.code,
      status: "Open", oldSystemId: `OLD-S-${name}`, oldSystemReading: "1",
      ...(both ? { oldModuleId: `OLD-M-${name}`, oldModuleRead: "1" } : {}),
      ...(planned ? { newSystemType: type.productId } : {}),
      ...(assignee ? { assignedUserId: assignee } : {}),
    });
    const photo = async kind => {
      // Browser-generated PNG: valid image data, not an unchecked base64 fixture.
      const png = await page.evaluate(() => {
        const canvas = document.createElement("canvas"); canvas.width = 8; canvas.height = 8;
        canvas.getContext("2d").fillRect(0, 0, 8, 8);
        return canvas.toDataURL("image/png").split(",")[1];
      });
      const chooser = page.waitForEvent("filechooser");
      await page.getByTestId(`button-capture-${kind}-photo`).click();
      await (await chooser).setFiles({ name: `${kind}.png`, mimeType: "image/png", buffer: Buffer.from(png, "base64") });
      await expect(page.getByTestId(`photo-thumbnail-${kind}-0`)).toBeVisible();
    };
    const start = async (work, both = false, captures = false) => {
      await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${work.id}`);
      await page.getByRole("button", { name: "Start Changeout", exact: true }).click();
      await page.getByTestId("button-system-can-change").click();
      await page.getByTestId("input-old-system-reading").fill("1");
      if (both) await page.getByTestId("input-old-module-reading").fill("1");
      await next.click();
      if (captures) { await photo("before"); await next.click(); }
      await expect(page.getByText("Perform Physical Changeout", { exact: true })).toBeVisible();
    };
    const scanIds = async (system, module, captures = false) => {
      for (const serial of [system, module].filter(Boolean)) {
        await page.getByTestId("button-hid-id").click();
        await page.getByTestId("input-hid-system-id").pressSequentially(serial, { delay: 5 });
        await page.getByTestId("button-confirm-hid-id").click();
      }
      await expect(next).toBeEnabled();
      await next.click();
      await page.getByTestId("input-new-system-reading").fill("0");
      if (module) await page.getByTestId("input-new-module-reading").fill("0");
      await next.click();
      if (captures) { await photo("after"); await next.click(); }
      await page.getByTestId("input-gps-coordinates").fill("40,-74");
      await next.click();
      if (captures) {
        await page.getByTestId("input-completion-notes").fill("Keep this captured changeout note");
        await next.click();
      }
      await page.getByTestId("button-signature-type-mode").click();
      await page.getByTestId("input-signature-name").fill("Fixture technician");
      await page.getByTestId("button-confirm-type").click();
      await next.click();
    };
    const finish = async (work, both = false, inventory = true) => {
      if (inventory) {
        await expect(page.getByRole("heading", { name: "Inventory use & removed equipment review", level: 3, exact: true })).toBeVisible();
        await expect(page.getByText("Actual stock use was entered during the physical installation step.", { exact: false })).toHaveCount(0);
        for (const [equipment, serial] of [["system", work.oldSystemId], ...(both ? [["module", work.oldModuleId]] : [])]) {
          const card = page.locator(`#removed-${equipment}`).locator("..").locator("..");
          await expect(card.locator(`#removed-${equipment}`)).toHaveValue(serial);
          await choose(card.getByRole("combobox").first(), fieldDispositionName);
          await choose(card.getByRole("combobox").nth(1), /^WIZ ·/);
        }
        await next.click();
      }
      const saved = page.waitForResponse(response => response.request().method() === "POST" &&
        response.url().endsWith(`/work-orders/${work.id}/system-changeout`));
      await page.getByTestId("button-wizard-submit").click();
      const response = await saved;
      assert.ok(response.ok(), `Wizard completion: ${response.status()} ${await response.text()}`);
      await expect(page.getByTestId("button-wizard-submit")).toHaveCount(0);
    };
    // Planned quantity-only kit: labels only, no catalog picker, automatic physical requirements.
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByTestId("input-name").fill("Unsaved project draft");
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    const fieldSettings = page.getByRole("region", { name: "Field inventory settings" });
    await expect(fieldSettings).toBeVisible();
    await choose(page.locator("#field-stock-source-mode"), "Project warehouse stock");
    await choose(page.locator("#field-stock-warehouse"), /^WIZ ·/);
    await fieldSettings.getByRole("button", { name: "Save field inventory settings" }).click();
    await expect(fieldSettings.getByRole("button", { name: "Save field inventory settings" })).toBeDisabled();
    await expect(page.getByTestId("input-name")).toHaveValue("Unsaved project draft");
    await expect.poll(async () => (await api("GET", `${root}/inventory`)).state.fieldSettings?.[0]?.warehouseId).toBe("wizard-w");
    await page.getByRole("tab", { name: "Details", exact: true }).click();
    await page.getByTestId("input-name").fill((await api("GET", root)).name);
    const planned = await makeWork("planned", false, true);
    await start(planned);
    const label = page.getByRole("region", { name: "Planned work-order requirements", exact: true });
    await expect(label).toContainText("Inventory");
    await expect(label).toContainText("Quantity system");
    await expect(label).toContainText("Changeout labor");
    await expect(label).not.toContainText("Long project kit title");
    await expect(page.getByRole("region", { name: "Actual items used", exact: true })).toHaveCount(0);
    await expect(next).toBeEnabled();
    await expect(label).toContainText("Stock source: WIZ");
    await expect(page.locator("#planned-use-warehouse")).toHaveCount(0);
    await expect(page.locator("#planned-stock-mode")).toHaveCount(0);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.screenshot({ path: `generated-artifacts/wizard-use/planned-${width}.jpg`, fullPage: true });
      assert.equal(await page.getByRole("dialog").evaluate(el => el.scrollWidth > el.clientWidth + 1), false);
    }
    await next.click();
    await scanIds("QTY-NEW");
    await finish(planned);
    const completedInventory = await api("GET", `${root}/inventory`);
    const removed = completedInventory.state.returns.find(record => record.workOrderId === planned.id);
    assert.ok(removed, "Completed changeout records removed equipment");
    assert.equal(removed.ruleName, recordedFieldName);
    fieldDispositionName = "Renamed customer depot return";
    await command("removalRule", { ...completedInventory.state.removalRules.find(rule => rule.id === fieldRule.id), name: fieldDispositionName });
    const customerWorkOrder = completedInventory.workOrderLabels[String(planned.id)];
    assert.match(customerWorkOrder, /^wizard-planned-/);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    const removedCard = page.locator("article").filter({ hasText: removed.serial });
    await expect(removedCard).toContainText(`Work order #${customerWorkOrder}`);
    await expect(removedCard).toContainText(`Field disposition: ${fieldDispositionName}`);
    await page.getByRole("button", { name: "Filter returns", exact: true }).click();
    const removalFilters = page.getByRole("dialog");
    assert.ok((await removalFilters.getByLabel("Field disposition", { exact: true }).locator("option").allTextContents()).includes(fieldDispositionName));
    assert.ok(!(await removalFilters.getByLabel("Field disposition", { exact: true }).locator("option").allTextContents()).includes("returned"));
    assert.ok((await removalFilters.getByLabel("Warehouse decision", { exact: true }).locator("option").allTextContents()).includes(warehouseDecisionName));
    await removalFilters.getByLabel("Field disposition", { exact: true }).selectOption({ label: fieldDispositionName });
    await removalFilters.getByRole("button", { name: /^Show 1 / }).click();
    await removedCard.getByRole("button", { name: "Accept into quarantine", exact: true }).click();
    await expect(removedCard.getByLabel("Warehouse decision", { exact: true })).toBeVisible();
    await removedCard.getByLabel("Warehouse decision", { exact: true }).selectOption({ label: warehouseDecisionName });
    await removedCard.getByLabel("Inspection reason", { exact: true }).fill("Customer authorized warehouse inspection");
    page.once("dialog", dialog => dialog.accept());
    await removedCard.getByRole("button", { name: "Record warehouse decision", exact: true }).click();
    await expect(removedCard).toContainText(`Warehouse decision: ${warehouseDecisionName}`);
    const printedEntry = context.waitForEvent("page");
    await removedCard.getByRole("button", { name: `Print removed equipment ${removed.serial}`, exact: true }).click();
    const entryPage = await printedEntry;
    await entryPage.waitForLoadState();
    await expect(entryPage.locator("body")).toContainText(customerWorkOrder);
    await expect(entryPage.locator("body")).toContainText(removed.serial);
    await expect(entryPage.locator("body")).toContainText("Custody & decision history");
    await expect(entryPage.locator("body")).toContainText(fieldDispositionName);
    await expect(entryPage.locator("body")).toContainText(recordedFieldName);
    await expect(entryPage.locator("body")).toContainText(warehouseDecisionName);
    await expect(entryPage.locator("body")).toContainText(fixture.username);
    await expect(entryPage.locator("body")).not.toContainText(removed.history[0].occurredAt);
    await entryPage.screenshot({ path: "generated-artifacts/wizard-use/removed-equipment-entry.jpg", fullPage: true });
    await entryPage.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(removedCard.getByRole("button", { name: `Print removed equipment ${removed.serial}`, exact: true })).toBeVisible();
    await page.screenshot({ path: "generated-artifacts/wizard-use/removed-equipment-phone.jpg", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    const removedCsvDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: "CSV", exact: true }).click();
    const removedCsv = await removedCsvDownload;
    assert.ok(fs.readFileSync(await removedCsv.path(), "utf8").includes(customerWorkOrder));
    const listPrintOpened = context.waitForEvent("page");
    await page.getByRole("button", { name: "PDF / Print", exact: true }).click();
    const listPrint = await listPrintOpened;
    await expect(listPrint.locator("body")).toContainText(customerWorkOrder);
    await listPrint.close();
    assert.equal((await context.request.get(`${root}/inventory/print/return/missing-entry`)).status(), 404);
    const deniedPrintContext = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
    assert.equal((await deniedPrintContext.request.get(`${root}/inventory/print/return/${removed.id}`)).status(), 401);
    assert.ok((await deniedPrintContext.request.post("/api/auth/local/login", { data: fixture.viewer })).ok());
    assert.equal((await deniedPrintContext.request.get(`${root}/inventory/print/return/${removed.id}`)).status(), 403);
    await deniedPrintContext.close();
    await page.getByRole("tab", { name: "Activity", exact: true }).click();
    await page.getByRole("button", { name: "Filter activity", exact: true }).click();
    await page.getByRole("dialog").getByLabel("Warehouse decision", { exact: true }).selectOption({ label: warehouseDecisionName });
    await page.getByRole("dialog").getByRole("button", { name: /^Show 1 / }).click();
    const decisionActivity = page.locator("article").filter({ hasText: `Warehouse decision: ${warehouseDecisionName}` });
    await expect(decisionActivity).toHaveCount(1);
    const activityPrintOpened = context.waitForEvent("page");
    await decisionActivity.getByRole("button", { name: "Print", exact: true }).click();
    const activityPrint = await activityPrintOpened;
    await expect(activityPrint.locator("body")).toContainText(`Warehouse decision: ${warehouseDecisionName}`);
    await activityPrint.close();
    console.log("PASS: project disposition names in wizard, renamed entry details, stable-ID filters, warehouse decisions, recorded activity and printouts.");
    await activityPrint.close();
    await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
    await page.getByRole("button", { name: "Removal rules", exact: true }).click();
    const rulesDialog = page.getByRole("dialog");
    await expect(rulesDialog.getByText("Operational outcome", { exact: true })).toHaveCount(0);
    await rulesDialog.getByRole("button", { name: "Add disposition", exact: true }).click();
    await rulesDialog.getByLabel("Disposition name", { exact: true }).fill("Contract-approved onsite");
    await rulesDialog.getByLabel("Equipment", { exact: true }).selectOption("system");
    await rulesDialog.getByText("Inventory behavior (advanced)", { exact: true }).click();
    await rulesDialog.getByLabel("Inventory action", { exact: true }).selectOption("left_onsite");
    await rulesDialog.getByRole("button", { name: "Save disposition", exact: true }).click();
    await expect(rulesDialog.locator("article").filter({ hasText: "Contract-approved onsite" })).toBeVisible();
    page.once("dialog", dialog => dialog.accept());
    await rulesDialog.getByRole("checkbox", { name: "All removed systems must return to warehouse", exact: true }).click();
    await expect(rulesDialog.getByRole("checkbox", { name: "All removed systems must return to warehouse", exact: true })).not.toBeChecked();
    const systemOptions = rulesDialog.getByRole("group", { name: "Technician options — systems", exact: true });
    const onsiteOption = systemOptions.getByRole("checkbox", { name: "Contract-approved onsite", exact: true });
    await expect(onsiteOption).not.toBeChecked();
    await onsiteOption.check();
    await systemOptions.getByRole("button", { name: "Save system options", exact: true }).click();
    await expect.poll(async () => {
      const s = (await api("GET", `${root}/inventory`)).state;
      const rule = s.removalRules.find(rule => rule.name === "Contract-approved onsite");
      return s.fieldRemovalChoices.some(choice => choice.equipment === "system" && choice.ruleId === rule.id);
    }).toBe(true);
    await rulesDialog.getByRole("checkbox", { name: "All removed systems must return to warehouse", exact: true }).click();
    await expect(rulesDialog.getByRole("checkbox", { name: "All removed systems must return to warehouse", exact: true })).toBeChecked();
    await expect(onsiteOption).toHaveCount(0);
    const coreCustomerRule = rulesDialog.locator("article").filter({ hasText: /^Return to customer/ });
    await coreCustomerRule.getByRole("button", { name: "Edit", exact: true }).click();
    await expect(rulesDialog.locator("#removal-outcome")).toHaveCount(0);
    await expect(rulesDialog).toContainText("Inventory action: Return to customer");
    await rulesDialog.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await rulesDialog.getByRole("button", { name: "Close", exact: true }).click();

    const customerBefore = (await api("GET", `${root}/inventory`)).state;
    const customerRecord = customerBefore.returns.find(record => record.history?.some(event => event.ruleName === warehouseDecisionName));
    assert.ok(customerRecord);
    const customerCard = page.locator("article").filter({ hasText: customerRecord.serial });
    await customerCard.getByRole("button", { name: "Correct warehouse decision", exact: true }).click();
    await customerCard.getByRole("checkbox", { name: /I verified this equipment is still physically present/ }).check();
    await customerCard.getByLabel("Correction reason", { exact: true }).fill("Wrong decision selected; equipment is still in the return cage.");
    page.once("dialog", dialog => dialog.accept());
    await customerCard.getByRole("button", { name: "Record correction", exact: true }).click();
    await expect(customerCard.getByLabel("Warehouse decision", { exact: true })).toBeVisible();
    await customerCard.getByLabel("Warehouse decision", { exact: true }).selectOption({ label: "Return to customer" });
    await customerCard.getByLabel("Inspection reason", { exact: true }).fill("Customer owns the removed equipment.");
    page.once("dialog", dialog => dialog.accept());
    await customerCard.getByRole("button", { name: "Record warehouse decision", exact: true }).click();
    await expect(customerCard).toContainText("Awaiting customer handoff");
    await customerCard.getByLabel("Customer recipient / collected by", { exact: true }).fill("Customer depot representative");
    await customerCard.getByLabel("Handoff / shipping reference (optional)", { exact: true }).fill("COLLECTION-123");
    await customerCard.getByLabel("Handoff notes", { exact: true }).fill("Physically collected by customer.");
    page.once("dialog", dialog => dialog.accept());
    await customerCard.getByRole("button", { name: "Confirm customer handoff", exact: true }).click();
    await expect(customerCard).toContainText("Customer recipient: Customer depot representative");
    await expect(customerCard.getByRole("button", { name: "Correct warehouse decision", exact: true })).toHaveCount(0);
    const customerAfter = (await api("GET", `${root}/inventory`)).state;
    assert.deepEqual(customerAfter.stock, customerBefore.stock, "Scrap correction and customer handoff must not create usable stock");
    assert.equal(customerAfter.returns.find(record => record.id === customerRecord.id).status, "customer_returned");
    const customerPrintEvent = context.waitForEvent("page");
    await customerCard.getByRole("button", { name: `Print removed equipment ${customerRecord.serial}`, exact: true }).click();
    const customerPrint = await customerPrintEvent;
    await customerPrint.waitForLoadState();
    await expect(customerPrint.locator("body")).toContainText("Customer depot representative");
    await expect(customerPrint.locator("body")).toContainText("COLLECTION-123");
    await expect(customerPrint.locator("body")).toContainText("Physical presence verified");
    await expect(customerPrint.locator("body")).toContainText(warehouseDecisionName);
    await customerPrint.close();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(customerCard.getByRole("button", { name: `Print removed equipment ${customerRecord.serial}`, exact: true })).toBeVisible();
    await page.screenshot({ path: "generated-artifacts/wizard-use/customer-return-phone.jpg", fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: "generated-artifacts/wizard-use/customer-return-desktop.jpg", fullPage: true });
    console.log("PASS: explicit technician selections, simplified built-ins, audited scrap correction, customer holding, physical handoff, unchanged stock and project-timezone printout.");
    let snapshot = await api("GET", `${root}/work-orders/${planned.id}/inventory`);
    assert.equal(snapshot.allocation.status, "consumed");
    assert.deepEqual(snapshot.allocation.used.map(line => line.itemId).sort(), ["qty-system", "seal"]);
    assert.deepEqual(snapshot.allocation.lines, []);
    // Unplanned kit, loose components: defer system/module serials to the normal wizard scan.
    await api("PATCH", root, { changeoutEquipmentType: "both" });
    for (const mode of ["components", "kits"]) {
      const work = await makeWork(mode, true);
      await page.setViewportSize({ width: mode === "components" ? 390 : 1280, height: 900 });
      await start(work, true);
      await expect(page.getByRole("region", { name: "Planned work-order requirements", exact: true })).toHaveCount(0);
      const actual = page.getByRole("region", { name: "Actual items used", exact: true });
      await expect(actual).toBeVisible();
      await choose(page.locator("#actual-use-item"), /MAN-K · Manual serialized kit/);
      await expect(page.locator("#actual-use-warehouse")).toHaveCount(0);
      if (mode === "kits") {
        await actual.getByRole("button", { name: "Change kit handling" }).click();
        await choose(page.locator("#planned-stock-mode"), /^Preassembled kits$/);
      }
      await actual.getByRole("button", { name: "Add", exact: true }).click();
      if (mode === "components") {
        // Manual use has no trustworthy kit lineage. Reviewed refresh explicitly
        // clears use for re-selection, instead of guessing a kit from loose rows.
        await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "wizard-w", fulfillment: "kits" });
        await page.getByRole("button", { name: "Review current project defaults", exact: true }).click();
        await expect(page.getByRole("region", { name: "Review approved stock defaults" })).toContainText("clears manual actual-use rows");
        await page.getByRole("button", { name: "Apply approved defaults", exact: true }).click();
        await expect(next).toBeDisabled();
        await choose(page.locator("#actual-use-item"), /MAN-K · Manual serialized kit/);
        await actual.getByRole("button", { name: "Add", exact: true }).click();
        await expect(actual.getByLabel("Kit serial", { exact: true })).toBeVisible();
        await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "wizard-w", fulfillment: "components" });
        await page.getByRole("button", { name: "Review current project defaults", exact: true }).click();
        await page.getByRole("button", { name: "Apply approved defaults", exact: true }).click();
        await choose(page.locator("#actual-use-item"), /MAN-K · Manual serialized kit/);
        await actual.getByRole("button", { name: "Add", exact: true }).click();
      }
      if (mode === "kits") await actual.getByLabel("Kit serial", { exact: true }).fill("KIT-ONE");
      else {
        await expect(actual).toContainText("Scan the new system serial in the next wizard step");
        await expect(actual).toContainText("Scan the new module serial in the next wizard step");
        await expect(actual.getByLabel("Serials used", { exact: true })).toHaveCount(0);
        await expect(actual.getByRole("alert")).toHaveCount(0);
      }
      await page.screenshot({ path: `generated-artifacts/wizard-use/manual-${mode}.jpg`, fullPage: true });
      await expect(next).toBeEnabled();
      await next.click();
      await scanIds(mode === "kits" ? "SYS-KIT" : "SYS-LOOSE", mode === "kits" ? "MOD-KIT" : "MOD-LOOSE");
      await finish(work, true);
      snapshot = await api("GET", `${root}/work-orders/${work.id}/inventory`);
      assert.equal(snapshot.allocation.status, "consumed");
      assert.deepEqual(snapshot.allocation.lines, []);
      assert.deepEqual(snapshot.allocation.used.map(line => line.itemId).sort(),
        mode === "kits" ? ["manual-kit"] : ["seal", "serial-module", "serial-system"]);
      const equipmentSerials = snapshot.allocation.used.flatMap(line => line.serials);
      assert.deepEqual(equipmentSerials.sort(), mode === "kits" ? ["KIT-ONE"] : ["MOD-LOOSE", "SYS-LOOSE"]);
    }
    // Shared vehicle: two technicians use one balance, with no source picker.
    await api("PATCH", root, { changeoutEquipmentType: "system" });
    const registry = await api("GET", "/api/permissions");
    const technicianPermissions = registry.filter(p =>
      ["workOrders.view", "workOrders.meterChangeout", "project.workOrders", "nav.dashboard",
        "inventory.view", "inventory.assign"].includes(p.key)).map(p => p.key);
    await api("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: technicianPermissions });
    await command("warehouse", { id: "shared-vehicle", code: "SHARED", name: "Shared crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [fixture.id, fixture.viewer.id] });
    const vehicleStock = [{ itemId: "qty-system", quantity: 2, serials: [] }, { itemId: "seal", quantity: 2, serials: [] }];
    await command("order", { id: "vehicle-po", type: "purchase", vendorId: "wizard-v", destinationId: "shared-vehicle",
      lines: vehicleStock.map(({ itemId, quantity }) => ({ itemId, quantity })) });
    await command("release", { orderId: "vehicle-po" });
    await command("receive", { orderId: "vehicle-po", lines: vehicleStock });
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "components" });
    const sharedFirst = await makeWork("shared-first", false, true);
    await start(sharedFirst);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Stock source: SHARED");
    await expect(page.locator("#planned-use-warehouse")).toHaveCount(0);
    await next.click(); await scanIds("SHARED-FIRST"); await finish(sharedFirst);
    const adminPage = page;
    const viewerContext = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 390, height: 900 } });
    const login = await viewerContext.request.post("/api/auth/local/login", { data: fixture.viewer });
    assert.ok(login.ok(), "Technician login");
    const forbiddenConfig = await viewerContext.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "fieldSettings", data: { sourceMode: "project_warehouse", warehouseId: "wizard-w" } } });
    assert.equal(forbiddenConfig.status(), 403, "Technicians cannot reconfigure project defaults");
    page = await viewerContext.newPage(); next = page.getByTestId("button-wizard-next");
    page.on("pageerror", error => errors.push(error.message));
    await api("PATCH", root, { wizardShowBeforePhotosStep: true, wizardShowAfterPhotosStep: true,
      wizardShowNotesStep: true });
    const sharedSecond = await makeWork("shared-second", false, true, fixture.viewer.id);
    // Real uploads arrive over time. Deliver chunks after the request's audit
    // middleware has run, rather than relying on a fully buffered small body.
    await page.route(`**/api/projects/${fixture.projectId}/work-orders/${sharedSecond.id}/system-changeout`, async route => {
      const original = route.request(), url = new URL(original.url());
      const headers = { ...await original.allHeaders(), "transfer-encoding": "chunked" };
      delete headers["content-length"];
      const body = original.postDataBuffer();
      assert.ok(body && body.length, "Wizard sends multipart capture");
      const response = await new Promise((resolve, reject) => {
        const request = (url.protocol === "https:" ? https : http).request(url, { method: "POST", headers }, result => {
          const chunks = [];
          result.on("data", chunk => chunks.push(chunk));
          result.on("error", reject);
          result.on("end", () => resolve({ status: result.statusCode, body: Buffer.concat(chunks) }));
        });
        request.on("error", reject);
        void (async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          for (let at = 0; at < body.length; at += 512) {
            request.write(body.subarray(at, at + 512));
            await new Promise(resolve => setTimeout(resolve, 2));
          }
          request.end();
        })().catch(reject);
      });
      await route.fulfill({ status: response.status, contentType: "application/json", body: response.body });
    });
    await start(sharedSecond, false, true);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Stock source: SHARED");
    await expect(page.getByRole("button", { name: "Change stock source" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change kit handling" })).toHaveCount(0);
    await page.screenshot({ path: "generated-artifacts/wizard-use/shared-vehicle-phone.jpg", fullPage: true });
    const forbiddenSource = await viewerContext.request.post(`${root}/inventory/commands`, { maxRetries: 1, data: {
      operationId: crypto.randomUUID(), action: "prepareUse", data: { workOrderId: sharedSecond.id, revision: 0, mode: "changeout",
        used: [{ warehouseId: "wizard-w", itemId: "qty-system", quantity: 1, serials: [] }], dispositions: [] } } });
    assert.equal(forbiddenSource.status(), 403, "Direct API requests cannot bypass source permissions");
    for (const action of ["returnCustomerHandoff", "returnCorrectDecision", "removalFieldChoices"]) {
      const denied = await viewerContext.request.post(`${root}/inventory/commands`, { data: {
        operationId: crypto.randomUUID(), action, data: { id: customerRecord.id },
      } });
      assert.equal(denied.status(), 403, `Field technicians cannot perform ${action}`);
    }
    await next.click(); await scanIds("SHARED-SECOND", undefined, true); await finish(sharedSecond);
    const completedByTechnician = await api("GET", `${root}/work-orders/${sharedSecond.id}`);
    assert.equal(completedByTechnician.status.toLowerCase(), "completed");
    const technicianAudit = await api("GET", `/api/audit?projectId=${fixture.projectId}&entityId=${sharedSecond.id}&actorId=${encodeURIComponent(fixture.viewer.id)}`);
    assert.ok(technicianAudit.events.length, "Streamed completion is audited as the authenticated technician");
    assert.ok(technicianAudit.events.every(event => event.actorId === fixture.viewer.id));
    await api("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: technicianPermissions.filter(permission => permission !== "inventory.assign"),
    });
    const deniedUse = await viewerContext.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "prepareUse", data: { workOrderId: sharedSecond.id, revision: 0,
        mode: "changeout", used: [], dispositions: [] },
    } });
    assert.equal(deniedUse.status(), 403, "Restoring upload identity must not bypass missing inventory permission");
    await api("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: technicianPermissions });
    await api("PATCH", root, { wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false,
      wizardShowNotesStep: false });
    const sharedState = (await api("GET", `${root}/inventory`)).state;
    assert.equal(sharedState.stock.find(s => s.warehouseId === "shared-vehicle" && s.itemId === "qty-system")?.quantity ?? 0, 0);
    assert.equal(sharedState.stock.find(s => s.warehouseId === "wizard-w" && s.itemId === "qty-system")?.quantity, 1);
    // Normal preassembled fulfillment is automatic, including serialized devices inside the kit.
    await api("PATCH", root, { changeoutEquipmentType: "both" });
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: "manual-kit" });
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "kits" });
    const techKitStock = [{ itemId: "serial-system", quantity: 1, serials: ["SYS-TECH"] },
      { itemId: "serial-module", quantity: 1, serials: ["MOD-TECH"] }, { itemId: "seal", quantity: 1, serials: [] }];
    await command("order", { id: "tech-kit-po", type: "purchase", vendorId: "wizard-v", destinationId: "shared-vehicle",
      lines: techKitStock.map(({ itemId, quantity }) => ({ itemId, quantity })) });
    await command("release", { orderId: "tech-kit-po" });
    await command("receive", { orderId: "tech-kit-po", lines: techKitStock });
    await command("assemble", { warehouseId: "shared-vehicle", itemId: "manual-kit", quantity: 1, serials: ["KIT-TECH"],
      components: techKitStock });
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "components" });
    await api("PATCH", root, { wizardShowBeforePhotosStep: true, wizardShowAfterPhotosStep: true, wizardShowNotesStep: true });
    const techKit = await makeWork("tech-kit", true, true, fixture.viewer.id);
    await start(techKit, true, true);
    await next.click(); await scanIds("SYS-TECH", "MOD-TECH", true);
    // Return to the inventory plan after capturing every other wizard field.
    const back = page.getByTestId("button-wizard-back");
    for (let i = 0; i < 9 && !await page.getByText("Perform Physical Changeout", { exact: true }).isVisible(); i++) await back.click();
    const plannedRegion = page.getByRole("region", { name: "Planned work-order requirements" });
    const reviewDefaults = page.getByRole("button", { name: "Review current project defaults", exact: true });
    const applyDefaults = page.getByRole("button", { name: "Apply approved defaults", exact: true });
    await expect(plannedRegion).toContainText("Kit handling: Loose components");
    // Inaccessible approved source fails without losing any captures or use rows.
    await command("warehouse", { id: "shared-vehicle", code: "SHARED", name: "Shared crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [fixture.id] });
    await reviewDefaults.click();
    await expect(page.getByRole("alert").filter({ hasText: "no assigned vehicle" })).toBeVisible();
    await expect(plannedRegion).toContainText("Kit handling: Loose components");
    await command("warehouse", { id: "shared-vehicle", code: "SHARED", name: "Shared crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [fixture.id, fixture.viewer.id] });
    // Method-only change is available to a normal technician, not an override.
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "kits" });
    const forbiddenMethod = await viewerContext.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "prepareUse", data: { workOrderId: techKit.id, revision: 0, mode: "changeout",
        used: techKitStock.map(line => ({ ...line, warehouseId: "shared-vehicle" })), dispositions: [] },
    } });
    assert.equal(forbiddenMethod.status(), 403, "Normal technicians cannot forge a fulfillment override");
    await reviewDefaults.click();
    await expect(page.getByRole("region", { name: "Review approved stock defaults" })).toContainText("Preassembled kits");
    await expect(plannedRegion).toContainText("Kit handling: Loose components");
    await page.getByRole("button", { name: "Keep my entries", exact: true }).click();
    await expect(plannedRegion).toContainText("Kit handling: Loose components");
    await reviewDefaults.click(); await applyDefaults.click();
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Kit handling: Preassembled kits");
    await expect(page.getByRole("button", { name: "Change kit handling" })).toHaveCount(0);
    await expect(next).toBeDisabled();
    await page.getByLabel("Kit serial", { exact: true }).fill("KIT-TECH");
    // A reservation arriving while the wizard is open must not be rebuilt.
    await command("assign", { workOrderId: techKit.id, lines: [
      { warehouseId: "shared-vehicle", itemId: "manual-kit", quantity: 1, serials: ["KIT-TECH"] },
    ] });
    await reviewDefaults.click();
    await expect(page.getByRole("alert").filter({ hasText: "Existing reservations" })).toBeVisible();
    await expect(page.getByLabel("Kit serial", { exact: true })).toHaveValue("KIT-TECH");
    await expect(reviewDefaults).toBeDisabled();
    await command("assign", { workOrderId: techKit.id, lines: [] });
    // Refresh query with the retained-plan recheck, which uses the same basis as submit.
    await page.getByRole("button", { name: "Recheck and keep my entries" }).click();
    await expect(reviewDefaults).toBeEnabled();
    // Location plus method changes are reviewed; a second remote edit invalidates review.
    await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "wizard-w", fulfillment: "components" });
    await reviewDefaults.click();
    await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "wizard-w", fulfillment: "kits" });
    await applyDefaults.click();
    await expect(page.getByRole("alert").filter({ hasText: "Inventory changed again" })).toBeVisible();
    await expect(plannedRegion).toContainText("Stock source: SHARED");
    await applyDefaults.click();
    await expect(plannedRegion).toContainText("Stock source: WIZ");
    await expect(page.getByLabel("Kit serial", { exact: true })).toHaveValue("");
    // Apply both a new location and method together, then return to approved vehicle kits.
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "components" });
    await reviewDefaults.click(); await applyDefaults.click();
    await expect(plannedRegion).toContainText("Stock source: SHARED");
    await expect(plannedRegion).toContainText("Kit handling: Loose components");
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "kits" });
    await reviewDefaults.click(); await applyDefaults.click();
    await page.getByLabel("Kit serial", { exact: true }).fill("KIT-TECH");
    await page.screenshot({ path: "generated-artifacts/wizard-use/refreshed-approved-defaults.jpg", fullPage: true });
    await back.click();
    await expect(page.getByTestId("photo-thumbnail-before-0")).toBeVisible();
    await next.click(); await next.click();
    await expect(page.getByTestId("text-new-system-id")).toHaveText("SYS-TECH");
    await expect(page.getByTestId("text-new-module-id")).toHaveText("MOD-TECH");
    await next.click();
    await expect(page.getByTestId("input-new-system-reading")).toHaveValue("0");
    await expect(page.getByTestId("input-new-module-reading")).toHaveValue("0");
    await next.click();
    await expect(page.getByTestId("photo-thumbnail-after-0")).toBeVisible();
    await next.click();
    await expect(page.getByTestId("input-gps-coordinates")).toHaveValue("40,-74");
    await next.click();
    await expect(page.getByTestId("input-completion-notes")).toHaveValue("Keep this captured changeout note");
    await next.click();
    await expect(page.getByTestId("input-signature-name")).toHaveValue("Fixture technician");
    await expect(next).toBeEnabled();
    await next.click(); await finish(techKit, true);
    const kitUsage = (await api("GET", `${root}/work-orders/${techKit.id}/inventory`)).allocation.used;
    assert.deepEqual(kitUsage.map(l => l.itemId), ["manual-kit"], "Do not deduct loose components again");
    assert.deepEqual(kitUsage[0].serials, ["KIT-TECH"]);
    await api("PATCH", root, { wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false, wizardShowNotesStep: false });
    await api("PATCH", root, { changeoutEquipmentType: "system" });
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: "planned-kit" });
    await command("fieldSettings", { sourceMode: "assigned_vehicle", warehouseId: null, fulfillment: "components" });
    // Multiple assigned vehicles prompt once, then reuse only that technician/project preference.
    await command("warehouse", { id: "second-vehicle", code: "SECOND", name: "Second crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004353", plate: "TEST2", plateState: "CO", userIds: [fixture.viewer.id] });
    const multiple = await makeWork("multiple", false, true, fixture.viewer.id);
    await start(multiple);
    await expect(next).toBeDisabled();
    await choose(page.locator("#planned-use-warehouse"), /^SHARED ·/);
    await expect(next).toBeEnabled();
    const remembered = await makeWork("remembered", false, true, fixture.viewer.id);
    await start(remembered);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Stock source: SHARED");
    await expect(page.locator("#planned-use-warehouse")).toHaveCount(0);
    // Direct physical warehouse mode ignores saved vehicle preferences and needs no transfers.
    await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "wizard-w", fulfillment: "components" });
    const direct = await makeWork("direct", false, true, fixture.viewer.id);
    await start(direct);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Stock source: WIZ");
    await expect(page.getByRole("button", { name: "Change stock source" })).toHaveCount(0);
    await next.click(); await scanIds("DIRECT-WAREHOUSE"); await finish(direct);
    assert.equal((await api("GET", `${root}/work-orders/${direct.id}/inventory`)).allocation.used.every(l => l.warehouseId === "wizard-w"), true);
    await viewerContext.close(); page = adminPage; next = page.getByTestId("button-wizard-next");
    // Inventory disabled: no inventory fetch, picker, review or stock mutation.
    const before = (await api("GET", `${root}/inventory`)).state;
    await api("PATCH", root, { inventoryEnabled: false, changeoutEquipmentType: "system" });
    const disabled = await makeWork("disabled");
    let inventoryFetches = 0;
    page.on("request", request => { if (request.url().endsWith(`/work-orders/${disabled.id}/inventory`)) inventoryFetches++; });
    await start(disabled);
    await expect(page.getByRole("region", { name: "Actual items used", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Planned work-order requirements", exact: true })).toHaveCount(0);
    await expect(next).toBeEnabled();
    await next.click();
    await scanIds("UNTRACKED-NEW");
    await finish(disabled, false, false);
    assert.equal(inventoryFetches, 0);
    await api("PATCH", root, { inventoryEnabled: true });
    const after = (await api("GET", `${root}/inventory`)).state;
    assert.deepEqual(after.stock, before.stock);
    assert.ok(!after.allocations.some(allocation => allocation.workOrderId === disabled.id));
    // A supplied but unmapped type must not expose a manual picker that bypasses configuration.
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: null });
    const unmapped = await makeWork("unmapped", false, true);
    await start(unmapped);
    await expect(label).toContainText("no item mapping");
    await expect(page.getByRole("region", { name: "Actual items used", exact: true })).toHaveCount(0);
    await expect(next).toBeDisabled();
    await require("./support/inventory-location-type-checks.cjs")({ page, api, command, root, fixture, expect });
    assert.deepEqual(errors, []);
    console.log("PASS: independently saved project field stock settings preserve project drafts; two technicians consume shared vehicle stock; assigned-vehicle defaults; remembered multi-vehicle choice; direct warehouse consumption without transfers; unauthorized configuration/source changes rejected; inline planned inventory; manual kits; wizard-only device scans; inventory-disabled workflow unchanged.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
