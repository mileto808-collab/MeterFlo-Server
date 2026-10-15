# Inventory volume acceptance

## Reproduce safely

### Standalone Windows acceptance

Use a separate disposable checkout (for example `C:\xampp\htdocs\meterflotest`),
not the installed MeterFlo directory. PostgreSQL must be installed with
`initdb.exe`, `pg_ctl.exe` and `postgres.exe` available. Node/npm and Git must
already be installed. After syncing the completed code, run in PowerShell:

```powershell
cd "C:\xampp\htdocs\meterflotest"
git pull --ff-only origin main
npm.cmd ci
& ".\node_modules\.bin\playwright.cmd" install chromium
.\deploy\Test-InventoryVolume.ps1 `
  -PostgresBin "C:\Program Files\PostgreSQL\18\bin" `
  -ConfirmDisposableCheckout
```

Stop if any command fails; never use `git reset --hard` to discard local work.
The launcher builds this checkout, then starts a **fresh temporary PostgreSQL
cluster and loopback-only compiled application**. It uses normal local login,
not an auth bypass. It neither stops PM2 nor connects to your installed app,
existing PostgreSQL database or Replit preview. Do not copy production `.env`
into the checkout. The runner supplies its own database/session settings and
an empty dotenv file; production environment secrets are not inherited.

The database uses local trust authentication only inside the disposable cluster
bound to `127.0.0.1`, under the synthetic `mf_volume` user on a free port.
The acceptance test validates an owned temporary configuration and a matching
database run marker before it creates test fixtures. There is no configurable
production URL/database target. The browser uses Playwright's installed Chromium
by default; an explicit `CHROMIUM_PATH` can select an installed executable.

On completion, upload `generated-artifacts/inventory-volume/metrics.json` and
`cleanup.json`. Metrics include the run identity, platform and standalone mode.
Cleanup independently reports whether the app, temporary PostgreSQL process and
temporary files were removed; success requires all three plus passing acceptance
from that same run (`acceptancePassed: true`, `cleaned: true`, and matching run
identities in both reports). A failed or interrupted run is not a pass. Forced termination
or machine shutdown can prevent cleanup; never assume those resources vanished.

For standalone Linux verification, build the disposable checkout, then set
`INVENTORY_VOLUME_PG_BIN` to its PostgreSQL tools directory and run
`npm run test:inventory-volume:standalone`. This exercises the same isolation path,
but a Linux pass is **not evidence of Windows performance or compatibility**.
`npm run test:inventory-volume:acceptance` is a portable alias for this same
owned-cluster runner and also requires `INVENTORY_VOLUME_PG_BIN`. Both entry points
now include the engine boundary/persistence checks and separate fresh-destination
full-system restore regression inside the disposable cluster before the volume
workload. The customer Windows results below describe the supplied run, not a
new Windows execution of these supplementary checks.

The standalone Linux path was verified using PostgreSQL 16.10 with real normal
login, signed-in desktop/phone browser checks, mobile completion/retries and
inventory backup/restore. The 10,000-serial receipt/retry phase peaked at 855 ms;
the eight-worker count phase completed in 28,250 ms and the transfer phase in
34,325 ms, with every existing acceptance gate passing. The owned application,
PostgreSQL process and temporary files were all removed. These measurements
describe this Linux run only.

### Verified customer Windows results

On 2026-10-14, the customer supplied the standalone Windows evidence archive.
Its metrics report `passed: true`, Node v24.12.0, and `win32` / `x64` /
`standalone`. The cleanup report has the same run identity and confirms
`acceptancePassed`, `cleaned`, `serverStopped`, `postgresStopped` and
`filesRemoved` are all true. Signed-in desktop, phone and phone activity
captures are included in the evidence.

The fixture covers 40 warehouses, 100 products, 30 balances per warehouse,
10,000 prior history entries and a 10,000-serial shipment.

| Measurement | Customer Windows result |
| --- | --- |
| Serialized receipt/retry max | 0.743 s |
| Count start p95 / max | 1.655 / 1.738 s |
| Eight-worker count phase | 17.112 s |
| Eight-worker transfer phase | 25.716 s |
| Mobile download / usage upload max | 0.085 / 0.502 s |
| Inventory export / restore | 0.064 / 2.459 s |
| Signed-in load / worst search / activity | 3.507 / 0.055 / 0.054 s |
| Web snapshot / posting replay response | 3,402,990 bytes each |
| Inventory backup | 7,429,023 bytes |

All acceptance gates passed for this run. The console reported approximately
58 seconds for the test process; build and database setup are additional.
The report's peak RSS is for the test process only, not total server,
PostgreSQL or browser memory. This verifies the stated synthetic envelope on
that Windows host, not unlimited scale, a live-customer-data migration, or
performance guarantees for every customer installation. It does not verify
the separate Expo inventory interface or full-system backup consistency
during concurrent writes.

