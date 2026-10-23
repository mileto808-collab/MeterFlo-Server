# MeterFlo: planned-inventory save recovery — version 1

## Status and scope

Implemented in the server source on 2026-10-23. This file is an additive companion
to WORK_ORDER_INVENTORY_PLANNING_CONTRACT.md, not a replacement for the planning
GET/POST contract. Publication of this exact build must be verified by capability
discovery on the configured host. Do not infer publication from this file.

This protocol resolves an uncertain `action: "plan"` command. It does not transfer,
reserve, install or consume stock, grant permissions, reopen work, or alter the
inventory-disabled work-order path. Vehicle transfers and field-completion
submission receipts are different protocols.

## 1. Discover before using

Authenticated `GET /api/inventory/plan-recovery-capabilities`:

```json
{"version":1,"modes":["lookup","resolve"]}
```

The normal authorized
`GET /api/projects/:projectId/work-orders/:workOrderId/inventory` response also
adds:

```json
{"planRecovery":{"version":1,"modes":["lookup","resolve"]}}
```

The standalone discovery endpoint permits discovery when current project
inventory reads are denied or inventory is disabled. It discloses no project,
plan or receipt. Authentication and account/access locks still apply.

A missing endpoint, unsupported version, malformed response, 401/403/423,
server/transport error, or `enabled:false` on the ordinary inventory GET is not
proof that the pending command failed. Keep its durable journal frozen.

## 2. Endpoint and full request

`POST /api/projects/:projectId/work-orders/:workOrderId/inventory/plan-recovery`

Requires the original authenticated account on the original host and project.
The request is JSON. It is not another invocation of the plan command.

```typescript
type PlanLine = {
  id: string;          // UUID, stable identity of the manual line
  itemId: string;      // 1–100 characters
  quantity: number;    // integer 0–1,000,000; additions must be >= 1
  kind: "addition" | "override";
  reason?: string;    // <= 1,000 characters; overrides require >= 10 trimmed
};
type RecoveryRequest = {
  command: {
    operationId: string; // original UUID, never a replacement UUID
    action: "plan";
    data: {
      workOrderId: number; // positive integer, must match path
      revision: number;    // original nonnegative plan revision
      lines: PlanLine[];   // original complete replacement manual plan, <= 500
    };
  };
  mode?: "lookup" | "resolve"; // defaults to lookup
};
```

Submit the **exact frozen command** originally sent to
`POST /api/projects/:projectId/inventory/commands`. Preserve line order, IDs,
quantities, overrides, reasons, omitted versus supplied defaults and revision.
Do not reconstruct it from current inventory GET results or normalize it further.
Object-key order is irrelevant. Array order and string values are significant.

The request envelope and plan data/lines reject unknown fields. The shared
command envelope follows the existing inventory command schema. Invalid input,
non-plan action, invalid UUID, and path/body work-order mismatch return 400.

### Lookup mode

Checks committed evidence while holding the same inventory transaction lock
used by command posting. Returns accepted or rejected only for the exact
matching command. Missing evidence returns unresolved. Does not create a fence,
change a plan or advance a revision.

### Resolve mode

Checks the same evidence first. If no operation or outcome with that UUID
exists, writes a durable **rejected fence** under that same lock. This makes the
exact attempt conclusively not applied and prevents a delayed original POST
from committing later. It is a deliberate journal-resolution action, not an
automatic background lookup and not a new planned-inventory save.

If the original POST won the lock and committed, resolve returns accepted.
If resolve won and committed its fence, the original POST cannot subsequently
commit. Repeating resolve is safe. If its response is lost, repeat lookup or
resolve with the same exact command.

Unknown fingerprint/actor/work-order collisions are unresolved, not overwritten.
The fence increments the global inventory revision and records an audited
`planRecoveryFence` event, but does not increment the work-plan revision or move
stock. Mobile should not interpret a global inventory revision as a plan revision.

## 3. Full success response

All conclusive and unresolved protocol results use HTTP 200:

```typescript
type RecoveryResponse = {
  version: 1;
  projectId: number;
  workOrderId: number;
  actorId: string;
  action: "plan";
  operationId: string;
  fingerprint: string; // lowercase SHA-256 hex, exactly 64 characters
  status: "accepted" | "rejected" | "unresolved";
  acceptedRevision: number | null;
  occurredAt: string | null; // UTC ISO timestamp when evidence was recorded
};
```

