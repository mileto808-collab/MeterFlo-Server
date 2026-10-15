# Project Inventory Control

Inventory is optional for each project. An administrator enables **Project inventory** in the project form. It uses the same PostgreSQL database and configured local project-files directory on Replit, Windows, and Linux. No Replit bucket or external inventory service is required.

See [INVENTORY_VOLUME.md](INVENTORY_VOLUME.md) for reproducible isolated load
tests, measured operating limits, concurrency budgets and large-count caveats.

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
| Product ID (SKU) | Required catalog product identifier, unique within this project (case-insensitive), at most 200 characters. Example: `E460`. Not a physical unit's serial number |
| Product Label (Name) | Required recognizable product name, at most 200 characters. Example: `Electric meter E460` |
| Product Description | Optional details, at most 500 characters. Example: `Three-phase electric meter` |
| Category | Optional grouping, at most 500 characters, e.g. `Meters` or `Seals`. It does not select System/Module equipment classification |
| Unit | Required quantity label, at most 200 characters; defaults to `each`. Example: `each` for a meter or `box` for supplies. Postings use whole-number quantities even for units such as `ft` |
| Tracking: Quantity tracked | Default. Quantity only, e.g. 20 seals; serials must be empty |
| Tracking: Serialized — scan each unit | Use for systems/modules. Record one distinct physical-unit serial per unit during receiving, e.g. `0000456`; leading zeros are retained |
| Equipment: None — not equipment | Default for supplies, e.g. a seal |
| Equipment: System | Replacement system, e.g. a meter body; use serialized tracking |
| Equipment: Module | Replacement module, e.g. an add-on radio; use serialized tracking |
| Barcode | Optional catalog/product barcode, at most 500 characters, e.g. `012345678905`. This identifies the product, not the unique serial of each installed unit |
| Manufacturer | Optional maker, at most 500 characters, e.g. `Acme Meter Works` |
| Model | Optional manufacturer model, at most 500 characters, e.g. `R-4100`. This does not select System/Module equipment classification |
| Vendor | Optional preferred active project vendor, e.g. `North Valley Supply`. Default None means no preferred vendor selected |
| Cost | Optional finite, nonnegative unit amount, e.g. `18.75`; defaults to `0` |
| Reorder point | Optional finite, nonnegative reference threshold; defaults to `0`. Example: `6` displays `Reorder at 6` in the catalog. It does not automatically check balances, send alerts or place orders |
| Product images | Optional: upload up to eight PNG/JPEG pictures, each at most 5 MB, e.g. a product-label photo; files are protected by inventory access |
| Kit components | Optional bill of materials; leave empty for a standalone item. Add a product and quantity per finished kit, e.g. one meter and two seals. At most 100 lines; quantities are integers from 1 to 1,000,000; self-references and circular kit definitions are rejected |
| Active product | Defaults to active. Inactive items cannot be posted; resolve stock, reservations and open orders first. Example: deactivate a discontinued supply without deleting its history |

### Correspondence with System Type and Module Type tables

| Existing type-table field | Inventory item form | Stored inventory/API field |
|---|---|---|
| Product ID | Product ID (SKU) | `sku` |
| Product Label | Product Label (Name) | `name` |
| Product Description | Product Description | `description` |

Enter the same product details manually when appropriate. For example, a System Type with Product ID `E460` and Product Label `Electric meter E460` can be entered as an inventory item with those values, **Serialized — scan each unit**, and **System** equipment. For a radio module, choose **Module** instead. Inventory items are separate project records: creating or editing an item does not import, synchronize or modify the legacy type tables.

The item's internal ID is generated by MeterFlo and remains separate from the Product ID (SKU). Unit serials such as `0000456` are captured when receiving, transferring, counting or allocating stock—not in the product barcode or Product ID field. The item form has always-visible field tips; keyboard, touch and screen-reader users do not need to hover to access them.

