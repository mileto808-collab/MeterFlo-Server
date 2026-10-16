# Relational inventory

## Storage

Core inventory uses relational PostgreSQL records: items and categories, vendors,
locations, orders and lines, balances, individual stock serials, reservations,
counts and count lines, receipts and receipt lines, kit recipes and assembly
contents, and inspection holds. Project-scoped foreign keys protect inventory
references. Uniqueness constraints protect order numbers and current serial custody.
SKU, name, tracking, category and other item fields are typed columns, not a JSON
item document.

JSONB remains for immutable historical evidence and temporary shipment editing
state. Temporary captures also have relational item references. Portable JSON
backups and the API snapshot shape remain supported; transport is not storage.

After cutover, `inventory_state.state` is an archive, not a second source of truth.
Its project row remains the transaction lock. A trigger rejects legacy snapshot
updates after the relational version marker exists. Never run old application code
against migrated data. A downgrade requires a suitable pre-upgrade database backup.

Backfill preserves IDs, order numbers and numbering high-water marks, serial text,
list order, revisions, replay identities, kit custody and historical evidence. It
checks a full round-trip before committing. Errors roll back. Already migrated
inventories never silently fall back to archived JSON.

## Upgrade

- **Development:** `npm run migrate:inventory-relational -- --development` installs
  and verifies the schema and migrates existing development inventories.
- **Replit production:** use the managed Publish schema workflow. The maintenance
  command refuses Replit production; application startup never runs schema DDL.
  After schema delivery, first inventory access can backfill an unmigrated project's
  data transactionally. Production was not migrated by the development command.
- **Standalone Windows/Linux:** back up database and project files, stop the old
  service, update checkout/dependencies while preserving instance-specific settings
  and custom work, then run `npm run migrate:inventory-relational -- --standalone`
  before restarting. This mode refuses to run inside Replit. Do not serve old and
  new application versions concurrently.

Project and full-system restores reconstitute relational records atomically.
Inventory snapshots require explicit replacement, not row-by-row merging. Restores
preserve known numbering high-water marks. Full-system restore handles JSONB arrays
and generated identities. Older backup shapes remain supported.

The command engine still validates a complete project inventory in memory under
the project-wide lock. This retains cross-location movement, revision, count and
retry guarantees. Persistence writes changed rows, but this release does not add
fine-grained command locking or server-paged list endpoints.

## Deleting unused records

Users with catalog-maintenance permission can use the trash action beside an item
or category and confirm permanent deletion. Assigned categories cannot be deleted,
including categories used by inactive items. Items are blocked by stock, serial
custody, another kit's recipe, orders (including closed/cancelled orders), counts,
reservations/usage, receipt history, removed equipment, inspection holds, saved
shipment captures or kit assembly history.

Dialogs explain blockers. The server checks current data again, and database
foreign keys provide another protection. Genuinely unused items may have empty
zero-balance rows removed with them. Cancel never deletes. Successful deletion
retains audit evidence; retries of one intent retain their operation identity.

## Verification

Run `npm run check`, `npm run test:inventory-relational`,
`npm run test:inventory-integration`, `npm run test:inventory-categories:database`,
`npm run test:inventory-system-backup`, and `npm run test:inventory-volume`.
The database fixtures use owned projects or isolated schemas. The standalone
acceptance harness installs the relational schema in its disposable database.
Physical Windows upgrade behavior requires separate acceptance verification.
