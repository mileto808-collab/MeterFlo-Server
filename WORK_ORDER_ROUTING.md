# Work-order route planning

## What planning does

The Work Orders header's **Optimize route** action plans Scheduled work orders
from the current filtered grid across all pages, or an explicitly selected scope.
It requires **Optimize work-order routes** and work-order view permission, and
preserves the same project and technician visibility restrictions as the grid.
The existing printable Route Sheet is unchanged.

The planner obtains road travel times and road geometry from the configured
provider. Its bounded beam-search heuristic protects appointment feasibility
first, then favors lower sub-status routing priorities, then reduces driving.
Priority **0** is valid and highest; blank is unrated and ranks last. Display sort
order is not routing priority. This is not a guarantee of a globally optimal
route or of meeting every appointment.

Scheduled time remains an appointment start, not an appointment window. An optional,
separately saved explicit window constrains when service **starts**, not when it
finishes. Early arrivals wait. Departure and scheduling controls use the project's
time zone (or the instance default when inherited). Setup asks for default service
minutes and point-appointment lateness tolerance. Impossible appointments,
missing times, ambiguous addresses and inaccessible road destinations are
reported rather than silently changed. Travel estimates are **not live traffic**:
Google uses traffic-unaware road times; Geoapify uses approximated traffic.

Route planning does not modify statuses, schedules, assignments, inventory or
completion. A next-stop control advances route progress only, not work completion.
Work-order changes, priority changes and configuration changes mark the route
stale. Replanning is explicit and never silently reorders the technician's route.

## Visit durations and explicit appointment windows

**Project settings → Route planning defaults** sets the default visit duration
(1–480 whole minutes) and point-appointment tolerance (0–240 whole minutes).
Edit Projects permission is required. New projects start at **30 minutes / 60
minutes**. Existing projects keep null defaults and the old **45 / 10** planner
fallback until explicitly configured. Blank project defaults restore that legacy
fallback; they do not rewrite work orders.

Users with **Edit Work Orders** can set an optional service duration and a paired
window in **Scheduling & Assignment** on desktop or phone, or during work-order
creation (which also requires Create Work Orders). Clear both endpoints to remove
a window. The end must be at or after the start; zero-width windows are valid.
The project-local time controls reject nonexistent or repeated DST wall-clock
times rather than choosing an offset silently. Integrations may provide repeated
times using explicit ISO offsets to distinguish them.

Duration precedence is: work-order override, explicit route-setup assumption,
project default, legacy fallback. A route-setup value equal to the effective
project default is labeled with that default's provenance. Each stop shows its
effective service minutes/source, waiting time, window or point appointment,
and estimated lateness. Windows have **no extra tolerance**. A separately saved
scheduled timestamp is retained even when the explicit window governs planning.
The optimizer compares explicit-window conflicts first, then point-appointment
conflicts, then sub-status urgency (including priority 0), then real directional
road travel. Impossible windows remain visible rather than being dropped.

Business facts are relational: nullable integer defaults on `public.projects`,
and nullable `service_duration_minutes` plus `appointment_window_start` /
`appointment_window_end` (`timestamptz`) on each project's work-order table.
Database range/pair/order constraints protect non-browser writers too. There is
one duration/window per work order, so extra one-to-one tables are unnecessary;
future multiple visits would warrant a separate related visit entity. Startup
and per-project migration are idempotent on hosted and standalone PostgreSQL.
The application writes new-project defaults explicitly; the nullable SQL columns
have no defaults, so schema-tool-first upgrades cannot backfill legacy projects.
The optimizer remains provider-independent and never persists calculated ETAs
as appointments.

Scheduling/default changes invalidate route fingerprints, including same-tab
recovery. Recovered old-format results without scheduling provenance are rejected.
Project JSON backups include these work-order fields and `schedulingDefaults`;
full JSON and SQL backups include the relational columns. Invalid scheduling
backups fail before acquiring a connection or deleting business rows. Legacy
project backups leave current defaults unchanged and restore omitted work-order
overrides as null; old full-system project records restore null defaults, not
new-project defaults. Audit evidence records old/new typed values.

