# MeterFlo Mobile — inventory-enabled upgrade and implementation handoff

Read with `REVIEW_FINDINGS.md` and `OPEN_QUESTIONS.md`.

**Status:** proposed implementation plan, not implemented changes.  
**Source convention:** M = supplied mobile ZIP; H = current host workspace.  
**Primary requirement:** the mobile app already works when Inventory is disabled. Preserve that behavior. Extend enabled projects using current server-owned policy, dispatch and relational inventory.

## 1. Mandatory compatibility contract

### Inventory disabled

- Preserve group-assigned work reaching every technician in that group and completed work leaving the other technicians' active lists.
- Preserve existing online/offline work-order capture, Add Work Order, matching, claims, sync, photos, signatures, notes, GPS and exact readings.
- Do not require a vehicle, pickup, fulfillment batch, inventory permission, stock reservation or inventory API call to perform the legacy workflow.
- Do not redesign the offline banner, add routine settings warnings on each step, or change reading-only/system/module behavior.

### Inventory enabled

- Read explicit server enablement, effective permissions, equipment/wizard policy, field stock settings, crew membership and dispatch state.
- Work lists follow authorized fulfillment/vehicle dispatch, with the documented exceptions below.
- A plan is not stock. Staging is not onboard stock. Pickup readiness is not vehicle handoff.
- Planned additions never automatically reserve/deduct stock.
- Installation use and removed-equipment evidence follow current project policy and server transactions.
- Preserve the approved field quantity-shortage exception: a tech who physically has the equipment may complete legitimate field work with a server-recorded inventory discrepancy. Do not turn bookkeeping shortage into a universal completion block, invent a receipt, or relax duplicate/other-owner serial checks.
- Meaningful captures survive refresh/restart/interruption, permission changes and failed synchronization.

### Cross-cutting

The server owns business authority and calculations involving stock, reservations, dispatch and completion. Use relational server data rather than reproducing business records as ad hoc client rules. Programmatic UI calculations are appropriate for progress/remaining counts and validation against a downloaded policy; those checks do not authorize a stock move.

Missing or unavailable settings must not silently change an enabled project into a disabled one. An older host that genuinely predates inventory must retain its supported legacy workflow. Negotiate support explicitly, and retain last-known enabled state on outages rather than inventing a downgrade.

## 2. Technician dispatch — required behavior

**Authoritative sources:** H: `server/workOrderVisibility.ts:6–33`; `server/inventoryDispatch.ts`; `shared/inventory-dispatch.ts:1–44`.

| Situation | Expected technician behavior |
|---|---|
| Inventory disabled | Existing direct/group assignment behavior, unchanged. |
| Enabled project, `wizardMode=reading_only` | Ordinary assignment path; no universal material-pickup gate. |
| Enabled assigned-vehicle project; material work has no qualifying physical fulfillment | Do not expose the bulk group pool as startable dispatched work. |
| Fulfillment batch created but not physically picked/ready | Not a ready pickup and not authorization to install. |
| Qualifying stock staged and released ready, not handed off | Crew may see `awaiting_pickup`; display staging location, ticket and expected items; `canStart=false`. |
| Required physical handoff recorded | `ready_for_field`; can start subject to individual assignment and fresh server checks. |
| Open pickup issue, stale assignment, incompatible status or inactive vehicle | `needs_review` or removal from authorized projection; explain required warehouse/dispatch action. |
| Shared crew work | Authorized members of the effective vehicle crew may see it. Claim/start remains a server operation. |
| Individually scheduled work | Other crew members may help verify pickup, but must not install it until authorized reassignment permits it. |
| Technician helps another crew | Authorized vehicle membership grants shared access; scheduled work still needs reassignment. Membership alone does not transfer stock. |
| Outstanding work physically transferred to another vehicle | Follow the work order's effective vehicle, not the original batch vehicle. Preserve original batch/ticket history. |
| Configured `project_warehouse` source, no-material work, or reading-only allocation | Preserve allowed server exceptions. Do not force every enabled work order through vehicle fulfillment. |
| Complete/closed/cancelled or access revoked | Remove from actionable server-owned list at reconciliation; retain separate unsynced capture/conflict evidence. |

**Do not rebuild this table as an independent client authorization engine.** Consume the server projection, display reasons and enforce fresh checks when claiming/submitting.

### Data mobile must retain

- Work order's numeric server ID plus separate customer-facing work-order label.
- `assignmentVersion`, effective vehicle ID, batch ID, ticket number and dispatch state/reason.
- Per-user `canStart`, not merely a batch-level ready flag.
- Assignment/status/sub-status and material/allocation revisions.
- Snapshot/cursor identity and fetch time for offline freshness.

Example **target DTO**, not a claim that mobile download already supplies all of it:

```json
{
  "id": 123,
  "assignmentVersion": 4,
  "inventoryDispatch": {
    "batchId": "batch-identifier",
    "batchName": "Route 644",
    "receiptNumber": "PICK-2026-000001",
    "vehicleId": "vehicle-identifier",
    "vehicleName": "Service Vehicle 1",
    "stage": "awaiting_pickup",
    "canStart": false,
    "reason": "Stock is ready at staging. Record vehicle handoff before starting."
  }
}
```

The current visibility helper produces dispatch metadata, but mobile download currently filters to visible IDs without carrying that object through. Add it deliberately and test its per-user meaning.

### Synchronization requirement

Inventory visibility changes are not reliably represented by `work_orders.updated_at`. Never use an empty incremental response as a complete authorized list.

Initial release: foreground inventory events/reconnect trigger a full authorized visibility reconciliation, keeping local captures separate. Scalable follow-up: versioned dispatch changes, visible-ID manifest/tombstones and durable cursors. These extensions need server implementation; they are not existing fields.

## 3. Project/settings catalog for the mobile agent

