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
