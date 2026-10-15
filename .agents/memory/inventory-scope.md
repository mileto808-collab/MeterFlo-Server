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
