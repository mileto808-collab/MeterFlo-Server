---
name: Visit scheduling policy
description: User-approved defaults, explicit-window semantics and editing authority.
---

The user chose 30-minute visits and 60-minute appointment tolerance as the initial project defaults. An explicit appointment window constrains when service starts, without additional tolerance; it does not require the visit to finish before the window closes. Users with Edit Work Orders may edit individual visit durations and windows.

**Why:** The user explicitly supplied these defaults and selected service-start windows and existing editing authority. Existing projects and point appointments must retain their behavior when new values are unset.

**How to apply:** Keep new-project defaults separate from legacy fallback behavior. Never reinterpret existing scheduled timestamps as windows or modify appointments as a side effect of planning.
