# Defective equipment replacement: implemented server/web handoff

Prepared 2026-10-23 after web/server acceptance verification, including cancelled-visit recovery. This replaces the preliminary replacement handoff. Implement in the mobile app; do not deploy server source from this bundle into the mobile preview server.

## Read this first

This is a linked **new physical visit**, not a reset or another submission against the original installation. A new work order and independent inventory allocation preserve every previous installation, return and consumption. Native screens are not implemented by this server change.

The supplied source describes development implementation. **Publication has not been verified.** Before enabling native entry points, authenticate against the configured server and verify these endpoints, additive DTO fields and schema availability there. Do not publish automatically or substitute a development URL.

Inventory-disabled projects keep their ordinary group distribution, normal work orders, and inventory-free completion. Replacement visits are an explicit additional action; do not require inventory permissions or show stock screens when `inventoryEnabled` is false.

## Files and authority

- `shared/defective-replacement.ts`: exact strict creation schema, eligibility/history/visit definitions and raw-row DTO mapper.
- `server/replacementRoutes.ts`, `replacementService.ts`, `replacementRecovery.ts`: authorization, creation/replay/cancel/read handlers, completion validation, safe restore/delete.
- `server/replacementSchema.ts`, `replacementBackup.ts`: relational linkage and portable restoration rules; native must not write these columns.
- `shared/inventory-dispatch.ts`, `server/inventoryDispatch.ts`, `shared/mobile-read-contract.ts`: normal custody projection plus onboard replacement dispatch.
- `client/src/components/defective-replacement-panel.tsx`: web preflight, persisted creation attempt, resume/cancel/print/history.
- `client/src/components/system-changeout-wizard.tsx`: focused replacement steps, exact readings, drafts, inventory, evidence and final gates.
- `server/changeoutService.ts`, `changeoutWorker.ts`: immutable accepted evidence, serial claims, deferred inventory and predecessor ordering.
- Included base `MOBILE_READ_CONTRACT.md`, `MOBILE_SUBMISSION_CONTRACT.md`, `INVENTORY_PLAN_RECOVERY_CONTRACT.md`, `CHANGEOUT_WIZARD_INVENTORY_ADDENDUM.md`: keep their existing read/submission/recovery boundaries. A replacement does not replace those protocols.
- `examples/technician-api.json`: complete HTTP response captures from an isolated synthetic technician fixture. No credentials, session cookies or customer data. IDs are examples, not configuration.
- `examples/recovery-illustrative.json`: synthetic illustrative cancelled-history, recovery requests, operation outcome and error bodies, explicitly not HTTP captures.
- `SOURCE_MANIFEST.json`: hashes of exported source, plus external package imports. Source is reference material, not a drop-in Expo package.

## Entry and eligibility

The completed original may be absent from active-only mobile full/delta downloads. Preserve the completed local record/link and use the authorized detail endpoint to open its history:

`GET /api/projects/:projectId/work-orders/:workOrderId`

`GET /api/projects/:projectId/work-orders/:workOrderId/replacement`

Both project and work-order IDs are positive integers. Same authentication as existing mobile APIs; no credentials are embedded in links. Replacement APIs require unlocked authenticated access, Work Orders View and Start Changeout permissions, project access, and technician/crew installation scope. Do not substitute role-name comparisons. Administrators still go through server authorization.

The eligibility response is exactly `ReplacementEligibility`:

```ts
{
  contractVersion: 1,
  timezone: string,
  canCreate: boolean,
  reason: string | null,
  rootWorkOrderId: number,
  predecessorFingerprint: string, // SHA-256, opaque, 64 characters
  inventoryEnabled: boolean,
  availableEquipment: ("system" | "module")[],
  baseline: {
    systemId: string | null, systemType: string | null,
    moduleId: string | null, moduleType: string | null
  },
  vehicles: { id: string, name: string, code: string }[],
  activeVisit: { workOrderId: number, label: string, canResume: boolean } | null,
  history: {
    workOrderId: number, label: string, status: string,
    equipment: "system" | "module" | "both" | null,
    reason: string | null,
    oldSystemId: string | null, newSystemId: string | null,
    oldModuleId: string | null, newModuleId: string | null,
    completedAt: string | null,
     accountingStatus: "pending" | "failed" | "succeeded" | "not_required" | null,
     operationId: string | null,
     cancelledAt: string | null,
     recovery: {
       canRestore: boolean, canDelete: boolean,
       restoreReason: string | null, deleteReason: string | null,
       restoreAssigneeLabel: string, usesOriginalRequester: boolean
     } | null
  }[]
}
```

