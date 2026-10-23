# MeterFlo — implemented mobile completion and retry contract

## Status and compatibility

Server Packages A (reads) and B (completion/retry) are implemented in the development
workspace. They have **not been published**. Read this with `MOBILE_READ_CONTRACT.md`.
This is the implemented server contract, not confirmation of native-device integration.

The inventory-disabled mobile behavior remains the baseline. Existing callers
without `changeoutSubmissionId` continue through the legacy handlers and envelopes.
Do not replace that baseline merely to introduce inventory-enabled screens.

The download response advertises `meta.mobileSubmissionContractVersion: 1`.
Do not enable the new client queue protocol against a server lacking that capability.

## Identity and immutable captures

For a new-protocol submission send both:

```json
{
  "changeoutSubmissionId": "11111111-1111-4111-8111-111111111111",
  "changeoutAssignmentVersion": 3
}
```

These fields supplement, rather than replace, the endpoint's normal captured
readings, equipment, inventory usage, GPS, signature, notes and photographs.

1. Claim eligible work and read its authoritative assignment version.
2. Persist one UUID for the captured attempt and its assignment version locally.
3. Freeze the actual submission payload before attempting delivery. Preserve exact
   reading strings, including leading zeros and fractional trailing zeros.
4. Retry the same UUID, version and capture after a timeout, connection loss,
   process restart or unconfirmed response. Do not regenerate `completedAt`,
   rewrite notes or change photographs on each retry.
5. Do not use an earlier attempt after reassignment, return to group or reopening.
   Preserve its captures for review and explicitly start a fresh authorized attempt.

The server binds accepted requests to actor, project, work order, assignment
version, action and a canonical payload fingerprint. It normalizes supported
root field aliases and ignores transport fields such as batch IDs, sync
timestamps and `forceOverwrite`. Other capture fields and photo bytes remain
bound. Conflicting aliases are rejected.

Do not create a new UUID merely to evade an unknown result or a payload mismatch.
First recover the outcome using the original request.

## Supported transports

### Preferred JSON endpoints

- `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/complete`
- `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/trouble`

Add the identity fields to the normal JSON body.

### Existing multipart changeout endpoint

`POST /api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout`

Include identity/version inside the JSON `data` field, alongside the normal
capture. `canChange` must be a boolean: true means completion; false means
Trouble. Upload photographs using the existing multipart `photos` files.
Keep `photoTypes` in the capture as supported by the existing handler. Avoid
duplicating a field with conflicting JSON/form representations.

When supplied, `isReadingOnly` must also be a boolean, not the string `"false"`.

### Queued/matched batch uploads

`POST /api/projects/:projectId/mobile/sync/upload`

The existing top-level batch response is retained. New-protocol items can use:

```json
{
  "workOrders": [
    {
      "workOrderId": 123,
      "changeType": "complete",
      "data": {
        "changeoutSubmissionId": "11111111-1111-4111-8111-111111111111",
        "changeoutAssignmentVersion": 3,
        "notes": "The original captured report"
      }
    }
  ]
}
```

This illustrates the envelope only: `data` must contain the complete original
capture required by project settings. Use `changeType: "trouble"` for Trouble.
These items execute the same guarded JSON handler as direct submission.
Do not convert multipart captures to a differently shaped JSON request after
an unknown outcome; recover them through their original transport.

Flat legacy-style items with an identity are also recognized when `id` is a
positive integer and `status` identifies Completed/Trouble. Prefer the explicit
envelope for new clients. Legacy flat items without identity remain unchanged.

Every item has its own result. New results include `submissionId`, `workOrderId`,
`httpStatus`, and either the durable `submission` acknowledgement or a failure
code/message. Status is `success`, `conflict` or `error`.

**Never clear a batch queue based only on HTTP 200 or top-level `success`.**
Inspect every item, including conflicts.

## Durable acknowledgement

An accepted direct response retains `success` and `workOrder`, and adds:

```json
{
  "submission": {
    "contractVersion": 1,
    "submissionId": "11111111-1111-4111-8111-111111111111",
    "receiptId": "11111111-1111-4111-8111-111111111111",
    "workOrderId": 123,
    "assignmentVersion": 3,
    "kind": "complete",
    "acceptedAt": "2026-10-22T18:00:00.000Z",
    "fieldStatus": "accepted",
    "reconciliationStatus": "pending",
    "replayed": false,
    "attachmentsConfirmed": true,
    "attachmentScope": "submission"
  }
}
```

