---
name: Work-order status hierarchy
description: Shared core statuses and sub-statuses, with project-owned custom sub-statuses and inherited core rules.
---

The user wants global core work-order statuses and core sub-statuses in relational tables. Sub-statuses belong to a parent core status and inherit its rules, including rules defined later. For example, Hold under Trouble must retain Trouble behavior.

**Why:** Customers may need workflow distinctions that do not fit other projects' business rules.

**How to apply:** Allow authorized project owners to define project-scoped custom sub-statuses and use them in that project's custom business rules. Keep them separate in scope from shared core sub-statuses; do not let project customization bypass parent core status rules.

Preserve existing core-code foreign keys when adding relational status links; validate actual database constraints rather than assuming the declared ORM primary key exists.

**Why:** An older database enforced unique status codes but had no numeric ID constraint despite the ORM declaration. Replacing its core-code relationships would risk existing project data.

**How to apply:** Add the missing non-destructive ID key for new relationships; keep existing core status codes authoritative.

Sub-statuses use their own configured color alongside the parent's separate color in work-order details and lists.

**Why:** The user requested the configured Critical color in both places; inheritance concerns business rules, not replacing either status's visual identity.

**How to apply:** Keep parent and sub-status colors independent, with readable labels in light and dark themes.

Custom business rules must use permanent status/sub-status identities rather than editable display names.

**Why:** The user explicitly requires renaming custom statuses not to break project-specific business-rule programming.

**How to apply:** Treat names as labels. Preserve existing authoritative core codes and relationships; introduce or use immutable IDs/keys for custom rule references without rewriting historical evidence.

## Closed work-order protection

The user requires a per-project setting to move Completed orders to Closed after a configured period. Only an authorized user may reopen or edit Closed work orders.

**Why:** The user explicitly wants Closed orders protected from ordinary editing.

**How to apply:** Enforce the protection consistently in server-side mutations and UI controls, including bulk actions and imports. Keep closing distinct from undoing completed work or reversing inventory.
