---
name: Inventory cycle count scope
description: User-selected product counts and full-page count navigation.
---

New counts should start without automatically adding every warehouse product. Operators choose the discovery products they want to count. Selecting a warehouse in Start count opens the count page immediately; Continue count opens the same page, not a modal.

**Why:** The user reported that automatic warehouse-wide entry creation prevented the intended selective workflow and requested the same page-based editing used elsewhere in Inventory.

**How to apply:** Keep the warehouse chooser modal, but count editing uses a mobile-aware page with Back and sticky save/post controls. Retain all selected entries across filtering, paging and draft saves. Unselected quantities and serials must not change when posting a selective count.

Preserve existing full-warehouse counts rather than silently converting them or removing their saved entries. A selected count protects only the physical-stock baseline for the products it submits; a full-warehouse count still protects every original snapshot row.

**Why:** Changing the default must not erase unfinished historical counts or broaden a partial count's stock adjustments. Unrelated warehouse movement should not invalidate an intentionally selective count.

**How to apply:** Keep scope durable through relational persistence and backups. Require explicit actual quantities/scans for newly selected products, reject empty selected postings, preserve reservation and serial-custody safeguards, and keep one atomic all-entries commit.
