import test from "node:test";
import assert from "node:assert/strict";
import { mobileSubmissionFingerprint as fingerprint, mobileSubmissionIdentity, submissionBody,
  validateSubmissionMedia } from "../shared/mobile-submission-contract";
import { mobileSubmissionContext, mobileSubmissionMediaName } from "../server/mobileSubmissionContext";
import { randomUUID } from "node:crypto";

test("submission identity requires a UUID and an exact nonnegative assignment version", () => {
  assert.equal(mobileSubmissionIdentity.safeParse({ changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: 0 }).success, true);
  for (const version of [undefined, -1, 0.5, "0"])
    assert.equal(mobileSubmissionIdentity.safeParse({ changeoutSubmissionId: randomUUID(), changeoutAssignmentVersion: version }).success, false);
});

test("direct and queued aliases bind the same immutable payload without transport timestamps", () => {
  const direct = { oldModuleRead: "00003.001200", notes: "same capture", inventoryUsage: { used: [] } };
  const queued = { id: 12, clientUpdatedAt: "earlier", forceOverwrite: true,
    inventory_usage: '{"used":[]}', notes: "same capture", old_module_reading: "00003.001200" };
  assert.equal(fingerprint(direct, "complete", 2), fingerprint(queued, "complete", 2));
  assert.notEqual(fingerprint(direct, "complete", 2), fingerprint({ ...direct, oldModuleRead: "3.0012" }, "complete", 2));
  assert.notEqual(fingerprint(direct, "complete", 2), fingerprint(direct, "trouble", 2));
  assert.notEqual(fingerprint(direct, "complete", 2), fingerprint(direct, "complete", 3));
  assert.throws(() => fingerprint({ oldModuleRead: "01", old_module_reading: "02" }, "complete", 1));
});

test("multipart bytes and metadata are bound, not just file names", () => {
  const file = { fieldname: "photos", mimetype: "image/png", buffer: Buffer.from("original") };
  assert.notEqual(fingerprint({}, "complete", 0, [file]),
    fingerprint({}, "complete", 0, [{ ...file, buffer: Buffer.from("changed") }]));
  assert.deepEqual(submissionBody({ body: { data: '{"notes":"capture"}', photoTypes: '["before"]' } }),
    { notes: "capture", photoTypes: '["before"]' });
  assert.throws(() => submissionBody({ body: { data: '{"notes":"capture"}', notes: "other" } }));
});

test("media is explicit: unsupported fields, device URI placeholders and corrupt base64 are rejected", () => {
  const bytes = Buffer.from("bytes").toString("base64");
  validateSubmissionMedia({ beforePhotos: [{ base64: bytes }], signatureData: bytes }, "complete");
  validateSubmissionMedia({ photos: [{ base64: bytes }] }, "trouble");
  for (const input of [{ beforePhotos: [{ uri: "file://capture.jpg" }] }, { beforePhotos: "file://capture.jpg" },
    { photos: [{ base64: bytes }] }, { beforePhotos: [{ base64: "not valid bytes!!" }] }])
    assert.throws(() => validateSubmissionMedia(input, "complete"));
  assert.throws(() => validateSubmissionMedia({ signatureData: bytes }, "trouble"));
  assert.throws(() => validateSubmissionMedia({ beforePhotos: [{ base64: bytes }] }, "auto"));
  assert.throws(() => validateSubmissionMedia({ photoTypes: ["../elsewhere"] }, "auto"));
  assert.throws(() => validateSubmissionMedia({ photoTypes: [".."] }, "auto"));
});

test("media file names are retry-stable only inside the matching submission context", () => {
  assert.equal(mobileSubmissionMediaName("before", 0, ".jpg", "legacy.jpg"), "legacy.jpg");
  const id = randomUUID();
  mobileSubmissionContext.run({ id, assignmentVersion: 1, fingerprint: "bound", projectId: 1,
    workOrderId: 2, actorId: "owner", kind: "complete" }, () => {
    assert.equal(mobileSubmissionMediaName("before", 0, ".jpg", "first.jpg"),
      mobileSubmissionMediaName("before", 0, ".jpg", "retry.jpg"));
    assert.notEqual(mobileSubmissionMediaName("before", 0, ".jpg", ""), mobileSubmissionMediaName("after", 0, ".jpg", ""));
  });
});
