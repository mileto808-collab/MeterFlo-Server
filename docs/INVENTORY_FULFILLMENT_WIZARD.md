# Fulfill / Stage Work Orders

Open **Inventory → Start Inventory → Fulfill / Stage Work Orders**.
The chooser is the entry point for guided inventory tasks; the existing manual
Inventory and Work Order Details operations remain available.

## Before starting

- Enable Inventory for the project. Reading-only projects do not prepare replacement stock.
- An administrator creates the physical locations under **Inventory → Locations**:
  the source warehouse, a location using the **Staging** type, and a vehicle.
  Staging may be a marked shelf, cage, or area at the warehouse.
- Staging defaults to shared project inventory access, not public access.
  Warehouse workers must also have access to the destination vehicle.
- Posting requires Work Orders View and Inventory Assign, Transfer, and Receive.
  Preparing another installer's work also requires Inventory Maintain or Configure.
- Configure system/module inventory links or manually plan items on the work order.
  Labor is not physical stock and is excluded from the pull.

## Guided process

1. **Choose work.** Select a crew's group-assigned Open orders, or Scheduled orders
   for one individual installer. Filter by route, zone, group, installer, date,
   or work-order identifier. Each order is counted once.
   Use **Select all eligible matching orders** to select the current filtered
   results, or uncheck it to deselect those results. Mixed crews/installers must
   be filtered to one crew/installer first. Unavailable orders are excluded.
   Individual checkboxes let you adjust the selection. Filter changes retain
   previously selected orders; the summary shows selections outside the current
   eligible results. **Clear selection** removes every selection, including hidden
   ones, without clearing filters or other inputs. A batch is limited to 500
   work orders; bulk selection never silently truncates the results.
2. **Review batch.** Name it and choose Warehouse → Staging → Vehicle.
   One batch serves one group or one installer and one vehicle; multiple routes
   and zones can be included. Creating a batch records demand coverage, not a
   physical move or installation. Existing batches and prepared reservations
   reduce uncovered demand. Warehouse reservations are still eligible to be pulled.
3. **Stage stock.** Physically pull the quantities and scan serialized units.
   Enter a reason and confirm the physical movement before recording it.
   Partial pulls are supported; unpicked quantities remain visible.
4. **Vehicle handoff.** Physically hand over the staged quantities and verify
   custody serials. Partial handoffs are supported. Print the receipt, including
   its serial-details page. The batch completes when all quantities are handed over.

Crew batches protect their shared stock at Staging without assigning individual
units to individual Open orders. At vehicle handoff the stock becomes the crew's
available vehicle pool. Individually scheduled batches move quantity reservations
to Staging and then the vehicle, but do not preselect installed serials. The
technician still records the actual serial and use onsite. Neither staging nor
handoff consumes stock or changes a work order's status, assignment, or claim.

## Interruptions and changes

**Save & leave** retains this browser's selected work and unfinished input.
Saved batches and confirmed moves are recorded on the server and can be resumed
by another authorized warehouse worker. An unconfirmed physical move retains its
exact operation identity across refreshes; check its receipt or retry that same
command. Do not record a second move because a response was lost.

Stock and batch revisions are checked when posting. A rejected command does not
move stock and keeps its input available. Already-posted commands are replay-safe.
Changes to a selected assignment or order status require review before pulling
more stock. A scheduled batch cannot be handed to its former installer following
reassignment. Already-staged shared crew stock can still be handed to its vehicle.

Use **Release unfinished remainder**, with a reason and confirmation, when the
batch is no longer appropriate. This releases demand coverage and undelivered
holds; it does **not** physically return stock. Undelivered units remain at
Staging, and delivered units remain in the vehicle. Use the normal transfer or
work-order inventory controls to return/reallocate those physical units.

Receipts and grouped Activity history remain available after completion or
release. Work orders referenced by fulfillment history cannot be deleted, so
custody history and portable backups retain their work-order references.
