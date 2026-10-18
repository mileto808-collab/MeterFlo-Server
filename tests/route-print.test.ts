import test from "node:test";
import assert from "node:assert/strict";
import { writeRoutePrintDocument } from "../client/src/components/work-order-routing/route-print";
import type { RoutingResult } from "../shared/workOrderRouting";

function route(assigneeId: string, assigneeName: string): RoutingResult {
  const timestamp = "2026-10-18T08:00:00Z";
  return {
    assignmentRoutingVersion: 1, addressReviewVersion: 1, assigneeId, assigneeName,
    originAddress: "Main warehouse", origin: { lat: 40, lng: -105 }, scopeIds: [1, 2],
    projectId: 1, provider: "geoapify", configurationRevision: "a".repeat(64), fingerprint: "b".repeat(64),
    createdAt: timestamp, expiresAt: timestamp, departureAt: timestamp,
    stops: [1, 2].map(id => ({ id, label: `${assigneeId}-STOP-${id}`,
      address: id === 1 ? '<img src=x onerror="bad()"> service address' : "Second service address",
      point: { lat: 40, lng: -105 }, scheduledAt: timestamp, arrivalAt: timestamp, serviceAt: timestamp,
      departureAt: timestamp, serviceDurationMinutes: 30, durationSource: "project" as const,
      appointmentWindowStart: null, appointmentWindowEnd: null, appointmentSource: "scheduled" as const,
      waitingMinutes: 0, priority: 0, subStatus: "Critical", lateMinutes: 0, travelSeconds: 60, travelMeters: 1000 })),
    warnings: ["Travel estimate only"], excluded: [{ id: 3, label: `${assigneeId}-EXCLUDED`, reason: "Missing address" }],
    geometry: [], totalTravelSeconds: 120, totalTravelMeters: 2000, serviceMinutes: 30, toleranceMinutes: 60,
  };
}

test("print complete ordered routes separately, escaping text and keeping technician exceptions separate", () => {
  let html = "";
  const popup = { document: { open() {}, write(value: string) { html += value; }, close() {} } } as unknown as Window;
  const first = route("tech-a", "Technician <A>"), second = route("tech-b", "Technician B");
  writeRoutePrintDocument(popup, [first, second], ["Global caution"], [
    { id: 9, label: "UNASSIGNED-DISPATCH-ONLY", reason: "Needs assignment" },
  ], "America/Denver", '</title><script>bad()</script>');
  assert.equal((html.match(/<article class="route-page">/g) ?? []).length, 2);
  assert.match(html, /break-before:page;page-break-before:always/);
  assert.match(html, /Main warehouse/);
  assert.match(html, /Technician &lt;A&gt;/);
  assert.match(html, /&lt;img/);
  assert.doesNotMatch(html, /<script>|<img /);
  assert.ok(html.indexOf("tech-a-STOP-1") < html.indexOf("tech-a-STOP-2"));
  const firstPage = html.slice(html.indexOf('<article class="route-page">'), html.indexOf("</article>"));
  assert.match(firstPage, /tech-a-EXCLUDED/);
  assert.doesNotMatch(firstPage, /tech-b-STOP|tech-b-EXCLUDED|UNASSIGNED-DISPATCH-ONLY/);
  assert.match(html, /30/);
  assert.match(html, /Critical/);
});
