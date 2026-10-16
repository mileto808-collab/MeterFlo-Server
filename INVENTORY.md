# Project Inventory Control

Inventory is optional for each project. An administrator enables **Project inventory** in the project form. It uses the same PostgreSQL database and configured local project-files directory on Replit, Windows, and Linux. No Replit bucket or external inventory service is required.

See [INVENTORY_VOLUME.md](INVENTORY_VOLUME.md) for reproducible isolated load
tests, measured operating limits, concurrency budgets and large-count caveats.

## Inventory page header

On phones and narrow tablets, Inventory sections are selected from a compact menu instead of a wrapping tab list. That menu also contains permission-appropriate Add location, Add new item, and Build an order draft actions. Statistics remain collapsed by default. Each section provides a collapsed **Show Search & Tools** control; opening it reveals search, filters, refresh, exports and other section tools without clearing entered filters when closed. Desktop tabs and tools remain visible. Location details can be expanded per record on phones. Paging uses the remaining visible screen space, including browser chrome changes.

Phone layout regression: create the disposable operations fixture with `npx tsx tests/support/inventory-ui-fixture.ts create --operations`, run `node tests/inventory-phone-layout-ui.cjs`, then clean up with `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. The check covers all nine sections at 360, 390 and 430 pixel widths.

The Inventory page keeps its title, permission-available create actions, statistics toggle and inventory tabs in a sticky header while the page content scrolls. Statistics are collapsed by default; use **Show Stats** / **Hide Stats** to reveal or collapse the four inventory summary metrics. The tab menu wraps on narrow screens so the controls remain reachable without horizontal page overflow.

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
| `inventory.closeOrders` | Close short purchase/transfer orders with a mandatory reason | Close an order after the supplier confirms the remaining two meters will not ship |
| `inventory.resolveExceptions` | Inspect/release shipment quarantine, record its return/scrap, approve confirmed transit losses | Release a tested held meter, or record a carrier-confirmed missing carton |
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

The **Orders** tab keeps the order list and filters visible instead of displaying a large planning form. Click **Build an order draft** to open the purchase/transfer form in a scrollable dialog. For example, choose Purchase, select a vendor and destination, add `E460 × 6` and `SEAL × 6`, optionally enter the supplier reference and notes, then **Save draft**. A confirmed save closes the dialog and displays the saved order confirmation; it does not release the order or change stock.

**Edit draft** opens that order in the same dialog, including its current quantities, reference and order number. **Create replacement** opens a dialog prefilled with the eligible outstanding quantities and a link to the original order; review the destination/source/vendor, adjust the new draft as needed and save. The original order, posted quantities and exception history are unchanged. No replacement is created merely by opening or cancelling the dialog.

Closing with **Cancel**, the X, or Escape asks **Save draft**, **Discard**, or **Stay** if anything changed. Stay returns to the intact form. Discard closes and clears only the unsaved editor; existing saved orders remain unchanged. Save closes only after confirmation; validation, permission, network or unconfirmed-save failures keep entries available for correction or retry. The dialog cannot be dismissed during a save. Clicking outside does not dismiss it. On smaller screens the dialog scrolls without expanding the order list.

**Purchase:** choose a vendor, destination, quantities and optional notes; save the draft, then release it. You do not need supplier serials at ordering time. Open Receive, enter quantities for regular items, scan serialized items into the same review, then post. Multiple partial receipts are supported; over-receiving and duplicate serials fail without changing stock.

**Un-release a purchase order:** before any receipt has been posted, users with **Purchase orders** (`inventory.purchase`) permission and access to the destination can click **Un-release to draft** on a released PO. Then click **Edit draft**, change quantities, remove lines or add products, **Save draft**, and **Release** again before receiving. For example, change `E460 × 3` to `E460 × 6` and add `SEAL × 6` on the same PO. Un-releasing, editing and re-releasing do not change stock or create a receipt. Order type cannot be changed on an existing saved order. Partially received or completed POs cannot be un-released; posted receipts and their inventory history are never rewritten. Create a new PO for additional stock once receipts exist. The same checks run server-side under the inventory lock, so a concurrent receipt prevents an unsafe un-release.

**Un-release a transfer:** users with **Transfer orders** (`inventory.transfer`) permission and access to both the source and destination can also click **Un-release to draft** on a released transfer before any dispatch or receipt has been posted. For example, return `TR-2026-000124` to draft, increase `E460 × 2` to `E460 × 4`, add seals, save and release again. The internal ID, readable number, reference and audit history remain intact; no inventory moves and no shipment receipt is created. Once dispatch or receiving activity exists, the transfer cannot return to draft—even after all dispatched goods arrive. Use the existing fulfillment/exception processes or a new order instead of rewriting posted movements. Un-releasing uses the same inventory lock as dispatch, so a competing dispatch either wins and blocks un-release, or loses because the transfer is now a draft.

For both purchases and transfers, a saved shipment capture also blocks un-release, including an unconfirmed prepared attempt. Resume/reconcile that capture or explicitly discard its saved draft first, then retry. This prevents edited order lines from invalidating recoverable scans or allowing a late prepared request to post against a changed order.

**Clear cancelled purchase orders:** click **Clear** on a cancelled PO and confirm **Clear PO**. This archives the PO from the default list, rather than permanently deleting business or audit records. For example, clear a duplicate `PO-2026-014` after cancelling it to remove clutter. **Show cleared POs** includes these records again; **Restore** makes one visible in the default list, still cancelled (it does not reopen or release the PO). Viewing/printing retained orders uses normal inventory access; clearing/restoring requires `inventory.purchase` and destination warehouse access. Receipts, line details, IDs, stock and audit history are retained, including for a partially received PO whose remainder was cancelled. Cleared orders are included in project/full-system backups and retain their cleared state after restore. Transfer orders and non-cancelled POs cannot be cleared through these actions.

Un-release, clear and restore are recorded as `inventory.unrelease`, `inventory.archiveOrder`, and `inventory.restoreOrder`, with actor and before/after order changes in the normal audit ledger and inventory movement history.

**Order lines:** PO and transfer drafts collect products and quantities only—there are no serial-scan boxes in the draft builder. Edit a line's quantity directly in its **Quantity for [product]** field; you do not need to remove and re-add it. For example, change `E460 × 4` to `E460 × 6`, add `SEAL × 6`, and save the draft. Quantities must be whole numbers from 1 to 1,000,000. Blank, zero or invalid quantities cannot be saved. Quantity edits participate in the existing unsaved-changes warning. Saving a draft does not change stock.

**Transfer:** choose distinct source/destination warehouses, items and quantities. Release, then dispatch from the source; scan the actual serialized units at **Dispatch**, not while planning the draft. Dispatched stock is in transit, not available at either warehouse. The destination accepts only dispatched quantities/serials. Partial dispatch and acceptance are supported. Receive already-dispatched goods before cancelling the remaining order. Legacy transfer orders with preselected identities remain supported and constrain dispatch to those identities. Editing and saving an old draft converts it to quantity-only planning.

**Order number, supplier/customer reference and internal ID:** new POs receive numbers such as `PO-2026-000123`; transfers receive numbers such as `TR-2026-000124`. The server assigns a number once when the draft is first saved, under the project inventory lock. Both types share a yearly counter within the project; the prefix year uses UTC at creation. Numbers can have gaps and are not globally unique across projects or independent customer installations. Cancelling, clearing, editing, re-releasing or retrying a draft does not change its number or reuse a cancelled number.

The **Supplier/customer reference** is optional, up to 100 characters. For example, enter a supplier's `27491-01` or a customer's `NORTH-DISTRICT-88`. It is separate from the generated order number and may be corrected while the order is a draft without changing its identity. Two orders may have the same external reference: use their order numbers to distinguish them. Leaving the reference blank still generates a readable order number.

The immutable **internal ID** continues to identify API commands, receipts, saved scans, replacement links and historical audit events. Expand **Internal ID / copy** on a card to see/copy it; old IDs remain searchable. Changing a reference does not create a second order, including when retrying after an unconfirmed save. Existing manually entered IDs remain valid and visible as legacy references. For older UUID-based orders, an authorized inventory maintainer can click **Assign legacy order numbers**, with access to every affected warehouse. This is an audited, atomic numbering action only: it does not post stock or rewrite receipts, saved scans or historical IDs. Until assigned, these orders show **PO/TR · number pending** and their internal ID remains available. Existing manually named legacy orders retain their original display label.

Readable order numbers and references appear in save confirmations, order cards, shipment capture/recovery views, and printed orders and receiving/dispatch/acceptance receipts. The Activity ledger resolves linked orders to their readable order numbers and actors to usernames, including existing movements, without rewriting stored references. Unknown or deleted users are explicitly labeled rather than displaying their UUID. Locked users remain identifiable in history without becoming selectable warehouse users.

Printed orders and receiving/dispatch/acceptance receipts use readable order numbers and usernames. Each receipt also has a project-local **Receipt #** derived from its position in the append-only ledger, so separate partial movements remain distinguishable. Internal order and receipt IDs are printed as **Code 128 barcodes**, without UUID text underneath. Scanning a barcode returns the exact original internal ID, not the display number. Barcodes are generated on the server as inline vector images: they work offline and on standalone Windows/Linux installations without external services or barcode fonts. These display changes do not alter stock, saved scans, audit history, backup contents or internal relationships.

### Receipt Serial Details appendix

Receipt summaries show a serial count and a **Serial Details** link instead of placing hundreds of serials in an item row. The link jumps to the appendix in the browser. In Print / Save PDF, the appendix starts on a separate page and continues for as many pages as needed. Receipts with no recorded serials or dispatch-reference evidence do not add an empty appendix; unknown/unreadable quantities still appear as counts in the summary.

The appendix groups evidence by product/SKU and category: confirmed identities, damaged/quarantined identities, unverified dispatch references, and verified release identities. Disposition movement identities and selected known identities remain separately labeled; disposition movement lists can include unverified references and are not proof that those labels were physically read. Transit-loss references are labeled as not physically received. Component serials are included when recorded on the printed receipt.

Each continuation table repeats the project, readable order/receipt number, product/category, and column headings. One numbered serial per row preserves leading zeros, case and punctuation; long values wrap rather than being cut off. Unknown units are never assigned invented serials, and the same identity recorded in different evidence categories remains in each category. Only this receipt's evidence is printed—not serials from earlier/later partial shipments or the current state of its entire inspection hold.

Automated checks: `npm run test:inventory-print` verifies evidence scope and display; `npm run test:inventory-print:browser` generates isolated fixtures and Chromium Letter/A4 PDFs under ignored `generated-artifacts/inventory-serial-print/`. The browser check requires Chromium (or `CHROMIUM_PATH`) and Poppler's `pdftotext`. It checks exact serial preservation, category duplicates, repeated page identifiers/headings, printable bounds, no empty appendix pages and offline rendering, including a 1,510-serial receipt. Actual browser print engines and printer settings can affect page counts; Firefox/Safari and physical printers are not verified by this Chromium check. Order and count serial layouts are unchanged.

### Locations, Shipment exceptions, Removed Equipment and Activity

These tabs use the same persistent search/filter/refresh/CSV/Excel/PDF toolbar and screen-size-aware pagination as Stock, Orders, Items and Vendors. The results scroll locally while the toolbar and page navigation stay available. Exports contain **all matching records in the selected sort order**, not just the current page; no-result exports are disabled.

- **Locations:** search names, codes, addresses, VIN/plate, contacts and assigned users; filter by location type, active status and user assignment.
- **Shipment exceptions:** search readable orders/receipts, products, serials and locations; filter by location, hold status, tracking and receiving user. Sort by date, item or remaining held quantity. Known identities and disposition history expand separately. Inspection, partial disposition, receipt printing and unsaved-edit protection are retained.
- **Removed Equipment:** search exact serials, work orders and return locations; filter by equipment type, status, return location and disposition. Existing quarantine acceptance and inspected stock-release actions retain their permissions and validation.
- **Activity:** search receipts, readable order/count/operation references, users, products, serials and reasons; filter by action, location and user. Newest/oldest ordering follows the append-only ledger sequence. Existing movement printing remains available.

CSV/Excel include detailed fields, preserve leading-zero text values and protect spreadsheet formula-like text. PDF / Print opens a landscape summary with repeated project/timezone/column headings for browser Print / Save PDF. Shipment summaries use serial counts rather than inserting potentially thousands of serials; Removed Equipment exports preserve each record's serial. Names/readable references are exported instead of internal user/order UUIDs. Export data comes from the already permission-scoped project snapshot and does not expand access to other warehouses.

Verification: `npm run test:inventory-operations`. Browser coverage uses only a disposable fixture: `npx tsx tests/support/inventory-ui-fixture.ts --operations`, `npm run test:inventory-operations:browser`, then `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. Do not create acceptance fixtures in a customer database.

