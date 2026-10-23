---
name: Complete setup when copying a project
description: Project copies retain complete configuration with selectable access, but never operational stock or history.
---

Project copying must carry over complete project and inventory setup, with an administrator-selectable option to retain access assignments.

**Why:** The user found that copied projects required manually restoring service types, inventory type links, project users, user-group access and vehicle-location assignments. They approved complete setup with selectable access copying. This expands the earlier catalog-only copying rule, while retaining the clean-stock boundary.

**How to apply:** Include project settings and related configuration, not only fields on the project form. Give project-owned definitions independent identities and rebuild their relationships. Access copying must reuse existing users/groups without changing roles or group membership. When not selected, clear project and location access. Never carry balances, serials, reservations, operational orders/counts/returns/batches, unfinished captures, work-order plans or source history. Report exclusions explicitly and keep external delivery inactive until reviewed. The new project's own creation/copy audit is appropriate.

Copy project-specific display codes unchanged; do not silently add suffixes to work around global uniqueness.

**Why:** A complete setup copy must retain meaningful user-facing configuration. A leftover global uniqueness rule can conflict with legitimate independent project scopes even after canonical references have been migrated.

**How to apply:** Verify installed references before retiring staged uniqueness constraints. Preserve unknown/custom legacy references for review rather than dropping them, renaming customer-facing codes, or partially copying the setup.

Verify copied setup through portable backup/restore as well as ordinary reads.

**Why:** Relational constraints alone can accept configuration identities which the portable backup contract rejects. A successful SQL copy is not proof that the copied project remains portable.

**How to apply:** Preserve canonical derived keys and rebuild keys that embed remapped references; use fresh independent IDs only for independently identified definitions. Include the copied project in backup/restore regression coverage.