### Existing Replit development acceptance

Use a **development database and its running development preview**, never a
published server or a production database. The acceptance command requires
`REPLIT_DEV_DOMAIN` ending in `.replit.dev`; it has no production/base-URL option.
It uses the development application's existing local-login and administrator
permissions, not an authentication bypass. No credentials are printed or saved.

```sh
npm run dev                         # existing Start application workflow
npm run test:inventory-volume       # engine boundaries + persistence write regression
npm run test:inventory-volume:development
```

`DATABASE_URL` must be configured normally for development. Chromium must be
available at `/repl/tools/bin/chromium`, or set `CHROMIUM_PATH` to an installed
browser executable. The acceptance suite uses the installed Playwright package.
Run only one copy of the acceptance command at a time, without unrelated load
tests if you want comparable measurements.

The integration suite creates two uniquely named synthetic projects and schemas,
a temporary local administrator and a normal signed-in session. It seeds only
those projects, then removes their inventory, schemas, project records, user,
session and scoped test audit evidence in `finally`, including on assertion
failure. It never replaces existing business data or clears a shared database.
Forced process termination can prevent cleanup: inspect `Volume fixture ...`
projects and remove only that run's synthetic fixtures if a process was killed.
Do not use this script to load real shipment data.

Outputs are ignored by Git and deployment:

* `generated-artifacts/inventory-volume/metrics.json`: pass flag, fixture size,
  Node version, test-process peak RSS, sample counts and p50/p95/max milliseconds,
  and uncompressed UTF-8 response/archive byte counts.
* `desktop.jpg`, `phone.jpg`, `activity-phone.jpg`: actual signed-in browser captures.

Timing includes transaction lock waits. HTTP timings additionally include the
development preview proxy. They are diagnostic acceptance budgets, not production
service guarantees. Peak RSS covers the Node test process, not the application,
database or browser. Failing runs also write metrics; check `passed`.

## Exercised operating envelope

This is a tested envelope, **not an enforced quota or an unlimited-scale claim**:

| Dimension | Synthetic acceptance workload |
| --- | --- |
| Locations | 40 warehouses in one project |
| Catalog | 100 products, 10 serialized |
| Stock | 1,200 location/product balances; 12,000 starting serials |
| Shipment | One receipt with 10,000 additional distinct serials |
| Prior history | 10,000 movement rows, receipts and idempotency fingerprints |
| Parallel operators | 8 workers, 6 rounds of count start/cancel (96 committed actions) |
| Parallel stock movement | 8 workers, 4 transfer rounds (32 complete transfers, 128 committed actions plus 32 dispatch retries) |
| Work orders | 16 synthetic orders, competing reservations and real mobile completion/retries |
| Physical counts | Real service count with 30 balances; engine count of 10,000 serials |
| Browser | Desktop 1280×720 and phone 390×844, all 1,200 stock rows and >10,000 receipts |

The pure engine suite also proves the 500-order-line boundary accepts 500 distinct
products and rejects 501, and rejects a count containing over 10,000 serials
without changing the original state. Those boundary cases are not a throughput
claim for 500-line, multi-million-serial shipments.

### Current hard limits and caveats

* Commands allow at most 500 stock lines; a serial list allows at most 10,000
  entries per line, each at most 100 characters. Quantity is an integer up to
  1,000,000. Regular items have no serial entries.
* Larger receipts must be split into separately identified partial receipts.
  Reuse the **same operation ID and identical payload** for a network retry;
  do not reuse an ID for corrected data.
* **A counted warehouse must contain at most 500 product balances and at most
  10,000 serials per product.** Multiple receipts can create a larger bin, but
  the current count command cannot post its complete snapshot. The shipment
  test deliberately produces a 10,100-serial bin and verifies rejection rather
  than silent truncation; a separate test proves a 10,000-serial count works.
  Plan stock distribution within these count limits until chunked counts exist.
* Posts serialize at the **project** level, including across different warehouses.
  Eight clients is the exercised concurrency, not a promise of linear scaling.
* Web GET and POST responses currently contain the full visible stock/history
  snapshot, but exclude idempotency fingerprints. The stock and activity UIs
  render 100 entries per page; all balances, older movements and their print
  actions remain reachable. Search covers every balance, not just the current page.
  API pagination is not implemented. Response budgets below apply only to the
  measured envelope; sufficiently long histories will outgrow them.
* Mobile download takes a work-order `limit`. The tests request 1, 5 and 16;
  completed orders are deliberately omitted, so the final request returns 15.
  Inventory includes catalog, accessible warehouses and per-order allocations,
  **not** stock, receipts or idempotency history. This measures the server
  contract, not the separately planned Expo inventory interface.
