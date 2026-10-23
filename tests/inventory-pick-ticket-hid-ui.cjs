const { chromium, expect } = require("@playwright/test");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned sandbox required.");
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const admin = await browser.newContext({ baseURL });
  const inventory = `/api/projects/${fixture.projectId}/inventory`;
  const request = async (context, method, path, data) => {
    const response = await context.request.fetch(path, { method, data });
    assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
    return response.json();
  };
  const command = (action, data) => request(admin, "POST", `${inventory}/commands`, { action, data, operationId: randomUUID() });
  const errors = [];
  try {
    await request(admin, "POST", "/api/auth/local/login", fixture);
    const actor = await request(admin, "GET", "/api/auth/user");
    for (const id of ["hid-source", "hid-stage", "hid-vehicle"]) await command("warehouse", {
      id, name: id, code: id, type: id === "hid-vehicle" ? "vehicle" : "physical", address: "Owned fixture",
      ...(id === "hid-stage" ? { locationTypeId: "57e15eca-f991-4328-a091-000000000003" } : {}),
      ...(id === "hid-vehicle" ? { vin: "1HGCM82633A004352", plate: "HID", plateState: "CO", userIds: [actor.id] } : {}),
    });
    await command("item", { id: "hid-meter", sku: "HID-METER", name: "HID meter", tracking: "serialized" });
    await command("vendor", { id: "hid-vendor", name: "HID vendor" });
    await command("order", { id: "hid-po", type: "purchase", vendorId: "hid-vendor", destinationId: "hid-source",
      lines: [{ itemId: "hid-meter", quantity: 2 }] });
    await command("release", { orderId: "hid-po" });
    await command("receive", { orderId: "hid-po", lines: [{ itemId: "hid-meter", quantity: 2, serials: ["HID-001", "HID-002"] }] });
    const services = await request(admin, "GET", "/api/service-types");
    const group = await request(admin, "POST", "/api/user-groups", { name: "HID crew", projectIds: [fixture.projectId] });
    const work = await request(admin, "POST", `/api/projects/${fixture.projectId}/work-orders`, {
      customerWoId: "HID-WORK", customerName: "HID test", serviceType: services[0].code,
      status: "Open", assignedGroupId: group.name,
    });
    await command("plan", { workOrderId: work.id, revision: 0,
      lines: [{ id: randomUUID(), itemId: "hid-meter", kind: "addition", quantity: 2, reason: "Owned scanner fixture" }] });
    const candidate = (await request(admin, "GET", `${inventory}/fulfillment`)).orders.find(row => row.workOrderId === work.id);
    const batchId = randomUUID();
    await command("fulfillmentCreate", { id: batchId, name: "HID batch", mode: "crew", sourceId: "hid-source",
      stagingId: "hid-stage", vehicleId: "hid-vehicle",
      workOrders: [{ workOrderId: work.id, assignmentVersion: candidate.assignmentVersion }] });
    const before = (await request(admin, "GET", inventory)).state.revision;
    const ticket = `${baseURL}/projects/${fixture.projectId}/inventory?pickup=${batchId}`;
    await fs.mkdir("generated-artifacts/inventory-pick-ticket-hid", { recursive: true });

    for (const entry of ["inventory", "tasks", "fulfillment", "modal-desktop", "modal-mobile"]) {
      const mobile = entry === "modal-mobile";
      const context = await browser.newContext({ baseURL, ...(mobile
        ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
          userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0.0.0 Mobile Safari/537.36" } : {}) });
      await request(context, "POST", "/api/auth/local/login", fixture);
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`/projects/${fixture.projectId}/inventory`);
      const start = page.getByTestId(`button-start-inventory-${mobile ? "mobile" : "desktop"}`);
      await expect(start).toBeVisible();
      if (entry === "inventory") {
        const search = page.locator('[data-testid="inventory-workspace"] input:visible').first();
        await search.fill("ordinary stock search");
        await search.press("Enter");
        await expect(search).toHaveValue("ordinary stock search");
        await expect(page.getByTestId("inventory-fulfillment-page")).toHaveCount(0);
        await page.getByRole("heading", { name: "Inventory", exact: true }).click();
      } else {
        await start.click();
        await expect(page.getByRole("heading", { name: "Choose an inventory task", exact: true })).toBeVisible();
        if (entry !== "tasks") {
          await page.getByTestId("inventory-task-fulfillment").click();
          await expect(page.getByTestId("fulfillment-start-screen")).toBeVisible();
        }
      }
      if (entry.startsWith("modal")) {
        await page.getByTestId("inventory-pick-ticket-camera").click();
        await expect(page.getByRole("dialog", { name: "Scan or open a pick ticket", exact: true })).toBeVisible();
        await page.getByTestId("inventory-pick-ticket-scanner-mode-trigger").click();
        await page.getByTestId("inventory-pick-ticket-scanner-mode-hid").click();
        await expect(page.getByTestId("inventory-pick-ticket-hid-ready")).toBeVisible();
        assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false);
        await expect(page.getByRole("dialog", { name: "Scan QR Code", exact: true })).toHaveCount(0);
      }
      await page.keyboard.type(ticket, { delay: mobile ? 100 : 1 });
      await page.keyboard.press(mobile ? "Tab" : "Enter");
      await expect(page.getByTestId("fulfillment-batch-identity")).toContainText("HID batch - PICK-");
      await expect(page.getByTestId("fulfillment-batch-identity")).toBeInViewport();
      await expect(page.getByRole("dialog", { name: "Scan or open a pick ticket", exact: true })).toHaveCount(0);
      assert.equal(await page.evaluate(() => document.activeElement.matches("input,textarea")), false);
      await expect.poll(() => page.getByTestId("fulfillment-step-body").evaluate(body => body.scrollTop)).toBe(0);
      await page.screenshot({ path: `generated-artifacts/inventory-pick-ticket-hid/${entry}.png` });
      await context.close();
    }
    assert.equal((await request(admin, "GET", inventory)).state.revision, before, "Opening tickets must not post or reserve stock.");
    assert.deepEqual(errors, []);
    console.log("PASS HID pick-ticket scanning from Inventory, task chooser, fulfillment and desktop/mobile scan modal; Enter/Tab, Bluetooth pacing, no camera/keyboard autofocus, ordinary-input isolation and no stock posting.");
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
