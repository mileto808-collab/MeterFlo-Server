---
name: Inventory concurrency boundary
description: Why reducing redundant inventory writes must not weaken aggregate locking.
---

Keep the project-wide transaction lock while inventory is persisted as a single
aggregate. Reducing unchanged mirror writes is not permission to introduce
warehouse-only locks.

**Why:** Different warehouses still update the same aggregate. Independently
locking their mirrors would allow concurrent snapshots to overwrite one
another, losing otherwise valid stock movements and retry identities.

**How to apply:** Future scale work must either retain the aggregate lock or
first change the authoritative storage/merge model. Exercise sustained
cross-warehouse transfers and exact revision/ledger invariants when changing
this boundary; successful individual posts alone cannot prove correctness.
