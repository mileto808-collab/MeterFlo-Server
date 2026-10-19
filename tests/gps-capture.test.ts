import test from "node:test";
import assert from "node:assert/strict";
import { coordinateText, gpsAccuracyError, parseCoordinates, validateGpsFix, gpsFixDto, gpsMetadataUpdate, gpsSubmissionProblem, completionGpsFix } from "../shared/gps-capture";
import { acquireGps, nativeGps, browserGps } from "../client/src/lib/gps-acquisition";
import { validatePairing } from "../client/src/lib/gps-native-bridge";

const origin = "https://gps.example";
Object.defineProperty(globalThis, "window", { value: { location: { origin } }, configurable: true });
Object.defineProperty(globalThis, "localStorage", { value: { getItem: () => null }, configurable: true });
const fix = (changes = {}) => ({ coordinates: "41.4412345678901, -81.7245123456789", source: "native" as const,
  receiver: "external" as const, accuracy: 2.5, capturedAt: new Date().toISOString(), ...changes });
function geo(position?: any, error?: any) {
  const calls = { started: 0, cleared: 0, options: null as any };
  const provider = {
    watchPosition(success: any, failure: any, options: any) {
      calls.started++; calls.options = options;
      queueMicrotask(() => {
        if (position) success({ coords: { latitude: 41.4412345678901, longitude: -81.7245123456789,
          accuracy: 4, ...position }, timestamp: Date.now() });
        if (error) failure(error);
      });
      return 7;
    },
    clearWatch(id: number) { assert.equal(id, 7); calls.cleared++; },
  } as unknown as Geolocation;
  Object.defineProperty(globalThis, "navigator", { value: { geolocation: provider }, configurable: true });
  return { calls, provider };
}
test("accuracy is opt-in and saved/manual/address coordinates never satisfy it", () => {
  assert.equal(gpsAccuracyError(null, null), null);
  assert.equal(gpsAccuracyError(fix(), 3), null);
  for (const source of ["existing", "manual", "geocode"] as const)
    assert.match(gpsAccuracyError(fix({ source, accuracy: null, capturedAt: null }), 10)!, /captured location/i);
  assert.ok(gpsAccuracyError(fix({ accuracy: null }), 10));
  assert.ok(gpsAccuracyError(fix({ accuracy: 11 }), 10));
  assert.ok(gpsAccuracyError(null, 10));
});
test("provenance must match the submitted coordinates, time and actual source", () => {
  assert.throws(() => validateGpsFix(fix(), "0,0"), /match|coordinates/i);
  assert.throws(() => validateGpsFix(fix({ source: "manual" }), fix().coordinates));
  assert.throws(() => validateGpsFix(fix({ source: "browser" }), fix().coordinates));
  assert.throws(() => validateGpsFix(fix({ capturedAt: new Date(Date.now() + 120000).toISOString() }), fix().coordinates));
  assert.throws(() => validateGpsFix(fix({ capturedAt: null }), fix().coordinates));
  assert.deepEqual(validateGpsFix(fix(), fix().coordinates)?.coordinates, fix().coordinates);
  assert.equal(parseCoordinates("91,0"), null);
  assert.equal(coordinateText(0.000000123456789), "0.000000123456789");
  assert.equal(coordinateText(-81.7245123456789), "-81.7245123456789");
});
test("web/mobile submission policy keeps default and disabled captures optional", () => {
  assert.equal(gpsSubmissionProblem({ wizardGpsMode: "automatic" }, "", null), null);
  assert.equal(gpsSubmissionProblem({ wizardGpsMode: "disabled", wizardGpsMaxAccuracyMetres: 5 }, "", null), null);
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, fix().coordinates, fix()), null);
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 1 }, fix().coordinates, fix())?.code, "GPS_ACCURACY");
  assert.equal(gpsSubmissionProblem({}, "0,0", fix())?.code, "GPS_CAPTURE");
});
test("native fix wins without touching browser; precision and hardware identity retained", async () => {
  const { calls } = geo({});
  window.meterfloGps = { version: 1, origin, capture: async request => ({ ...request, fix: fix() }) };
  assert.equal((await acquireGps(new AbortController().signal)).source, "native");
  assert.equal(calls.started, 0);
  assert.equal((await acquireGps(new AbortController().signal)).coordinates, fix().coordinates);
});
test("native rejects untrusted, stale or mismatched responses then browser falls back", async () => {
  for (const response of [
    (request: any) => ({ ...request, id: "wrong", fix: fix() }),
    (request: any) => ({ ...request, origin: "https://other.example", fix: fix() }),
    (request: any) => ({ ...request, fix: fix({ capturedAt: new Date(Date.now() - 120000).toISOString() }) }),
    (request: any) => ({ ...request, fix: fix({ source: "browser", receiver: "unknown" }) }),
  ]) {
    const { calls } = geo({});
    window.meterfloGps = { version: 1, origin, capture: async request => response(request) };
    const result = await acquireGps(new AbortController().signal);
    assert.equal(result.source, "browser"); assert.equal(result.receiver, "unknown");
    assert.equal(result.coordinates, fix().coordinates);
    assert.equal(calls.started, 1); assert.equal(calls.cleared, 1);
    assert.equal(calls.options.enableHighAccuracy, true); assert.equal(calls.options.maximumAge, 0);
  }
});
test("no helper/device works through browser; browser permission failure does not reuse saved/address data", async () => {
  delete window.meterfloGps; geo({});
  assert.equal((await acquireGps(new AbortController().signal)).source, "browser");
  geo(undefined, { code: 1 });
  await assert.rejects(acquireGps(new AbortController().signal), /permission|denied|unavailable/i);
});
test("accuracy fallback chooses better reported fix, not merely a different source", async () => {
  window.meterfloGps = { version: 1, origin, capture: async request => ({ ...request, fix: fix({ accuracy: 50 }) }) };
  geo({ accuracy: 4 });
  assert.equal((await acquireGps(new AbortController().signal, 10)).source, "browser");
  geo({ accuracy: 70 }, { code: 3 });
  const result = await acquireGps(new AbortController().signal, 10);
  assert.equal(result.source, "native"); assert.equal(result.accuracy, 50);
  assert.ok(gpsAccuracyError(result, 10));
});
test("aborting native ignores late data; aborting browser releases its watcher", async () => {
  const controller = new AbortController();
  let respond: any, cancelled = 0;
  const bridge: any = { version: 1, origin, capture: (request: any) => new Promise(resolve => {
    respond = () => resolve({ ...request, fix: fix() });
  }), cancel: () => cancelled++ };
  const promise = nativeGps(controller.signal, bridge);
  controller.abort(); respond();
  assert.equal(await promise, null); assert.equal(cancelled, 1);
  const second = new AbortController(), { calls, provider } = geo();
  const browser = browserGps(second.signal, undefined, provider);
  second.abort();
  await assert.rejects(browser, /cancel/i);
  assert.equal(calls.cleared, 1);
});
test("desktop pairing accepts only private HTTPS loopback and never remote/query credentials", () => {
  const token = "a".repeat(64);
  assert.equal(validatePairing({ url: "https://localhost:47764/", token }).url, "https://localhost:47764");
  for (const url of ["http://localhost:47764/", "https://example.com/", "https://localhost.evil.test/",
    "https://localhost:47764/?key=test", "https://user:password@localhost:47764/", "https://localhost:47764/capture"])
    assert.throws(() => validatePairing({ url, token }));
});
test("relational DTO does not invent provenance for historic coordinates", () => {
  assert.equal(gpsFixDto({ new_gps: "1,2" }).gpsCapture, null);
  const dto = gpsFixDto({ new_gps: fix().coordinates, gps_source: "native", gps_receiver: "external",
    gps_accuracy: "2.5", gps_captured_at: new Date() }).gpsCapture!;
  assert.equal(dto.source, "native"); assert.equal(dto.accuracy, 2.5);
  assert.ok(dto.capturedAt?.endsWith("Z"));
});
test("ordinary edits retain provenance; changed/manual positions cannot retain old accuracy", () => {
  const previous = { new_gps: "41.123456789, -81.123456789" };
  assert.equal(gpsMetadataUpdate(previous, {}).write, false);
  assert.equal(gpsMetadataUpdate(previous, { newGps: previous.new_gps, gpsCapture: null }).write, false);
  assert.equal(gpsMetadataUpdate(previous, { newGps: "41.1234567890,-81.1234567890" }).write, false);
  const changed = gpsMetadataUpdate(previous, { newGps: "42,-82" });
  assert.equal(changed.write, true); assert.equal(changed.fix, null);
  assert.equal(gpsMetadataUpdate(previous, { newGps: null }).write, true);
  assert.throws(() => gpsMetadataUpdate(previous, { newGps: "42,-82", gpsCapture: fix() }));
});
test("completion can use actual stored capture evidence, but cannot borrow it for different coordinates", () => {
  const capture = fix({ capturedAt: new Date(Date.now() - 86400000).toISOString() });
  const previous = { newGps: capture.coordinates, gpsCapture: capture };
  assert.equal(completionGpsFix(undefined, undefined, previous)?.capturedAt, capture.capturedAt);
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, undefined, undefined, previous), null);
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, previous.newGps, null, previous), null);
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, "42,-82", undefined, previous)?.code, "GPS_ACCURACY");
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, undefined, undefined,
    { newGps: capture.coordinates, gpsCapture: null })?.code, "GPS_ACCURACY");
  assert.equal(gpsSubmissionProblem({ wizardGpsMaxAccuracyMetres: 5 }, capture.coordinates,
    { ...capture, source: "manual", receiver: "unknown", accuracy: null, capturedAt: null }, previous)?.code, "GPS_ACCURACY");
});
