---
name: Equipment removal policy
description: Project-specific field dispositions and warehouse authority boundaries requested by the user.
---

Manage equipment-removal business rules per project within Inventory. Custom disposition names may share a required warehouse-return outcome. Technicians may choose only contract-approved field dispositions; warehouse workers/managers need separate authority for final decisions after returned equipment arrives.

**Why:** The user explained that contracts may require ALL removed systems/modules to return, and field technicians generally lack authority to scrap or leave equipment onsite.

**How to apply:** Use the same rules across work-order details, wizards, server completion, and the mobile API. Preserve historical removal decisions rather than reinterpreting them when a custom rule changes. Reading-only work never consumes inventory; project workflow and equipment scope govern available controls. Place the collapsible inventory section beneath equipment details within the System/Module section.
