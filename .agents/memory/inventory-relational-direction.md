---
name: Long-term inventory relational direction
description: User-approved storage direction for core inventory and the supporting role of JSONB.
---

Use relational tables and database-enforced relationships as the long-term foundation for inventory. Core operational data includes items, categories, vendors, locations, orders and their lines, stock balances, serial identities, reservations, kit recipes and assembly contents, and counts and their lines. Use JSONB for supporting flexible attributes, external payloads, and immutable historical snapshots, not as the primary store for core business relationships.

**Why:** The user accepted this recommendation and stated, "I am looking at the long them inventory requirements." This is a lasting architecture direction, not just a request for Delete buttons.

**How to apply:** Scope inventory storage work toward a staged relational migration rather than expanding the shared JSONB snapshot. This decision is a target, not evidence that the migration has happened; verify the current implementation before describing its guarantees. Preserve existing data and history during migration.
