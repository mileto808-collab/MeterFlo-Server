# Manual work-order inventory preparation

Inventory must be enabled for the project. Administrators grant planning/reservation access through **Assign work-order inventory**. A user preparing another installer's stock also needs inventory maintenance/configuration authority and access to that work order and the relevant locations.

## Plan
Open **Work Order Details → Inventory** and add a planned item and quantity. No warehouse, stock availability or serial is required. Manual additions are extra demand, not reservations or proof of use. An explicit override changes the quantity of an automatically derived item; quantity zero excludes it, and a reason is required. Imports and type recalculation retain manual entries. Overrides of an old type remain traceable but do not resurrect an obsolete automatic item.

## Reserve
Use the separate stock reservation controls to commit a source and quantity. A quantity hold on serialized equipment does not choose installed serials. Use exact-serial reservations only when a particular device is deliberately required. Reservations reduce available stock, not physical on-hand stock. Use the edit/remove controls to change or release them.

## Pull and physically stage
Preparation works manually now; a wizard is not required. Reserve stock while preparing a pull. When stock has actually been moved, use the work-order Inventory staging controls to choose the source and staging location or installer vehicle, enter actual quantities and custody serials, provide a reason, and confirm the physical move/receipt.

Staging requires transfer, receive and assign-inventory permissions plus location access. It moves physical stock atomically, relocates relevant source holds and creates quantity holds at the destination. Serialized custody appears on the staging receipt, but those units are **not assigned as installed serials** to the work order. Print the receipt as a movement/pull record.

Use normal Inventory transfer orders instead if goods are dispatched but still awaiting recipient acceptance. Do not confirm a staging move before physical receipt. A staging area can be an inventory location; creating a demand line is not a physical movement.

## Install and complete
The technician confirms actual items, quantities, source and installed serials during changeout. Reduce/remove unused planned extras. Confirmed completion is the priority; durable background accounting posts actual usage and releases unused holds. Planned demand or a staging receipt alone never consumes stock.

Warehouse review is under **Inventory → Stock discrepancies → Changeout posting**. Failed postings preserve accepted field evidence. Review mapping/source/actual-use issues and retry through the authorized review controls; do not invent installed serials or consume unused planned items to make a posting pass.

## Changes and interruptions
Reassignment flags existing reservations for source review; it does not silently move inventory between installers. With Inventory enabled, cancellation/deletion releases unfinished reservations under the existing lifecycle safeguards. If Inventory is disabled, re-enable it to clear a saved manual plan before deleting its work order. Completed/Closed work retains history and normal correction/reopening safeguards. Planning revisions and reservation revisions are separate: a conflict keeps local edits until the user reviews the latest saved version.

Manual planning, holds and staging receipts participate in existing project/full backups and inventory audit history. Later Start Inventory wizards will streamline these manual commands, not replace them with separate accounting logic.
