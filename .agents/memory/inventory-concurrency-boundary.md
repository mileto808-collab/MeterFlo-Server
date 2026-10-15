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

Paging a physical-count editor must not turn posting into independent per-page
stock commits.

**Why:** Posting one page can invalidate the original warehouse snapshot for
the remaining pages, leaving a partially applied physical count. UI pagination
alone does not provide safe inventory batching.

**How to apply:** Keep a bounded, complete atomic submission, or design durable
staging with one final atomic validation/commit before increasing capacity.
Retain every mandatory snapshot row and deliberately entered discovery.