`canCreate`, `reason`, `availableEquipment`, and `activeVisit.canResume` are authoritative, not advisory. There can be only one active visit per installation chain. Reading-only projects, inactive projects, nonterminal originals, missing installed identities, and insufficient inventory permissions do not permit creation. A field technician must have a proven connection to the original/chain through assignment, completion or authorized fulfillment-vehicle membership.

The baseline is the **latest completed installation of each selected equipment kind**, even if the preceding visit replaced only the other kind. It is never guessed from the original old equipment, current recipe or customer text. Viewing the action does not create a visit.

## Create a visit online

`POST /api/projects/:projectId/work-orders/:parentWorkOrderId/replacement`

Strict JSON body; no extra keys:

```json
{
  "operationId": "11111111-1111-4111-8111-111111111111",
  "predecessorFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "equipment": "system",
  "reason": "Replacement system failed commissioning.",
  "vehicleId": "authorized-vehicle-id"
}
```

- `equipment`: `system`, `module`, or `both`. Every selected kind must be in `availableEquipment`.
- `reason`: trimmed 10–2000 characters.
- `vehicleId`: required property, string (1–200 chars) or `null`. Select only a returned authorized active vehicle. A vehicle is an explicit declaration to use **existing onboard stock**, not a stock transfer.
- `null`: no special onboard issuance. In an inventory-enabled project the child is created **Scheduled**, individually assigned, and can enter normal scheduled-installer fulfillment, staging and vehicle handoff. It is not permission to consume an arbitrary warehouse or start before dispatch authorizes it. At field capture use the child's real handed-off allocation and vehicle, never the parent's or an assumed source.
- Stock source policy may suppress vehicle options. Do not fabricate additional options.

Response: HTTP **201** for a new visit, **200** for a verified replay:

```ts
{
  workOrder: ProjectWorkOrder, // existing standard camelCase detail DTO; full example supplied
  replacementVisit: {
    rootWorkOrderId: number,
    parentWorkOrderId: number,
    equipment: "system" | "module" | "both",
    reason: string,
    vehicleId: string | null,
    operationId: string,
    active: boolean,
    cancelledAt: string | null
  },
  replay: boolean
}
```

The child has fresh `id` and readable `RPL-<root ID>-<visit ID>` customer work-order identity, current technician assignment, copied site context and selected predecessor IDs/types. Status is **Scheduled** for inventory-enabled `vehicleId:null`, **Open** for explicit onboard stock or inventory-disabled projects. Unselected old/new equipment IDs/types are empty. Do not copy old readings, photos, signatures, fulfillment allocation or manual additions into the child.

### Operation identity and recovery

Persist the **exact** creation request before network transmission, keyed by authenticated account, project and selected parent. A timeout, lost response or 5xx is unknown: retain the same payload and UUID and retry it. Do not manufacture another replacement.

The server checks an existing operation before mutable eligibility: it must match actor, parent, scope, trimmed reason, vehicle and captured predecessor fingerprint. Exact replay returns the same child even after completion. Changed payload returns 409.

A definitive 400/403/409 response is not an unknown success: refresh eligibility, show the server explanation and permit a corrected fresh request. A busy 409 may be retried with the original identical payload. On a lost response, the user can also refresh eligibility and resume its authorized `activeVisit`; do not assume a different active visit was created by this attempt.

### Confirm a pending creation's outcome

`GET /api/projects/:projectId/work-orders/:parentWorkOrderId/replacement/operations/:operationId`

Use the **same parent used for POST**, not automatically the root if creation was against a child. Requires the original requesting actor or administrator, with the normal project/work-order permissions.

HTTP 200 body:

```ts
{
  operationId: string;
  workOrderId: number;
  label: string;
  status: "active" | "cancelled" | "deleted" | "completed";
}
```

For confirmed active status, refresh current authorization/detail before resume. For confirmed cancelled/completed/deleted status, clear only the matching pending creation attempt and show its outcome; do not reopen it as active or create a new child automatically. Guard asynchronous responses by account/project/parent/operation so an old response cannot clear a newer attempt.

HTTP 404 `REPLACEMENT_OPERATION_UNKNOWN`, network failure, 403, or any unconfirmed result does **not** establish that no visit was created. Retain its exact payload/identity for recovery; do not silently create another operation. An exact create replay may return an already cancelled/completed visit, so inspect its returned state. Deleted create replays return 410 `REPLACEMENT_DELETED`.

This creation is **online-only**. Offline capture is supported after a server-authorized child and claim have been downloaded. Do not invent an offline child ID or queue a new creation as though it guaranteed predecessor/vehicle availability.

## Resume, claim and dispatch

1. If `activeVisit.canResume`, fetch the child by its ID.
2. Use existing `POST /api/projects/:projectId/work-orders/:workOrderId/claim` and retain the returned `assignmentVersion`. Re-fetch detail after claiming.
3. Use the child's standard inventory endpoint and existing changeout draft protocol. Never claim or complete the parent instead.
4. On every direct detail, sync and restored draft, read `replacementVisit` to constrain scope. It is not only a flag held by the preflight screen.

Work-order detail and mobile download expose additive `replacementVisit`. Standard mobile DTOs retain camel/snake compatibility; raw detail can include snake_case database properties. Prefer the nested DTO and use the supplied mapper where appropriate.

For an explicit authorized onboard source, full/delta download can contain:

```ts
inventoryDispatch: {
  source: "replacement_onboard",
  batchId: string, // replacement operation identity, NOT a fulfillment/pick-ticket ID
  batchName: "Replacement · onboard vehicle stock",
  receiptNumber: string, // readable replacement visit label
  vehicleId: string,
  vehicleName: string,
  stage: "ready_for_field" | "needs_review",
  canStart: boolean,
  reason?: string
}
```

**Do not generate a pickup QR or request a fulfillment batch using this `batchId`.** Real staging/handoff dispatch continues to use the existing fulfillment contract (source absent means legacy fulfillment). A replacement already in a real batch uses that real batch; an old, cancelled/review batch is not bypassed by the onboard projection.

Onboard projection is scoped to the vehicle membership and assigned technician. It does not expose other crews' visits or override reassignment. `canStart` and assignment version remain authoritative. Ordinary inventory-disabled group sharing is unchanged. `includeCompleted=false` retains its existing compatibility behavior; active-only full and delta snapshot rules still apply.

## Native five-stage parity

Use focused steps and retain existing required substeps:

1. **Preflight** — scope, defect reason, predecessor identity and authorized source. Existing active visit offers resume, not duplicate creation.
2. **Replacement stock and installed ID** — show the same actual-use collector as web, source/vehicle label, items/kit components, quantities and exact serial binding for selected equipment only.
3. **Readings and evidence** — configured old/new readings, before/after photos, GPS, notes and signature for the selected scope. Do not show unchanged equipment requirements.
4. **Defective handling** — capture at least 10 characters explaining isolation/handling; save in draft and append to completion notes. Apply project-approved removed-equipment choices, return requirements and destination custody. No technician warehouse final disposition authority.
5. **Review and complete** — readable predecessor/replacement IDs, source, quantities, serials, handling and evidence. Back navigation preserves captures. Recheck all gates after draft restore, not just when a step was first completed.

Start each focused step at the top. Highlight required fields without focusing a text/scanner input; never open the mobile keyboard until the user taps an input. Reuse per-project decimal precision and exact reading text helpers; preserve leading/trailing zeroes, do not parse through floating-point before submission or invent historical padding. Honor project photos/GPS/signature flags and user-choice workflow configuration, but a replacement itself is a physical changeout, never reading-only.

Use the actual shared source/kit/removal helpers, not a simplified copy:

- `GET /api/projects/:projectId/work-orders/:childId/inventory` is the existing authorized complete work-order inventory response. Read its capabilities, items, requirements, effective manual plan, warehouse/location types, field settings, reservation lineage, removal rules/policies and revisions. Synthetic enabled technician response is supplied.
- `shared/inventory-wizard-use.ts`: actual-use drafts, unique/exact serial counts, bound installed IDs, quantity and kit/component rules.
- `shared/inventory-field-stock.ts`: authorized stock source and permitted kit handling. Selected source is not authorization to switch sources.
- `shared/inventory-removal-policy.ts`: field choices/mandatory return requirements. Pending defective returns are not usable stock.
- `shared/inventory-requirements.ts`, `inventory-kits.ts`: recover actual assembled contents, never today's recipe as serial evidence. Partial replacement requirements exclude unchanged equipment from a combined original kit; they do **not** disassemble a physical kit or bypass configured component-use permissions. Resolve incompatible kit policy/source with the warehouse.

Planned additions use the existing planned-inventory contract on the **child**. A planned item does not consume, return or transfer stock. Never copy the original consumed allocation.

## Completion and accounting

Complete the child through the existing multipart system-changeout API and immutable mobile submission protocol:

`POST /api/projects/:projectId/work-orders/:childId/system-changeout`

Preserve media upload/recovery, exact `changeoutSubmissionId`, captured assignment version, fingerprint and identical retry payload. Do not add a second completion endpoint or create a new UUID after an unknown completion outcome. A creation `operationId`, draft submission ID and immutable completion attempt are different identities.

For replacement completion, `changeoutAssignmentVersion` is mandatory and must equal the child's current assignment version. Missing/stale versions return 409 `REPLACEMENT_STALE_ASSIGNMENT`. Cancellation/restore fences earlier captures: never patch an old queued immutable completion to a new version and send it. Resolve its outcome first, then use the fresh authorized draft/attempt.

Server checks selected predecessor IDs/types are unchanged, new selected equipment differs from defective equipment, selected old/new readings exist, inventory view/use permission, required actual quantities, unique exact serial counts, selected source authorization, installed-ID/serial match, configured kit handling and removal scope. Invalid field evidence fails explicitly; accepted field work can still await inventory reconciliation.

The replacement gets its own consumption; original consumption is never refunded merely because equipment is defective. Selected old occupancy is removed through recorded disposition. Defective returned equipment enters pending receiving/quarantine, not available stock.

Acceptance is **not** stock-accounting success. Show accounting states separately. If an older chain installation is pending/failed, the replacement's worker waits for it rather than applying jobs out of order. Use existing authorized reconciliation review/retry tools; never submit another physical replacement to fix bookkeeping.

## Cancellation, history and receipts

`POST /api/projects/:projectId/work-orders/:childId/replacement/cancel`

Strict empty JSON `{}`. Only the assigned technician or an administrator with required access can cancel the active **unaccepted, unreserved/unbatched** child. HTTP 200 `{workOrder, replay:false}`; the cancelling actor or an administrator can recover repeated cancellation as `{workOrder, replay:true}`. A creator who has since been reassigned cannot cancel another technician's active visit. It preserves the visit/history, marks `replacementVisit.cancelledAt`, clears active assignment and removes the unused visit from ordinary lists. Resolve any fulfillment batch or held stock first; cancellation does not silently reverse stock. Accepted/posted visits cannot be cancelled, reset, deleted or overwritten to disguise another physical replacement. They remain independently reviewable.

### Restore an accidentally cancelled unused visit

`POST /api/projects/:projectId/work-orders/:childId/replacement/restore`

Strict body, trimmed reason 10–1000 characters:

```json
{"reason":"Cancelled accidentally before any physical replacement."}
```

HTTP 200 `{workOrder, replacementVisit, replay:boolean}`. This restores the **same child**, not a new replacement. Authority belongs to an administrator, the recorded cancellation actor, or the technician assigned when cancelled, with normal required access. Use `history[].recovery` to show/hide actions and reasons; the mutation rechecks eligibility and may still reject stale UI state.

