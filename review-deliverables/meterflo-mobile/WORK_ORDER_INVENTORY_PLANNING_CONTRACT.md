# MeterFlo work-order inventory planning contract

Source-reviewed: 2026-10-23.

This document describes the implemented server contract, not a proposed API. It is intended for the separately maintained mobile app. No server or mobile application code was changed to produce this document.

## 1. Scope and publication

Implement manual planned inventory additions in Work Order Details → Inventory for inventory-enabled projects. Keep the existing inventory-disabled mobile workflow unchanged.

Planning is demand, not physical custody. A saved plan does not reserve, stage, transfer, hand off, consume, or return stock. Do not infer a stock movement from a successful plan request.

The server's publication metadata was checked on 2026-10-23: an active public deployment exists at https://meterflo.com, with https://meter-flo-server.replit.app as an additional URL. This verifies the deployment exists, NOT that its current build contains the exact source reviewed below. Authenticated production GET/POST acceptance was not performed for this handoff. Treat the precise published contract as unverified until checked against the mobile app's configured server. Do not assume development preview and production are the same build.

Use the app's configured server and existing authenticated transport. No new credentials are required by this document.

## 2. GET work-order inventory

```http
GET /api/projects/:projectId/work-orders/:workOrderId/inventory
```

### Authorization

- Authenticated, unlocked account.
- Authorized project access; inactive project viewing requires the corresponding permission.
- `workOrders.view`.
- Server-authorized work-order visibility, including vehicle/dispatch scope where applicable.
- Broad `inventory.view` is NOT required for this narrow work-order read when `workOrders.view` is granted.
- Do not infer access from a role name or enumerate another vehicle's/work order's IDs.
- Responses use `Cache-Control: no-store`.

### Complete top-level response projection

The route returns these properties. Values that are `undefined` in source are omitted in serialized JSON. Preserve compatibility with optional historical fields.

| Property | Implemented value / purpose |
| --- | --- |
| `enabled` | Boolean project inventory flag. |
| `canSelect` | Broad inventory-view authority AND nonterminal work-order status. This is NOT the planning capability. |
| `canManageInventory` | Broad `inventory.view` result; does not itself grant every management action. |
| `capabilities` | Capability object defined below. |
| `allocation` | Work allocation/reservations, or `null`. |
| `inventoryDispatch` | Existing visibility projection's dispatch metadata; may be omitted. Use the mobile read contract for its dispatch definition. |
| `editable` | False for completed/closed/cancelled work-order status codes or matching labels; not the full planning authorization decision. |
| `workOrderStatus` | Current work-order status. |
| `timezone` | Project timezone, default `"UTC"`. |
| `plan` | Saved manual plan, or `{workOrderId, revision: 0, lines: []}`. |
| `stagingReceipts` | Receipts with action `stageWorkOrder` and reference `wo-<workOrderId>`. Not a complete fulfillment-batch receipt directory. |
| `reservationNeedsReview` | Boolean: reserved allocation's recorded assignment version differs from current work-order assignment version. |
| `requirements` | Effective requirements; fallback `{workOrderId, lines: [], missing: []}`. |
| `items` | Server-projected catalog described below. |
| `warehouses` | Broad viewers receive warehouse records; narrow viewers receive only referenced locations with reduced fields. |
| `locationTypes` | Existing location-type metadata; may be omitted when absent. |
| `fieldSettings` | Existing field-stock settings for broad inventory viewers; otherwise omitted. |
| `revision` | Overall inventory revision. NOT the plan revision. |
| `canChangeFieldStock` | Broad inventory view plus administrator or maintenance/configuration authority. |
| `componentTrace` | Existing work-order kit component trace. Not required to submit a manual plan. |
| `stockDiscrepancies` | Work-order discrepancies projected to `id`, `status`, `quantity`, `itemSku`. |
| `removalRules` | Existing removed-equipment rules. |
| `removalPolicies` | Array containing current removed-equipment policy. |
| `fieldRemovalChoices` | Existing field removal choices; may be omitted when absent. |
| `workflow` | `{wizardMode, equipment, readingEquipment}`, defaults `"changeout"`, `"both"`, `"both"`. |