`replayed: true` means the server recovered an already committed attempt without
running mutable project validation, writing its photographs or appending its
report notes again. The returned `workOrder` is a current authorized read; the
receipt identifies the accepted attempt, not a guarantee that nobody subsequently
edited any work-order fields.

Only acknowledge/remove the matching local attempt after a matching durable
receipt confirms `fieldStatus: "accepted"` and its submission media are confirmed.
A bare successful response without a durable record is explicitly unconfirmed.

## Field-first completion is not final inventory accounting

Field evidence, work-order completion, installation claims and the durable
reconciliation job are accepted together. The inventory worker reconciles stock
afterward. `reconciliationStatus` can be `pending`, `succeeded`, `failed` or
`not_required`.

A failed/pending inventory reconciliation does **not** mean field evidence was
rejected. Do not repeat the changeout or debit stock again. Display that inventory
needs review and use the server's reconciliation workflow.

Trouble gets an identity-bound receipt with `kind: "trouble"` and
`reconciliationStatus: "not_required"`. It does not mark the order Completed or
create a replacement-consumption job. Do not interpret every accepted receipt
as a completed work order.

## Photograph and signature handling

- JSON completion: `beforePhotos` / `afterPhotos`, each an array of objects with
  nonempty valid `base64`; optional `signatureData` uses base64.
- JSON Trouble: the existing `photos` array with `base64` objects.
- Multipart: actual `photos` file bytes, not JSON device-URI placeholders.
- New-protocol media fields that the selected route would ignore are rejected.
- Matching retries use stable submission-scoped photo names when retrying a
  failure before commit. Accepted replays bypass photo processing entirely.

`attachmentsConfirmed` covers only the media carried by that accepted request.
It is **not** an acknowledgement of unrelated queued files, standalone `/photos`
or `/signature` uploads, or time-tracking requests. Those auxiliary transports
retain their existing contracts and require independent acknowledgements.

Keep pending local photo/signature bytes until their corresponding upload is
confirmed. Project-required GPS, signature, equipment scope and decimal precision
still apply to a fresh attempt; read the project settings rather than hardcoding
requirements from these examples.

## Failure handling

| Response | Client action |
| --- | --- |
| Timeout, connection loss, 5xx, `CHANGEOUT_UNCONFIRMED` | Retain the frozen attempt and retry the same identity/payload. |
| `409 CHANGEOUT_PAYLOAD_MISMATCH` | Recover the original capture; do not silently submit changed inputs under that UUID. |
| `409 CHANGEOUT_ATTEMPT_CHANGED` | Refresh assignment/state; keep prior captures read-only and explicitly begin a new eligible attempt if needed. |
| Other 409 | Show the server reason and refresh authoritative state; `forceOverwrite` does not bypass identity or custody protections. |
| 400 validation | Keep inputs/media for correction; respect current project settings. |
| 401 / 403 | Reauthenticate or resolve access; do not discard the local capture or endlessly auto-retry without authorization. |

Replay still requires current account/permission/project access and matching
receipt ownership. An old receipt cannot be reused to overwrite reopened work.
Concurrent attempts are serialized before report/media side effects, and the
final database transaction rechecks the attempt boundary.

## Verification boundary

Final workspace verification: **49 tests passed, zero failed or skipped** across
the exact-reading, mobile read/submission, dispatch and inventory-permission
suites. `npm run check` passed. The application restarted cleanly and the public
landing page rendered successfully.

Server tests cover repaired exact-reading persistence/backup/reset, immutable
request binding, route wiring, mixed batch results, lost-response recovery,
concurrent retries beyond the connection-pool size, stale/reopened attempts,
Trouble, late delivery errors, pre-commit interruption, explicit unconfirmed
responses, inventory-enabled field-first acceptance and legacy bypass.

Signed-in browser screens, native devices and published integration still need
their normal acceptance checks. Native UI, local queue migration and independent
time-tracking idempotency were not implemented in this server package.
