# Pre-distribution compatibility audit

## Cleanup implemented after the audit

The audit is no longer just a list of proposals. The cleanup removes:

- The obsolete web-update source editor, its save endpoint and unused URL state.
  Current update status has a read-only `/api/settings/web-updates/status`
  endpoint; numbered-release checks, previews and Windows instructions remain.
- The duplicate unscoped mobile trouble/completion implementations. The single
  maintained contract is `/api/mobile/projects/:projectId/work-orders/:id/...`.
  Mobile API documentation and maintained tests use that contract.
- The `/by-meter` lookup alias; system lookup uses `/by-system`.
- Historical pre-outbox log replay: UI action, endpoint, conversion helper and
  its obsolete test. Current durable delivery retries and history remain.
- Deprecated wizard `showGpsStep` configuration and fallback. Current GPS capture
  modes remain explicit.
- Unused fixed service-type enums/types; the relational catalog remains.
- Dead ZIP backup-writing helpers and duplicate unused JSON extraction helper.
- Silent browser filter-preference upgrading. An obsolete visibility preference
  defaults to showing available filter controls without writing an upgrade.
  This does not add work-order filter values or restrict technicians to Scheduled.

Removed APIs return JSON 404 responses rather than the application's HTML.
There are no redirect aliases or alternate implementations for them.

### What is deliberately retained

JSON backup/restore is a requested MeterFlo capability, including the outstanding
work to make JSON snapshots consistent while inventory changes. Its tested
relational restore engine is not dead code merely because the old ZIP writer was.
SQL backups and project JSON backups also remain.

Attachment migration still protects existing development files, and role checks
still support the current role/subrole management UI and administrator recovery.
Inventory locking, historical custody checks, precision handling, Windows/Linux
support and core/custom update boundaries retain current responsibilities.
Removing those responsibilities requires a replacement design, not deletion
of every occurrence of the word “legacy.”

Separately maintained native mobile source is not in this repository. It must
use the documented project-scoped endpoints before testing against this server.
No installed mobile binary, customer files, user data or stored logs are deleted
by this cleanup.

### Verification boundary

Cleanup-specific API/UI checks and reading capture regressions run in the owned
workspace sandbox. The broader reading-precision suite also exposed an existing
independent issue: startup initialization returns when the precision columns
already exist, without verifying that their database range constraints exist.
The database-only startup constraint assertion therefore fails on a schema
created without those checks. This cleanup does not change that initializer;
it is recorded separately rather than silently changing unrelated schema behavior.

## Scope and conclusion

The original audit below covered `server`, `shared`, `client/src`, `script` and `deploy`,
with consumer checks in the client router, tests and mobile API documentation.
It is not a security scan, a measurement of production usage, or proof that a
separately maintained mobile client no longer calls an endpoint.

MeterFlo has not been distributed and has no users yet. Do not assume there are
deployed old clients, customer customizations or third-party integrations that
require indefinite backward compatibility.

The keyword search found 251 matching lines. These are **not 251 obsolete
features**: repeated file-migration variables account for 78 matches, and some
matches describe current safety checks or third-party library options.

There is real simplification opportunity, particularly obsolete update settings,
parallel mobile endpoints, older backup readers, and superseded GPS options.
There is also necessary current functionality incorrectly grouped under the
word “legacy.” Deleting every match would break existing development workflows.

## Findings

