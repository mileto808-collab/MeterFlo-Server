# Mobile physical-changeout inventory source bundle

## Start here

This is a current workspace **source-reference bundle**, not a new API, a runnable mobile app, or proof that these changes have been published. It contains no database dump, live customer response, credentials, environment files, logs, uploads or Git history.

Implement inventory inside the physical system/module changeout screens in both applicable mobile wizards, not just Work Order Details → Inventory. Preserve existing mobile behavior when inventory is disabled.

### Included

- The four requested shared helpers and **complete shared/inventory.ts**, retaining original schemas/types rather than a hand-edited partial definition.
- **client/src/components/inventory/actual-use-collector.tsx** unchanged.
- **reference/system-changeout-wizard.inventory-excerpts.md**: verbatim web wizard inventory imports, step construction, initialization/defaults/source state, equipment-ID binding, validation/rendering cases and submission envelope, with original line ranges.
- **reference/work-order-inventory-route.ts.txt**: the current GET route implementation.
- All recursively referenced local shared/client dependencies of the included source roots, including type-only and import-type dependencies. **DEPENDENCIES.json** lists each file's local dependencies and external package names.
- Relevant existing mobile contracts under **docs/**.
- **examples/technician-work-order-inventory.json**: a complete synthetic GET response for an authorized, non-admin technician. The complete top-level key set is checked against the current route's returned object.
- **examples/technician-context.json**: the explicit example grants, project settings and assignment context. Every identifier, serial, vehicle detail and address in these examples is synthetic; no customer response was fetched.
- **MANIFEST.json**: source roots, bundled file sizes and SHA-256 hashes.

The excerpts are reference text, not a standalone compilable component. UI helper dependencies belong to the unchanged collector; the excerpts also refer to the surrounding web wizard's state and non-inventory UI. External React DOM, Radix and browser camera helpers demonstrate web behavior; port their behavior to native equivalents rather than importing DOM UI into React Native. Install only dependencies actually needed by the native port. Do not import all shared management modules just because they appear in the type closure.

## Technician access and source choices

The synthetic technician has work-order view/edit, inventory view/assign and plan permissions, but **no maintenance, configuration, warehouse transfer/receive, reserve, override-plan or pricing authority**. This is an explicit example, not a default grant or a role-name rule.

- Honor real permission results, server work-order visibility, assignment version, inventoryDispatch and capabilities.
- `canManageInventory` in this response means broad inventory-view access; it does not grant every management action.
- Planning capability and field actual-use capture are separate. The web collector checks **inventory.assign** for actual-use capture.
- The example's `canChangeFieldStock` is false: ordinary technicians do not get source/fulfillment configuration overrides.
- Resolve the configured source using **resolveFieldStock**, dispatch vehicle, membership/access rules and preserved reservations. Do not offer every warehouse or fall back silently to the main warehouse.
- Existing reservations retain their source, quantity limits and any allowed serials. No stock movement occurs just by selecting, scanning, adding planned inventory or proceeding between wizard screens.
- Users lacking broad inventory view may receive a narrower work-order response: fieldSettings can be omitted, warehouses reduced and canSelect false even when canPlan is true. Never treat this richer example as a universal shape or infer elevated access from cached data.

## Physical system/module screen

Use effective **requirements.lines**, not just manual plan.lines. Present item names/SKUs, planned quantities, actual quantities, approved source and applicable kit/component details as the web collector does.

1. Build defaults through **plannedUseDrafts / initialActualUse** and the approved fulfillment mode.
2. Preserve actualUse local draft captures, including reserved/maxQuantity/allowedSerials, across Next/Back, refresh, offline recovery and server rechecks.
3. Do not debit both an assembled kit and its components. Preserve kit identity/component lineage; componentTrace is evidence, not an invented serial assignment.
4. A simple serialized system/module, with quantity one and no components, binds its serial to the later installed system/module ID via **bindWizardEquipmentSerials**. Do not demand a duplicate scan here. Other serialized items/kits need their own serial capture.
5. Apply whole-number quantity rules and exact unique serial counts/allowed serials. Reject duplicates and invalid entries; do not show unverified offline stock as live verified availability.
6. Defaults refresh must be explicit and non-destructive to readings, photos, GPS, notes, signatures and captured device IDs. Do not silently rebase saved captures when source/policy/requirements change.
7. Project reading decimal settings are independent for system and module. Preserve zero precision, exact reading text and existing editing rejection rules; never round/truncate a scan to make it valid.

The generator verifies that the synthetic example resolves to the technician's vehicle, produces valid bound system/module actual use, and rejects a serial outside the reservation.

## Removed-equipment review

Follow **removalChoices(..., equipment, "field")**, fieldRemovalChoices, removal policy revisions and equipment scope. A warehouse-only final disposition must not become a technician choice.

Only request removal information for actually replaced old equipment applicable to the selected workflow. Capture rule ID/revision, policy revision, serial and required authorized return destination. The example includes a staging-type returns location: do not hardcode the main warehouse.

Field return capture is intent/evidence; it is not confirmation of physical warehouse receiving. Separate the field capture from later warehouse inspection/release/scrap/customer-return authority.

## Submission, offline and validation

- Follow docs/MOBILE_SUBMISSION_CONTRACT.md and the changeout addendum for the existing completion endpoints, envelope and recovery rules. inventoryUsage includes actual used rows, dispositions and capture; it is not a plan command or vehicle-transfer command.
- Bind new equipment IDs before constructing the final inventoryUsage.
- Preserve immutable submission identity, assignment version and exact attempted payload until an authoritative matching outcome resolves uncertainty. Do not generate a new attempt identity just because a timeout occurred.
- Preserve the field-first distinction between accepted field completion and pending inventory reconciliation. Do not invent a blanket rule that bookkeeping shortages always prevent legitimate field completion; never bypass access or serial ownership rules.
- Required entry/serial/reading validation must happen at the proper step. Some web canProceed cases are permissive; these are **not permission to replicate missing validation** in native UI.
- Opening or advancing a step starts at its top. Highlight required entries without focusing inputs or popping the mobile keyboard.
- Offline snapshots are not current authorization, a new reservation or proof of current stock. Keep genuine uncertainty visible and preserve captures for recovery.

## Read order and acceptance

1. README.md (this file).
2. docs/CHANGEOUT_WIZARD_INVENTORY_ADDENDUM.md.
3. Synthetic response and explicit technician context.
4. Shared source helpers, collector and wizard excerpts.
5. Existing read/submission/planning/recovery contracts as needed.

Use the addendum's acceptance checklist for both mobile wizards: inventory-disabled, system-only/module-only/both, component vs assembled-kit use, reserved serials, non-admin field capture, changed defaults, removed-equipment choices, reading precision, offline recovery, interrupted submissions and correct vehicle dispatch visibility.

No server or web application behavior was changed to create this bundle. Verify the target server's published version before native acceptance; workspace source is not evidence of deployment.
