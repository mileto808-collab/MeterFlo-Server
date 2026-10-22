const { chromium, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL });
  const planner = await browser.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`;
  const request = async (method, url, data, context = admin) => {
    const response = await context.request.fetch(url, { method, data });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data, context = admin) =>
    request("POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data }, context);
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const rolePermissions = ["projects.view", "workOrders.view", "workOrders.edit", "workOrders.meterChangeout",
      "inventory.assign", "inventory.plan"];
    const role = (await request("GET", "/api/subroles")).find(role => role.key === "field_technician");
    assert.ok(role);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: rolePermissions });
    const credentials = { username: `planner-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    const user = await request("POST", "/api/users", { ...credentials, firstName: "Field", lastName: "Planner",
      role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request("POST", "/api/auth/local/login", credentials, planner);
    await command("warehouse", { id: "planning-source", code: "PLANSOURCE", name: "Project direct-use warehouse",
      type: "physical", address: "Owned fixture" });
    await command("fieldSettings", { sourceMode: "project_warehouse", warehouseId: "planning-source" });
    const services = await request("GET", "/api/service-types");
    const work = await request("POST", `${root}/work-orders`, { customerWoId: "SIMPLE-PLAN",
      customerName: "Owned planning acceptance", serviceType: services[0].code, status: "Open",
      assignedUserId: user.id, address: "100 Owned Test Road" });
    const unrelated = await request("POST", `${root}/work-orders`, { customerWoId: "OTHER-PLANNER",
      serviceType: services[0].code, status: "Open", assignedUserId: fixture.id });
    await command("item", { id: "simple-fitting", sku: "SIMPLE-FITTING", name: "Additional fitting",
      tracking: "regular", cost: 7, billingRate: 12 });
    let data = await request("GET", `${root}/work-orders/${work.id}/inventory`, undefined, planner);
    assert.equal(data.capabilities.canPlan, true);
    for (const capability of ["canReserve", "canStage", "canReviewUse", "canOverridePlan", "canReconcile"])
      assert.equal(data.capabilities[capability], false, capability);
    const item = data.items.find(item => item.id === "simple-fitting");
    assert.ok(item);
    assert.equal(item.cost, undefined);
    assert.equal(item.billingRate, undefined);
    assert.equal((await planner.request.get(`${root}/inventory`)).status(), 403);
    const page = await planner.newPage();
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByRole("cell", { name: "SIMPLE-PLAN", exact: true }).click();
    const panel = page.getByTestId("work-order-inventory-panel");
    if (!await panel.isVisible()) await page.getByTestId("accordion-inventory").click();
    await expect(panel.getByRole("heading", { name: "Planned items", exact: true })).toBeVisible();
    await expect(panel.getByRole("button", { name: /reserve|stage stock|confirm inventory review|reconcile|override/i })).toHaveCount(0);
    await panel.getByRole("combobox").first().click();
    await page.getByRole("option", { name: /Additional fitting/ }).click();
    await panel.locator(`#plan-qty-${work.id}`).fill("2");
    await panel.getByRole("button", { name: "Add planned item", exact: true }).click();
    await panel.getByRole("button", { name: /^Save/ }).click();
    await expect(panel.getByRole("button", { name: /^Save/ })).toBeDisabled();
    data = await request("GET", `${root}/work-orders/${work.id}/inventory`, undefined, planner);
    assert.equal(data.plan.lines[0].quantity, 2);
    assert.equal(data.allocation, null);
    const originalLine = data.plan.lines[0];
    const denied = async (action, payload) => {
      const response = await planner.request.post(`${root}/inventory/commands`, {
        data: { operationId: crypto.randomUUID(), action, data: payload },
      });
      assert.equal(response.status(), 403, await response.text());
    };
    await denied("assign", { workOrderId: work.id, revision: 0, lines: [] });
    await denied("plan", { workOrderId: work.id, revision: data.plan.revision,
      lines: [originalLine, { id: crypto.randomUUID(), itemId: "simple-fitting", quantity: 0, kind: "override", reason: "Unauthorized automatic override" }] });
    await denied("plan", { workOrderId: unrelated.id, revision: 0, lines: [originalLine] });
    const stale = await planner.request.post(`${root}/inventory/commands`, { data: {
      operationId: crypto.randomUUID(), action: "plan", data: { workOrderId: work.id, revision: 0, lines: [] },
    } });
    assert.equal(stale.status(), 409);
    // Normal role-management grant exposes reservations but not overrides.
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: [...rolePermissions, "inventory.view", "inventory.reserve"] });
    data = await request("GET", `${root}/work-orders/${work.id}/inventory`, undefined, planner);
    assert.equal(data.capabilities.canReserve, true);
    assert.equal(data.capabilities.canOverridePlan, false);
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: rolePermissions });
    await expect(panel.getByRole("button", { name: /reserve|stage stock|confirm inventory review|reconcile|override/i })).toHaveCount(0);
    await fs.mkdir("generated-artifacts/inventory-work-order-panel", { recursive: true });
    for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `generated-artifacts/inventory-work-order-panel/${viewport.width}.jpg` });
    }
    await request("PUT", `/api/subroles/${role.id}/permissions`, { permissions: rolePermissions.filter(key => key !== "inventory.plan") });
    await denied("plan", { workOrderId: work.id, revision: data.plan.revision, lines: [] });
    data = await request("GET", `${root}/work-orders/${work.id}/inventory`, undefined, planner);
    assert.equal(data.capabilities.canPlan, false);
    console.log("PASS normal-role planning without warehouse access, hidden advanced UI, saved additions, no reservations, pricing boundaries, conflicts, unauthorized overrides/orders, permission grant/revocation and responsive layouts.");
  } finally {
    await planner.close(); await admin.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
