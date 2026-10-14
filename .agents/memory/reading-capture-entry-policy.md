---
name: Reading capture entry policy
description: Prevent excess fractional digits at entry instead of accepting them and blocking wizard progress.
---

Reading capture inputs must reject typing or paste beyond the project's applicable precision limit. Keep the previous value unchanged; do not silently round/truncate it or display a precision error for that rejected attempt.

**Why:** The user explicitly requested preventing excess decimal places during entry instead of allowing them and blocking Next with an error, and approved rejecting over-limit paste without changing the previous value.

**How to apply:** Apply this policy to old/new system and module capture in web and mobile wizards. Preserve separate project limits and intentional zero. Keep required/incomplete-reading checks and authoritative server validation for stale settings/offline submissions.
