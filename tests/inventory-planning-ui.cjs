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
  const root = `/api/projects/${fixture.projectId}`;
  const request = async (method, path, data, context = prep) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const post = (action, data, context = prep) => request("POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data }, context);
  try {
    await request("POST", "/api/auth/local/login", fixture, admin);
    const role = await request("POST", "/api/subroles", {
      key: `prep_${crypto.randomUUID().slice(0, 8)}`, label: "Owned inventory preparation", baseRole: "user",
      permissions: ["workOrders.view", "workOrders.meterChangeout", "inventory.view", "inventory.maintain",
        "inventory.assign", "inventory.transfer", "inventory.receive", "inventory.purchase"],
    }, admin);
    const credentials = { username: `prep-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const user = await request("POST", "/api/users", { ...credentials, firstName: "Owned", lastName: "Preparation",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] }, admin);
    await request("POST", "/api/auth/local/login", credentials);
    const services = await request("GET", "/api/service-types", undefined, admin);
    const work = await request("POST", `${root}/work-orders`, { customerWoId: "PLAN-STAGE-OWNED",
      customerName: "Manual preparation fixture", serviceType: services[0].code,
      status: "Open", assignedUserId: user.id, address: "100 Owned Test Road", oldSystemReading: "1" }, admin);
    const other = await request("POST", `${root}/work-orders`, { customerWoId: "PLAN-OTHER-OWNED",
      serviceType: services[0].code, status: "Open", assignedUserId: user.id }, admin);
    for (const id of ["plan-source", "plan-stage"]) await post("warehouse", { id, code: id, name: id, type: "physical", address: "Owned fixture" }, admin);
    await post("vendor", { id: "plan-vendor", name: "Owned vendor" });
    await post("item", { id: "plan-meter", sku: "PLAN-METER", name: "Planning meter", tracking: "serialized", equipment: "system" });
    await post("item", { id: "plan-part", sku: "PLAN-PART", name: "Additional fitting", tracking: "regular" });
    const manual = [{ id: crypto.randomUUID(), itemId: "plan-part", quantity: 100, kind: "addition", reason: "Extra fittings requested" }];
    await post("plan", { workOrderId: work.id, revision: 0, lines: manual });
    let snapshot = await request("GET", `${root}/work-orders/${work.id}/inventory`);
    assert.deepEqual(snapshot.requirements.lines, [{ itemId: "plan-part", quantity: 100 }]);
    assert.equal(snapshot.allocation, null);
    const stale = await prep.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "plan", data: { workOrderId: work.id, revision: 0, lines: [] },
    } });
    assert.equal(stale.status(), 409, await stale.text());
    await request("PATCH", `${root}/work-orders/${work.id}`, { notes: "Ordinary edit preserves manual planning" }, admin);
    snapshot = await request("GET", `${root}/work-orders/${work.id}/inventory`);
    assert.equal(snapshot.plan.lines[0].id, manual[0].id);
    await post("order", { id: "plan-po", type: "purchase", vendorId: "plan-vendor", destinationId: "plan-source",
      lines: [{ itemId: "plan-meter", quantity: 4 }] });
    await post("release", { orderId: "plan-po" });
    await post("receive", { orderId: "plan-po", lines: [{ itemId: "plan-meter", quantity: 4, serials: ["P1", "P2", "P3", "P4"] }] });
    const hold = { itemId: "plan-meter", warehouseId: "plan-source", quantity: 2, serials: [], reservationMode: "quantity" };
    await post("assign", { workOrderId: work.id, revision: 0, lines: [hold] });
    const over = await prep.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "assign", data: { workOrderId: other.id, revision: 0, lines: [{ ...hold, quantity: 3 }] },
    } });
    assert.equal(over.ok(), false);
    snapshot = await request("GET", `${root}/work-orders/${work.id}/inventory`);
    const staging = { operationId: crypto.randomUUID(), action: "stageWorkOrder", data: {
      workOrderId: work.id, revision: snapshot.allocation.revision, sourceId: "plan-source", destinationId: "plan-stage",
      lines: [{ itemId: "plan-meter", quantity: 1, serials: ["P1"] }],
      reason: "Counted and physically moved to the staging area", physicallyConfirmed: true,
    } };
    await request("POST", `${root}/inventory/commands`, staging);
    await request("POST", `${root}/inventory/commands`, staging);
    snapshot = await request("GET", `${root}/work-orders/${work.id}/inventory`);
    assert.equal(snapshot.stagingReceipts.length, 1);
    assert.equal(snapshot.allocation.lines.find(line => line.warehouseId === "plan-stage").quantity, 1);
    assert.deepEqual(snapshot.allocation.lines.find(line => line.warehouseId === "plan-stage").serials, []);
    assert.equal(snapshot.allocation.status, "reserved");
    const inventory = (await request("GET", `${root}/inventory`)).state;
    assert.equal(inventory.stock.find(line => line.warehouseId === "plan-source" && line.itemId === "plan-meter").quantity, 3);
    assert.equal(inventory.stock.find(line => line.warehouseId === "plan-stage" && line.itemId === "plan-meter").quantity, 1);
    assert.equal(inventory.workPlans.find(plan => plan.workOrderId === work.id).lines[0].quantity, 100);
    const receipt = await prep.request.get(`${root}/inventory/print/receipt/${snapshot.stagingReceipts[0].id}`);
    assert.ok(receipt.ok());
    assert.match(await receipt.text(), /PLAN-STAGE-OWNED/);
    const page = await prep.newPage();
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByRole("cell", { name: "PLAN-STAGE-OWNED", exact: true }).click();
    const panel = page.getByTestId("work-order-inventory-panel");
    if (!await panel.isVisible()) await page.getByTestId("accordion-inventory").click();
    await expect(panel).toBeVisible();
    await expect(panel.getByText("Additional fitting", { exact: false }).first()).toBeVisible();
    await fs.mkdir("generated-artifacts/inventory-planning", { recursive: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
      await page.screenshot({ path: `generated-artifacts/inventory-planning/${viewport.width}.png` });
    }
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: ["workOrders.view", "inventory.view"] }, admin);
    const denied = await prep.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "plan", data: { workOrderId: work.id, revision: 1, lines: [] },
    } });
    assert.equal(denied.status(), 403);
    console.log("PASS normal-role manual planning, optimistic conflicts, quantity holds, physical staging, retry safety, readable print, permission revocation and responsive work-order Inventory.");
  } finally {
    await prep.close(); await admin.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
