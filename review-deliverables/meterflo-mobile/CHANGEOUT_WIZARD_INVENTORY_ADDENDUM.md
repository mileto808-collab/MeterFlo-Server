# MeterFlo mobile — inventory inside the physical changeout wizard

Source review: 2026-10-23.

## 1. Required result

**For inventory-enabled projects, display and capture inventory inside the physical changeout workflow, as the current MeterFlo web wizard does. A Work Order Details → Inventory panel alone does not satisfy this requirement.**

This is an explicit screen-level supplement to Phase 6 of `UPGRADE_PLAN.md`. It is not a request to redesign the mobile app's working non-inventory workflow.

Deliver:

1. An actual-use inventory section **on the Physical Changeout screen**, not only in an optional details tab.
2. Correct association of installed equipment IDs with applicable inventory serials.
3. A dedicated **Inventory Use & Removed Equipment Review** before final confirmation.
4. Retained offline captures, project-specific settings, server-authorized source choices and replay-safe completion.
5. No changes to existing inventory-disabled behavior.

Native layout may differ from the browser, but the workflow, meaning of quantities, permissions and safety boundaries must match. No warehouse receiving, staging, transfer, count or final-disposition administration is being added to the technician wizard.

### Authority and related documents

- `UPGRADE_PLAN.md`: overall upgrade, dispatch, settings, offline scope and acceptance.
- `MOBILE_READ_CONTRACT.md`: authorized reads, full/delta reconciliation and cache invalidation.
- `MOBILE_SUBMISSION_CONTRACT.md`: implemented completion transports, immutable attempt IDs, outcome recovery and acknowledgements.
- `WORK_ORDER_INVENTORY_PLANNING_CONTRACT.md`: full work-order inventory read response, manual planning writes, capabilities and restrictions.
- `INVENTORY_PLAN_RECOVERY_CONTRACT.md`: uncertain manual-plan saves; separate from changeout completion recovery.
- `PICKUPS_VEHICLE_STOCK_HANDOFF.md`: pickup/vehicle response types and existing ticket QR contract.

This addendum describes current web behavior and required native integration. It does **not** establish which revision is published. No deployment was performed for this document. Check the actual configured server's advertised read/submission versions and responses; do not infer availability from a document or role name.

## 2. First preserve the working baseline

| Context | Required behavior |
|---|---|
| Inventory disabled | Keep existing assignment, navigation, changeout, reading-only, offline, media and submission behavior. Do not require inventory endpoints, vehicles or replacement stock. |
| Inventory enabled, changeout path | Add the in-flow inventory sections below. |
| Inventory enabled, reading-only path | Preserve reading-only capture. Do not consume replacement stock or manufacture removed-equipment events. |
| `wizardMode = user_choice` | Determine the selected path first; apply inventory-use integration only to the applicable successful changeout path. |
| Unable to change / Trouble | Preserve Trouble evidence and reporting. Do not infer an installation or inventory consumption from a Trouble report. |
| System / module / both | Show only the applicable equipment controls, without deleting hidden historical fields or prior evidence. |

Do not reconstruct the technician's active list from bulk group membership when inventory dispatch applies. Use server-authorized downloads, assignment versions and `inventoryDispatch`. Staging stock is not onboard stock. A ready pickup or a QR code is not a vehicle handoff or installation authorization.

For inventory-disabled projects, preserve the existing group pool: group-assigned work is available to the group's technicians and completed work leaves everyone's active list. Inventory-specific dispatch restrictions must not leak into that path.

## 3. Read and retain the right context

### Existing server reads

| Request | Wizard use |
|---|---|
| `GET /api/projects/:projectId` | Authorized project settings, including enablement, workflow/equipment selection, decimal precision, GPS, timezone and optional step policy. |
| `GET /api/projects/:projectId/mobile/sync/download` | Authorized work and supporting mobile bootstrap/reference/visibility data. Follow the complete/full versus delta contract. |
| `GET /api/projects/:projectId/work-orders/:workOrderId/inventory` | Work-specific inventory context: requirements, manual plan, reservations, item definitions, authorized locations, field defaults, removal rules and server capabilities. |

