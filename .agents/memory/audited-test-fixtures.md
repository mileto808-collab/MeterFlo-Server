---
name: Audited test fixtures
description: Process-local audit initialization and persistent database triggers can diverge in CLI-created project fixtures.
---

CLI-created project fixtures must initialize audit metadata consistently with the running application before authenticated work-order tests.

**Why:** Audit initialization is process-local, but database triggers persist. A fresh CLI fixture worked after the server's startup scan, while a subsequent fixture failed with “Audit project scope missing” when work-order migration installed triggers without the corresponding scope metadata.

**How to apply:** Use the application's audited schema-creation path when preparing isolated projects, not only its database connection and inventory tables. Do not disable application auditing to make fixture requests pass.

Synthetic business-service projects need their normal public project-catalog identity as well as a project schema.

**Why:** Older schema-only fixtures can fail after services begin resolving project ownership for changeout/authorization handling, before reaching the regression assertions they were meant to exercise.

**How to apply:** Repair disposable fixtures to match real project registration and clean up their owned records. Do not weaken production ownership checks to accommodate an unregistered test schema.

Fixtures that exercise completion must also provide an assigned, authorized actor and authenticated audit context.

**Why:** A reading-persistence regression can cross the real completion boundary before its reset assertions. A registered schema alone is insufficient, and a legacy role label need not grant administrator authority.

**How to apply:** Match normal assignment and role/subrole handling for the owned fixture. Keep authorization checks enabled rather than bypassing completion to reach later assertions.

Keep catalog fixture identities independent of customer-restored identity sequences.

**Why:** Shared type-catalog sequences can lag existing rows after restores; otherwise unrelated fixture creation can fail with duplicate primary keys.

**How to apply:** Use isolated disposable IDs or existing types assigned to the fixture project. Do not reset shared catalog sequences just to make a test pass.

Isolate importer integration tests from the application's background import workers.

**Why:** A running development worker can claim a test's queued run, making cancellation and ownership assertions fail nondeterministically. The same importer suite passed when run without competing application workers.

**How to apply:** Briefly stop the development workflow for isolated importer suites and restart it afterward. Keep browser tests on the running application and never use production data for these tests.

Serialize database suites that reinitialize global audit metadata against the same database.

**Why:** Concurrent audit initialization and permission-fixture writes can deadlock on the shared audit relations even when each business fixture uses a different project.

**How to apply:** Use separate owned databases or run those suites with test concurrency set to one. Keep independent pure/browser checks parallel where they do not rebuild global audit metadata.

Persist an inventory fixture's initial relational state before applying an
incremental change; a legacy JSON root alone is not a persisted baseline.

**Why:** Incremental persistence can skip unchanged default catalogs, leaving
dependent locations with missing foreign-key targets even when the in-memory
state contains the defaults.

**How to apply:** Load/backfill the fixture through the normal inventory read
path, or explicitly persist its relational baseline before incremental saves.
