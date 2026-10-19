# Scheduled backups

Open **Settings → System → Backup & Restore**. System-backup permission governs
destinations, schedules, history, saved-file downloads, and history exports.
Existing delegated project backup/restore and system restore permissions remain
separate.

## Destination

- **Windows/Linux:** select Server folder and save an absolute server-side path.
  The account running MeterFlo needs read/write/delete access. Restrict the
  folder's Windows ACLs or Linux permissions to that service account and trusted
  administrators. This is not a browser download folder.
- **Replit:** create or attach a **private App Storage bucket**, enter its bucket
  ID and an object prefix, then save. A write/read/delete probe must succeed.
  Cloud credentials are managed by Replit; do not enter keys in the application.
  Local deployment disk is deliberately not offered as durable backup storage.
- Only the `meterflo-scheduled-backups` child namespace is managed. Existing,
  unrelated files are never swept. Historical records retain their original
  destination even after the current destination changes.
- Source-file and document backups exclude this managed namespace, preventing
  recursive inclusion of previous backups. Source-file backups also exclude
  the existing protected/credential/build directories.

## Schedules and content

Create multiple schedules with hourly/daily/weekly presets or a five-field cron
expression, an IANA timezone, retention days, and minimum successful copies.
Schedules may be paused, edited or deleted. **Run now** also works on a paused
schedule and saves a tracked backup to the configured destination.

Types reuse the existing restorable ZIP formats:

- Database + all project databases: PostgreSQL dump of main and project schemas.
  This does **not** include attachments; schedule Project documents too.
- Clean configuration database: existing clean/template export.
- Web application source files: existing source-file export.
- Project documents and attachments: existing project-file export.

The Manual, Projects and Project files tabs retain browser downloads and existing
restore workflows. Browser-downloaded manual files are not tracked or deleted by
server retention. Downloaded scheduled ZIPs use those same restore controls.

## Running reliably

The application polls durable database schedules/queues every 15 seconds. The
server must remain running. Use an **always-on Reserved VM** on Replit for
unattended timing; an Autoscale/sleeping deployment cannot guarantee execution
while idle. Windows/Linux must run MeterFlo as a persistent service or PM2 process.
Do not use a browser session as a scheduler.

After downtime, each overdue schedule runs once, not once per missed interval.
Global PostgreSQL advisory locking serializes scheduled backups, existing audited
manual system backups and system restores across cooperating server processes.
Already-running backups are not killed by pausing/deleting a schedule; queued
scheduled runs are cancelled when paused, and all queued runs are cancelled when
deleted. Run-now requests cannot queue duplicate work for the same active schedule.

Runs are marked successful only after archive completion, destination write and
existence verification. Inaccessible/skipped source files fail scheduled backups
rather than silently producing a successful incomplete archive. Interrupted work
is recorded, never silently replayed. Errors and retention warnings appear in
History. CSV, Excel and printable history exports use all matching results, not
the visible page; exports over 25,000 entries require narrower filters.

## Retention and restore safety

Saving a retention policy authorizes automatic deletion of older tracked copies.
The configured minimum newest successful copies are always protected and checked
for existence before any older successful copy is removed. Missing/inaccessible
protected copies stop cleanup and display a warning. Cleanup runs after backup
attempts and at least hourly while the app is running. Deletion failures remain
visible and retry; failed attempts never count as successful protected copies.
Deleting a schedule retains its history and successful files; its last retention
policy still applies to its managed historical backups.

System restores pause restored schedules and cancel/interrupt restored queue
records. Review the destination and explicitly re-enable schedules afterward,
particularly when restoring to a different server. Operational tables are
reconciled as part of that explicit restore, not managed deployment startup DDL.

## Schema and verification

Relational tables live in the normal schema source. Development setup:
`npx tsx script/migrate-backups.ts --development`. The post-merge script includes
this additive migration. Managed production receives it through normal Publish;
standalone servers use their normal additive application startup upgrade.

Unit/provider checks: `node --import tsx --test tests/backup-schedules.test.ts`.
Owned PostgreSQL/API/archive/browser acceptance:
`node tests/support/project-workspace-sandbox.mjs tests/backup-workspace.cjs`
after `npm run build`. The harness owns and removes its database and test files;
never point these acceptance checks at production.