The full work-order inventory response is specified in `WORK_ORDER_INVENTORY_PLANNING_CONTRACT.md`. Do not replace it with a guessed reduced response or assume that an item/vehicle directory alone contains enough data for actual use.

The web wizard uses these response members:

- `enabled`, `revision`, `inventoryDispatch`;
- `requirements`, including effective `lines` and unmapped `missing` types;
- `allocation`, including reserved lines and their locations/serials;
- `items`, `warehouses`, `locationTypes`;
- `fieldSettings`, `canChangeFieldStock`;
- `removalRules`, `removalPolicies`, `workflow`.

The planning response also supplies manual plan and planning capabilities. Preserve them without conflating manual additions, automatic requirements, reservations, actual use or historical consumption.

Cache the complete authorized wizard context needed for downloaded work. Persist its owner/server/project/work-order/assignment scope, fetched time and relevant revisions. If the download does not supply the full wizard context, fetch and persist the authorized work-order inventory response while online; do not assume bootstrap contains every field. Coordinate download size/paging with the existing offline design.

### Settings that affect the screens

| Setting | Required interpretation |
|---|---|
| `inventoryEnabled` | Per-project gate, not a global app flag and not inferred from stock existing. |
| `wizardMode` | `changeout`, `reading_only`, `user_choice`. |
| `changeoutEquipmentType` | `system`, `module`, `both`, `user_choice`; controls applicable replacement equipment. |
| `readingEquipmentType` | Independently controls reading scope; do not choose precision from an internal input slot's name. |
| `systemReadingDecimalPlaces` / `moduleReadingDecimalPlaces` | Independent integers 0–6; preserve explicit zero. Legacy missing-value defaults are 3, not proof a failed settings request succeeded. |
| Field stock `sourceMode` | `assigned_vehicle` or `project_warehouse`. |
| Field stock `warehouseId` | Configured location identity when project-warehouse mode applies; not a hardcoded main warehouse. |
| Field stock `fulfillment` | `components` or `kits`. |
| GPS, timezone and optional photo/notes/signature settings | Preserve existing project-controlled steps and evidence requirements. |
| Removal rules/policies and their revisions | Approved field choices, applicable equipment and any required return behavior. |

## 4. Screen-by-screen integration

The browser's successful changeout sequence is:

Optional mode selection → Can Change → Old Reading → optional Before Photos → **Physical Changeout** → **New Equipment IDs** → New Reading → optional After Photos / GPS / Notes / Signature → **Inventory Use & Removed Equipment Review** → **Final Confirmation**.

Keep the mobile app's established optional-step ordering unless a project policy requires otherwise. The three bold inventory integration points and final confirmation are mandatory coverage, not necessarily identical native page titles.

### A. Open, choose mode, claim and restore

- Use the server's visibility/claim rules and authoritative assignment version.
- Restore an existing owned capture before calculating fresh default rows.
- Prepare authorized project and work-order inventory context. Show loading, unavailable or stale/offline state honestly.
- Never replace an existing meaningful capture merely because a refresh returns different requirements or defaults.
- A resumed attempt needs its saved quantities, serials, selected source, removed-equipment choices, evidence and current step.
- If access or assignment changed, preserve prior captures but do not treat the old attempt as currently authorized to submit.

### B. Old readings and before evidence

Keep existing capture and confirmation behavior. Inventory is not a reason to change old-device baseline data or add stock movement here.

Reading rules:

- Keep captured readings as exact text, including leading zeros and trailing fractional zeros.
- Normalize an accepted comma decimal separator to a dot.
- Quietly reject an edit/paste exceeding configured fractional digits, retaining the previous input. Do not round, truncate, pad or coerce it through JavaScript `Number`.
- Preserve intermediate editable text; final required reading validation still applies.
- In module-only capture, use module precision even if a legacy mobile field is internally named for a system.
- Stock quantities are integers; reading decimal precision does not apply to inventory quantities.

### C. Physical Changeout — show actual-use inventory here

