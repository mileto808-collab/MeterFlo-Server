---
name: Category compatibility
description: Why managed category choices must preserve legacy free-text classifications.
---

Treat legacy item category names as existing project categories, not invalid input to erase or silently replace. Preserve historical spelling when editing unrelated item details; retain category definitions when their final item is cleared.

**Why:** Inventory previously allowed free-text categories. Introducing managed choices must not invalidate older projects, standalone installations, or backups. Changing classification storage to category IDs would require an explicit coordinated migration of those consumers.

**How to apply:** Keep legacy names available in selectors and exports. Future category lifecycle changes must account for case/whitespace variants and old backups. An empty category means None; a real category named None is distinct.
