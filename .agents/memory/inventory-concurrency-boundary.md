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

Record physical field usage separately from any unavailable-stock debit. Carry the undebited quantity as an auditable discrepancy, rather than making physical stock balances negative or inventing a receipt.

**Why:** Technicians already hold the equipment; missing bookkeeping must not prevent completion. Physical stock and serial custody still need consistent quantities, and a later correction must not charge full usage a second time.

**How to apply:** Resolve only the pending debit or record an explicit evidenced off-book adjustment. An already-installed unrecorded serial must never be received again as available stock; retain its installed custody and investigate the supporting accounting evidence. Keep project locks and hard serial-conflict checks.

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

Cross-table inventory clear/restore operations require one explicitly owned
transaction, including disposable test-fixture cleanup.

**Why:** Deferred foreign keys are checked at the end of each autocommitted
statement. A sequence of pool queries is not a transaction and can fail while
clearing valid handoff/header/equipment references, even when production deletion
correctly succeeds inside its transaction.

**How to apply:** Acquire one client and use BEGIN/COMMIT (with rollback) around
the complete relational operation. Reordering metadata is not a substitute for
the transaction boundary.
