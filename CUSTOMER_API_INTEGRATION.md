# Customer API Integration

MeterFlo sends completed work-order and trouble-report data to a customer's backend using HTTP POST. Delivery runs in a persistent PostgreSQL queue, with automatic retries, an admin retry action, and a log for each attempt.

This feature works on independent Windows or Linux installations. It does not require Replit, OpenID Connect, or a Replit login. MeterFlo users sign in through the application's local username/password session authentication.

## Configure a project

1. Sign in as an administrator and open **Projects**.
2. Edit the project and find **Customer API Integration**.
3. Enable the integration, enter the receiving URL, choose authentication, and set the photo preference.
4. If authentication is required, configure the named secret environment variable on the server running MeterFlo, then restart that server process so it can read the variable.

| Setting | Stored project column | Behavior |
| --- | --- | --- |
| Enable Customer API | `customer_api_enabled` | New deliveries are recorded only when enabled. Existing queued deliveries pause while disabled and resume after re-enabling. |
| API Endpoint URL | `customer_api_url` | HTTP(S) endpoint for JSON POST requests. Use HTTPS outside a trusted network. URLs with embedded username/password are rejected. Redirects are not followed. |
| Authentication Type | `customer_api_auth_type` | `none`, `api_key`, `bearer_token`, or `basic_auth`. |
| API Key Header Name | `customer_api_key_header` | Custom header for `api_key`; defaults to `X-API-Key`. Reserved delivery headers and `Content-Type` cannot be overridden. |
| Secret Environment Variable | `customer_api_secret_env_var` | The **name** of a server environment variable; never enter the credential itself here. |
| Include Photos | `customer_api_send_photos` | Include all work-order images and signature image data. Defaults to true. When false, image bytes and signature data are omitted; attachment filenames and signature name still remain. |

### Authentication sent to the customer

| Type | Request header |
| --- | --- |
| `none` | No authorization header. |
| `api_key` | `<configured header>: <secret value>` |
| `bearer_token` | `Authorization: Bearer <secret value>` |
| `basic_auth` | `Authorization: Basic <base64 of username:password>` |

For Basic authentication, the named environment variable must contain `username:password`. Supply server environment variables through your installation's secure environment configuration (for example, the service account or PM2 environment on an independent server, or workspace Secrets on Replit). Do not put credentials into source control.

**Missing credentials do not fall back to unauthenticated delivery.** The attempt fails before any HTTP request is sent, is logged, and enters the normal retry cycle. Invalid or missing URLs behave the same way.

Each attempt reads the project's **current URL and authentication settings**, so a configuration correction is used by the next retry. A payload already prepared for delivery is not rebuilt when these settings change.

## What triggers a delivery?

The trigger is centralized in project work-order storage, not separately implemented by each HTTP route. An enabled project's work-order update records an event when its status code or configured status label indicates **Completed**, **Trouble**, or **Unable to Complete**.

This covers:

- Dashboard work-order edits and the current system-changeout / reading-only wizard.
- Legacy and project-scoped mobile completion and system-changeout submissions.
- Mobile trouble reports and accepted offline synchronization uploads.
- Subsequent edits to already completed/trouble work orders.
- Time-tracking saves for an already finalized work order; these create a follow-up delivery with the updated timing.

The work-order update and delivery event are committed in the **same database transaction**. If the event cannot be recorded, the work-order database update rolls back instead of silently losing delivery. Time-tracking saves and their events are also transactional. File uploads and separate webhook integrations are not part of this database transaction.

Open/in-progress updates, work-order creation/imports, and rejected/conflicted synchronization uploads do not create delivery events. The dedicated reset operation does not send a customer update. Enabling a project does not automatically backfill older records or replay earlier failed logs.

## Delivery and automatic retry process

