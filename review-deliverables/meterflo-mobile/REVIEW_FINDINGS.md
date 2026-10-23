# MeterFlo Mobile — review findings

**Review date:** October 22, 2026, America/Denver  
**Mobile snapshot:** supplied MeterFlo Mobile 2.1.3 source ZIP  
**Host application:** current MeterFlo web/server source in this workspace  
**Scope:** read-only assessment and upgrade planning. No application code, database, credentials, deployment, APK, or signing configuration was changed.

## 1. Executive summary

The mobile app is a working offline-first work-order client, not an inventory client. Preserve its existing inventory-disabled behavior. The inventory upgrade is a conditional extension, not a reason to replace its work-order UI, offline capture, matching sequence, or reading handling.

The host already implements relational inventory, vehicle-crew dispatch, pickup notices, vehicle stock, material planning, and route dispatch. The mobile client does not yet consume these contracts. Copying a few Inventory screens into mobile would be insufficient: its settings model, download reconciliation, permissions, local storage, and completion uploads also need coordinated changes.

The most important dispatch distinction is:

1. An unpicked fulfillment plan is not field dispatch.
2. Ready stock at staging can make work visible to the vehicle crew, but **does not authorize starting the installation**.
3. The warehouse must record vehicle handoff before dispatched material work becomes startable.
4. A pickup issue or assignment change can require warehouse resolution.
5. Multiple authorized crew members may see shared vehicle work; individually scheduled work still has an explicit assignee constraint.
6. Inventory-disabled, reading-only, configured direct-warehouse, and no-material paths must not acquire an inappropriate vehicle-fulfillment gate.

### Readiness judgment

- **Existing non-inventory baseline:** retain and regression-test. The supplied 67 targeted tests passed again in this review.
- **Inventory-enabled release:** not ready merely by exposing the existing work-order screens. There are missing mobile models and server/mobile synchronization gaps.
- **Critical findings:** none established by this inspection. This is not a security certification.
- **Highest-value first implementation:** agree and test the settings/permissions/dispatch synchronization contract, including inventory-only visibility changes, before enabling inventory UI. See Phase 0 in `UPGRADE_PLAN.md`.

## 2. Evidence conventions and limitations

Paths prefixed **M:** refer to the extracted mobile ZIP. Paths prefixed **H:** refer to the current host workspace. Line references describe the reviewed snapshots and may move in later revisions.

Classification:

- **Confirmed source behavior:** directly visible in source; not necessarily reproduced on a physical device.
- **Integration gap:** supported host behavior is absent or incompatible in mobile.
- **Risk:** a plausible failure requires additional reproduction.
- **Documentation mismatch / optional improvement:** not a proven operational defect.

The supplied brief was read first. Its statement that upgrade requirements were not yet specified is superseded by the user's explicit inventory-enabled requirements in this conversation.

The review included the supplied source/configuration, mobile architecture and offline tests, and relevant current host contracts. It did not access real work orders, production data, credentials, signing material, or personal GPS data. The mobile package's local Express scaffold was not mistaken for the external MeterFlo business server.

## 3. Architecture map