Project source: existing `GET /api/projects/:projectId`. Read the current, authorized project response; M: `client/lib/project-settings-repository.ts:52–93` already fetches/caches it.

Additional existing mobile bootstrap: `GET /api/projects/:projectId/mobile/sync/download`. Its inventory/reference/meta sections supplement, but do not replace, the full project policy.

| Setting / data | Current host source / values | Required mobile handling |
|---|---|---|
| `inventoryEnabled` | H: `shared/schema.ts:109`; boolean | Gate new inventory behavior per project. Do not use one global app flag. Compare with supported bootstrap contract, not speculative stock presence. |
| `isActive`, identity/name | Project response | Enforce current access; scope all local data by server/user/project. A cached name is not access authority. |
| `wizardMode` | `changeout`, `reading_only`, `user_choice` | Preserve existing selection and equipment capture; reading-only must not consume replacement stock. |
| `changeoutEquipmentType` | `system`, `module`, `both`, `user_choice` | Determine applicable replacement equipment and inventory requirements. Do not clear historical hidden values. |
| `readingEquipmentType` | Same enum | Module-only readings use module precision even if an internal slot is system-named. |
| `systemReadingDecimalPlaces` | Integer **0–6**, default 3 | Preserve explicit zero. Exact strings; quiet prevention, no round/truncate/pad. |
| `moduleReadingDecimalPlaces` | Independent integer **0–6**, default 3 | Never infer from system precision. Refresh server policy before upload. |
| `wizardGpsMode` | `automatic`, **`manual_step`**, `disabled` | Explicitly translate current server enum to existing mobile internal `manual` if retaining that internal name. Preserve legacy cached values deliberately. |
| `wizardReuseOldGps` | Boolean, default false | Reuse only with explicit project opt-in and applicable validated old fix. Do not fabricate a new acquisition. |
| `wizardGpsMaxAccuracyMetres` | Nullable configured positive limit; project column enforces 1–100000 | Respect applicable accuracy requirements; store source/accuracy/time. Null is not zero. |
| `wizardShowGpsStep` | Boolean | Honor together with GPS mode; hiding a page does not authorize skipping required evidence. |
| `wizardShowNotesStep` | Boolean | Keep saved notes even if the step is hidden. |
| `wizardShowBeforePhotosStep`, `wizardShowAfterPhotosStep` | Independent booleans | Preserve existing capture and required checks; retain files until confirmed upload. |
| `wizardShowSignatureStep` | Boolean | Preserve signature/name and interruption recovery. |
| `searchShowBarcodeScan`, `searchShowQrCodeScan`, `searchShowManualEntry`, `searchShowHidScanner` | Independent booleans | Hide disallowed entry methods; QR pickup display is a separate inventory feature, not permission to open any batch. |
| `timezone` | Project value; mobile meta supplies resolved fallback | Use for project dates/appointments/pickups/receipts, not phone timezone by accident. Preserve UTC instants in storage. |
| `operationalHoursEnabled`, `operationalHoursStart`, `operationalHoursEnd`, `operationalHoursDays` | Project response | Preserve existing operational restrictions. Device clock/connectivity is not proof of server authorization. |
| `defaultServiceMinutes`, `defaultAppointmentToleranceMinutes` | Project scheduling defaults, nullable | Retain null/inheritance. Current schema ranges: service 1–480, tolerance 0–240. |
| Work-order `serviceDurationMinutes`, `appointmentWindowStart`, `appointmentWindowEnd`, scheduled timestamp | Mobile response `schedulingDto`; H: `shared/visitScheduling.ts:23–29` | Use actual work-order overrides; windows are service-start constraints, not guaranteed completion deadlines. |
| Status/sub-status definitions and IDs | Mobile `referenceData.workOrderStatuses` and `workOrderSubStatuses` | Retain stable IDs, core/project hierarchy and parent rules. Do not hardcode only today's labels. |
| Trouble codes, system/module/service types | Mobile `referenceData` | Cache scoped references for offline entry; keep historical selections recognizable. |
| Inventory `fieldSettings` | Work-order inventory DTO / authorized inventory read | `sourceMode`, configured warehouse, kit/component mode; see below. Not currently included in the mobile bootstrap's inventory subset. |
| Removal rules/policy/field choices | Work-order inventory DTO; mobile bootstrap has removal rules/policies | Distinguish allowed field choices and required returns from warehouse final disposition. |
| Locations/location types/crew access | Authorized inventory projections | Resolve effective accessible vehicles, assigned users/shared access and multiple-vehicle choice; never assume one vehicle or hardcode Main Warehouse. |
| Item definitions/type correlations/planned requirements | Work-order inventory DTO and sanitized catalog | Use server-computed requirements. Cache only authorized fields, including serial tracking and kit structure needed for capture. |
| Routing effective readiness/provider/capabilities | Dedicated routing APIs | Ordinary project DTOs intentionally redact routing configuration. Do not cache server secret references or infer readiness from `routingConfiguration`. |

### Field stock settings

H: `shared/inventory-field-stock.ts:6–29`:

```ts
{
  id: "field-defaults",
  sourceMode: "assigned_vehicle" | "project_warehouse",
  warehouseId: string | null,
  fulfillment: "components" | "kits"
}
```

- Honor configured source and existing reservations. Never silently substitute warehouse stock when a vehicle is short.
- More than one authorized vehicle requires a deliberate choice where the work's effective dispatch does not already determine it.
- A shared-access location is not automatically membership in a vehicle crew. Use explicit server vehicle/dispatch projections.
- Kit fulfillment must use server-defined components/assembled custody. Never reconstruct historical kit contents from today's recipe.
- The work-order DTO's capabilities/requirements are preferable to recomputing permissions/type correlations on-device.

### Exact measurement and GPS rules

