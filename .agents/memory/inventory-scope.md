---
name: Inventory scope
description: User-defined project inventory boundaries and reading-only distinction.
---

Inventory is enabled by an admin per project. Projects can have multiple warehouses, including vehicles and physical warehouses. Inventory-enabled projects use work-order items instead of editable System Type and Module Type fields; inventory-disabled projects retain their current relevant fields and workflow.

Readings do not require a changeout.

Reserve stock when assigned to a work order; deduct it when the changeout is completed. Capture removed-equipment disposition as returned, scrapped, or left onsite; returned equipment is not automatically usable stock.

**Why:** The user explicitly specified these product boundaries; inventory must not turn a reading-only visit into an equipment replacement.

**How to apply:** Keep feature visibility, imports, work-order printing, web completion, and mobile synchronization consistent with project enablement and the actual work performed. Do not assume reading completion consumes replacement inventory.

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