Warehouse, vehicle, vendor and item dialogs close only after a successful save. A validation, stock-rule, permission or connection failure keeps the dialog and entered values open, including uploaded image selections and kit components. The focused **Details not saved** alert explains what to correct; for example, choose a unique Product ID after a duplicate-SKU error, or correct the VIN and plate details for a vehicle. Click **Save changes** again to retry, or **Cancel** to deliberately discard the local draft.

While saving or uploading an image, editing and dismissal are blocked to prevent losing in-flight changes. Duplicate save clicks do not send a second request. If a response is lost after the server accepted a save, retrying unchanged details reuses the same resource and operation identifiers, avoiding duplicate records; correcting the details starts a new operation for the same resource. Drafts are local to the open page, not saved across refresh/navigation. Raw server/proxy/database diagnostics are not shown in the form.

Resource validation regressions are included in `npm run test:inventory`. Signed-in form checks use the isolated fixture described in the count section below, with `npm run test:inventory-resource:browser`; clean up the fixture afterwards.

Tracking and kit definitions cannot be changed while an item has stock/assigned references. A kit assembly removes component stock and adds the finished kit atomically. Component scans are retained on its receipt. A purchase receipt of a finished kit adds the purchased kit itself—it does not assemble or consume local components.

Kits containing serialized components must themselves use serialized tracking and be assembled one at a time with a kit serial, so contained meter/module identities remain attributable when a kit is installed. Component serials cannot also be received as loose stock while contained in a kit.

## Orders, scanning and receipts

**Purchase:** choose a vendor, destination, quantities and optional notes; save the draft, then release it. You do not need supplier serials at ordering time. Open Receive, enter quantities for regular items, scan serialized items into the same review, then post. Multiple partial receipts are supported; over-receiving and duplicate serials fail without changing stock.

**Un-release a purchase order:** before any receipt has been posted, users with **Purchase orders** (`inventory.purchase`) permission and access to the destination can click **Un-release to draft** on a released PO. Then click **Edit draft**, change quantities, remove lines or add products, **Save draft**, and **Release** again before receiving. For example, change `E460 × 3` to `E460 × 6` and add `SEAL × 6` on the same PO. Un-releasing, editing and re-releasing do not change stock or create a receipt. Order type cannot be changed on an existing saved order. Partially received or completed POs cannot be un-released; posted receipts and their inventory history are never rewritten. Create a new PO for additional stock once receipts exist. The same checks run server-side under the inventory lock, so a concurrent receipt prevents an unsafe un-release.

**Clear cancelled purchase orders:** click **Clear** on a cancelled PO and confirm **Clear PO**. This archives the PO from the default list, rather than permanently deleting business or audit records. For example, clear a duplicate `PO-2026-014` after cancelling it to remove clutter. **Show cleared POs** includes these records again; **Restore** makes one visible in the default list, still cancelled (it does not reopen or release the PO). Viewing/printing retained orders uses normal inventory access; clearing/restoring requires `inventory.purchase` and destination warehouse access. Receipts, line details, IDs, stock and audit history are retained, including for a partially received PO whose remainder was cancelled. Cleared orders are included in project/full-system backups and retain their cleared state after restore. Transfer orders and non-cancelled POs cannot be cleared through these actions.

Un-release, clear and restore are recorded as `inventory.unrelease`, `inventory.archiveOrder`, and `inventory.restoreOrder`, with actor and before/after order changes in the normal audit ledger and inventory movement history.

**Transfer:** choose distinct source/destination warehouses, items and quantities. Specify serialized identities on the draft. Release, then dispatch from the source. Dispatched stock is in transit, not available at either warehouse. The destination accepts only dispatched quantities/serials. Partial dispatch and acceptance are supported. Receive already-dispatched goods before cancelling the remaining order.

Scan inputs accept newline/comma/semicolon-separated serials. A keyboard-wedge scanner can scan consecutive serials into the same list. Review serials and quantities before posting. Ordinary and serialized lines are posted together; the server validates the entire command before committing any stock change.