Measurements are strings end to end, including leading/trailing zeros and large integer portions. Keep the current quiet rejection of invalid typing and whole invalid pasted edits. First focus may clear an imported current reading as already designed; it must not erase a saved/reopened final reading.

Inventory quantities have their own current integer schema. Do not apply the meter's 0–6 decimal precision to item quantities. Planned addition quantities are positive integers; override quantities may be zero with appropriate authority/reason.

Current GPS evidence shape, H: `shared/gps-capture.ts:3–10`:

```ts
{
  coordinates: string, // validated "latitude,longitude"
  source: "native" | "browser" | "manual" | "existing" | "geocode" | "reused_old",
  accuracy: number | null,
  capturedAt: string | null, // ISO timestamp with offset
  receiver: "internal" | "external" | "unknown"
}
```

Map real native evidence to this shape; never label a manual point as a native fix or invent accuracy. Validate current server policy before upload without rewriting the captured historical value.

## 4. Existing host API inventory

These paths are implemented in the reviewed host source. Every call still needs the external server's normal authenticated session and current project permissions. Examples use IDs, never work-order labels as relational identity.

### Bootstrap, work and permissions

| Existing API | Use / caution | Source |
|---|---|---|
| `GET /api/auth/user` | User/subrole identity; not the full effective-permission list | H: `server/routes.ts:338–358` |
| `GET /api/users/:id/permissions` | Effective permissions; use current-user endpoint access rules, not arbitrary user IDs | H: `server/routes.ts:1412` |
| `GET /api/projects/:projectId` | Project policy/settings; existing mobile repository | H: `server/routes.ts` project GET; M: settings repository |
| `GET /api/projects/:projectId/mobile/sync/download` | Work orders, references, inventory subset and meta; currently delta/dispatch limitations | H: `server/routes.ts:9139–9364` |
| `GET /api/projects/:projectId/work-orders` and work-order detail | Current visibility-aware web DTOs; adapters differ from mobile snake_case rows | H: `server/routes.ts:2355,2543`; visibility helper |
| `POST /api/projects/:projectId/work-orders/:workOrderId/claim` | Claim allowed work; never claim another tech's completed work | H: `server/routes.ts:2692` |
| Current mobile complete/trouble and sync-upload paths | Preserve legacy baseline; coordinate new inventory/version/replay transport | H: `server/routes.ts:9367,9660,9884,10043` |

Current bootstrap advertises `inventory.contractVersion=1`, removal contract 1 where applicable, `meta.gpsContractVersion=2` and visit-scheduling contract 1. These are distinct contracts, not proof that every proposed dispatch/outbox field exists.

The current mobile download also requires `inventory.view` for enabled projects and verifies project membership for non-administrators. A user who can plan through the narrower work-order inventory API is not automatically entitled to the broader mobile bootstrap. Resolve that role/DTO boundary in Phase 0 if planning-only mobile users are required; do not grant warehouse-management authority as a workaround.

Do not put pricing-sensitive `inventory.items` into a new cache until host redaction is corrected and tested.

### Work-order material planning and use

| Existing API | Purpose |
|---|---|
| `GET /api/projects/:projectId/work-orders/:workOrderId/inventory` | Enabled flag, capabilities, work-order plan/revision, requirements, allocation, authorized item/location data, field policy, removal rules, discrepancies and inventory revision. |
| `POST /api/projects/:projectId/inventory/commands` | Existing command envelope with UUID `operationId`, `action`, and `data`; server authorization, revision checks, replay and receipts remain authoritative. |
| `GET /api/projects/:projectId/inventory/events` | Project inventory SSE invalidation/resync, not a client ledger. |

Sources: H: `server/inventoryRoutes.ts:248–312,353–390,435–504`; `shared/inventory.ts:80–85`; `server/inventoryService.ts`.

Planned-addition example — **existing schema**, substitute real IDs/revision:

```json
{
  "operationId": "550e8400-e29b-41d4-a716-446655440000",
  "action": "plan",
  "data": {
    "workOrderId": 123,
    "revision": 0,
    "lines": [
      {
        "id": "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
        "itemId": "item-id",
        "quantity": 2,
        "kind": "addition",
        "reason": ""
      }
    ]
  }
}
```

The example UUIDs are illustrative: generate and persist the real operation/line identities; do not reuse the literals across requests. H: `shared/inventory-planning.ts:5–20` defines the strict input. A plan update is a revision-checked plan, not necessarily append-only. Preserve existing override lines unchanged for an ordinary planner; do not delete them while saving additions. New/changed overrides require separate authority and a reason of at least 10 characters.

If an enabled batch already covers some demand, additional planning is supplemental uncovered demand. It must not rewrite picked quantities or physically credit/debit stock. Reductions below covered demand require explicit server resolution.

Actual usage on the existing mobile update path is **not the same body as every web wizard submission**. H: `server/inventoryService.ts:449–467` currently parses:

```ts
{
  operationId: UUID,
  revision: number, // allocation revision, not a random global revision
  mode: "changeout" | "reading_only",
  used: Array<{ warehouseId: string; itemId: string; quantity: number; serials: string[] }>,
  dispositions: Disposition[]
}
```

Current disposition fields are:

```ts
{
  equipment: "system" | "module",
  serial: string,
  disposition: "returned" | "scrapped" | "left_onsite",
  warehouseId: string | null,
  ruleId?: UUID,
  ruleRevision?: number,
  ruleName?: string,
  policyRevision?: number
}
```

The schema is strict; rule/policy validation further constrains allowed choices. Use `shared/inventory.ts` and removal schemas as the complete authority. Agree a coordinated mobile completion endpoint/version before implementing this operation offline. Do not first complete the work order and then deduct stock in an unrelated second call.

