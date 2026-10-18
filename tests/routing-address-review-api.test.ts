import "dotenv/config";
// This suite shares the disposable fixture with the routing API acceptance
// suite, which exercises backup/restore. Run the two suites sequentially.
import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { readFile } from "node:fs/promises";
import { pool } from "../server/db";
import { getProjectWorkOrderStorage } from "../server/projectDb";
import { registerRoutingRoutes } from "../server/routing/routes";
import { enableAuditing, serviceAuditContext, withAuditContext } from "../server/auditContext";
import type { RoutingService } from "../server/routing/providers";

test("server withholds driving routes until every exact origin/stop match is confirmed", async t => {
  t.after(() => pool.end());
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  enableAuditing();
  await withAuditContext(serviceAuditContext("address-review-acceptance"), async () => {
    const wo = getProjectWorkOrderStorage(fixture.schema);
    const orders = await wo.getWorkOrders();
    const target = orders.find(order => order.status === "Scheduled" && !!order.address?.trim() && !!order.assignedUserId)!;
    assert.ok(target, "Run work-order-routing-api.test.ts first to seed an address-based Scheduled stop");
    const originalNow = Date.now.bind(Date);
    let offset = 0, changedPoint = false, revision = "a".repeat(64), roads = 0;
    t.mock.method(Date, "now", () => originalNow() + offset);
    const provider: RoutingService = {
      geocode: async address => ({
        lat: changedPoint ? 40.01 : 40, lng: -105,
        addressMatch: { formatted: `Different street for ${address}`, street: "Different Street", houseNumber: "999",
          city: "Other City", state: "CO", postcode: "99999" },
      }),
      matrix: async points => { roads++; return points.map(() => points.map(() => ({ seconds: 60, meters: 1000 }))); },
      geometry: async points => { roads++; return points; },
    };
    const configuration = { mode: "override" as const, provider: "geoapify" as const,
      serverKeyEnv: "", browserKeyEnv: "", maxStops: 20, dailyPlans: 50 };
    const app = express(); app.use(express.json());
    app.use((req: any, _res, next) => {
      req.isAuthenticated = () => true;
      req.user = { claims: { sub: fixture.id }, expires_at: Math.floor(Date.now() / 1000) + 1000 };
      next();
    });
    registerRoutingRoutes(app, {
      effectiveRouting: async () => ({ result: { configuration, effective: { ...configuration, source: "project" as const },
        ready: true, mapReady: false, disabled: false, canManage: true, revision, message: "Fixture provider" },
        effective: configuration, serverKey: "synthetic-provider-placeholder", browserKey: "" }),
      routingService: () => provider, consumeRoutingQuota: async () => {},
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>(resolve => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api/projects/${fixture.projectId}/routing/plan`;
    const input = { ids: [target.id], origin: { address: "123 Main St, Denver, CO 80202" },
      departureAt: new Date().toISOString(), serviceMinutes: 30, toleranceMinutes: 60 };
    const post = async (body: unknown, advance = true) => {
      if (advance) offset += 11000;
      const response = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    };
    try {
      const first = await post(input);
      assert.equal(first.status, 409);
      assert.equal(first.body.code, "ADDRESS_REVIEW_REQUIRED");
      assert.equal(first.body.addressReviews.length, 2, "Manual origin and destination both need review");
      assert.equal(roads, 0, "No matrix or route is calculated before review");
      assert.equal(first.body.geometry, undefined);
      const tokens = first.body.addressReviews.map((review: any) => review.token);
      assert.equal((await post({ ...input, addressConfirmations: ["forged.token"] })).status, 409);
      assert.equal((await post({ ...input, addressConfirmations: tokens, serviceMinutes: 31 })).status, 409,
        "Confirmation cannot be transferred to another planning request");
      changedPoint = true;
      assert.equal((await post({ ...input, addressConfirmations: tokens })).status, 409, "Changed provider coordinates require review again");
      changedPoint = false;
      revision = "b".repeat(64);
      assert.equal((await post({ ...input, addressConfirmations: tokens })).status, 409, "Changed provider configuration requires review again");
      const refreshed = await post(input);
      const freshTokens = refreshed.body.addressReviews.map((review: any) => review.token);
      const accepted = await post({ ...input, addressConfirmations: freshTokens }, false);
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      assert.equal(accepted.body.addressReviewVersion, 1);
      assert.equal(accepted.body.confirmedAddressMatches.length, 2);
      assert.equal(roads, 2);
      for (const token of freshTokens) assert.equal(JSON.stringify(accepted.body).includes(token), false);
      assert.equal((await post({ ...input, addressConfirmations: freshTokens }, false)).status, 429,
        "Signed continuation does not remove replay throttling");
      offset += 11 * 60_000;
      assert.equal((await post({ ...input, addressConfirmations: freshTokens })).status, 409, "Expired confirmations cannot activate a route");
      assert.deepEqual(await wo.getWorkOrders(), orders, "Review never edits work orders or GPS history");
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});