CSV, SQL/FTP and customer API imports accept `serviceDurationMinutes`,
`appointmentWindowStart`, and `appointmentWindowEnd`. Imports allow numeric text
for duration, but windows must be paired ISO timestamps with `Z` or an explicit
offset; bare local times are rejected. Omitted import fields preserve saved
values during updates. Existing import protection and permission rules remain.
Outbound customer delivery adds the three fields without changing schemaVersion
or legacy keys. Mobile download retains snake_case fields and adds canonical
camelCase scheduling fields and `meta.visitSchedulingContractVersion: 1`,
effective timezone and nullable project defaults. Mobile upload accepts either
naming form, rejects conflicting aliases, applies the same validation, and
requires Edit Work Orders for scheduling changes. Native apps must omit fields
they do not edit; the server never invents windows from old timestamps.

## Site defaults and project overrides

Instance administrators use **Settings → Work Orders → Maps & Routing**.
Project managers with **Edit Projects** can open project settings from
**Optimize route → Settings** or the inline route view's **Project settings**.

Project behavior has three choices:

- **Use site default**: use the instance provider, credential references and limits.
- **Use project-specific configuration**: use only this project's configured
  provider and credential references. A missing, rejected or exhausted key never
  falls back to the sitewide account or a different provider.
- **Disable route optimization**: do not calculate routes for this project.

The initial sitewide setting is disabled. Save settings without keys if desired;
the UI reports that setup is needed. Credential existence is not proof the account
is enabled, authorized, funded or within quota. A restricted browser key is
needed to show maps, but list-only planning can use a server key alone.

## Credential setup

Settings accept **environment-variable names**, never key values. Add the actual
values through the instance's secret configuration. For a Replit-hosted instance,
use workspace Secrets; for standalone Windows/Linux, use the server service's
protected environment configuration and restart that service. Do not put keys
in Git, general project fields, exports, command-line arguments or logs.

Allowed reference prefixes are `GEOAPIFY_`, `GOOGLE_MAPS_` and
`METERFLO_ROUTING_`. Use separate variables/keys for server and browser access;
MeterFlo will not expose a server key as a browser key. Browser keys are
necessarily public: restrict them to the instance's actual allowed web domains
and map-display APIs. Server keys should be restricted to required APIs and
server addresses where supported. Use separate references per customer project
when different accounts should pay for usage.

Browser reference names must contain the separate `BROWSER` token and must not
contain `SERVER`, `SECRET` or `PRIVATE`. Server reference names cannot contain
`BROWSER`. This prevents selecting a server-only credential for public map display.
Only the dedicated routing endpoints may change configuration: generic project
create/update/copy paths reject routing configuration. Redacted null fields may
round-trip through ordinary project updates but never clear existing routing.

Non-administrator project managers can add references only under
`METERFLO_ROUTING_PROJECT_<projectId>_`. They may retain references that an instance
administrator already assigned to that project/provider, but cannot choose
another project's or the instance's credential names to redirect its billing.

Examples of references (not credential values):

| Provider | Server reference | Browser reference |
| --- | --- | --- |
| Geoapify | `GEOAPIFY_SERVER_API_KEY` | `GEOAPIFY_BROWSER_API_KEY` |
| Google | `GOOGLE_MAPS_SERVER_API_KEY` | `GOOGLE_MAPS_BROWSER_API_KEY` |
| Project override | `METERFLO_ROUTING_CUSTOMER_SERVER` | `METERFLO_ROUTING_CUSTOMER_BROWSER` |

### Geoapify

Create a Geoapify account/project and separate appropriately restricted keys.
Routing uses Geocoding, Route Matrix and Routing APIs. Map display uses Geoapify
tiles with OpenStreetMap/Geoapify attribution. The hosted map library is Leaflet
1.9.4; the browser must be able to reach its pinned CDN and the tile service.

At implementation, the free plan allows commercial production use with required
attribution, 3,000 credits/day and API-specific limits. **Credits are not routes.**
A 21×21 matrix (20 stops plus origin) costs a baseline 210 credits before
additional charges; geocoding, geometry and map tiles also consume quota. Review
current plan terms and size the internal daily-plan limit conservatively.
The free tier has no paid-plan SLA. MeterFlo does not auto-upgrade an account.

- <https://www.geoapify.com/pricing/>
- <https://apidocs.geoapify.com/docs/route-matrix/#pricing>
- <https://www.geoapify.com/terms-and-conditions/>

### Google Maps Platform