This is the complete top-level projection, not a claim that every nested inventory-management entity has a separate mobile schema here. For existing dispatch, kit, removal, warehouse and receipt entity details, use the source map in section 9 and the other supplied mobile contracts. The native planning editor needs the exact planning/catalog/allocation fields below, not new warehouse-management controls.

### Capabilities

```ts
type PlanningCapabilities = {
  canPlan: boolean;
  canOverridePlan: boolean;
  canReserve: boolean;
  canStage: boolean;
  canReviewUse: boolean;
  canReconcile: boolean;
};
```

Use `enabled && capabilities.canPlan` to show the editable planner. Do not substitute `canSelect`, `canManageInventory`, `inventory.assign`, or a technician role-name check.

Implemented calculation:

- Planning-editable context: inventory enabled, unfinished/nonterminal work order, project wizard mode not `reading_only`.
- `canPlan`: planning-editable context + `workOrders.view` + `inventory.plan`.
- `canOverridePlan`: same + `inventory.overridePlan`.
- Stock-editable context additionally excludes another individual assignee unless administrator/maintenance/configuration authority permits it.
- `canReserve`: stock-editable + `workOrders.view`, `inventory.view`, `inventory.reserve`.
- `canStage`: stock-editable + `workOrders.view`, `inventory.view`, `inventory.assign`, `inventory.receive`, `inventory.transfer`.
- `canReviewUse`: enabled, editable, stock-editable assignment context + view/assign + maintenance/configuration; allows manager review of an old prepared reading-only visit.
- `canReconcile`: enabled, consumed allocation + work-order view, inventory view, inventory count.

The server checks authority again on submission. GET capability flags are not permission tokens.

### Exact planning types

```ts
type PlannedLine = {
  id: string;                    // UUID, stable across edits
  itemId: string;                // 1..100 characters
  quantity: number;              // integer
  kind: "addition" | "override";
  reason: string;                // trimmed; schema default ""
};
type WorkPlan = {
  workOrderId: number;
  revision: number;
  lines: PlannedLine[];
  updatedBy?: string;
  updatedAt?: string;
};
type RequirementLine = { itemId: string; quantity: number };
type WorkRequirements = {
  workOrderId: number;
  lines: RequirementLine[];      // effective combined demand
  missing: Array<{ equipment: "system" | "module"; typeId: string }>;
  automaticLines?: RequirementLine[];
  manualLines?: PlannedLine[];
  planRevision?: number;
};
```

`plan.lines` is the authoritative saved manual plan for editing. `requirements.lines` is the effective combined plan, NOT the manual input array. Automatic requirements come from project equipment/type mappings and kit requirement handling. Overrides replace automatic quantities for their item; additions are then added. Nonpositive effective totals are omitted.

For consumed allocations, requirements can be a historical saved snapshot with optional automatic/manual metadata absent. Do not invent missing metadata.

### Allocation/reservations

```ts
type AllocationLine = {
  itemId: string;
  quantity: number;
  serials: string[];
  warehouseId: string;
};
type Reservation = AllocationLine & {
  reservationMode?: "quantity" | "serial";
};
type Disposition = {
  equipment: "system" | "module";
  serial: string;
  disposition: "returned" | "scrapped" | "left_onsite";
  warehouseId: string | null;
  ruleId?: string;
  ruleRevision?: number;
  ruleName?: string;
  policyRevision?: number;
};
type WorkAllocation = {
  workOrderId: number;
  lines: Reservation[];
  used: AllocationLine[];
  dispositions: Disposition[];
  mode: "changeout" | "reading_only" | null;
  status: "reserved" | "consumed" | "released";
  revision: number;
  assignmentVersion?: number;
};
// GET allocation: WorkAllocation | null
```

Use the three different revisions correctly:

1. `plan.revision` → plan command `data.revision`.
2. `allocation.revision` → reservation/use context, not planning.
3. Top-level `revision` → inventory snapshot invalidation, not planning.

### Authorized item catalog

The server returns an allowlisted item projection:

```ts
{
  id, sku, name, description, category, categoryId, unit,
  tracking, equipment, kind, barcode, manufacturer, model,
  reorderPoint, active, images,
  components: [{itemId, quantity}],
  // Only when pricing authority permits:
  cost?, billingRate?, vendorId?
}
```

Schema values are tracking `"regular" | "serialized"`, optional kind `"stock" | "labor"`, and equipment `"none" | "system" | "module"`. Kit contents are represented by components, not a `"kit"` tracking value.

- Broad inventory viewers receive the projected project catalog.
- A narrow user with `canPlan` receives active items plus referenced historical items/components.
- A narrow nonplanner receives referenced items only.
- Select only returned items with `active === true`. Referenced inactive items are display/history, not new selectable additions.
- Ordinary view/assign/plan authority does not grant pricing. Pricing is available to administrator or inventory maintenance/configuration/purchase authority.
- Do not require cost or vendor fields to exist.
- Do not fetch a broader catalog to bypass this projection.
- Narrow warehouse records expose only `id`, `code`, `name`, `type`, `locationTypeId`, `active`; they are not a grant to move stock.

## 3. POST plan command

```http
POST /api/projects/:projectId/inventory/commands
Content-Type: application/json
```

```json
{
  "operationId": "5d786124-9b12-4f83-a2dc-e9186a813725",
  "action": "plan",
  "data": {
    "workOrderId": 123,
    "revision": 2,
    "lines": [
      {
        "id": "7856375b-f825-452b-a7e1-4a937e014631",
        "itemId": "example-part",
        "quantity": 2,
        "kind": "addition",
        "reason": ""
      }
    ]
  }
}
```

All examples are sanitized and illustrative. Substitute actual authorized IDs and fresh generated operation/line UUIDs; do not reuse these example identities.

### Exact schema

Envelope, plan data, and line objects reject unknown keys.

| Field | Validation |
| --- | --- |
| `operationId` | UUID |
| `action` | `"plan"` |
| `data.workOrderId` | Positive integer |
| `data.revision` | Nonnegative integer |
| `data.lines` | Array, maximum 500; empty array allowed subject to permission/covered-demand checks |
| line `id` | UUID; unique within submitted plan |
| line `itemId` | String length 1..100; must match an active item in this project |
| line `quantity` | Integer 0..1,000,000; additions must be at least 1 |
| line `kind` | `"addition"` or `"override"` |
| line `reason` | Trimmed string, maximum 1,000 characters, default `""`; override requires at least 10 characters |

Only one override per item. An override must target an automatically required item; other items use additions.

**Planned inventory quantities are integers. Project system/module meter-reading decimal precision does not apply to this quantity schema.**

### Whole manual-plan replacement

`data.lines` REPLACES the entire saved manual plan. It is not append-only.

1. GET the latest plan.
2. Retain all existing manual additions/overrides unless intentionally editing an authorized line.
3. Preserve stable line IDs.
4. Add/edit the desired lines.
5. Submit the complete resulting manual plan and current `plan.revision`.

Never submit `requirements.lines` as manual additions: that would duplicate automatic demand.

An ordinary planner must preserve every existing override's `id`, `itemId`, `quantity`, `kind`, and `reason` unchanged. Override comparison is order-insensitive. Adding, changing OR removing an override requires `inventory.overridePlan`; hiding overrides in the UI must not delete them from the request.

Existing inactive manual items can cause the entire replacement to be rejected even if retained unchanged, because the server validates all submitted items as active. Do not silently drop them to force success; retain local edits and show the server explanation for authorized resolution.

## 4. Success, replay, errors and retries

Successful response: HTTP 200.

```json
{
  "operationId": "5d786124-9b12-4f83-a2dc-e9186a813725",
  "plan": {
    "workOrderId": 123,
    "revision": 3,
    "lines": [
      {
        "id": "7856375b-f825-452b-a7e1-4a937e014631",
        "itemId": "example-part",
        "quantity": 2,
        "kind": "addition",
        "reason": ""
      }
    ],
    "updatedBy": "example-user",
    "updatedAt": "2026-10-23T12:00:00.000Z"
  }
}
```

