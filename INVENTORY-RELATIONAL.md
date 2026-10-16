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
retry guarantees. Persistence writes changed rows. Stock browsing now uses separate
read-only relational queries without taking that command lock; it is not safe to
reduce command locking until commands have independent read/write sets and shared
revision/replay merge rules.

## Bounded Stock & Search

Stock & Search no longer subscribes to the legacy aggregate snapshot. It requests
`GET /api/projects/:projectId/inventory/stock/context` for project metadata and
summary counts, and `/stock` for a viewport-adaptive page (1–100 balances).
The page contains serial counts, not serial identities or catalog image/recipe data.
Switching to another tab or opening an editing dialog loads its aggregate
dependencies on demand. Catalog, serial and kit UI modules are also lazy loaded.
Legacy and mobile snapshot consumers and command responses are unchanged.

All query routes use the existing authenticated project/inventory-view permission
checks and no-store responses. Parameters are validated and SQL values are bound.
The stock page accepts `q`, `warehouse`, `category`, `tracking`, `availability`,
`sort`, `offset`, and `limit`. Sort choices match the UI; ties use stable location
and item IDs. The response includes total/filtered counts, filtered quantity and
reserved summaries, effective offset, project revision, and bounded rows.
Counts and page rows use one repeatable-read snapshot. An unmigrated project is
backfilled once through the existing locked migration before query-only reads.

`/stock/serials` accepts `warehouse`, `item`, `q`, `offset`, and `limit` (max 100).
It returns exact, unmodified serial text, total/filtered counts and revision;
the viewer requests 50 at a time. Searches are case-insensitive literal substring
matches, including `%`, `_` and backslashes. `/stock/options?q=…` loads searchable
location/category choices only when Filters opens, up to 200 of each per search.
Search to find choices outside that bound. Indexes scope stock item/location reads,
sorts and serial bin/position lookups by project; no extension is required.

Balance and serial exports offer All, Filtered and Current page. All/filtered
exports fetch only that explicitly selected dataset in bounded chunks on demand,
not a whole project snapshot. A revision/count change between chunks aborts with
a retry message instead of mixing stock revisions. A zero-match filtered scope
stays selected and disables downloads. CSV/Excel/PDF preserve serial text and
existing formula-safety rules; printable windows open during the click gesture.

Verification:

```sh
npm run check
npm run check:inventory-stock-queries
npm run test:inventory-stock-queries
npm run build
INVENTORY_VOLUME_PG_BIN=/absolute/path/to/postgresql/bin npm run test:inventory-stock-queries:acceptance
```

The last command owns a fresh PostgreSQL cluster and application process, seeds
10,000 balances and 119,900 serial identities (including a 20,000-serial bin),
exercises real signed-in query/UI/export/permission paths, and destroys the cluster,
sessions and files on success or failure. It never accepts a database/base-URL
override. Metrics, screenshots and independent cleanup evidence go under
`generated-artifacts/inventory-stock-queries/` (excluded from Git/deployment).
These are Linux browser/server measurements, not physical scanner or Windows
server acceptance.

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
