---
name: Scheduled backup scope
description: User-approved standalone and hosted backup scope and cross-instance restore safety.
---

Scheduled backups must support both Windows/Linux standalone installations and the published Replit app, with multiple backup types/schedules and configurable retention.

**Why:** The user explicitly selected both deployment targets, not a Windows-only scheduler.

**How to apply:** Keep folder-based standalone operation independent of Replit credentials. Hosted backups need durable private storage rather than deployment disk, and reliable unattended scheduling requires an always-running server.

Offer a complete scheduled recovery archive combining database SQL and uploaded project files, usable for MeterFlo recovery and native PostgreSQL restoration through pgAdmin tooling. Keep existing files-only schedules' scope unchanged.

**Why:** The user found only project files and JSON metadata in a Windows scheduled archive and explicitly requested backups restorable in both MeterFlo and pgAdmin, approving a combined database-plus-files option.

**How to apply:** Clearly distinguish file-only copies from database recovery. Include plain-SQL restoration instructions, never call metadata a database backup, and do not silently convert existing schedules.

Restoring a system backup is not authorization to run restored backup schedules against another instance's destination.

**Why:** A portable backup can contain another server's folder or bucket and retention policy; enabling it automatically could write to or delete that server's backups.

**How to apply:** Require review of destination and explicit re-enablement after a system restore. Never sweep unrelated files in a chosen folder or prefix.
