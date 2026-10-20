---
name: Standalone acceptance isolation
description: Safety boundary and cross-platform PostgreSQL behavior for customer-instance acceptance.
---

Standalone acceptance must own a newly initialized PostgreSQL cluster and application process. Never add an arbitrary production/base-URL override to make customer tests easier.

**Why:** The acceptance workload writes fixtures, runs migrations and removes test evidence. The application/test modules initialize their database access during import, so changing the target after import is too late to establish isolation.

**How to apply:** Supply the disposable database and session configuration before starting child Node processes, exclude inherited production configuration, and validate matching ownership before fixture writes. Keep Windows measurements separate from Linux harness verification.

A separately named database on an installed cluster is not the same safety boundary as an owned temporary cluster.

**Why:** Reusing the installed cluster's administration credentials still grants access to production data even when the fixtures have different names.

**How to apply:** Generate local endpoints and keep inherited configuration minimal; never use installed administration credentials as a shortcut for customer acceptance.

On Linux, temporary PostgreSQL clusters must use their own Unix-socket directory rather than assuming the packaged default exists.

**Why:** The Nix PostgreSQL binary defaulted to `/run/postgresql`, which was absent; it opened TCP and then failed startup when creating the socket lock.

**How to apply:** Keep Linux sockets inside the owned temporary directory. Do not change the target to a managed database as a workaround. Verify stopped processes and deleted files independently of acceptance success.

In-schema restore fixtures must redirect every relational dependency, including explicitly qualified public-table queries, before exercising writes.

**Why:** A newly added relational category table exposed a backup fixture whose unqualified inserts were isolated but whose public-table queries still reached the development schema. A temporary search path alone does not isolate qualified SQL.

**How to apply:** Update the cloned-table set and qualified-query redirection together when extending restore dependencies. Prefer an owned disposable database for acceptance; a missing dependency must fail rather than fall through to unrelated data.

Filesystem acceptance helpers must use the owned application's working directory before resolving relative storage paths.

**Why:** An owned database alone does not isolate file backups: a relative Project Files root otherwise resolves against the real workspace when a helper runs there.

**How to apply:** Establish both database ownership and filesystem working-directory ownership before importing or invoking backup/file-storage code; keep module/configuration paths explicit.
