---
name: Scheduled backup scope
description: User-approved standalone and hosted backup scope and cross-instance restore safety.
---

Scheduled backups must support both Windows/Linux standalone installations and the published Replit app, with multiple backup types/schedules and configurable retention.

**Why:** The user explicitly selected both deployment targets, not a Windows-only scheduler.

**How to apply:** Keep folder-based standalone operation independent of Replit credentials. Hosted backups need durable private storage rather than deployment disk, and reliable unattended scheduling requires an always-running server.

Restoring a system backup is not authorization to run restored backup schedules against another instance's destination.

**Why:** A portable backup can contain another server's folder or bucket and retention policy; enabling it automatically could write to or delete that server's backups.

**How to apply:** Require review of destination and explicit re-enablement after a system restore. Never sweep unrelated files in a chosen folder or prefix.
