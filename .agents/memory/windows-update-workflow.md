---
name: Windows update workflow
description: The user's stated method for updating the Windows server instance.
---

The user runs a Git script to update their Windows server instance.

**Why:** The user stated, “On my windows server instance, I run a git script to update that server.”

**How to apply:** Account for this update method when discussing or changing deployment tooling; do not assume GitHub Actions deploys the Windows instance.

The user's Windows MeterFlo instance is development; its data can be overwritten.

**Why:** The user stated, “The windows instance is development. I don't need a backup, The data can be overwritten.”

**How to apply:** Apply this permission to that Windows development instance, not customer or Replit production instances. Prefer targeted corrections when a reset is unnecessary.

Windows Git updates must be a repeatable, tracked procedure, not a changing set
of manual commands. Explicitly include build dependencies even under production
mode, require the inventory maintenance boundary, and verify the actual running
build rather than a brief PM2 online status. Local Git/checkpoints are not proof
that Windows can pull the changes from its remote.

**Why:** The user said every Windows update now runs into a problem and asked
that update scripts reach Git and work consistently. Missing build dependencies,
line-ending checksums and missing inventory schema have each interrupted updates.

**How to apply:** Maintain the checked-in updater and its tests with relevant
feature/schema changes. Preserve protected configuration, never invent migration
approvals, and distinguish local/portable tests from real Windows PM2 acceptance
and local tracking from a verified remote push.