Draft order edits, release and cancellation do not add stock. Dispatch deducts source stock; acceptance adds destination stock. Reserving items for work orders does not reduce on-hand quantities, but does reduce available quantities.

Use the Print controls on orders, receipts and counts. They open escaped, printer-friendly records; use the browser's Print / Save as PDF option. Records include IDs, item quantities and serials; receipt records include their action, reference, timestamp and actor.

## Cycle counts and returns

Start a count for a warehouse. Enter every stocked item, including **zero** for an absent item, and scan the actual serialized identities. A reason is required to post. Counts cannot remove reserved units/serials; resolve the reservation first. If stock moves after the count starts, posting rejects the stale snapshot—start another count instead of overwriting newer movements.

**Continue count** resumes an open count. **Cancel count** closes a stale or unfinished count without changing quantities; cancellation is audited. The corresponding API command is `countCancel` with `{id,reason}`.

The editor includes every item in the original warehouse snapshot (including zero balances) plus products deliberately added as discoveries. Unused products elsewhere in the project catalog are not forced into the count. Use **Find discovery product** to search the full catalog by SKU, name or barcode, choose **Discovery product**, then click **Add discovery to count**. For example, in an empty warehouse add seals and enter quantity `4`, then add a serialized meter product and enter quantity `2` with serials `00001` and `00002`. Both are included in the completed count. A product created after the count began can be found after refreshing inventory and continuing the count; add it explicitly.

Count entry is paged at 50 rows. **Search count entries** filters the entered rows by SKU/name, not the project catalog. Paging and filtering never remove mandatory snapshot rows or discoveries from the submission: **Save count draft** and **Post count** include all entries across all pages. Discovery search shows up to 100 matches; refine the text when necessary. Saving a draft preserves discoveries, including deliberately entered zero quantities.

Existing quantities and serial lists are initially filled from the saved starting snapshot. Verify them physically: unchanged visible values are submitted as shown, without requiring you to retype the serials. Blank quantity is invalid, not zero. To record zero serialized units, enter `0` **and clear the serial list**. Duplicate serials or a quantity/serial mismatch block posting without dropping the draft. No serials are truncated or converted to numbers.

Click **Save count draft** before refreshing, switching counts, leaving the page or handing the count to another operator. This explicitly saves displayed quantities, scanned text (including leading zeros and unfinished scans), and the adjustment reason on the server. For example, save after scanning half a shipment, then use **Continue count** after signing in again to resume. A blank quantity or incomplete serial list may be saved, but must be corrected before posting. This is not per-keystroke autosave: changes since the last successful draft save are still local to the page.

Changed quantities, serial text, reasons and added discoveries are marked **Unsaved count changes**. Closing the editor, switching or starting counts, cancelling the active count, reloading a draft, navigating to another project or leaving through app navigation (including Back/Forward) asks you to **Save draft**, **Discard**, or **Stay**. Save continues only after a confirmed successful save; a failed save or revision conflict keeps your entries and destination available for retry. Discard drops changes since the last loaded/saved draft, not that saved draft or stock. Stay (or Escape) keeps editing. Paging, filtering and switching inventory tabs do not discard entries or require saving. Unchanged entries, reverted edits, and successful saves/posts do not trigger unnecessary warnings. Drafts remain isolated by project and count.

Refresh, closing the browser tab and full-page navigation use the browser's native unsaved-changes warning where supported; browsers choose its text/buttons and may suppress it, especially on mobile. It cannot save for you: cancel that warning and explicitly save the draft first. There is no guarantee of recovery after a browser/process crash.

Discard is applied only when the requested replacement or close succeeds. A failed draft reload, count cancellation or count start keeps the previous editor and its unsaved quantities, serial text, reason and discoveries. A refresh failure leaves the last loaded inventory visible with a warning; retry before relying on current stock.

