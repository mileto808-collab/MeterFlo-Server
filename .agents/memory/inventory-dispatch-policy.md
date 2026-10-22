---
name: Inventory-dependent dispatch direction
description: User's required distinction between ordinary group work and vehicle-batch dispatch.
---

When inventory is not enabled, group-assigned work orders go to every technician in the group and completed work drops off everyone's active list. Do not change this behavior while implementing inventory dispatch.

**Why:** The user explicitly required this behavior to remain unchanged.

**How to apply:** Keep inventory-specific dispatch restrictions conditional on project inventory use. Do not apply vehicle membership or fulfillment requirements to inventory-disabled projects.

For inventory-enabled fulfillment, the user wants technicians' work lists to reflect eligible work orders picked into staging for their vehicle batch rather than the entire bulk-assigned group pool. Vehicle location membership should support multiple technicians and technicians working out of more than one authorized vehicle.

**Why:** The user described vehicle-based dispatch as the desired operational model, rather than group assignment alone determining field work.

**How to apply:** Treat this as requested direction, not current implementation. Distinguish pickup visibility at staging from actual handoff/custody. Discuss reading-only, direct-warehouse and no-material work before imposing a universal fulfillment gate.