| Layer | Current responsibility | Upgrade implication |
|---|---|---|
| M: `client/App.tsx`; `client/navigation/` | Expo application and work-order/account/sync navigation | Preserve the technician's existing entry/navigation; add conditional inventory access rather than a replacement dashboard. |
| M: `client/contexts/AuthContext.tsx` | Configurable external server, authentication, selected project, offline credentials | Every cache, queued operation and request must retain server/user/project ownership. |
| M: `client/contexts/WorkOrderContext.tsx` | Server DTO mapping, work-order/reference caches, settings, local captures and merging | Add explicit adapters for inventory/dispatch/scheduling/GPS; do not discard local captures during refresh. |
| M: `client/contexts/OfflineContext.tsx` | Claims, completions, offline equipment matching, queue persistence and sync history | Keep baseline queue behavior; inventory needs additional explicit, owned, replay-safe operations. |
| M: `AutoSyncManager.tsx`; `screens/SyncScreen.tsx` | Automatic and manual sync entry points | Both must use the same inventory synchronization engine and recovery rules. |
| M: `WorkflowWizardScreen.tsx`; `NewWorkOrderWizardScreen.tsx` | Existing work-order and offline/add-work-order captures | Add inventory-specific steps only where required by enabled project/mode/permissions. |
| M: `client/lib/reading-precision.ts`; settings repository | Exact-string measurements; fresh/cache policy separation | Preserve; do not substitute quantity validation or floating-point conversion. |
| H: `server/routes.ts` | Project settings, work-order APIs, mobile download/upload/completion | Some mobile DTO/transport gaps need host changes, not client guesses. |
| H: `server/workOrderVisibility.ts`; `inventoryDispatch.ts`; `shared/inventory-dispatch.ts` | Actual technician dispatch and start eligibility | Authoritative for mobile lists and start controls. |
| H: `server/inventoryRoutes.ts`; `inventoryService.ts`; relational inventory storage | Plans, reservations, use, custody and transactional work-order checks | Server remains the authority; mobile stores read models/captures, not a replacement ledger. |
| H: `inventoryPickups.ts`; `inventoryVehicleStock.ts` | Authorized pickup and onboard-stock projections | Reuse read APIs with foreground refresh and explicit offline freshness. |
| H: `server/routing/` | Provider policy, route planning, dispatched routes, expiry and validation | Receive/open real plans; a work-order route label is not a plan. |
| M: update services, app/EAS config and `BUILD_ANDROID.md` | APK distribution and replacement | Maintain package identity/signing continuity and test actual installation. |

## 4. High-priority findings

### H1 — Inventory dispatch is missing from the mobile model

**Classification:** integration gap, source-confirmed.  
**Affected path:** inventory-enabled technician work list, offline list, claim/start, completion.

**Evidence**

- M: `client/contexts/WorkOrderContext.tsx:175–212` defines legacy project configuration without inventory enablement/capabilities; `:228–281` maps work-order data without a dispatch/startability model; `:753–795` consumes work orders/reference data from mobile download.
- H: `server/workOrderVisibility.ts:12–33` distinguishes ordinary assignment from inventory dispatch and supplies `inventoryDispatch`, including per-user `canStart`.
- H: `shared/inventory-dispatch.ts:1–44` differentiates `awaiting_pickup`, `ready_for_field`, and `needs_review`.
- Correction after Phase 0 verification: H: `server/routes.ts:9213–9228` first determines authorized IDs, then `:9273–9278` runs `visibleAssignedOrders` again over the result rows. That second pass attaches `inventoryDispatch`, and the response preserves it. `shared/exact-readings.ts:33–47` preserves those object properties. The earlier claim that download drops dispatch was incorrect.

**Impact**

Being included in a download is not sufficient evidence that a technician may start work. Mobile must retain the existing authoritative dispatch projection and distinguish visible staged pickups from startable, physically handed-off work.

**Reproduction / limitation**

Static integration comparison. A required integration fixture is a ready-at-staging batch whose work is visible to its crew but has `canStart=false`; it must become startable only after warehouse handoff.

**Recommendation**

Document the existing permission-aware dispatch projection and map it explicitly in mobile. Verify consistent detail/search/claim serialization. Keep server enforcement. Do not duplicate dispatch rules in React Native or infer startability from stock quantity, batch status, group membership, or QR possession.

### H2 — Work-order timestamp deltas do not fully represent inventory visibility changes

**Classification:** confirmed contract limitation; end-to-end inventory reproduction still required.  
**Affected path:** foreground refresh/reconnect, new pickups, vehicle membership changes, reassignment and work removed from a device's active list.

**Evidence**

