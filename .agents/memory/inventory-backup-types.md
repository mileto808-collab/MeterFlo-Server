---
name: Inventory backup type fidelity
description: Why inventory backup validation must cover both full-system and project paths with real posted data.
---

Verify full-system and project-level restore separately using posted serialized stock and movement history, not just empty inventory.

**Why:** Project-level restore passed while the generic full-system path could not restore generated identity IDs or bind serialized-stock JSON arrays correctly. Database JSON arrays and PostgreSQL array parameters are not interchangeable.

**How to apply:** For backup/schema changes, check type-aware row binding, identity restoration and subsequent generated IDs. Exercise the real restore against isolated test storage; never clear the shared application database for acceptance testing.

Use fresh sequences with ordered, gapped source IDs for restore acceptance, not only restores into the source schema.

**Why:** An already advanced sequence hid collisions caused by generating IDs and then renaming restored rows. Standalone schema variants can also use generated identities on public configuration tables, not only stock movements.

**How to apply:** Include fresh destination schemas and a subsequent generated insert. When exercising full-system replacement, redirect both unqualified and explicit public business-table references to disposable storage; leave local audit storage protected.

Fresh-server acceptance must include customer-specific work-order lookup values, not only default statuses or null equipment types.

**Why:** Restore fixtures without source-specific service/equipment references passed even though a fresh server lacked the catalogs required by the work-order foreign keys.

**How to apply:** Keep destination lookup catalogs empty before restoring the fixture; carry lookup definitions and project assignments in new backups. For older archives, validate explicit installed prerequisites before replacement rather than assuming bootstrap defaults are enough.
