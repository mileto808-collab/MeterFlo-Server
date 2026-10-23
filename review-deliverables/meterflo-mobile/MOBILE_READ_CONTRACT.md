# MeterFlo — implemented mobile read contract

**Changeout wizard integration:** See `CHANGEOUT_WIZARD_INVENTORY_ADDENDUM.md`
for the required inventory display/capture inside the physical changeout steps.
The Work Order Details planning panel alone does not satisfy that requirement.

**Pickups / Vehicle Stock supplement:** See `PICKUPS_VEHICLE_STOCK_HANDOFF.md`
for complete response types, endpoint/query contracts, existing QR format and
rendering, and confirmed technician versus warehouse access rules.

**Update:** The separate completion/retry package is now implemented too. See
`MOBILE_SUBMISSION_CONTRACT.md`; bootstrap advertises
`meta.mobileSubmissionContractVersion: 1`. The scope and historical verification
below describe the read package, not the combined implementation's remaining work.

## Scope

This server package implements additive read/synchronization support. It does **not** implement new native screens, change the approved field-first completion model, or finish completion/replay Package B.

Existing inventory/GPS/removal/scheduling versions keep their previous meanings. `meta.mobileReadContractVersion: 1` advertises this read contract only, not new completion guarantees.

## 1. Full active-work reconciliation

Request:

```http
GET /api/projects/7/mobile/sync/download
```

Omit `lastSyncTimestamp`, `limit` and a nonzero `offset` for the complete first-release active list. Preserve the same status/assignee filter scope when reconciling.

Successful response keeps the existing top-level envelope and adds:

```json
{
  "success": true,
  "serverTimestamp": "2026-10-22T18:00:00.000Z",
  "workOrders": [],
  "meta": {
    "mobileReadContractVersion": 1,
    "visibility": {
      "contractVersion": 1,
      "mode": "full",
      "complete": true,
      "snapshotId": "request-specific-uuid",
      "startedAt": "2026-10-22T18:00:00.000Z",
      "scope": {
        "projectId": 7,
        "userId": "current-user-id",
        "activeOnly": true,
        "status": null,
        "assignedUserId": null,
        "assignedGroupId": null
      },
      "page": { "limit": null, "offset": 0 },
      "since": null,
      "consistency": "request"
    },
    "reconciliation": {
      "strategy": "full_on_invalidation",
      "foreground": true,
      "reconnect": true,
      "openAppPollSeconds": 30,
      "inventoryEvents": "/api/projects/7/inventory/events",
      "pickupEvents": "/api/inventory/pickups/events"
    }
  }
}
```

The JSON is illustrative, with synthetic identifiers/times.

### Required client behavior

- An empty **successful complete full** result removes server-owned actionability only for the matching owner/project/filter scope.
- Preserve independent local captures, pending actions, media and uncertain submissions.
- Empty delta does not remove all rows.
- Paged results always have `complete:false`; they are not a full visibility manifest.
- `snapshotId` is a response identity, not a durable cursor or a lease joining separate page requests.
- A failed, timed-out, malformed, unsupported or unauthorized response is not an empty successful snapshot.
- Bind the request to its initiating server/user/project; discard response application after account/project change.
- Closed/Completed orders remain excluded. `includeCompleted` is ignored for legacy compatibility, not supported.
- Field-technician assignee query overrides are ignored by existing policy; metadata describes the effective filters.

The work-order query, dispatch projection and inventory state read share a read-only, repeatable-read transaction. Normal authorization and role checks still apply independently; a snapshot is not continuing permission to start or submit work.

## 2. Deltas, pagination and validation

`lastSyncTimestamp` keeps the existing edit-time delta behavior:

```http
GET /api/projects/7/mobile/sync/download?lastSyncTimestamp=2026-10-22T18%3A00%3A00.000Z
```

This returns `visibility.mode:"delta"` and `complete:false`. Deltas alone cannot represent inventory-only grants/removals; use the full-refresh strategy below.