Restore revalidates installed baseline, equipment scope, absence of another active visit, prior assignee's permissions, source policy and vehicle access. Reservations, accepted completion, returns and posting evidence block unused recovery, even when quantities later return to zero.

The saved cancellation assignee is restored. Older records without that snapshot use the original requester; show `restoreAssigneeLabel` and `usesOriginalRequester` before confirmation. Null-source inventory-enabled visits return to Scheduled; explicit onboard or inventory-disabled visits return to Open.

Server preserves the latest saved captures for the restored assignee by copying them to a **new draft submission UUID**, revision 1, current assignment version, with `basisAccepted:false`. The earlier attempt remains fenced. Re-fetch detail and drafts after restore, use the new draft identity, and revalidate baseline, stock, required captures and evidence before completion. Do not revive the old submission. Local-only captures are not promised to have been copied by the server.

### Delete a replacement started against the wrong order

Cancel the unused visit first, then:

`POST /api/projects/:projectId/work-orders/:childId/replacement/delete`

Strict body:

```json
{
  "reason":"Started against the wrong work order before doing physical work.",
  "noPhysicalReplacement":true
}
```

Reason is trimmed 10–1000 characters; `noPhysicalReplacement` must be literal `true` from an explicit user confirmation, not a hidden default.

HTTP 200 `{deleted:true, workOrderId:number, replay:boolean}`. Recovery authority is the same as restore; repeated deletion is allowed to its deleting actor or administrator. Explain that saved server wizard inputs are deleted and the visit disappears from operational history; an audit/replay tombstone remains. It is **not** a stock reversal. Accepted completion, posting history, reservations, returns, unresolved batches or a dependent successor prevent deletion.

After success remove this visit and its obsolete local drafts from active views, refresh history/sync, and return an open child screen to its original/root work order (or close the detail if unavailable). Never discard an unresolved queued completion merely because a delete button was tapped; handle server rejection/known outcome first. Deleted detail is unavailable, restore/create replay returns 410, and operation lookup still confirms `deleted`.

For a pause, save/close the wizard rather than cancel. If physical work already occurred, preserve evidence and resolve the recorded visit/accounting; do not confirm “no physical replacement” or create another visit to disguise it.

### History labels

Use readable work-order labels, never raw operation UUIDs as the primary title. On cancelled/uncompleted visits label baseline IDs **Previous installed** and entered new IDs **Intended replacement**, not “Removed/Installed”; starting/cancelling a visit does not prove a physical swap. Completed/closed installation evidence can use completed labels.

`GET /api/projects/:projectId/work-orders/:anyChainWorkOrderId/replacement/receipt`

Authenticated printable HTML chain history. It shows readable IDs, scope/reason, old/new installed IDs, completion timestamps in project timezone and accounting state. It does not move stock or expose internal prices. Use system browser/authenticated transport appropriate to native; do not put credentials into a URL.

Replacement completions are deliberately excluded from the existing customer completion delivery queue: that contract represents original utility orders and does not yet have a replacement-visit delivery shape. Do not tell a technician that a second original completion was transmitted.

## Errors and reconciliation

Replacement handler errors are JSON `{message,code}`; invalid creation input also has Zod `errors`.

