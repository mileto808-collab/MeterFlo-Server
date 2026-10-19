---
name: Equipment removal policy
description: Project-specific field dispositions and warehouse authority boundaries requested by the user.
---

Manage equipment-removal business rules per project within Inventory. Custom disposition names may share a required warehouse-return outcome. Technicians may choose only contract-approved field dispositions; warehouse workers/managers need separate authority for final decisions after returned equipment arrives.

**Why:** The user explained that contracts may require ALL removed systems/modules to return, and field technicians generally lack authority to scrap or leave equipment onsite.

**How to apply:** Use the same rules across work-order details, wizards, server completion, and the mobile API. Preserve historical removal decisions rather than reinterpreting them when a custom rule changes. Reading-only work never consumes inventory; project workflow and equipment scope govern available controls.

Disposition names must be project-defined and consistent across choices, filters, current entries, Activity, and printing. Distinguish field dispositions from warehouse decisions; physical outcome keys are not substitutes for configured names.

**Why:** The user identified a filter displaying `returned` while the wizard and warehouse screens showed project-defined names, and approved using the existing per-project removal rules consistently.

**How to apply:** Filter by rule identity and physical outcome, not display text or outcome alone, so two custom rules with the same result stay distinct. Current entry details follow renamed project labels; history and event receipts preserve recorded names and say so. Match Activity to the exact operation, never a later decision on the same equipment. Quarantine acceptance is a custody step, not a configurable final disposition.

The work-order Inventory section must be its own collapsible card immediately after System/Module Details, named “Inventory,” not nested inside equipment details.

**Why:** The user explicitly changed this placement and name.

**How to apply:** Keep it consistent on desktop and mobile, and hide it when project inventory is disabled.

Do not use reading-form visibility to decide whether completion is exempt from inventory authorization. Consider both reading and changeout scopes for user-choice projects; preserve unchanged inapplicable historical captures, but do not allow editing hidden or old/new identities to disguise a replacement.

**Why:** A project can read systems but replace modules. Inspecting only its reading scope allowed a module replacement to complete without inventory permission or a required return disposition.

**How to apply:** Regression checks must include differing reading/changeout scopes, no prepared review, an explicit reading-only review, and an otherwise authorized technician without inventory-use permission.
