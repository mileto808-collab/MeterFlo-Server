---
name: Inventory cycle count scope
description: User-selected product counts and full-page count navigation.
---

Start count must offer an explicit Full warehouse or Selected items choice, with location and scope only in the modal. Selected items remains the default: operators choose products on the count page, not in the start modal, without automatically adding every warehouse item. Selecting a warehouse and confirming Start count opens the count page immediately; Continue count opens the same page, not a modal.

**Why:** The user requested both full-warehouse and selected-item workflows, after reporting that automatic warehouse-wide entry creation prevented selective counting. They also requested the same page-based editing used elsewhere in Inventory.

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

Product barcode scanning selects a catalog product once; it does not count units, increment actual quantity, or replace serialized-unit scanning.

**Why:** The approved improvement was adding count products by barcode, not inferring physical quantities from repeated product scans. Serialized and quantity-tracked products still need an explicit physical count.

**How to apply:** Keep product selection and serial capture separate. Preserve leading zeros, reject ambiguous product identities, and leave repeated product scans non-destructive.

The count editor uses one master product search for barcode scans, SKU, name and partial description. It filters discovery choices and existing count entries; Enter or Tab adds an exact identity or uniquely matching product without increasing existing quantities.

**Why:** The user rejected redundant barcode, discovery and count-entry search fields and requested product selection on the count page rather than in the start modal.

**How to apply:** Keep ambiguous searches available for dropdown selection rather than guessing. Clearing a successful addition must reveal existing entries again, and filtering must never remove captured rows.

Browser-local recovery is a best-effort safety net, not a server draft or an automatic stock adjustment. Restore must be an explicit choice and must retain the captured draft revision.

**Why:** The user approved recovery after an unexpected browser restart. Quietly assigning the newest server revision to older captures could overwrite another operator's saved work.

**How to apply:** Isolate captures by account, project and browser session writer; never erase another tab's newer capture during cleanup. Keep restored older revisions blocked from saving/posting until the current server draft is reloaded. Warn when local storage is unavailable, and continue recommending explicit server draft saves.
