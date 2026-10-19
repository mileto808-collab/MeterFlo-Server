const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium, expect } = require("@playwright/test");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const admin = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const viewer = await browser.newContext({ baseURL, viewport: { width: 390, height: 900 } });
  const root = `/api/projects/${fixture.projectId}`;
  const api = async (method, url, data, context = admin, expected) => {
    const response = await context.request.fetch(url, { method, data });
    assert.equal(response.status(), expected ?? (method === "POST" ? response.status() : 200),
      `${method} ${url}: ${response.status()} ${await response.text()}`);
    if (expected && expected >= 400) return response;
    assert.ok(response.ok(), `${method} ${url}: ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => api("POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data });
  try {
    await api("POST", "/api/auth/local/login", fixture);
    await api("PATCH", root, { inventoryEnabled: true, changeoutEquipmentType: "system" });
    const service = (await api("GET", "/api/service-types"))[0];
    const type = (await api("GET", "/api/system-types"))[0];
    await api("PUT", `${root}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", `/api/system-types/${type.id}`, { projectIds: [...new Set([...(type.projectIds ?? []), fixture.projectId])] });
    await command("warehouse", { id: "main", code: "MAIN", name: "Main warehouse", type: "physical", address: "Test only" });
    for (const item of [
      { id: "part", sku: "PART", name: "Linked system", equipment: "system" },
      { id: "labor", sku: "LAB", name: "Install labor", kind: "labor", unit: "job" },
      { id: "kit", sku: "KIT", name: "Planned kit", components: [{ itemId: "part", quantity: 1 }, { itemId: "labor", quantity: 1 }] },
      { id: "private", sku: "PRIVATE", name: "Unrelated stock item" },
    ]) await command("item", { tracking: "regular", cost: 12, billingRate: 20, ...item });
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: "kit" });
    const roles = await api("GET", "/api/subroles");
    const role = roles.find(r => r.key === "field_technician") ?? await api("POST", "/api/subroles",
      { key: "field_technician", label: "Field technician", baseRole: "user" });
    await api("PUT", `/api/subroles/${role.id}/permissions`, { permissions: [
      "workOrders.view", "projects.view", "project.workOrders", "nav.dashboard",
    ] });
    await api("PATCH", `/api/users/${fixture.viewer.id}/subrole`, { subroleId: role.id });
    const makeWork = assignedUserId => api("POST", `${root}/work-orders`, {
      customerWoId: `inventory-read-${crypto.randomUUID()}`, customerName: "Owned test",
      serviceType: service.code, status: "Open", oldSystemId: `OLD-${crypto.randomUUID()}`, oldSystemReading: "1",
      newSystemType: type.productId, assignedUserId,
    });
    const own = await makeWork(fixture.viewer.id);
    const other = await makeWork(fixture.id);
    await api("POST", "/api/auth/local/login", fixture.viewer, viewer);
    const snapshot = await api("GET", `${root}/work-orders/${own.id}/inventory`, undefined, viewer);
    assert.equal(snapshot.canManageInventory, false);
    assert.equal(snapshot.canSelect, false);
    assert.deepEqual(snapshot.items.map(i => i.id).sort(), ["kit", "labor", "part"]);
    assert.ok(snapshot.items.every(i => !("cost" in i) && !("billingRate" in i)));
    assert.deepEqual(snapshot.warehouses, []);
    await api("GET", `${root}/work-orders/${other.id}/inventory`, undefined, viewer, 403);
    await api("GET", `${root}/inventory`, undefined, viewer, 403);
    await api("POST", `${root}/inventory/commands`, {
      operationId: crypto.randomUUID(), action: "assign", data: { workOrderId: own.id, lines: [] },
    }, viewer, 403);
    fs.mkdirSync("generated-artifacts/inventory-panel", { recursive: true });
    for (const [context, width, name] of [[viewer, 390, "technician"], [admin, 1280, "admin"]]) {
      const page = await context.newPage();
      const errors = [], streams = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("request", request => { if (request.url().endsWith("/inventory/events")) streams.push(request.url()); });
      await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${own.id}`);
      await page.getByTestId("accordion-inventory").click();
      const panel = page.getByTestId("work-order-inventory-panel");
      await expect(panel).toContainText("Planned kit");
      await panel.getByText("View kit components", { exact: true }).click();
      await expect(panel).toContainText("Linked system");
      await expect(panel).toContainText("Install labor");
      await expect(panel.getByText("Inventory", { exact: true })).toHaveCount(0);
      if (name === "technician") {
        await expect(panel.getByRole("button", { name: "Create empty assignment" })).toHaveCount(0);
        await expect(panel.getByTestId("inventory-live-indicator")).toHaveCount(0);
        assert.deepEqual(streams, []);
      } else await expect(panel.getByRole("button", { name: "Create empty assignment" })).toBeVisible();
      const style = await panel.evaluate(el => ({ border: getComputedStyle(el).borderLeftWidth,
        background: getComputedStyle(el).backgroundColor, overflow: el.scrollWidth > el.clientWidth + 1 }));
      assert.equal(style.border, "0px");
      assert.equal(style.background, "rgba(0, 0, 0, 0)");
      assert.equal(style.overflow, false);
      await page.screenshot({ path: `generated-artifacts/inventory-panel/${name}-${width}.jpg`, fullPage: true });
      if (name === "admin") {
        await page.goto("/settings?section=access-levels");
        await expect(page.getByText("Define access levels (subroles) with specific permissions", { exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: "Add Access Level" })).toBeVisible();
        await expect(page.locator("vite-error-overlay")).toHaveCount(0);
        await page.screenshot({ path: "generated-artifacts/inventory-panel/settings-access-levels.jpg", fullPage: true });
      }
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log("PASS: work-order-only technician reads planned inventory and components; unrelated work orders/catalog/mutations denied; rates hidden; no unauthorized event subscription; seamless technician phone/admin desktop panel; Settings Access Levels renders without browser errors.");
  } finally { await admin.close(); await viewer.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
