# Pickups, vehicle stock and pick-ticket QR — mobile implementation handoff

This describes the existing server implementation inspected on 2026-10-22.
No server behavior was changed for this handoff. Source snapshots in the accompanying
ZIP are reference material, not modules to install wholesale in the mobile app.
The ZIP contains no credentials, live records or environment files.

## 1. Confirmed intended technician access

- Preserve the working inventory-disabled navigation and work-order behavior.
- Pickups are a narrow, assigned-vehicle projection, not access to the full warehouse
  interface. The server permits an unlocked, authenticated, non-customer account
  with **either `workOrders.view` or `inventory.view`** and accessible eligible projects.
- Pickup projects must have inventory enabled, not be `reading_only`, satisfy
  project membership/admin scope, site/project locks, and inactive-project authority.
- Pickup notices require actual current vehicle membership: `assignedUserId` or
  membership in that vehicle's `userIds`. An administrator is not automatically a
  pickup recipient. Bulk work-order group membership alone is not vehicle membership.
- Vehicle Stock requires **`inventory.view`**, project access and server-authorized
  location access on every directory, stock, serial and print request.
- Stock directory includes active `vehicle` locations whose type reference is valid.
  Normal users can see assigned vehicles **and vehicles whose configured location
  type has `accessPolicy: "shared"`**. Do not assume all vehicles are assignment-only.
  Administrators (resolved by the server's normal admin authority) and users with
  `inventory.manageLocationTypes` can see all eligible vehicles within accessible projects.
- Do not gate these native screens by a hardcoded role name. Do not request broad
  management permissions just to display pickup notices or expected onboard stock.
- A technician may view pickup details/QR, acknowledge the displayed revision,
  and report a problem with stock still at staging. None of these actions moves stock.
  Resolving stock corrections, recording pulls and handing off stock remain authorized
  warehouse operations, not technician actions conferred by these read screens.
- Work-order dispatch visibility is separate from these lists. Keep using the
  server's work-order DTO/`inventoryDispatch`/`canStart` and full reconciliation.
  Neither a pickup notice nor a stock row grants permission to work an order.

## 2. Exact shared response types

The files `shared/inventory-pickups.ts`, `shared/inventory-vehicle-stock.ts` and
`shared/inventory-pick-ticket.ts` in the ZIP are verbatim current sources.
Pickup types refer to a staging issue type; its complete projected shape is expanded
below so native code does not need to import the stock-command module.

```ts
type PickupIssue = {
  id: string;
  itemId: string;
  category: "wrong_serial" | "wrong_item" | "quantity" | "missing" | "other";
  description: string;
  status: "open" | "investigating" | "resolved";
  reportedAt: string;
  quantity?: number;
  serials?: string[];
};

type InventoryPickupItem = {
  itemId: string; sku: string; name: string; unit: string;
  plannedQuantity: number; stagedQuantity: number; deliveredQuantity: number;
  readyQuantity: number; remainingToStage: number; serials: string[];
};
type InventoryPickupNotice = {
  projectId: number; projectName: string; timezone: string;
  batchId: string; batchName: string; ticketNumber: string; revision: number;
  createdAt: string; readyAt: string; status: "ready" | "partial" | "review";
  issues?: PickupIssue[];
  vehicleId: string; vehicleName: string; stagingName: string; stagingLocation: string;
  notes: string; unread: boolean; items: InventoryPickupItem[];
};
type InventoryPickupResponse = {
  pickups: InventoryPickupNotice[]; unreadCount: number;
};

type VehicleStockLocation = {
  id: string; projectId: number; projectName: string; timezone: string;
  name: string; code: string;
};
type VehicleStockDirectory = {
  vehicles: VehicleStockLocation[]; generatedAt: string;
};
type VehicleStockRow = {
  itemId: string; warehouseId: string; quantity: number; reserved: number;
  available: number; revision: number; serialCount: number;
  item: {
    id: string; sku: string; name: string; category: string;
    unit: string; tracking: string;
  };
};
type VehicleStockResponse = {
  vehicle: VehicleStockLocation; generatedAt: string; revision: number;
  total: number; filtered: number; quantity: number; reserved: number;
  offset: number; rows: VehicleStockRow[];
};
type VehicleStockSerials = {
  serials: string[]; total: number; filtered: number;
  offset: number; revision: number;
};
// Actual /serials JSON also includes these labels from queryStockSerials.
// The shared VehicleStockSerials type omits them; native can ignore or model them:
type VehicleStockSerialsWire = VehicleStockSerials & {
  item: { name: string; sku: string } | null;
  warehouse: { name: string; code: string } | null;
};
```

These endpoints return the objects directly: no `success` or `data` wrapper.
Identifiers for locations/items/batches are strings; project IDs are numbers.
Render project-related timestamps in the response's `timezone`.
Tracking values currently used by the stock filters are `regular` and `serialized`;
the shared row type is intentionally `string`, so handle unknown values safely.
No cost, billing rate, vendor object, full work-order object or full inventory
aggregate is included in these response projections.

## 3. Pickup reads, readiness, acknowledgment and problem reporting

### GET /api/inventory/pickups

Returns `InventoryPickupResponse` across eligible accessible projects. No paging or
project query filter is implemented here; filter the returned authorized list for
a project screen. A successful empty response is `{pickups: [], unreadCount: 0}`.

Only active batches are considered. A notice is included when there is stock waiting
at staging and either all demand has been staged or pickup was explicitly marked
ready; an open pickup issue can also cause a review notice. Scheduled batches with
changed assignment versions, missing work orders or no longer Scheduled work are
excluded pending warehouse resolution.

- `readyQuantity = stagedQuantity - deliveredQuantity`.
- `remainingToStage = plannedQuantity - stagedQuantity`.
- `serials` are deduplicated serials staged but not delivered.
- `review` takes priority over `partial`, which takes priority over `ready`.
- `issues` currently includes non-resolved issues; the projection currently omits
  issue serials even though the shared optional field permits them.
- `unread` compares this user's acknowledged revision with the batch revision.
  Reading the GET alone does not acknowledge.
- `readyAt` is the latest qualifying staging/readiness/correction receipt time,
  falling back to batch creation. Do not treat it as a guaranteed first-ready timestamp.
- Use server `ticketNumber`; do not generate it from native list position.

### POST /api/inventory/pickups/:projectId/:batchId/view

Strict JSON body: `{ "revision": <positive integer> }`.
Success: `{ "viewed": true }`.
404 means the notice is no longer available; 409 means it changed and must be
reloaded/reviewed. Acknowledge only the revision actually displayed, then refetch.
This records viewing, not loading, acceptance, stock custody or handoff.

### POST /api/inventory/pickups/:projectId/:batchId/problem

Strict JSON body:
```ts
{
  operationId: string; // UUID; retain exact ID and body for an uncertain retry
  revision: number;    // positive integer, current batch revision
  itemId: string;      // 1..100 characters, from this pickup
  category: "wrong_serial" | "wrong_item" | "quantity" | "missing" | "other";
  description: string; // trimmed, 10..1000 characters
}
```
Success: `{ "reported": true }`. The locked command rechecks current vehicle
membership, active batch, staged-undelivered stock and exact revision. This endpoint
does not accept quantity/serial correction fields. Report the mismatch in the
description and let warehouse staff resolve it. Do not send extra keys.

### GET /api/inventory/pickups/events

Authenticated SSE, ordinary `data:` JSON messages:
`{type:"resync"}` or `{type:"access_lost"}`.
No pickup payload or durable event cursor is carried. Server refreshes subscriptions
on changes and on a 15-second timer. Refetch authorized GET data on resync/reconnect.
Close/recheck on access_lost. The web feed also uses a 60-second fallback, while
the mobile read contract recommends a 30-second foreground reconciliation fallback.
Native authenticated SSE support must be verified with the existing login transport;
foreground GET polling is acceptable if native SSE is unavailable.

## 4. Vehicle Stock endpoints

| Request | Success body |
| --- | --- |
| `GET /api/inventory/vehicles` | `VehicleStockDirectory` |
| `GET /api/inventory/vehicles?projectId=792` | Same, restricted to that project |
| `GET /api/projects/:projectId/inventory/vehicle-stock?vehicle=LOCATION_ID` | `VehicleStockResponse` |
| `GET /api/projects/:projectId/inventory/vehicle-stock/serials?vehicle=LOCATION_ID&item=ITEM_ID` | `VehicleStockSerialsWire` |
| `GET /api/projects/:projectId/inventory/vehicle-stock/print?vehicle=LOCATION_ID` | HTML report, not JSON |
| `GET /api/inventory/vehicles/print[?projectId=792]` | HTML report across authorized vehicles |

Use returned directory entries; do not enumerate guessed vehicle IDs. Scoped requests
recompute authorization against the directory before querying stock.
Vehicle query is required, length 1..200. Optional projectId is a positive integer.
Warehouse scope is forced to the authorized vehicle regardless of a supplied
`warehouse` parameter.

Stock/print filters (query strings):
- `q`: max 300 chars, default empty. Matches item SKU/name, location name/code or a
  matching stock serial. This is a filter, not an automatic barcode action.
- `category`: category name, max 300, default `all`.
- `tracking`: `all | regular | serialized`, default `all`.
- `availability`: `all | in-stock | available | reserved | out-of-stock`, default `all`.
- `locationType`: `all` or UUID, default `all`.
- `sort`: `item-asc | item-desc | location-asc | location-desc | available-asc |
  available-desc`, default `item-asc`.
- `offset`: integer 0..10000000, default 0.
- `limit`: integer 1..100, default 25.

Serial requests accept `item`, `q` (max300/default empty), `offset` (same range),
`limit` (1..100/default50). They filter serials only for the selected item/vehicle.
See the verbatim query schemas in the ZIP.

`rows` is paged and has no inline serial list. Fetch `/serials` to expand an item.
`serialCount` counts all recorded serials for that row. Stock `total` counts balance
rows in the selected vehicle, `filtered` counts matching rows. The top-level
`quantity`/`reserved` are sums across filtered rows, not across just this page.
`available = quantity - reserved` per row.
Counts are not counts of distinct meters/parts across differing units.
The server clamps out-of-range page offsets; use returned `offset`, not just the request.
Separate pages are separate snapshots. A revision change during paging should
trigger a restart of the read rather than claiming an atomic full-vehicle snapshot.
Print collects all matching rows/serials in one read transaction, ignoring pagination
for report completeness.

These are expected **onboard balances**, not a physical count. Staged pickup stock
does not become vehicle stock until a recorded vehicle handoff. Opening/printing
creates no drafts and posts no movements.

## 5. Existing QR format and rendering

There is no QR-image API and no separate QR secret/token. Existing pickup details
create the QR locally with `qrcode`:
```ts
const payload =
  `${configuredServerOrigin}/projects/${notice.projectId}/work-orders?pickup=` +
  encodeURIComponent(notice.batchId);
```
Use the app's authenticated configured server origin, not a hardcoded development
host. `ticketNumber` is the human-readable caption, **not** the QR payload.
Do not encode the contents, credentials, personal data or a stock command.

Existing pickup rendering: error correction M, margin2, width320, dark `#172522`,
white background. Printed pick tickets use the same URL with width160/margin1.
Native can use its QR renderer; preserve the payload and a clear high-contrast
quiet zone. Show `ticketNumber`, batch name and vehicle alongside the QR.

`shared/inventory-pick-ticket.ts` contains the exact parser. It accepts absolute
HTTP(S) or root-relative `/projects/POSITIVE_INTEGER/work-orders?pickup=UUID`
and the corresponding `/inventory?pickup=UUID` form. It rejects credentialed URLs,
fragments, protocol-relative URLs, repeated pickup keys, bare serials and bare UUIDs.
It returns ticket / wrong_project / invalid, lowercasing the UUID on success.
It accepts additional query parameters, but only consumes the verified identity.
Never navigate to or fetch a scanned host: parse identity, then use configured
authenticated API origin. The QR is an identifier, never authorization.

Warehouse scanner resolution is:
`GET /api/projects/:projectId/inventory/fulfillment/:batchId/ticket`.
It returns `{batch, resume}`, with the full warehouse batch shape; **do not call it
as a technician read fallback**. It requires fulfillment authority:
inventory view, work-order view, assign, receive and transfer (or server admin),
plus normal project/work-order access. It sets nextStep vehicle when resumable
stock is waiting at staging.

Technician QR handling should resolve the identity against a freshly fetched
authorized pickup list, matching **projectId and batchId**, and show unavailable
if absent. Do not replace a missing notice by fetching the full batch or broad
inventory endpoint. A completed/withdrawn/reassigned QR may legitimately no longer
resolve as a technician pickup.

`GET /api/projects/:projectId/inventory/fulfillment/:batchId/pick-ticket` is the
warehouse printable HTML ticket route, also fulfillment-protected; not a mobile
pickup JSON route. The technician needs no access to it to display their own QR.

## 6. Freshness, offline storage, errors and security

- JSON read routes above use `Cache-Control: no-store`; native offline persistence
  must explicitly distinguish saved snapshots from current server state.
- Scope cached records by configured server + authenticated user + project, and
  vehicle/batch identity. Clear private caches on sign-out/account switch. Never
  apply a late response to another account/project.
- Refresh on screen open, foreground, reconnect and relevant invalidations. These
  features require no closed-app push notifications.
- Label offline data with last fetched time and "Saved snapshot — not live".
  Do not show a fresh/live/verified indicator from stale data or locally infer
  readiness, delivered quantities, permissions or stock movements.
- Offline QR display may identify the cached ticket but cannot confirm current
  readiness/assignment. Warehouse must refetch and authorize before any operation.
- Acknowledgment/problem submission needs a confirmed server response; a local
  saved report is pending, not reported. Retain uncertain problem operation ID/body
  for retry and refetch after conflicts. Never auto-post stock changes.
- Typical route errors are `{message: string}`. Auth middleware may return a
  different envelope; inspect HTTP status first. Pickup handler uses 400 validation,
  403 permission, 404 unavailable acknowledgment, 409 changed acknowledgment,
  423 locks, 503 unexpected read failure; underlying inventory commands can also
  reject with their own explicit conflict/validation status. Vehicle stock uses
  400 bad queries, 403 inaccessible vehicle/project, 423 locks, 500 unexpected reads.
  Authentication failure is not a successful empty snapshot.
- On 401/403/404/423, stop rendering affected private live data/actionability and
  recheck access. Do not reinterpret denied reads as inventory being disabled.
  On network/server failure, an explicitly stale snapshot can remain with retry.

## 7. Source map and verification scope

The ZIP preserves these paths:
- `shared/inventory-pickups.ts`: full notice/item/response types.
- `shared/inventory-vehicle-stock.ts`: full stock types.
- `shared/inventory-pick-ticket.ts`: safe identity parser.
- `shared/inventory-stock-query.ts`: exact query validation.
- `shared/inventory-staging-corrections.ts`: issue schema/command reference.
- `shared/inventory-capabilities.ts`: action capability combinations.
- `server/inventoryPickups.ts`: projections, access, acknowledgment, problem and SSE routes.
- `server/inventoryVehicleStock.ts`: directory/access, snapshot, serial and print routes.
- `server/inventoryStockQueries.ts`: SQL projections, paging/count/serial semantics.
- `server/inventoryPickTicket.ts`: existing printed QR implementation.
- `server/inventoryRoutes.ts`: warehouse ticket resolver and its permissions.
- `client/src/components/inventory/pickup-notices.tsx`: existing pickup QR rendering/UI.
- `client/src/components/inventory/vehicle-stock.tsx`: web stock read/serial/print usage.
- `tests/inventory-pick-ticket.test.ts`: existing QR parser regression cases.

Inspection confirmed these contracts against source. This documentation-only handoff
does not claim a new signed-in/native acceptance test or production rollout.
Use source for verification, not to copy server database/auth modules into native.
The existing read/submission contracts remain applicable. If deployment differs,
verify these routes on the configured host before enabling native screens.
