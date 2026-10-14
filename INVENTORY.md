# Project Inventory Control

Inventory is optional for each project. An administrator enables **Project inventory** in the project form. It uses the same PostgreSQL database and configured local project-files directory on Replit, Windows, and Linux. No Replit bucket or external inventory service is required.

## Setup and permissions

1. Enable inventory for the project using an administrator account with `inventory.configure` and project-edit permission.
2. Under **Users / role management**, grant the relevant Inventory permissions. Existing administrator roles have them; other roles do not receive new permissions automatically.
3. Open the project's **Inventory** menu. Create warehouses, a vendor and items, then create/release a purchase order and receive stock.
4. Assign warehouse users. An active project user or group member can be granted warehouse access; a vehicle's assigned user also has access. **None** is supported for an unassigned vehicle.
5. Assign stock to work orders, reserving it before technicians start work.

| Permission | What it permits | Example |
|---|---|---|
| `inventory.configure` | Administrator-only project enable/disable | Enable stock control for a meter replacement project |
| `inventory.view` | Project stock, other warehouses, catalog, orders and printable records | Search for SKU `E460` across the project |
| `inventory.maintain` | Maintain accessible warehouses, vendors and catalog; upload item pictures | Update a warehouse contact or item model |
| `inventory.purchase` | Purchase-order drafts, release and cancellation | Order 100 meters from a vendor |
| `inventory.transfer` | Transfer requests, release/cancellation and dispatch | Request 10 meters from Main for Van 12 |
| `inventory.receive` | Receive purchases, accept transfers and inspect/release returns | Scan incoming meter serials |
| `inventory.count` | Counts, adjustments and completed-work inventory reconciliation | Correct an explicitly counted shortage |
| `inventory.assign` | Reserve work-order items and review actual use | Allocate meter `0000456` to a technician's work order |
| `inventory.assemble` | Build kits from stock | Assemble a meter and two seals |

Users also need their existing project/work-order permissions. Technicians completing inventory-enabled work need view and assign permissions, access to the allocated warehouses, and their usual changeout permission. Project membership alone is not warehouse posting authority. Administrators create warehouses and change access grants. Other maintainers can edit an accessible warehouse without changing its grants.

Project inventory viewers can search other warehouses. A transfer request requires access to its destination; release/dispatch requires source access, and acceptance requires destination access. This lets separate warehouse teams complete their respective stages.

## Warehouses

All warehouse records are stored within the selected project. Cross-project item, warehouse and vendor references are rejected.

| Field/option | Use and example |
|---|---|
| Code | Unique within the project, e.g. `MAIN` or `VAN-12` |
| Name | Recognizable location name, e.g. `North district warehouse` |
| Type: Physical | A fixed warehouse; address is required |
| Type: Vehicle | A mobile stock location; valid 17-character VIN, license plate and plate jurisdiction are required |
| Address, city, state, ZIP | Fixed-location address, e.g. `100 Utility Way`, `Denver`, `CO`, `80202` |
| Contact, phone, location | Receiving contact and additional directions, e.g. `Receiving desk`, `555-0100`, `Loading dock B` |
| VIN | Vehicle identity, e.g. `1HGCM82633A004352`; letters I, O and Q are invalid |
| License plate / jurisdiction | Plate and issuing state, e.g. `ABC123`, `CO` |
| Make, model, year | Vehicle description, e.g. `Ford`, `Transit`, `2024`; year is optional |
| Assigned user | Active project user driving the vehicle, or None |
| Warehouse users | Active project users permitted to post at this warehouse |
| Active | Inactive locations cannot be used in new postings; clear stock and outstanding operations before deactivating |

## Vendors and items

Vendor fields are name, contact, address, phone, email, reference and active. For example: `Utility Supply`, `Receiving`, `100 Supplier Rd`, `555-0123`, `orders@example.com`, `Account NORTH`. Vendor email must be valid or blank.

| Item field/option | Use and example |
|---|---|
| SKU / name | Unique project SKU and display name: `E460`, `Electric meter E460` |
| Description / category | `Three-phase meter`, `Meters` |
| Unit | Quantity label, e.g. `each`; postings currently use whole-number quantities |
| Regular tracking | Quantity only, e.g. 20 seals; serials must be empty |
| Serialized tracking | One distinct scanned serial per unit; leading zeros are retained |
| Equipment | None for supplies; System or Module identifies replacement equipment for completion checks |
| Barcode, manufacturer, model | Catalog information, e.g. `E460-BOX`, `Example Manufacturer`, `E460` |
| Vendor | Preferred active vendor from this project, or None |
| Cost / reorder point | Nonnegative values, e.g. `150.00`, `10`; these do not automatically place orders |
| Images | Upload up to eight PNG/JPEG pictures, each at most 5 MB, through the item form; files are protected by inventory access |
| Components | Kit bill of materials, e.g. one meter and two seals; quantities are positive integers and circular kit definitions are rejected |
| Active | Inactive items cannot be posted; resolve stock, reservations and open orders first |

