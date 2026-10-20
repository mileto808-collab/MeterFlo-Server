# Field stock discrepancies

## Technician flow

1. At work-order completion, record the full quantity actually used, including serial identities for serialized equipment.
2. Completion debits the available quantity that can be safely matched to stock. Any used quantity not available to debit is retained as an open stock discrepancy, with the work order, item, location, reporting actor, timestamp, quantity and supplied serials.
3. A hard serial-custody conflict remains blocked. Do not bypass an installed, held, reserved, in-transit or elsewhere-recorded serial by receiving it again. Investigate custody and preserve the serial conflict for authorized review.

The field completion records actual use; it does not invent stock or make a technician resolve warehouse history.

## Warehouse review and resolution

1. Open **Inventory → Stock discrepancies**. Open records are shown first. Search by item/SKU, location, work order/customer work-order ID or reporting user; use the status filter for resolved history.
2. Open the associated work order and review the item, location, reported quantity, recorded availability, used quantity and serial identities. Expand the resolution details on resolved records to see the reason, evidence, reviewer, timestamp, method and linked receipt labels.
3. If the source record needs correction, use **Orders** to review purchase receipts/transfers, **Items / kit assembly** to review kit configuration or assembly, **Cycle counts** to correct observed count errors, and **Locations** to verify custody and location access. Correct and post actual business transactions in their normal workflows. Refresh the discrepancy list before resolving.
4. Select **Resolve**. Enter a specific reason of at least 10 characters and an investigation/document reference of at least 3 characters. Choose a supported method:
   - **Apply stock from a posted receipt**: select at least one listed Receipt #N. A receipt is offered only when its line matches the discrepancy item and location. The server checks available stock at resolution time and applies only this pending shortage.
   - **Document off-book correction**: an authorized reviewer attests that a receipt, transfer, assembly or count correction for equipment already used is documented elsewhere. Record that evidence and the investigation. This records no stock movement and is not proof that an actual PO or transfer was posted. It must never create available stock.
5. Submit once and wait for the server result. Resolution is atomic: the server must confirm the discrepancy is still open, the reviewer is authorized and has access, and the submitted evidence/receipt is supported. A stale or concurrent result should be refreshed and reviewed; do not repeat full work-order consumption.

Unknown serialized items already installed cannot be received into available stock a second time. Investigate custody and attach the appropriate supporting reference rather than creating a duplicate available serial.

Closing a discrepancy does not automatically settle an open purchase order, transfer, supplier invoice or kit inspection. Review any associated open records separately in their normal authorized workflows. A documented adjustment is not a replacement for required purchasing evidence or a claim that a receipt or assembly was posted.

## Permissions and retained records

Users with inventory view access can search, inspect, filter and export the discrepancy list. Only users with `inventory.resolveExceptions` can resolve an open record. The server remains authoritative for project access and supported evidence.

The discrepancy retains its reported quantity, used quantity, recorded availability, serials, actor, occurrence time and work-order association. Resolution adds reviewer, time, method, reason, evidence and receipt IDs. Receipt choices and links use readable, numbered Receipt #N labels rather than raw receipt UUIDs. Exports and print views include the selected status/search scope, timezone-aware dates, references and resolution history.

## Accounting distinction

At field completion, **only the actual available-stock debit is posted**. The discrepancy carries the portion of actual use that was not debited. Resolving with a matching receipt applies that pending debit from current available stock; it does not consume the entire work-order quantity again. A documented adjustment records an authorized off-book correction for already-used equipment, without changing current physical stock. Neither resolution mode posts the full work-order consumption a second time.
