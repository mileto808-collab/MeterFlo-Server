---
name: Audit backup boundary
description: Why business restores must preserve local audit history and remain portable before audit initialization.
---

Treat a business backup as a data snapshot, not permission to roll back the instance's audit history. Preserve the restore's initiating identity independently of the restored rows.

**Why:** MeterFlo must run on independent Windows/Linux servers. Older snapshots can erase evidence of later actions; external PostgreSQL tools do not inherit authenticated application context. Business backups must also restore on a fresh server before local audit storage exists.

**How to apply:** Review every new backup/restore mode for local-history preservation, portable database dependencies, and truthful initiation/outcome recording. Never infer the restoring operator from actor fields inside the uploaded snapshot or claim that external pgAdmin operations were audited.

Clean configuration backups are intended for new, clean installations, not implicit factory resets.

**Why:** The user clarified, “generally, a clean db backup and restore are for new clean installations.”

**How to apply:** Keep source data/files/history untouched during backup creation. Exclude project data, logs and stale project cleanup journals from the clean archive. Do not interpret a clean-backup request as permission to erase an occupied destination; ordinary business restores still preserve local audit history.

Do not equate an unsuccessful SQL restore with a fully rolled-back database. Keep file restoration gated on database success, and distinguish a successful database restore followed by file failures from a database failure.

**Why:** PostgreSQL archive restores and their optional cleanup are not one cross-resource transaction. SQL failures can leave partial database changes, while later file failures cannot undo a successful database restore.

**How to apply:** Do not claim `databaseCommitted: false` for a generic SQL failure unless rollback is proven. Report committed database success explicitly when later file work fails, including unexpected file-helper or path-resolution exceptions.

Keep the initiating system-restore request and progress screen mounted outside
authentication and access gates. A restored session becoming invalid is not a
restore failure or evidence of completion.

**Why:** Restoring login sessions can make background access checks fail while
the server continues restoring. The generic access screen hid progress and its
Retry button could not repair a 401.

**How to apply:** Pause the initiating browser's authentication/access checks,
retain a dedicated restore screen until the server reports its outcome, and
require fresh sign-in afterward. Treat lost responses or page reloads as
unconfirmed outcomes, never automatic success or permission to replay a restore.
Do not weaken backend authorization or turn browser markers into access grants.
