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

Expanding Search & Tools must expose the complete tool panel without a separate capped-height scrolling area.

**Why:** The user rejected having to scroll inside the tools to find controls and asked for a mobile-optimized layout.

**How to apply:** Use natural-height responsive controls in the page's normal scroll flow. Keep only the collapse control sticky, not the entire expanded panel; a tall pinned panel must not cover count entries on short landscape screens.

Serial entry belongs behind a compact item-row icon opening a review/scan modal, rather than a large inline serial box. Repeated HID scans must advance automatically to the next serial line without additional clicks.

**Why:** The user expects potentially large serial lists and explicitly requested continuous HID scanning.

**How to apply:** Support Enter-terminated keyboard-wedge scans, retain scan-field focus between commits, preserve leading zeros and raw entries, and keep actual quantity independent of scans. Opening the modal must not autofocus a text field on phones; closing it retains the count's local entries, with explicit count-draft saving for persistence.

Posting serial-identity discrepancies from the count page requires an explicit review of missing and unexpected serials, including identity swaps whose total quantity is unchanged.

**Why:** The user approved a discrepancy-review recommendation after learning that a count can replace the location's recorded serial identities, not merely compare quantities.

**How to apply:** Explain removals versus additions, retain all captures on dismissal, and require acknowledgement before confirming. Acknowledgement applies only to the reviewed count, entries, reason, draft revision and stock baseline; live changes must block stale confirmation rather than silently changing the reviewed lists.
