const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL });
  const prep = await browser.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`, inventory = `${root}/inventory`;
  const request = async (method, path, data, context = prep) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data, context = prep, operationId = crypto.randomUUID()) =>
    request("POST", `${inventory}/commands`, { action, data, operationId }, context);
  const rejected = async (action, data, status = 409) => {
    const response = await prep.request.post(`${inventory}/commands`, { data: { operationId: crypto.randomUUID(), action, data } });
    assert.equal(response.status(), status, await response.text());
  };
  try {
    await request("POST", "/api/auth/local/login", fixture, admin);
    const permissions = ["workOrders.view", "inventory.view", "inventory.maintain", "inventory.assign",
      "inventory.transfer", "inventory.receive", "inventory.purchase"];
    const role = await request("POST", "/api/subroles", { key: `fulfill_${crypto.randomUUID().slice(0, 8)}`,
      label: "Owned fulfillment worker", baseRole: "user", permissions }, admin);
    const credentials = { username: `fulfill-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const user = await request("POST", "/api/users", { ...credentials, firstName: "Owned", lastName: "Warehouse",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] }, admin);
    const group = await request("POST", "/api/user-groups", { name: `Fulfillment crew ${crypto.randomUUID().slice(0, 8)}`,
      projectIds: [fixture.projectId] }, admin);
    await request("POST", "/api/auth/local/login", credentials);
    await command("warehouse", { id: "fulfill-source", code: "FUL-SRC", name: "Fulfillment warehouse", type: "physical", address: "100 Test Road" }, admin);
    await command("warehouse", { id: "fulfill-stage", code: "FUL-STG", name: "Crew staging shelf", type: "physical",
      locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "100 Test Road" }, admin);
    await command("warehouse", { id: "fulfill-vehicle", code: "FUL-VAN", name: "Crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [user.id] }, admin);
    await command("item", { id: "fulfill-meter", sku: "FUL-METER", name: "Fulfillment meter", tracking: "serialized", equipment: "system" });
    await command("vendor", { id: "fulfill-vendor", name: "Fulfillment vendor" });
    await command("order", { id: "fulfill-po", type: "purchase", vendorId: "fulfill-vendor", destinationId: "fulfill-source",
      lines: [{ itemId: "fulfill-meter", quantity: 8 }] });
    await command("release", { orderId: "fulfill-po" });
    await command("receive", { orderId: "fulfill-po", lines: [{ itemId: "fulfill-meter", quantity: 8,
      serials: ["F-A", "F-B", "F-C", "F-D", "F-E", "F-F", "F-G", "F-H"] }] });
    const services = await request("GET", "/api/service-types", undefined, admin);
    const createWork = async (label, scheduled = false, options = {}, planned = true) => {
      const work = await request("POST", `${root}/work-orders`, { customerWoId: label,
        customerName: "Fulfillment customer", serviceType: services[0].code, route: "789", zone: "2233",
        status: scheduled ? "Scheduled" : "Open", ...(scheduled ? { assignedUserId: user.id,
          scheduledAt: new Date(Date.now() + 86400000).toISOString() } : { assignedGroupId: group.name }), ...options }, admin);
      if (planned) await command("plan", { workOrderId: work.id, revision: 0,
        lines: [{ id: crypto.randomUUID(), itemId: "fulfill-meter", kind: "addition", quantity: 1, reason: "Customer replacement" }] });
      return work;
    };
    const crewWork = [await createWork("FUL-CREW-1"), await createWork("FUL-CREW-2")];
    const scheduled = await createWork("FUL-SCHEDULED", true);
    let discovery = await request("GET", `${inventory}/fulfillment`);
    assert.equal(discovery.orders.filter(order => crewWork.some(work => work.id === order.workOrderId)).length, 2);
    const fields = { name: "Owned crew pull", mode: "crew", sourceId: "fulfill-source", stagingId: "fulfill-stage", vehicleId: "fulfill-vehicle" };
    const selection = crewWork.map(work => ({ workOrderId: work.id,
      assignmentVersion: discovery.orders.find(order => order.workOrderId === work.id).assignmentVersion }));
    const batchId = crypto.randomUUID(), operationId = crypto.randomUUID();
    const createPayload = { id: batchId, ...fields, workOrders: selection };
    await command("fulfillmentCreate", createPayload, prep, operationId);
    const replay = await command("fulfillmentCreate", createPayload, prep, operationId);
    assert.equal(replay.state.fulfillmentBatches.filter(batch => batch.id === batchId).length, 1);
    await rejected("fulfillmentCreate", { ...createPayload, id: crypto.randomUUID() });
    const otherGroup = await request("POST", "/api/user-groups", { name: `Other fulfillment crew ${crypto.randomUUID().slice(0, 8)}`,
      projectIds: [fixture.projectId] }, admin);
    const otherInstaller = await request("POST", "/api/users", { username: `fulfill-other-${crypto.randomUUID().slice(0, 8)}`,
      password: `Aa1!${crypto.randomUUID()}`, firstName: "Other", lastName: "Installer", role: "user",
      subroleId: role.id, projectIds: [fixture.projectId] }, admin);
    await createWork("BULK-CREW-A");
    await createWork("BULK-CREW-B");
    await createWork("BULK-CREW-OTHER", false, { assignedGroupId: otherGroup.name });
    await createWork("BULK-UNAVAILABLE", false, {}, false);
    await createWork("BULK-SCHEDULED-OWN", true);
    await createWork("BULK-SCHEDULED-OTHER", true, { assignedUserId: otherInstaller.id });
    const batch = async () => (await request("GET", `${inventory}/fulfillment`)).batches.find(batch => batch.id === batchId);
    assert.equal((await batch()).lines.length, 2);
    const page = await prep.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    const launch = async () => {
      await page.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true }).click();
      await expect(page.getByRole("heading", { name: "Choose an inventory task", exact: true })).toBeVisible();
      await page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
      const home = page.getByTestId("fulfillment-start-screen");
      await expect(home).toBeVisible();
      await expect(page.getByLabel("Search orders", { exact: true })).toHaveCount(0);
      const continueSaved = home.getByRole("button", { name: "Continue saved workflow", exact: true });
      if (await continueSaved.count()) {
        const newCrew = home.getByRole("button", { name: /New crew batch/ });
        if (await newCrew.isEnabled()) {
          await newCrew.click();
          await expect(page.getByRole("alertdialog").getByText("Replace saved workflow inputs?", { exact: true })).toBeVisible();
          await page.getByRole("button", { name: "Keep saved workflow", exact: true }).click();
          await expect(home).toBeVisible();
        }
        await continueSaved.click();
      } else {
        await expect(home.getByRole("button", { name: /New crew batch/ })).toBeFocused();
        await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
        for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(viewport);
          await expect(home.getByRole("button", { name: /New crew batch/ })).toBeVisible();
          await expect.poll(async () => {
            const rect = await page.getByRole("dialog").boundingBox();
            return !!rect && rect.x >= -1 && rect.y >= -1 &&
              rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
          }).toBe(true);
          await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/start-${viewport.width}.png` });
        }
        await page.setViewportSize({ width: 1280, height: 900 });
        await home.getByRole("button", { name: /New crew batch/ }).click();
      }
    };
    await launch();
    const dialog = page.getByRole("dialog");
    const physicalConfirmation = dialog.getByRole("checkbox", { name: /I confirm the listed stock has physically moved/ });
    let selectionPosts = 0;
    const countSelectionPosts = req => {
      if (req.method() === "POST" && req.url().includes(`${inventory}/commands`)) selectionPosts++;
    };
    page.on("request", countSelectionPosts);
    const selectAll = dialog.getByRole("checkbox", { name: "Select all eligible matching orders", exact: true });
    const clearSelection = dialog.getByRole("button", { name: "Clear selection", exact: true });
    const rowCheckbox = label => dialog.locator("label").filter({ hasText: label }).getByRole("checkbox");
    const setFilter = async (label, option) => {
      await dialog.getByLabel(label, { exact: true }).click();
      await page.getByRole("option", { name: option, exact: true }).click();
    };
    await expect(selectAll).toBeDisabled(); // Several crews; never pick the first crew implicitly.
    await setFilter("Work group", group.name);
     const showUnavailable = dialog.getByTestId("fulfillment-show-unavailable");
     await expect(showUnavailable).not.toBeChecked();
     await expect(rowCheckbox("BULK-UNAVAILABLE")).toHaveCount(0);
     await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0);
     await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-CREW");
     await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
     await showUnavailable.check();
     await expect(rowCheckbox("FUL-CREW-1")).toBeDisabled();
     await expect(rowCheckbox("FUL-CREW-2")).toBeDisabled();
     await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
     await showUnavailable.uncheck();
     await dialog.getByLabel("Search orders", { exact: true }).fill("NO-SUCH-WORK-ORDER");
     await expect(dialog.getByText("No matching work orders", { exact: true })).toBeVisible();
     await expect(dialog.getByTestId("fulfillment-no-eligible")).toHaveCount(0);
     await dialog.getByLabel("Search orders", { exact: true }).clear();
     await showUnavailable.check();
    await expect(rowCheckbox("BULK-UNAVAILABLE")).toBeDisabled();
    await selectAll.check();
    await expect(dialog.getByTestId("fulfillment-selection-summary")).toContainText("Selected 2 / Eligible matching 2");
    await expect(rowCheckbox("BULK-CREW-A")).toBeChecked();
    await expect(rowCheckbox("BULK-CREW-B")).toBeChecked();
    await expect(rowCheckbox("FUL-CREW-1")).not.toBeChecked(); // Covered by an existing batch.
    await rowCheckbox("BULK-CREW-A").uncheck();
    await expect(selectAll).toHaveAttribute("data-state", "indeterminate");
    await selectAll.click();
    await expect(rowCheckbox("BULK-CREW-A")).toBeChecked();
    await dialog.getByLabel("Search orders", { exact: true }).fill("BULK-CREW-A");
    await selectAll.uncheck();
    await expect(rowCheckbox("BULK-CREW-A")).not.toBeChecked();
    await dialog.getByLabel("Search orders", { exact: true }).clear();
    await expect(rowCheckbox("BULK-CREW-B")).toBeChecked(); // Hidden selections survive filtered unselect.
    await clearSelection.click();
    await expect(rowCheckbox("BULK-CREW-B")).not.toBeChecked();
    await rowCheckbox("BULK-CREW-A").check();
     await showUnavailable.uncheck();
     await expect(rowCheckbox("BULK-CREW-A")).toBeChecked();
    await setFilter("Work group", otherGroup.name);
    await expect(selectAll).toBeDisabled(); // Hidden selection belongs to another crew.
    await clearSelection.click();
    await expect(selectAll).toBeEnabled();
    await selectAll.check();
    await expect(rowCheckbox("BULK-CREW-OTHER")).toBeChecked();
    await clearSelection.click();
    await dialog.getByRole("button", { name: "Scheduled installer work", exact: false }).click();
    await expect(selectAll).toBeDisabled(); // Several installers.
    await setFilter("Work group", "Any group");
    await setFilter("Installer", credentials.username);
    await selectAll.check();
    await expect(rowCheckbox("FUL-SCHEDULED")).toBeChecked();
    await expect(rowCheckbox("BULK-SCHEDULED-OWN")).toBeChecked();
    await expect(rowCheckbox("BULK-SCHEDULED-OTHER")).toHaveCount(0);
    await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-SCHEDULED");
    await clearSelection.click();
    await expect(rowCheckbox("FUL-SCHEDULED")).not.toBeChecked();
    await dialog.getByLabel("Search orders", { exact: true }).clear();
    await expect(rowCheckbox("BULK-SCHEDULED-OWN")).not.toBeChecked(); // Clear selection clears hidden too.
    await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await selectAll.scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const rect = await selectAll.boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= viewport.width;
      }, { message: "Bulk checkbox must remain in the settled viewport." }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/bulk-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(selectionPosts, 0, "Selections must never post stock operations.");
    page.off("request", countSelectionPosts);
    await dialog.getByRole("button", { name: "Resume saved batch", exact: false }).click();
    await dialog.getByRole("button", { name: "Resume batch", exact: true }).click();
    await expect(dialog.getByText("Scan stock as it is pulled")).toBeVisible();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toBeFocused();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveAttribute("data-wizard-focus-target", "true");
    const checkDuplicateScans = async (phase) => {
      const input = dialog.getByTestId(`fulfillment-custody-serials-${phase}-fulfill-meter`);
      const quantity = dialog.getByTestId(`fulfillment-move-quantity-${phase}-fulfill-meter`);
      const progress = dialog.getByTestId(`fulfillment-scan-progress-${phase}-fulfill-meter`);
      await quantity.fill("2");
      await expect(progress).toContainText("Scanned 0 / 2");
      await expect(progress).toContainText("2 left to scan");
      await input.fill("F-A");
      await input.press("Enter");
      await expect(progress).toContainText("Scanned 1 / 2");
      await expect(progress).toContainText("1 left to scan");
      await input.pressSequentially("F-A");
      await input.press("Enter");
      await expect(input).toHaveValue("F-A\n");
      await expect(dialog.getByText(/Already scanned or recorded in this batch: F-A/)).toBeVisible();
      await input.pressSequentially("F-B");
      await input.press("Tab");
      await expect(input).toBeFocused();
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(progress).toContainText("Scanned 2 / 2");
      await expect(progress).toContainText("0 left to scan");
      await expect(progress.getByRole("status")).toHaveText("Scanning complete — all required serials captured.");
      await input.pressSequentially("F-B");
      await input.press("Tab");
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(dialog.getByText("Required scan count reached. Extra serials were not added.", { exact: true })).toBeVisible();
      await quantity.fill("1");
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(progress).toContainText("1 extra");
      await expect(progress.getByRole("status")).toContainText("Your captured serials have been kept.");
      await quantity.fill("2");
      await input.evaluate(element => {
        element.setSelectionRange(element.value.length, element.value.length);
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "F-C\nF-D\n");
        element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
      });
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(progress).toContainText("Scanned 2 / 2");
      await input.fill("F-A\n");
      await input.evaluate(element => {
        element.setSelectionRange(element.value.length, element.value.length);
        const clipboardData = new DataTransfer();
        clipboardData.setData("text/plain", "F-A\nF-B\nF-B");
        element.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
      });
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(dialog.getByText(/Already scanned or recorded in this batch: F-A, F-B/)).toBeVisible();
      await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await input.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/duplicate-scan-${phase}.png` });
      await page.setViewportSize({ width: 1280, height: 900 });
      await input.fill("");
      await quantity.fill("");
    };
    await checkDuplicateScans("stage");
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("2");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-A\nF-B");
    await dialog.getByLabel(/reason/i).first().fill("Physically pulled and scanned at the warehouse");
    await physicalConfirmation.check();
    await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect(dialog.getByRole("button", { name: "Record physical pull", exact: true })).toBeVisible();
      await expect.poll(async () => {
        const rect = await dialog.boundingBox();
        return !!rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
      }, { message: "The whole dialog, including header and footer, must stay inside the viewport." }).toBe(true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Partial pulls keep their own form. Navigation must not post or silently discard another pull.
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-A");
    await dialog.getByRole("button", { name: "Record physical pull", exact: true }).click();
    await expect.poll(async () => (await batch()).lines.reduce((sum, line) => sum + line.stagedQuantity, 0)).toBe(1);
    const partialHandoff = dialog.getByRole("button", { name: "Hand off already-staged stock", exact: true });
    await expect(partialHandoff).toBeVisible();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("");
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-B");
    await dialog.getByLabel("Physical move reason", { exact: true }).fill("Second physical pull not recorded yet");
    await physicalConfirmation.check();
    let navigationPosts = 0;
    const countNavigationPosts = req => {
      if (req.method() === "POST" && req.url().endsWith(`${inventory}/commands`)) navigationPosts++;
    };
    page.on("request", countNavigationPosts);
    await partialHandoff.click();
    const warning = page.getByRole("alertdialog");
    await expect(warning.getByText("Unrecorded movement entries", { exact: true })).toBeVisible();
    await warning.getByRole("button", { name: "Stay and review", exact: true }).click();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("1");
    await expect(dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter")).toHaveValue("F-B");
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveValue("Second physical pull not recorded yet");
    await expect(physicalConfirmation).toBeChecked();
    await partialHandoff.click();
    await warning.getByRole("button", { name: "Discard entries and continue", exact: true }).click();
    await expect(dialog.getByTestId("fulfillment-move-quantity-vehicle-fulfill-meter")).toBeVisible();
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveValue("");
    await expect(physicalConfirmation).not.toBeChecked();
    assert.equal(navigationPosts, 0, "Changing steps must not move stock.");
    page.off("request", countNavigationPosts);
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("");
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-B");
    await dialog.getByLabel("Physical move reason", { exact: true }).fill("Second physical pull confirmed at the warehouse");
    await physicalConfirmation.check();
    // Lose the response AFTER the server records the move. Reload must recover that same identity.
    let intercepted = false;
    await page.route(`**${inventory}/commands`, async route => {
      if (!intercepted && route.request().postDataJSON().action === "fulfillmentMove") {
        intercepted = true;
        await route.fetch(); await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByRole("button", { name: "Record physical pull", exact: true }).click();
    await expect.poll(async () => (await batch()).lines.reduce((sum, line) => sum + line.stagedQuantity, 0)).toBe(2);
    await page.reload();
    await launch();
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).pending,
      `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`)).toBe(null);
    await expect(dialog.getByTestId("fulfillment-staging-complete")).toBeVisible();
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Record physical pull", exact: true })).toHaveCount(0);
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const next = dialog.getByRole("button", { name: "Continue to vehicle handoff", exact: true });
      await expect(next).toBeEnabled();
      await expect.poll(async () => {
        const rect = await dialog.boundingBox();
        return !!rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
      }, { message: "Wait for the resized dialog to fit the viewport." }).toBe(true);
      await expect.poll(async () => {
        const rect = await next.boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= viewport.width && rect.y >= 0 && rect.y + rect.height <= viewport.height;
      }, { message: "Completed staging's primary action stays visible." }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/staged-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    let state = (await request("GET", inventory)).state;
    assert.equal(state.receipts.filter(receipt => receipt.reference === batchId && receipt.action === "fulfillmentMove").length, 2);
    assert.equal(state.allocations.some(a => crewWork.some(w => w.id === a.workOrderId)), false);
    const current = await batch();
    let handoffId = crypto.randomUUID();
    const handoff = { id: batchId, revision: current.revision, phase: "vehicle",
      lines: [{ itemId: "fulfill-meter", quantity: 2, serials: ["F-B", "F-A"] }],
      reason: "Physically counted and handed to the crew vehicle", physicallyConfirmed: true };
    await page.setViewportSize({ width: 390, height: 844 });
    const stepBody = dialog.getByTestId("fulfillment-step-body");
    await stepBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await dialog.getByRole("button", { name: "Continue to vehicle handoff", exact: true }).click();
    const handoffQuantity = dialog.getByTestId("fulfillment-move-quantity-vehicle-fulfill-meter");
    const handoffSerials = dialog.getByTestId("fulfillment-custody-serials-vehicle-fulfill-meter");
    await expect(handoffQuantity).toBeFocused();
    await expect(handoffQuantity).toHaveAttribute("data-wizard-focus-target", "true");
    await expect.poll(async () => {
      const input = await handoffQuantity.boundingBox();
      const body = await stepBody.boundingBox();
      return !!input && !!body && input.y >= body.y && input.y + input.height <= body.y + body.height;
    }).toBe(true);
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/handoff-step-focus-390.png" });
    await checkDuplicateScans("vehicle");
    const acceptSerials = dialog.getByTestId("fulfillment-accept-staged-fulfill-meter");
    const picker = dialog.getByTestId("fulfillment-serial-picker-fulfill-meter");
    const searchSerials = dialog.getByLabel("Search staged serials for Fulfillment meter", { exact: true });
    const chooseSerial = serial => picker.getByRole("checkbox", { name: `Hand off staged serial ${serial}`, exact: true });
    await picker.locator("summary").click();
    let preparationPosts = 0;
    const countPreparationPosts = req => {
      if (req.method() === "POST" && req.url().endsWith(`${inventory}/commands`)) preparationPosts++;
    };
    page.on("request", countPreparationPosts);
    await chooseSerial("F-A").check();
    await expect(handoffSerials).toHaveValue("F-A");
    await expect(handoffQuantity).toHaveValue("1");
    await searchSerials.fill("f-b");
    await expect(chooseSerial("F-A")).toHaveCount(0);
    await chooseSerial("F-B").check();
    await expect(handoffSerials).toHaveValue("F-A\nF-B");
    await expect(handoffQuantity).toHaveValue("2");
    await expect(picker.getByRole("status")).toHaveText("2 selected / 2 available · 1 matching");
    await searchSerials.fill("not-staged");
    await expect(picker.getByText("No staged serials match this search.")).toBeVisible();
    await expect(handoffSerials).toHaveValue("F-A\nF-B");
    await searchSerials.fill("");
    await chooseSerial("F-A").uncheck();
    await expect(handoffSerials).toHaveValue("F-B");
    await expect(handoffQuantity).toHaveValue("1");
    await chooseSerial("F-B").uncheck();
    await expect(handoffSerials).toHaveValue("");
    await expect(handoffQuantity).toHaveValue("0");
    await handoffQuantity.fill("1");
    await handoffSerials.fill("F-UNKNOWN");
    await acceptSerials.click();
    await expect(dialog.getByText(/scan box contains a serial that is not available/)).toBeVisible();
    await expect(handoffSerials).toHaveValue("F-UNKNOWN");
    await expect(handoffQuantity).toHaveValue("1");
    await chooseSerial("F-A").click();
    await expect(handoffSerials).toHaveValue("F-UNKNOWN");
    await expect(chooseSerial("F-A")).not.toBeChecked();
    await handoffSerials.fill("F-B\nF-B");
    await chooseSerial("F-A").check();
    await expect(handoffSerials).toHaveValue("F-B\nF-A");
    await expect(handoffQuantity).toHaveValue("2");
    await chooseSerial("F-A").uncheck();
    await handoffSerials.fill("F-B");
    await acceptSerials.click();
    await expect(handoffSerials).toHaveValue("F-B\nF-A");
    await expect(handoffQuantity).toHaveValue("2");
    await acceptSerials.click();
    await expect(handoffSerials).toHaveValue("F-B\nF-A");
    await expect(handoffQuantity).toHaveValue("2");
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveValue("");
    await expect(physicalConfirmation).not.toBeChecked();
    assert.equal(preparationPosts, 0, "Serial selection, searches and visual acceptance never post stock movements.");
    page.off("request", countPreparationPosts);
    assert.equal((await batch()).lines.reduce((sum, line) => sum + line.deliveredQuantity, 0), 0, "Visual acceptance alone does not post a handoff.");
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await expect.poll(async () => {
        const rect = await dialog.boundingBox();
        return !!rect && rect.x >= -1 && rect.x + rect.width <= viewport.width + 1;
      }).toBe(true);
      await acceptSerials.scrollIntoViewIfNeeded();
      await expect.poll(async () => {
        const rect = await acceptSerials.boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= viewport.width;
      }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/accept-serials-${viewport.width}.png` });
      await chooseSerial("F-B").scrollIntoViewIfNeeded();
      await expect(chooseSerial("F-B")).toBeVisible();
      assert.equal(await picker.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await expect.poll(async () => {
        const rect = await chooseSerial("F-B").boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= viewport.width && rect.y >= 0 && rect.y + rect.height <= viewport.height;
      }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/choose-serials-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await chooseSerial("F-A").uncheck();
    await expect(handoffSerials).toHaveValue("F-B");
    await expect(handoffQuantity).toHaveValue("1");
    await dialog.getByRole("button", { name: "Save & leave", exact: true }).click();
    await page.reload();
    await launch();
    await expect(handoffSerials).toHaveValue("F-B");
    await expect(handoffQuantity).toHaveValue("1");
    await picker.locator("summary").click();
    await expect(chooseSerial("F-B")).toBeChecked();
    await expect(chooseSerial("F-A")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Record vehicle handoff", exact: true })).toBeDisabled();
    // Normal role controls must disable preparation while permission is revoked, without losing captures.
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: permissions.filter(p => p !== "inventory.transfer") }, admin);
    await page.reload();
    await launch();
    await picker.locator("summary").click();
    await expect(chooseSerial("F-A")).toBeDisabled();
    await expect(searchSerials).toBeDisabled();
    await expect(acceptSerials).toBeDisabled();
    await expect(handoffSerials).toHaveValue("F-B");
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions }, admin);
    await page.reload();
    await launch();
    await picker.locator("summary").click();
    await expect(chooseSerial("F-A")).toBeEnabled();
    // Unknown outcomes retain the exact partial handoff and lock both existing and new preparation controls.
    await page.unroute(`**${inventory}/commands`);
    let unknownHandoff;
    await page.route(`**${inventory}/commands`, async route => {
      const payload = route.request().postDataJSON();
      if (payload.action === "fulfillmentMove" && payload.data.phase === "vehicle") {
        unknownHandoff = payload;
        await route.abort("failed");
      } else await route.continue();
    });
    await dialog.getByLabel("Physical move reason", { exact: true }).fill(handoff.reason);
    await physicalConfirmation.check();
    await dialog.getByRole("button", { name: "Record vehicle handoff", exact: true }).click();
    await expect(dialog.getByText("Movement outcome needs confirmation", { exact: true })).toBeVisible();
    assert.deepEqual(unknownHandoff.data.lines, [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-B"] }]);
    await expect(chooseSerial("F-A")).toBeDisabled();
    await expect(searchSerials).toBeDisabled();
    await expect(acceptSerials).toBeDisabled();
    await page.reload();
    await launch();
    await picker.locator("summary").click();
    await expect(chooseSerial("F-A")).toBeDisabled();
    await expect(handoffSerials).toHaveValue("F-B");
    await page.unroute(`**${inventory}/commands`);
    const retry = page.waitForRequest(req => req.url().endsWith(`${inventory}/commands`) && req.method() === "POST" && req.postDataJSON().data.phase === "vehicle");
    await dialog.getByRole("button", { name: "Check receipt / retry same command", exact: true }).click();
    assert.deepEqual((await retry).postDataJSON(), unknownHandoff);
    await expect.poll(async () => (await batch()).lines.reduce((sum, line) => sum + line.deliveredQuantity, 0)).toBe(1);
    await expect(chooseSerial("F-B")).toHaveCount(0);
    await expect(chooseSerial("F-A")).toBeEnabled();
    await expect(acceptSerials).toHaveText("Accept displayed serials (1)");
    await chooseSerial("F-A").check();
    await expect(handoffSerials).toHaveValue("F-A");
    await expect(handoffQuantity).toHaveValue("1");
    await dialog.getByLabel("Physical move reason", { exact: true }).fill(handoff.reason);
    await physicalConfirmation.check();
    const posted = page.waitForRequest(req => req.url().endsWith(`${inventory}/commands`) && req.method() === "POST" && req.postDataJSON().data.phase === "vehicle");
    await dialog.getByRole("button", { name: "Record vehicle handoff", exact: true }).click();
    const actualHandoff = (await posted).postDataJSON();
    assert.deepEqual(actualHandoff.data.lines, [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-A"] }]);
    handoffId = actualHandoff.operationId;
    await expect(dialog.getByText("Vehicle handoff complete", { exact: true })).toBeVisible();
    await expect(dialog.locator("[data-wizard-complete]")).toBeFocused();
    await expect(dialog.locator("[data-wizard-complete]")).toHaveAttribute("data-wizard-focus-target", "true");
    await expect(dialog.getByRole("button", { name: "Record vehicle handoff", exact: true })).toHaveCount(0);
    const combinedButton = dialog.getByRole("button", { name: "Print combined receipt", exact: true });
    await expect(combinedButton).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Print movement receipt", exact: true })).toHaveCount(0);
    const combinedPageEvent = prep.waitForEvent("page");
    await combinedButton.click();
    const combinedPage = await combinedPageEvent;
    await expect(combinedPage.getByRole("heading", { name: "Combined fulfillment receipt", exact: true })).toBeVisible();
    assert.ok(combinedPage.url().endsWith(`${inventory}/print/fulfillment/${batchId}`));
    await expect(combinedPage.getByRole("button", { name: "Print / Save PDF", exact: true })).toHaveCount(1);
    await expect(combinedPage.getByRole("heading", { level: 3 }).filter({ hasText: "Warehouse → Staging" })).toHaveCount(2);
    await expect(combinedPage.getByRole("heading", { level: 3 }).filter({ hasText: "Staging → Vehicle" })).toHaveCount(2);
    const batchSummary = await combinedPage.locator("table").first().locator("tbody td").allTextContents();
    assert.deepEqual(batchSummary.slice(1), ["2", "2", "2", "0", "0"], "Repeated custody moves must not double the batch quantities.");
    await expect(combinedPage.getByText(/Work orders:.*FUL-CREW-1/)).toBeVisible();
    await combinedPage.close();
    await command(actualHandoff.action, actualHandoff.data, prep, handoffId);
    assert.equal((await batch()).status, "completed");
    const print = await prep.request.get(`${inventory}/print/receipt/${handoffId}`);
    assert.equal(print.status(), 200);
    assert.match(await print.text(), /Owned crew pull/); assert.match(await print.text(), /FUL-CREW-1/);
    const workAfter = await request("GET", `${root}/work-orders/${crewWork[0].id}`);
    assert.equal(workAfter.assigned_group_id, group.name);
    discovery = await request("GET", `${inventory}/fulfillment`);
    const scheduledCandidate = discovery.orders.find(order => order.workOrderId === scheduled.id);
    assert.ok(scheduledCandidate.eligible);
    await dialog.getByRole("button", { name: "Back to saved batches", exact: true }).click();
    await expect(combinedButton).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Receipt", exact: true })).toHaveCount(0);
    const savedPrintEvent = prep.waitForEvent("page");
    await combinedButton.click();
    const savedPrint = await savedPrintEvent;
    await expect(savedPrint.getByRole("heading", { name: "Combined fulfillment receipt", exact: true })).toBeVisible();
    await savedPrint.close();
    assert.equal((await prep.request.get(`${inventory}/print/fulfillment/${crypto.randomUUID()}`)).status(), 404);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: permissions.filter(permission => permission !== "workOrders.view") }, admin);
    assert.equal((await prep.request.get(`${inventory}/print/fulfillment/${batchId}`)).status(), 403);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions }, admin);
    await page.reload();
    await launch();
    await dialog.getByRole("button", { name: "Scheduled installer work", exact: false }).click();
    await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-SCHEDULED");
    await dialog.locator("label").filter({ hasText: "FUL-SCHEDULED" }).getByRole("checkbox").check();
    await dialog.getByLabel("Batch name", { exact: true }).fill("Owned scheduled pull");
    for (const [label, option] of [["Warehouse source", "Fulfillment warehouse"], ["Staging destination", "Crew staging shelf"], ["Vehicle", "Crew vehicle"]]) {
      await dialog.getByLabel(label, { exact: true }).click();
      await page.getByRole("option", { name: new RegExp(option) }).click();
    }
    await dialog.getByRole("button", { name: "Review batch", exact: true }).click();
    await expect(dialog.locator("[data-wizard-review]")).toBeFocused();
    await expect(dialog.locator("[data-wizard-review]")).toHaveAttribute("data-wizard-focus-target", "true");
    await dialog.getByRole("button", { name: "Create saved batch", exact: true }).click();
    await expect(dialog.getByText("Scan stock as it is pulled", { exact: true })).toBeVisible();
    discovery = await request("GET", `${inventory}/fulfillment`);
    const scheduledId = discovery.batches.find(batch => batch.name === "Owned scheduled pull").id;
    const stageId = crypto.randomUUID();
    await command("fulfillmentMove", { id: scheduledId, revision: 1, phase: "stage",
      lines: [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-C"] }],
      reason: "Scheduled installer equipment physically staged", physicallyConfirmed: true }, prep, stageId);
    state = (await request("GET", inventory)).state;
    assert.deepEqual(state.allocations.find(a => a.workOrderId === scheduled.id).lines[0].serials, []);
    await request("PATCH", `${root}/work-orders/${scheduled.id}`, { status: "Open", assignedUserId: null, assignedGroupId: group.name }, admin);
    await rejected("fulfillmentMove", { id: scheduledId, revision: 2, phase: "vehicle",
      lines: [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-C"] }],
      reason: "Must not deliver for an obsolete assignment", physicallyConfirmed: true });
    await command("fulfillmentClose", { id: scheduledId, revision: 2, reason: "Assignment changed; release staged stock for warehouse review" });
    state = (await request("GET", inventory)).state;
    assert.equal(state.stock.find(stock => stock.warehouseId === "fulfill-stage" && stock.itemId === "fulfill-meter").quantity, 1);
    assert.equal(state.allocations.find(a => a.workOrderId === scheduled.id).lines.length, 0);
     await page.keyboard.press("Escape");
     await page.evaluate(key => localStorage.removeItem(key),
       `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`);
     await page.reload();
     await launch();
     await expect(showUnavailable).not.toBeChecked();
     await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-CREW-1");
     await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
     for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
       await page.setViewportSize(viewport);
       await showUnavailable.scrollIntoViewIfNeeded();
       await expect(showUnavailable).toBeVisible();
       assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
       await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/eligible-empty-${viewport.width}.png` });
     }
     await page.setViewportSize({ width: 1280, height: 900 });
     await showUnavailable.check();
     await expect(rowCheckbox("FUL-CREW-1")).toBeDisabled();
     await request("PATCH", `${root}/work-orders/${crewWork[0].id}`, { status: "Completed",
       oldSystemId: "FUL-OLD-A", newSystemId: "F-A", oldSystemReading: 1, newSystemReading: 0,
       signatureName: "Fulfillment acceptance",
       signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }, admin);
     await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0, { timeout: 20000 });
     await expect(dialog.getByText("No matching work orders", { exact: true })).toBeVisible();
     discovery = await request("GET", `${inventory}/fulfillment`);
     assert.ok(!discovery.orders.some(order => order.workOrderId === crewWork[0].id));
     assert.ok(discovery.batches.some(batch => batch.id === batchId && batch.status === "completed"),
       "Completing a work order does not delete its fulfillment batch history.");
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view", "inventory.view"] }, admin);
    await rejected("fulfillmentClose", { id: scheduledId, revision: 3, reason: "Permission revoked during an open wizard" }, 403);
    assert.deepEqual(errors, []);
    console.log("PASS filtered crew/scheduled bulk selection, searchable partial serial handoffs, scan/checkbox deduplication, saved selections, permission and unknown-outcome locks, delivered-unit exclusion, no preparation stock posts, responsive controls, recoverable staging, exactly-once handoff, readable print, reassignment safety and release semantics.");
  } finally { await prep.close(); await admin.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
