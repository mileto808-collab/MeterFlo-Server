---
name: Inventory scope
description: User-defined project inventory boundaries and reading-only distinction.
---

Inventory is enabled by an admin per project. Projects can have multiple warehouses, including vehicles and physical warehouses. Enabling inventory must not change existing file-import behavior or disable editable old/new System Type and Module Type fields on work orders; ordinary permissions and project equipment scope still apply.

Inventory enablement is reversible even with unfinished inventory work. Disabling is a non-destructive pause, not cancellation: preserve stock, serials, history, reservations, open orders, counts and returns. Existing reservations remain reserved. Ordinary work-order completion while disabled must not deduct stock; re-enabling must not invent retroactive consumption.

**Why:** The user said an already configured customer project may stop using Inventory and should not need to be recreated. Preserving unfinished evidence avoids silently releasing custody or cancelling business records.

**How to apply:** Keep administrator/configuration authority. Warn users to review pending inventory work and reconcile physical stock before resuming, since off-period usage is deliberately untracked. Serialize enablement changes against inventory commands and work-order transaction owners.

Labor must be an item with a user-configurable rate basis, such as hourly or daily, and must be usable as a kit component. All item types, not just labor, need separate internal cost and customer billing rates.

**Why:** The user explicitly requested configurable labor items in kits, chose both cost and billing rates, and clarified that both rates must be available for other item types too.

**How to apply:** Include labor when designing catalog and kit capabilities rather than treating it only as an unrelated project setting. Labor is non-stock: kit allowances must not require stock, serials, receiving or recoverable components. Configuring rates is not authorization to generate invoices or actual worked-time entries.

Readings do not require a changeout.

Imports and customer API pulls must never reserve systems or modules to work orders. Imported old System/Module Type values describe installed equipment; new System/Module Type values describe expected replacements. Type values must continue to validate against the type catalogs regardless of inventory enablement. When inventory is enabled, new type values should resolve to inventory items and create planned work-order lines without selecting physical stock or serials.

Only explicit manual item assignment while creating a work order or editing a non-completed, non-closed work order reserves stock. Serialized manual assignments capture the serial in work-order details. Otherwise technicians choose the actual system/module from their vehicle at the physical changeout; some customers track quantities without serializing systems/modules. Show required kit components on the physical-changeout wizard step, deduct actual inventory at completion, and associate captured serial identities with the work order then.

**Why:** The user clarified that the installed physical unit is unknown until the technician grabs it. Planned replacement requirements and physical reservations are different concepts. Customers may use kits containing systems/modules, hardware, and seals, with serialized or quantity-tracked components.

**How to apply:** Preserve behavior when inventory is disabled. Never interpret import-created requirement lines as reservations or stock consumption. Use explicit type-to-item references; do not assume independently generated numeric IDs identify the same entity.

The user accepted explicit type-to-inventory-item references rather than equal primary keys. Keep those links project-specific and optional for inventory-disabled projects. Support both preassembled kits and components collected during installation, as well as standalone system/module items with either serial or quantity tracking. Shipments may supply individual items or vendor kits.

**Why:** The user receives individual components unless the vendor supplies a kit, and not every work order uses a kit. Preassembly must not be required for standalone-item usage. Shared equipment types can serve projects with independent inventory catalogs, so a global item link would couple unrelated projects.

**How to apply:** Keep type-to-item references optional for inventory-disabled operation. Deduct components at assembly for preassembled kits and consume the finished kit at installation; when collecting components during installation, consume the actual components at completion without also consuming a finished kit.

Capture removed-equipment disposition as returned, scrapped, or left onsite; returned equipment is not automatically usable stock.

**Why:** The user explicitly specified these product boundaries; inventory must not turn a reading-only visit into an equipment replacement. The user subsequently reversed the earlier requirement to replace legacy import/type fields with inventory items and asked to undo that suppression and disabling.

**How to apply:** Keep feature visibility, imports, work-order printing, web completion, and mobile synchronization consistent with the actual work performed. Do not use inventory enablement alone to hide, strip, or reject legacy type fields or require stock assignments for ordinary imports. Preserve safeguards for real inventory transactions, and do not assume reading completion consumes replacement inventory.

Inventory retry comparisons must not depend on JSON object key order or optional-field defaults.

**Why:** Native payloads and validated server records can contain equivalent data in different key orders; treating that as different work wrongly rejects retries.

**How to apply:** Normalize contractual fields and compare canonical objects. Preserve the same operation identity across retries and never deduct stock twice.

Resource-form retries must retain the new resource's identity, and an unchanged retry must reuse the same operation identity. Corrections get a new operation identity for that same resource.

**Why:** A failed network response does not prove that the server failed to commit. Generating another resource identity on retry can create duplicates or leave an operator unable to recover from a duplicate-SKU conflict.

**How to apply:** Carry both identities through any future draft persistence or form refactor; do not assume a connection failure means nothing was saved.

Physical stock counts use starting-snapshot quantities and serials as editable defaults. After the operator verifies them and posts with a reason, unchanged visible defaults are accepted without mandatory rescanning.

**Why:** The former form showed saved serials but submitted an empty list unless the operator retyped them. Requiring re-entry of correct defaults would not address the mismatch between visible and submitted data.

**How to apply:** Keep display and submission consistent, including discovered products absent from the snapshot. Never interpret a blank quantity as zero or treat prefilled data alone as physical verification; retain explicit posting and the server's stale-stock/reservation checks.

Clearing cancelled purchase orders means archiving from the operator's list, not deleting their business identity. Returning a released PO to draft is supported only before posted receiving activity.

**Why:** Cancelling the remaining quantity does not undo earlier receipts. Hard deletion or reopening received orders would disconnect stock history from the original order and could allow ambiguous reuse of its reference.

**How to apply:** Preserve recoverable order history when reducing clutter. Once receiving has started, additional purchases should use a new PO rather than resetting the original document's lifecycle.

PO and transfer drafts should plan products and quantities, without capturing physical-unit serials.

**Why:** The user said, “No serials will be added here. We don't know what the serials are until the shipment arrives.”

**How to apply:** Keep serial capture in receiving or actual transfer dispatch/arrival, not order drafting. Planning quantities must not imply that specific physical units have already been selected.

Keep PO and transfer draft line items compact, with product, quantity and removal controls aligned together rather than tall per-item form sections.

**Why:** The user rejected the expanded rows: “line items should be closer together. too much wasted space inline.”

**How to apply:** Avoid repeating long visible quantity labels and valid-state guidance on every row. Retain product-specific accessible labels, inline validation and usable mobile controls.

Receiving and transfer movements should show the order's items inline and capture actual quantities, with one physical-unit identity per HID scanner scan.

**Why:** The user specified keyboard-wedge scanners, automatic advancement to the next serial entry, and that scanned identities must match received/transferred quantities. Shortages and damage must allow partial completion or an explicit exception, not invented receipts.

**How to apply:** Keep draft planning quantity-only; capture identities when physical custody changes. Do not replace the guided order rows with a generic item picker or silently treat damage as usable stock.

Keep serialized-unit capture in a dedicated, bounded sub-modal while receiving and transfer forms retain compact item quantities and scan summaries.

**Why:** The user said the inline serial list “could easily fill up the screen” and requested a scanning sub-modal.

**How to apply:** Do not reintroduce full identity lists into the parent entry or review screen. Closing a scanning window returns to the movement draft rather than posting stock or abandoning that draft.