Retain the physical-work instructions and prior evidence summary. Beneath them, show the inventory collector without forcing the technician to leave the wizard.

The collector must communicate:

1. **Effective source:** readable vehicle/location name and code, not an unexplained UUID.
2. **Stock representation:** approved loose components or preassembled kits.
3. **Expected work requirements:** item name/SKU/unit and effective required quantity, with missing type mappings identified.
4. **Existing reservations:** their original item, location, quantity and serial constraints.
5. **Actual use:** editable actual quantities and applicable serial capture for what was physically used.
6. **Applicable additions:** active non-labor items allowed by the current context and kit/component rules, not unrelated warehouse administration.
7. **Context state:** current versus cached/unverified data, unavailable source or mappings, and retained-input conflict/recheck actions.

Use the existing effective requirements rather than rebuilding them from the manual plan alone. Automatic requirements and overrides must remain intact.

Initialize actual use from the current reservation when present; otherwise initialize from effective requirements and the resolved source/fulfillment representation. Restore a meaningful capture instead of reinitializing it.

Actual-use edits are **not** planned-inventory saves. They remain capture data until the existing completion protocol accepts them. Do not call `action: "plan"` to save actual use. Do not debit, reserve, stage, hand off or return inventory merely by opening the screen, changing a quantity, scanning or advancing.

#### Source selection

- Honor the dispatched vehicle context and source policy; do not simply take the first vehicle in the directory.
- In assigned-vehicle mode, use the authorized effective vehicle. If multiple authorized vehicle choices require a choice, make it explicit.
- A normal technician's source choices are not every project location.
- Broader source or fulfillment overrides require the server's `canChangeFieldStock` capability and current authorized locations.
- Existing reservations retain their sources and stock handling. Do not silently move them to the latest default.
- A short vehicle balance must not silently fall back to main-warehouse stock.
- Location access/type changes during capture require revalidation, not silently discarding the entered data.

#### Kits, quantities and serials

- Represent a kit as the selected stock representation requires. Never deduct both the finished kit and its component contents for the same use.
- Keep immutable assembled-kit lineage where provided; do not infer historical contents from today's recipe.
- Accept nonnegative whole quantities; omit zero-use rows from submitted `used` lines.
- Reserved rows must retain their applicable quantity/serial limits. A legitimate bookkeeping quantity shortage is not permission to bypass reservation, ownership or access rules.
- For serialized consumable/kit rows requiring their own serial capture, require unique serials matching positive quantity.
- Reject local duplicate/malformed/excess scans immediately. If current eligibility cannot be established offline, label it unverified rather than green/currently approved.
- Do not invent a serial-validation endpoint or treat an onboard-stock listing as proof of installation eligibility. Server ownership/access checks remain authoritative.

**Important sequencing:** the web wizard's simple serialized system/module rows of quantity one take their installed serial from the later New Equipment IDs step. Do not demand a second earlier scan or block Physical Changeout for a value deliberately captured on that later step. Serialized kits and other items do not automatically inherit the system/module ID.

#### Current project defaults changed

The web offers “Review current project defaults,” followed by an explicit Apply/Keep decision:

- Preview the newly approved source, representation and resulting rows before applying.
- Do not automatically apply new defaults over local work.
- Preserve inventory serials only for unchanged item/quantity/source combinations.
- Changed rows or kit handling may require new inventory serial captures.
- Preserve equipment-ID scans, exact readings, photos, GPS, notes, signature and removed-equipment captures.
- Do not use this action to rewrite existing reservations.

### D. New Equipment IDs — bind the installed serial once

- Preserve the existing system/module/both scan/manual-entry behavior.
- For a simple serialized inventory item with no component contents, matching equipment kind and quantity exactly one, bind its inventory serial to the corresponding captured new system/module ID.
- Refresh the bound inventory value if the technician explicitly corrects that installed ID; do not erase unrelated captures.
- Do not bind a kit's own serial, a multi-quantity row, unrelated serialized parts or the other equipment kind this way.
- Do not overwrite the installed ID from a guessed SKU, QR ticket, warehouse label or kit serial.
- Prevent duplicates locally where determinable; never declare server ownership checks complete based only on a cached device list.