- M: `client/contexts/WorkOrderContext.tsx:761–766` requests incremental data using `lastSyncTimestamp`.
- H: `server/routes.ts:9213–9235` derives currently visible IDs from inventory and then restricts results with `w.updated_at > lastSyncTimestamp`.
- H: `server/inventoryDispatch.ts:18–91` derives dispatch from separate relational fulfillment/crew rows.
- H: `server/routes.ts:9320–9358` does not provide a complete visible-ID manifest or removal/tombstone contract.

**Impact**

A staging/handoff/crew event can change what the technician should see without requiring that work order's own timestamp to change. Merely reissuing the current incremental request may miss newly visible work; absence from an incremental response also cannot safely mean deletion. This matters specifically for the new inventory dispatch model.

**Reproduction**

Download at T1; change only fulfillment or vehicle crew evidence for an older work order; request a delta after T1. Verify both newly granted and revoked visibility, and distinguish a server row from a separate pending local capture.

**Recommendation**

For the first inventory release, use an authorized full visibility reconciliation after inventory events/reconnect/foreground, preserving captures separately. For scale, add a versioned dispatch cursor/visibility manifest/tombstones. These are proposed enhancements, not existing API fields.

### H3 — Ownerless legacy actions can be treated as belonging to the current session

**Classification:** confirmed source behavior; conditional cross-account upload risk.  
**Affected platform:** web/native offline queue and local-record reconciliation.

**Evidence**

- M: `client/contexts/OfflineContext.tsx:383–389,993–1000` admits missing `projectId`, `serverUrl`, or `userId` into the current session's action filter.
- M: `client/lib/offline-work-order-identity.ts:16–19` similarly admits unknown ownership when deriving pending keys.
- Existing tests isolate ownership during claim deduplication, but that does not establish safe ownership at every upload filter.

**Impact**

An ownerless legacy action can become eligible under another account/server/project. Inventory operations must not inherit this ambiguity. Numeric work-order/project IDs alone are not globally unique.

**Reproduction**

Use a synthetic ownerless legacy action, switch account/server, and inspect the actions eligible for synchronization. Do not reproduce using a customer's queue.

**Recommendation**

Require explicit ownership on all new inventory records and operations. Quarantine ambiguous legacy records for reconciliation; do not delete or silently stamp them with the current login. Test the migration separately so existing known-owner captures remain usable.

### H4 — Recoverable credentials persist through explicit logout

**Classification:** confirmed storage/logout behavior; security-policy decision required.  
**Affected platform:** especially browser; native storage has different protection.

**Evidence**

- M: `client/contexts/AuthContext.tsx:63–86` defines stored credentials containing a recoverable password and uses browser `localStorage` versus native SecureStore.
- M: `client/contexts/AuthContext.tsx:409–418` retains offline-login credentials.
- M: `client/contexts/AuthContext.tsx:514–546` does not remove all credential/server storage during logout.
- M: `client/contexts/AuthContext.tsx:177–202` restores a cached identity. This alone is not a defect: authenticated offline use is an explicit requirement.

**Impact**

Browser-readable recoverable credentials increase exposure to scripts/shared-device access. Explicit logout and intentional offline-session restoration currently have unclear separation.

**Reproduction**

Synthetic login, explicit logout, restart; inspect key presence and session behavior without recording credential values.

**Recommendation**

Agree explicit logout/offline-unlock policy. Prefer not retaining a recoverable password in browser storage; evaluate an appropriate server-supported session/refresh/offline-unlock design. Native SecureStore is not interchangeable with browser localStorage. Never clear unsynced owned captures as a credential cleanup shortcut.

### H5 — Mobile download's inventory catalog bypasses work-order pricing redaction

**Classification:** source-confirmed redaction inconsistency; permission-specific integration test required.  
**Affected path:** enabled-project mobile download.

**Evidence**

- H: `server/routes.ts:9320–9337` returns `inventory.items` directly from the inventory state.
- H: `shared/inventory.ts` item schema includes cost/billing/vendor attributes.
- H: `server/inventoryRoutes.ts:466–497` deliberately strips `cost`, `billingRate`, and `vendorId` from work-order inventory responses for users without pricing authority.

