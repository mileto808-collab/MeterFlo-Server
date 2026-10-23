# MeterFlo — server verification of the mobile Phase 0 handoff

**Implementation update:** Server read Package A has now been implemented. See `MOBILE_READ_CONTRACT.md` for the current wire contract and verification results. The findings below describe the pre-implementation verification; completion/replay Package B remains outstanding.

## Status and scope

Reviewed the uploaded Phase 0 findings and server handoff against the current host source. This is a **source-verified contract response and implementation scope**, not a declaration that Phase 0 integration acceptance has passed.

No application code, database, permissions, dependencies, credentials or deployment was changed. No authenticated API, production, native-device or new integration test was run in this verification. Source references identify existing implementation, not live deployment evidence.

Use this response with the original three review documents. Two important corrections follow. The mobile agent correctly labeled host claims as review-reported; the corrections below are to the earlier host review, not to independently tested mobile findings.

## 1. Corrections that must govern implementation

### C1 — Mobile download already returns dispatch

The earlier finding that download discards dispatch was incorrect.

`server/routes.ts:9213–9225` first resolves authorized work-order IDs before pagination. Later, `:9273–9278` runs `visibleAssignedOrders` over the fetched rows again. This second call attaches `inventoryDispatch`; the response at `:9323–9327` preserves it through object spreading. `shared/exact-readings.ts:33–47` recursively preserves those properties.

The mobile mapper still does not retain/use this information. That is a genuine mobile integration gap. The server work is documentation, consistency, snapshot/revocation semantics and acceptance evidence—not adding an already-present field from scratch.

### C2 — Field completion and final stock accounting are intentionally separate

Do not interpret S6's “atomic work-order/stock/custody outcome” as requiring synchronous ledger finalization before the technician can finish.

Existing design:

1. `server/projectDb.ts:1597–1626` locks/updates the work order and calls `acceptCompletion` when transitioning into Completed.
2. `server/changeoutService.ts:75–136` accepts authenticated evidence, validates dispatch/assignment, registers pending installation claims, creates a durable completion/reconciliation record, and removes superseded server drafts in that transaction.
3. The transaction commits field completion and durable reconciliation responsibility together.
4. `server/changeoutWorker.ts:12–81` later reconciles inventory in its own transaction. It checks the accepted installation still matches the work order and records success or retained failure/retry state. A failed reconciliation does not roll back accepted field work.

This follows the established field-first requirement. New mobile acknowledgments must distinguish:

- **Field completion accepted:** durable evidence and reconciliation responsibility are recorded.
- **Inventory reconciliation pending:** bookkeeping is not yet finalized.
- **Inventory reconciliation succeeded.**
- **Inventory reconciliation failed/needs review:** work remains accepted; authorized review resolves bookkeeping.

These are semantic requirements, not new wire-field names. Agree the actual envelope before implementation.

S6 acceptance should require atomic **field-completion/evidence/job acceptance**, separately atomic inventory reconciliation, installation protection, replay safety and accurate media acknowledgment. Do not retry an already-accepted field completion merely because its inventory job failed.

## 2. S1–S8 disposition

