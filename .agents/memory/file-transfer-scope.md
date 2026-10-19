---
name: Project file-transfer scope
description: User-approved import/export organization, customer SFTP pattern matching, and independent export mode/status selection.
---

Use one per-project File Import/Export workspace rather than separate import and export destinations in navigation. Both imports and exports need manual and scheduled operation, customer SFTP support, visible success/failure and logs.

Export mode (full or new/changed) and order selection are independent. Customers may request Closed only, Trouble only, Completed only or combinations including other configured/custom statuses; do not restrict the feature to completion feeds.

Customer SFTP imports require a configurable filename-matching pattern to select the correct incoming files.

**Why:** The user explicitly selected the combined workspace and both export modes, and clarified that customer processing requirements vary by status during both schedule setup and manual operation.

**How to apply:** Preserve those independent controls when extending scheduled transfers; do not replace manual import/mapping workflows or hardcode a short list of exportable statuses.
