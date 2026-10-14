# MeterFlo audit logs

Auditing starts when this version is deployed. It records application activity,
not a reconstruction of older changes. Existing diagnostic logs and import
histories remain separate.

## Access and examples

Open **Audit Logs** in the sidebar. Administrators have access by default.
In **Settings → Access Levels**, edit an access level and grant:

| Permission | Use |
|---|---|
| `audit.view` — View Audit Logs | A supervisor can read activity for their assigned projects without editing settings or clearing diagnostic logs. |
| `audit.viewAllProjects` — View All Audit Projects | An auditor can read global administration and all projects, including deleted-project history. Also requires `audit.view`. |
| `audit.manageRetention` — Manage Global Audit Retention | A records administrator can configure expiration and preview/confirm deletion. Requires both permissions above because retention is instance-wide. |

Assign the access level to the user using normal user management. Removing
permissions takes effect on the next server request. Ordinary audit readers
cannot modify entries. Direct project assignment and group project membership
scope project readers; global events are available only with all-project access.
Changing a URL, filter or event identifier does not bypass this scope.

## Finding and reading an event

- **Date range:** choose local start/end times in the timezone shown on the page.
  MeterFlo uses the configured default timezone, initially America/Denver.
- **Actor:** select an operator or System. Actor labels are snapshots, so deleted
  users can still be identified.
- **Project:** select any current project you are authorized to audit, even before
  its first event. Current names take precedence after a rename. Deleted projects
  retain their latest recorded label, visible only within your audit access scope.
- **Action/entity:** `created`, `updated`, `deleted` and supported operation
  start/finish, recovery and retention actions are selectable before their first
  event. Older recorded action names remain available within your access scope.
  For example, `updated` + `work_orders` shows committed work-order edits;
  entity choices still reflect visible recorded activity.
- **Record identifier:** enter the internal ID, for example `2011`.
- **Search:** a target label/customer work-order number, record ID or batch/operation ID.
- **Outcome:** narrow results to success, failed, partial, started or unknown.
- **Pagination:** results and counts are computed on the server within your access scope.

Project/action choices describe what you can search, not proof that activity has
occurred. A project or action with no matches shows **No events match these filters**
and a count of zero. No entries are manufactured for existing projects or earlier
edits. **Refresh** reloads both choices and event results without a full-page reload.

Open an event to inspect its actor, source, timestamp, target, operation ID,
outcome, before/after differences and safe metadata. Use the operation ID in
Search to follow an import/bulk batch. Request identity is resolved from the
authenticated session, never a submitted `createdBy`, `updatedBy` or username.

## Coverage

| Domain | Audit coverage |
|---|---|
| Projects | Create/edit/delete; wizard/equipment configuration, reading limits, schedules, Customer API configuration and other business settings. |
| Work orders | Create/edit/delete, assignment, scheduling, status/trouble, wizard captures/completion, reset; normal and force mobile sync; committed records from manual, file, database and Customer API imports. |
| Administration | Users, password-change markers, access levels/permissions, project/group membership, holidays, status/trouble/service/system/module catalogs, system and mobile-release settings. |
| Files | Work-order attachments, project documents and FTP upload/delete lifecycle; size and hashed file identifiers, not paths or content. Attachment/signature references in work orders are recorded as changed markers. |
| Backups/restores | Project database backup/restore, full-system database/clean/files backup, SQL and legacy JSON system restores; initiation, actor, scope/type, operation ID, terminal outcome and applicable counts. |
| Imports | History start/outcome and safe counts, plus actual committed per-record changes. Scheduled runs are service activity; queued Customer API runs retain the initiating user's snapshot when processed later. |
| Audit retention | Policy changes and cleanup count/cutoff are themselves audited. |

Database changes and their business audit entries share the same transaction.
An audit-store failure rolls back the associated database mutation. A no-op save
or change to bookkeeping timestamps does not generate a business-change event.
Raw reading strings such as `00001.2300` remain exact in differences, even though
older clients also receive numeric compatibility values.

Files use staged writes/deletions: audit initiation must succeed first and the
staged change is reverted if recording its outcome fails. Filesystem and database
changes cannot form a distributed transaction. A process crash during staging
therefore requires checking both the operation and files, not assuming success.

Long-running operations have started and terminal events. On a subsequent
startup, unfinished operation records from a previous process are labeled
**unknown**, never success. An import history still marked started/running is not
proof of completion; inspect its operational diagnostics. Customer API workers
also identify interrupted runs and support their existing retry process.
Imports may expose both a parent operation and a history record in the same batch;
these represent the operation and its committed progress, not duplicate changes.

## Privacy and limits

Known business fields have readable differences. Passwords/hashes, secret values,
URL credentials, SQL/mapping/configuration bodies, free-form notes, signatures,
photo/APK contents and arbitrary request/response data are never copied.
Sensitive, unstructured or newly introduced fields use **[changed]**, even when
the old and new redacted markers look the same. Inspect the relevant authorized
settings screen or operational diagnostics for further troubleshooting.

The audit API is append-only. This is not cryptographic tamper evidence: a
database owner can alter database storage. Direct pgAdmin/SQL changes, external
restores, terminal commands and external filesystem edits are **not attributed
or monitored**. Auditing does not change mobile authentication.

## Backup/restore and standalone deployment

Audit tables live in the separate `meterflo_audit` PostgreSQL schema without
cascading links to business records. Normal application backups restore public
and project data, not older copies of local audit history. Local history,
retention policy and the restore's own lifecycle survive application restores.
Supported older MeterFlo clean scripts are adjusted to preserve the audit schema;
SQL explicitly replacing audit storage or unsafe dynamic cleanup is refused.
After SQL restore, business audit triggers are reinstalled before reporting completion.
Legacy JSON system restores use the verified application audit context and commit
public/project/inventory rows together, or roll them all back on database failure.
The initiation and failed terminal event remain in local audit history after rollback.
File restoration is separate; a committed database with file errors is reported as
incomplete. An audit-hook verification failure after commit is explicitly reported
as a committed but incomplete restore, not a database rollback.

Use database-owner backup procedures for independent disaster-recovery archival
of audit history. External restores are outside the application audit guarantee.
The feature uses existing PostgreSQL/local sessions and works on standalone
Windows/Linux installations; it needs no Replit storage or authentication service.

## Retention and inventory

Automatic expiration is **off by default**. Audit Logs shows global record count,
database allocation and oldest/newest dates only to authorized retention managers.
Log Maintenance links to this separate facility; operational-log cleanup does
not delete audit entries.

For example, retain one year by selecting **365 days** and explicitly enabling
automatic expiration. The hourly process removes at most 1,000 eligible entries
per pass and records the cleanup. Started entries are protected until a terminal
outcome for their operation exists.

For manual expiration, choose a cutoff in the past, **Preview eligible records**,
then review the global scope and confirm permanent removal. A preview expires
after ten minutes, belongs to its initiating user, covers at most 1,000 entries
and is invalidated by policy changes. New events created after preview are not
silently included. Repeat preview for remaining records if capped.

Deletion is irreversible. Counts represent entries; database allocation may not
shrink immediately because PostgreSQL reuses space. Normal PostgreSQL vacuum and
database capacity management remain the operator's responsibility.
