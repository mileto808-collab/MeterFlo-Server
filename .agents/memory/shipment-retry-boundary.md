---
name: Shipment retry boundary
description: Distinguish an unconfirmed posting retry from a later identical physical receipt.
---

An unknown-outcome stock posting must retain its operation identity and original capture basis for an unchanged retry. After confirmation, a later physical batch is a new operation even if every quantity matches.

**Why:** A server can commit while the response is lost. Refreshing availability can then make the client reject its own valid retry; retaining a confirmed identity indefinitely can instead suppress a legitimate later partial receipt.

**How to apply:** Confirm by a matching operation or receipt identity, not just a refreshed snapshot. Reuse the identity only for an unconfirmed unchanged attempt. Keep authoritative stock validation server-side without allowing a client refresh to block confirmation of that same attempt.

For restart recovery, persist the prepared identity and exact payload before requesting a stock movement. Returning to editing must atomically cancel an unposted attempt under the same aggregate lock used by posting; receipt confirmation, not closing an editor, clears a committed checkpoint.

**Why:** A request may arrive after an operator unlocks or adopts a saved draft. A client-only reset can allow both the old request and a corrected new attempt to move stock.

**How to apply:** Reject late requests against the canceled owner/revision/prepared identity, and prohibit unlocking an already-posted attempt. A portable restore keeps source ownership; administrator adoption is explicit, cancels unposted attempts and retains posted receipt evidence rather than impersonating the source account.

Permanent editing history should summarize checkpoints, not repeatedly copy full scan lists or prepared payloads. The current checkpoint preserves exact capture; physical movement receipts retain posted inventory evidence.

**Why:** Repeated saves of long scan sessions can otherwise multiply storage and request costs even though stock has not moved.

**How to apply:** Keep revision/owner/quantity/scan-count evidence in editing journals, compare replay bodies against the live checkpoint, and retain complete identity evidence for actual stock movements.

Use the same recursive structural canonicalization for checkpoint confirmation and editor dirty baselines; preserve array order and exact text.

**Why:** Server schema parsing can reorder properties inside captured rows without changing their values. Comparing raw JSON strings, or sorting only outer keys, can misclassify a successfully saved checkpoint as a conflicting save after its response is lost.

**How to apply:** Compare nested values rather than object insertion order on save recovery, resume, and baseline reset. A genuine conflicting capture must remain visible locally until the operator explicitly replaces or discards it.

For order-draft retries, distinguish the business order identity from the
command identity: an unknown outcome retains both for an unchanged retry;
editing that same draft retains its order identity but requires a new command.
After confirmed completion, a deliberately new order needs both new identities.

**Why:** Retaining only the command ID cannot prevent duplicates if each retry
also generates a different unnamed order ID. Reusing a command for edited data
instead violates server replay checks or confirms an obsolete edit.

**How to apply:** Keep this protection scoped to the current editor and project,
and distinguish it from durable shipment checkpoints. Do not promise
browser-restart recovery for unsaved purchase/transfer order drafts.