A new accepted plan increments its revision by one. The response is `{operationId, plan}`, NOT an inventory snapshot, physical receipt, or echoed request.

An accepted identical replay returns the same response SHAPE. The public route does not expose a `replay` flag. The plan is taken from current server state, not an immutable cached original response, so another later edit may be reflected. Refresh GET after success/replay to reconcile capabilities, effective requirements and reservations.

The engine fingerprints action, command data, and actor. An accepted identical replay does not apply the plan a second time. The service still performs current authorization/work-order validation before reaching engine replay: replay is not an unconditional bypass if permissions, status, overrides or visibility have since changed.

### Representative errors

Errors use `{ "message": "..." }`, not a structured conflict DTO with current plan fields.

Revision mismatch: HTTP 409:

```json
{
  "message": "Planned items changed. Reload the plan before saving; your edits have not been applied."
}
```

Operation ID reused for different payload/actor: HTTP 409:

```json
{
  "message": "Posting identifier was already used for a different operation."
}
```

Override permission denied: HTTP 403:

```json
{
  "message": "Override Automatic Work-Order Requirements permission is required to add, change or remove automatic requirement overrides."
}
```

Other statuses: 400 for Zod schema errors; 401 for authentication/account checks; 403 for explicit authorization failures; 409 for ordinary InventoryError business-rule failures (including inactive/disabled posting and invalid selections); 503 when route access verification fails; 500 for unexpected operation failures. Existing authentication middleware may handle unauthenticated requests before inventory route handling. Do not assume all business validation is HTTP 400, or all 409 errors are revision conflicts.

### Retry and local draft rules

- Persist operation UUID, exact payload, authenticated account ownership, project/work-order identity and submitted revision before transmission.
- Network timeout/unknown outcome: retry the SAME operation UUID, SAME payload, SAME actor.
- Never edit payload while keeping its operation UUID.
- A corrected/rebased command gets a NEW operation UUID.
- Preserve line UUIDs for existing lines across revisions; only genuinely new lines get new UUIDs.
- On conflict, retain unsent edits, GET current server plan, and explicitly reconcile/merge. Do not silently overwrite another worker's edits.
- Do not automatically replay an unresolved operation under another signed-in account.
- A local saved draft is not a server-accepted plan. Label offline/pending changes accordingly.
- GET after acceptance to refresh effective demand; do not synthesize inventory movement or stock balances.

## 5. Permissions and restrictions

| Context | Implemented behavior |
| --- | --- |
| Inventory disabled | `canPlan` false; plan posting rejected. Preserve existing non-inventory work-order/changeout behavior. |
| Active inventory-enabled project, visible unfinished order | Requires `workOrders.view` + `inventory.plan`; server checks active account/project membership and work visibility. |
| `inventory.assign` only | Does not grant planning. |
| Narrow planner without `inventory.view` | Can use narrow GET and plan command with work-order view/planning authority; does not acquire broad warehouse privileges. |
| Add/change/remove override | Additionally requires `inventory.overridePlan`. |
| Project wizard mode `reading_only` | Replacement inventory planning rejected. |
| `user_choice` project | Current planning gate tests project mode `reading_only`, not a guessed per-visit reading-only flag; follow server capability and acceptance. |
| Completed/closed/cancelled order | Planning changes rejected, including matching configured core status labels/codes. |
| Inactive project | Posting rejected even if user can view inactive projects. |
| Staged/handed-off order | Not categorically blocked. Compatible supplemental demand can be accepted; covered demand remains protected. |

A consumed allocation does not itself set `canPlan` false; the normal status/editability checks still apply. Do not invent a blanket client-side restriction that differs from the server.

The broad mobile sync download has its own inventory-view requirement. Narrow planning support does not mean a planning-only account can download the broad mobile inventory bootstrap.

## 6. Protecting fulfilled demand

The server reconciles changed effective requirements transactionally:

