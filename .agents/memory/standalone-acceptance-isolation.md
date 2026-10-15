---
name: Standalone acceptance isolation
description: Safety boundary and cross-platform PostgreSQL behavior for customer-instance acceptance.
---

Standalone acceptance must own a newly initialized PostgreSQL cluster and application process. Never add an arbitrary production/base-URL override to make customer tests easier.

**Why:** The acceptance workload writes fixtures, runs migrations and removes test evidence. The application/test modules initialize their database access during import, so changing the target after import is too late to establish isolation.

**How to apply:** Supply the disposable database and session configuration before starting child Node processes, exclude inherited production configuration, and validate matching ownership before fixture writes. Keep Windows measurements separate from Linux harness verification.

On Linux, temporary PostgreSQL clusters must use their own Unix-socket directory rather than assuming the packaged default exists.

**Why:** The Nix PostgreSQL binary defaulted to `/run/postgresql`, which was absent; it opened TCP and then failed startup when creating the socket lock.

**How to apply:** Keep Linux sockets inside the owned temporary directory. Do not change the target to a managed database as a workaround. Verify stopped processes and deleted files independently of acceptance success.
