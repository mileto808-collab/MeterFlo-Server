# Trouble codes: editable Code and Name, permanent identity

## Administrator behavior

Core trouble codes are available in every project. Project owners with the
project trouble-code permission can add, rename, retire and reactivate their
project's custom choices under Project settings → Work Orders → Trouble codes.
Core definitions can only be edited in the authorized core Settings manager.

Both **Code** and **Name** are editable. The generated **Rule ID** is read-only
and remains the same when either is edited. Existing work orders immediately
resolve that identity to the current Code/Name. A definition edit does not
reassign work orders, change their status/sub-status, modify their update time,
append trouble-report notes, or rewrite historical notes and audit evidence.

Codes are case-insensitively unique within the choices applicable to a project.
Two unrelated projects may use the same Code. A shared core Code cannot conflict
with any project's Code. Retired Codes remain reserved within their catalog.
Retiring a project choice stops new assignments but preserves existing ones.
Used definitions cannot be physically deleted while a work order references them.

## One relational reference

`public.trouble_codes.rule_key` is the existing permanent UUID, exposed as
`ruleKey` in definition responses. The project work-order column `trouble` now
stores that UUID, with a real foreign key to `rule_key`:

* `ON DELETE RESTRICT` protects referenced definitions.
* `ON UPDATE CASCADE` gives the database correct behavior during deliberately
  reviewed referenced-key maintenance.
* Database identity guards reject ordinary changes to the UUID, numeric
  catalog row ID and scope. There is no application rekey endpoint.
* A narrow database trigger enforces core/project applicability and retirement.
  A second catalog guard handles shared-core versus project Code collisions,
  which a normal per-project unique index cannot express. Unique indexes
  additionally enforce core and project catalog uniqueness.

The numeric catalog row ID remains the manager endpoint's row locator; it is
not a replacement wire key or a second work-order assignment field.

Customer business rules should compare permanent UUID identities, not Code or
Name. Database cascades cannot rewrite UUID literals inside external source
code; ordinary IDs never change. Privileged database maintenance that changes
identities requires separate review of those consumers.

## Current application and API contract

This is a coordinated pre-distribution contract change, not support for deployed
old clients. There are no permanent descriptive-wire-key fields, alias tables,
automatic renamed-Code resolution or old-client fallback writers.

* Definition GET responses include `ruleKey`, editable `code`, `label` (the UI
  Name), project scope and retirement state.
* Project work-order `trouble` is a UUID or null.
* Selectors, filters, reports, exports and PDF rendering resolve that UUID
  against the applicable definition catalog; exports display current Code/Name.
* Changeout and mobile trouble actions submit the selected definition's
  `ruleKey` in `troubleCode`. Do not submit `code` or the numeric catalog `id`.
* Work-order imports that include `trouble` must supply a valid applicable UUID.
  A stale descriptive Code fails; it is not guessed or mapped through history.
* Maintained mobile clients must refresh project-scoped reference metadata and
  submit UUIDs before testing against this build. Old code-string queued work
  should be reviewed/reselected before submission, not silently reassigned.
* Customer delivery payloads expose `troubleCodeId` as the permanent UUID,
  `troubleCode` as the captured descriptive Code and `troubleCodeName` as the
  captured Name. These values are captured in the work-order transaction;
  later definition renames do not alter saved delivery snapshots or retries.

Separately maintained mobile source is not present in this server repository.
Updating its documented contract here does not update an installed binary.

## Development migration and standalone updates

Normal application startup migrates all registered project work-order schemas
before serving requests. Existing text Codes are resolved within the applicable
core/project catalog and converted to their **existing** UUIDs. No definitions
are recreated. Null/empty assignments remain null.

The all-project conversion is transactional. Unknown or ambiguous references
cause an explicit failure rather than losing assignments. Retrying an update
is safe: already UUID-backed columns retain their identities. New project
tables use UUID foreign keys from creation. Individual project maintenance
also wraps the reference migration in a transaction.

Use the existing documented Windows/Linux update workflow; no data reset,
manual UUID replacement, checksum bypass or extra recurring cleanup command
is required for this change. If startup reports an unresolved project/work
order, correct that specific development reference and rerun the normal update.
Do not overwrite the database as a migration shortcut.

Project backups contain UUID work-order references and definition metadata.
Same-project restores preserve UUIDs and restore custom Code/Name; a project
restore does not overwrite shared core definitions. Full-system archives
include the public catalog and its identities. Restoring into an incompatible
scope or missing definition fails rather than attaching a different choice
by matching a Name or Code. Old development archives with descriptive work-order
references require explicit conversion before use; no permanent old-format
adapter is added by this change.

## Verification

```
npm run check
npm run build
node tests/support/project-workspace-sandbox.mjs tests/project-trouble-codes-ui.cjs tests/work-order-sub-statuses-ui.cjs tests/project-deletion-ui.cjs
```

The trouble-code suite also invokes `tests/trouble-code-relational.test.ts`
inside its owned disposable database. It checks text-to-UUID migration,
repeated installation, rejected unresolved references, actual FK actions,
Code/Name renames without row/history changes, scope rejection, concurrent
catalog collisions, delegated controls, retirement, project backup/restore,
desktop and phone behavior. Windows execution and native installed mobile
applications require their own acceptance environment.
