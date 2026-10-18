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