Optional `limit` accepts decimal integers 1–10000. Optional `offset` accepts nonnegative safe integers. Ordering is deterministic by updated time then work-order ID. Separate pages are separate snapshots; do not combine them as one authoritative removal set.

Malformed timestamps, repeated known query values, invalid numeric prefixes, negative/fractional pagination or out-of-range values return HTTP 400:

```json
{"code":"MOBILE_QUERY","message":"Invalid mobile download filters or pagination."}
```

## 3. Open-app refresh and invalidations

Implement full reconciliation:

- On foreground/resume and reconnect, even with no pending upload actions.
- After relevant inventory/pickup/work-order/access invalidations.
- As a 30-second fallback while the app is open if event delivery is unavailable or incomplete.

`openAppPollSeconds` is client guidance, not a server timer or closed-app push.

Use existing event authentication and permissions; native transport compatibility must still be verified. Inventory event data invalidates reads, not local stock:

```ts
{ type: "inventory_updated" | "resync", projectId: number, revision?: number }
```

Existing streams can signal `access_lost`. Refetch/recheck authorization; never convert that event into a successful empty inventory/disabled-project response.

For inventory-disabled projects, inventory/pickup stream URLs are null. Existing ordinary work-order refresh remains available without inventory permissions.

## 4. Dispatch and work-order DTO parity

Download, detail, equipment lookup and claim responses now use one read DTO adapter:

- Preserve existing snake/camel properties and exact reading text.
- Add/normalize `assignmentVersion`, `subStatusId`, scheduling and GPS evidence.
- Return `inventoryDispatch:null` where no dispatch projection applies.
- Retain authoritative dispatch states `awaiting_pickup`, `ready_for_field`, `needs_review`, receipt/batch/vehicle identity and per-user `canStart`.

An absent dispatch requirement must not be reimplemented by guessing in native code. Claim/completion authorization remains on the server.

Existing envelopes are retained:

- Download: `{success, serverTimestamp, workOrders, inventory, referenceData, meta}`.
- Detail: work-order object.
- Equipment search: array. Matches outside the user's assignment/vehicle visibility are excluded.
- Claim: `{message, workOrder, claimed}`.

Successful read/claim responses use `Cache-Control:no-store`.

## 5. Permission-safe catalog

`inventory.catalogProjectionVersion:1` marks the shared allowlisted projection now used by bootstrap and the work-order inventory panel.

Ordinary inventory view/assign/plan users do not receive `cost`, `billingRate` or `vendorId`. Existing admin/maintain/configure/purchase pricing authority remains. Nested kit components include only item identity and quantity; unknown/future fields are not silently exposed.

Nonpricing catalog fields retain item identity, SKU/name/description/category, unit, tracking/equipment/kind, barcode/manufacturer/model, reorder point/active, images and component item/quantity references.

Enabled download still requires `inventory.view` and applicable project access. This package does not broaden planning-only roles or grant management authority.

## 6. Not completed by this package

- New mobile screens, native event transport, local offline-store migration.
- Stable completion identity forwarded through every transport.
- Payload-bound completion replay, media finalization and final outcome acknowledgments.
- A durable cross-page cursor/manifest for large paginated reconciliations.
- A closed-app push system.

Keep those separate from this implemented read contract. Backend field completion plus durable reconciliation responsibility remains distinct from eventual inventory accounting.

## 7. Verification and rollout

- 13 new synthetic tests execute the actual download/search/detail/claim handler bodies with controlled dependencies and cover DTOs, redaction, complete/delta/page semantics, rollback, access denial and inventory-only visibility changes.
- 17 existing dispatch/permission tests passed.
- Whole-project `npm run check` passed with zero TypeScript diagnostics.
- Application workflow restarted successfully; the public landing page rendered. Signed-in UI and real native transport were not verified.
- A separately attempted existing exact-reading database regression failed before its reading assertions because its schema-only fixture lacks a registered project. Its disposable schemas/user were cleaned up. This is an outstanding test-fixture repair, not a passing persistence/backup regression.

No production deployment was performed. The mobile agent must test against a host actually running this package. New native refresh, event, cache and reconciliation behavior is not installed merely by deploying these server changes.
