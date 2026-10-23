# MeterFlo Mobile — open questions and implementation gates

These questions distinguish decisions still needed from behavior already established by the user/server. They are not requests for passwords, API keys, signing files or production records.

**Phase 0 update:** `SERVER_PHASE_0_RESPONSE.md` corrects the original download finding and confirms the existing field-first, deferred-inventory completion design. Read that response before treating any earlier suggested API addition as necessary.

## 1. Already settled — do not ask the mobile agent to reinvent these

- The existing inventory-disabled mobile workflow works and must remain compatible.
- The requested upgrade concerns inventory-enabled technician operation.
- Disabled projects retain ordinary direct/group work assignment; completed work drops from other techs' active lists.
- Enabled material work follows fulfillment and the effective vehicle crew, not the entire bulk group pool.
- Ready staging and vehicle handoff are different. A pickup notice is not permission to install.
- Multiple technicians/multiple authorized vehicles and helpers must be supported. Individually scheduled work may still require reassignment.
- Technicians need planned additions, pickups, vehicle stock, received route plans/maps and sufficient downloaded information for offline capture.
- Planning does not automatically reserve or consume stock.
- The approved field quantity-shortage/discrepancy path must not become a blanket mobile completion block; duplicate/other-owner serial protection remains.
- Project settings and independent 0–6 decimal limits are server-owned; preserve exact strings.
- Notifications are required while the app is open, not when it is closed.
- Unauthorized warehouse controls should not appear in the technician interface.
- Use current relational host inventory and existing server authority; do not replace the database.
- The assignment is review/planning only. No source change, deployment, APK build, credentials change or data migration has been authorized by this review request.

## 2. Gates before Phase 0 is complete

### Q1 — Which host versions must the upgraded mobile app support?

**Why:** customer-owned/standalone instances may be updated independently. The ZIP's mobile version does not establish host API compatibility.  
**Need:** sanitized version/contract support matrix, including whether an additive host update can precede the native release.  
**Recommendation:** additive host changes first; capability negotiation and a legacy disabled-project path. Do not require simultaneous deployment everywhere.

### Q2 — What is the first-release visibility reconciliation contract?

**Why:** current mobile deltas are based on work-order timestamps; inventory and crew changes can affect visibility independently. The helper's dispatch metadata is not currently carried through mobile download.  
**Need:** agreement on additive dispatch DTO plus full authorized-list reconciliation, or a versioned cursor/manifest/tombstone implementation.  
**Recommendation:** correct full reconciliation on foreground inventory events first, then measured incremental optimization. Preserve unsynced captures separately.

### Q3 — What is the authoritative mobile completion/replay transport?

**Why:** existing mobile usage parsing, web completion identity handling and deferred completion services are not identical contracts.  
**Need:** exact request/response schemas, assignment/allocation revision meanings, replay outcome/receipt behavior, media ordering, and per-item batch failure handling.  
**Recommendation:** one stable owned submission with atomic host field-completion/evidence/job acceptance, then separately transactional backend inventory reconciliation and safe unknown-outcome recovery. Distinguish accepted work from pending/succeeded/failed inventory accounting. Reuse host services; do not invent client stock deduction or require inventory accounting to finish before acknowledging durable field completion.

### Q4 — What is the intended effective technician permission set?

**Why:** planning, field use and reservations are separate. `inventory.assign` does not mean `inventory.plan`; received routes currently require `workOrders.optimizeRoute`.  
**Need:** confirm role grants through normal administrator controls using synthetic users, including helpers and higher-authority users.  
**Recommendation:** least privilege and capabilities from server DTOs; no direct seeded permission shortcuts as acceptance evidence.

### Q5 — How will technician bootstrap data be redacted?

**Why:** current mobile inventory catalog returns item objects directly while the work-order inventory DTO strips restricted pricing fields.  
**Need:** one field-safe catalog contract and tests for technician versus manager responses.  
**Recommendation:** resolve before populating a new native offline catalog.

## 3. Product decisions required before sensitive offline work

### Q6 — What may a technician start while already offline?

**Known:** capture must remain possible offline, including Add Work Order without a downloaded server row. Upload needs fresh policy/authorization and must not invent dispatch.  
**Unresolved:** may a technician start an already-downloaded, last-known handed-off assignment without a live claim check? How should expired/stale dispatch evidence be presented?  
**Recommendation:** retain offline capture as local evidence; distinguish it from an authoritative new claim or stock commit. Agree the policy before Phase 2/6, including reassignment while a device is offline.

