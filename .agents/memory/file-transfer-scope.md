---
name: Project file-transfer scope
description: User-approved import/export organization, customer SFTP pattern matching, and independent export mode/status selection.
---

Use one per-project File Import/Export workspace rather than separate import and export destinations in navigation. Both imports and exports need manual and scheduled operation, customer SFTP support, visible success/failure and logs.

Export mode (full or new/changed) and order selection are independent. Customers may request Closed only, Trouble only, Completed only or combinations including other configured/custom statuses; do not restrict the feature to completion feeds.

Customer SFTP imports require a configurable filename-matching pattern to select the correct incoming files.

**Why:** The user explicitly selected the combined workspace and both export modes, and clarified that customer processing requirements vary by status during both schedule setup and manual operation.

**How to apply:** Preserve those independent controls when extending scheduled transfers; do not replace manual import/mapping workflows or hardcode a short list of exportable statuses.

## Self-contained cross-platform requirement

The user wants file transfers to be self-contained across Replit and standalone Windows/Linux.

**Why:** The user explicitly requested this deployment scope. They have not chosen between a universal HTTPS approach and SFTP with hosting-specific infrastructure.

**How to apply:** Do not assume an external SFTP service is an accepted requirement. Check current Replit published-port documentation before promising a public embedded SSH/SFTP listener; distinguish outbound SFTP support from accepting inbound customer SFTP connections.
