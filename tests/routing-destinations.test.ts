import test from "node:test";
import assert from "node:assert/strict";
import { destinationAddress, parseGps, resolveDestination } from "../server/routing/destinations";
import { RoutingError } from "../server/routing/providers";

test("routing geocodes the displayed address instead of stale equipment GPS", async () => {
  const order = {
    address: " 123 Fixture Street ", city: " Fixturetown ", state: " CO ", zip: " 81101 ",
    oldGps: "40.7128,-74.0097", newGps: "40.7128,-74.0098",
  };
  const before = structuredClone(order);
  const calls: string[] = [];
  const point = await resolveDestination(order, { geocode: async address => {
    calls.push(address);
    return { lat: 37.47, lng: -105.87 };
  } });
  assert.deepEqual(calls, ["123 Fixture Street, Fixturetown, CO, 81101"]);
  assert.equal(destinationAddress(order), calls[0]);
  assert.deepEqual(point, { lat: 37.47, lng: -105.87 });
  assert.deepEqual(order, before, "Planning preserves stored historical GPS");
});

test("unresolved addresses and provider failures never fall back to conflicting GPS", async () => {
  for (const error of [new RoutingError(422, "Ambiguous address"), new RoutingError(502, "Provider unavailable")]) {
    await assert.rejects(resolveDestination({
      address: "Unresolved street", oldGps: "40.7128,-74.0097",
    }, { geocode: async () => { throw error; } }), caught => caught === error);
  }
});

test("GPS-only stops retain valid captured coordinates without geocoding a city", async () => {
  const provider = { geocode: async (): Promise<never> => { throw new Error("Unexpected geocoding"); } };
  assert.deepEqual(await resolveDestination({ address: " ", city: "Fixturetown", newGps: "37.4,-105.8", oldGps: "40,-74" }, provider),
    { lat: 37.4, lng: -105.8 });
  assert.deepEqual(await resolveDestination({ newGps: "invalid", oldGps: "37.4;-105.8" }, provider),
    { lat: 37.4, lng: -105.8 });
  await assert.rejects(resolveDestination({ city: "Fixturetown", oldGps: "91,0" }, provider),
    (error: unknown) => error instanceof RoutingError && error.status === 422);
  assert.equal(parseGps("0,181"), null);
});
