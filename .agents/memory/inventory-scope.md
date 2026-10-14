---
name: Inventory scope
description: User-defined project inventory boundaries and reading-only distinction.
---

Inventory is enabled by an admin per project. Projects can have multiple warehouses, including vehicles and physical warehouses. Inventory-enabled projects use work-order items instead of editable System Type and Module Type fields; inventory-disabled projects retain their current relevant fields and workflow.

Readings do not require a changeout.

**Why:** The user explicitly specified these product boundaries; inventory must not turn a reading-only visit into an equipment replacement.

**How to apply:** Keep feature visibility, imports, work-order printing, web completion, and mobile synchronization consistent with project enablement and the actual work performed. Do not assume reading completion consumes replacement inventory.
