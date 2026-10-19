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

**Why:** The user explicitly requested this deployment scope and clarified that deployment-specific transfer mechanisms must not replace current workflows.

**How to apply:** Do not assume an external SFTP service is an accepted requirement. Check current Replit published-port documentation before promising a public embedded SSH/SFTP listener; distinguish outbound SFTP support from accepting inbound customer SFTP connections.

## Additive transfer methods, not replacement workflows

Current methods must NOT change. SFTP/SSH import/export is an additional option. Existing web-based manual file handling and processing after files reach the project directory remain available.

Customers with MeterFlo access can manually put files into project files through the web. Customers without MeterFlo access can use SFTP/SSH. When a contract requires SFTP/SSH automation and the customer has no server, MeterFlo should provide the receiving/sending option.

The user wants Replit-hosted instances to use Replit methods and standalone Windows/Linux instances to use a MeterFlo SFTP/SSH server.

For Replit, the user clarified that a secure equivalent is acceptable; it does not have to be actual SFTP.

**Why:** The user explicitly corrected the suggestion to replace existing methods with a universal HTTPS approach. File delivery and collection are additional options around the existing import/export processing, not a redesign of it.

**How to apply:** Preserve current manual and scheduled workflows. Do not equate HTTPS with contractual SFTP support, or give customers development-workspace SSH access. Explain any platform limitation separately without silently changing the requested workflow or treating an external gateway as already approved.