Tracking and kit definitions cannot be changed while an item has stock/assigned references. A kit assembly removes component stock and adds the finished kit atomically. Component scans are retained on its receipt. A purchase receipt of a finished kit adds the purchased kit itself—it does not assemble or consume local components.

Kits containing serialized components must themselves use serialized tracking and be assembled one at a time with a kit serial, so contained meter/module identities remain attributable when a kit is installed. Component serials cannot also be received as loose stock while contained in a kit.

## Orders, scanning and receipts

**Purchase:** choose a vendor, destination, quantities and optional notes; save the draft, then release it. You do not need supplier serials at ordering time. Open Receive, enter quantities for regular items, scan serialized items into the same review, then post. Multiple partial receipts are supported; over-receiving and duplicate serials fail without changing stock.

**Transfer:** choose distinct source/destination warehouses, items and quantities. Specify serialized identities on the draft. Release, then dispatch from the source. Dispatched stock is in transit, not available at either warehouse. The destination accepts only dispatched quantities/serials. Partial dispatch and acceptance are supported. Receive already-dispatched goods before cancelling the remaining order.

Scan inputs accept newline/comma/semicolon-separated serials. A keyboard-wedge scanner can scan consecutive serials into the same list. Review serials and quantities before posting. Ordinary and serialized lines are posted together; the server validates the entire command before committing any stock change.

Draft order edits, release and cancellation do not add stock. Dispatch deducts source stock; acceptance adds destination stock. Reserving items for work orders does not reduce on-hand quantities, but does reduce available quantities.

Use the Print controls on orders, receipts and counts. They open escaped, printer-friendly records; use the browser's Print / Save as PDF option. Records include IDs, item quantities and serials; receipt records include their action, reference, timestamp and actor.

## Cycle counts and returns

Start a count for a warehouse. Enter every stocked item, including **zero** for an absent item, and scan the actual serialized identities. A reason is required to post. Counts cannot remove reserved units/serials; resolve the reservation first. If stock moves after the count starts, posting rejects the stale snapshot—start another count instead of overwriting newer movements.

**Continue count** resumes an open count. **Cancel count** closes a stale or unfinished count without changing quantities; cancellation is audited. The corresponding API command is `countCancel` with `{id,reason}`.

During changeout select a disposition for each removed piece of equipment:

* **Returned:** choose the destination warehouse. Completion creates a pending return, not usable stock.
* **Scrapped:** retain the removed serial and disposition in the work-order/inventory history, without adding stock.
* **Left onsite:** retain the serial and disposition, without adding stock.

Receive a pending returned unit into quarantine. After inspection, select the matching serialized System/Module item and enter a reason to release it into usable stock. Condition approval is explicit; a return is never automatically available.

## Work orders

Work-order detail includes inventory assignment and review. Assign item, warehouse, quantity and exact serials; saving reserves available stock. Replace/remove assignments to release unused reservations. The actual changeout wizard shows the assigned items and includes **Inventory use & removed meter review**.

Review the quantities/serials actually used and the removed equipment's disposition before completing. Completion deducts only used stock and releases unused reservations in the same transaction as the work-order update. New equipment IDs must match used serialized inventory; repeated completion does not deduct a second time. Reading-only work consumes no replacement stock.

System Type and Module Type controls are disabled for inventory-enabled projects; Service Type remains editable. Historical type values are preserved. Inventory-disabled projects retain their original forms, imports and PDFs.

Work-order PDFs include allocation/use, warehouse, serial and disposition details. Completed consumption cannot be silently reset, reopened, deleted or have its equipment identities changed. An authorized user must first **Reconcile work-order inventory**, enter a reason and explicitly choose whether used stock is physically returning. Do not restore quantities merely to correct paperwork. Reconciliation is blocked after removed returns have been accepted; resolve those physical stock records with an authorized operator rather than automatically undoing them.

## Import columns

For enabled projects the file/JSON, external-database and Customer API Import pages offer `inventoryItems`, hide legacy system/module type targets, and show an example. Existing saved configurations must be reviewed when inventory is enabled. Baseline IDs/readings/GPS and required customer fields still apply.

`inventoryItems` is an array; a CSV/Excel/text cell may contain its JSON representation:

```json
[
  {"warehouseId":"warehouse-id","itemId":"serialized-item-id","quantity":1,"serials":["0000456"]},
  {"warehouseId":"warehouse-id","itemId":"seal-item-id","quantity":2,"serials":[]}
]
```

Use IDs from the project's inventory, not warehouse names or SKUs. Serialized quantities must equal serial count. Omitting the field leaves assignments unchanged; sending `[]` releases existing open assignments. Invalid or unavailable assignments roll back that work-order row. Completed consumption cannot be overwritten by an import. The importing user needs assign permission and warehouse access. Scheduled file/DB imports require an authorized `file_import` account; configure its role, project membership and warehouse access before importing allocations. API Import safe updates intentionally do not overwrite inventory assignments; assign only during creation.

