import test from "node:test";
import assert from "node:assert/strict";
import { blankShipmentCapture } from "../shared/inventory-shipment-draft-model";
import { blankShipmentEntry, shipmentCaptureEditFingerprint } from "../client/src/lib/inventory-shipment-guidance";

test("shipment dismissal ignores reverted empty slots without normalizing captured values", () => {
  const clean = blankShipmentCapture();
  const fingerprint = shipmentCaptureEditFingerprint;
  const reverted = { ...clean, entries: { meter: blankShipmentEntry("meter") },
    scanBuffers: { "meter-goodSerials": "", "meter-damagedSerials": "" } };
  assert.equal(fingerprint(reverted), fingerprint(clean));
  assert.notEqual(fingerprint({ ...clean, reason: "Inspect carton" }), fingerprint(clean));
  assert.notEqual(fingerprint({ ...clean, closeRemainder: true }), fingerprint(clean));
  assert.notEqual(fingerprint({ ...reverted, scanBuffers: { "meter-goodSerials": " " } }), fingerprint(clean));
  assert.notEqual(fingerprint({ ...reverted, scanBuffers: { "meter-goodSerials": "0007" } }), fingerprint(clean));
  for (const change of [
    { goodQuantity: "1" }, { damagedQuantity: "1" }, { unreadableQuantity: "1" },
    { goodQuantity: "" }, { goodQuantity: "00" }, { damageReason: "Cracked" },
    { goodSerials: ["0007"] }, { damagedSerials: ["0008"] }, { expectedSerials: ["0009"] },
  ]) {
    assert.notEqual(fingerprint({ ...clean, entries: { meter: { ...blankShipmentEntry("meter"), ...change } } }),
      fingerprint(clean));
  }
  const saved = { ...clean, entries: { meter: { ...blankShipmentEntry("meter"), goodQuantity: "1", goodSerials: ["0007"] } } };
  assert.equal(fingerprint({ ...saved, scanBuffers: { "meter-goodSerials": "" } }), fingerprint(saved));
  assert.notEqual(fingerprint(saved), fingerprint({ ...saved,
    entries: { meter: { ...saved.entries.meter, goodSerials: ["7"] } } }));
});