The reference algorithm is `bindWizardEquipmentSerials` in `shared/inventory-wizard-use.ts`.

### E. New readings, after evidence, GPS, notes, signature

Keep the project-controlled steps and validation. Apply the independent reading precision rules above. Do not force a warehouse operation or stock posting between evidence steps.

Captures must survive Back, device lock, refresh/restart and returning from camera/GPS/maps. Step transitions should start at the top, not focus an input and open a mobile keyboard. Highlight required inputs without stealing focus; manual tapping or explicit scanner activation selects input.

### F. Inventory Use & Removed Equipment Review

Add a dedicated step before final confirmation, as the web wizard does.

Show:

- Positive actual-use rows, quantities, source names/codes and relevant serials.
- Any unresolved mapping, retained-input conflict, cached-data limitation or inventory issue needing attention.
- A clear way to return to Physical Changeout or New Equipment IDs to correct captures.
- Removed-equipment controls only for applicable old system/module assets actually being replaced.

For each replaced asset:

1. Start from the known old equipment serial, allowing explicit correction without rewriting the customer's baseline silently.
2. Present the project's approved **field** removal choices for that equipment.
3. Persist rule ID, rule revision and applicable policy revision, not just a displayed label.
4. If the selected outcome is `returned`, show the required authorized return-location choice.
5. If no approved choices exist, explain that configuration needs administrator attention; do not invent a disposal choice.

The outcome values are `returned`, `scrapped`, `left_onsite`; their project-approved labels and availability come from rules. A field decision is not unrestricted warehouse final-disposition authority.

Do not hardcode “main warehouse.” The selected location must reflect the approved context and physical custody. Recording removed-equipment intent in the changeout does not establish a later vehicle-to-warehouse receiving event. That physical return remains a separate authorized workflow.

Do not require removed-equipment data for hidden/inapplicable equipment, an absent old asset, an unchanged equipment ID, a reading-only path or a Trouble report.

### G. Final confirmation and submit

- Include a concise inventory-use and removed-equipment summary alongside existing field evidence.
- Offer recheck/recovery without requiring all prior evidence to be re-entered.
- Preserve required field integrity, serial ownership and access checks.
- Do not make a bookkeeping quantity shortage a universal block on legitimate completed field work. The server can record the approved stock discrepancy/reconciliation outcome.
- Keep validation tied to the step where a value is actually captured. Do not copy incidental browser `canProceed()` behavior as the entire native validation specification.
- If inventory context cannot currently refresh, retain captured work and communicate what remains unverified; do not silently mark stale stock/current authority as verified.

## 5. Permission separation

Use effective server permissions/capabilities, not role-name comparisons:

| Action | Boundary |
|---|---|
| Read vehicle stock | `inventory.view` plus server-authorized vehicle access. Not permission to install or transfer. |
| Capture actual field use | `inventory.assign` plus work-order/assignment/source/removal checks. The web shows an explicit permission message when absent. |
| Add planned inventory in details | `inventory.plan` plus applicable editable work-order context. Separate from actual use. |
| Override computed planned requirements | Additional `inventory.overridePlan`; ordinary additions must preserve existing overrides. |
| Change field source/fulfillment beyond ordinary choices | Server `canChangeFieldStock` and authorized location context. |
| Reserve, transfer, count, stage or make final warehouse disposition decisions | Separate authority; do not expose those actions to technicians merely because they have view/assign access. |

Hide irrelevant controls. When a required authorized action is unavailable, explain why and how to resolve it without deleting captures. Hiding controls does not replace server authorization.

## 6. Offline persistence and refreshed data

Persist locally, transactionally where appropriate:

- Server identity/origin, account, project, work order, assignment/attempt version and selected workflow/equipment scope.
- Project settings, complete authorized wizard context, basis/revisions, fetch time and stale/unverified status.
- Actual-use rows: stable row identity, item/source, entered quantity, inventory serials and applicable reservation constraints.
- Selected field source and whether an explicitly permitted override was chosen.
- Removed serials, chosen rules/revisions/policy and return locations.
- Exact readings, installed IDs, photos/files, signature, GPS, notes and time evidence.
- Current step, immutable submission identity/body and independent media/reconciliation acknowledgements.