**Field shortage is different from warehouse scan eligibility.** H: `shared/inventory-stock-discrepancies.ts:37–80` distinguishes recorded available stock from declared actual use. The mobile completion must retain the host's auditable quantity-shortage/discrepancy path while rejecting duplicate, held, other-owner or elsewhere-recorded serials. Do not apply the warehouse picker's strict “available quantity” limit as a blanket field-completion rule. A discrepancy is not an invented stock receipt, and the technician must see the submitted/review-needed result clearly.

### Pickup inbox

| Existing API | Meaning |
|---|---|
| `GET /api/inventory/pickups` | Cross-project authorized vehicle-assignee inbox: `{pickups, unreadCount}`. |
| `GET /api/inventory/pickups/events` | Foreground SSE invalidation. Events include `resync` and `access_lost`; re-fetch data and permissions. |
| `POST /api/inventory/pickups/:projectId/:batchId/view` | Revision-aware viewed/read acknowledgment; not physical custody. |
| `POST /api/inventory/pickups/:projectId/:batchId/problem` | Report a pickup issue with current batch context; does not itself transfer/release stock. |

Sources: H: `server/inventoryPickups.ts:12–32,35–132,135–216`; `shared/inventory-pickups.ts`.

Exact current acknowledgment body: `{ "revision": <positive integer> }`.

Current problem-report body:

```ts
{
  operationId: UUID,
  revision: number, // positive current batch revision
  itemId: string,
  category: "wrong_serial" | "wrong_item" | "quantity" | "missing" | "other",
  description: string // trimmed, 10–1000 characters
}
```

Persist the report's identity/body before retry. The problem route returns `{reported:true}`; do not interpret that as stock correction or handoff. The report schema does not accept arbitrary extra fields such as a complete client stock transaction.

Notice fields include project/timezone, batch ID/name, `ticketNumber`, `revision`, ready/created timestamps, status `ready | partial | review`, vehicle/staging details, issues and item quantities/serials.

Item fields: `itemId`, SKU/name/unit, `plannedQuantity`, `stagedQuantity`, `deliveredQuantity`, `readyQuantity`, `remainingToStage`, `serials`. Do not confuse those quantities with onboard stock.

Display ticket and batch together, e.g. **Route 644 — PICK-2026-000001**. Reuse the host's current QR encoder/parser and link format from its pickup/ticket implementation; do not invent a second payload from ticket text alone. QR possession is not permission, acknowledgment is not handoff, and scanning never moves stock.

Current accepted ticket identity is an HTTP(S) or relative link with path `/projects/<projectId>/inventory` or `/projects/<projectId>/work-orders`, and exactly one `pickup=<batch UUID>` query parameter. H: `shared/inventory-pick-ticket.ts` validates this; `client/src/components/inventory/pickup-notices.tsx:151–156` generates the displayed QR. Do not accept a bare serial/UUID, follow a scanned foreign host, permit credentials/fragments, or ignore wrong-project identity. The mobile-generated display must use the configured server's equivalent link so the existing warehouse parser can consume it.

The user's requirement is notices while the app is open. Start one managed foreground subscription; re-fetch on resume/reconnect and use bounded polling fallback if SSE is unavailable. No closed-app push system is required.

### Vehicle stock

| Existing API | Parameters / response |
|---|---|
| `GET /api/inventory/vehicles` | Optional `projectId`; directory `{vehicles, generatedAt}`. |
| `GET /api/projects/:projectId/inventory/vehicle-stock` | Required `vehicle`; stock query filters including `q`, `offset`, `limit`; returns vehicle identity/timezone, generated time, revision, totals and rows. |
| Same path + `/serials` | Required vehicle and item context, search/paging; returns serials, counts and revision. |
| Same path + `/print` | Authorized vehicle report HTML. |
| `GET /api/inventory/vehicles/print` | Authorized accessible-fleet report, optional project scope/search. |

Sources: H: `server/inventoryVehicleStock.ts:13–70,110–139`; `shared/inventory-vehicle-stock.ts`.

Rows distinguish `quantity` (onboard), `reserved`, `available`, `serialCount`, and revision. `available` is not total onboard. Waiting staging stock is excluded until handoff.

Ordinary technicians see assigned/shared authorized vehicles. Administrator or appropriate location-management authority can see broader scope; do not hardcode role labels. The server enforces access again on every request. Print/share native reports through authenticated, authorized transport; never make a public attachment URL just to open a browser.

### Route plans and maps

| Existing API | Intended use / constraint |
|---|---|
| `GET /api/projects/:projectId/routing/dispatched` | Received route summaries for current user; requires `workOrders.optimizeRoute`. |
| `POST /api/projects/:projectId/routing/dispatched/:dispatchId/open` | Revalidate/activate received route. May require address review or reject stale assignment/provider/departure/expiry. Returns route payload and `receivedDispatchId`. |
| `POST /api/projects/:projectId/routing/dispatch` | Authorized dispatcher sends an existing plan; do not expose to ordinary technicians by default. |
| `GET /api/projects/:projectId/routing/origins` | Authorized warehouse origins when applicable. |
| `POST /api/projects/:projectId/routing/validate` and `/plan` | Planning/optimization, separate from merely receiving a plan. Requires permission/provider/quota checks. |
| `GET /api/projects/:projectId/routing/map-config` | Existing browser-map configuration. A domain-restricted browser key is not automatically suitable for a native SDK. |

Sources: H: `server/routing/routes.ts:23–27,48–115,118–181,199–238`; `shared/workOrderRouting.ts:79–122`.

Cache the authorized ordered stops, work-order IDs, destinations/coordinates, appointment constraints, plan ID/revisions/fingerprint, provider, departure and expiry, exclusions/warnings and fetched time. Retain server ordering, not a locally sorted route-label list.