1. The server records a work-order snapshot in `customer_api_deliveries`.
2. A worker checks due deliveries every **5 seconds**. New events are initially delayed 5 seconds to let the normal completion flow finish.
3. On the first send, the worker prepares and saves the outbound JSON, adding the latest recorded time-tracking entry and, when enabled, the available work-order images. Once prepared, this JSON is reused unchanged for every retry.
4. MeterFlo POSTs JSON with a **30-second HTTP timeout**. Any **2xx** response is successful; no particular response-body structure is required.
5. Non-2xx responses, network/timeout errors, payload/file preparation errors, and configuration/authentication errors are logged and automatically retried.
6. One cycle permits **5 attempts total**: the initial attempt plus retries after **1 minute, 5 minutes, 15 minutes, and 1 hour**. These delays begin after the previous attempt finishes.
7. A valid `Retry-After` response header can extend a retry delay, up to 24 hours. It never shortens the normal delay.
8. After five unsuccessful attempts, the delivery remains **failed** until an administrator retries it.

Retries are persistent, not browser timers or an in-memory queue. They resume when the server restarts. An abandoned processing claim becomes eligible for recovery after **2 minutes**. The worker needs a running MeterFlo server and access to PostgreSQL.

Delivery does not wait for the customer's backend before returning from a work-order save. A customer rejection does **not** undo a successfully saved work order.

### Delivery states

| State | Meaning |
| --- | --- |
| `pending` | Waiting for the initial send or an administrator-requested retry. |
| `processing` | Claimed by a worker. |
| `retrying` | An unsuccessful attempt has a scheduled automatic retry. |
| `paused` | The project's integration is disabled; checked again after approximately one minute. No attempt is consumed while paused. |
| `delivered` | A 2xx response was recorded. No further automatic attempts. |
| `failed` | The current five-attempt cycle was exhausted. |

Active deliveries for the same project/work order are processed in creation order. A terminal failure does not permanently block later revisions.

### Duplicate and stale-update protection

Requests include:

```text
Content-Type: application/json
Idempotency-Key: <delivery UUID>
X-MeterFlo-Delivery-Id: <same delivery UUID>
```

The ID is stable across automatic and manual retries of the same delivery. Worker claims prevent overlapping attempts against one delivery.

HTTP delivery is **at least once**, not exactly once: a customer may accept a request just before the connection or MeterFlo process fails. The receiving system should persist the delivery ID and return a successful response for an already processed ID, without applying it twice.

Use `projectId` plus `workOrderId` as the internal work-order key; internal IDs are project-scoped. `customerWoId` is the customer's external identifier when available. Apply newer revisions using `updatedAt` and `deliveryCreatedAt`, and ignore older state updates if a historical delivery is manually replayed after a newer revision was accepted.

## JSON payload contract

New deliveries use **schemaVersion 2**. The original meter-named fields remain for compatibility and are aliases of the canonical system fields. Missing values are `null` unless noted. Database numeric readings are sent as **strings**, preserving precision.

