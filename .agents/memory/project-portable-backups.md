---
name: Complete single-project backups
description: User requirements for project-only portability to MeterFlo and PostgreSQL through pgAdmin.
---

A project-only backup must preserve only the selected project's complete data and files, including inventory if it is enabled or was previously enabled, and that project's audit history.

**Why:** The user described customer IT restoring a project to PostgreSQL through pgAdmin for queries, or moving just that project to a dedicated MeterFlo server.

**How to apply:** Treat native PostgreSQL restoration and MeterFlo instance migration as separate required use cases. Include necessary shared reference definitions without including other projects' business data. Imported historical audit evidence must retain its source provenance and must not erase the destination instance's audit trail. Do not assume the existing JSON export or separate files download already meets this scope.

## Portable-package boundaries

Use the same immutable relational snapshot for the analytical PostgreSQL archive and the MeterFlo data payload. Native analysis uses isolated package namespaces; MeterFlo restores vetted typed rows into an empty project, never uploaded executable SQL.

**Why:** Stock can change during export, managed database roles may not have permission to create another database, and restoring source-wide identities or executable SQL would risk destination accounts and unrelated projects.

**How to apply:** Preserve project-local work-order and inventory lineage identities. Map server-wide generated/network identities and create inactive user/group identities instead of guessing that matching names identify the same people. Preserve local administrator/site configuration and local audit history. Revoke imported transfer credentials, disable polling/schedules, and stop unfinished import/export jobs until destination review.

Keep project-package provenance inside the project's private schema, not an unowned global journal.

**Why:** Project deletion must also remove portability metadata; an unrelated global restore journal would violate the user's no-stale-project-data requirement.

When reading PostgreSQL catalog column-name arrays, cast attribute names to text before forming arrays.

**Why:** The Node PostgreSQL driver can return the catalog's `name[]` as a string rather than a JavaScript array. Assuming normal text-array decoding breaks foreign-key dependency discovery.
