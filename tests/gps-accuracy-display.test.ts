import test from "node:test";
import assert from "node:assert/strict";
import { capturedGpsAccuracyLabel, gpsFixDto, type GpsFix } from "../shared/gps-capture";

const fix = (changes: Partial<GpsFix> = {}): GpsFix => ({
  coordinates: "41.432,-81.731", source: "native", receiver: "external",
  accuracy: 2.5, capturedAt: "2026-10-20T12:00:00Z", ...changes,
});
test("web and mobile capture DTOs display their recorded accuracy in metres", () => {
  for (const source of ["native","browser"] as const) {
    const dto = gpsFixDto({new_gps:"41.432,-81.731",gps_source:source,gps_accuracy:"2.5",gps_receiver:"external"});
    assert.equal(capturedGpsAccuracyLabel("41.4320, -81.7310",dto.gpsCapture),"±2.5 m");
  }
});
test("missing, invalid, or unrelated accuracy stays hidden", () => {
  for (const accuracy of [null,NaN,Infinity,-1]) {
    assert.equal(capturedGpsAccuracyLabel(fix().coordinates,fix({accuracy})),null);
  }
  assert.equal(capturedGpsAccuracyLabel(fix().coordinates,null),null);
  assert.equal(capturedGpsAccuracyLabel("40,-80",fix()),null);
  assert.equal(capturedGpsAccuracyLabel(null,fix()),null);
});
test("old GPS reuse and non-capture coordinates never invent device accuracy", () => {
  for (const source of ["manual","existing","geocode","reused_old"] as const)
    assert.equal(capturedGpsAccuracyLabel(fix().coordinates,fix({source})),null);
});
test("zero and sub-metre reported accuracy remain displayable", () => {
  assert.equal(capturedGpsAccuracyLabel(fix().coordinates,fix({accuracy:0})),"±0 m");
  assert.equal(capturedGpsAccuracyLabel(fix().coordinates,fix({accuracy:0.0000001})),"±0.0000001 m");
});