**Impact**

An API can expose fields even if the mobile UI ignores them. A normal technician's bootstrap should not become a way around the narrower work-order inventory DTO.

**Reproduction**

In an isolated fixture, compare mobile download against work-order inventory as a technician with view/assign but without maintain/configure/purchase authority.

**Recommendation**

Use a shared field-safe catalog projection in every technician bootstrap. Test absence of restricted fields, not merely hidden pricing controls.

### H6 — Current GPS policy contracts are not implemented by the mobile wizard

**Classification:** source-confirmed compatibility gap with current host settings; not proof that the user's current project configuration is failing.

**Evidence**

- H: `shared/schema.ts:84–88,129–134` uses `automatic | manual_step | disabled`, old-GPS reuse and maximum-accuracy settings.
- M: `client/contexts/WorkOrderContext.tsx:175–212` uses an internal `manual` value; `:534–545` merges server settings without an explicit enum translation.
- M: `client/screens/WorkflowWizardScreen.tsx:244–245,284–285` shows the manual GPS step only for `manual`.
- H: `shared/gps-capture.ts:3–10` defines structured source/accuracy/time/receiver evidence; H: `server/routes.ts:9348–9357` advertises GPS contract version 2.
- The inspected mobile contexts/wizards do not implement `wizardReuseOldGps`, `wizardGpsMaxAccuracyMetres`, or the structured `gpsCapture` contract.

**Impact**

A current server's `manual_step` may not display the intended step. Coordinate strings alone cannot demonstrate required accuracy, native receiver origin, capture time, or authorized old-GPS reuse.

**Recommendation**

Add a versioned settings adapter, preserve legacy cached `manual` compatibility, and map native fixes to the host's structured contract. Do not falsify accuracy or acquisition metadata. Treat this as project-policy compatibility, not a reason to redesign the existing wizard.

### H7 — Mobile inventory completion needs an explicit replay/assignment contract

**Classification:** source-confirmed integration gap; unknown-outcome reproduction required before choosing the transport.

**Evidence**

- H: `server/routes.ts:58–63` parses `inventoryUsage` for mobile completion paths.
- H: `server/inventoryService.ts:449–467` requires usage with UUID `operationId`, allocation `revision`, mode, used allocations and dispositions; it checks existing completed use.
- H: `server/changeoutService.ts:98–108` uses a stable submission identity and assignment version when supplied.
- H: `server/routes.ts:4443–4444` forwards those identifiers on the web path; inspected mobile paths at `:9643,9857,10020,10338` pass usage without the same explicit submission-ID forwarding.
- M: mobile queue/completion models do not carry an inventory operation identity/dispatch version contract.

**Impact**

Adding stock deduction as a second client call after marking a work order complete creates a partial-success boundary. Retrying a request with a new identity can also lose reliable reconciliation after a server commit/client timeout.

**Recommendation**

Coordinate one documented mobile completion workflow with atomic server-side work-order/ledger effects, stable submission identity, allocation/assignment conflict checks and a safe confirmation/replay response. Reuse the existing ledger and completion services; do not build a parallel client ledger or assume web and mobile bodies are interchangeable.

## 5. Medium-priority findings and risks

### M1 — Local capture and queue persistence are not one atomic operation

**Classification:** durability risk, not a reproduced data-loss incident.  
**Evidence:** M: `WorkOrderContext.tsx:1186–1193` starts an unawaited storage write; M: `NewWorkOrderWizardScreen.tsx:944–967` queues separately. M: `client/lib/pending-actions.ts:62–74` serializes queue writes but does not make two independent stores transactional.  
**Impact:** process death/storage failure between writes can leave an unmatched row or action.  
**Recommendation:** retain existing captures; introduce transactional ownership/outbox persistence for the new multi-entity inventory path, with crash injection tests. Any legacy migration must be non-destructive and separately approved.

### M2 — Large contexts and duplicate sync entry points increase integration risk