| Area | Evidence and dependency | Assessment |
| --- | --- | --- |
| GitHub Releases URL setting | `server/routes.ts` GET/PUT `/api/settings/web-update-config` and `client/src/pages/settings.tsx` still let admins save `webUpdateUrl`. Actual numbered-release verification uses the approved `coreSource` in the instance manifest instead. | **Unnecessary/confusing configuration.** Remove the editable obsolete source setting with its unused save path; keep the Windows command guidance and actual approved-source update checks. |
| Older GPS boolean | `WizardConfig.showGpsStep` and its fallback remain in `system-changeout-wizard.tsx`; the project work-orders page already supplies `gpsMode`. | **Simplification candidate.** Update every wizard caller to the current GPS mode, then remove the superseded option. Do not remove the current GPS capture modes. |
| Fixed service-type enums | `shared/schema.ts` exports both `defaultServiceTypes` and `serviceTypeEnum`; `server/projectDb.ts` also declares an enum. Service types now have a configurable relational catalog. Search found declarations but no imports using these old exported names. | **Likely dead exports.** Remove after type-checking all maintained callers; do not remove catalog seeding or relational service-type records. |
| Parallel mobile write routes | Both `/api/mobile/workorders/:id/...` and `/api/mobile/projects/:projectId/work-orders/:id/...` exist. The old forms are documented in `MOBILE_API.md` and exercised by reading/trouble-code tests. | **Consolidate, not blindly delete.** Select the project-scoped route contract, update maintained mobile documentation/tests and any separately maintained mobile source together, then remove duplicate handlers. Tests calling an old route are evidence of a test dependency, not evidence of distributed users. |
| Meter/system lookup alias | `/by-meter` aliases `/by-system` in one route registration and remains documented for mobile use. | **Small obsolete alias candidate.** Confirm maintained mobile callers and update them before removal. It is not a major source of bloat. |
| Global work-order screens | `client/src/App.tsx` actively routes `/work-orders` and `/work-orders/:id`; global pages call `/api/work-orders`. Access-lock and technician-scope tests also exercise the endpoint. | **Current reachable functionality, not proven dead.** Deciding whether to remove the separate global workspace requires a product decision and coordinated UI/API changes. |
| JSON and SQL backup readers | Both regular and chunked restore handlers in `server/routes.ts` accept old JSON archives; `server/systemBackup.ts` owns substantial JSON restore logic. Project JSON backup remains a separate current workflow. | **Older full-system archive support is removable scope**, after confirming development archives to retain or converting them once. Do not conflate it with removing current project backup or atomic restore/audit protections. |
| File-folder migration on access | `server/fileStorage.ts` discovers and moves old numeric/customer-ID work-order folders and `_project_documents`. Upload/download/delete paths still call these helpers. | **Move toward explicit one-time maintenance.** Inventory existing development files first, migrate them with verification, then remove runtime discovery paths. Do not delete or strand attachments merely because there are no distributed users. |
| Pre-outbox delivery replay | `retryLegacyCustomerLog` replays failed saved payloads into the current durable customer delivery queue, with a dedicated Settings action. Current queue retries are separate. | **Removable recovery adapter if no development payloads need recovery.** Remove the old replay action/helper together; keep current reliable delivery, retry and diagnostic functionality. Do not replay or discard actual payloads as part of an audit. |
| Role/subrole bridge | `server/storage.ts` still counts role-only admins and grants permissions to admins without a subrole. User UI still has the old role field. | **Needs a deliberate role migration.** Establish one authority and ensure administrator recovery before removing either representation. Removing fallback grants alone risks lockout; keeping them indefinitely can hide permission-model drift. |
| Relational inventory cutover | `server/inventoryRelational.ts` explicitly uses the old state row as the transaction lock and migration archive; relational writes are authoritative. Related triggers reject old snapshot writes. | **Not a duplicate active inventory engine.** Archive payload retention can be reviewed after verified cutover, but the current lock must be deliberately replaced before deleting its row/table. |
| Kit, category, location and shipment adapters | `shared/inventory-kits.ts`, `inventory-categories.ts`, `inventory-location-types.ts` and backup validators handle missing older provenance or classifications conservatively. | **Migration/restore-specific complexity.** Can narrow accepted historical inputs pre-release, but preserve current custody, scope, access and quantity invariants. Do not replace rejected ambiguity with invented provenance. |
| Exact reading numeric/text fields | `shared/exact-readings.ts`, `server/exactReadingMigration.ts` and `server/projectDb.ts` preserve exact entered text alongside numeric consumers. | **Mixed precision/display design, not just old-version support.** Review consumers together if simplifying. Removing protection can lose fractional text or precision even in new work orders. |
| Browser preference upgrades | `use-filter-preferences.ts` upgrades previously stored filter metadata. | **Low-cost candidate** for a preference-format reset. Never turn an unknown stored preference into a Scheduled-only technician restriction. |
| Windows/Linux and PostgreSQL portability | PM2 environment recovery, public npm lockfile checks, SQL restore setting filtering and build checks cover current supported platforms. | **Keep.** Cross-platform support is not obsolete-client compatibility. Actual Windows testing remains distinct from Linux simulation. |
| Core/custom update boundaries | `coreUpdatePreview.ts`, `customer-release-activation.ts` and the extension compatibility checks protect the requested future independent-instance update workflow. | **Keep the requested capability.** Remove speculative version adapters when found, not source verification, local-customization protection or safe schema activation checks. |
| Misleading “legacy” names | Routing defaults, responsive CSS selectors and PDF `pagebreak: { mode: ["css", "legacy"] }` appear in the search. The PDF value is a library option; route defaults are still active behavior. | **Do not count these as obsolete subsystems.** Rename confusing first-party wording when touching the feature; keep valid library settings and explicit defaults. |

## Trouble-code implementation decision

The earlier trouble-code plan assumed deployed string-based clients and proposed
permanent wire keys, alias history and parallel display codes. That assumption
does not apply. Use one stable relational identity and editable Code/Name,
migrate existing development assignments, and update maintained first-party
consumers together. Do not introduce permanent alias tables, old-client
fallbacks or a second immutable descriptive code.

Current business facts, notes, audit evidence, attachments and development
configuration still need explicit handling. “No distributed users” is not
authorization to reset data or remove unrelated working features.

## Changes made by this audit

Documentation and implementation direction only. No routes, stored data,
attachments, authentication recovery paths, or backup formats were deleted.
The findings distinguish removal candidates from verified dead code; broad
cleanup should be performed in coherent, tested changes rather than mixed into
the trouble-code migration.
