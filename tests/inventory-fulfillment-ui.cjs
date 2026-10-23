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
  const tech = await browser.newContext({ baseURL });
  // Page-based workflows reserve space for workspace navigation, unlike the
  // former viewport-filling modal. Very short desktop/landscape windows are a
  // separate layout acceptance concern; retain phone, desktop and landscape
  // coverage here without turning a test modernization into a product change.
  const viewports = [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 480 }];
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
    const techRole = await request("POST", "/api/subroles", { key: `pickup_${crypto.randomUUID().slice(0, 8)}`,
      label: "Pickup-only technician", baseRole: "user", permissions: ["workOrders.view", "nav.projects"] }, admin);
    const techCredentials = { username: `pickup-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const technician = await request("POST", "/api/users", { ...techCredentials, firstName: "Pickup", lastName: "Technician",
      role: "user", subroleId: techRole.id, projectIds: [fixture.projectId] }, admin);
    await request("POST", "/api/auth/local/login", techCredentials, tech);
    const group = await request("POST", "/api/user-groups", { name: `Fulfillment crew ${crypto.randomUUID().slice(0, 8)}`,
      projectIds: [fixture.projectId] }, admin);
    await request("POST", "/api/auth/local/login", credentials);
    await command("warehouse", { id: "fulfill-source", code: "FUL-SRC", name: "Fulfillment warehouse", type: "physical", address: "100 Test Road" }, admin);
    await command("warehouse", { id: "fulfill-stage", code: "FUL-STG", name: "Crew staging shelf", type: "physical",
      locationTypeId: "57e15eca-f991-4328-a091-000000000003", address: "100 Test Road" }, admin);
    await command("warehouse", { id: "fulfill-vehicle", code: "FUL-VAN", name: "Crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO", userIds: [user.id, technician.id] }, admin);
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
        lines: [{ id: crypto.randomUUID(), itemId: "fulfill-meter", kind: "addition", quantity: 1, reason: "Customer replacement" }] }, admin);
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
    const pickups = async () => (await request("GET", "/api/inventory/pickups", undefined, tech)).pickups;
    assert.deepEqual(await pickups(), []);
    assert.equal((await tech.request.get(inventory)).status(), 403, "Pickup-only technicians do not gain general warehouse access.");
    const ticketResponse = await prep.request.get(`${inventory}/fulfillment/${batchId}/pick-ticket`);
    assert.equal(ticketResponse.status(), 200);
    const ticketHtml = await ticketResponse.text();
    assert.match(ticketHtml, /Pick ticket.*PICK-/);
    assert.match(ticketHtml, /data:image\/png;base64,/);
    assert.match(ticketHtml, /FUL-METER/);
    assert.match(ticketHtml, /Picked/);
    assert.match(ticketHtml, /Printing\/checking this sheet does not reserve stock/);
    const techPage = await tech.newPage();
    await techPage.goto(`${baseURL}/`);
    await expect(techPage.getByTestId("section-ready-pickups")).toContainText("Nothing staged for your vehicle");
    const page = await prep.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    const wizard = page.getByTestId("inventory-fulfillment-page");
    // This is a page, not the old modal. Navigation highlights required fields
    // without focusing an input or opening the phone keyboard.
    const expectStepAtTop = async () => {
      await expect.poll(() => wizard.getByTestId("fulfillment-step-body").evaluate(body => body.scrollTop)).toBe(0);
      assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false);
    };
    const waitForWizard = async () => {
      await expect(wizard).toBeVisible();
      // Footers render before the hydrated view is known. Wait for actual
      // loaded step content so a reload cannot select a transient Back button.
      await expect(wizard.locator('[data-testid="fulfillment-start-screen"], [data-testid="fulfillment-resume-list"], [data-testid="fulfillment-reassignment-review"], [data-wizard-history], [data-wizard-blocked], #fulfillment-search, [data-wizard-setup], [data-wizard-review], [data-testid="fulfillment-batch-identity"], [data-wizard-complete]').first()).toBeVisible();
    };
    const openWizardPage = async () => {
      const tasks = page.getByRole("heading", { name: "Choose an inventory task", exact: true });
      const start = page.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true });
      // Reload may restore the open page directly. Wait for workspace hydration
      // before deciding whether a launcher click is needed.
      await expect(wizard.or(tasks).or(start)).toBeVisible();
      if (!await wizard.isVisible()) {
        if (!await tasks.isVisible()) await start.click();
        await expect(tasks).toBeVisible();
        await page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
      }
      await waitForWizard();
      // Compact navigation is a normal workspace control, not an auth/layout
      // bypass. The provider currently opens expanded again after a reload.
      const expandedSidebar = page.locator('[data-slot="sidebar"][data-state="expanded"]');
      if (await expandedSidebar.isVisible())
        await page.getByRole("button", { name: "Toggle Sidebar", exact: true }).click();
    };
    const openFulfillmentChoices = async () => {
      await openWizardPage();
      // The page restores its last view, including a saved in-flight command.
      if (!await wizard.getByTestId("fulfillment-start-screen").isVisible()) {
        await wizard.getByRole("button", { name: /^Back to workflow/ }).first().click();
      }
      await expect(wizard.getByTestId("fulfillment-start-screen")).toBeVisible();
      await expectStepAtTop();
      return wizard.getByTestId("fulfillment-start-screen");
    };
    const launch = async (mode = "resume") => {
      await openWizardPage();
      if (mode === "resume" && !await wizard.getByTestId("fulfillment-start-screen").isVisible() &&
          !await wizard.getByTestId("fulfillment-resume-list").isVisible()) {
        await expectStepAtTop();
        return;
      }
      const home = await openFulfillmentChoices();
      await home.getByRole("button", { name: mode === "crew" ? /^New crew batch/ : /^Resume saved batch/ }).click();
      if (mode === "resume") {
        await expect(wizard.getByTestId("fulfillment-resume-list")).toBeVisible();
        const saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"),
          `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`);
        const operation = saved?.pending?.operationId ?? saved?.createAttempt?.operationId;
        const row = wizard.getByTestId("fulfillment-resume-list").locator(":scope > div")
          .filter({ hasText: operation ?? "Owned crew pull" });
        await row.getByRole("button", { name: operation ? "Resume saved batch" : "Resume batch", exact: true }).click();
      }
      await expectStepAtTop();
    };
    // Keep all workflow locators scoped to the page; actual filter/warning
    // dialogs below still use their own dialog roles.
    const dialog = wizard;
    await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
    let choices = await openFulfillmentChoices();
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await expect(choices.getByRole("button", { name: /^New crew batch/ })).toBeVisible();
      await expect.poll(async () => {
        const rect = await wizard.boundingBox();
        return !!rect && rect.x >= -1 && rect.y >= -1 &&
          rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
      }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/start-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await choices.getByRole("button", { name: /^New crew batch/ }).click();
    await expect(dialog.getByRole("button", { name: "Next: Batch setup", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save Draft", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    choices = await openFulfillmentChoices();
    await choices.getByRole("button", { name: /^Resume saved batch/ }).click();
    await expect(dialog.getByRole("button", { name: "Resume saved batch", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Back to workflow choices", exact: true }).click();
    await choices.getByRole("button", { name: /Scheduled installer work/ }).click();
    await expect(dialog.getByRole("button", { name: "Next: Batch setup", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Save Draft", exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    choices = await openFulfillmentChoices();
    const savedKey = `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`;
    assert.equal(await page.evaluate(key => localStorage.getItem(key), savedKey), null);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(`${key}:shared-outbox`) ?? "[]"), savedKey), []);
    assert.deepEqual((await request("GET", `${inventory}/fulfillment-drafts`)).drafts, [],
      "Opening and closing blank setup screens must not create shared drafts.");
    await choices.getByRole("button", { name: /New crew batch/ }).click();
    await expect(page.getByRole("alertdialog", { name: "Replace saved workflow inputs?" })).toHaveCount(0);
    await expect(dialog.getByLabel("Search orders", { exact: true })).toBeVisible();
    const expectSectionAtTop = async title => {
      const heading = dialog.getByRole("heading", { name: title, exact: true });
      await expect(heading).toBeVisible();
      await expect.poll(async () => heading.evaluate(element => {
        const body = element.closest('[data-testid="fulfillment-step-body"]');
        return !!body && body.scrollTop <= 1 &&
          element.getBoundingClientRect().top >= body.getBoundingClientRect().top - 1;
      }), { message: `${title} should not be clipped by focus scrolling` }).toBe(true);
      await expectStepAtTop();
    };
    const changeMode = async name => {
      await dialog.getByTestId("fulfillment-back-to-workflows").click();
      await choices.getByRole("button", { name }).click();
    };
    await expectSectionAtTop("Choose eligible orders");
    await changeMode(/^Scheduled installer work/);
    await expectSectionAtTop("Choose eligible orders");
    await changeMode(/^Resume saved batch/);
    await expectSectionAtTop("Resume saved batch");
    await dialog.getByRole("button", { name: "Back to workflow choices", exact: true }).click();
    await choices.getByRole("button", { name: /^New crew batch/ }).click();
    await expectSectionAtTop("Choose eligible orders");
    await page.setViewportSize({ width: 1024, height: 544 });
    await changeMode(/^Scheduled installer work/);
    await expectSectionAtTop("Choose eligible orders");
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/focus-short-desktop.png" });
    await changeMode(/^New crew batch/);
    await expectSectionAtTop("Choose eligible orders");
    await page.setViewportSize({ width: 390, height: 844 });
    await changeMode(/^Resume saved batch/);
    await expectSectionAtTop("Resume saved batch");
    await dialog.getByRole("button", { name: "Back to workflow choices", exact: true }).click();
    await choices.getByRole("button", { name: /^New crew batch/ }).click();
    await expectSectionAtTop("Choose eligible orders");
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/focus-phone.png" });
    await page.setViewportSize({ width: 1280, height: 900 });
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
      await expect(page.getByRole("listbox")).toHaveCount(0);
    };
    await expect(selectAll).toBeDisabled(); // Several crews; never pick the first crew implicitly.
    await setFilter("Work group", group.name);
    const orderList = dialog.getByTestId("fulfillment-work-orders-list");
    await orderList.locator("summary").click();
    // The page lists eligible orders only; unavailable matches still explain
    // covered demand rather than being confused with an empty search.
    await expect(rowCheckbox("BULK-UNAVAILABLE")).toHaveCount(0);
    await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0);
    await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-CREW");
    await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
    await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0);
    await expect(rowCheckbox("FUL-CREW-2")).toHaveCount(0);
    await expect(selectAll).toBeDisabled();
    await dialog.getByLabel("Search orders", { exact: true }).fill("NO-SUCH-WORK-ORDER");
    await expect(dialog.getByText("No matching work orders", { exact: true })).toBeVisible();
    await expect(dialog.getByTestId("fulfillment-no-eligible")).toHaveCount(0);
    await dialog.getByLabel("Search orders", { exact: true }).clear();
    await expect(rowCheckbox("BULK-UNAVAILABLE")).toHaveCount(0);
    await selectAll.check();
    await expect(dialog.getByTestId("fulfillment-selection-summary")).toContainText("Selected 2 / Eligible matching 2");
    await expect(rowCheckbox("BULK-CREW-A")).toBeChecked();
    await expect(rowCheckbox("BULK-CREW-B")).toBeChecked();
    await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0); // Covered by an existing batch.
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
    await expect(rowCheckbox("BULK-CREW-A")).toBeChecked();
    await setFilter("Work group", otherGroup.name);
    await expect(selectAll).toBeDisabled(); // Hidden selection belongs to another crew.
    await clearSelection.click();
    await expect(selectAll).toBeEnabled();
    await selectAll.check();
    await expect(rowCheckbox("BULK-CREW-OTHER")).toBeChecked();
    await clearSelection.click();
    await changeMode(/^Scheduled installer work/);
    await orderList.locator("summary").click();
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
    for (const viewport of viewports) {
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
    console.log("PASS chooser, blank setup, bulk selection and responsive selection controls.");
    await changeMode(/^Resume saved batch/);
    await dialog.getByRole("button", { name: "Resume batch", exact: true }).click();
    await expectStepAtTop();
    const printPopup = page.waitForEvent("popup");
    await dialog.getByRole("button", { name: "Print pick ticket", exact: true }).click();
    const pickTicket = await printPopup;
    await expect(pickTicket.getByRole("heading", { name: /Pick ticket · PICK-/ })).toBeVisible();
    await expect(pickTicket.getByRole("button", { name: "Print / Save PDF", exact: true })).toBeVisible();
    await pickTicket.screenshot({ path: "generated-artifacts/inventory-fulfillment/pick-ticket.png" });
    await pickTicket.close();
    const enterCapture = async phase => {
      await dialog.getByRole("button", { name: phase === "stage" ? "Picking complete — enter quantities" : "Next: Capture handoff", exact: true }).click();
      await expectStepAtTop();
      await expect(dialog.getByRole("button", { name: "Next: Confirm", exact: true })).toBeDisabled();
    };
    const confirmCapture = async reason => {
      await dialog.getByRole("button", { name: "Next: Confirm", exact: true }).click();
      await expectStepAtTop();
      await expect(dialog.getByRole("button", { name: "Next: Review movement", exact: true })).toBeDisabled();
      await dialog.getByLabel("Physical move reason", { exact: true }).fill(reason);
      await physicalConfirmation.check();
      await dialog.getByRole("button", { name: "Next: Review movement", exact: true }).click();
      await expectStepAtTop();
    };
    await enterCapture("stage");
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveAttribute("data-wizard-focus-target", "true");
    const checkDuplicateScans = async (phase) => {
      const input = dialog.getByTestId(`fulfillment-custody-serials-${phase}-fulfill-meter`);
      const quantity = dialog.getByTestId(`fulfillment-move-quantity-${phase}-fulfill-meter`);
      const progress = dialog.getByTestId(`fulfillment-scan-progress-${phase}-fulfill-meter`);
      await quantity.fill("2");
      await expect(quantity).toHaveAttribute("max", "2");
      await quantity.pressSequentially("333");
      await expect(quantity).toHaveValue("2");
      await quantity.fill("3333");
      await expect(quantity).toHaveValue("2");
      await quantity.press("ArrowUp");
      await expect(quantity).toHaveValue("2");
      await quantity.fill("2.5");
      await expect(quantity).toHaveValue("2");
      await quantity.fill("-1");
      await expect(quantity).toHaveValue("2");
      await quantity.fill("");
      await expect(quantity).toHaveValue("");
      await quantity.fill("1");
      await quantity.press("ArrowUp");
      await expect(quantity).toHaveValue("2");
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
      await expect(progress.getByRole("status")).toContainText("Scanning complete — serials verified against current stock.");
      await input.pressSequentially("F-B");
      await input.press("Tab");
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(dialog.getByText("Required scan count reached. Extra serials were not added.", { exact: true })).toBeVisible();
      await quantity.fill("1");
      await expect(input).toHaveValue("F-A\nF-B\n");
      await expect(progress).toContainText("1 extra");
      await expect(progress.getByRole("status")).toContainText("Keep these captures");
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
    await expect(dialog.getByRole("button", { name: "Next: Confirm", exact: true })).toBeDisabled();
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-A\nF-B");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").press("Enter");
    await confirmCapture("Physically pulled and scanned at the warehouse");
    await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await expect(dialog.getByRole("button", { name: "Record physical pull", exact: true })).toBeVisible();
      await expect.poll(async () => {
        const rect = await dialog.boundingBox();
        return !!rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
      }, { message: "The workflow page, including header and footer, must stay inside the viewport." }).toBe(true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Partial pulls keep their own form. Navigation must not post or silently discard another pull.
    await dialog.getByRole("button", { name: "Back to confirm", exact: true }).click();
    await dialog.getByRole("button", { name: "Back to capture", exact: true }).click();
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-A");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").press("Enter");
    await dialog.getByRole("button", { name: "Next: Confirm", exact: true }).click();
    await expect(physicalConfirmation).toBeChecked();
    await dialog.getByRole("button", { name: "Next: Review movement", exact: true }).click();
    await dialog.getByRole("button", { name: "Record physical pull", exact: true }).click();
    await expect.poll(async () => (await batch()).lines.reduce((sum, line) => sum + line.stagedQuantity, 0)).toBe(1);
    const partialHandoff = dialog.getByRole("button", { name: "Partial pickup from Staging", exact: true });
    await expect(partialHandoff).toBeVisible();
    assert.equal((await pickups()).length, 0, "A partial pull is not automatically advertised as ready.");
    await partialHandoff.click();
    const beforeReady = (await request("GET", inventory)).state;
    await dialog.getByRole("button", { name: "Make staged stock ready for partial pickup", exact: true }).click();
    await expect.poll(async () => (await pickups())[0]?.status).toBe("partial");
    const afterReady = (await request("GET", inventory)).state;
    assert.deepEqual(afterReady.stock, beforeReady.stock, "Marking readiness never moves stock.");
    await expect(techPage.getByTestId("section-ready-pickups")).toContainText("Owned crew pull");
    await techPage.getByTestId("section-ready-pickups").getByRole("button", { name: "View notice", exact: true }).click();
    await expect(techPage.getByTestId("section-ready-pickups")).toContainText("F-A");
    await expect.poll(async () => (await pickups())[0]?.unread).toBe(false);
    assert.deepEqual((await request("GET", inventory)).state.stock, afterReady.stock, "Viewing a pickup never transfers custody.");
    // Return through the page's workflow choices to stage the remaining unit.
    await dialog.getByTestId("fulfillment-back-to-workflows").click();
    await choices.getByRole("button", { name: /^Resume saved batch/ }).click();
    await dialog.getByRole("button", { name: "Resume batch", exact: true }).click();
    await enterCapture("stage");
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("");
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-B");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").press("Enter");
    await confirmCapture("Second physical pull not recorded yet");
    await dialog.getByRole("button", { name: "Back to confirm", exact: true }).click();
    await dialog.getByRole("button", { name: "Back to capture", exact: true }).click();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    let navigationPosts = 0;
    const countNavigationPosts = req => {
      if (req.method() === "POST" && req.url().endsWith(`${inventory}/commands`)) navigationPosts++;
    };
    page.on("request", countNavigationPosts);
    await partialHandoff.click();
    const warning = page.getByRole("alertdialog");
    await expect(warning.getByText("Unrecorded movement entries", { exact: true })).toBeVisible();
    await warning.getByRole("button", { name: "Stay and review", exact: true }).click();
    await dialog.getByRole("button", { name: "Picking complete — enter quantities", exact: true }).click();
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("1");
    await expect(dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter")).toHaveValue("F-B\n");
    await dialog.getByRole("button", { name: "Next: Confirm", exact: true }).click();
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveValue("Second physical pull not recorded yet");
    await expect(physicalConfirmation).toBeChecked();
    await dialog.getByRole("button", { name: "Back to capture", exact: true }).click();
    await dialog.getByRole("button", { name: "Back", exact: true }).click();
    await partialHandoff.click();
    await warning.getByRole("button", { name: "Discard entries and continue", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Next: Capture handoff", exact: true })).toBeVisible();
    assert.equal(navigationPosts, 0, "Changing steps must not move stock.");
    page.off("request", countNavigationPosts);
    await dialog.getByTestId("fulfillment-back-to-workflows").click();
    await choices.getByRole("button", { name: /^Resume saved batch/ }).click();
    await dialog.getByRole("button", { name: "Resume batch", exact: true }).click();
    await enterCapture("stage");
    await expect(dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter")).toHaveValue("");
    await dialog.getByTestId("fulfillment-move-quantity-stage-fulfill-meter").fill("1");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").fill("F-B");
    await dialog.getByTestId("fulfillment-custody-serials-stage-fulfill-meter").press("Enter");
    await confirmCapture("Second physical pull confirmed at the warehouse");
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
    assert.deepEqual(await page.evaluate(key => {
      const saved = JSON.parse(localStorage.getItem(key));
      return { quantities: saved.quantities, serialText: saved.serialText };
    }, savedKey), { quantities: {}, serialText: {} });
    // A receipt may reconcile through live events even before reload. Resume
    // the shared record to select its server-verified next step rather than
    // assuming the older modal's automatic staging-complete screen.
    await openFulfillmentChoices();
    await choices.getByRole("button", { name: /^Resume saved batch/ }).click();
    await dialog.getByRole("button", { name: "Resume batch", exact: true }).click();
    await expectStepAtTop();
    await expect(dialog.getByRole("button", { name: "Next: Capture handoff", exact: true })).toBeVisible();
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Record physical pull", exact: true })).toHaveCount(0);
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      const next = dialog.getByRole("button", { name: "Next: Capture handoff", exact: true });
      await expect(next).toBeEnabled();
      await expect.poll(async () => {
        const rect = await dialog.boundingBox();
        return !!rect && rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= viewport.width + 1 && rect.y + rect.height <= viewport.height + 1;
      }, { message: "Wait for the resized workflow page to fit the viewport." }).toBe(true);
      await expect.poll(async () => {
        const rect = await next.boundingBox();
        return !!rect && rect.x >= 0 && rect.x + rect.width <= viewport.width && rect.y >= 0 && rect.y + rect.height <= viewport.height;
      }, { message: "Completed staging's primary action stays visible." }).toBe(true);
      await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/staged-${viewport.width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    let state = (await request("GET", inventory)).state;
    assert.equal(state.receipts.filter(receipt => receipt.reference === batchId && receipt.action === "fulfillmentMove").length, 2);
    console.log("PASS staged scanning, partial pickup readiness and lost-response recovery.");
    assert.equal(state.allocations.some(a => crewWork.some(w => w.id === a.workOrderId)), false);
    const current = await batch();
    await expect.poll(async () => (await pickups())[0]?.status).toBe("ready");
    assert.deepEqual((await pickups())[0].items[0].serials.sort(), ["F-A", "F-B"]);
    const vehicle = { id: "fulfill-vehicle", code: "FUL-VAN", name: "Crew vehicle", type: "vehicle",
      vin: "1HGCM82633A004352", plate: "TEST", plateState: "CO" };
    await command("warehouse", { ...vehicle, userIds: [user.id] }, admin);
    await expect.poll(async () => (await pickups()).length).toBe(0);
    await expect(techPage.getByTestId("section-ready-pickups")).not.toContainText("Owned crew pull");
    await command("warehouse", { ...vehicle, userIds: [user.id, technician.id] }, admin);
    await expect(techPage.getByTestId("section-ready-pickups")).toContainText("Owned crew pull");
    await techPage.goto(`${baseURL}/projects/${fixture.projectId}/work-orders?pickup=${batchId}&preserve=yes`);
    await expect(techPage.getByText("Pickup detail", { exact: true })).toBeVisible();
    await expect.poll(() => new URL(techPage.url()).searchParams.has("pickup")).toBe(false);
    assert.equal(new URL(techPage.url()).searchParams.get("preserve"), "yes");
    await techPage.screenshot({ path: "generated-artifacts/inventory-fulfillment/pickup-detail-desktop.png" });
    await techPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await techPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await techPage.screenshot({ path: "generated-artifacts/inventory-fulfillment/pickup-detail-phone.png" });
    await techPage.setViewportSize({ width: 1280, height: 720 });
    let handoffId = crypto.randomUUID();
    const handoff = { id: batchId, revision: current.revision, phase: "vehicle",
      lines: [{ itemId: "fulfill-meter", quantity: 2, serials: ["F-B", "F-A"] }],
      reason: "Physically counted and handed to the crew vehicle", physicallyConfirmed: true };
    await page.setViewportSize({ width: 390, height: 844 });
    const stepBody = dialog.getByTestId("fulfillment-step-body");
    await stepBody.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await enterCapture("vehicle");
    const handoffQuantity = dialog.getByTestId("fulfillment-move-quantity-vehicle-fulfill-meter");
    const handoffSerials = dialog.getByTestId("fulfillment-custody-serials-vehicle-fulfill-meter");
    await expectStepAtTop();
    await expect(handoffQuantity).toHaveAttribute("data-wizard-focus-target", "true");
    // Required fields are highlighted without autofocus; operators scroll to
    // the capture rather than having navigation move the page to an input.
    await handoffQuantity.scrollIntoViewIfNeeded();
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
    // Current stock verification rejects unavailable scans asynchronously.
    // Hold that read (not a stock command) while checking that neither visual
    // acceptance nor a checkbox can overwrite an invalid, unverified capture.
    const checkPattern = `**${inventory}/fulfillment/${batchId}/check-serials`;
    let releaseSerialCheck;
    const serialCheckGate = new Promise(resolve => { releaseSerialCheck = resolve; });
    await page.route(checkPattern, async route => {
      if (route.request().postDataJSON().lines.some(line => line.serials.includes("F-UNKNOWN")))
        await serialCheckGate;
      await route.continue();
    });
    try {
      await handoffSerials.fill("F-UNKNOWN");
      await acceptSerials.click();
      await expect(dialog.getByText(/scan box contains a serial that is not available/)).toBeVisible();
      await expect(handoffSerials).toHaveValue("F-UNKNOWN");
      await expect(handoffQuantity).toHaveValue("1");
      await chooseSerial("F-A").click();
      await expect(handoffSerials).toHaveValue("F-UNKNOWN");
      await expect(chooseSerial("F-A")).not.toBeChecked();
      await expect(dialog.getByRole("button", { name: "Next: Confirm", exact: true })).toBeDisabled();
    } finally {
      releaseSerialCheck();
      await page.unroute(checkPattern);
    }
    await expect(handoffSerials).toHaveValue("");
    await expect(dialog.getByText(/Rejected F-UNKNOWN:/)).toBeVisible();
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
    await expect(dialog.getByLabel("Physical move reason", { exact: true })).toHaveCount(0);
    assert.equal(preparationPosts, 0, "Serial selection, searches and visual acceptance never post stock movements.");
    page.off("request", countPreparationPosts);
    assert.equal((await batch()).lines.reduce((sum, line) => sum + line.deliveredQuantity, 0), 0, "Visual acceptance alone does not post a handoff.");
    for (const viewport of viewports) {
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
    if (!await handoffSerials.isVisible())
      await dialog.getByRole("button", { name: "Next: Capture handoff", exact: true }).click();
    await expectStepAtTop();
    await expect(handoffSerials).toHaveValue("F-B");
    await expect(handoffQuantity).toHaveValue("1");
    await picker.locator("summary").click();
    await expect(chooseSerial("F-B")).toBeChecked();
    await expect(chooseSerial("F-A")).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "Record vehicle handoff", exact: true })).toHaveCount(0);
    await expect(dialog.getByRole("button", { name: "Next: Confirm", exact: true })).toBeEnabled();
    // Revoked fulfillment access hides that task while preserving every saved
    // capture. Other independently authorized inventory tasks remain available.
    const beforeRevocation = await page.evaluate(key => localStorage.getItem(key),
      `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: permissions.filter(p => p !== "inventory.transfer") }, admin);
    await page.reload();
    const taskChooser = page.getByRole("heading", { name: "Choose an inventory task", exact: true });
    const remainingStart = page.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true });
    await expect(taskChooser.or(remainingStart)).toBeVisible();
    if (!await taskChooser.isVisible()) await remainingStart.click();
    await expect(taskChooser).toBeVisible();
    await expect(page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ })).toHaveCount(0);
    await expect(wizard).toHaveCount(0);
    await rejected("fulfillmentMove", handoff, 403);
    assert.equal(await page.evaluate(key => localStorage.getItem(key),
      `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`), beforeRevocation);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions }, admin);
    await page.reload();
    await launch();
    await expect(handoffSerials).toHaveValue("F-B");
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
    await confirmCapture(handoff.reason);
    await dialog.getByRole("button", { name: "Record vehicle handoff", exact: true }).click();
    await expect(dialog.getByText("Movement outcome needs confirmation", { exact: true })).toBeVisible();
    assert.deepEqual(unknownHandoff.data.lines, [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-B"] }]);
    await expect(dialog.getByRole("button", { name: "Back to confirm", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("button", { name: "Record vehicle handoff", exact: true })).toBeDisabled();
    await page.reload();
    await launch();
    await expect(dialog.getByRole("button", { name: "Back to confirm", exact: true })).toBeDisabled();
    await expect(dialog.locator("[data-wizard-movement-review]")).toContainText("F-B");
    await page.unroute(`**${inventory}/commands`);
    const retry = page.waitForRequest(req => req.url().endsWith(`${inventory}/commands`) && req.method() === "POST" && req.postDataJSON().data.phase === "vehicle");
    await dialog.getByRole("button", { name: "Check receipt / retry same command", exact: true }).click();
    assert.deepEqual((await retry).postDataJSON(), unknownHandoff);
    await expect.poll(async () => (await batch()).lines.reduce((sum, line) => sum + line.deliveredQuantity, 0)).toBe(1);
    await enterCapture("vehicle");
    await picker.locator("summary").click();
    await expect(chooseSerial("F-B")).toHaveCount(0);
    await expect(chooseSerial("F-A")).toBeEnabled();
    await expect(acceptSerials).toHaveText("Accept displayed serials (1)");
    await chooseSerial("F-A").check();
    await expect(handoffSerials).toHaveValue("F-A");
    await expect(handoffQuantity).toHaveValue("1");
    await confirmCapture(handoff.reason);
    const posted = page.waitForRequest(req => req.url().endsWith(`${inventory}/commands`) && req.method() === "POST" && req.postDataJSON().data.phase === "vehicle");
    // A second device using the same account must refresh through SSE, not the ten-second safety poll.
    const mirror = await browser.newContext({ baseURL });
    await request("POST", "/api/auth/local/login", credentials, mirror);
    const mirrorDraft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), savedKey);
    Object.assign(mirrorDraft, { step: "vehicle", uiSubstep: "verify", batchId, pending: null, createAttempt: null,
      quantities: {}, serialText: {}, reason: "", physicallyConfirmed: false, closeReason: "" });
    await mirror.addInitScript(({ key, draft }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(draft));
      const interval = window.setInterval.bind(window);
      window.setInterval = (handler, timeout, ...args) => interval(handler, timeout === 10_000 ? 600_000 : timeout, ...args);
    }, { key: savedKey, draft: mirrorDraft });
    const mirrorPage = await mirror.newPage();
    let mirrorPosts = 0;
    mirrorPage.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith(`${inventory}/commands`)) mirrorPosts++;
    });
    await mirrorPage.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    const openMirror = async () => {
      const tasks = mirrorPage.getByRole("heading", { name: "Choose an inventory task", exact: true });
      const start = mirrorPage.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true });
      await expect(tasks.or(start)).toBeVisible();
      if (!await tasks.isVisible()) await start.click();
      await mirrorPage.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
      await expect(mirrorPage.getByTestId("fulfillment-start-screen")).toBeVisible();
    };
    await openMirror();
    await mirrorPage.getByRole("button", { name: /^Resume saved batch/ }).click();
    await expect(mirrorPage.getByRole("button", { name: "Resume batch", exact: true })).toBeVisible();
    await mirrorPage.getByRole("button", { name: "Back to workflow choices", exact: true }).click();
    await dialog.getByRole("button", { name: "Record vehicle handoff", exact: true }).click();
    const actualHandoff = (await posted).postDataJSON();
    assert.deepEqual(actualHandoff.data.lines, [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-A"] }]);
    handoffId = actualHandoff.operationId;
    await expect(dialog.getByText("Vehicle handoff complete", { exact: true })).toBeVisible();
    await expect.poll(async () => (await pickups()).some(pickup => pickup.batchId === batchId)).toBe(false);
    await expect(techPage.getByText("Pickup detail", { exact: true })).toHaveCount(0);
    await expectStepAtTop();
    await expect(dialog.locator("[data-wizard-complete]")).toHaveAttribute("data-wizard-focus-target", "true");
    await expect(mirrorPage.getByText(/The saved work is already completed/)).toBeVisible();
    await expect.poll(async () => mirrorPage.evaluate(key => localStorage.getItem(key), savedKey)).toBeNull();
    await mirrorPage.screenshot({ path: "generated-artifacts/inventory-fulfillment/remote-completion-home.png" });
    // Reopening must reconcile old local storage against a fresh server snapshot as well.
    await mirrorPage.getByRole("button", { name: "Close", exact: true }).first().click();
    await mirrorPage.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)), { key: savedKey, draft: mirrorDraft });
    await openMirror();
    await expect(mirrorPage.getByText(/The saved work is already completed/)).toBeVisible();
    await mirrorPage.getByRole("button", { name: /^Resume saved batch/ }).click();
    await expect(mirrorPage.getByRole("button", { name: "Resume batch", exact: true })).toHaveCount(0);
    // A terminal batch is not proof that an unrelated saved attempt was posted.
    await mirrorPage.getByRole("button", { name: "Close", exact: true }).first().click();
    const protectedAttempt = { operationId: crypto.randomUUID(), action: "fulfillmentMove", data: handoff };
    await mirrorPage.evaluate(({ key, draft }) => localStorage.setItem(key, JSON.stringify(draft)),
      { key: savedKey, draft: { ...mirrorDraft, pending: protectedAttempt } });
    await openMirror();
    await mirrorPage.getByRole("button", { name: /^Resume saved batch/ }).click();
    await expect(mirrorPage.getByRole("button", { name: "Resume saved batch", exact: true })).toBeVisible();
    assert.deepEqual(await mirrorPage.evaluate(key => JSON.parse(localStorage.getItem(key)).pending, savedKey), protectedAttempt);
    // Captured but never submitted scans remain accessible as review-only evidence, not another handoff.
    await mirror.close();
    // Model a separate device with retained, never-submitted inputs. Give it
    // its own real login and browser history so existing tabs cannot overwrite
    // this recovery fixture through shared local storage or view restoration.
    const reviewContext = await browser.newContext({ baseURL });
    await request("POST", "/api/auth/local/login", credentials, reviewContext);
    await reviewContext.addInitScript(({ key, draft }) => {
      localStorage.setItem(key, JSON.stringify(draft));
      localStorage.setItem(key.replace("fulfillment:", "fulfillment-view:"), JSON.stringify({
        showStart: false, showResumeList: false, showHistory: false, showBlocked: false,
        showCorrections: false, reassignmentBatchId: "",
      }));
    }, { key: savedKey, draft: { ...mirrorDraft, quantities: { "vehicle:fulfill-meter": "1" },
      serialText: { "vehicle:fulfill-meter": "F-A" } } });
    const reviewPage = await reviewContext.newPage();
    reviewPage.on("request", req => {
      if (req.method() === "POST" && req.url().endsWith(`${inventory}/commands`)) mirrorPosts++;
    });
    await reviewPage.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    const reviewWizard = reviewPage.getByTestId("inventory-fulfillment-page");
    const reviewTasks = reviewPage.getByRole("heading", { name: "Choose an inventory task", exact: true });
    const reviewStart = reviewPage.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true });
    await expect(reviewWizard.or(reviewTasks).or(reviewStart)).toBeVisible();
    if (!await reviewWizard.isVisible()) {
      if (!await reviewTasks.isVisible()) await reviewStart.click();
      await reviewPage.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
    }
    await expect(reviewPage.getByTestId("fulfillment-retained-inputs")).toContainText("F-A");
    await expect(reviewPage.getByRole("button", { name: "Record vehicle handoff", exact: true })).toHaveCount(0);
    assert.equal(mirrorPosts, 0, "Cross-device reconciliation and review must never post a stock command.");
    await reviewContext.close();
    console.log("PASS partial handoff, permission revocation, exact retry and same-user live completion.");
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
    await expect(dialog.getByRole("button", { name: "View completed batches", exact: true })).toBeVisible();
    // Enter history through the current task chooser after leaving the
    // completed custody page, rather than reusing its former modal tabs.
    await dialog.getByRole("button", { name: "Save & leave", exact: true }).click();
    await page.goto(`${baseURL}/projects/${fixture.projectId}/inventory`);
    await openFulfillmentChoices();
    await choices.getByRole("button", { name: /^Completed batches/ }).click();
    const history = dialog.getByTestId("fulfillment-batch-history");
    await expect(history.getByRole("heading", { name: "Completed batches", exact: true })).toBeVisible();
    await expect(combinedButton).toHaveCount(1);
    await expect(dialog.getByRole("button", { name: "Receipt", exact: true })).toHaveCount(0);
    const savedPrintEvent = prep.waitForEvent("page");
    await combinedButton.click();
    const savedPrint = await savedPrintEvent;
    await expect(savedPrint.getByRole("heading", { name: "Combined fulfillment receipt", exact: true })).toBeVisible();
    await savedPrint.close();
    const historySearch = history.getByPlaceholder("Batch, work order, item, location or serial");
    if (!await historySearch.isVisible()) await history.getByRole("button", { name: /Show Search & Tools/i }).click();
    await historySearch.fill("NO-MATCHING-FULFILLMENT-BATCH");
    await expect(history.getByText("No matching completed batches", { exact: true })).toBeVisible();
    await expect(history.getByRole("button", { name: "CSV", exact: true })).toBeDisabled();
    await historySearch.fill("F-A");
    await expect(history.locator("[data-operations-row]")).toHaveCount(1);
    const csvDownload = prep.waitForEvent("download");
    await history.getByRole("button", { name: "CSV", exact: true }).click();
    const csv = await csvDownload;
    assert.ok(csv.suggestedFilename().endsWith(".csv"));
    await history.getByRole("button", { name: "Filter completed batches", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filter completed batches" });
    await expect(filters.getByText("Work type", { exact: true })).toBeVisible();
    await filters.getByRole("button", { name: /Show .*completed batches/i }).click();
    await historySearch.fill("");
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/completed-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await openFulfillmentChoices();
    const homeOnPhone = page.getByTestId("fulfillment-start-screen");
    await expect(homeOnPhone).toBeVisible();
    await homeOnPhone.getByRole("button", { name: /^Completed batches/ }).click();
    await expect(history.getByRole("heading", { name: "Completed batches", exact: true })).toBeVisible();
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/completed-phone.png" });
    await page.setViewportSize({ width: 1280, height: 900 });
    await dialog.getByRole("button", { name: "Back to workflows", exact: true }).click();
    await dialog.getByRole("button", { name: /^Resume saved batch/ }).click();
    await expect(dialog.getByRole("button", { name: "Resume batch", exact: true })).toHaveCount(0);
    await expect(dialog.getByText("No saved setup drafts or resumable batches.", { exact: false })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Print combined receipt", exact: true })).toHaveCount(0);
    assert.equal((await prep.request.get(`${inventory}/print/fulfillment/${crypto.randomUUID()}`)).status(), 404);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: permissions.filter(permission => permission !== "workOrders.view") }, admin);
    assert.equal((await prep.request.get(`${inventory}/print/fulfillment/${batchId}`)).status(), 403);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions }, admin);
    await page.reload();
    await openFulfillmentChoices();
    await choices.getByRole("button", { name: /^Scheduled installer work/ }).click();
    await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-SCHEDULED");
    await orderList.locator("summary").click();
    await dialog.locator("label").filter({ hasText: "FUL-SCHEDULED" }).getByRole("checkbox").check();
    await dialog.getByRole("button", { name: "Next: Batch setup", exact: true }).click();
    await expectStepAtTop();
    await dialog.getByLabel("Batch name", { exact: true }).fill("Owned scheduled pull");
    for (const [label, option] of [["Warehouse source", "Fulfillment warehouse"], ["Staging destination", "Crew staging shelf"], ["Vehicle", "Crew vehicle"]]) {
      await dialog.getByLabel(label, { exact: true }).click();
      await page.getByRole("option", { name: new RegExp(option) }).click();
      await expect(page.getByRole("listbox")).toHaveCount(0);
    }
    // Setup drafts now live in the shared Resume saved batch list, not a
    // private "continue workflow" action on the chooser.
    await dialog.getByRole("button", { name: "Save Draft", exact: true }).click();
    await expect(dialog.getByTestId("fulfillment-resume-list")).toBeVisible();
    const scheduledDraft = (await request("GET", `${inventory}/fulfillment-drafts`)).drafts
      .find(draft => draft.name === "Owned scheduled pull");
    assert.ok(scheduledDraft);
    assert.deepEqual(scheduledDraft.capture.selectedIds, [scheduled.id]);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    await openFulfillmentChoices();
    await choices.getByRole("button", { name: /^Resume saved batch/ }).click();
    const savedSetup = dialog.getByTestId("fulfillment-resume-list").locator(":scope > div")
      .filter({ hasText: "Owned scheduled pull" })
      .filter({ has: page.getByRole("button", { name: "Delete draft", exact: true }) });
    await savedSetup.getByRole("button", { name: "Resume saved batch", exact: true }).click();
    await expectStepAtTop();
    await expect(dialog.getByLabel("Batch name", { exact: true })).toHaveValue("Owned scheduled pull");
    await expect(dialog.getByLabel("Warehouse source", { exact: true })).toContainText("Fulfillment warehouse");
    await expect(dialog.getByLabel("Staging destination", { exact: true })).toContainText("Crew staging shelf");
    await expect(dialog.getByLabel("Vehicle", { exact: true })).toContainText("Crew vehicle");
    await dialog.getByRole("button", { name: "Next: Review batch", exact: true }).click();
    await expectStepAtTop();
    await expect(dialog.locator("[data-wizard-review]")).toHaveAttribute("data-wizard-focus-target", "true");
    await dialog.getByRole("button", { name: "Create batch", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Picking complete — enter quantities", exact: true })).toBeVisible();
    discovery = await request("GET", `${inventory}/fulfillment`);
    const scheduledId = discovery.batches.find(batch => batch.name === "Owned scheduled pull").id;
    const stageId = crypto.randomUUID();
    await command("fulfillmentMove", { id: scheduledId, revision: 1, phase: "stage",
      lines: [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-C"] }],
      reason: "Scheduled installer equipment physically staged", physicallyConfirmed: true }, prep, stageId);
    assert.ok((await pickups()).some(pickup => pickup.batchId === scheduledId));
    state = (await request("GET", inventory)).state;
    assert.deepEqual(state.allocations.find(a => a.workOrderId === scheduled.id).lines[0].serials, []);
    await request("PATCH", `${root}/work-orders/${scheduled.id}`, { assignedUserId: otherInstaller.id }, admin);
    assert.equal((await pickups()).some(pickup => pickup.batchId === scheduledId), false);
    const reviewUrl = `${inventory}/fulfillment/${scheduledId}/reassignment`;
    let reassignment = await request("GET", reviewUrl);
    assert.equal(reassignment.canApply, false);
    assert.ok(reassignment.blockers.some(reason => /No accessible active vehicle/.test(reason)));
    assert.equal(reassignment.orders[0].previousInstaller, user.username);
    assert.equal(reassignment.orders[0].currentInstaller, otherInstaller.username);
    assert.deepEqual(reassignment.items[0].serials, ["F-C"]);
    await command("warehouse", { id: "fulfill-new-vehicle", code: "FUL-NEW", name: "Reassigned installer vehicle",
      type: "vehicle", vin: "1HGCM82633A004353", plate: "NEW", plateState: "CO",
      userIds: [user.id, otherInstaller.id] }, admin);
    reassignment = await request("GET", reviewUrl);
    assert.equal(reassignment.canApply, true, JSON.stringify(reassignment.blockers));
    const reassignmentData = { id: scheduledId, revision: reassignment.revision, vehicleId: "fulfill-new-vehicle",
      workOrders: reassignment.orders.map(({ workOrderId, assignmentVersion }) => ({ workOrderId, assignmentVersion })),
      reason: "Installer reassigned; reuse these verified staged meters", confirmed: true };
    await rejected("fulfillmentReassign", { ...reassignmentData, revision: 1 });
    await rejected("fulfillmentReassign", { ...reassignmentData, vehicleId: "fulfill-vehicle" });
    const stockBeforeReassignment = (await request("GET", inventory)).state.stock;
    await dialog.getByTestId("fulfillment-back-to-workflows").click();
    await choices.getByRole("button", { name: /^Batches needing review/ }).click();
    await expect(dialog.getByTestId(`fulfillment-review-reassignment-${scheduledId}`)).toBeVisible();
    await dialog.getByTestId(`fulfillment-review-reassignment-${scheduledId}`).click();
    await expect(dialog.getByTestId("fulfillment-reassignment-review")).toBeVisible();
    await expect(dialog.getByTestId(`reassignment-order-${scheduled.id}`)).toContainText(otherInstaller.username);
    await expect(dialog.getByTestId("reassignment-item-fulfill-meter")).toContainText("F-C");
    await dialog.getByTestId("reassignment-vehicle-select").click();
    await page.getByRole("option", { name: "Reassigned installer vehicle", exact: true }).click();
    await dialog.getByTestId("reassignment-reason").fill(reassignmentData.reason);
    await dialog.getByRole("button", { name: "Save & leave", exact: true }).click();
    await page.reload();
    await openWizardPage();
    if (!await dialog.getByTestId("fulfillment-reassignment-review").isVisible()) {
      await openFulfillmentChoices();
      await choices.getByRole("button", { name: /^Batches needing review/ }).click();
      await dialog.getByTestId(`fulfillment-review-reassignment-${scheduledId}`).click();
    }
    await expect(dialog.getByTestId("fulfillment-reassignment-review")).toBeVisible();
    await expect(dialog.getByTestId("reassignment-reason")).toHaveValue(reassignmentData.reason);
    await expect(dialog.getByTestId("reassignment-vehicle-select")).toContainText("Reassigned installer vehicle");
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await expect.poll(async () => {
      const reviewBounds = await dialog.boundingBox();
      return !!reviewBounds && reviewBounds.x >= -1 && reviewBounds.x + reviewBounds.width <= 391;
    }, { message: "Settled reassignment page fits within the phone viewport, not just the document." }).toBe(true);
    assert.equal(await dialog.getByTestId("fulfillment-step-body").evaluate(body =>
      body.scrollWidth <= body.clientWidth + 1), true, "Reassignment contents must not be horizontally clipped.");
    await expect(dialog.getByRole("button", { name: "Next: Capture handoff", exact: true })).toHaveCount(0);
    await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/reassignment-phone.png" });
    await page.setViewportSize({ width: 1280, height: 720 });
    await dialog.getByTestId("reassignment-confirm").scrollIntoViewIfNeeded();
    await expect(dialog.getByTestId("reassignment-confirm")).toBeEnabled();
    await dialog.getByTestId("reassignment-confirm").click();
    await expect(dialog.getByTestId("fulfillment-reassignment-review")).toHaveCount(0);
    state = (await request("GET", inventory)).state;
    assert.deepEqual(state.stock, stockBeforeReassignment, "Reusing staged stock must not record another physical pull.");
    const reassignedBatch = state.fulfillmentBatches.find(batch => batch.id === scheduledId);
    assert.equal(reassignedBatch.revision, 3);
    assert.equal(reassignedBatch.vehicleId, "fulfill-new-vehicle");
    assert.deepEqual(reassignedBatch.lines[0].stagedSerials, ["F-C"]);
    assert.equal(state.allocations.find(allocation => allocation.workOrderId === scheduled.id).assignmentVersion,
      reassignment.orders[0].assignmentVersion);
    const reassignmentReceipt = state.receipts.find(receipt => receipt.action === "fulfillmentReassign" && receipt.reference === scheduledId);
    assert.ok(reassignmentReceipt);
    await command("fulfillmentReassign", reassignmentData, prep, reassignmentReceipt.id);
    assert.deepEqual((await request("GET", inventory)).state.stock, stockBeforeReassignment);
    assert.equal((await pickups()).some(pickup => pickup.batchId === scheduledId), false, "Former vehicle crew must not see the new vehicle's pickup.");
    await request("PATCH", `${root}/work-orders/${scheduled.id}`, { status: "Open", assignedUserId: null, assignedGroupId: group.name }, admin);
    assert.equal((await pickups()).some(pickup => pickup.batchId === scheduledId), false, "Reassigned scheduled work must not invite the former vehicle.");
    const blockedReview = await request("GET", reviewUrl);
    assert.equal(blockedReview.canApply, false);
    assert.ok(blockedReview.blockers.some(reason => /individually Scheduled/.test(reason)));
    await rejected("fulfillmentMove", { id: scheduledId, revision: 3, phase: "vehicle",
      lines: [{ itemId: "fulfill-meter", quantity: 1, serials: ["F-C"] }],
      reason: "Must not deliver for an obsolete assignment", physicallyConfirmed: true });
    await command("fulfillmentClose", { id: scheduledId, revision: 3, reason: "Assignment changed; release staged stock for warehouse review" });
    state = (await request("GET", inventory)).state;
    assert.equal(state.stock.find(stock => stock.warehouseId === "fulfill-stage" && stock.itemId === "fulfill-meter").quantity, 1);
    assert.equal(state.allocations.find(a => a.workOrderId === scheduled.id).lines.length, 0);
     await page.keyboard.press("Escape");
     await page.evaluate(key => localStorage.removeItem(key),
       `meterflo:fulfillment:${encodeURIComponent(String(user.id))}:${fixture.projectId}`);
     await page.reload();
     await launch("crew");
     await dialog.getByLabel("Search orders", { exact: true }).fill("FUL-CREW-1");
     await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
     await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0);
     await expect(selectAll).toBeDisabled();
     for (const viewport of viewports) {
       await page.setViewportSize(viewport);
       await dialog.getByTestId("fulfillment-no-eligible").scrollIntoViewIfNeeded();
       await expect(dialog.getByTestId("fulfillment-no-eligible")).toBeVisible();
       assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
       await page.screenshot({ path: `generated-artifacts/inventory-fulfillment/eligible-empty-${viewport.width}.png` });
     }
     await page.setViewportSize({ width: 1280, height: 900 });
     await request("PATCH", `${root}/work-orders/${crewWork[0].id}`, { status: "Completed",
       oldSystemId: "FUL-OLD-A", newSystemId: "F-A", oldSystemReading: 1, newSystemReading: 0,
       signatureName: "Fulfillment acceptance",
       signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" }, admin);
     await expect(rowCheckbox("FUL-CREW-1")).toHaveCount(0, { timeout: 20000 });
     await expect(dialog.getByText("No matching work orders", { exact: true })).toBeVisible({ timeout: 20000 });
     discovery = await request("GET", `${inventory}/fulfillment`);
     assert.ok(!discovery.orders.some(order => order.workOrderId === crewWork[0].id));
     assert.ok(discovery.batches.some(batch => batch.id === batchId && batch.status === "completed"),
       "Completing a work order does not delete its fulfillment batch history.");
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view", "inventory.view"] }, admin);
    await rejected("fulfillmentClose", { id: scheduledId, revision: 3, reason: "Permission revoked during an open wizard" }, 403);
    assert.deepEqual(errors, []);
    console.log("PASS filtered crew/scheduled bulk selection, searchable partial serial handoffs, scan/checkbox deduplication, saved selections, permission and unknown-outcome locks, delivered-unit exclusion, no preparation stock posts, responsive controls, recoverable staging, exactly-once handoff, readable print, reassignment safety and release semantics.");
  } catch (error) {
    const page = prep.pages()[0];
    if (page) {
      console.error("Fulfillment page at failure:", page.url(), await page.locator("body").innerText());
      await fs.mkdir("generated-artifacts/inventory-fulfillment", { recursive: true });
      await page.screenshot({ path: "generated-artifacts/inventory-fulfillment/failure.png" });
    }
    throw error;
  } finally { await prep.close(); await tech.close(); await admin.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
