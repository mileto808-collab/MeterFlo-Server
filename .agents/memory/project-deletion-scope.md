---
name: Project deletion scope
description: Project deletion must cascade through inventory even when its feature flag is disabled.
---

Authorized project deletion must remove the project and all project-owned
operational records, including stock and inventory history, even if Inventory
was enabled in the past but is currently disabled.

**Why:** The user explicitly requires deletion to work again and leave no stale
project records. Protecting an individual inventory item’s history is not a
reason to prohibit an administrator from deleting the entire project.

**How to apply:** Keep project deletion separate from inventory catalog-item
deletion restrictions. Treat the project schema and business-row removal as one
database transaction. Preserve shared site-wide users/catalogs.
Stage both ordinary project files and inventory inspection files reversibly.
Never report a file-cleanup failure as complete deletion: retain an isolated
cleanup journal and an administrator-visible retry/recovery action.

Project deletion must include project-owned audit and import logs, not merely operational inventory records.

**Why:** The user explicitly clarified that deleting a project should remove “ALL stale records everywhere including audit logs, import logs, everywhere.”

**How to apply:** Do not treat retained project audit evidence as satisfying complete project deletion. Keep unrelated site-wide records separate. Creating a clean configuration backup must not purge the source instance; destructive destination cleanup during a clean restore requires an explicit, clear reset boundary.