### Items and Vendors workspaces

**Items** and **Vendors** are separate project tabs. Each has a persistent search/filter/refresh/export toolbar, a bounded results area and fixed page navigation. Page capacity adapts to available screen space, including changes to the statistics header and phone layouts. Add/Edit continues to use the existing validated resource forms and requires inventory maintenance permission.

Items can be searched by product name/SKU, description, barcode, manufacturer/model or vendor, and filtered by active status, category, tracking, equipment, vendor and kit definition. Sort by name, SKU or category. Vendors can be searched by name, contact, address, phone, email or reference, filtered by status/contact availability and sorted by name.

CSV, Excel and PDF / Print include **all matching records in the selected sort order**, not only the displayed page. Zero-match exports are disabled. CSV protects formula-like text; Excel preserves exact leading-zero identifiers and phone/reference values as text. CSV/Excel include the full catalog scalar fields, kit component counts and image URLs; PDF uses a compact readable summary with repeating headings and opens the browser's Print / Save PDF view. Exporting does not modify inventory.

Checks: `npm run test:inventory-catalog-exports`. Browser coverage: create the disposable fixture with `npx tsx tests/support/inventory-ui-fixture.ts --large-counts`, run `npm run test:inventory-catalog:browser`, then remove it with `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. Never run fixture creation against a customer database.

### Stock serial viewer and exports

Stock & search uses the same bounded workspace pattern as Orders. **On hand by location** remains visible below the Inventory header, with search, Filters, Refresh, CSV, Excel and PDF / Print. The results area scrolls separately from the toolbar and pager; page capacity is measured from available viewport space and row height, including changes from showing/hiding statistics. Compact responsive balance records keep item/SKU, location, on-hand, reserved and available quantities accessible on phones. If a single record is taller than the available area, it scrolls locally.

Search matches SKU, item name, location name/code and serial identity without rendering large serial lists. Filters combine warehouse/vehicle, category, quantity/serial tracking, and availability (all, in stock, available, reserved, out of stock). Sort by item, location or available quantity in either direction. Clearing filters retains text search; **Clear search and filters** clears both. Filter/search changes reset pagination; refreshed results clamp/reset it rather than leaving an empty stale page.

CSV and Excel include **all matching balances in the selected sort order**, never just the current page. Each row contains item/SKU, category, unit, tracking, location/code/type, on-hand, reserved, available and serial count. Excel preserves numeric-looking product/location codes as text; CSV escapes quotes and protects against spreadsheet formula execution. PDF / Print opens a landscape print view with repeating project/timezone/table headings for browser Print / Save PDF. These summary exports contain serial **counts**, not hundreds of individual identities; use each balance’s **View serials** button and the existing serial viewer exports for the identities themselves. Zero-match exports are disabled and never substitute a broader scope. Search, paging, filtering and exporting do not change stock or movement history.

Checks: `npm run test:inventory-stock-exports` covers filtering, sorting, reservation math, exact Excel text, CSV formula protection, print escaping and zero-result scope safety. For the workspace browser check, create the disposable large fixture with `npx tsx tests/support/inventory-ui-fixture.ts --large-counts`, run `npm run test:inventory-stock-layout:browser`, then `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. It checks 602 balances, adaptive desktop/mobile pagination, toolbar/pager bounds, serial search/viewer, combined filters and sorting, full-match CSV/Excel and Letter/A4 PDF output, denied access and unchanged stock/receipts. Evidence is generated under ignored `generated-artifacts/inventory-stock-layout/`. Run the existing serial-viewer browser check with a fresh ordinary fixture rather than the large fixture.

