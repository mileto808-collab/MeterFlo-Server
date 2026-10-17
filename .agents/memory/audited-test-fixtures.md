---
name: Audited test fixtures
description: Process-local audit initialization and persistent database triggers can diverge in CLI-created project fixtures.
---

CLI-created project fixtures must initialize audit metadata consistently with the running application before authenticated work-order tests.

**Why:** Audit initialization is process-local, but database triggers persist. A fresh CLI fixture worked after the server's startup scan, while a subsequent fixture failed with “Audit project scope missing” when work-order migration installed triggers without the corresponding scope metadata.

**How to apply:** Use the application's audited schema-creation path when preparing isolated projects, not only its database connection and inventory tables. Do not disable application auditing to make fixture requests pass.

Keep catalog fixture identities independent of customer-restored identity sequences.

**Why:** Shared type-catalog sequences can lag existing rows after restores; otherwise unrelated fixture creation can fail with duplicate primary keys.

**How to apply:** Use isolated disposable IDs or existing types assigned to the fixture project. Do not reset shared catalog sequences just to make a test pass.

Isolate importer integration tests from the application's background import workers.

**Why:** A running development worker can claim a test's queued run, making cancellation and ownership assertions fail nondeterministically. The same importer suite passed when run without competing application workers.

**How to apply:** Briefly stop the development workflow for isolated importer suites and restart it afterward. Keep browser tests on the running application and never use production data for these tests.