| Fields | Meaning / source |
| --- | --- |
| `schemaVersion`, `deliveryId`, `deliveryCreatedAt` | Contract version (2), stable delivery UUID, and event creation timestamp. |
| `projectId`, `projectName`, `workOrderId` | MeterFlo project ID/name and project-scoped internal work-order ID. |
| `customerWoId` | Customer's external work-order identifier; empty string if absent. |
| `customerId`, `customerName`, `phone`, `email`, `route`, `zone` | Stored customer/contact and route information. |
| `status`, `serviceType`, `troubleCode`, `notes` | Saved work-order outcome and notes, including trouble information. |
| `oldSystemId`, `newSystemId`, `oldSystemReading`, `newSystemReading`, `oldSystemType`, `newSystemType` | Old/new system identifiers, readings, and types. |
| `oldMeterNumber`, `newMeterNumber`, `oldMeterReading`, `newMeterReading` | Compatibility aliases for the corresponding system identifiers/readings. |
| `meterType` | New system type, falling back to old system type. |
| `oldModuleId`, `newModuleId`, `oldModuleReading`, `newModuleReading`, `oldModuleType`, `newModuleType` | Module data. Readings correctly map from `old_module_read` / `new_module_read`. |
| `oldGps`, `newGps` | Both stored GPS strings. |
| `latitude`, `longitude` | Strings derived from `newGps`, falling back to `oldGps`; `null` when absent. |
| `gpsAccuracy` | Optional stored accuracy. The current canonical work-order table has no accuracy column, so this is normally `null`; no accuracy is fabricated. |
| `serviceAddress`, `serviceCity`, `serviceState`, `serviceZip` | Stored address components. |
| `createdBy`, `updatedBy`, `completedBy`, `scheduledBy` | Stored actor identifiers/names (not necessarily display names). |
| `assignedUserId`, `assignedGroupId` | Saved assignment. Completion can clear these, so they may be `null`; `completedBy` is separate. |
| `createdAt`, `updatedAt`, `scheduledAt`, `completedAt` | Stored timestamps as JSON dates, or `null`. |
| `attachments` | Stored attachment filenames/references, default `[]`. Non-image attachment contents, such as PDFs, are not embedded. |
| `signatureName` | Stored signer name even if image inclusion is off. |
| `timeTracking` | Latest saved entry as `{startTime, endTime, durationSeconds}`, or `null`. |
| `photos` | Only with image inclusion enabled: array of `{filename, type, contentType, data}` for every available image, including before/after/trouble/signature images and uncategorized photos. `data` is base64 without a data-URL prefix. |
| `beforePhoto`, `afterPhoto` | Optional compatibility base64 fields for the first categorized image of each type. |
| `signature` | Optional base64 signature, from an image file or saved signature data. Omitted with image inclusion off. |

Core fields are frozen from the work-order save. Image bytes and timing are captured when the outbound payload is first prepared. A later time-tracking save produces another event rather than altering an already sent payload.

Historical deliveries replayed from earlier logs may have the **older contract**; their original outbound JSON is preserved when available. They still receive the new stable delivery headers.

### Receiving endpoint example

The receiving backend should:

1. Authenticate the configured header.
2. Validate required identifiers and parse JSON.
3. Check its persisted idempotency record for the incoming delivery ID.
4. Apply the work-order update and persist the delivery ID atomically.
5. Respond with a 2xx status only after durable acceptance.

Do not return a 2xx response for an update that was rejected or lost. Return an appropriate non-2xx status with a useful, non-sensitive response message when processing fails.

## Administrator workflow and troubleshooting

Open **Settings → Customer API Logs**.

### Delivery queue

- Filter by project or state and page through deliveries.
- See lifetime attempt count, last HTTP status/error, and the next scheduled check.
- Open **View attempts** for the selected delivery's chronological attempt numbers, request URL, error, response, and outbound payload.
- Data refreshes every 5 seconds. Image bytes are summarized in the delivery dialog to keep it readable.
- An administrator can select **Retry delivery** for `failed`, `retrying`, or `paused` deliveries after enabling the project's integration. This queues an immediate retry and begins a fresh five-attempt cycle. The original payload and delivery ID remain unchanged.
- Queued, processing, and delivered requests cannot be manually retried; repeated clicks do not create parallel sends.

### Earlier attempt history

The existing attempt history remains available, including logs from the old implementation. It supports project and success/failure filters and expandable payload/response details.

For a failed older log without a delivery ID, an administrator can choose **Retry legacy delivery**. MeterFlo creates a persistent delivery from the saved outbound JSON (or maps a logged raw work-order record into the current contract), links the original attempt, and begins a new retry cycle. A missing/invalid payload or disabled integration produces a visible error instead of pretending to replay it. Older successes are not replayed.

### Common failures