### Q7 — Is mobile expected only to receive route plans, or also optimize/create them?

**Known:** pull route plans and launch maps is requested; the host already supports received-route open/validation.  
**Unresolved:** technician-side optimization/dispatch management, offline map tiles or provider-specific embedded navigation are not requested explicitly.  
**Recommendation:** received plans and external/native navigation first. Do not expand scope automatically.

### Q8 — What offline download scope is practical?

**Need:** representative non-sensitive scale: work orders per day, vehicles per tech, items/serials per vehicle, typical photo counts/sizes, maximum days offline and minimum device storage.  
**Recommendation:** download authorized assigned work plus required policy/references/item definitions and selected vehicle/route snapshots; make completeness/freshness explicit. Avoid copying warehouse history or all fleet data to ordinary techs.

### Q9 — How should concurrent plan edits be resolved?

**Known:** additions are permitted with planning authority; existing overrides/covered stock cannot be silently erased.  
**Need:** conflict UI approval: reload/merge, line-level review, or manager resolution.  
**Recommendation:** retain the local draft, show revision conflict and require an explicit merge. Do not last-write-win the complete plan.

### Q10 — What are logout and ambiguous legacy-record policies?

**Need:** explicit distinction between locking an authenticated offline session and signing out/removing credentials; approved handling for records with unknown server/user/project ownership.  
**Recommendation:** do not retain browser-readable recoverable passwords by default; do not attribute ownerless captures to the next login or erase unsynced work. This policy change affects the baseline and needs separate approval.

### Q11 — Is a new transactional local inventory store acceptable?

**Need:** approval for a versioned local inventory/outbox store and a dependency compatible with the actual Expo/native toolchain.  
**Recommendation:** normalized transactional storage for new multi-entity inventory, retain existing work-order cache readers initially, and test crash-safe reversible migrations. Do not approve a blanket rewrite merely to add inventory.

### Q12 — What native report/QR sharing behavior is wanted?

**Known:** tech pickup details should show the ticket QR; authorized users can review/print vehicle stock.  
**Need:** desired native share/print/open UX and whether cached report sharing is allowed by policy.  
**Recommendation:** authenticated reports with scope/freshness labels. Never publish report URLs or treat a QR as access authority.

## 4. Device and environment prerequisites

These require access through normal approved workflows, not secret values in chat:

1. A synthetic test host running the agreed contract, with enabled and disabled projects, two technicians, a helper and an authorized warehouse/manager user.
2. Safe fixtures for staged/handed-off/partial/review batches, multiple vehicle memberships, scheduled and shared work, supplemental plans, kits/components, removed equipment and routes.
3. Physical Android devices covering the supported minimum/current OS, camera/GPS permissions, real HID scanner if used, and a device with an already installed signed MeterFlo version plus pending synthetic work.
4. The existing authorized signing/EAS distribution process and a controlled replacement-install test. No signing-key regeneration or uninstall workaround.
5. Sanitized information about any native-only modifications omitted with generated `android/`/`ios/` directories if the change depends on them.
6. iOS target/device scope if iOS is actually supported; a browser pass is not native evidence.
7. Connectivity tests for no network, Wi-Fi without internet, reachable network with host unavailable, authentication expiry, background/resume, app kill, low storage and interrupted upload/install.
8. Fresh lockfile installation and native compatibility validation in the mobile project; reproduce the documented full-project TS baseline separately.

## 5. Not established by this review

- Whether a currently installed production APK is defective.
- Whether a particular Play Protect or EAS callback symptom still reproduces.
- Whether current customer devices have all intended role grants/settings.
- Whether deployed host versions match this workspace.
- Whether provider browser keys support any proposed native map embedding.
- Native storage/media capacity and app upgrade behavior on real devices.
- End-to-end completion replay under the new inventory contract.

## Recommended first decision

Approve the **Phase 0 contract/parity work** before user-facing inventory changes: carry authoritative dispatch/startability through mobile sync, reconcile inventory-only visibility changes, sanitize the technician bootstrap, and freeze the additive completion contract. Those decisions let the mobile agent implement the requested features without guessing how staging, handoff, permissions or offline stock commits should behave.