**Classification:** maintainability risk / incremental improvement.  
**Evidence:** M: `WorkOrderContext.tsx`, `OfflineContext.tsx`, both large wizard screens; M: `AutoSyncManager.tsx:26–74` and `SyncScreen.tsx:82–113`.  
**Impact:** inventory added independently to automatic/manual paths can behave differently or race hydration/remapping.  
**Recommendation:** extract small typed adapters, owner-scoped repositories and one operation reconciler around existing callbacks. Do not rewrite the working offline workflow.

### M3 — Base64 media magnifies offline storage and interruption risks

**Classification:** scaling/durability risk; device storage limits not measured.  
**Evidence:** M: work-order and pending completion models retain `beforePhotos`, `afterPhotos`, `troublePhotos`, and signature data; offline tests exercise synthetic base64 payload retention.  
**Impact:** full offline inventories plus many media captures can enlarge JSON writes and make eviction/failed writes more consequential.  
**Recommendation:** measure realistic route workloads. For new storage, keep durable local media references and checksums with journaled upload state; retain originals until the server confirms durable attachment. Do not convert existing media destructively during the inventory upgrade.

### M4 — Diagnostics can expose work identifiers and request details

**Classification:** confirmed diagnostic behavior; operational privacy risk.  
**Evidence:** M: `WorkOrderContext.tsx:769–786,1234` logs request details/error snippets or lookup identifiers.  
**Impact:** equipment/work identifiers and server context can reach device logs or exported diagnostics.  
**Recommendation:** use metadata-only production diagnostics and explicit redaction; do not log passwords, complete payloads, photos, signatures, GPS or raw customer records. This review did not run a comprehensive security scanner.

### M5 — Native installation success is not established by updater success UI

**Classification:** validation gap; not confirmation of a broken APK.  
**Evidence:** M: `client/components/UpdateAvailableModal.tsx:116–143`; `BUILD_ANDROID.md:60–116`; `app.json:10–23`; `eas.json:2–16`.  
**Impact:** downloading or launching an installer does not prove a signed replacement installed successfully.  
**Recommendation:** retain `com.meterflo.mobile`, original signing continuity and monotonically valid version codes. Test signed replacement, install-source permissions, installer cancellation, Play Protect, signature mismatch and version mismatch separately.

### M6 — Full-project type/native compatibility is not established

**Classification:** reported baseline failure and validation limitation.  
**Evidence:** supplied brief reports `server/index.ts(25,54)` TS7006. Lockfile resolves Expo 57.0.26, React Native 0.86.3, NetInfo 12.0.1, AsyncStorage 2.2.0, Reanimated 4.5.1 and Worklets 0.10.1.  
**Impact:** version declarations and peer ranges do not prove device or installer compatibility.  
**Recommendation:** reproduce a clean lockfile installation and full type/native checks in the mobile project before release. The existing TS failure is not an inventory regression and was not fixed here.

### M7 — Route labels and one-address map links are not route-plan support

**Classification:** feature gap.  
**Evidence:** M: `WorkOrderContext.tsx:228–281` retains a route label; M: `WorkOrderDetailScreen.tsx:200–219,398` opens maps for an address. H: `server/routing/routes.ts:118–181` implements real dispatched route lifecycle.  
**Recommendation:** cache authorized ordered route plans, appointment constraints and expiry; open server-reviewed destinations using native/external navigation. Do not recreate optimization from the route-name field or claim offline turn-by-turn maps.

## 6. Lower-priority opportunities

- Build a small compatibility/contract test suite before splitting large contexts. A broad architectural rewrite is not justified by this review.
- Use common scan acceptance and accessible progress/error components for new inventory steps, while preserving established non-inventory capture.
- Hide unauthorized actions entirely; retain explanatory state when a technician can view work but cannot yet start it.
- Validate phone/tablet layout, screen-reader labels, focus/keyboard behavior, Back navigation, media permissions and contrast on real devices. Source inspection is not a completed accessibility audit.
- Keep mobile reference/catalog loading bounded and paginated; avoid downloading the entire warehouse aggregate/history to provide one vehicle's stock.
- Review backup/export encryption and sharing policy before adding inventory exports to mobile; do not export passwords or silently include all projects.

