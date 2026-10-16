---
name: Category compatibility
description: Why managed category choices must preserve legacy free-text classifications.
---

Treat legacy item category names as existing project categories, not invalid input to erase or silently replace. Retain category definitions when their final item is cleared. Legacy case/whitespace variants may consolidate during the explicitly authorized ID migration, but must retain all item assignments.

**Why:** Inventory previously allowed free-text categories. The user explicitly chose stable-ID category relationships rather than cascading mutable category names, including coordinated migration of older projects and backups.

**How to apply:** Future category lifecycle changes must preserve identity across renames, backups, and customer-owned instances. Do not resurrect text labels as relationship keys or silently issue new IDs for modern dangling references. None is an unassigned relationship; a real category named None is distinct. Customer updates involving this change need controlled schema maintenance, not same-schema code-only activation.