In **Stock & search**, serialized stock rows show **View serials (count)** rather than placing every serial in the balance table. Quantity-only rows do not show a serial button. The dialog identifies the item/SKU and warehouse or vehicle; it shows the selected location's current on-hand serials, **including reserved units**, not a list of units available for allocation.

Search within the dialog and use Previous/Next to browse 50 serials at a time. Search ignores case, but display and exports preserve exact stored text, including leading zeros, capitalization, decimal-looking values and punctuation. The outer inventory search continues to find balances by serial without displaying the entire serial list.

Choose **All serials** or **Filtered results** under Export scope. The count displayed there is the number exported; exports include the entire chosen set, not just the visible page. Excel downloads `.xlsx` with project/item/location metadata and explicitly text-formatted serial cells (even formula-like serials are not formulas). TXT downloads UTF-8 plain text with one unmodified serial per line. **PDF / Print** opens a self-contained printable view; select **Print / Save PDF** in that view to save a PDF using the browser. Product/location headings repeat across printed pages, and long serials wrap without truncation. No external fonts or export service are required, including on standalone Windows/Linux installations.

The viewer uses the same authorized, warehouse-filtered inventory state as the Stock & search table and requires the existing inventory view permission. The selected row is resolved from current state rather than retaining an old serial snapshot. Viewing, searching and exporting do not reserve, move, adjust or otherwise change stock. Close/reopen for another item or location to reset the dialog search and export scope.

