---
name: Inventory live-update boundaries
description: Scope and safety rules for inventory live updates across sessions and transaction owners.
---

Inventory tabs, detail views, and modals must be live-aware like Work Orders. Preserve unfinished edits, scanner text, and uncertain-outcome retry identities when refreshing server data.

**Why:** The user explicitly requested live awareness throughout Inventory, not just the top-level list. A refreshed snapshot is not permission to replace locally captured work.

**How to apply:** Reconcile read-only selections against current records. Compare an editor's relevant saved record/custody/stock basis, retain local entries on conflict, and make reload or recheck explicit.

Do not inherit Work Orders' suppression of events from the current user. Other tabs and devices using that same account still need inventory updates.

**Why:** One user's other session can change inventory while the first session remains open; suppressing by actor silently leaves it stale.

**How to apply:** Broadcast permission-checked invalidation metadata to every authorized subscribed session. Keep business-command deduplication separate from live-event delivery.

When access is revoked during a query, clear sensitive results without synchronously removing that actively fetching query from its own error handler.

**Why:** Removing the active query prevented its error from settling and left Refresh permanently disabled after a vehicle-access rejection.

**How to apply:** Empty protected payloads, refresh authorized choices, let the request settle, and remove inactive cache entries. Verify recovery after revocation, not only successful reads.

Publish invalidations at the database transaction's actual commit, not just from inventory HTTP handlers.

**Why:** Work-order transitions and restores also change inventory, sometimes inside transactions owned by another subsystem. A handler-only notification misses those changes or announces a write that later rolls back.

**How to apply:** Preserve the shared commit-time notification boundary when adding mutation paths or changing persistence. Reconnects must catch missed writes, including restores whose revision can move backwards.

A locally saved fulfillment draft must not, by itself, make a remotely completed batch appear unfinished.

**Why:** The user completed a batch on one device but another still offered Continue saved workflow based on browser-local inputs.

**How to apply:** Check a fresh server snapshot on entry and reconcile live terminal-state changes. Clear obsolete, capture-free continuation state; retain unposted captures as review-only evidence. A completed batch is not proof that an uncertain operation succeeded: preserve its exact retry identity until a matching receipt confirms it.
