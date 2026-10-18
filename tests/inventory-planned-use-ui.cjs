// Run after tests/support/inventory-ui-fixture.ts; fixture cleanup owns every write.
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const { chromium, expect } = require("@playwright/test");

async function main() {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Run this test through the owned workspace sandbox.");
  const f = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")(), viewport: { width: 1280, height: 900 } });
  const api = async (method, path, data) => {
    const r = await context.request.fetch(path, { method, data });
    assert.ok(r.ok(), `${method} ${path}: ${r.status()} ${await r.text()}`);
    return r.json();
  };
  const errors = [];
  try {
    await api("POST", "/api/auth/local/login", f);
    const base = `/api/projects/${f.projectId}`;
    const type = (await api("GET", "/api/system-types"))[0];
    const service = (await api("GET", "/api/service-types"))[0];
    await api("PATCH", `/api/system-types/${type.id}`, { projectIds: [...new Set([...(type.projectIds || []), f.projectId])] });
    await api("PUT", `${base}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", base, { changeoutEquipmentType: "system", wizardMode: "changeout",
      wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false,
      wizardShowGpsStep: false, wizardShowSignatureStep: false, wizardShowNotesStep: false });
    const command = (action, data) => api("POST", `${base}/inventory/commands`, { operationId: crypto.randomUUID(), action, data });
    if (!(await api("GET", `${base}/inventory`)).state.orders.some(o => o.id === "planned-po")) {
    await command("warehouse", { id: "planned-van", code: "VAN", name: "Fixture van", type: "physical", address: "Test only" });
    await command("vendor", { id: "planned-vendor", name: "Fixture supplier" });
    await command("item", { id: "planned-meter", sku: "PLAN-M", name: "Planned test system", tracking: "serialized", equipment: "system" });
    await command("item", { id: "planned-seal", sku: "PLAN-S", name: "Planned test seal", tracking: "regular" });
    await command("item", { id: "planned-kit", sku: "PLAN-K", name: "Planned installation kit", tracking: "serialized",
      components: [{ itemId: "planned-meter", quantity: 1 }, { itemId: "planned-seal", quantity: 2 }] });
    await command("order", { id: "planned-po", type: "purchase", vendorId: "planned-vendor", destinationId: "planned-van",
      lines: [{ itemId: "planned-meter", quantity: 2 }, { itemId: "planned-seal", quantity: 4 }] });
    await command("release", { orderId: "planned-po" });
    await command("receive", { orderId: "planned-po", lines: [
      { itemId: "planned-meter", quantity: 2, serials: ["PLANNED-001", "PLANNED-002"] },
      { itemId: "planned-seal", quantity: 4, serials: [] },
    ] });
    }
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base.replace("/api", "")}/inventory?tab=items`);
    await page.getByRole("tab", { name: "Items", exact: true }).click();
    await page.getByRole("button", { name: "Link equipment types to inventory items" }).click();
    await expect(page.getByRole("dialog")).toContainText("Type item links");
    await page.locator(`#type-link-system-${type.id}`).selectOption("planned-kit");
    await expect(page.locator(`#type-link-system-${type.id}`)).toHaveValue("planned-kit");
    await expect.poll(async () => (await api("GET", `${base}/inventory/type-links`)).links[0]?.itemId).toBe("planned-kit");
    await page.keyboard.press("Escape");
    const oldSerial = `OLD-${Date.now()}`;
    const work = await api("POST", `${base}/work-orders`, { customerWoId: `PLANNED-UI-${Date.now()}`, customerId: "FIXTURE",
      customerName: "Fixture customer", address: "Test only", serviceType: service.code,
      newSystemType: type.productId, oldSystemId: oldSerial, oldSystemReading: "1", status: "Open" });
    let snapshot = await api("GET", `${base}/work-orders/${work.id}/inventory`);
    assert.equal(snapshot.allocation, null);
    assert.deepEqual(snapshot.requirements.lines, [{ itemId: "planned-kit", quantity: 1 }]);
    for (const mobile of [false, true]) {
      await page.setViewportSize(mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 });
      await page.goto(`${base.replace("/api", "")}/work-orders?edit=${work.id}`);
      await page.getByRole("button", { name: "Start Changeout", exact: true }).click();
      const next = page.getByTestId("button-wizard-next");
      await page.getByTestId("button-system-can-change").click();
      // Verify prefilled old reading; no photos/GPS/signature are required by this fixture.
      await expect(page.getByTestId("input-old-system-reading")).toBeVisible();
      await page.getByTestId("input-old-system-reading").fill("1");
      await next.click();
      await expect(page.getByText("Perform Physical Changeout", { exact: true })).toBeVisible();
      await expect(page.locator('section[aria-label="Planned work-order requirements"]')).toContainText("Planned test system");
      await expect(page.locator('section[aria-label="Planned work-order requirements"]')).not.toContainText("Planned installation kit");
      await expect(page.getByRole("region", { name: "Actual items used", exact: true })).toHaveCount(0);
      await page.screenshot({ path: `generated-artifacts/planned-use-${mobile ? "phone" : "desktop"}.jpg`, fullPage: true });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      assert.equal(overflow, false, "wizard must fit viewport");
      await page.keyboard.press("Escape");
    }
    // Exercise the exact new wizard backend flow without a preparatory assignment.
    snapshot = await api("GET", `${base}/work-orders/${work.id}/inventory`);
    assert.equal(snapshot.allocation, null);
    await command("prepareUse", { workOrderId: work.id, revision: 0, mode: "changeout",
      dispositions: [{ equipment: "system", serial: oldSerial, disposition: "returned", warehouseId: "planned-van",
        ruleId: snapshot.removalRules.find(rule => rule.active && rule.stage === "field" && rule.outcome === "returned").id }],
      used: [{ itemId: "planned-meter", warehouseId: "planned-van", quantity: 1, serials: ["PLANNED-001"] },
        { itemId: "planned-seal", warehouseId: "planned-van", quantity: 2, serials: [] }] });
    const prepared = await api("GET", `${base}/inventory`);
    assert.equal(prepared.state.stock.find(s => s.itemId === "planned-meter").quantity, 2);
    assert.equal(prepared.state.allocations[0].lines.length, 0);
    await api("PATCH", `${base}/work-orders/${work.id}`, { status: "Completed", newSystemId: "PLANNED-001", newSystemReading: "0" });
    const done = await api("GET", `${base}/inventory`);
    assert.equal(done.state.stock.find(s => s.itemId === "planned-meter").quantity, 1);
    assert.equal(done.state.stock.find(s => s.itemId === "planned-seal").quantity, 2);
    assert.ok(done.state.serialOccupancy.some(s => s.serial === "PLANNED-001" && s.workOrderId === work.id));
    assert.deepEqual(errors, []);
    console.log("PASS: Type links save, planned requirements do not reserve, physical wizard fits desktop/phone, loose kit components consume atomically.");
  } finally {
    await context.close();
    await browser.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