- 400 `REPLACEMENT_INPUT`: malformed/extra fields, missing UUID/fingerprint or invalid reason.
- 400 `REPLACEMENT_SCOPE`: equipment not eligible; wrong cancellation target.
- 403 `REPLACEMENT_FORBIDDEN`: permission/project/technician scope.
- 403 `REPLACEMENT_VEHICLE`: source/vehicle authorization conflict.
- 404 `REPLACEMENT_NOT_FOUND`: missing project/work order/predecessor.
- 409 `REPLACEMENT_BUSY`: another project replacement creation is in flight; retry same request.
- 409 `REPLACEMENT_NOT_ELIGIBLE`: active visit or another current eligibility restriction.
- 409 `REPLACEMENT_STALE_PREDECESSOR`: re-read eligibility, show changed installation; do not silently rebase.
- 409 `REPLACEMENT_PAYLOAD_MISMATCH`: UUID reused with changed request/actor.
- 409 `REPLACEMENT_RECOVERY_BLOCKED`: visit is not cancelled/unused or retains protected inventory/completion evidence.
- 409 `REPLACEMENT_ASSIGNEE`: previous assignee no longer has required access.
- 409 `REPLACEMENT_VEHICLE`: restore source/vehicle no longer eligible (creation can return 403 with this code).
- 409 `REPLACEMENT_IDENTITY_CONFLICT`: equipment identity is now used elsewhere.
- 409 `REPLACEMENT_HISTORY`: a dependent successor/history prevents mutation.
- 409 `REPLACEMENT_STALE_ASSIGNMENT`: obsolete/missing completion assignment version.
- 404 `REPLACEMENT_OPERATION_UNKNOWN`: operation outcome unconfirmed; preserve retry identity.
- 410 `REPLACEMENT_DELETED`: confirmed tombstoned unused visit; do not retry creation with a fresh UUID automatically.
- 500 `REPLACEMENT_FAILED`: explicit failure/unknown creation outcome; keep exact attempt for recovery.

Existing claim/completion endpoints retain their normal error shapes and codes; some work-order mutation paths return `{message}` without a `code`. Display the actual safe server message and keep captures. Completion can report `REPLACEMENT_REQUIRED`, `REPLACEMENT_SERIALS`, `REPLACEMENT_SCOPE`, `REPLACEMENT_BASELINE`, `REPLACEMENT_KIT`, assignment conflicts or normal inventory validation failures. Never turn an error into an empty successful inventory list.

## Native acceptance checklist

- Inventory-disabled legacy group work and ordinary completion remain unchanged.
- System, module-only and both replacements constrain every screen and installed ID.
- Repeat replacement uses the latest installed device for each kind.
- Authorized onboard vehicle versus newly fulfilled stock; no staging-as-onboard assumption.
- Wrong source, missing/duplicate serial, scope/type/kit mismatch, revoked vehicle access and reassignment preserve captures and block invalid submission.
- Draft refresh/crash, offline capture, queued completion, media recovery, lost create/complete responses and exact replay do not duplicate visits or stock.
- Cancel/restore preserves saved captures using a new fenced submission; a queued pre-cancellation completion cannot post.
- Restore/delete visibility follows server capabilities, including reassigned cancellation owner and explicit original-requester fallback for older visits.
- Delete requires reason and “no physical replacement” confirmation; accepted/posted evidence cannot be deleted even at net-zero stock.
- Confirmed cancelled/deleted/completed creation outcomes clear only the matching pending request; 404/unknown/network outcomes retain its identity.
- Wrong-order unused deletion removes active/history/local draft clutter without deleting the original order or refunding stock.
- Full/delta refresh removes inaccessible visits and retains the established snapshot semantics.
- Original and replacement ledger/history survive restoration; original completion is immutable.
- Accounting pending/failed remains distinct from field acceptance; predecessor accounting is ordered.
- No input autofocus/mobile keyboard on initialization or step transition; top-of-step and required-field gates after restore.
- Real Android/iOS, camera/scanner behavior and native offline queue integration require verification by the mobile agent.

## Recommended implementation order and release gate

1. Verify the configured server exposes current eligibility, operation status, restore/delete, additive DTOs, draft fencing and both dispatch paths. Publication remains unverified by this bundle.
2. Add shared types and API/recovery adapters without changing inventory-disabled ordinary work.
3. Implement completed-order history entry, online preflight and persisted creation/outcome recovery.
4. Adapt the source wizard/actual-use rules to native focused steps and existing offline drafts/submission transport. Do not transplant DOM/Radix components or server SQL.
5. Add cancel/restore/delete confirmations, receipt/history and safe local-cache cleanup.
6. Run the checklist above in native Android/iOS, both enabled and disabled projects, plus lost-response/offline/reassignment scenarios. Do not enable release entry points until server contract checks pass.

Web/server verification already passed: type check, production build, unit tests, owned authenticated browser/API acceptance, synthetic full/delta dispatch, onboard and warehouse-fulfilled stock, recovery permissions, saved-input fencing and portable backup/restore. These checks do not establish native device/scanner readiness or published-server parity.
