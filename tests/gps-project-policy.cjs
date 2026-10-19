// Real authenticated create/reload/complete regression against an OWNED temporary
// PostgreSQL instance. Run only through project-workspace-sandbox.mjs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { request } = require("@playwright/test");
(async () => {
  if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Owned disposable workspace required.");
  const config = JSON.parse(fs.readFileSync(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const baseURL = require("./support/workspace-ui-base.cjs")();
  const fixture = JSON.parse(fs.readFileSync("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const api = await request.newContext({ baseURL });
  const owned = [];
  async function json(method, url, data, expected = 200) {
    const res = await api.fetch(url, { method, data });
    const text = await res.text();
    const body = text ? JSON.parse(text) : null;
    assert.equal(res.status(), expected, `${method} ${url}: ${JSON.stringify(body)}`);
    return body;
  }
  try {
    await json("POST", "/api/auth/local/login", fixture);
    const serviceType = (await json("GET", "/api/service-types"))[0].code;
    const coordinates = "41.4412345678901, -81.7245123456789";
    const fix = { coordinates, source: "browser", receiver: "unknown", accuracy: 2,
      capturedAt: new Date(Date.now() - 86400000).toISOString() };
    for (const scenario of [
      { name: "normal-create", wizardGpsMode: "manual_step", wizardGpsMaxAccuracyMetres: 3 },
      { name: "customer-push-create", wizardGpsMode: "automatic", wizardGpsMaxAccuracyMetres: 3, customerApiEnabled: false },
      { name: "disabled", wizardGpsMode: "disabled", wizardGpsMaxAccuracyMetres: 3 },
      { name: "default-optional", wizardGpsMode: "automatic" },
    ]) {
      const project = await json("POST", "/api/projects", { ...scenario, name: `GPS policy ${scenario.name} ${randomUUID()}` }, 201);
      owned.push(project.id);
      const root = `/api/projects/${project.id}`;
      const reloaded = await json("GET", root);
      assert.equal(reloaded.wizardGpsMode, scenario.wizardGpsMode, "Creation must retain the selected GPS mode");
      assert.equal(reloaded.wizardGpsMaxAccuracyMetres, scenario.wizardGpsMaxAccuracyMetres ?? null,
        "Creation and a fresh reload must retain the accuracy requirement in BOTH branches");
      // Only unrelated photo/signature flags are updated after creation. Never
      // patch GPS settings here: that would conceal a broken creation branch.
      await json("PATCH", root, { wizardShowSignatureStep: false, wizardShowBeforePhotosStep: false, wizardShowAfterPhotosStep: false });
      assert.equal((await json("GET", root)).wizardGpsMaxAccuracyMetres, scenario.wizardGpsMaxAccuracyMetres ?? null);
      const make = (extra = {}) => json("POST", root + "/work-orders", {
        customerWoId: `GPS-${randomUUID()}`, customerName: "Owned GPS policy fixture", address: "Fixture only",
        serviceType, status: "Open", oldSystemId: `OLD-${randomUUID()}`, newSystemId: `NEW-${randomUUID()}`, oldSystemReading: "1",
        newSystemReading: "0", ...extra,
      }, 201);
      const required = scenario.wizardGpsMode !== "disabled" && scenario.wizardGpsMaxAccuracyMetres != null;
      const unproven = await make({ newGps: coordinates });
      const denied = await json("PATCH", `${root}/work-orders/${unproven.id}`, { status: "Completed" }, required ? 400 : 200);
      if (required) {
        assert.equal(denied.code, "GPS_ACCURACY");
        assert.equal((await json("GET", `${root}/work-orders/${unproven.id}`)).status, "Open");
      }
      const captured = await make({ newGps: coordinates, gpsCapture: fix });
      const saved = await json("GET", `${root}/work-orders/${captured.id}`);
      assert.equal(saved.gpsCapture.accuracy, 2);
      assert.equal(saved.gpsCapture.capturedAt, fix.capturedAt);
      if (required) {
        await json("PATCH", `${root}/work-orders/${captured.id}`, { status: "Completed", newGps: "42,-82" }, 400);
        const unchanged = await json("GET", `${root}/work-orders/${captured.id}`);
        assert.equal(unchanged.new_gps, coordinates); assert.equal(unchanged.status, "Open");
        for (const accuracy of [null, 20]) {
          const coarse = await make({ newGps: coordinates, gpsCapture: { ...fix, accuracy } });
          await json("PATCH", `${root}/work-orders/${coarse.id}`, { status: "Completed" }, 400);
        }
      }
      // Omit gpsCapture AND coordinates. Valid capture evidence already belongs
      // to this order; completion must preserve, not invent or drop, that proof.
      await json("PATCH", `${root}/work-orders/${captured.id}`, { status: "Completed" });
      const complete = await json("GET", `${root}/work-orders/${captured.id}`);
      assert.equal(complete.status, "Completed");
      assert.equal(complete.gpsCapture.capturedAt, fix.capturedAt);
      assert.equal(complete.gpsCapture.accuracy, 2);
      if (!required) {
        const withoutGps = await make();
        await json("PATCH", `${root}/work-orders/${withoutGps.id}`, { status: "Completed" });
        assert.equal((await json("GET", `${root}/work-orders/${withoutGps.id}`)).gpsCapture, null);
      }
      console.log(`GPS create/reload/enforcement passed: ${scenario.name}`);
    }
  } finally {
    for (const id of owned.reverse()) await json("DELETE", `/api/projects/${id}`, undefined, 204);
    await api.dispose();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
