---
name: Operational log cleanup
description: Manual-only failed import cleanup, recovery protection, and consent when expanding automatic retention.
---

Completed failed/partial import histories may be removed only through previewed, confirmed manual cleanup, not automatic retention.

**Why:** The user explicitly chose confirmed manual cleanup rather than age-based deletion of failed/partial imports.

**How to apply:** Preserve active, queued, interrupted and retryable work, plus latest completed scheduled-import diagnostics. A failure status does not make a run disposable: configured API imports can retain checkpoints/settings needed for manual retries even after newer runs complete. Keep those recovery records.

New operational-log categories must not silently expand an existing automatic-retention policy.

**Why:** Adding another log source is not consent to start deleting its history in the background.

**How to apply:** Preserve older policies' category scope; require explicit selection and saving before new categories enter automatic cleanup. Keep audit, backup, business records, transfer files and replay/retry state outside generic operational-log deletion.
