import test from "node:test";
import assert from "node:assert/strict";
import { reusedOldGpsFix, applyOldGpsReuse, gpsSubmissionProblem, validateGpsFix, gpsFixDto } from "../shared/gps-capture";

test("Reuse old GPS is opt-in and only accepts valid old coordinates", () => {
  assert.equal(reusedOldGpsFix({}, { oldGps: "41,-81" }), null);
  for (const oldGps of [null, undefined, "", "bad", "91,0", "0,181", "NaN,1"])
    assert.equal(reusedOldGpsFix({ wizardReuseOldGps: true }, { oldGps }), null);
  const fix = reusedOldGpsFix({ wizardReuseOldGps: true }, { oldGps: " 0, 0 " })!;
  assert.deepEqual(fix, { coordinates: "0, 0", source: "reused_old", accuracy: null, capturedAt: null, receiver: "unknown" });
  assert.deepEqual(validateGpsFix(fix, "0,0"), fix);
  assert.throws(() => validateGpsFix({ ...fix, accuracy: 1 }, "0,0"), /fresh/);
  assert.throws(() => validateGpsFix({ ...fix, capturedAt: new Date().toISOString() }, "0,0"), /fresh/);
});
test("server-owned reuse overrides submitted new GPS and cannot bypass another project's policy", () => {
  const policy = { wizardReuseOldGps: true, wizardGpsMode: "manual_step", wizardGpsMaxAccuracyMetres: 1 };
  const previous = { oldGps: "41,-81", newGps: "20,30" };
  const body: any = { gpsCoordinates: "client supplied invalid", gpsCapture: { source: "browser" } };
  const fix = applyOldGpsReuse(policy, previous, body)!;
  assert.equal(body.gpsCoordinates, previous.oldGps);
  assert.equal(body.gpsCapture, fix);
  assert.equal(gpsSubmissionProblem(policy, body.gpsCoordinates, body.gpsCapture, previous), null);
  assert.equal(gpsSubmissionProblem({ ...policy, wizardGpsMode: "disabled" }, body.gpsCoordinates, fix, previous), null);
  assert.equal(gpsSubmissionProblem({ ...policy, wizardReuseOldGps: false }, body.gpsCoordinates, fix, previous)?.code, "GPS_CAPTURE");
  assert.equal(gpsSubmissionProblem({ ...policy, wizardReuseOldGps: false, wizardGpsMode: "disabled" }, body.gpsCoordinates, fix, previous)?.code, "GPS_CAPTURE");
  assert.equal(gpsSubmissionProblem(policy, "42,-82", { ...fix, coordinates: "42,-82" }, previous)?.code, "GPS_CAPTURE");
  const missing = { oldGps: null };
  assert.equal(gpsSubmissionProblem(policy, "41,-81", null, missing)?.code, "GPS_ACCURACY");
  const dto = gpsFixDto({ new_gps: "41,-81", gps_source: "reused_old" }).gpsCapture;
  assert.equal(dto?.source, "reused_old"); assert.equal(dto?.capturedAt, null); assert.equal(dto?.accuracy, null);
});
