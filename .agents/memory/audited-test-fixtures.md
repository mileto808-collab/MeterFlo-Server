---
name: Audited test fixtures
description: Process-local audit initialization and persistent database triggers can diverge in CLI-created project fixtures.
---

CLI-created project fixtures must initialize audit metadata consistently with the running application before authenticated work-order tests.

**Why:** Audit initialization is process-local, but database triggers persist. A fresh CLI fixture worked after the server's startup scan, while a subsequent fixture failed with “Audit project scope missing” when work-order migration installed triggers without the corresponding scope metadata.

**How to apply:** Use the application's audited schema-creation path when preparing isolated projects, not only its database connection and inventory tables. Do not disable application auditing to make fixture requests pass.