`shared/workOrderRouting.ts` supplies external Apple/Google destination links. On mobile, use supported native URL opening with a safe fallback, and keep Android/iOS/browser differences tested. Offline stop lists and cached destinations can be supported; offline map tiles or turn-by-turn navigation are not promised by opening an external maps app.

## 5. Permissions and technician-facing UI

Use H: `shared/work-order-inventory-capabilities.ts` and the work-order DTO's capabilities. Re-check server authorization even if UI is hidden.

| Capability | Minimum relevant authority / boundary |
|---|---|
| View work/pickup context | Existing work-order/project access; pickup API has its own membership rules. |
| View vehicle stock | `inventory.view`, current authorized vehicle access. |
| Add planned items | `inventory.plan` plus work-order view/editable non-reading-only context. `inventory.assign` alone does not grant planning. |
| Override computed material requirements | Planning plus `inventory.overridePlan`; preserve existing overrides when an ordinary planner saves additions. |
| Reserve stock | `inventory.reserve` plus work-order/inventory access; not a normal technician planning control. |
| Record actual field inventory use | `inventory.assign` plus applicable visibility/assignment/source/removal checks. |
| Stage/fulfill/move stock | Separate receive/transfer/assign permissions; do not show warehouse controls to a normal tech. |
| Manage field sources/resolve stock/reconcile returned disposition | Higher-authority capabilities; keep out of the simplified technician panel. |
| Receive/open route plans | Current host requires `workOrders.optimizeRoute`; explicitly verify intended technician role grants. |

Recommended technician additions to the existing work-order home/details:

- Pickup count/list with ticket QR, expected items, staging location and verification/problem action.
- Vehicle Stock shortcut with vehicle selector, item/serial search, onboard/reserved/available and refresh time.
- Received Routes with ordered stops and Navigate action.
- Work-order Inventory panel showing only relevant planned additions and actual-use steps permitted for that user.
- Clear `Awaiting pickup`, `Ready for field`, and `Needs warehouse review` explanation; do not present all visible rows as ready to claim/install.

Do not add warehouse receiving/count/fulfillment administration simply because the host has those wizards. That is outside the requested technician upgrade unless separately approved.

## 6. Offline storage and synchronization design

### Preserve the current pipeline

Continue to use the existing reading/settings/matching helpers for the working work-order flow. Do not make a server connection a prerequisite to retaining a field capture. Upload can remain blocked until fresh authorization/policy/inventory checks succeed.

### Required owner envelope

Every new persisted record needs:

```ts
{
  schemaVersion: number,
  serverBaseUrl: string, // normalized configured server, including supported base path
  userId: string,        // stable server user ID, not display name
  projectId: number,
  fetchedAt?: string,
  serverRevision?: string | number,
  accessVerifiedAt?: string
}
```

Use compound keys; two servers may both have project/work-order ID 1. Do not infer missing ownership from the current account. Cache authorization state is evidence of a prior download, not permanent authority after revocation.

### Read models to download/store locally

| Local model | Minimum content | Refresh/invalidation |
|---|---|---|
| Project policy | Explicit enablement, supported versions, wizard/equipment/reading/GPS/search/timezone/scheduling policy | Selection, foreground, reconnect, policy mismatch, fresh pre-upload check. |
| Permissions/crew membership | Effective capabilities, accessible project/vehicle IDs, verification time | Sign-in, user/project switch, access event, foreground and pre-mutation. |
| Authorized work list | Server fields plus dispatch/per-user startability and assignment version | Full visibility reconciliation after relevant inventory events; separate from unsynced captures. |
| Work-order inventory | Plan/requirements/allocation revisions, policy and referenced item definitions | Open details, resume capture, planning conflict, pre-submit. |
| Sanitized item catalog | Stable IDs, names/SKUs/unit/tracking/active/type/kit references needed for allowed entry | Revision-aware bounded paging; do not cache restricted prices. |
| Pickups | Ticket/batch/vehicle/staging/revision, item quantities, serials, issues and timestamps | Foreground SSE invalidation/refetch; stale when offline. |
| Vehicle stock | Authorized vehicle directory; bounded stock/serial pages, quantity/reserved/available and revisions | Foreground inventory updates, explicit refresh, reconnect, source change. |
| Routes | Received plan ID, ordered stops, destinations, appointment assumptions, expiry/warnings | Received-route open/revalidation, assignment/status change, resume/reconnect. |
| References | Status/sub-status/trouble/type/service definitions | Bootstrap/revision update; retain historical labels for local captures. |
| Media | Durable file references, ownership/checksum/upload state | Never evict the only unsynced original. |

A downloaded page is not a full offline manifest. If “download vehicle for offline” is offered, page to a coherent bounded snapshot/revision, detect changes while paging and restart/reconcile. Otherwise clearly identify which details were downloaded.

### Local persistence recommendation

For the new inventory multi-entity model, a normalized transactional local store plus durable outbox is preferable to increasing unbounded AsyncStorage JSON blobs. Expo-compatible SQLite is a candidate, subject to the actual SDK/native dependency check.

This is a **proposed new store**, not a recommendation to move server authority into SQLite or rewrite/migrate every legacy work-order cache in the first release. Keep legacy storage readable; introduce versioned, reversible migration only after crash/restart/account-switch tests. Store computation-friendly indexes and media file references rather than repeating large base64 blobs.

Suggested logical tables: owner-scoped project policies, permissions/vehicles, work-order dispatch snapshots, plans/plan lines, item definitions, stock/serial snapshots, pickup snapshots/lines, routes/stops, capture drafts, outbox operations/dependencies, attachment uploads, and sync receipts/cursors. These table names are design suggestions, not existing APIs.

### Outbox invariants

