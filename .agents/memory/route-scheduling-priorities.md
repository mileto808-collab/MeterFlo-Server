---
name: Route scheduling priorities
description: User-approved precedence for optimizing Scheduled work-order visits.
---

Route optimization must protect appointment times before favoring higher-priority sub-statuses and reducing travel. Lower numeric sub-status ratings mean higher priority, for example Critical = 0 and Priority = 1.

**Why:** The user explicitly selected “Protect appointment times, then prioritize stops” rather than visiting higher-priority stops regardless of lateness.

**How to apply:** Keep appointment conflicts visible rather than silently treating urgency as permission to miss a scheduled visit. Preserve the separate core Scheduled status and sub-status identity.