Distinguish editable local capture, frozen pending submission, server-accepted field work and inventory reconciliation. Do not reuse a mutable draft as an immutable uncertain request.

On foreground/reconnect or an inventory/assignment invalidation:

1. Fetch using the initiating account/server/project scope.
2. Discard stale responses belonging to a different active owner/project.
3. Update reference/current-authority data without replacing meaningful local captures.
4. Detect changed requirements, reservations, dispatch/source/access, location types or removal policy.
5. Offer an explicit recheck/correction/defaults review. Keep every unrelated capture.
6. A fresh response does not retroactively authorize an old assignment attempt.

A failed read is not an empty successful stock/requirements result. Empty deltas are not complete visibility snapshots. Do not erase work because of a timeout or unauthorized refresh.

Never promise live verification while offline. Cached information is useful context, not a stock reservation or current authorization lease. Follow the existing upgrade plan's agreed offline start/claim policy; do not invent a new offline claim authority.

## 7. Completion payload and retry boundary

The wizard's captured actual use is carried by **the existing changeout completion**, not by a new warehouse transfer or manual-plan command.

Relevant payload fragment, with synthetic identifiers only:

```json
{
  "inventoryUsage": {
    "mode": "changeout",
    "used": [
      {
        "itemId": "example-meter",
        "warehouseId": "example-authorized-vehicle",
        "quantity": 1,
        "serials": ["EXAMPLE-NEW-0001"]
      },
      {
        "itemId": "example-seal",
        "warehouseId": "example-authorized-vehicle",
        "quantity": 2,
        "serials": []
      }
    ],
    "dispositions": [
      {
        "equipment": "system",
        "serial": "EXAMPLE-OLD-0001",
        "disposition": "returned",
        "warehouseId": "example-authorized-vehicle",
        "ruleId": "11111111-1111-4111-8111-111111111111",
        "ruleRevision": 2,
        "policyRevision": 3
      }
    ]
  }
}
```

This is **not a standalone valid completion request**. Real item/location/rule IDs and revisions must come from authorized server data. Existing required readings, equipment, evidence, attempt identity and assignment version still apply. The web capture also retains an optional `capture` object for draft/recovery (`actualUse`, `removedMeters`, `fieldSourceId`); do not substitute draft text rows for normalized `used` lines.

Follow `MOBILE_SUBMISSION_CONTRACT.md` for exact transport placement:

- Existing JSON completion: `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/complete`.
- Existing multipart completion: `POST /api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout`, with capture in the JSON `data` field and existing photo transport.
- Existing batch sync: `POST /api/projects/:projectId/mobile/sync/upload`, preserving each item's supported envelope.

Do not invent a new actual-use endpoint. Verify the chosen transport's current adapter and media behavior before wiring it; do not change request shape during a retry.

For the advertised versioned protocol, freeze `changeoutSubmissionId`, `changeoutAssignmentVersion`, capture/evidence and their original timestamps before first delivery. After timeout, disconnect, process death or an uncertain result, recover/retry that same attempt. Do not generate another UUID to escape a conflict.

Field acceptance and inventory accounting are separate outcomes. A durable accepted completion with pending/failed inventory reconciliation must not tell the technician to repeat the physical job or debit stock again. Retain original capture/media until the contract's matching acknowledgements permit cleanup.

Do not advertise these guarantees against a server lacking the required advertised protocol version. Preserve legacy inventory-disabled compatibility.

## 8. Required acceptance evidence

The mobile agent should report which cases were exercised, on which platform/server version, and which remain unverified.