- Assign/persist operation and submission UUIDs **before** sending.
- Save capture plus queued intent transactionally where the new store supports it.
- Persist dependencies: claim before dependent completion; required attachment confirmation before final success.
- A request with unknown outcome retains the same owner, identity, immutable payload and expected revisions across restart/retry.
- Do not edit/reuse an uncertain operation's identity for a different body. Reconcile first; a materially changed resolved attempt gets a new identity.
- Suggested states: `draft`, `queued`, `sending`, `outcome_unknown`, `conflict`, `authorization_required`, `confirmed`. These are proposed client states, not current server codes.
- Remove only server-confirmed successful operations. An HTTP 200 on a batch endpoint may still contain failed per-item results.
- Do not remove work captured while sync was running. Automatic/manual sync share one writer/reconciler.
- Do not double-deduct a locally previewed stock quantity. Show any pending-use estimate separately from the authoritative last server snapshot.
- Deduplicate serials before accepting them; only show verified/eligible state when the appropriate check succeeded. An offline serial cannot be labeled server-verified.
- Duplicate, wrong item/source, reserved elsewhere, excess quantity or stale custody must fail without losing the rest of the captured work.

### Offline versus authoritative operation

| Action | Offline behavior | Online requirement |
|---|---|---|
| Read cached stock/pickups/routes | Available if downloaded; prominently show stale time | Refresh for current truth. |
| Add/edit planned additions | Save owned local draft; optionally queue revision-checked update | Current work visibility, planning authority and plan revision. |
| Capture readings/photos/serial candidates/removal evidence | Preserve with cached project policy and known ownership | Fresh policy, assignment, stock eligibility and removal validation before upload. |
| Start newly discovered inventory-dispatched work | Do not invent dispatch from group assignment or a QR | Server claim/start permission; define any stale/offline start policy explicitly. |
| Commit actual stock use/completion | Queue capture/intent, not a fake ledger success | Atomic authoritative transaction plus replay confirmation. |
| Transfer, reverse, release quarantine, resolve discrepancy | Not an implicit technician offline action | Authorized host workflow; separate product approval if mobile management is wanted. |

### Safe completion choreography

1. Persist meaningful work and owner-scoped capture locally.
2. At synchronization, refresh project policy/permission and identify the correct server work order using the established matching sequence if it was not downloaded.
3. Reconcile current status, assignment/dispatch, effective vehicle, allocation/plan revisions and any inventory issues. Claim only if allowed.
4. Validate exact readings, applicable GPS, serial/quantity/source and removal policy against the fresh contract. Retain conflicts for correction.
5. Submit the agreed immutable, stable-ID completion/usage intent through the coordinated host API. Preserve its legitimate field-shortage/discrepancy behavior; do not silently manufacture warehouse receipts. Do not split business completion and stock deduction into unrelated client commits.
6. Upload/confirm attachments using a documented resumable/retry-safe protocol where needed; retain originals on failure.
7. Confirm server outcome/receipt, then remap local offline identity without duplicating a downloaded row or deleting another capture of the same equipment.
8. Refresh authorized work, pickup and stock projections. Clear only confirmed operation state.

Current host completion services are reusable; stable mobile submission forwarding, confirmation semantics, transport schemas and media ordering must be closed in Phase 0/6. No new lookup/reconciliation endpoint is assumed to exist merely because this plan needs the capability.

## 7. Implementation phases

Each phase should be its own reviewable change. Do not bundle a native SDK upgrade, new auth architecture or complete context rewrite into inventory delivery.

### Phase 0 — Lock contracts and protect the baseline

- **Goal:** make a reliable server/mobile compatibility boundary before changing technician behavior.
- **In scope:** source-based API fixtures, explicit settings/capability versions, sanitized bootstrap catalog, dispatch metadata and full visibility reconciliation contract; inventory-disabled parity tests.
- **Out of scope:** new native screens, warehouse administration, credential redesign, production data changes.
- **Files:** H: mobile routes/visibility/projections and contract tests; M: small typed adapter/fixture modules and existing targeted tests.
- **Dependencies/decisions:** confirm supported host versions; choose first-release full reconciliation versus a new dispatch cursor; agree completion transport/version expectations.
- **Data/API changes:** additive mobile dispatch/assignment fields; safe inventory catalog DTO; document existing v1 versus proposed additions. No schema migration merely to expose already stored data.
- **Risk/migration:** old clients/hosts must keep working; never change numeric legacy reading contract or clear caches by default.
- **Acceptance:** disabled project runs existing flow without inventory calls; staging is visible but not startable; handoff grants startability; inventory-only changes arrive without a work-order timestamp change; revoked work loses actionability without capture loss; restricted prices absent.
- **Regression:** existing 67 mobile tests and host dispatch/capability tests plus synthetic server/client integration fixtures.
- **Recovery:** additive server rollout first; keep new client feature gate off until compatible. Disable only the new UI/transport on failure, not captured data.

### Phase 1 — Extend settings, permissions and owned read-model storage

- **Goal:** reliably load the policies/identities later phases need, online and offline.
- **In scope:** adapter for Section 3, supported contracts, GPS enum/evidence normalization, owner envelopes and revision/freshness metadata.
- **Out of scope:** stock mutation, global legacy storage migration or new offline login behavior.
- **Files:** M: Auth/WorkOrder context integration points, settings repository, small inventory repository/adapter modules; H: policy/capability fixture support if Phase 0 identified gaps.
- **Dependencies/decisions:** Phase 0; choose bounded initial cache and local database package/version for new multi-entity data.
- **Data/API changes:** consume existing project/meta APIs; proposed local schema versioning only, plus explicit host fields agreed in Phase 0.
- **Risk/migration:** do not overwrite known enabled state with defaults on outage; honor explicit zero/false/null; no cross-account cache reuse.
- **Acceptance:** two servers/users/projects with colliding IDs remain isolated; offline restart restores correct policy; 401/403/423 never become an unauthorized cache fallback; both decimal limits 0–6 and current GPS modes behave correctly.
- **Regression:** equipment/mode matrix, imported-reading focus behavior, stale/fresh policy transitions.
- **Recovery:** retain old known-owner cache readers; use a new namespace/version; rollback does not delete captured work.

