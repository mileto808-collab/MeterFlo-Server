// Reproduces late equipment mapping with real imports in an owned database only.
const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  const root = `/api/projects/${fixture.projectId}`, inventory = `${root}/inventory`;
  const api = async (method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => api("POST", `${inventory}/commands`, { operationId: crypto.randomUUID(), action, data });
  try {
    await api("POST", "/api/auth/local/login", fixture);
    const service = (await api("GET", "/api/service-types"))[0];
    const type = (await api("GET", "/api/system-types"))[0];
    await api("PUT", `${root}/service-types`, { serviceTypeIds: [service.id] });
    await api("PATCH", root, { changeoutEquipmentType: "system" });
    await api("PATCH", `/api/system-types/${type.id}`, { projectIds: [...new Set([...(type.projectIds || []), fixture.projectId])] });
    const group = await api("POST", "/api/user-groups", { name: `Late-link crew ${crypto.randomUUID().slice(0, 8)}`, projectIds: [fixture.projectId] });
    await command("item", { id: "late-meter", sku: "LATE-METER", name: "Late-linked meter", equipment: "system", tracking: "regular" });
    const imported = await api("POST", `${root}/import`, { fileName: "late-link-reproduction.json", importSource: "manual_file",
      workOrders: ["WITH-GROUP", "NO-GROUP"].map(label => ({
        customerWoId: `LATE-${label}`, customerName: "Late mapping test", serviceType: service.code,
        status: "Open", newSystemType: type.productId, ...(label === "WITH-GROUP" ? { assignedGroupId: group.name } : {}),
      })) });
    assert.equal(imported.imported, 2, JSON.stringify(imported));
    const before = await api("GET", `${inventory}/fulfillment`);
    assert.equal(before.orders.length, 2);
    assert.ok(before.orders.every(row => row.missing.length === 1 && row.lines.length === 0));
    console.log("BEFORE LINK:", JSON.stringify(before.orders.map(({ label, group, eligible, missing, lines }) => ({ label, group, eligible, missing, lines }))));
    const page = await context.newPage();
    const launch = async () => {
      await page.getByRole("button", { name: "Start Inventory", exact: true }).filter({ visible: true }).click();
      await page.getByRole("button", { name: /Fulfill \/ Stage Work Orders/ }).click();
    };
    await page.goto(`/projects/${fixture.projectId}/inventory`);
    await launch();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Save & leave", exact: true }).click();
    await command("typeLink", { equipment: "system", typeId: type.id, itemId: "late-meter" });
    const after = await api("GET", `${inventory}/fulfillment`);
    assert.deepEqual(after.orders.map(row => row.workOrderId), before.orders.map(row => row.workOrderId));
    assert.ok(after.orders.every(row => row.missing.length === 0 && row.lines.length === 1));
    console.log("AFTER LINK:", JSON.stringify(after.orders.map(({ label, group, eligible, missing, lines }) => ({ label, group, eligible, missing, lines }))));
    for (const row of after.orders) {
      const detail = await api("GET", `${root}/work-orders/${row.workOrderId}/inventory`);
      assert.equal(detail.requirements.missing.length, 0);
      assert.equal(detail.requirements.lines.length, 1);
    }
    await launch();
    await expect.poll(async () => {
      const labels = await page.getByRole("dialog").locator("label").allTextContents();
      return labels.some(text => text.includes("LATE-WITH-GROUP") && text.includes("Eligible"));
    }, { timeout: 10000 }).toBe(true);
    console.log("BROWSER: Previously opened wizard refreshed after the link; grouped imported order is eligible without reimport.");
    assert.equal(after.orders.find(row => row.label === "LATE-WITH-GROUP").eligible, true);
    assert.equal(after.orders.find(row => row.label === "LATE-NO-GROUP").eligible, false);
    console.log("UNASSIGNED: Mapping repaired demand but intentionally did not assign the Open work order to a crew.");
    const unassigned = after.orders.find(row => row.label === "LATE-NO-GROUP");
    await api("POST", `${root}/work-orders/bulk-assign`, {
      workOrderIds: [unassigned.workOrderId], action: "assign", assigneeType: "group", assigneeId: `group:${group.id}`,
    });
    const repaired = await api("GET", `${inventory}/fulfillment`);
    assert.deepEqual(repaired.orders.map(row => row.workOrderId), before.orders.map(row => row.workOrderId));
    assert.ok(repaired.orders.every(row => row.eligible && !row.missing.length && row.lines.length === 1));
    console.log("BULK ASSIGNMENT: Both original imported orders are now eligible; no deletion, reimport, reservation or stock movement.");
    await fs.mkdir("generated-artifacts/late-type-link", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/late-type-link/after-link.png" });
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
