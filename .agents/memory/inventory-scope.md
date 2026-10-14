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