### Phase 2 — Inventory-aware work lists and foreground updates

- **Goal:** show the right work and explain whether it may start.
- **In scope:** Section 2 projection, per-user eligibility/reason, effective vehicle, shared crew visibility, fresh claim guard, foreground event/resync integration.
- **Out of scope:** autonomous reassignment, changing group behavior for disabled projects, offline stock movements.
- **Files:** M: WorkOrders/detail mapping and list UI, shared foreground refresh service, WorkOrderContext; H: completed Phase 0 dispatch DTO/reconciliation.
- **Dependencies/decisions:** Phases 0–1; explicit policy for starting an already-downloaded order while offline.
- **Data/API changes:** persist dispatch metadata/visibility snapshots; no invented client status that overrides server status.
- **Risk/migration:** exclude only server-owned active rows; keep unsynced/offline captures and surface conflicts separately.
- **Acceptance:** staged/handoff/review/multiple-vehicle/scheduled/helper/direct-warehouse/no-material/reading-only matrix; another device's completion/reassignment/membership revocation refreshes correctly.
- **Regression:** unchanged disabled group lists and concurrent offline capture during refresh.
- **Recovery:** disable new inventory start actions on incompatible contract; retain cached captures and readable reasons.

### Phase 3 — Pickups and live Vehicle Stock

- **Goal:** let techs know what is waiting and what is actually onboard.
- **In scope:** foreground inbox/count, revision-aware viewed action, expected quantities/serials, existing ticket QR, issue reporting, vehicle selection/search/serial paging, freshness and authorized reports.
- **Out of scope:** closed-app push, warehouse handoff permission, trusting QR as authorization.
- **Files:** M: focused pickup/stock screens/components and scoped repositories, home/details shortcuts, foreground connection manager; H: existing pickups/vehicle-stock routes and shared DTOs.
- **Dependencies/decisions:** Phases 1–2; determine native report open/print/share UX without public URLs.
- **Data/API changes:** existing GET/SSE/view/problem/report contracts; validate exact request bodies against source and fixtures rather than guessing.
- **Risk/migration:** stale offline notices must not imply current stock; multi-project vehicle IDs need composite identity; recheck access after selection.
- **Acceptance:** correct crew receives staged notice while app open; same-user second-device events update; correction/readiness/partial handoff updates; old notice disappears after full handoff; wrong/unassigned vehicle denied; report scope/serials complete.
- **Regression:** SSE reconnect/focus/full resync, polling fallback, unauthorized cache cleanup without losing drafts, phone landscape and accessibility.
- **Recovery:** read-only cached view remains labeled with time; disable failed live connection and offer explicit retry, not empty success.

### Phase 4 — Technician planned additions

- **Goal:** simplify work-order planning to authorized item/quantity additions.
- **In scope:** active authorized item picker, quantity validation, saved local/shared plan workflow, revision-checked plan command; preserve existing overrides and covered picked demand.
- **Out of scope:** reservations, source/serial/staging controls for ordinary planners; changing equipment-derived requirements without override authority.
- **Files:** M: WorkOrderDetail Inventory panel, plan repository/outbox and common validation; H: existing work-order inventory DTO, planning schemas/capabilities/command handler.
- **Dependencies/decisions:** Phases 1–2; effective `inventory.plan` grants; agree concurrent plan-edit conflict UI.
- **Data/API changes:** consume current GET and `plan` command; local draft persistence; no ledger deduction.
- **Risk/migration:** stale plan edits must not erase another user's additions/overrides or reduce already fulfilled demand silently.
- **Acceptance:** permitted tech adds supplemental material; assign-only user sees no planner; ordinary planner preserves overrides; duplicate/retry and revision conflict preserve inputs; staged/handoff additions remain uncovered planning.
- **Regression:** reading-only/completed/disabled states, quantity boundaries, account switch/restart.
- **Recovery:** retain unsent local draft and server revision; conflict reload/merge is explicit, not overwrite.

### Phase 5 — Received route plans and native navigation

- **Goal:** pull dispatched ordered plans and launch maps using reviewed destinations.
- **In scope:** summary/list, authorized open/activate, ordered stops, appointment/expiry/warning display, cached route review, external/native map launch.
- **Out of scope:** new optimization engine, secret provider keys in native code, guaranteed offline maps, technician dispatch-management UI.
- **Files:** M: small route-plan repository/screen, WorkOrderDetail map adapter, navigation wiring; H: routing DTOs/routes.
- **Dependencies/decisions:** Phase 1 and current visible work from Phase 2; intended technician `workOrders.optimizeRoute` grant; whether mobile must also create optimized plans.
- **Data/API changes:** existing dispatched/open/origin APIs; cached reviewed plan metadata.
- **Risk/migration:** expired/changed assignments or addresses require explicit refresh/review; route label remains distinct from plan ID.
- **Acceptance:** receive/open valid plan; stale provider/assignment/departure/expiry rejected clearly; no unauthorized stops; route order/appointments retained; Android/iOS map handler missing/offline/cancellation paths work.
- **Regression:** current one-address Navigate still works in disabled projects.
- **Recovery:** keep last downloaded plan labeled stale/read-only; no silent replacement optimization.

### Phase 6 — Inventory capture, removed equipment and replay-safe completion

