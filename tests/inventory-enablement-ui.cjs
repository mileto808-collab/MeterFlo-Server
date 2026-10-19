// Disposable authenticated acceptance: disabling is a pause, not cancellation.
const { chromium, expect } = require("@playwright/test");
const { Pool } = require("pg");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
// Real, tiny PNG fixture rather than a corrupt image-shaped base64 string.
function signaturePng() {
  const chunk = (type, data) => {
    const bytes = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
    length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, bytes, checksum]);
  };
  return "data:image/png;base64," + Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"),
    chunk("IHDR", Buffer.from("00000001000000010806000000", "hex")),
    chunk("IDAT", require("node:zlib").deflateSync(Buffer.from([0, 0, 0, 0, 255]))), chunk("IEND", Buffer.alloc(0))]).toString("base64");
}
(async () => {
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  const member = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const root = `/api/projects/${fixture.projectId}`;
  const api = async (context, method, path, data, status = 200) => {
    const response = await context.request.fetch(path, { method, data });
    assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
    return response.json();
  };
  const request = (method, path, data, status) => api(admin, method, path, data, status);
  const command = (action, data, status) => request("POST", `${root}/inventory/commands`, { operationId: randomUUID(), action, data }, status);
  const snapshot = () => request("GET", `${root}/inventory`);
  const ledger = async () => (await pool.query("SELECT count(*)::int AS count FROM public.inventory_movements WHERE project_id=$1", [fixture.projectId])).rows[0].count;
  let lock;
  try {
    await request("POST", "/api/auth/local/login", fixture);
    await api(member, "POST", "/api/auth/local/login", fixture.viewer);
    await request("PUT", `/api/subroles/${fixture.viewerRoleId}/permissions`, {
      permissions: ["nav.projects", "projects.view", "projects.edit", "project.workOrders", "workOrders.view", "inventory.view", "inventory.configure"],
    });
    await request("PATCH", root, { changeoutEquipmentType: "system" });
    await command("warehouse", { id: "pause-main", code: "PAUSE", name: "Pause warehouse", type: "physical", address: "Fixture only" });
    await command("vendor", { id: "pause-vendor", name: "Pause supplier" });
    await command("item", { id: "pause-meter", sku: "PAUSE-M", name: "Pause meter", tracking: "serialized", equipment: "system" });
    const lines = [{ itemId: "pause-meter", quantity: 3 }];
    await command("order", { id: "pause-receipt", type: "purchase", vendorId: "pause-vendor", destinationId: "pause-main", lines });
    await command("release", { orderId: "pause-receipt" });
    await command("receive", { orderId: "pause-receipt", lines: [{ ...lines[0], serials: ["PAUSE-1", "PAUSE-2", "PAUSE-3"] }] });
    await command("order", { id: "pause-open-order", type: "purchase", vendorId: "pause-vendor", destinationId: "pause-main", lines });
    const service = (await request("GET", "/api/service-types"))[0].code;
    const work = await request("POST", `${root}/work-orders`, {
      customerWoId: `PAUSE-${Date.now()}`, customerId: "PAUSE", customerName: "Pause fixture", address: "Fixture only",
      serviceType: service, status: "Open", assignedUserId: fixture.id, oldSystemId: "PAUSE-OLD", oldSystemReading: "1",
    }, 201);
    await command("assign", { workOrderId: work.id, lines: [{ itemId: "pause-meter", warehouseId: "pause-main", quantity: 1, serials: ["PAUSE-1"] }] });
    await command("countStart", { id: "pause-count", warehouseId: "pause-main" });
    const before = (await snapshot()).state, beforeLedger = await ledger();
    assert.ok(before.allocations.some(a => a.status === "reserved" && a.lines.length));
    assert.ok(before.orders.some(o => o.id === "pause-open-order"));
    assert.ok(before.counts.some(c => c.status === "open"));
    await api(member, "PATCH", root, { inventoryEnabled: false }, 403);
    await request("PATCH", root, { inventoryEnabled: "false" }, 400);
    const page = await admin.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(page.getByTestId("switch-inventory-enabled")).toHaveAttribute("aria-checked", "true");
    await expect(page.getByTestId("inventory-toggle-preservation-note")).toContainText("Existing reservations remain reserved");
    await page.getByTestId("switch-inventory-enabled").click();
    // An in-flight work-order transaction holding inventory custody must finish
    // before the flag changes. The toggle must not drop that serialization lock.
    lock = await pool.connect();
    await lock.query("BEGIN");
    const pid = (await lock.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await lock.query("SELECT project_id FROM public.inventory_state WHERE project_id=$1 FOR UPDATE", [fixture.projectId]);
    const saving = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(root));
    await page.getByTestId("button-submit").click();
    await expect.poll(async () => (await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid))) AS waiting", [pid])).rows[0].waiting).toBe(true);
    assert.equal((await request("GET", root)).inventoryEnabled, true);
    await lock.query("COMMIT"); lock.release(); lock = null;
    const saved = await saving;
    assert.equal(saved.status(), 200, await saved.text());
    assert.equal((await request("GET", root)).inventoryEnabled, false);
    const paused = await snapshot();
    assert.equal(paused.enabled, false);
    assert.deepEqual(paused.state, before);
    const blocked = await admin.request.post(`${root}/inventory/commands`, { data: {
      operationId: randomUUID(), action: "countStart", data: { id: "blocked-count", warehouseId: "pause-main" },
    } });
    assert.ok([403, 409].includes(blocked.status()));
    assert.match((await blocked.json()).message, /inventory.*disabled/i);
    await api(member, "PATCH", root, { inventoryEnabled: true }, 403);
    await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${work.id}`);
    await expect(page.getByTestId("accordion-system")).toBeVisible();
    await expect(page.getByTestId("accordion-inventory")).toHaveCount(0);
    await request("PATCH", `${root}/work-orders/${work.id}`, { status: "Completed", newSystemId: "OFF-PERIOD", newSystemReading: "2",
      newGps: "40,-105", signatureData: signaturePng(), signatureName: "Pause fixture" });
    assert.deepEqual((await snapshot()).state, before);
    assert.equal(await ledger(), beforeLedger);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await expect(page.getByTestId("switch-inventory-enabled")).toHaveAttribute("aria-checked", "false");
    await page.getByTestId("switch-inventory-enabled").click();
    const enabling = page.waitForResponse(r => r.request().method() === "PATCH" && r.url().endsWith(root));
    await page.getByTestId("button-submit").click();
    assert.equal((await enabling).status(), 200);
    assert.equal((await request("GET", root)).inventoryEnabled, true);
    assert.deepEqual((await snapshot()).state, before, "No retroactive consumption, cancellation, or reservation release");
    assert.equal(await ledger(), beforeLedger);
    await page.goto(`/projects/${fixture.projectId}/work-orders?edit=${work.id}`);
    await expect(page.getByTestId("accordion-inventory")).toBeVisible();
    // Verify useful backend errors are visible instead of a generic save failure.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/projects/${fixture.projectId}/edit`);
    await page.getByRole("tab", { name: "Inventory", exact: true }).click();
    await page.route(`**${root}`, route => route.request().method() === "PATCH"
      ? route.fulfill({ status: 403, json: { message: "Inventory configuration permission required (acceptance fixture)." } }) : route.continue());
    await page.getByTestId("switch-inventory-enabled").click();
    await page.getByTestId("button-submit").click();
    await expect(page.getByText("Inventory configuration permission required (acceptance fixture).", { exact: true })).toBeVisible();
    assert.equal((await request("GET", root)).inventoryEnabled, true);
    fs.mkdirSync("generated-artifacts/inventory-enablement", { recursive: true });
    await page.screenshot({ path: "generated-artifacts/inventory-enablement/phone.jpg", fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log("PASS: desktop disable/phone enable with pending work; stock, serials, reservations, counts, orders and ledger preserved; off-period completion; permissions; root-lock serialization; visible save errors.");
  } finally {
    if (lock) { await lock.query("ROLLBACK"); lock.release(); }
    await pool.end(); await member.close(); await admin.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