Enable billing and **Routes API** plus **Geocoding API** for the server key.
Enable **Maps JavaScript API** for the separate restricted browser key.
Route matrices are charged per element; map display/geocoding/route calls can
have separate charges. MeterFlo displays Google-derived road geometry on a
Google map in a separate iframe so changing a project's browser key does not
reuse another project's initialized map account. Review domain restrictions,
API restrictions, current pricing and content-storage terms.

- <https://developers.google.com/maps/documentation/routes/usage-and-billing>
- <https://developers.google.com/maps/documentation/geocoding/policies>
- <https://developers.google.com/maps/documentation/routes/policies>

## Usage limits and privacy

The hard planning limit is **24 stops** (25 matrix points including origin).
Each effective configuration can set a lower limit and an internal daily-plan
limit. Plan attempts consume that allowance even if a downstream request fails;
there is no automatic retry loop. Concurrent attempts sharing a provider/key
within an instance share an atomic database-backed daily-plan counter, and each
user is limited to one active plan and one attempt per ten seconds. Individual
provider calls time out at 20 seconds; the whole operation is bounded to 90
seconds. Narrow the scope if it times out. Counters use database calendar days.

The internal daily limit counts plans, not every billable API unit, map-tile
request or use of the same account outside MeterFlo. Configure account-level
quotas/budget controls at the provider as well. Cross-instance use of a key
shares its external provider quota, not MeterFlo's internal counters.

Necessary destination addresses/coordinates and the chosen origin are sent to
the provider. Customer names, work-order numbers, serials and credentials are
not included in provider request bodies. Device location is requested only
after user interaction, with an address fallback. No continuous location history
or background GPS tracking is collected.

Route recovery uses same-tab session storage, scoped to signed-in user/project.
It expires within four hours or the provider-compatible shorter expiry, is
revalidated before display, and is cleared on logout/account change, access
loss or tab closure. Do not treat a shared browser profile as a confidentiality
boundary; use separate OS/browser profiles for users requiring that boundary.
Do not extend the cache duration without reviewing current provider terms.

JSON project backups include non-secret provider settings/reference names.
Project restore deliberately disables restored routing configuration so it cannot silently
activate customer billing; an authorized operator must review and enable it.
Legacy backups without routing settings leave current routing configuration
unchanged. Full-system backups include configuration, but **not environment
secret values**. Re-provision keys and review the effective configuration after
moving an instance. Ephemeral quota counters and active route progress are not
business backup data. Key rotation changes the configuration revision and makes
existing route results stale.

## Phone navigation

MeterFlo retains the stop sequence. **Navigate** opens the selected next
destination in Apple Maps on iOS or Google Maps elsewhere, with an alternate
choice. HTTPS links allow a web fallback when an app is not installed; the
device/browser ultimately controls the handoff. Only one destination is sent,
so phone Maps cannot reorder MeterFlo's complete itinerary. Return to the same
tab to retain route progress. Navigation is not proof of arrival or completion.

## Unsupported alternatives

Self-hosted routing, geocoding and map tiles are a future deployment option,
not an implemented provider choice. Do not use OSRM demo servers or public
OpenStreetMap services as an unlimited production backend.
Hosted openrouteservice is not offered here: its current terms prohibit
transmitting personal data, which requires review before sending customer
addresses or technician origins. Free quota alone does not resolve that issue.

## Verification

- `npx tsx --test tests/work-order-routing.test.ts`
- `npx tsx --test tests/visit-scheduling.test.ts`
- Create a disposable fixture with `npx tsx tests/support/inventory-ui-fixture.ts`.
- `npx tsx --test tests/work-order-routing-api.test.ts`
- `npx tsx --test tests/visit-scheduling-database.test.ts`
- `node tests/visit-scheduling-ui.cjs`
- `node tests/work-order-routing-ui.cjs`
- `node tests/work-order-routing-security.cjs`
- Always clean the owned fixture with
  `npx tsx tests/support/inventory-ui-fixture.ts cleanup`.

API/algorithm checks use controlled provider fixtures, not paid live calls.
Browser checks explicitly mock provider responses/map scripts and verify
rendered list/geometry integration, access and recovery. Actual Google/Geoapify
account enablement, geocoding quality, map tile access and quota behavior still
require live acceptance after keys are provided. Desktop/phone-sized Chromium
does not prove Safari behavior or native iOS/Android app launch.