* Backup acceptance exports inventory under a repeatable-read transaction,
  restores into the second disposable project, compares full state and movement
  counts, checks mirror balances and verifies a restored receipt replays safely.
  It does not claim whole-system JSON backups are consistent during concurrent
  business changes; that is separate work.

## Acceptance gates

| Path | Budget at the fixture above |
| --- | --- |
| Engine posting / 10,000-serial count | <5 s each |
| Serialized service receipt and concurrent retries | <10 s each including waits |
| Count start with 8 queued operators | <6 s each |
| 8-worker count phase / transfer phase | <180 s each; no lost revisions |
| Mobile download / usage upload | <5 s each |
| Signed-in inventory initial load | <10 s |
| SKU / serial / location / no-match searches | <2 s each, with exact row counts |
| Activity tab | <3 s, only 100 entries mounted |
| Inventory restore | <60 s |
| Web snapshot / posting response | <8 MiB uncompressed each |
| Mobile download / upload response | <512 KiB / <16 KiB |
| Inventory archive | <12 MiB |

Every concurrent run checks nonnegative integer quantities, reservations no
greater than stock, serialized quantity/list agreement, unique serials per
product across warehouses, no double reservation or installed/on-hand overlap,
the exact transfer balances, no lost revisions, and one movement per posting ID.
The browser verifies tail-serial search, paging to the oldest historical entry,
disabled first/last navigation, independent horizontal/vertical stock scrolling,
and access to the final serial inside its own bounded scroll area.

## Measurements and changes

Baseline in the Replit development container (Node 20, PostgreSQL, real auditing,
normal local-login session) before optimization:

| Measurement | Baseline |
| --- | --- |
| 96 parallel count actions | 85.5–98.0 s across two runs |
| Count start p95 / max (second run) | 10.49 / 12.94 s |
| 10,000-serial receipt (second run) | 1.32 s maximum including retries |
| Inventory export / restore (second run) | 0.16 / 6.71 s |
| Web snapshot / inventory archive | 3,375,384 / 7,264,562 bytes |
| Mobile download maximum (second run) | 0.73 s, 61,912 bytes |
| Browser load / worst search / activity | 4.73 / 0.49 / 3.57 s |

The activity tab exceeded its 3 s budget. The first stock row also expanded to
the height of its entire 10,100-serial list, leaving its identifying cells out
of the first viewport. The corrected rendering pages activity at 100 entries,
bounds the stock table height and makes each long serial list independently
scrollable. Search still covers every serial, including off-screen entries.

The posting bottleneck was unnecessary SQL writes: each metadata-only action
upserted all 100 items and 1,200 balances. `saveInventory` now indexes prior
entities and reservation totals, and writes only changed item/balance mirrors.
New zero balances, reservation-only changes and equal-quantity serial changes
are explicitly tested. The JSON state, ledger and audit changes still commit
atomically under the same project row lock; no storage migration or new
concurrency model was introduced.

An intermediate run reduced the 96-action count phase to 26.7 s and activity
opening to 0.18 s, but one initial signed-in load still took 12.7 s. Stock rows
were therefore also paged at 100 rather than mounting all 1,200 at once.

Final passing full acceptance run:

| Measurement | After targeted changes |
| --- | --- |
| 96 parallel count actions | 25.42 s (74% less than the second baseline) |
| Count start p95 / max | 2.73 / 4.00 s |
| 32 parallel complete transfers, including dispatch retries | 34.19 s |
| Serialized receipt/retry max | 0.99 s |
| Physical count service max / 10,000-serial engine count | 0.24 / 0.35 s |
| Web snapshot / posting retry response | 0.16 / 0.46 s; 3,402,990 bytes each |
| Mobile download / usage upload max | 0.39 / 1.03 s; 60,729 / 164 bytes |
| Inventory export / restore | 0.12 / 5.88 s; 7,429,023-byte archive |
| Signed-in load / worst search / activity | 4.12 / 0.11 / 0.12 s |

The final fixture includes additional transfers and mobile consumption that
were not in the baseline, so archive and response bytes are slightly larger.
Counts use the same 96-action phase in both comparisons. No backup storage
change was justified by the measured restore time.

Also passing: `npm run test:inventory`, `npm run test:inventory-volume`,
`npm run test:inventory-integration`, `npm run test:inventory-system-backup`,
`npm run check`, and `git diff --check`.

For new infrastructure, rerun the command and use its report rather than
extrapolating these development timings. Only consider normalized/paginated
storage, more rendering changes or different locking after measuring a workload
that exceeds this envelope.