Drafts require `inventory.count`, project access and access to the counted warehouse. Another authorized warehouse operator can continue the shared draft. Each successful save increments its draft revision. If someone else saved after you opened it, saving or posting from the older editor is rejected and your local entries remain intact. **Reload saved draft** offers the unsaved-changes choices only if entries changed; choose **Discard** to load the latest server draft, then review/reapply your changes and save again. Saves and failures use the normal inventory audit trail, without logging every keystroke.

Saving drafts never adjusts quantities or resets the immutable starting snapshot. Stock movement or reservation conflicts still reject posting; a stale snapshot requires cancellation and a new count. Successful posting or cancellation clears the unfinished draft. Project and full-system inventory backups include saved drafts; legacy backups without drafts remain supported. Saved drafts are not a separate mobile editing feature.

Counts support **2,000 total item rows**, including mandatory snapshot rows and discoveries, in one complete atomic posting. Posting allows at most **50,000 serial entries total**, still at most **10,000 serials per product**, with an **8 MiB UTF-8 JSON data limit** for draft saves and posting. Regular-item quantities remain whole numbers from zero to 1,000,000. Exceeding a limit fails without truncation or partial stock changes. Counts are not posted page-by-page: a missing snapshot row rejects the whole submission. A warehouse with more than 2,000 balances cannot start a supported complete count; resolve its stock organization before counting rather than counting a silently reduced subset. Purchase/transfer commands retain their separate 500-line limit.