| Handoff section | Existing, source-confirmed | Remaining work |
|---|---|---|
| S1 — Dispatch/startability | Shared vehicle-based projection; download and detail dispatch; authoritative transactional claim checks and completion dispatch checks | Mobile mapping; document optionality/types; normalize search/claim response expectations; verify every transport and per-user assignment boundary |
| S2 — Visibility synchronization | Omitted timestamp removes the edit-time filter; optional limit/offset; current inventory/pickup invalidation streams | Explicit full-snapshot scope/completeness; coherent paging if used; foreground/reconnect reconciliation; invalidation coverage and revocation fixtures |
| S3 — Settings/precision/GPS | Independent 0–6 precision; exact-reading serializer; current project settings; GPS evidence schema and bootstrap metadata | Typed native adapter and `manual_step` normalization; transport-parity evidence; explicit compatibility/version behavior |
| S4 — Permissions | Self effective-permissions endpoint; separate planning/reservation/use permissions; per-work-order capability DTO | Document existing shapes rather than inventing an endpoint; confirm intended role grants and refresh/revocation behavior |
| S5 — Safe catalog | Work-order inventory strips restricted pricing/vendor fields for ordinary users | Mobile bootstrap returns raw items; share permission-safe projection and test raw-response absence |
| S6 — Completion/replay | Durable completion jobs, actor-bound replay helper, assignment checks, background reconciliation | Forward stable identity/version through mobile transports; payload-bound replay; accurate durable acknowledgment/media recovery and transport-parity tests |
| S7 — Shortage/removals | Field quantity-shortage split and discrepancy reconciliation; removal/disposition schemas | Mobile capture/serialization; distinguish immediate rejection from later reconciliation failure; passing/failing fixtures |
| S8 — Matching/media/results | Existing matching endpoints and legacy batch envelope; direct mobile routes | Shared new-field forwarding, stable per-item result correlation, media finalization/recovery and retained-capture tests |

## 3. Existing contracts to reuse

### 3.1 Dispatch

`shared/inventory-dispatch.ts:1–44` defines:

```ts
type InventoryDispatch = {
  batchId: string;
  batchName: string;
  receiptNumber: string;
  vehicleId: string;
  vehicleName: string;
  stage: "awaiting_pickup" | "ready_for_field" | "needs_review";
  canStart: boolean;
  reason?: string;
};
```

`server/workOrderVisibility.ts:12–33` further makes startability user-specific when an order is individually assigned. An absent dispatch object is not permission to infer startability from a stock balance; reading-only/direct-warehouse/no-material exceptions remain server-owned.

Confirmed endpoints:

| Method/path | Current behavior and qualification |
|---|---|
| `GET /api/projects/:projectId/mobile/sync/download` | Active-only authorized rows, dispatch on qualifying technician rows, snake-case database fields plus mapped metadata, allocation where enabled |
| `GET /api/projects/:projectId/work-orders/:workOrderId` | Visibility check; adds `inventoryDispatch`, camel-case `assignmentVersion`, scheduling/GPS DTOs |
| `GET /api/projects/:projectId/work-orders/search?meterId=...` | Existing equipment lookup; document/verify projection parity rather than assuming every field matches detail |
| `POST /api/projects/:projectId/work-orders/:workOrderId/claim` | Calls transactional claim service; existing response `{message, workOrder, claimed}`; do not assume it already accepts an expected assignment version |

Claim enforcement is not just a UI/download filter. `server/projectDb.ts:1669–1695` invokes `assertClaimAllowed` under the work-order row lock. `server/changeoutService.ts:11–58` checks permissions, Open/Scheduled status, individual assignee, vehicle handoff and ordinary group fallback where applicable.

For ready staging, crew members can inspect expected work/items but cannot start until qualifying physical handoff. Helping-crew access does not move stock or silently reassign individually Scheduled work.

### 3.2 Full refresh and events

Current download:

- `lastSyncTimestamp` adds `w.updated_at > ...` (`server/routes.ts:9227–9230`).
- Omitting it removes that filter. Without `limit`/`offset`, the query has no pagination clause (`:9260–9270`).
- Explicit filtering/paging still changes scope. `meta.count` is the returned count, not a proof of a complete total.
- Closed/Completed rows are deliberately excluded. The current route ignores `includeCompleted`; do not advertise it as supported.
- Authorization/projection is recomputed at more than one point; these reads are not documented as one stable inventory/work-order snapshot.

A first release can reuse forced-full download; it does not require a new durable cursor system. Add/document explicit snapshot semantics and reconcile only a successfully completed response for the agreed active scope. Empty timestamp delta is not an empty authorized list.

Inventory event data is invalidation metadata, not stock mutations:

```ts
{ type: "inventory_updated" | "resync", projectId: number, revision?: number }
```

Sources: `shared/inventory-events.ts`; project stream `server/inventoryRoutes.ts:248–302`. Project stream can emit `access_lost` and rechecks permissions. Global pickup stream `server/inventoryPickups.ts:187–216` also supports resync/access loss.

