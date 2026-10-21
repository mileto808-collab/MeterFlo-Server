const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const context = await browser.newContext({ baseURL });
  const root = `/api/projects/${fixture.projectId}`;
  const request = async (method, url, data) => {
    const response = await context.request.fetch(url, { method, data });
    assert.ok(response.ok(), `${method} ${url}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => request("POST", `${root}/inventory/commands`, { operationId: crypto.randomUUID(), action, data });
  try {
    await request("POST", "/api/auth/local/login", fixture);
    const services = await request("GET", "/api/service-types");
    const location = crypto.randomUUID(), item = crypto.randomUUID();
    await command("warehouse", { id: location, code: "HIST-WH", name: "History warehouse", type: "physical", address: "100 Test Road" });
    await command("item", { id: item, sku: "HIST-METER", name: "Readable replacement meter", tracking: "regular" });
    const work = await request("POST", `${root}/work-orders`, { customerWoId: "0002048-HISTORY",
      customerName: "History customer", status: "Open", serviceType: services[0].code });
    await command("plan", { workOrderId: work.id, revision: 0, lines: [
      { id: crypto.randomUUID(), itemId: item, kind: "addition", quantity: 1, reason: "History fixture demand" }] });
    await request("PATCH", `${root}/work-orders/${work.id}`, { notes: "Readable lifecycle history check." });
    const completed = { status: "Completed",
      oldSystemId: "HISTORY-OLD-SERIAL", newSystemId: "HISTORY-NEW-SERIAL", oldSystemReading: 1, newSystemReading: 0,
      signatureName: "History fixture", signatureData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=" };
    await request("PATCH", `${root}/work-orders/${work.id}`, completed);
    const secondWork = await request("POST", `${root}/work-orders`, { customerWoId: "OTHER-CUSTOMER-WO",
      customerName: "Other history customer", status: "Open", serviceType: services[0].code });
    await request("PATCH", `${root}/work-orders/${secondWork.id}`, { ...completed,
      oldSystemId: "HISTORY-OTHER-OLD", newSystemId: "HISTORY-OTHER-NEW" });
    await request("POST", `${root}/work-orders/bulk-status`, { workOrderIds: [secondWork.id, work.id], status: "Closed" });
    const url = `${root}/work-order-history?workOrderId=${work.id}`;
    const history = await request("GET", url);
    assert.ok(history.groups.length);
    assert.ok(history.groups.every(group => group.workOrderReference === "Work order 0002048-HISTORY"));
    assert.ok(history.groups.some(group => group.events.some(e => e.entityReference === "Work order OTHER-CUSTOMER-WO")),
      "A matching batch operation retains all related events while its focused label remains the requested customer order.");
    const inventoryEvents = history.groups.flatMap(g => g.events).filter(e => e.entityType === "inventory");
    assert.ok(inventoryEvents.length, "Actual inventory lifecycle events must be included.");
    assert.ok(history.groups.every(g => /^Operation/.test(g.operationReference)));
    assert.ok(inventoryEvents.some(e => JSON.stringify(e.displayChanges).includes("HIST-METER")), "Inventory references must be named.");
    assert.ok(inventoryEvents.some(e => JSON.stringify(e.changes).includes(item)), "Raw UUID evidence is retained.");
    const printResponse = await context.request.get(`${url}&format=print`);
    assert.equal(printResponse.status(), 200);
    const html = await printResponse.text();
    assert.match(html, /0002048-HISTORY/);
    assert.doesNotMatch(html, /<pre>|inventory\.WorkOrderCompleted/);
    assert.doesNotMatch(html, /[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}/i, "Default print must not expose internal UUIDs.");
    assert.ok(!html.includes(item));
    const rawBefore = JSON.stringify(history.groups.flatMap(g => g.events).map(e => [e.id, e.changes, e.metadata]));
    const second = await request("GET", url);
    assert.equal(JSON.stringify(second.groups.flatMap(g => g.events).map(e => [e.id, e.changes, e.metadata])), rawBefore);
    const page = await context.newPage();
    await page.goto(`${url}&format=print`);
    await expect(page.getByRole("button", { name: "Print / Save PDF" })).toBeVisible();
    await expect(page.locator("body")).toContainText("Readable replacement meter");
    await fs.mkdir("generated-artifacts/work-order-history", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/work-order-history/print.png" });
    const role = await request("POST", "/api/subroles", { key: `hist_${crypto.randomUUID().slice(0, 8)}`,
      label: "History viewer", baseRole: "user", permissions: ["workOrders.view", "audit.view"] });
    const credentials = { username: `hist-${crypto.randomUUID().slice(0, 8)}`, password: `Aa1!${crypto.randomUUID()}` };
    await request("POST", "/api/users", { ...credentials, role: "user", subroleId: role.id, projectIds: [fixture.projectId] });
    await request("POST", "/api/auth/local/login", credentials);
    await page.goto(`/projects/${fixture.projectId}/work-orders`);
    await page.getByTestId("button-work-order-history").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByText("Work order 0002048-HISTORY", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText(/Operation #/).first()).toBeVisible();
    await page.screenshot({ path: "generated-artifacts/work-order-history/dialog.png" });
    const visible = await dialog.innerText();
    assert.ok(!visible.includes(item));
    assert.doesNotMatch(visible, /inventory\.WorkOrderCompleted/);
    console.log("PASS project-scoped readable lifecycle actions, customer WO identity, named inventory, unchanged raw evidence, readable print and authorized history dialog.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
