const assert = require("node:assert/strict");
const fs = require("node:fs");
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
    const start = async (work, both = false) => {
      await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${work.id}`);
      await page.getByRole("button", { name: "Start Changeout", exact: true }).click();
      await page.getByTestId("button-system-can-change").click();
      await page.getByTestId("input-old-system-reading").fill("1");
      if (both) await page.getByTestId("input-old-module-reading").fill("1");
      await next.click();
      await expect(page.getByText("Perform Physical Changeout", { exact: true })).toBeVisible();
    };
    const scanIds = async (system, module) => {
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
      await page.getByTestId("input-gps-coordinates").fill("40,-74");
      await next.click();
      await page.getByTestId("button-signature-type-mode").click();
      await page.getByTestId("input-signature-name").fill("Fixture technician");
      await page.getByTestId("button-confirm-type").click();
      await next.click();
    };
    const finish = async (work, both = false, inventory = true) => {
      if (inventory) {
        await expect(page.getByRole("heading", { name: "Inventory use & removed equipment review", level: 3, exact: true })).toBeVisible();
        for (const [equipment, serial] of [["system", work.oldSystemId], ...(both ? [["module", work.oldModuleId]] : [])]) {
          const card = page.locator(`#removed-${equipment}`).locator("..").locator("..");
          await expect(card.locator(`#removed-${equipment}`)).toHaveValue(serial);
          await choose(card.getByRole("combobox").first(), /Return to warehouse/);
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
    const fieldSettings = page.getByRole("region", { name: "Field inventory settings" });
    await expect(fieldSettings).toBeVisible();
    await page.getByTestId("input-name").fill("Unsaved project draft");
    await choose(page.locator("#field-stock-source-mode"), "Project warehouse stock");
    await choose(page.locator("#field-stock-warehouse"), /^WIZ ·/);
    await fieldSettings.getByRole("button", { name: "Save field inventory settings" }).click();
    await expect(fieldSettings.getByRole("button", { name: "Save field inventory settings" })).toBeDisabled();
    await expect(page.getByTestId("input-name")).toHaveValue("Unsaved project draft");
    await expect.poll(async () => (await api("GET", `${root}/inventory`)).state.fieldSettings?.[0]?.warehouseId).toBe("wizard-w");
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
    await api("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, { permissions: registry.filter(p =>
      p.key.startsWith("workOrders.") || ["projects.view", "project.workOrders", "inventory.view", "inventory.assign"].includes(p.key)).map(p => p.key) });
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
    const sharedSecond = await makeWork("shared-second", false, true, fixture.viewer.id);
    await start(sharedSecond);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Stock source: SHARED");
    await expect(page.getByRole("button", { name: "Change stock source" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Change kit handling" })).toHaveCount(0);
    await page.screenshot({ path: "generated-artifacts/wizard-use/shared-vehicle-phone.jpg", fullPage: true });
    const forbiddenSource = await viewerContext.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "prepareUse", data: { workOrderId: sharedSecond.id, revision: 0, mode: "changeout",
        used: [{ warehouseId: "wizard-w", itemId: "qty-system", quantity: 1, serials: [] }], dispositions: [] } } });
    assert.equal(forbiddenSource.status(), 403, "Direct API requests cannot bypass source permissions");
    await next.click(); await scanIds("SHARED-SECOND"); await finish(sharedSecond);
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
    const techKit = await makeWork("tech-kit", true, true, fixture.viewer.id);
    await start(techKit, true);
    await expect(page.getByRole("region", { name: "Planned work-order requirements" })).toContainText("Kit handling: Preassembled kits");
    await expect(page.getByRole("button", { name: "Change kit handling" })).toHaveCount(0);
    await page.getByLabel("Kit serial", { exact: true }).fill("KIT-TECH");
    await next.click(); await scanIds("SYS-TECH", "MOD-TECH"); await finish(techKit, true);
    const kitUsage = (await api("GET", `${root}/work-orders/${techKit.id}/inventory`)).allocation.used;
    assert.deepEqual(kitUsage.map(l => l.itemId), ["manual-kit"], "Do not deduct loose components again");
    assert.deepEqual(kitUsage[0].serials, ["KIT-TECH"]);
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
    assert.deepEqual(errors, []);
    console.log("PASS: independently saved project field stock settings preserve project drafts; two technicians consume shared vehicle stock; assigned-vehicle defaults; remembered multi-vehicle choice; direct warehouse consumption without transfers; unauthorized configuration/source changes rejected; inline planned inventory; manual kits; wizard-only device scans; inventory-disabled workflow unchanged.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
