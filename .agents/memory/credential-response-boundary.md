---
name: Credential response and logging boundary
description: Why generic request logs must stay metadata-only instead of filtering selected sensitive fields.
---

Keep generic request diagnostics metadata-only, with route templates rather than parameter values. Do not reintroduce request or response bodies through a credential-name denylist.

**Why:** credentials may occur in nested collections, future fields, or unlabelled free-text/error strings. A name-based filter cannot reliably identify those values, and retaining raw payloads for later logging unnecessarily keeps them in memory.

**How to apply:** when adding request diagnostics, use method, registered route, status, and elapsed time. Add narrowly scoped, explicitly safe diagnostic fields only when needed. Authentication/user-management failures should not dump raw database or session errors that may contain credential parameters.
