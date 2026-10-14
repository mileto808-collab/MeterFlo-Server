---
name: Inventory backup type fidelity
description: Why inventory backup validation must cover both full-system and project paths with real posted data.
---

Verify full-system and project-level restore separately using posted serialized stock and movement history, not just empty inventory.

**Why:** Project-level restore passed while the generic full-system path could not restore generated identity IDs or bind serialized-stock JSON arrays correctly. Database JSON arrays and PostgreSQL array parameters are not interchangeable.

**How to apply:** For backup/schema changes, check type-aware row binding, identity restoration and subsequent generated IDs. Exercise the real restore against isolated test storage; never clear the shared application database for acceptance testing.