Native transport/auth support, all relevant mutation coverage and missed-event recovery still require tests. Refetch on foreground/reconnect even with an empty upload queue. No closed-app push is required.

### 3.3 Permissions and safe inventory

`GET /api/users/:id/permissions` already returns a **JSON array of permission strings**, not the proposed `{effectivePermissions, capabilities}` envelope. Current authorization allows the user themself or an admin (`server/routes.ts:1412–1433`; `server/storage.ts:740`).

That array is not a per-project or per-work-order authorization guarantee. Existing project membership, locks, vehicle access and per-work-order capabilities must still apply.

The existing work-order inventory GET returns contextual capabilities and a safer catalog. Source: `server/inventoryRoutes.ts:435–504`, especially the pricing projection at `:492`.

Confirmed remaining gap: mobile download uses `items: inv?.items || []` (`server/routes.ts:9328`), not that restricted projection. The fix belongs on the server, before native caching.

Enabled mobile download also currently requires `inventory.view`; narrower planning access does not imply bootstrap access. Preserve disabled-project operation without inventory grants. If planning-only native roles are required, resolve that intentionally without granting management permissions.

### 3.4 Settings, exact measurements and GPS

Use current project settings and existing GPS contract—not renamed parallel fields. `shared/schema.ts` defines independent precision and `automatic | manual_step | disabled`; the native internal `manual` requires deliberate translation.

`shared/exact-readings.ts:33–47` substitutes stored exact text into reading fields while preserving the rest of the DTO. The mobile agent is correct that strings must remain intact through every transport; the helper alone is not complete direct/batch/media integration evidence.

GPS `gpsCapture` includes coordinates, source, nullable accuracy/time and receiver classification. Preserve actual acquisition evidence and policy; do not invent accuracy or reinterpret a native fix as a known internal receiver.

Current inventory/GPS/removal/scheduling version numbers do not advertise proposed new replay or snapshot guarantees. Negotiate those additions explicitly.

## 4. Completion/replay decisions and actual gaps

### 4.1 Reuse current mobile routes, but align their adapters

The actual current mobile paths include:

- `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/complete`
- `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/trouble`
- `POST /api/projects/:projectId/mobile/sync/upload`

Do not replace these by assuming a different URL layout. Preserve legacy clients/envelopes.

Current mobile handlers pass parsed `inventoryUsage` into work-order updates, but do not forward the web identity fields equivalently (`server/routes.ts:9643,9857,10020,10338`).

The existing host field names are **`changeoutSubmissionId`** and **`changeoutAssignmentVersion`**, not the proposed top-level `submissionId`/`assignmentVersion` pair. Reuse those names where practical; agree a versioned alternative only intentionally. The usage operation UUID and allocation revision are separate concepts from field-completion identity/assignment version.

Trouble reports are not completed installations. Preserve their existing business effects; sharing replay/media infrastructure does not mean every Trouble call consumes replacement inventory or creates a completed-installation job.

### 4.2 Replay exists, but is not the complete required mobile guarantee

`submissionReplay` (`server/changeoutService.ts:64–71`) validates UUID and actor/project/work-order ownership. `server/projectDb.ts:1601–1608` recognizes it before reapplying the database update and rejects replay over a reopened attempt.

However:

- Mobile does not consistently supply/forward the identity.
- The inspected replay path does not compare the retried request payload against the stored fingerprint before returning.
- Media/report-note processing in HTTP handlers can happen before reaching database replay handling. Database replay alone does not establish media exactly-once behavior.
- Current mobile success bodies expose a work order, not the newly required explicit completion/job/media acknowledgment.
- Direct mobile error handling needs normalized changeout-conflict semantics; a `ChangeoutError` must not become an undifferentiated retryable server failure.

Do not build a second receipt ledger. Extend the existing durable completion model and adapter, then prove lost-response recovery, changed-payload rejection and authorization.

### 4.3 Existing draft/reconciliation routes are not automatically native receipts