1. **Disabled regression:** existing group work, changeout, reading-only, offline and evidence/submission paths remain unchanged; no inventory calls are newly required.
2. **Physical screen:** an enabled work order shows effective requirements and actual-use entry directly on Physical Changeout, not only Work Order Details.
3. **Scope:** system-only, module-only and both show correct inventory/equipment sections; reading-only and Trouble do not consume replacement inventory.
4. **Source:** one vehicle resolves correctly; multiple authorized vehicles require the applicable deliberate choice; dispatched vehicle and reservations are honored; no automatic warehouse fallback.
5. **Permissions:** a normal technician sees relevant use controls but not warehouse administration or unauthorized source/override controls.
6. **Equipment serial binding:** scan a new installed system/module once; the matching quantity-one serialized use row reflects it. Correcting the ID updates the binding without deleting evidence.
7. **Other serials:** kits/other serialized items require their own unique serials and correct quantities; no system-ID substitution, double kit/component use or falsely green offline verification.
8. **Removal review:** show the dedicated review step with approved field choices/revisions and authorized return locations; no hardcoded main warehouse or warehouse final-decision controls.
9. **Precision:** independent 0/3/6-place system/module settings; leading/trailing zeros survive restart/upload; excess digits retain prior input without truncation.
10. **Meaningful restoration:** restart/lock/navigate away during each inventory integration point; restore quantities, source, installed IDs, removed choices and all evidence.
11. **Defaults/conflicts:** change project source/kit settings or shared requirements while capturing. Refresh must not overwrite entries; explicit Apply/Keep and recheck preserve unrelated evidence.
12. **Authority changes:** vehicle access, dispatch, assignment/reassignment, completion elsewhere and removal-policy changes retain captures and produce correct revalidation/read-only handling.
13. **Quantity shortage:** legitimate physical work can reach the approved discrepancy/reconciliation path without fabricating stock; ownership/duplicate/held-serial restrictions remain.
14. **Uncertain completion:** disconnect before and after server acceptance; retry original identity/body; no duplicate work completion, stock movement, media or return event.
15. **Accounting review:** accepted field work with reconciliation pending/failure is clearly distinguished from rejected/unconfirmed submission.
16. **Small/short screens:** real touch portrait/landscape and short desktop-equivalent preview; all rows, scans, review information and footer actions can be reached without clipping or automatic keyboard activation on step entry.
17. **No side effects from capture:** opening, scanning, editing, Back/Next, rechecking and saving a local draft do not themselves reserve, consume, stage, transfer or return stock.

## 9. Current host implementation references

Paths refer to the server/web project, not files assumed to exist in the mobile repository:

| File | Reference behavior |
|---|---|
| `client/src/components/system-changeout-wizard.tsx` | Dynamic success steps; `physicalChange`, `newSystemId`, `inventoryReview`, `confirm`; draft restoration; defaults review; normalized completion usage. |
| `client/src/components/inventory/actual-use-collector.tsx` | Technician-facing actual-use rows, expected requirements, source/fulfillment controls, reservation handling and serial fields. |
| `shared/inventory-wizard-use.ts` | Initial/planned use, kits/components, inventory basis, reviewed defaults, equipment serial binding and local line validation. |
| `shared/inventory-field-stock.ts` | Configured defaults, source resolution and allowed field source/fulfillment rules. |
| `shared/inventory-removal-policy.ts` | Approved field choices, policy/revisions and equipment scope. |
| `shared/inventory-location-types.ts` | Location kind/access semantics; do not assume fixed English names. |
| `shared/work-order-inventory-capabilities.ts` | Server capability derivation; distinguish planning, actual use and administration. |
| `shared/reading-precision.ts`, `shared/exact-readings.ts` | Exact text, independent precision and compatibility behavior. |
| `shared/inventory-dispatch.ts` | Dispatch projection types; use server-authorized visibility rather than recreating group logic. |
| `shared/mobile-read-contract.ts`, `shared/mobile-submission-contract.ts` | Versioned mobile metadata and submission normalization. |
| `server/changeoutService.ts`, `server/mobileSubmissions.ts` | Accepted field evidence, identity/ownership and immutable submission recovery. |

If the mobile repository lacks a needed source/type or its live server response differs, request the specific current definition. Do not approximate policy from UI screenshots or invent a stock-posting protocol.
