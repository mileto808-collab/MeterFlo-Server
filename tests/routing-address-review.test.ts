import test from "node:test";
import assert from "node:assert/strict";
import { addressMatchReasons, createAddressReview, manualAddressFields, readAddressConfirmation } from "../server/routing/addressReview";
import { routingService } from "../server/routing/providers";
import type { GeocodedPoint } from "../shared/workOrderRouting";

const expected = { address: "123 N. Main St.", city: "Denver", state: "CO", zip: "80202-1234" };
const matched: GeocodedPoint = { lat: 39.7, lng: -104.9, addressMatch: {
  formatted: "123 North Main Street, Denver, Colorado 80202",
  houseNumber: "123", street: "North Main Street", city: "Denver", state: "Colorado", postcode: "80202",
} };
const secret = "synthetic-test-only-signing-material";
const scope = "synthetic-user-project-request-fingerprint";
const summary = { id: "stop-1", kind: "stop" as const, workOrderId: 1, label: "Test order",
  submittedAddress: "123 N. Main St., Denver, CO 80202", point: { lat: matched.lat, lng: matched.lng } };

test("normal street abbreviations, casing, punctuation, unit labels and state/ZIP aliases do not require review", () => {
  assert.deepEqual(addressMatchReasons(expected, matched), []);
  assert.deepEqual(addressMatchReasons({ ...expected, address: "123 n main street Apt 4" }, matched), []);
  assert.deepEqual(manualAddressFields("123 N Main St, Denver, CO 80202, USA"),
    { address: "123 N Main St", city: "Denver", state: "CO", zip: "80202" });
});

test("changed numbered roads, house numbers, locality, region and postal code require review", () => {
  assert.ok(addressMatchReasons({ address: "123 County Road 112.9 S" }, {
    ...matched, addressMatch: { ...matched.addressMatch!, street: "County Road 9 South" },
  }).some(reason => reason.includes("road number")));
  for (const [field, value] of [["houseNumber", "124"], ["city", "Boulder"], ["state", "California"], ["postcode", "99999"]]) {
    assert.ok(addressMatchReasons(expected, { ...matched, addressMatch: { ...matched.addressMatch!, [field]: value } }).length);
  }
  assert.ok(addressMatchReasons(expected, { lat: 39.7, lng: -104.9 }).length, "Missing provider metadata fails closed");
  assert.ok(addressMatchReasons({ address: "123 北京路" }, {
    ...matched, addressMatch: { formatted: "123 上海路", houseNumber: "123", street: "上海路" },
  }).length, "Distinct non-Latin street names must not normalize to the same empty string");
});

test("confirmation is scoped, signed, expiring and tied to the exact address and coordinates", () => {
  const wrong = { ...matched, addressMatch: { ...matched.addressMatch!, street: "Other Street" } };
  const first = createAddressReview(summary, expected, wrong, scope, [], 1000, secret);
  assert.ok(first.pending);
  assert.equal(first.confirmed, undefined);
  const token = first.pending.token;
  assert.ok(readAddressConfirmation(token, scope, 2000, secret));
  assert.equal(readAddressConfirmation(token, "another-user-project-or-request", 2000, secret), null);
  assert.equal(readAddressConfirmation(token, scope, 2000, "different-signing-material"), null);
  assert.equal(readAddressConfirmation(token, scope, 601000, secret), null);
  const [payload, signature] = token.split(".");
  assert.equal(readAddressConfirmation(`${payload}x.${signature}`, scope, 2000, secret), null);
  assert.equal(readAddressConfirmation("malformed", scope, 2000, secret), null);
  const accepted = createAddressReview(summary, expected, wrong, scope, [token], 2000, secret);
  assert.ok(accepted.confirmed);
  assert.equal(accepted.pending, undefined);
  assert.equal("token" in accepted.confirmed, false, "Tokens are not persisted with the saved route");
  assert.ok(createAddressReview({ ...summary, point: { lat: 40, lng: -104.9 } }, expected,
    { ...wrong, lat: 40 }, scope, [token], 2000, secret).pending, "Changed coordinates require review again");
  assert.ok(createAddressReview(summary, { ...expected, address: "123 Another Street" }, wrong,
    "changed-work-order-fingerprint", [token], 2000, secret).pending);
});

test("Geoapify high-confidence wrong-street metadata is retained for review", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ results: [{
    lat: 39.7, lon: -104.9, formatted: "123 County Road 9 South, Colorado",
    housenumber: "123", street: "County Road 9 South", state: "Colorado", state_code: "CO",
    postcode: "80202", rank: { confidence: 1, match_type: "full_match" }, result_type: "building",
  }] });
  try {
    const result = await routingService("geoapify", "synthetic-provider-placeholder").geocode("123 County Road 112.9 S");
    assert.equal(result.addressMatch?.street, "County Road 9 South");
    assert.ok(addressMatchReasons({ address: "123 County Road 112.9 S" }, result).length);
  } finally { globalThis.fetch = original; }
});

test("Google structured address components support matching and mismatch review", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ status: "OK", results: [{
    formatted_address: matched.addressMatch!.formatted,
    geometry: { location: { lat: matched.lat, lng: matched.lng }, location_type: "ROOFTOP" },
    address_components: [
      { types: ["street_number"], long_name: "123" }, { types: ["route"], long_name: "North Main Street" },
      { types: ["locality"], long_name: "Denver" }, { types: ["administrative_area_level_1"], long_name: "Colorado", short_name: "CO" },
      { types: ["postal_code"], long_name: "80202" },
    ],
  }] });
  try {
    const result = await routingService("google", "synthetic-provider-placeholder").geocode(summary.submittedAddress);
    assert.deepEqual(addressMatchReasons(expected, result), []);
    assert.ok(addressMatchReasons({ ...expected, address: "123 Other Street" }, result).length);
  } finally { globalThis.fetch = original; }
});