| Symptom | Action |
| --- | --- |
| No delivery event | Confirm integration was enabled at save time and the work order was finalized. Creation/import and reset are not triggers. |
| Pending/retrying never progresses | Confirm the MeterFlo server and database are running; check the server's queue-worker errors. |
| Paused | Re-enable the project's Customer API. Wait for the next check or use admin retry. |
| Authentication secret not configured | Set the named secret on the running server and restart the process, then retry. |
| HTTP 401/403 | Check auth type, variable name, value, and header expected by the customer. |
| HTTP 400/422 | Inspect the request and response. Confirm the receiver supports the documented types/null values and compatibility fields. |
| HTTP 404 | Correct the endpoint path; MeterFlo does not append a route to the configured URL. |
| HTTP 429/503 | Check customer availability/rate limits; automatic retries honor `Retry-After`. |
| No HTTP response / timeout | Check DNS, TLS, firewall/routing, endpoint availability, and the 30-second timeout. |
| Redirect error | Configure the final receiving URL directly. |
| File preparation error | Check the configured project file root, folder permissions, and existing image files. |
| Failed after five attempts | Correct the cause, then use Retry delivery. |

## Administration API

These routes use MeterFlo's authenticated local session cookie, not customer-backend credentials.

| Route | Access and response |
| --- | --- |
| `GET /api/customer-api-deliveries` | Requires `settings.customerApiLogs`. Optional `projectId`, `status`, `limit` (1–500, default 50), `offset` (default 0). Returns `{deliveries, total, limit, offset}`; no image payloads in summaries. |
| `GET /api/customer-api-deliveries/:deliveryId/attempts` | Same log permission; returns the attempts for that delivery, including saved request/response/error details. |
| `POST /api/customer-api-deliveries/:deliveryId/retry` | Admin only. Returns 202 when queued, 404 if missing, 409 if integration is disabled or the state cannot be retried. |
| `POST /api/customer-api-logs/:logId/retry` | Admin only. Returns 202 for an eligible historical failure with saved JSON; 409 for an ineligible replay. |
| `GET /api/customer-api-logs` | Same log permission. Existing `projectId`, `success=true/false`, `limit` filters; limit defaults to 100 and is capped at 500. |

Non-admin log viewers see only projects assigned to them; filtering is applied before limiting results. Permission to view logs does **not** grant manual retry rights.

New attempt records include `deliveryId`, `attemptNumber` (lifetime one-based number), `triggeredBy` (`automatic` or `manual:<admin ID>`), `retryCount` (attempt number minus one), URL, payload, HTTP response, success/error, and timestamp. A replayed historical attempt is labeled `legacy`.

Authentication headers are not saved. URL credentials/query values and known configured credential values in new response/error logs are redacted. Response bodies are limited to **64 KiB**. Work-order payloads can contain customer information and base64 images, so restrict log access and protect database backups. Existing historical logs are retained as they were originally recorded.

## Installation and implementation

At startup MeterFlo applies an additive, idempotent schema update: it creates `customer_api_deliveries` and adds delivery/attempt fields to existing `customer_api_logs`. The server's database account needs the required table/column creation permissions for this update. No database replacement or destructive migration is required.

The queue and attempt logs are included in MeterFlo PostgreSQL backups. Pending events remain in PostgreSQL through application restarts.

Implementation:

- `server/customerApiService.ts`: transactional enqueue helper, worker claims/sends, persisted retries, and manual replay.
- `server/customerApiPayload.ts`: payload mapping, image collection, auth headers, and retry delays.
- `server/customerApiSchema.ts` and `shared/schema.ts`: additive database schema.
- `server/projectDb.ts`: transactional work-order update trigger.
- `server/storage.ts`: transactional timing trigger and scoped log queries.
- `server/routes.ts`: authenticated administration routes.
- `client/src/components/customer-api-deliveries.tsx` and `client/src/pages/settings.tsx`: delivery queue and troubleshooting UI.

Run the targeted regression suite with `npm run test:customer-api`. It uses a temporary test project and local HTTP receiver, then removes its fixtures; it does not send data to a real customer endpoint.
