---
name: Mobile replay boundary
description: Compatibility and acknowledgement decisions for native completion recovery.
---

Native retry protection is opt-in for immutable captured attempts. Older clients
without a submission identity must bypass the new protocol's parsing, media and
boolean validation, not merely omit its response metadata.

**Why:** The user says the mobile application already works without inventory.
Server and native releases cannot be assumed to arrive together.

**How to apply:** Preserve the existing client path when adding transports or
validation. New attempts bind identity, owner, project, work order, assignment,
action and captured payload before report/media effects. Recover accepted
requests before mutable fresh-submission policy checks; never silently rebase an
old capture onto a later assignment.

Receipt acceptance confirms field work and its submission media, not completion
of asynchronous inventory accounting or unrelated queued uploads/time tracking.

**Why:** The user prioritizes completed field work over backend stock accounting.
Conflating these acknowledgements can cause duplicate stock moves or premature
deletion of offline captures.

**How to apply:** Keep the native attempt until its matching durable acceptance
and media acknowledgements are confirmed. Treat reconciliation failures as
accounting review, not a reason to repeat accepted field work.

Guard connections must leave capacity for the ordinary database operations
executed by the guarded handler.

**Why:** Advisory-lock waiters can otherwise fill the shared pool and prevent the
active handler from obtaining the connection needed to finish and release its lock.

**How to apply:** Bound connection-holding guards or use independently budgeted
lock resources. Include concurrency beyond the pool size in acceptance tests.