- **Goal:** complete enabled material work safely with offline captures and authoritative stock/custody.
- **In scope:** applicable planned versus actual-use entry, effective source/vehicle, kit/component rules, serial verification, excess/duplicate prevention, removed-equipment policy/choices, meaningful saved drafts, stable submission/outbox identities and conflict correction.
- **Out of scope:** automatic offline ledger postings, warehouse final return decisions, silent reassignment, treating speculative candidates as verified.
- **Files:** M: existing workflow integration via focused inventory steps, typed usage/disposition models, local transaction/outbox/attachment modules, AutoSyncManager/SyncScreen common reconciler; H: mobile completion adapter, existing changeout/inventory services and replay/receipt tests.
- **Dependencies/decisions:** Phases 0–4; agreed atomic/replay completion contract; offline start policy; transactional local storage/native package validation.
- **Data/API changes:** additive mobile submission/version transport and confirmation capability agreed with server; usage/assignment/allocation revisions; explicit media upload state. Any new server persistence needs a reviewed additive migration and portability plan.
- **Risk/migration:** uncertain outcomes, duplicated stock use, consumption from old vehicle, strict changed precision/removal policy, media-only partial success, process death and legacy ownership.
- **Acceptance:** offline capture for downloaded and not-downloaded work; later correct matching/claim; network drop before/after commit; same UUID retries exactly once; atomic completion/use; legitimate quantity-shortage completion records a discrepancy without inventing stock; duplicate/other-owner serials remain blocked; pending media preserved; changed assignment/stock/policy produces actionable retained conflict; capture never disappears during concurrent download/remap.
- **Regression:** all section-4 brief invariants; system/module/both × reading/changeout × enabled/disabled × automatic/manual sync; different-device handoff/correction/vehicle transfer during capture.
- **Recovery:** retain immutable uncertain request and original evidence; reconcile server status/receipt before replacement. No rollback may restore a pre-post ledger state by overwriting the database.

### Phase 7 — Native hardening, controlled rollout and delivery

- **Goal:** ship a tested signed replacement without losing offline work.
- **In scope:** lockfile installation/type checks, physical-device tests, storage pressure/crash injection, native QR/HID/camera/GPS/maps, security/logging review, signed APK upgrade, release notes/support matrix.
- **Out of scope:** unsolicited SDK/auth migration, new signing key, uninstall-to-fix, production migration without approval.
- **Files:** M: tests/native configuration only where required, update service/components, Android documentation; H: versioned compatibility tests.
- **Dependencies/decisions:** earlier phases; authorized test devices and the existing signing workflow, not raw secrets in chat.
- **Data/API changes:** versioned local migrations/backward readers and documented host minimum; no unreviewed deletion of captures.
- **Risk/migration:** downgrade cannot read a new store, insufficient disk, interrupted installer, signature/version mismatch, unsupported host version.
- **Acceptance:** in-place signed upgrade with pending owned work; app restart/offline operation/sync; actual post-install version confirmed; Android permission denials and maps/QR paths; optional iOS validation if supported.
- **Regression:** clean install and upgrade, web/native branches, phone/tablet/landscape/accessibility, old host/disabled project compatibility.
- **Recovery:** tested client rollback/version strategy preserving new captures, server additive compatibility, and explicit unresolved-operation reconciliation. Never uninstall a customer's app or replace production data as a shortcut.

## 8. Acceptance matrix the mobile agent must implement

Use synthetic fixtures, not production work or real personal locations.

1. **Legacy parity:** inventory off, each equipment/mode combination, group work for two techs, another tech completes, offline Add Work Order, claim before complete.
2. **Precision:** independent 0/1/3/6 limits, leading/trailing zeros, very large integers, invalid type/paste, old-current first-focus, saved reading reopen, stricter server policy during offline capture.
3. **Policy:** missing/false/zero/null handling, current/legacy GPS enums, disabled GPS, accuracy failure, old-GPS opt-in, cache unavailable versus 401/403/423.
4. **Dispatch:** no pick; staged not ready; ready awaiting pickup; partial/full handoff; issue; status change; assignment change; helper crew; individual scheduled work; transferred outstanding work; no material/direct warehouse/reading-only exceptions.
5. **Visibility delta:** inventory-only event with unchanged work-order timestamp; permissions revoked; multiple projects/servers with colliding IDs; completed work excluded without deleting a separate capture.
6. **Plans:** addition/override authority, preserved overrides, conflict, after-pick supplemental demand, reduction below covered demand.
7. **Stock:** onboard vs reserved vs available; unassigned vehicle denied; pagination and serial consistency; fresh/error/stale states; print/export scope.
8. **Pickups:** ticket/QR, status/revision/read state, correction, wrong meter/quantity/serial issue, notice disappears only for the proper current state.
9. **Routes:** ordered plan versus route label, expiry/assignment/address review, appointment defaults, map handler absence and offline limitations.
10. **Crash/replay:** before row persistence, between capture/outbox, before send, after server commit before response, concurrent manual/automatic sync, during download/remap, low storage, app kill/background/upgrade.
    **Field shortage:** physically used equipment with a bookkeeping shortfall completes through the authorized discrepancy path; repeat/held/other-owner serials do not.
11. **Ownership:** explicit logout, account/server/project switch, ownerless legacy quarantine, known-owner replay, locked project/user.
12. **Native:** physical QR/HID, scan delimiter/paste, keyboard input, camera/photo/signature/GPS permissions, real signed replacement and installer cancellation.

## 9. Approval boundaries and first action

Proceed first with **Phase 0: host/mobile settings and dispatch contract plus baseline tests**. It is the highest-value prerequisite because mobile cannot safely infer whether a visible order is merely waiting at staging or ready to install, and ordinary timestamp deltas cannot fully maintain that list.

Read-only pickups/vehicle stock and received routes can then ship incrementally before the more sensitive inventory-completion/outbox phase, provided capability gating and stale-state labeling are in place.

Do not start warehouse administration, closed-app alerts, a complete offline rewrite, native SDK upgrades or credential-policy changes merely because they appear in the review. Keep those approval-dependent and separate from the requested inventory technician upgrade.
