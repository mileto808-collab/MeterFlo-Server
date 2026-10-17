// Disposable authenticated acceptance fixture; never run against customer projects.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect: baseExpect } = require("@playwright/test");
const expect = baseExpect.configure({ timeout: 20000 });
async function main() {
  const f = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = `https://${process.env.REPLIT_DEV_DOMAIN}`, root = `/api/projects/${f.projectId}`;
  const admin = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 }, hasTouch: true });
  const member = await browser.newContext({ baseURL });
  const request = async (context, method, path, data, status = 200) => {
    const res = await context.request.fetch(path, { method, data });
    assert.equal(res.status(), status, `${method} ${path}: ${res.status()} ${await res.text()}`);
    return res.json();
  };
  const api = (method, path, data, status) => request(admin, method, path, data, status);
  const cmd = (action, data, context = admin, status = 200) =>
    request(context, "POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data }, status);
  const snapshot = async () => (await api("GET", `${root}/inventory`)).state;
  let type, originalProjectIds;
  try {
    await api("POST", "/api/auth/local/login", f);
    await request(member, "POST", "/api/auth/local/login", f.viewer);
    const grant = permissions => api("PUT", `/api/subroles/${f.viewerRoleId}/permissions`, { permissions });
    const basic = ["nav.projects", "projects.view", "project.workOrders", "workOrders.view", "inventory.view", "inventory.assign", "inventory.receive"];
    await grant(basic);
    const definitions = await api("GET", "/api/permissions");
    assert.ok(definitions.some(p => p.key === "inventory.manageRemovalRules"));
    assert.ok(definitions.some(p => p.key === "inventory.resolveReturns"));
    type = (await api("GET", "/api/system-types"))[0];
    originalProjectIds = type.projectIds || [];
    const service = (await api("GET", "/api/service-types"))[0];
    await api("PATCH", `/api/system-types/${type.id}`, { projectIds: [...new Set([...originalProjectIds, f.projectId])] });
    await api("PUT", `${root}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", root, { wizardMode: "changeout", changeoutEquipmentType: "system",
      wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false, wizardShowGpsStep: false,
      wizardShowSignatureStep: false, wizardShowNotesStep: false });
    await cmd("warehouse", { id: "main", code: "MAIN", name: "Main returns warehouse", type: "physical", address: "Fixture only" });
    await cmd("vendor", { id: "supplier", name: "Fixture supplier" });
    await cmd("item", { id: "meter", sku: "SYSTEM", name: "Fixture system", tracking: "serialized", equipment: "system" });
    await cmd("order", { id: "po", type: "purchase", vendorId: "supplier", destinationId: "main", lines: [{ itemId: "meter", quantity: 2 }] });
    await cmd("release", { orderId: "po" });
    await cmd("receive", { orderId: "po", lines: [{ itemId: "meter", quantity: 2, serials: ["NEW-A", "NEW-B"] }] });
    const work = await api("POST", `${root}/work-orders`, { customerWoId: `REMOVAL-${Date.now()}`, customerId: "FIXTURE",
      customerName: "Fixture customer", address: "Test only", serviceType: service.code, oldSystemId: "OLD-A",
      oldModuleId: "HISTORICAL-MODULE", oldSystemReading: "1", status: "Open" }, 201);
    let wi = await api("GET", `${root}/work-orders/${work.id}/inventory`);
    assert.equal(wi.workflow.equipment, "system");
    assert.ok(wi.removalPolicies[0].requireSystemReturn);
    await cmd("prepareUse", { workOrderId: work.id, revision: 0, mode: "reading_only", used: [], dispositions: [] }, admin, 409);
    const page = await admin.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await fs.mkdir("generated-artifacts", { recursive: true });
    for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }], ["landscape", { width: 844, height: 390 }]]) {
      await page.setViewportSize(viewport);
      await page.goto(`/projects/${f.projectId}/inventory?tab=returns`);
      await page.getByTestId("inventory-sticky-header").waitFor();
      const menu = page.getByTestId("inventory-mobile-menu");
      if (await menu.isVisible()) { await menu.click(); await page.getByRole("menuitem", { name: "Removed Equipment", exact: true }).click(); }
      else await page.getByRole("tab", { name: "Removed Equipment", exact: true }).click();
      await page.getByRole("button", { name: "Removal rules", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText("All removed systems must return to warehouse");
      await dialog.getByRole("button", { name: "Add disposition", exact: true }).click();
      await expect(dialog.getByRole("button", { name: "Save disposition", exact: true })).toBeDisabled();
      await dialog.getByLabel("Disposition name", { exact: true }).fill(`UI unused ${name}`);
      await dialog.getByRole("button", { name: "Save disposition", exact: true }).click();
      const unused = dialog.locator("article").filter({ hasText: `UI unused ${name}` });
      await expect(unused).toBeVisible();
      page.once("dialog", d => d.accept());
      await unused.getByRole("button", { name: "Delete", exact: true }).click();
      await expect(unused).toHaveCount(0);
      await page.screenshot({ path: `generated-artifacts/removal-rules-${name}.jpg`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.keyboard.press("Escape");
      await page.goto(`/projects/${f.projectId}/work-orders?edit=${work.id}`);
      const system = page.getByTestId("accordion-system");
      if (await system.getAttribute("data-state") === "closed") await system.click();
      const section = page.getByTestId("equipment-inventory-section");
      await expect(section).toBeVisible();
      await section.locator("summary").click();
      await expect(section.getByRole("region", { name: "Planned requirements", exact: true })).toBeVisible();
      await expect(page.getByText("Inventory for this visit", { exact: true })).toHaveCount(2);
      await page.screenshot({ path: `generated-artifacts/removal-work-details-${name}.jpg`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      await page.getByRole("button", { name: "Start Changeout", exact: true }).click();
      await page.getByTestId("button-system-can-change").click();
      await expect(page.getByTestId("input-old-system-reading")).toBeVisible();
      await expect(page.getByTestId("input-old-module-reading")).toHaveCount(0);
      await page.keyboard.press("Escape");
    }
    let s = await snapshot(), rule = s.removalRules[0];
    await cmd("removalRule", { ...rule, id: crypto.randomUUID(), name: "Contract return for inspection", revision: 1 });
    s = await snapshot(); rule = s.removalRules.find(r => r.name === "Contract return for inspection");
    const used = [{ itemId: "meter", warehouseId: "main", quantity: 1, serials: ["NEW-A"] }];
    const capture = revision => [{ equipment: "system", serial: "OLD-A", disposition: "returned", warehouseId: "main",
      ruleId: rule.id, ruleRevision: revision, policyRevision: s.removalPolicies[0].revision }];
    await cmd("prepareUse", { workOrderId: work.id, revision: 0, mode: "changeout", used, dispositions: capture(1) });
    await cmd("removalRule", { ...rule, name: "Contract return renamed" });
    const failed = await admin.request.patch(`${root}/work-orders/${work.id}`, { data: { status: "Completed", newSystemId: "NEW-A", newSystemReading: "0" } });
    assert.equal(failed.status(), 409, await failed.text());
    wi = await api("GET", `${root}/work-orders/${work.id}/inventory`);
    const operationId = crypto.randomUUID(), usage = { operationId, revision: wi.allocation.revision,
      mode: "changeout", used, dispositions: capture(2) };
    await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Completed", newSystemId: "NEW-A", newSystemReading: "0", inventoryUsage: usage });
    await api("PATCH", `${root}/work-orders/${work.id}`, { status: "Completed", newSystemId: "NEW-A", newSystemReading: "0", inventoryUsage: usage });
    s = await snapshot();
    assert.equal(s.stock[0].quantity, 1);
    const removed = s.returns[0];
    assert.equal(removed.ruleName, "Contract return renamed");
    assert.equal(removed.status, "pending");
    assert.equal((await api("GET", `${root}/work-orders/${work.id}`)).old_module_id, "HISTORICAL-MODULE");
    await cmd("removalRule", { ...s.removalRules.find(r => r.id === rule.id), active: false });
    await cmd("returnAccept", { id: removed.id }, member);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/projects/${f.projectId}/inventory?tab=returns`);
    await page.getByTestId("inventory-sticky-header").waitFor();
    await page.getByTestId("inventory-mobile-menu").click();
    await page.getByRole("menuitem", { name: "Removed Equipment", exact: true }).click();
    await page.getByLabel("Inspection reason", { exact: true }).fill("Retained inspection note");
    const releaseRule = s.removalRules.find(r => r.stage === "warehouse" && r.outcome === "released");
    await page.getByRole("button", { name: "Removal rules", exact: true }).click();
    const manager = page.getByRole("dialog");
    await manager.locator("article").filter({ hasText: releaseRule.name }).getByRole("button", { name: "Edit", exact: true }).click();
    await manager.getByLabel("Disposition name", { exact: true }).fill("Local unsaved rule name");
    await cmd("removalRule", { ...releaseRule, name: "Updated release inspection policy" });
    await expect(manager.getByRole("alert")).toContainText("changed elsewhere");
    await expect(manager.getByLabel("Disposition name", { exact: true })).toHaveValue("Local unsaved rule name");
    page.once("dialog", d => d.accept());
    await manager.getByRole("button", { name: "Cancel edit", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("alert")).toContainText("Return or rules changed");
    await expect(page.getByLabel("Inspection reason", { exact: true })).toHaveValue("Retained inspection note");
    await page.screenshot({ path: "generated-artifacts/removal-inspection-live-phone.jpg", fullPage: true });
    const scrap = s.removalRules.find(r => r.stage === "warehouse" && r.outcome === "scrapped");
    const decision = { id: removed.id, ruleId: scrap.id, ruleRevision: scrap.revision, reason: "Inspection: failed" };
    await cmd("returnDecide", decision, member, 403);
    await cmd("removalPolicy", s.removalPolicies[0], member, 403);
    await grant([...basic, "inventory.resolveReturns"]);
    await cmd("returnDecide", decision, member);
    s = await snapshot();
    assert.equal(s.returns[0].status, "scrapped");
    assert.equal(s.returns[0].history.length, 3);
    assert.equal(s.stock[0].quantity, 1);
    await api("DELETE", `${root}/work-orders/${work.id}`, undefined, 409);
    assert.equal((await api("GET", `${root}/work-orders/${work.id}`)).status, "Completed");
    const mobile = await api("GET", `${root}/mobile/sync/download`);
    assert.equal(mobile.inventory.removalContractVersion, 1);
    assert.equal(mobile.inventory.workflow.equipment, "system");
    assert.ok(mobile.inventory.removalRules.some(r => r.id === rule.id));
    await api("PATCH", root, { wizardMode: "reading_only", readingEquipmentType: "system" });
    const reading = await api("POST", `${root}/work-orders`, { customerWoId: `READ-${Date.now()}`, customerId: "READ",
      customerName: "Reading fixture", address: "Test only", serviceType: service.code, oldSystemId: "READ-METER", oldSystemReading: "1", status: "Open" }, 201);
    await api("PATCH", `${root}/work-orders/${reading.id}`, { status: "Completed", newSystemId: "READ-METER", newSystemReading: "1" });
    assert.equal((await snapshot()).stock[0].quantity, 1);
    await cmd("assign", { workOrderId: reading.id, lines: [] }, admin, 409);
    await api("PATCH", root, { wizardMode: "user_choice", changeoutEquipmentType: "module", readingEquipmentType: "system" });
    const choice = await api("POST", `${root}/work-orders`, { customerWoId: `CHOICE-${Date.now()}`, customerId: "CHOICE",
      customerName: "Scope fixture", address: "Test only", serviceType: service.code, oldSystemId: "READ-OLD",
      oldModuleId: "MODULE-OLD", oldSystemReading: "1", oldModuleRead: "1", status: "Open" }, 201);
    // A module change cannot inherit a system-reading permission exemption.
    await grant([...basic.filter(p => p !== "inventory.assign"), "workOrders.edit", "workOrders.meterChangeout"]);
    const replacement = { status: "Completed", newSystemId: "READ-OLD", newSystemReading: "1", newModuleId: "MODULE-NEW", newModuleRead: "0" };
    const stockBeforeBypass = JSON.stringify((await snapshot()).stock);
    const deny = async context => {
      const response = await context.request.patch(`${root}/work-orders/${choice.id}`, { data: replacement });
      assert.equal(response.status(), 409, await response.text());
      assert.equal((await api("GET", `${root}/work-orders/${choice.id}`)).status, "Open");
      assert.equal(JSON.stringify((await snapshot()).stock), stockBeforeBypass);
    };
    await deny(member); // No inventory.assign, no prepared review.
    await deny(admin);  // Permission alone cannot replace the required review.
    await cmd("prepareUse", { workOrderId: choice.id, revision: 0, mode: "reading_only", used: [], dispositions: [] });
    await deny(admin);
    await deny(member); // Explicit reading-only review is not an escape hatch.
    const forgedBaseline = await admin.request.patch(`${root}/work-orders/${choice.id}`, { data: { ...replacement, oldModuleId: "MODULE-NEW" } });
    assert.equal(forgedBaseline.status(), 409, await forgedBaseline.text());
    for (const [name, viewport] of [["desktop", { width: 1280, height: 900 }], ["phone", { width: 390, height: 844 }]]) {
      await page.setViewportSize(viewport);
      for (const mode of ["changeout", "reading_only"]) {
        await page.goto(`/projects/${f.projectId}/work-orders?edit=${choice.id}`);
        await page.getByRole("button", { name: "Start Changeout", exact: true }).click();
        await page.getByTestId(mode === "changeout" ? "button-mode-changeout" : "button-mode-reading-only").click();
        await page.getByTestId("button-wizard-next").click();
        await page.getByTestId("button-system-can-change").click();
        if (mode === "changeout") {
          await expect(page.getByTestId("input-old-module-reading")).toBeVisible();
          await expect(page.getByTestId("input-old-system-reading")).toHaveCount(0);
        } else {
          await expect(page.getByPlaceholder("Enter system reading (digits only)...", { exact: true })).toBeVisible();
          await expect(page.getByPlaceholder("Enter module reading (digits only)...", { exact: true })).toHaveCount(0);
        }
        await page.keyboard.press("Escape");
      }
      await api("PATCH", root, { inventoryEnabled: false });
      await page.goto(`/projects/${f.projectId}/work-orders?edit=${choice.id}`);
      await page.getByRole("button", { name: "Start Changeout", exact: true }).waitFor();
      await expect(page.getByTestId("equipment-inventory-section")).toHaveCount(0);
      await api("PATCH", root, { inventoryEnabled: true });
    }
    assert.deepEqual(errors, []);
    console.log("PASS: desktop/phone/landscape, scoped work details and wizard, stale policy completion, stable mobile retry, required returns, warehouse permission, reading-only no consumption.");
  } finally {
    if (type) await api("PATCH", `/api/system-types/${type.id}`, { projectIds: originalProjectIds });
    await admin.close(); await member.close(); await browser.close();
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
