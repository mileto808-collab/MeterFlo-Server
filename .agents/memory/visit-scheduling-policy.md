---
name: Visit scheduling policy
description: User-approved defaults, explicit-window semantics and editing authority.
---

The user chose 30-minute visits and 60-minute appointment tolerance as the initial project defaults. An explicit appointment window constrains when service starts, without additional tolerance; it does not require the visit to finish before the window closes. Users with Edit Work Orders may edit individual visit durations and windows.

**Why:** The user explicitly supplied these defaults and selected service-start windows and existing editing authority. Existing projects and point appointments must retain their behavior when new values are unset.

**How to apply:** Keep new-project defaults separate from legacy fallback behavior. Never reinterpret existing scheduled timestamps as windows or modify appointments as a side effect of planning.

Inherited planning information must be visible in work-order details without populating the override fields. Authorized users may override duration and service-start windows. Route planning details belong below the assignment and trouble-code fields.

**Why:** The user explicitly requested visible inheritance and this placement, while retaining authorized work-order overrides.

**How to apply:** Show the project timezone, inherited duration and tolerance, and distinguish a calculated scheduled-plus-tolerance window from an explicit override. Clearing overrides restores inheritance, not a copied project value.