- With no relevant noncancelled fulfillment batch, normal planning can be saved.
- If effective material requirements are unchanged and no mappings are missing, the batch is left alone.
- After stock movement/posting history, supplemental demand can remain uncovered planning when each item's new effective quantity still covers the quantities committed by relevant batches.
- The covered-demand check uses batch planned quantities for that work order, not just currently staged/delivered quantities. Do not implement a weaker mobile check.
- Additional planning does not pick/transfer the existing batch again.
- Compatible changes to one never-posted batch may update its planned lines/revision automatically; no physical movement occurs.
- Other changes, including reductions/replacements of covered demand, missing mappings, or incompatible multiple batches, can be rejected pending authorized fulfillment resolution.

Representative server explanation for posted stock:

> Work order 123 has changed material requirements in batch "Example route". Stock has already moved. In Fulfill / Stage, correct the physical stock and release the unfinished demand before changing these requirements. No stock was automatically returned or transferred.

Show the server explanation, preserve the user's draft, and do not automatically reverse, release, or repick stock from the planning UI.

## 7. Worked preservation example

Suppose the GET returns:

- Automatic item `example-meter`: quantity 1.
- Manual override for that meter: quantity 2, with existing UUID/reason.
- Manual addition `example-part`: quantity 1.

The technician adds one more `example-part`:

- Preserve the override unchanged even if the simplified UI does not offer override editing.
- Change the existing addition to quantity 2, retaining its line UUID, OR retain it and add a separate quantity-1 addition with a new UUID.
- Send both the unchanged override and the resulting addition line(s), using current `plan.revision`.
- Effective demand becomes meter 2 and part 2.
- No stock is reserved or moved.

If another user saves first, the stale request returns a revision conflict. Keep local edits and explicitly reconcile with the fresh plan before submitting a new operation.

## 8. Mobile acceptance checklist

- Inventory-disabled navigation and completion remain unchanged.
- Authorized planner can select an active returned item and add an integer quantity.
- Assign-only user sees no editable planner.
- Narrow planning does not expose pricing or warehouse-management controls.
- Automatic quantities are not duplicated into manual additions.
- Hidden overrides survive normal additions unchanged.
- Existing manual lines/IDs survive whole-plan replacement.
- Empty, fractional, negative and excessive additions are blocked.
- Terminal/reading-only/inactive contexts follow server restrictions.
- Revision conflicts and covered-demand conflicts preserve the draft and explain resolution.
- Exact network retry does not duplicate additions; changed payload uses a new operation ID.
- Staged/handed-off supplemental demand does not imply another stock movement.
- Offline drafts remain distinguishable from accepted server plans.
- Recheck these endpoints against the configured published server before declaring native integration complete.

## 9. Authoritative source map

Paths below exist in the server repository. They are references, not files expected to exist in the mobile repository.

- `server/inventoryRoutes.ts`: auth gate, GET projection, POST plan response, errors.
- `shared/inventory-planning.ts`: strict schemas, replacement, override comparison, revision checks and effective totals.
- `shared/work-order-inventory-capabilities.ts`: capability calculations.
- `shared/inventory-catalog-projection.ts`: item allowlist and pricing authority.
- `shared/inventory.ts`: command envelope, allocation, reservations, requirements, item/warehouse/receipt schemas.
- `server/inventoryRequirements.ts`: automatic/manual/effective requirement construction.
- `server/inventoryService.ts`: transaction, project mode/status/visibility checks, permissions and reconciliation.
- `shared/inventory-engine.ts`: canonical operation fingerprint, replay, plan execution.
- `shared/inventory-dispatch-impact.ts`: fulfilled-demand protections.
- `shared/inventory-errors.ts`: default InventoryError HTTP status 409.
- `tests/inventory-planning.test.ts`: planning tests.
- `tests/work-order-inventory-capabilities.test.ts`: permission/capability tests.
- `review-deliverables/meterflo-mobile/MOBILE_READ_CONTRACT.md`: existing mobile read/dispatch contract.
- `review-deliverables/meterflo-mobile/MOBILE_SUBMISSION_CONTRACT.md`: completion/replay contract, distinct from plan commands.
- `review-deliverables/meterflo-mobile/UPGRADE_PLAN.md`: Phase 4 technician planned additions.

No native vehicle-to-vehicle transfer workflow is added to mobile scope by this document.
