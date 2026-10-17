---
name: Inventory concurrency boundary
description: Why relational persistence does not by itself permit weaker command locking.
---

Keep the project-wide transaction lock while commands validate a complete project
graph and share revision, numbering and replay state. Relational persistence and
changed-row writes do not by themselves permit warehouse-only locks.

**Why:** Different warehouses can still affect common command invariants. The
earlier warehouse-only locking approach allowed concurrent snapshots to overwrite
one another, losing otherwise valid stock movements and retry identities.

**How to apply:** Future scale work must either retain the project lock or
first design command-specific read/write sets, versioning and merge rules. Exercise sustained
cross-warehouse transfers and exact revision/ledger invariants when changing
this boundary; successful individual posts alone cannot prove correctness.

Paging a physical-count editor must not turn posting into independent per-page
stock commits.

**Why:** Posting one page can invalidate the original warehouse snapshot for
the remaining pages, leaving a partially applied physical count. UI pagination
alone does not provide safe inventory batching.

**How to apply:** Keep a bounded, complete atomic submission, or design durable
staging with one final atomic validation/commit before increasing capacity.
Retain every mandatory snapshot row for full-warehouse counts and every selected
or deliberately entered discovery for selective counts. A selective count need
not validate unrelated warehouse balances, but its selected stock baseline and
fresh reservation/serial-custody checks remain authoritative.

Count staleness is about physical stock evidence, not JSON representation.
Ignore property, row and serial ordering, but retain quantity, location, item,
serial identity and movement-revision comparisons.

**Why:** Relational balances and historical snapshot lines hydrate fields in
different orders. Raw JSON-string comparisons falsely rejected untouched counts.
A changed revision still matters when movements leave the same final quantity.

**How to apply:** Keep the editor warning and authoritative posting check on the
same semantic comparison. Show current on-hand expectations separately from the
original count-start amounts; never silently rebase a stale count to make it post.
