import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { randomUUID } from "node:crypto";
import { parseRmc, gpsdCapture } from "../script/gps/providers.mjs";
import { gpsHelperHandler } from "../script/gps/helper-server.mjs";

const sentence = value => `$${value}*${[...value].reduce((sum, char) => sum ^ char.charCodeAt(0), 0).toString(16).toUpperCase().padStart(2, "0")}`;
test("NMEA validates checksum, receiver status, ranges and UTC date; HDOP never becomes accuracy", () => {
  const input = "GPRMC,123519.50,A,4807.038,N,01131.000,E,022.4,084.4,191026,003.1,W,A";
  const result = parseRmc(sentence(input));
  assert.equal(result.capturedAt, "2026-10-19T12:35:19.500Z");
  assert.equal(result.accuracy, null); assert.equal(result.receiver, "external");
  assert.equal(parseRmc(sentence(input).slice(0, -2) + "00"), null);
  assert.equal(parseRmc(sentence(input.replace(",A,", ",V,"))), null);
  assert.equal(parseRmc(sentence(input.replace("4807.038", "9907.038"))), null);
  assert.equal(parseRmc(sentence(input.replace("191026", "310226"))), null);
  assert.equal(parseRmc(sentence(input.slice(0, -1) + "N")), null);
});
test("gpsd waits for fresh valid fix, retains reported eph and closes socket", async () => {
  let connection;
  const server = net.createServer(socket => {
    connection = socket; socket.on("data", () => {
      socket.write(JSON.stringify({ class: "TPV", mode: 3, lat: 1, lon: 2, time: "2000-01-01T00:00:00Z" }) + "\n");
      socket.write(JSON.stringify({ class: "TPV", mode: 3, lat: 41.123456789, lon: -81.987654321, eph: 1.25, time: new Date().toISOString() }) + "\n");
    });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const result = await gpsdCapture(AbortSignal.timeout(2000), server.address().port);
    assert.equal(result.accuracy, 1.25); assert.equal(result.coordinates, "41.123456789, -81.987654321");
    assert.equal(result.receiver, "unknown");
  } finally { connection?.destroy(); await new Promise(resolve => server.close(resolve)); }
});
test("helper authenticates exact origin/key, rejects replay and correlates responses", async () => {
  const origin = "https://gps.example", token = "a".repeat(64);
  let captures = 0;
  // HTTP is used only to test the handler in isolation. Shipping CLI is HTTPS-only.
  const server = http.createServer(gpsHelperHandler({ origins: [origin], token, provider: "fixture",
    capture: async () => { captures++; return { coordinates: "1,2", source: "native", receiver: "unknown", accuracy: 1, capturedAt: new Date().toISOString() }; } }));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Origin: origin, Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const request = { version: 1, id: randomUUID(), origin, startedAt: Date.now(), timeoutMs: 1000 };
  try {
    assert.equal((await fetch(base + "/status", { headers: { Origin: "https://evil.example", Authorization: headers.Authorization } })).status, 403);
    assert.equal((await fetch(base + "/status", { headers: { Origin: origin } })).status, 401);
    assert.equal(captures, 0);
    const response = await fetch(base + "/capture", { method: "POST", headers, body: JSON.stringify(request) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.id, request.id); assert.equal(result.origin, origin); assert.equal(captures, 1);
    assert.equal((await fetch(base + "/capture", { method: "POST", headers, body: JSON.stringify(request) })).status, 400);
    assert.equal((await fetch(base + "/capture", { method: "POST", headers,
      body: JSON.stringify({ ...request, id: randomUUID(), origin: "https://evil.example" }) })).status, 400);
    const options = await fetch(base + "/capture", { method: "OPTIONS", headers: { Origin: origin } });
    assert.equal(options.status, 204); assert.equal(options.headers.get("access-control-allow-origin"), origin);
    assert.equal(options.headers.get("access-control-allow-private-network"), "true");
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});
