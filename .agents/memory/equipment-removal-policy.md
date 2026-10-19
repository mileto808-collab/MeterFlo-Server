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

When mandatory warehouse returns are off, project administrators should explicitly select which individual field dispositions are included, rather than automatically exposing every active rule.

**Why:** The user explicitly requested individual disposition selection when the mandatory-return setting is off.

**How to apply:** Treat this as a configuration requirement, separately for the affected equipment scope. Do not confuse removal-rule existence or global active state with the project's allowed technician choices.

Warehouse handling needs a distinct “Return to customer” choice, separate from scrap and return to usable stock.

**Why:** The user described recording scrap with a note saying return to customer, but actually wanted to return the equipment rather than scrap it.

**How to apply:** Do not infer physical handling or rewrite prior decisions from free-text notes. Customer returns stay unavailable to stock while held, and require a separately recorded actual handoff. An incorrect decision needs an authorized, audited correction with physical-presence verification, retaining the original history.

Present one disposition choice, with its stock/custody behavior configured underneath. Built-ins do not need a second operational-outcome selector; custom dispositions explicitly map to a supported behavior in advanced configuration, never by matching their name.

**Why:** The user found the two routine choices duplicative, then confirmed the distinction between an editable name and its underlying action. Renaming must not change business behavior.

**How to apply:** Keep identity, label and action distinct. Preserve warehouse-only authority for stock release, scrap decisions, customer handoffs and corrections. Do not treat selecting customer return as evidence that the equipment has already left custody.

Independently saved removal controls that share a policy revision must serialize saves through completion of the refreshed snapshot.

**Why:** Saving technician selections and immediately toggling mandatory returns can otherwise submit an earlier revision even after the database has accepted the first save.

**How to apply:** Coordinate pending writes across the settings controls, while preserving unsaved selections and rejecting genuinely stale submissions.

The work-order Inventory section must be its own collapsible card immediately after System/Module Details, named “Inventory,” not nested inside equipment details.

**Why:** The user explicitly changed this placement and name.

**How to apply:** Keep it consistent on desktop and mobile, and hide it when project inventory is disabled.

Do not use reading-form visibility to decide whether completion is exempt from inventory authorization. Consider both reading and changeout scopes for user-choice projects; preserve unchanged inapplicable historical captures, but do not allow editing hidden or old/new identities to disguise a replacement.

**Why:** A project can read systems but replace modules. Inspecting only its reading scope allowed a module replacement to complete without inventory permission or a required return disposition.

**How to apply:** Regression checks must include differing reading/changeout scopes, no prepared review, an explicit reading-only review, and an otherwise authorized technician without inventory-use permission.