`acceptedRevision` is the revision accepted by the original command, **not**
today's revision. Accepted operations created before this upgrade have exact
actor/payload fingerprint evidence but no immutable original revision/timestamp;
those two fields are null. Do not invent them from today's plan.

No catalog, stock balances, prices, current plan, warehouses or other actors are
returned. Responses set `Cache-Control: no-store`.

### Exact acknowledgement binding

Before resolving a journal, validate version, owner/host, project, work order,
actor, action, operation ID, status, field types and fingerprint.

The fingerprint is SHA-256 of the UTF-8 JSON for:

```typescript
{ action: command.action, data: command.data, actor: authenticatedActorId }
```

Canonicalization recursively sorts object keys using JavaScript's default
`.sort()`, preserves array order, and then calls `JSON.stringify`. Hash the exact
original data, not the trimmed/defaulted plan returned by a later inventory GET.
Project, work order, action and operation ID must also be compared explicitly
against response fields and request scope; they are not all embedded in the hash.

Equivalent implementation for plain JSON command data:

```javascript
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map(key => [key, canonical(value[key])])
    );
  }
  return value;
}
const fingerprintInput = JSON.stringify(canonical({
  action: frozenCommand.action,
  data: frozenCommand.data,
  actor: originalActorId
}));
// SHA-256(fingerprintInput encoded as UTF-8), lowercase hexadecimal.
```

There is no server-supplied fingerprint that mobile should trust without comparing
it to its own frozen command. Do not persist a substituted command after mismatch.

## 4. Authentication and privacy policy

- Original account must exist, be authenticated and unlocked.
- Current project membership is required unless the original actor is currently
  an administrator. Administrator status never permits reading another actor's
  receipt by supplying their operation UUID.
- No current `inventory.plan`, `inventory.view`, `workOrders.view`, override
  permission, installer assignment or work-order visibility is required for this
  narrow historical evidence. Those permissions still control normal reads and
  **all new edits**.
- An inactive project, inventory disablement, terminal work status, reassignment,
  or removal of an accepted line does not erase matching historical evidence.
- Membership revocation, deleted/locked account, and site/project access locks
  remain enforced. Do not work around them.
- Actor/payload collisions return unresolved without the other command's data,
  status, revision or timestamp.
- An administrator may diagnose audit history and restore legitimate access
  through ordinary administration. There is **no** cross-account recovery API,
  impersonation permission or administrator-issued mobile resolution token.
  If legitimate access cannot be restored, retain the unresolved command for
  support; do not discard it or create a replacement.

## 5. Error responses

Errors have `{ "message": string }`, not a RecoveryResponse.

| HTTP | Meaning | Mobile action |
|---|---|---|
| 400 | Request shape or path mismatch | Retain original journal; report contract/input problem |
| 401 | Authentication unavailable | Retain; authenticate original account through normal flow |
| 403 | Account/project recovery access denied | Retain; explain access/support requirement |
| 423 | Existing access lock blocks request | Retain; normal authorized unlock is required |
| 404 / unsupported route | Build lacks supported facility, or route unavailable | Retain; do not infer rejection |
| 503, other 5xx, timeout, invalid JSON | No conclusive acknowledgement received | Retain; exact retry only |

Neither a later plan POST 403/409 nor any failed inventory GET resolves the
earlier command. A fenced original POST returns a conflict if current policy
allows it to reach the engine; earlier authorization/status checks can still
return their own errors. Use this recovery endpoint for authoritative evidence.

## 6. Mobile state transitions

1. Keep version-1 journals compatible. Persist server/account/project/work-order
   owner, original operation ID, full immutable command and stable local line IDs
   before sending. Do not auto-submit or rebase after login.
2. Discover version 1; perform lookup with the original owner. Ignore late
   responses after navigation/owner changes. Storage or validation failure keeps
   the command frozen.
3. Accepted: durably record exact acceptance and reconcile submitted local
   additions exactly once. Do not append them again, resurrect removed lines,
   overwrite a later plan or infer stock movements. A current plan refresh is
   optional and still requires current read authority.
