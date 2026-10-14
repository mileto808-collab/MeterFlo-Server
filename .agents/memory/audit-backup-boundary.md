---
name: Audit backup boundary
description: Why business restores must preserve local audit history and remain portable before audit initialization.
---

Treat a business backup as a data snapshot, not permission to roll back the instance's audit history. Preserve the restore's initiating identity independently of the restored rows.

**Why:** MeterFlo must run on independent Windows/Linux servers. Older snapshots can erase evidence of later actions; external PostgreSQL tools do not inherit authenticated application context. Business backups must also restore on a fresh server before local audit storage exists.

**How to apply:** Review every new backup/restore mode for local-history preservation, portable database dependencies, and truthful initiation/outcome recording. Never infer the restoring operator from actor fields inside the uploaded snapshot or claim that external pgAdmin operations were audited.