## 7. Existing behavior specifically worth retaining

1. Exact readings use strings with independent 0–6 limits: M: `client/lib/reading-precision.ts:12–26,53–88`.
2. Settings cache is scoped by server/user/project, and unavailable-server capture differs from authorization failure: M: `client/lib/project-settings-repository.ts:21–38,52–93`.
3. Upload requires fresh reading-policy validation; offline capture may use the selected identity's cached policy.
4. Matching sequence is old system, old module, new system, new module; failures/conflicts stay available: M: `OfflineContext.tsx:413–420,523–575,597–725,900–928`.
5. Claims precede their dependent completions; equivalent claims are cleaned persistently without deleting distinct captures.
6. Automatic and manual sync reconcile local/server identities and preserve media/GPS/signature metadata.
7. **Add Work Order** remains available for capture without a downloaded work order: M: `WorkOrdersScreen.tsx:559–575`.
8. The normal offline banner and confirmations must remain; do not add a routine cached-settings warning to every wizard page.
9. Equipment scope, reading-only mode, quiet input prevention, old-reading first-focus behavior and historical exact values remain protected.
10. The host's field-use shortage exception must remain available: legitimate physical installation can complete when bookkeeping quantity is short, while recording an auditable inventory discrepancy. This is not permission to consume a serial already occupied, held, reserved for another owner, or recorded elsewhere. H: `shared/inventory-stock-discrepancies.ts:37–80`; the engine uses this distinction for field use, not warehouse picking.

## 8. Checks actually performed

| Check | Result | Scope / limitation |
|---|---|---|
| Uploaded ZIP safety/integrity inspection | 109 entries; extracted only to a temporary directory | No extraction over application source. |
| Manifest SHA-256 verification | **107 listed source files, 0 mismatches** | Integrity against the supplied manifest, not a malware/security certification. |
| Mobile targeted tests | **67 passed; 0 failed/skipped** | Re-run against extracted source using available workspace `tsx`/TypeScript via `NODE_PATH`; no fresh mobile dependency install. |
| Host dispatch/capability unit tests | **13 passed; 0 failed/skipped** | `tests/inventory-dispatch.test.ts` and `tests/work-order-inventory-capabilities.test.ts`; no live/customer database use. |
| Independent source review | Completed | Static mobile architecture/auth/queue/native review plus host contract comparison. |
| Mobile full TypeScript check | Not re-run | Brief's TS7006 baseline is reported, not a new result or a type-clean claim. |
| Android/iOS device, APK, signing, camera/GPS/HID | Not run | Source review and unit tests cannot establish native behavior. |
| End-to-end mobile against current host | Not run | Requires coordinated synthetic fixtures and native/web harness; no real credentials used. |
| Security/dependency audit, production inspection | Not run | No statement that production is secure or that reported APK symptoms are reproduced. |

Commands:

```sh
# In the extracted mobile source, using the existing workspace toolchain:
NODE_PATH="<workspace>/node_modules" "<workspace>/node_modules/.bin/tsx" \
  --test tests/reading-precision.test.ts tests/offline-capture.test.ts

# In the current host source:
npx tsx --test tests/inventory-dispatch.test.ts \
  tests/work-order-inventory-capabilities.test.ts
```

## 9. What remains uncertain

The host implementation is available here; its contracts are not generally “missing.” What remains unverified is deployment/native integration: which host versions the installed mobile fleet uses, effective permissions/settings on those instances, signed-device replacement, current mobile transport authentication/SSE behavior, representative offline storage capacity, and the final contract changes needed for dispatch visibility and completion replay.

The two companion documents turn those uncertainties into explicit phase gates rather than asking the mobile agent to invent policies.
