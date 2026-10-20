# Project File Import/Export

Open a project's **File Import/Export** page. Imports, Exports, SFTP Connections and History share one workspace; the original manual import and column-mapping tools remain available.

## Access

Administrators have access. Other users need project membership and the appropriate role permissions, configurable through normal Access Levels management:

- **File Import**: configure/run file imports and see import history.
- **File Exports**: configure/run exports, download generated files and see export history.
- **Customer SFTP Connections**: save, test and remove the project's SFTP connection.

These permissions do not grant access to other projects. Existing customer-account restrictions remain in force.

## SFTP

### Who connects to whom?

**SFTP Connections** configures MeterFlo's existing outbound SFTP client. The separate **SFTP Server** tab provides an optional embedded SFTP-only listener on standalone Windows/Linux, disabled by default. Replit uses HTTPS Exchange for inbound customer transfers. Project FTP Files remains a storage folder, not by itself a listening endpoint. See [Built-in SFTP server](embedded-sftp-server.md).

For customer-hosted SFTP, the customer’s server administrator creates a restricted account for MeterFlo, preferably isolated per project. This is not a MeterFlo web-login account. To let customers connect to a standalone MeterFlo instance, a site administrator enables the built-in listener in SFTP Server; authorized project administrators create project-isolated transfer accounts there. An independent managed SFTP server remains an alternative.

Give customers the actual SFTP hostname, configured SSH port (usually 22), their project-specific username, approved authentication method, independently verified SHA256 server host-key fingerprint, actual upload/download directories, and agreed filename patterns. The MeterFlo website URL is not automatically an SFTP address. Share public keys with the server administrator, never private keys or Replit workspace SSH credentials. Directory names such as `/incoming` and `/outgoing` are examples, not automatically provisioned paths.

Save the customer's host, port, username, authentication method and independently verified `SHA256:...` SSH host-key fingerprint. Use password authentication or a private key and optional passphrase. Secrets are encrypted with the instance's session secret and never returned by the API. Blank credential fields retain saved credentials; changing server identity requires entering credentials again. **Test saved connection** verifies authentication and the pinned host key without uploading a probe file.

Use absolute remote directories, such as `/incoming/work-orders` or `/outgoing/completed`. The service does not create or remove customer directories. Remote import source files are not deleted or renamed. Coordinate remote retention with the customer.

Imports use a **filename glob**, such as `customer_orders_*.csv`; SFTP imports require one. CSV quoted fields/multiline values are supported. Only matching CSV, Excel and JSON files are considered. Successful file contents are deduplicated; generated export filenames are excluded from local import discovery. SFTP runs process up to 25 pending matching files, oldest first; later runs continue the remainder. Local scheduled imports retain newest-file-first behavior. Individual import files are limited to 25 MB.

Supply the customer's work-order ID whenever available. When it is absent, SFTP imports assign a stable generated `SFTP-...` ID per file row so partial-file retries cannot create duplicates or reuse another file's automatically numbered order. Existing local import numbering is unchanged.

## Exports

Create a named configuration, choose columns and CSV, Excel or JSON, and select:

1. **Full matching export** or **New/changed since successful delivery**.
2. **All statuses**, or any configured status/sub-status combination. Parent statuses include their full status; individually selected sub-statuses also match. Closed-only, Trouble-only and mixed feeds are supported without special hardcoded statuses.
3. The local **Project FTP Files** directory, or SFTP delivery to an absolute customer directory. SFTP exports also retain a local generated file.
4. Manual operation or a frequency/custom five-field cron expression.

**Run now** can override export mode and statuses for that run without changing the saved defaults.

Filename templates support `{YYYY}`, `{MM}`, `{DD}`, `{HH}`, `{mm}`, `{ss}` and `{runId}`. Dates/times use the project's timezone, falling back to the configured system timezone. The selected format's extension is added. A unique run ID is appended if omitted so separate deliveries cannot overwrite each other.

Delivery checkpoints are stored relationally per configuration and work order. They advance only after local generation and any required SFTP upload succeed. Content fingerprints also detect edits that do not advance an order's timestamp. Export capture uses a consistent database snapshot. Exports are limited to 100,000 matching orders and 50 MB; narrow status selection for larger workloads.

CSV spreadsheet-formula strings receive a protective apostrophe. JSON retains raw values; Excel stores text values as text, including leading-zero serials/readings.

## Failures, retries and history

History provides filtered, paged import/export results, project-timezone dates and CSV export of all matching history (up to 25,000 entries). Export attempt details preserve earlier failures after a retry succeeds.

An unresolved export must be retried or cancelled before creating another run for that configuration. Retry uses the same captured rows, filename and delivery identity rather than collecting a different payload. Uploads use a run-owned temporary file followed by rename; a matching existing final file is recognized after a lost acknowledgement, and a different existing file is not overwritten. Column, format and destination changes require resolving pending runs first and reset the configuration's delivery baseline.

Schedules require a continuously running server; sleeping or stopped processes cannot execute jobs. Export due times and queued work persist in PostgreSQL. Import schedules are refreshed after edits and periodically to pick up project timezone changes.

## Restore and standalone updates

Native database backups include transfer configuration and history. Full system restore pauses exports and SFTP imports and cancels unresolved export runs. Review destinations and re-enable the intended schedules. Credentials restored onto an instance with a different session secret must be entered again. Do not copy a session secret merely to reactivate credentials.

Managed development uses `npx tsx script/migrate-file-transfers.ts --development`; managed production schema changes go through Publish, never startup DDL. Standalone startup applies the additive transfer schema through the existing update/start workflow.
