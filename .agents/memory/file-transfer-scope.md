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

## Keep on-screen import/export help current

Update required-column and optional-column tips, examples, and instructions every time work is done on import/export. Compare the on-screen required/optional columns to the actual database tables.

**Why:** The user repeated that they always have to ask for these tips and instructions to be kept updated, and explicitly said this comparison is very important.

**How to apply:** Treat help verification as part of completing every import/export change. Check actual table columns and current import/export processing, distinguishing file inputs from generated, system-managed, and export-only fields.

## HTTPS deployment scope

The user approved the secure HTTPS equivalent on Replit and the same HTTPS option on standalone Windows/Linux, with responsive pages and controls consistent with the rest of the app.

**Why:** The user explicitly approved this design while retaining the additive-method requirement above.

**How to apply:** Keep HTTPS available on all three targets without claiming it supplies contractual SSH/SFTP support.

## Storage-root changes

Changing the FTP Files root is configuration, not an automatic file migration; leaving it unset preserves the existing Project Files-based layout.

**Why:** A path-setting change must not silently move or overwrite existing customer files, and existing manual workflows must keep working until the administrator deliberately switches roots.

**How to apply:** Explain the folder layout and copy-before-switch procedure. Any future migration tool must be a separate, explicit operation rather than a side effect of saving a path.