## API and mobile contract

`GET /api/projects/:projectId` includes `inventoryEnabled` (default false). `GET /api/projects/:projectId/mobile/sync/download` adds `inventoryAllocation` to downloaded work orders and a top-level `inventory` object: `{contractVersion:1,enabled,items,warehouses}`. Catalog and authorized warehouse data accompany the assignments. Warehouse IDs and item IDs are project-scoped.

`GET /api/projects/:projectId/work-orders/:workOrderId/inventory` supplies `{enabled,allocation,items,warehouses}`. Allocation fields are `workOrderId`, `lines`, `used`, `dispositions`, `mode`, `status` and `revision`. An assignment line has `warehouseId`, `itemId`, `quantity`, `serials`.

For native completion include `inventoryUsage` inside the work-order object in the existing sync upload:

```json
{
  "id":2011,
  "status":"Completed",
  "newSystemId":"0000456",
  "inventoryUsage":{
    "operationId":"f9ee415b-8fdd-4daa-97b1-8f70dbfb3569",
    "revision":1,
    "mode":"changeout",
    "used":[{"warehouseId":"warehouse-id","itemId":"serialized-item-id","quantity":1,"serials":["0000456"]}],
    "dispositions":[{"equipment":"system","serial":"OLD0001","disposition":"returned","warehouseId":"warehouse-id"}]
  }
}
```

For reading-only use `mode:"reading_only"`, `used:[]`, `dispositions:[]`. Preserve the downloaded allocation revision and one UUID per posting/retry. Offline clients must not invent available stock or allocate new serials locally. Sync conflict/stock errors retain queued work and require refresh/operator reconciliation; force-overwrite does not bypass stock validation. The web server contract is implemented here; the separately maintained Expo app must implement its inventory screens and use this contract before supporting inventory-enabled completion.

The existing mobile completion routes also accept the same `inventoryUsage` object alongside their existing JSON fields, or inside multipart `data` JSON. Sending it on sync upload is not the only supported completion path. Fetch item-image paths relative to the configured MeterFlo server and use authenticated requests; catalog image URLs are not public storage links.

Mobile sync of an inventory-enabled project requires `inventory.view` as well as the usual work-order permission and project access. Without it, download returns **403** and no catalog or allocation data. Warehouse metadata is limited to assigned/authorized locations unless the user is the Administrator.

Historical consumption is retained after a return. It does not permanently block reusing a meter: after a later changeout records its removal, a warehouse accepts it into quarantine and releases it following inspection. The same serial can then be reserved and installed again. A previous inspection never authorizes receiving another copy while that serial is currently installed or inside a kit.

Authenticated inventory commands use `POST /api/projects/:projectId/inventory/commands` with `{operationId:UUID,action,data}`. Actions are `warehouse`, `vendor`, `item`, `order`, `release`, `cancel`, `receive`, `dispatch`, `accept`, `assemble`, `countStart`, `countPost`, `assign`, `prepareUse`, `returnAccept`, `returnRelease`, `reconcileWorkOrder`. Every action requires its registered permission; stock posting also requires warehouse access. Retries must reuse the same operation UUID and identical data/actor; reused UUIDs with different content are rejected. The UI posts commands through review forms rather than a JSON editor.

Customer API Push includes an additive `inventory` snapshot when enabled: allocation/use/dispositions and the referenced catalog items. It shares the existing delivery/retry process. It is a snapshot of the posted work order, not a command for the customer's backend to change MeterFlo stock.

## Audit, backups and operations

Committed inventory commands record actor, time, action, project, stock/reservation/serial changes and changed catalog/order/allocation/count/return records. Failed posting attempts are logged as failed when audit logging is available. Work-order completion and inventory posting are atomic. Browsing or unposted scan text is not a stock mutation.

Inventory lives in public PostgreSQL tables: a locked project state, relational catalog and quantity projections, and a movement ledger. Project writes serialize through the state lock to prevent double consumption/overselling. This favors consistent posting; evaluate load before deploying projects with exceptionally large histories. Movement records and business state are not disposable diagnostic logs.

Full PostgreSQL backups include these public tables. Full JSON backups and individual project JSON backups include inventory; project backups preserve original work-order IDs and require explicit replacement rather than merging conflicting stock. Inventory restores fail atomically if work-order or stock relationships are invalid. Older work-order-only backups cannot overwrite an inventory-enabled project. Local newer audit history remains protected by the existing restore boundary.

Item images are in the configured project-files root under `inventory-<projectId>`; include project files in the backup to preserve their bytes. A database-only backup preserves image references, not files. When moving project backups to another instance, restore the matching project configuration and user/access references and copy the image files; project identity is part of the image URL.

Before disabling inventory resolve open orders, active reservations/counts and outstanding returns. Historical stock/history remains stored. Deactivating a location/item does not delete history. Never use direct SQL to edit balances or delete movement history. Disabling inventory is not a stock reset.