Existing routes include:

- `GET /api/projects/:projectId/work-orders/:workOrderId/changeout-draft`
- `GET /api/projects/:projectId/changeout-drafts`
- `GET /api/projects/:projectId/changeout-reconciliation`
- `POST /api/projects/:projectId/changeout-reconciliation/:id/retry`

Source: `server/changeoutRoutes.ts:29–61,106–133`.

The draft GET returns draft/eligibility information, not a submission-specific final media receipt. Reconciliation listing is permission-scoped and operational; do not download it wholesale to ordinary native clients as a receipt shortcut. A new endpoint is not predetermined—choose replay response or a narrow authorized existing-model lookup after deciding acknowledgment semantics.

## 5. Shortage, serial protection and deferred validation

`shared/inventory-stock-discrepancies.ts:37–76` separates available debit from missing bookkeeping quantity. It prevents duplicate and occupied/held/elsewhere/reserved/transit/return custody conflicts during inventory reconciliation.

Do not conflate two stages:

1. **Acceptance-time checks:** authenticated completion/assignment/dispatch, dispatched source constraint and pending installation claims, including protection against installation on another work order.
2. **Reconciliation-time checks:** full inventory/removal/custody validation and quantity-shortage discrepancy handling.

Some inventory errors become a retained failed reconciliation after field completion, rather than an immediate rejected completion. The mobile UI must show the true outcome. Do not promise every held/elsewhere/duplicate error already rejects before acceptance, and do not silently tighten the approved field-first policy during this upgrade.

Preserve actual accepted work and evidence; do not invent receipts, negative stock, automatic transfers or fallback warehouse sources. A shortage discrepancy and a failed inventory job are different results and should be explainable.

## 6. Recommended implementation order and evidence

### Server package A — Contract clarity, snapshots and safe reads

1. Document existing dispatch/settings/permission shapes and supported variants.
2. Add explicit full/delta scope/completeness metadata and safe refresh semantics; do not require a new cursor if forced-full suffices.
3. Reuse a permission-safe catalog projection across native bootstrap/read paths.
4. Normalize missing search/claim/detail metadata only where confirmed necessary.
5. Verify relevant event authorization/coverage and recovery; preserve existing API envelopes.

Evidence required: disabled-project parity, stage-ready versus handed-off, per-order partial handoff, scheduled assignee/helper, membership grant/revocation without work-order edit, empty full versus empty delta, auth failure, paging/completeness and raw technician catalog redaction.

### Server package B — Mobile completion acceptance and replay

1. Forward immutable submission identity/assignment version through every mobile transport.
2. Bind replay to the accepted payload before mutable preflight/media side effects.
3. Return agreed accepted-work/reconciliation/media outcomes using the existing durable completion model.
4. Keep backend ledger reconciliation separate and transactional.
5. Normalize per-item batch/conflict results and retain legacy parsing compatibility.

Evidence required: timeout before/after acceptance, same identity/same payload, same identity/different payload, reopen, two-device contention, authorization revocation, partial batch, media failure/retry, worker failure/retry, successful shortage discrepancy and separately rejected custody violations.

These are required tests, **not tests claimed to have passed in this verification**.

### Mobile work after contract agreement

Retain/map existing dispatch; typed project/GPS adapter; self-permission and contextual capability consumption; foreground/open-app reconciliation; safe owner-scoped caches; stable per-capture identity and accurate acknowledgment handling. Do not begin later inventory screens against speculative envelopes.

## 7. Remaining product/release decisions

1. May already-downloaded, last-known handed-off work be started while offline, and under what freshness policy? Local evidence must remain recoverable regardless; offline capture is not permission to post a local ledger.
2. Are planning-only native roles required without `inventory.view`, or will supported technician roles include it?
3. Which deployed host versions will support the new snapshot/replay guarantees? This source review does not establish production version support.
4. Agree media confirmation/retention and local evidence release criteria separately from eventual inventory success.

No implementation authorization is inferred from this verification document. The next server change should be Package A, followed by Package B before inventory completion is exposed in native.