Count regressions are included in `npm run test:inventory`. To run the signed-in browser checks against a running development server, create an isolated fixture with `npx tsx tests/support/inventory-ui-fixture.ts --large-counts`, then run `npm run test:inventory-count:browser` (set `CHROMIUM_PATH` to an installed Chromium executable when needed). The capacity option seeds 3,000 catalog products and 600 warehouse balances in the disposable project. Afterwards run `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. The test uses only its own temporary projects, warehouses, users and stock.

Verified in the Linux development environment: the engine completed a full 2,000-row count from a 3,000-product catalog in a sampled 100 ms. The signed-in browser test saved, reloaded and posted 601 rows (600 snapshot items plus a discovery), with 50 rows mounted per page. It verified zero and changed quantities across different pages and filters, retained the discovery after reload, and did not create balances for unused products. Unit checks reject omitted snapshot rows, 2,001-row counts, oversized payloads, excess total serials and stale snapshots without partial changes. These are bounded synthetic checks, not Windows measurements or guarantees for every server; previous Windows volume acceptance did not exercise this newer count capacity.

Counts display project-scoped readable references such as **Count #1**, **Count #2** beside the warehouse name and status. The reference is derived from the count's position in the saved, append-only project count history; cancelling or posting does not renumber it. Existing UUID-only counts use the same numbering without rewriting their identifiers. List rows, continuation views, count activity and printed counts share that reference. It is not the warehouse code; internal UUIDs remain in command URLs, relationships and audit evidence. References are scoped to the project, not globally unique.

During changeout select a disposition for each removed piece of equipment:

* **Returned:** choose the destination warehouse. Completion creates a pending return, not usable stock.
* **Scrapped:** retain the removed serial and disposition in the work-order/inventory history, without adding stock.
* **Left onsite:** retain the serial and disposition, without adding stock.

Open **Removed Equipment** to receive a pending returned system or module into quarantine. After inspection, select the matching serialized System/Module item and enter a reason to release it into usable stock. Condition approval is explicit; a return is never automatically available.

## Work orders

Work-order detail includes inventory assignment and review. Assign item, warehouse, quantity and exact serials; saving reserves available stock. Replace/remove assignments to release unused reservations. The actual changeout wizard shows the assigned items and includes **Inventory use & removed equipment review**.

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

Authenticated inventory commands use `POST /api/projects/:projectId/inventory/commands` with `{operationId:UUID,action,data}`. Actions are `warehouse`, `vendor`, `item`, `order`, `release`, `cancel`, `unrelease`, `archiveOrder`, `restoreOrder`, `receive`, `dispatch`, `accept`, `assemble`, `countStart`, `countSaveDraft`, `countCancel`, `countPost`, `assign`, `prepareUse`, `returnAccept`, `returnRelease`, `reconcileWorkOrder`. Every action requires its registered permission; stock posting also requires warehouse access. The purchase-only `unrelease`, `archiveOrder`, and `restoreOrder` actions take `data: {"orderId":"PO-2026-014"}` and require `inventory.purchase`. A cleared order retains status `cancelled` and an ISO `archivedAt` timestamp; restoring visibility removes that timestamp. Retries must reuse the same operation UUID and identical data/actor; reused UUIDs with different content are rejected. The UI posts commands through review forms rather than a JSON editor.

For example, `countSaveDraft` data is `{"id":"count-id","revision":0,"rows":[{"itemId":"meter-id","quantity":"","serials":"0000456\npartial"}],"reason":"Still scanning"}`. Use revision `0` before the first save; subsequent saves send the returned `draft.revision`. The snapshot's count includes `draft: {revision,rows,reason,savedBy,savedAt}` only for authorized count operators with warehouse access. `countPost` includes `draftRevision` matching the loaded draft (for example `1` after the first save), plus its normal validated `lines` and `reason`. Older clients omitting `draftRevision` can post counts with no saved draft, but cannot overwrite a count with a saved draft. Conflicts return HTTP 409; reload/reconcile rather than blindly retrying an old revision.

Customer API Push includes an additive `inventory` snapshot when enabled: allocation/use/dispositions and the referenced catalog items. It shares the existing delivery/retry process. It is a snapshot of the posted work order, not a command for the customer's backend to change MeterFlo stock.

## Audit, backups and operations

Committed inventory commands record actor, time, action, project, stock/reservation/serial changes and changed catalog/order/allocation/count/return records. Failed posting attempts are logged as failed when audit logging is available. Work-order completion and inventory posting are atomic. Browsing or unposted scan text is not a stock mutation.

Inventory lives in public PostgreSQL tables: a locked project state, relational catalog and quantity projections, and a movement ledger. Project writes serialize through the state lock to prevent double consumption/overselling. This favors consistent posting; evaluate load before deploying projects with exceptionally large histories. Movement records and business state are not disposable diagnostic logs.

Full PostgreSQL backups include these public tables. Full JSON backups and individual project JSON backups include inventory; project backups insert original work-order IDs directly (including gaps) and align the sequence for subsequent work orders. They require explicit replacement rather than merging conflicting stock. Individual inventory restores are atomic. Legacy full-system JSON restores validate project snapshots before changing business data and restore public data, all project work orders and inventory in one transaction: any project or row failure rolls back the database restore. Missing project snapshots or inventory snapshots are rejected rather than accepted as partial success. Schema preparation may leave empty schemas or schema migrations on failure; sequence counters can advance even when rows roll back. Files are restored separately: file errors leave the database restored and are reported as **Restore Incomplete**, not success. Older work-order-only backups cannot overwrite an inventory-enabled project. Local newer audit history and the authenticated restore initiation remain protected by the existing restore boundary.

Item images are in the configured project-files root under `inventory-<projectId>`; include project files in the backup to preserve their bytes. A database-only backup preserves image references, not files. When moving project backups to another instance, restore the matching project configuration and user/access references and copy the image files; project identity is part of the image URL.

Full-system JSON backups also include service types, system types, module types and their project assignment tables so source-specific work-order references can restore on a fresh server. Older JSON archives that omit these catalogs require matching lookup configuration already installed on the destination; restore validates that prerequisite before replacement and retains the omitted catalogs. If required codes/product IDs are absent, use a newer complete backup or install the matching configuration first.

Before disabling inventory resolve open orders, active reservations/counts and outstanding returns. Historical stock/history remains stored. Deactivating a location/item does not delete history. Never use direct SQL to edit balances or delete movement history. Disabling inventory is not a stock reset.