Checks: `npm run test:inventory-stock-serials` verifies text/Excel identity preservation and print escaping. After creating the disposable fixture with `npx tsx tests/support/inventory-ui-fixture.ts`, run `npm run test:inventory-stock-serials:browser`, then `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. The browser check creates only disposable project stock, verifies real XLSX/TXT downloads and Letter/A4 PDFs, location isolation, search/paging, mobile bounds, denied unauthorized access and unchanged stock. It requires the same Chromium/Poppler tools as the receipt print check; generated evidence stays in ignored `generated-artifacts/`.

### Finding purchase and transfer orders

The Orders tab has a persistent **Purchase & transfer orders** subheader beneath the main Inventory header. Search stays visible, with **Filters**, **Refresh**, **CSV**, **Excel**, **PDF / Print**, and **Saved shipment drafts** controls. Advanced filters open in a dialog; the cleared-PO toggle remains in the subheader. Saved shipment drafts are no longer an inline section: open their dialog to resume, adopt (where authorized), or discard a saved receiving/dispatch/arrival capture. A failed resume leaves that dialog open; it closes only after the current draft/order snapshot is validated and the shipment session is ready.

The locally scrolling result area shows a compact page of orders. Page capacity is measured from the actual available result height and collapsed record height, including gaps; resizing the window or showing/hiding Inventory statistics recalculates it. The toolbar and pager stay outside that scroll area. Order details expand to show line progress and internal IDs without permanently reducing the normal page capacity. Filters reset to the first page, and shrinking result sets clamp the current page. On small screens, a single tall/expanded record can scroll within the bounded results area.

List exports include **all matching orders across all pages**, in the selected sort order, and never fall back to unfiltered data when no matches exist. CSV and Excel use one row per product line, with readable order number/reference, immutable internal ID, vendor/route, product/SKU, configured-timezone creation date and fulfillment/exception quantities. CSV uses UTF-8 and quotes delimiters; formula-like text is prefixed with an apostrophe to prevent spreadsheet formula execution. Excel preserves original text values (including numeric-looking IDs/SKUs and formula-like references) as text cells, with quantities numeric and project/scope metadata on an Export details sheet. Prefer Excel when a spreadsheet must preserve leading zeros automatically.

**PDF / Print** opens a self-contained landscape print view; select **Print / Save PDF** to save it using the browser. This compact order list uses readable identifiers instead of raw UUID columns and repeats project/timezone/column headings across pages. The individual order/receipt Print buttons retain their existing document behavior and ID barcodes. Viewing, filtering, paging and list exports do not change stock or shipment history and use the same authorized warehouse/project state as the existing Orders tab.

Checks: `npm run test:inventory-order-exports` verifies exact export scope, timezone values, spreadsheet text/formula safety and print escaping. With a disposable fixture created by `npx tsx tests/support/inventory-ui-fixture.ts`, run `npm run test:inventory-orders-layout:browser`, then clean it up with `npx tsx tests/support/inventory-ui-fixture.ts cleanup`. The Chromium/Poppler browser check covers 60 purchase/transfer orders, adaptive desktop/mobile pagination, fixed toolbar/pager bounds, details and edit modal access, search/advanced filters, all-matching CSV/Excel/Letter/A4 PDF exports, zero-result export disabling, draft resume failure/success and unchanged stock/receipts. Evidence is generated under ignored `generated-artifacts/inventory-orders-layout/`.

Search and filters work on the inventory snapshot already authorized for the current project and warehouse access. They do not change stock or orders.

| Control | How to use it | Example |
| --- | --- | --- |
| Search orders | Enter all or part of an order number, reference, legacy/internal ID, product ID/SKU, product name, vendor name, or location name/code. Each space-separated word must appear somewhere in the order's searchable fields; a match on any product line returns the order once. Leading zeros are not converted to numbers. | `E460 Cleveland`, `27491-01`, `PO-2026-000123`, or `000701` when that is a product SKU—not an unknown equipment serial. |
| Order type | Restrict results to purchases or transfers, or choose All. | Transfers only when planning vehicle replenishment. |
| Order status | Choose draft, released, partial, completed, closed, or cancelled; All removes the restriction. | Partial shows orders still being fulfilled. |
| Vendor filter | Restrict by the purchase order's vendor; All vendors clears it. | Landis+Gyr purchases. |
| Source filter | Restrict transfers to a source warehouse/vehicle. Purchases have no source warehouse. | Cleveland Main → any destination. |
| Destination filter | Restrict purchases or transfers to a destination warehouse/vehicle. | Service Vehicle 1. |
| From date / To date | Inclusive creation dates in the timezone displayed beside the controls. Either boundary may be omitted. Invalid/inverted ranges show no matches and need correction. Legacy orders with missing/invalid creation dates are excluded only when a date boundary is applied. | From `2026-10-01` through `2026-10-15`. |
| Sort orders | Newest first (default), oldest first, or natural order-number order; ties use a stable number/ID comparison. Undated legacy orders sort last. | Order number groups PO/TR numbers predictably. |
| Show cleared POs | Include archived cancelled purchases; the normal default hides them. This does not reopen or restore an order. | Enable it, filter Cancelled, then search an old supplier reference. |
| Reset filters | Clear search, type/status/vendor/location/date restrictions and restore newest-first sorting. The separate Show cleared POs toggle is unchanged. | Recover the full non-cleared list after no matches. |

Filters narrow each other: for example, search `E460`, choose Purchase, Released and a destination to find only released purchases containing that product for that location. The matching count reflects the combined criteria. Product ID means the inventory item's SKU; the lookup-table System/Module Type product fields are not used when inventory is enabled. Serialized identities are captured during shipment processing, not order planning, and are not part of this order-product search.

Project and full-system backups retain numbers, references and yearly counter high-water marks. Legacy backups without these fields remain compatible. Restore validates duplicate/invalid numbers before replacement and retains the higher known local counter so restoring an older snapshot does not reuse locally known numbers. A fresh independent installation restored from an old snapshot cannot know about numbers issued after that snapshot elsewhere; numbering is not a cross-instance accounting sequence.

If an older archive omits numbers for orders already known locally, restore keeps their previously assigned numbers. Conflicting numbers for the same internal order, or duplicate restored labels, stop the restore rather than silently renumbering evidence. The authorized inventory snapshot supplies the effective display timezone, including UTC when timezone conversion is disabled, so users do not need administrator settings access to use date filters.

**Retrying a draft save:** if a save fails or its response is lost, keep the editor open and click **Save draft** again. An unchanged retry reuses the same order and request IDs, even when the reference was blank, so a committed save is confirmed rather than duplicated. Correcting quantities or notes before retrying keeps that order ID but uses a new request to update the draft. After a confirmed save, entering another order creates a new identity. This retry protection belongs to the current open editor; it is not browser-restart recovery. After restarting or intentionally leaving, check the order list before recreating an unconfirmed order. Saving or retrying a draft does not reserve, receive or transfer stock.

Receiving and transfer movement dialogs use the guided scanner described below, not the catalog picker used when drafting an order. Other inventory editors may still accept newline/comma/semicolon-separated lists.

### Guided receiving and transfer scanning

Open **Receive**, **Dispatch**, or **Accept arrival** on the relevant order. Only its eligible outstanding products appear. The order ID, SKU, requested/dispatched quantities, earlier receipts, usable acceptance, damage and remaining amounts identify what you are processing. Zero means **skip this product on this posting**. The same posting can contain both quantity-tracked and serialized products.

| Field / option | How to use it | Example |
| --- | --- | --- |
| Good | Enter usable units physically received, or units physically leaving the transfer source | `8` good meters |
| Known damaged | Enter damaged physical units with a readable identity; for quantity-tracked supplies this is simply the damaged quantity | `1` meter with serial `000803`, or `2` broken seals |
| Unreadable | Serialized receipts only: damaged physical units whose serial cannot yet be verified. These are not missing units and are never usable stock | `1` meter with an unreadable label |
| Scan / edit serials | Set quantities on the item row, then open its serial-scanning sub-modal. The parent shows scanned/required counts without expanding a serial list | For `E460`, enter Good `8`, then click **Scan / edit serials** |
| Good / Known damaged serial scanner | Inside the sub-modal choose the category, scan/type one unit identity, then commit with Enter or a nonempty Tab. The button beside the input commits a manually typed identity | Scan `000801`, press Enter, then `000802`, press Enter |
| Unidentified damage references | Transfer arrivals only: open the serial sub-modal and choose **Unreadable references**. Select exactly one unresolved **actually dispatched** identity for each unreadable physical unit. These are unverified custody references, not claimed physical label readings | Dispatch showed `000804`; search/select that reference after documenting why the arrived unit cannot be read |
| Damage condition / reason | Required for each product with damaged/unreadable units. Describe actual condition, not just “short” | `Carton crushed; register glass broken; label scraped on one unit` |
| Movement note / exception reason | Optional for an ordinary movement; required when closing its remainder. Include delivery slip or receiving context | `Delivery slip DN-204; supplier confirmed remainder cancelled` |
| Review movement / View serials | Check compact quantities and counts before posting. **View serials** opens read-only identity inspection; use **Back to entries** before making corrections | Verify 8 good + 2 held = 10 physically arrived |
| Post movement | Post only this batch and leave any remaining quantities or inspection exceptions open | Receive 6 of 10 today; receive the other 4 later |
| Close the order remainder | Permission-gated receiving choice, with required reason and confirmation; no outstanding transfer transit may remain | Close the final 2 unshipped units because the supplier discontinued the item |

Configure the HID scanner as a keyboard-wedge device with an **Enter suffix** (Tab suffix is also supported). Use a plain text test field to check its output first: it must transmit the unit serial, including leading zeros, rather than a product barcode. No camera or manufacturer SDK is needed. In the sub-modal each successful scan is recorded on its own numbered line and focus stays ready for the next unit. Once the good target is filled, focus advances to the needed known-damaged category within that same product. When capture is complete, focus stays in the sub-modal; click **Done** to return and choose the next product. It never posts the movement automatically. Empty Tab follows ordinary keyboard focus. An invalid/duplicate scan stays in the input for correction; it does not advance. Use **Remove serial …** to correct a committed identity.

The scanning window identifies the order, product/SKU and movement stage. Serial and expected-reference lists are bounded and paged at 50 entries, with separate searches and previous/next controls; scanning a large shipment does not add hundreds of rows to the parent entry or review screen. **Good** and **Known damaged** switch the capture category. **Unreadable references** appears for transfer arrivals and retains its separate unverified meaning.

**Done**, the close button, Escape or an outside click return from the sub-modal to the still-open movement form. Committed scans and unfinished scanner text are retained while that movement stays open; a partial scan session can be resumed using **Scan / edit serials**. Closing the child does not receive, dispatch, accept or otherwise post stock. Uncommitted text is flagged, and final review still requires every scanner entry to be committed or cleared and quantities to match identities. From movement review, **View serials** permits searching/paging only; **Close** returns without altering the reviewed data.

For example, a PO contains 3 meters and 20 seals. Enter Good `2` and Known damaged `1` for meters; scan `000801`, `000802` as good and `000803` as damaged. Enter Good `18`, Known damaged `2` for seals and describe their condition. Review and post once. Only two meters and 18 seals become usable; one meter and two seals enter shipment quarantine. If there is no damage and only two meters arrived, enter Good `2` and leave other quantities at zero—the third meter stays expected.

The number of committed serials must equal each serialized quantity. Reducing a quantity does not silently discard scans: remove/correct the excess explicitly. Transfer dispatch checks available unreserved source identities, including restrictions on older orders with preselected serials; arrivals require fresh physical scans from that transfer's unresolved dispatched identities. A new supplier serial cannot generally be identified as the wrong SKU without external product-label verification; verify the product on the receiving line. Known unavailable identities and all server stock/serial constraints remain enforced.

Cancel, the close button, Escape or outside dismissal of the **parent movement form**, and navigation within the application (including Back/Forward), protect unsaved quantities, reasons, committed scans and raw scanner text with a Stay/Discard choice. **Stay** cancels leaving and keeps the capture; **Discard** closes or leaves without posting stock. Refreshing or closing the browser tab uses the browser's own leave-page warning when changes remain unsaved; wording varies by browser. Escape/outside dismissal of only the serial child returns to the parent and retains its local capture. **Discard** in this local-edit prompt does not delete a server checkpoint, whether saved manually or automatically. Pending debounce saves pause while a discard/navigation prompt is open and are canceled when leaving; an in-flight save must settle before confirming Discard. An unconfirmed request may have reached the server even if its reply was lost. Resume shows the actual server checkpoint. Changes made since the last confirmed checkpoint are not guaranteed to survive a refresh, crash or browser restart. Review never omits unfinished scanner text.

### Save and resume shipment scans

Receiving, transfer dispatch and transfer arrival automatically checkpoint edits on the MeterFlo server and retain explicit **Save draft**. Saving does **not** receive goods, dispatch stock, reserve units, prepare a stock posting, close quantities, or post a receipt.

Automatic saving starts after about **800 ms without editing**. During uninterrupted input, a checkpoint is requested within about **5 seconds** while the editor is active and no save is running. Browser timer throttling and network/server delays can extend these times: they are scheduling targets, not a durability deadline. Requests are serialized; scanning remains enabled during automatic saving. New edits stay in the form and are included in the next checkpoint, never overwritten by an older response. Raw scanner buffers, leading zeros, whitespace and serial text remain exact. Untouched empty forms are not automatically saved.

| Control or information | How to use it | Example |
| --- | --- | --- |
| Saving… | A checkpoint is in flight. Continue scanning; newer edits need a later confirmation | Scan `000803` while the preceding snapshot saves |
| Saved — latest capture confirmed on server | All currently displayed capture values match the confirmed server checkpoint; Resume can recover it after a restart | `0008` unfinished text survives as `0008`, not as a numeric value |
| Not saved | Edits are waiting for the debounce or the previous save failed. After failure, automatic retries pause; reconnect and use **Save draft** | Do not close a browser with offline scans expecting them to survive |
| Save draft | Save the entire current capture, including incomplete/mismatched quantities, good and damaged identities, selected unreadable dispatched references, reasons and unfinished scanner text. It stays open; after confirmation, Cancel can close it without deleting the saved record | Save 37 scans toward a quantity of 100, then finish the delivery tomorrow |
| Saved shipment drafts → Resume | Reopen the owner’s last server checkpoint using current inventory and order data. The card shows order, receiving/dispatch/arrival stage, owner, saved time and revision | Resume `PO-204` after closing/reopening the browser; leading-zero identities and `0008` unfinished text remain exact |
| Discard saved draft | Confirm removal of the durable checkpoint. This does not change stock. A prepared attempt must first be recovered; it cannot be discarded while posting is unconfirmed | Remove a saved, unposted capture for a delivery entered against the wrong PO |
| Take ownership | Administrators explicitly adopt another owner’s record, including an unavailable account after a portable restore. Capture remains intact; an unposted prepared identity is canceled atomically. An already-posted receipt stays available for confirmation | Adopt an absent receiving operator’s saved scans rather than impersonating their account |

Drafts are owner-only for ordinary users. Visibility and commands still require current project access, **View inventory**, the stage’s **Receive inventory** or **Transfer inventory** permission, and warehouse access. Administrators can see and explicitly adopt accessible foreign records, but cannot silently edit/post them as the previous owner. There is one checkpoint per order/stage across owners, at most **100 saved shipment drafts per project**, an **8 MiB command-data limit**, and a **32 MiB total saved-draft-state limit**. Limits reject the request without truncating capture or making stock changes. Finish or discard saved drafts before deactivating their warehouse.

Concurrent edits use a revision check: a stale save is rejected, and that editor’s local quantities/scans stay visible rather than being replaced by the other session. Automatic saving pauses rather than repeatedly attempting to overwrite it. To load the winning server version, Cancel, explicitly **Discard** local edits, then **Resume**. A lost response is confirmed only when owner, revision and exact capture match. Otherwise **Save draft** retries the same command identity/body before saving newer edits. There is no offline browser storage queue: unconfirmed local edits can still be lost on a crash. Automatic saving is suspended throughout prepared-posting recovery. On resume/review, captured identities and quantities are rechecked against current capacity, stock/reservations and transfer custody. Missing/inactive products or unavailable identities must be corrected; saved rows are not silently dropped. Stock posting is revalidated under the server lock as well.

#### Recover an interrupted posting

**Post movement** first saves the capture and prepares an immutable posting identity/payload durably, then requests the stock movement. If the reply is lost, the record survives a restart with the same identity. In **Recover prepared shipment**:

1. **Check status** refreshes the server record and looks for the matching receipt.
2. If already posted, **Confirm receipt and close** acknowledges that receipt and removes the saved checkpoint; it sends no new stock request.
3. If no receipt is confirmed, **Retry unchanged** submits the exact stored payload and identity. It cannot create a second receipt for an already committed operation.
4. **Return to editing safely** asks the server to cancel an unposted prepared attempt atomically before permitting corrections. A late old POST cannot commit after unlock; an already-posted attempt cannot be unlocked.
5. **Close — keep saved draft** leaves the durable recovery available for later, without changing stock.

Do not start a different physical receipt to work around a lost response. Once a receipt is confirmed and acknowledged, a later shipment is a **new** business operation, even when quantities are identical. Save/prepare/ownership/unlock/removal actions are audited with owner, revision, quantities and scan/buffer counts; operational save history does not repeatedly copy full editing scan lists. The current saved record preserves those exact values. Final physical movement receipts continue to retain posted identities and stock evidence.

Project and full-system inventory backups/restores include saved captures and pending posting identities. Legacy backups without these fields remain supported. A restore retains source ownership; use explicit administrator adoption when that owner does not exist locally. This checkpoint workflow uses the existing database and works independently of Replit storage on Windows/Linux. It does not change mobile authentication or add a mobile draft-editor API.

**Limits:** up to 500 product lines per movement; whole-unit quantities up to 1,000,000 per combined product line; at most 10,000 combined known/unverified serial references per product line; serials 1–100 characters; condition/reason text up to 1,000 characters; shipment command `data` up to 8 MiB encoded JSON. Smaller batches are recommended for very large serial shipments. Over-limit submissions fail without partial posting. These are enforced limits, not a claim of physical scanner throughput. Automated Chromium tests simulate keyboard-wedge Enter/Tab input; actual scanner hardware and all customer OS/browser combinations require separate acceptance.

### Partials, shortages and damaged stock

- **Leave partial:** post actual units and leave the balance expected. Unshipped transfer quantities remain at source; dispatched but unreceived units remain in transit.
- **Close with exceptions:** a user with `inventory.closeOrders` and destination warehouse access supplies a reason and confirms the exact outstanding amounts. The order becomes `closed`, not falsely `completed`; original ordered quantities and all earlier receipts remain intact. An order with zero arrivals can be closed without inventing a stock receipt. A physically received damaged unit is not counted as missing. Closure does not erase pending inspection.
- **Transit loss:** use **Resolve transit loss** only after investigation establishes that dispatched units will not arrive. `inventory.resolveExceptions` plus destination warehouse access is required. Select exact lost quantities and identities, give the evidence/reason, review and confirm. No destination stock is added and source stock is not automatically returned. Losses settle only those in-transit units, are blocked against duplicate inventory resurrection, and leave the order open until an explicit closure. Ordinary cancellation cannot erase unresolved transit.
- **Replacement order:** use **Create linked replacement** to make a new draft linked by `replacementFor`. Review its suggested quantities against any open supplier obligations before saving/releasing it. Damaged units already count as physically received, so ordinary receipt capacity on the original order is not silently increased. Only original orders can be replacement parents; a replacement cannot point to itself or chain to another replacement.

**Shipment exceptions** is separate from **Removed equipment** (the latter concerns old devices removed on work orders). Search by product/serial/order/receipt or filter by warehouse. Each shipment hold retains its original receipt, location, actor, observed condition, known identities and explicitly unidentified count. Usable stock search, reservations, work-order consumption, dispatch and assembly exclude these held units. Normal stock counts count **usable stock only**; keep quarantine physically segregated and reconcile it through the exception workflow, not through a discovery count.

Authorized inspectors use **Resolve** on a held batch:

| Disposition | Required input / effect | Example |
| --- | --- | --- |
| Release after inspection | Quantity and reason; for serialized goods select known units and/or an unidentified count, then enter one exact verified identity per selected unit. Selected known IDs and transfer references must match. Only selected units become usable | Select known serial `000803`, quantity `1`, unidentified `0`, and verify `000803`. The unreadable unit stays held |
| Record physical return | Quantity, reason, selected serialized custody (if applicable), and return destination/shipment reference. Only selected units leave quarantine; usable stock does not change | Return `1` unidentified purchase unit with `Supplier RMA-204, dock 3, tracking ABC123`, leaving the others held |
| Scrap / write off | Quantity, selected serialized custody (if applicable), and approval reason. Only selected units leave quarantine; their known/expected identities remain blocked | Select the failed serial, quantity `1`, and record `Supervisor approved destruction; failed safety test` |

Each disposition applies to **the selected subset**. Defaults select all remaining units for whole-batch convenience. Change **Units to disposition**, check only the still-held known serials covered by the action, and set **Unidentified units to disposition** as needed. Known serial count plus unidentified count must equal the quantity; regular products need only the quantity. For unidentified transfer units, select exactly one still-held dispatch reference per unidentified unit. All unselected units stay quarantined. Record one action, then reopen **Resolve** for another subset/outcome; there is no need to split the original receiving record.

For example, a hold contains two known meters and two unreadable purchase units. Release one verified known meter; return one unreadable unit with an RMA; later identify/release the second unreadable unit and scrap the failed known meter. The original physical receipt and received total remain `4`; only the two released units increase usable stock. The hold displays remaining custody and every disposition's quantity, actor, time, reason, selected/verified identities, reference and receipt. A mixed fully resolved hold is marked `resolved`, not falsely `released`; returned/scrapped units remain exceptions in fulfillment reporting.

An unreadable unit can never be released as usable serialized stock until its exact physical identity is verified. A transfer identity mismatch requires investigation, not guessing another serial. Unknown purchase units cannot have their serials blocked on write-off because those identities were never established. Returns are physical custody records, not automatic supplier credits, carrier claims or vendor accounting. On an unconfirmed response, keep the inspection dialog open and retry the unchanged selection; it reuses the same request ID. After confirmation, another selected batch is a new action, even with identical quantities/reasons. All validation and custody updates use the same project-wide transaction lock as inventory movements.

Order printouts show ordered, dispatched, physically received, usable accepted, damaged, still-held, lost, in-transit, still-expected and approved closed-short quantities. “Usable accepted” is historical acceptance/release, not today's remaining on-hand stock. Receipts show only their specific movement/disposition, including damaged/unidentified units, order and receipt IDs, reasons and external return references. Closed orders retain their exception records.

### Shipment command examples

Use the existing authenticated command endpoint with a fresh operation UUID for a new posting and the **same UUID and unchanged data/actor on retry**. Successful responses include the posted `operationId` and a refreshed snapshot; internal operation fingerprints are not exposed by snapshots.

```json
{
  "operationId": "63e456d2-3778-45cf-95b1-d990467113b1",
  "action": "receive",
  "data": {
    "orderId": "PO-204",
    "lines": [{"itemId": "meter-id", "quantity": 2, "serials": ["000801", "000802"]}],
    "damaged": [{
      "itemId": "meter-id", "quantity": 2, "serials": ["000803"],
      "unidentifiedQuantity": 1, "expectedSerials": [],
      "reason": "Crushed carton; one unreadable label"
    }],
    "reason": "Delivery DN-204; leave remaining order open",
    "closeRemainder": false
  }
}
```

`lines` contains **good units only**; `damaged` contains damaged physical units separately, so never also put those units in `lines`. For serialized damage, `quantity = serials.length + unidentifiedQuantity`. For ordinary products, use no serials/unidentified count. Transfer `accept` uses the same shape; its unidentified damaged units also require `expectedSerials` matching unresolved dispatched identities. `dispatch` uses good `lines` only. Ordinary receiving still accepts legacy `{orderId,lines,reason}` payloads.

| Action | `data` example | Result |
| --- | --- | --- |
| `closeOrder` | `{"orderId":"PO-204","reason":"Supplier cancelled the last two units"}` | Preserve original quantities, store `closure.unfulfilled`, actor/time/reason, mark `closed`. No stock added |
| `resolveTransit` | `{"orderId":"TR-204","lines":[{"itemId":"meter-id","quantity":1,"serials":["000805"]}],"reason":"Carrier confirmed loss; supervisor approved"}` | Append loss evidence and settle only the stated transit identities; no destination receipt stock |
| `resolveHold` release | `{"id":"hold-id","outcome":"released","quantity":1,"serials":["000803"],"unidentifiedQuantity":0,"expectedSerials":[],"reason":"Label verified and tested","reference":"","verifiedSerials":["000803"]}` | Release this known unit only; original hold/physical receipt stay intact |
| `resolveHold` return | `{"id":"hold-id","outcome":"returned","quantity":1,"serials":[],"unidentifiedQuantity":1,"expectedSerials":[],"reason":"Supplier accepted unreadable purchase unit","reference":"Supplier dock / RMA-204","verifiedSerials":[]}` | Return one unidentified purchase unit; others stay held |
| `resolveHold` scrap | `{"id":"hold-id","outcome":"scrapped","quantity":1,"serials":[],"unidentifiedQuantity":1,"expectedSerials":["000804"],"reason":"Approved destruction of damaged transfer unit","reference":"","verifiedSerials":[]}` | Scrap one unidentified transfer unit and block its dispatched reference |
| `order` replacement | Existing order-draft data plus `"replacementFor":"PO-204"` | Create a new order, retaining a link to the original; does not reset original receipts |

For regular-item dispositions, send `quantity` and empty identity arrays with `unidentifiedQuantity:0`. Every explicit subset must include `quantity`; omitted selection arrays/counts mean empty/zero. Omitting **all** subset fields (`quantity`, `serials`, `unidentifiedQuantity`, `expectedSerials`) retains the legacy whole-remaining-hold behavior. `verifiedSerials` is only used for release; returns/scraps must send it empty. Transfer release of an unidentified unit uses its selected `expectedSerials` entry in `verifiedSerials`, never an invented replacement identity. New histories append immutable `dispositions` linked to receipts; older whole-batch `resolution` snapshots remain readable and restorable without conversion.

For `closeRemainder:true` on `receive`/`accept`, the receiver additionally needs `inventory.closeOrders`; an ordinary receiving grant cannot bypass that requirement. Empty `lines` are allowed for damaged-only receiving or an authorized closure, never for an unexplained empty posting. An atomic failure posts none of the good/damaged/closure data.

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

Authenticated inventory commands use `POST /api/projects/:projectId/inventory/commands` with `{operationId:UUID,action,data}`. Actions are `warehouse`, `vendor`, `item`, `order`, `release`, `cancel`, `unrelease`, `archiveOrder`, `restoreOrder`, `receive`, `dispatch`, `accept`, `closeOrder`, `resolveTransit`, `resolveHold`, `assemble`, `countStart`, `countSaveDraft`, `countCancel`, `countPost`, `assign`, `prepareUse`, `returnAccept`, `returnRelease`, `reconcileWorkOrder`. Every action requires its registered permission; stock posting also requires warehouse access. The purchase-only `unrelease`, `archiveOrder`, and `restoreOrder` actions take `data: {"orderId":"PO-2026-014"}` and require `inventory.purchase`. A cleared order retains status `cancelled` and an ISO `archivedAt` timestamp; restoring visibility removes that timestamp. Retries must reuse the same operation UUID and identical data/actor; reused UUIDs with different content are rejected. The UI posts commands through review forms rather than a JSON editor.

For example, `countSaveDraft` data is `{"id":"count-id","revision":0,"rows":[{"itemId":"meter-id","quantity":"","serials":"0000456\npartial"}],"reason":"Still scanning"}`. Use revision `0` before the first save; subsequent saves send the returned `draft.revision`. The snapshot's count includes `draft: {revision,rows,reason,savedBy,savedAt}` only for authorized count operators with warehouse access. `countPost` includes `draftRevision` matching the loaded draft (for example `1` after the first save), plus its normal validated `lines` and `reason`. Older clients omitting `draftRevision` can post counts with no saved draft, but cannot overwrite a count with a saved draft. Conflicts return HTTP 409; reload/reconcile rather than blindly retrying an old revision.

Customer API Push includes an additive `inventory` snapshot when enabled: allocation/use/dispositions and the referenced catalog items. It shares the existing delivery/retry process. It is a snapshot of the posted work order, not a command for the customer's backend to change MeterFlo stock.

## Audit, backups and operations

Shipment damage, unidentified custody, explicit order closure, confirmed transit loss, linked replacements and inspection/return/scrap dispositions are persisted in the same project inventory aggregate and audited transaction as stock movements. Project and full-system JSON restores retain these records, receipt links and blocked identities; validation rejects broken exception references before replacement. Older snapshots without these additive fields remain supported. No Replit-specific storage/service is required for this warehouse workflow on Windows or Linux.

Committed inventory commands record actor, time, action, project, stock/reservation/serial changes and changed catalog/order/allocation/count/return records. Failed posting attempts are logged as failed when audit logging is available. Work-order completion and inventory posting are atomic. Browsing or unposted scan text is not a stock mutation.

Inventory lives in public PostgreSQL tables: a locked project state, relational catalog and quantity projections, and a movement ledger. Project writes serialize through the state lock to prevent double consumption/overselling. This favors consistent posting; evaluate load before deploying projects with exceptionally large histories. Movement records and business state are not disposable diagnostic logs.

Full PostgreSQL backups include these public tables. Full JSON backups and individual project JSON backups include inventory; project backups insert original work-order IDs directly (including gaps) and align the sequence for subsequent work orders. They require explicit replacement rather than merging conflicting stock. Individual inventory restores are atomic. Legacy full-system JSON restores validate project snapshots before changing business data and restore public data, all project work orders and inventory in one transaction: any project or row failure rolls back the database restore. Missing project snapshots or inventory snapshots are rejected rather than accepted as partial success. Schema preparation may leave empty schemas or schema migrations on failure; sequence counters can advance even when rows roll back. Files are restored separately: file errors leave the database restored and are reported as **Restore Incomplete**, not success. Older work-order-only backups cannot overwrite an inventory-enabled project. Local newer audit history and the authenticated restore initiation remain protected by the existing restore boundary.

Item images are in the configured project-files root under `inventory-<projectId>`; include project files in the backup to preserve their bytes. A database-only backup preserves image references, not files. When moving project backups to another instance, restore the matching project configuration and user/access references and copy the image files; project identity is part of the image URL.

Full-system JSON backups also include service types, system types, module types and their project assignment tables so source-specific work-order references can restore on a fresh server. Older JSON archives that omit these catalogs require matching lookup configuration already installed on the destination; restore validates that prerequisite before replacement and retains the omitted catalogs. If required codes/product IDs are absent, use a newer complete backup or install the matching configuration first.

Before disabling inventory resolve open orders, active reservations/counts and outstanding returns. Historical stock/history remains stored. Deactivating a location/item does not delete history. Never use direct SQL to edit balances or delete movement history. Disabling inventory is not a stock reset.
