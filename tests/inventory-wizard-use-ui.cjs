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
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    fs.mkdirSync("generated-artifacts/wizard-use", { recursive: true });
    const next = page.getByTestId("button-wizard-next");
    const choose = async (trigger, option) => {
      await trigger.click();
      await page.getByRole("option", { name: option }).click();
    };
    const makeWork = async (name, both = false, planned = false) => api("POST", `${root}/work-orders`, {
      customerWoId: `wizard-${name}-${crypto.randomUUID()}`, customerName: "Wizard use fixture", serviceType: service.code,
      status: "Open", oldSystemId: `OLD-S-${name}`, oldSystemReading: "1",
      ...(both ? { oldModuleId: `OLD-M-${name}`, oldModuleRead: "1" } : {}),
      ...(planned ? { newSystemType: type.productId } : {}),
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
    const planned = await makeWork("planned", false, true);
    await start(planned);
    const label = page.getByRole("region", { name: "Planned work-order requirements", exact: true });
    await expect(label).toContainText("Inventory");
    await expect(label).toContainText("Quantity system");
    await expect(label).toContainText("Changeout labor");
    await expect(label).not.toContainText("Long project kit title");
    await expect(page.getByRole("region", { name: "Actual items used", exact: true })).toHaveCount(0);
    await expect(next).toBeDisabled();
    await choose(page.locator("#planned-use-warehouse"), /^WIZ ·/);
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
      await choose(page.locator("#actual-use-warehouse"), /^WIZ ·/);
      if (mode === "kits") await choose(page.locator("#manual-kit-mode"), /^Preassembled kit$/);
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
    console.log("PASS: inline planned inventory; no planned-item catalog picker; planned quantity stock consumption; manually selected kits using loose or assembled stock; wizard-only system/module serial scans; atomic completion; missing mappings block; inventory-disabled workflow unchanged.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
