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

Keep the routine Windows update commands visible and copyable in Settings and
Preview Changes even when staged customer-release verification is unconfigured.
Do not describe a missing approved source/baseline as a Windows updater failure
or weaken the staged-release guards to make the warning disappear.

**Why:** The user asked for the every-update procedure to be documented and said
Preview Changes used to show the commands, while showing an unconfigured
staged-release preview as the reported error.

**How to apply:** Explain the two workflows separately, maintain the in-app
commands alongside the Windows guide, and retain a distinct first-time bootstrap.
