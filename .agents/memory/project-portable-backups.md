---
name: Complete single-project backups
description: User requirements for project-only portability to MeterFlo and PostgreSQL through pgAdmin.
---

A project-only backup must preserve only the selected project's complete data and files, including inventory if it is enabled or was previously enabled, and that project's audit history.

**Why:** The user described customer IT restoring a project to PostgreSQL through pgAdmin for queries, or moving just that project to a dedicated MeterFlo server.

**How to apply:** Treat native PostgreSQL restoration and MeterFlo instance migration as separate required use cases. Include necessary shared reference definitions without including other projects' business data. Imported historical audit evidence must retain its source provenance and must not erase the destination instance's audit trail. Do not assume the existing JSON export or separate files download already meets this scope.
