// Runs inside the owned workspace sandbox; provider responses are synthetic.
// API acceptance uses the real database and production authorization functions.
const { chromium, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const baseURL = require("./support/workspace-ui-base.cjs")();

(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Run through tests/support/project-workspace-sandbox.mjs");
  for (const suite of ["work-order-routing-api", "technician-routing-api", "routing-address-review-api"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--import", "tsx", "--test", `tests/${suite}.test.ts`], { stdio: "inherit", env: process.env });
      child.once("error", reject);
      child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${suite} failed (${code})`)));
    });
  }
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const out = "generated-artifacts/routing-dispatch";
  await fs.mkdir(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const manager = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
  const technician = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  try {
    const root = `/api/projects/${fixture.projectId}`, routing = `${root}/routing`;
    assert.equal((await manager.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const roles = await (await manager.request.get("/api/subroles")).json();
    const field = roles.find(role => role.key === "field_technician");
    assert.ok(field);
    const permissions = ["dashboard.view", "projects.view", "workOrders.view", "workOrders.optimizeRoute"];
    assert.equal((await manager.request.put(`/api/subroles/${field.id}`, { data: { ...field, permissions } })).status(), 200);
    assert.equal((await manager.request.patch(`/api/users/${fixture.viewer.id}/subrole`, { data: { subroleId: field.id } })).status(), 200);
    assert.equal((await technician.request.post("/api/auth/local/login", { data: fixture.viewer })).status(), 200);
    const service = (await (await manager.request.get("/api/service-types")).json())[0].code;
    assert.equal((await manager.request.post(`${root}/work-orders`, { data: {
      customerWoId: "ROUTE-DISPATCH-PHONE", status: "Scheduled", serviceType: service,
      address: "Fixture service address", assignedUserId: fixture.viewer.id,
    } })).status(), 201);
    const orders = await (await technician.request.get(`${root}/work-orders`)).json();
    const order = orders.find(order => order.status === "Scheduled" && order.assignedUserId === fixture.viewer.id);
    assert.ok(order);
    const planId = "c78b4e4c-c599-49ea-a760-d4d365b01e37";
    const route = {
      dispatchPlanId: planId, assignmentRoutingVersion: 1, addressReviewVersion: 1,
      assigneeId: fixture.viewer.id, assigneeName: "Assigned field technician",
      scopeIds: [order.id], projectId: fixture.projectId, provider: "geoapify",
      configurationRevision: "c".repeat(64), fingerprint: "a".repeat(64),
      createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600000).toISOString(),
      departureAt: new Date().toISOString(), origin: { lat: 40, lng: -105 },
      originAddress: "Manual warehouse address", geometry: [{ lat: 40, lng: -105 }, { lat: 40.1, lng: -105.1 }],
      serviceMinutes: 30, toleranceMinutes: 60, totalTravelSeconds: 60, totalTravelMeters: 1000,
      excluded: [], warnings: ["Appointment-first priority. Driving times are estimates."],
      confirmedAddressMatches: [{
        id: `stop-${order.id}`, kind: "stop", workOrderId: order.id, label: "Reviewed service address",
        submittedAddress: order.address, resolvedAddress: "Fixture reviewed service address",
        point: { lat: 40.1, lng: -105.1 }, reasons: ["Street differed; reviewed by dispatch"],
      }],
      stops: [{
        id: order.id, label: "Technician stop", address: order.address, point: { lat: 40.1, lng: -105.1 },
        scheduledAt: null, appointmentWindowStart: null, appointmentWindowEnd: null, appointmentSource: "none",
        serviceDurationMinutes: 30, durationSource: "route", waitingMinutes: 0, priority: 0, subStatus: "Critical",
        arrivalAt: new Date().toISOString(), serviceAt: new Date().toISOString(), departureAt: new Date().toISOString(),
        lateMinutes: 0, travelSeconds: 60, travelMeters: 1000,
      }],
    };
    let sent = false, stale = false, validations = 0;
    const readiness = {
      configuration: { mode: "override", provider: "geoapify", maxStops: 20, dailyPlans: 50 },
      effective: { provider: "geoapify", source: "project", maxStops: 20, dailyPlans: 50 },
      ready: true, mapReady: false, revision: route.configurationRevision, canManage: true,
    };
    for (const context of [manager, technician]) {
      await context.route(`**${routing}/**`, async request => {
        const path = new URL(request.request().url()).pathname;
        const json = body => request.fulfill({ json: body, headers: { "Cache-Control": "no-store" } });
        if (path.endsWith("/settings")) return json(readiness);
        if (path.endsWith("/map-config")) return request.fulfill({ status: 503, json: { message: "Fixture map disabled" } });
        if (path.endsWith("/validate")) {
          validations++;
          if (context === technician) assert.equal(request.request().postDataJSON().receivedDispatchId, planId);
          return json({ stale });
        }
        if (path.endsWith("/dispatch")) {
          assert.equal(context, manager);
          assert.deepEqual(request.request().postDataJSON(), { planId });
          sent = true;
          return json({ id: planId, expiresAt: route.expiresAt });
        }
        if (path.endsWith("/dispatched")) return json(context === technician && sent ? [{
          id: planId, departureAt: route.departureAt, expiresAt: route.expiresAt,
          stopCount: 1, originAddress: route.originAddress,
        }] : []);
        if (path.endsWith(`/dispatched/${planId}/open`)) return json({
          ...route, receivedDispatchId: planId, routes: [{ ...route, receivedDispatchId: planId }],
        });
        if (path.endsWith("/plan")) return json({ ...route, routes: [route] });
        return request.continue();
      });
    }
    const managerPage = await manager.newPage();
    await managerPage.goto(`/projects/${fixture.projectId}/work-orders`);
    await managerPage.getByTestId("optimize-work-order-route").click();
    await managerPage.getByTestId("route-manual-origin").fill("Manual warehouse address");
    // Limit the mock response to the explicitly selected one-order planning scope.
    await managerPage.route(`**${routing}/plan`, async request => {
      const input = request.request().postDataJSON();
      const planned = { ...route, scopeIds: input.ids };
      await request.fulfill({ json: { ...planned, routes: [planned] } });
    });
    await managerPage.getByTestId("create-route-plan").click();
    await expect(managerPage.getByTestId("dispatch-current-route")).toBeEnabled();
    await managerPage.getByTestId("dispatch-current-route").click();
    await expect(managerPage.getByTestId("dispatch-message")).toContainText("Sent to");
    assert.equal(sent, true);
    const techPage = await technician.newPage();
    await techPage.goto(`/projects/${fixture.projectId}/work-orders`);
    await techPage.getByTestId("button-toggle-mobile-tools").click();
    await techPage.getByTestId("optimize-work-order-route").click();
    await expect(techPage.getByTestId("dispatched-routes")).toContainText("1 stops");
    await techPage.getByTestId(`open-dispatched-${planId}`).click();
    await expect(techPage.getByTestId("routing-technician-select")).toHaveValue(fixture.viewer.id);
    assert.equal(await techPage.getByTestId("routing-technician-select").locator("option").count(), 1);
    await expect(techPage.getByTestId("dispatch-current-route")).toHaveCount(0);
    await expect(techPage.getByTestId("confirmed-address-matches")).toBeVisible();
    await expect(techPage.getByTestId("navigate-next-stop")).toBeEnabled();
    await techPage.getByTestId("route-mode-list").click();
    await techPage.screenshot({ path: `${out}/technician-phone.jpg`, fullPage: true });
    assert.ok(await techPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await techPage.reload();
    await expect(techPage.getByTestId("navigate-next-stop")).toBeEnabled();
    stale = true;
    const before = validations;
    await techPage.getByTestId("navigate-next-stop").click();
    await expect(techPage.getByTestId("navigate-next-stop")).toBeDisabled();
    assert.ok(validations > before, "Navigation performs fresh server validation");
    await expect(techPage.getByText("Navigation stopped because the route is no longer current or access could not be verified.")).toBeVisible();
    console.log("Dispatch browser acceptance passed: explicit send, own-route inbox, activation, phone layout, recovery and stale-navigation block.");
  } finally {
    await manager.close(); await technician.close(); await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