4. Unresolved: retain the frozen attempt. The user may explicitly request resolve
   to obtain either acceptance or a durable no-later-commit fence. Do not offer
   “assume failed”, local discard or a replacement ID based on unresolved state.
5. Rejected: persist the exact authoritative evidence before unlocking editing.
   Preserve local additions and original evidence. Read current capabilities and
   plan; only then permit explicit review/rebase using a **new** operation UUID.
   Preserve current overrides, fulfilled demand and stable line identities.
6. Denied/unsupported/unavailable: retain the original command and inputs. Offer
   only exact retry or normal support/access restoration.
7. A local/server line-ID collision is not proof of acceptance. Require
   authoritative resolution rather than silently changing IDs or duplicating it.

## 7. Persistence, retention and compatibility

Accepted evidence is recorded atomically with the normal plan mutation using
the relational inventory transaction. Rejection fences use the same project and
inventory-root lock as posting. Concurrent resolution cannot pass a still-running
original transaction and then allow that original attempt to commit afterward.

Accepted records include original actor, work order, canonical payload,
acceptance revision and timestamp. Prior committed engine fingerprints support
legacy accepted acknowledgement without inventing missing metadata.
Evidence is relational (`inventory_plan_operation_outcomes` and existing
`inventory_operations`), survives server restart, and is not subject to a
time-based cleanup or expiry. Normal replay does not create another receipt.
Broad inventory snapshots exclude the private outcomes collection.

The new table participates in existing relational inventory backup, project
deletion and restore enumeration. Update schema before serving this build.
Managed-host schema changes go through Publish; standalone instances use the
normal inventory migration/update procedure.

This protocol relies on the authoritative operational database retaining its
history. Do not prune operation identities/fences, selectively import a plan
without its operation evidence, restore an older database under active offline
journals, or reuse a deleted project's identity and then claim absence proves
failure. Database rollback/deletion is an administrator-led recovery event:
pause affected mobile writes and reconcile outstanding journals before service
resumes. This protocol does not make destructive database rollback safe.

Original plan GET/POST schemas and success/replay responses are unchanged except
the additive GET capability field. New edits keep every existing restriction.
No new mobile screens or behavior are implemented by this server handoff.

## 8. Sanitized fixtures

Example pending command (retain as one immutable object):

```json
{
  "command": {
    "operationId": "123e4567-e89b-42d3-a456-426614174001",
    "action": "plan",
    "data": {
      "workOrderId": 101,
      "revision": 4,
      "lines": [
        {
          "id": "123e4567-e89b-42d3-a456-426614174002",
          "itemId": "part-1",
          "quantity": 2,
          "kind": "addition",
          "reason": "Extra fittings"
        }
      ]
    }
  },
  "mode": "lookup"
}
```

The digest below is calculated from the exact example command and actor
`example-technician`. Changing any signed content requires recalculation.

```json
{
  "version": 1,
  "projectId": 12,
  "workOrderId": 101,
  "actorId": "example-technician",
  "action": "plan",
  "operationId": "123e4567-e89b-42d3-a456-426614174001",
  "fingerprint": "134f27e788c88257ab05bc7793a130b80599b575cfc2072cb544290a678c95e6",
  "status": "accepted",
  "acceptedRevision": 5,
  "occurredAt": "2026-10-23T15:00:00.000Z"
}
```

For rejected, use `status:"rejected"`, `acceptedRevision:null` and the fence
timestamp. For unresolved use `status:"unresolved"` and both nullable fields
null. Identity fields and the locally validated exact-command digest remain
required in all HTTP 200 responses.

## 9. Verification sources

- `tests/inventory-plan-recovery.test.ts`: engine/fence behavior, immutable
  acceptance revision, legacy evidence, mismatches, relational serialization.
- `tests/inventory-plan-recovery-http.cjs`: real authenticated HTTP and owned
  PostgreSQL transactions, changed policy, atomic fencing and delayed POST races.
- `tests/inventory-planning.test.ts` and `tests/inventory-planning-ui.cjs`:
  existing manual planning, reservations, custody and normal authorized UI.

Mobile should add durable-storage, owner-change, crash/restart, malformed response,
exact fingerprint, accepted-after-later-removal, rejected rebase and unsupported
host regressions, then verify against the configured published host. Real native
device behavior and publication are separate from server-local test results.
