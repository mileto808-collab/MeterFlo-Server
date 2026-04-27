# Customer API Integration Guide

This guide explains how to configure MeterFlo to send completed work order data to your customer's backend systems via REST API.

---

## Overview

MeterFlo can automatically push work order data to external customer systems whenever a work order is completed. Each project can have its own API configuration, allowing you to integrate with multiple customer backends.

### When the API fires

The customer API call is triggered from four places in the server, all of which only fire when a work order reaches a completed state:

| Endpoint | Path | Trigger condition |
|----------|------|-------------------|
| Dashboard / web update | `PATCH /api/projects/:projectId/work-orders/:workOrderId` | Status transitions to `Completed` (i.e. previous status was not `Completed`). Updates that leave the status unchanged or set it to `Trouble` do **not** trigger the API. |
| Mobile system changeout | `POST /api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout` | Only when the changeout actually succeeds (the technician answered "Yes – Proceed" and the system / module was changed). The "Trouble" branch of this endpoint does **not** call the customer API. |
| Mobile completion (legacy) | `POST /api/mobile/workorders/:workOrderId/complete` | Always — this endpoint marks the work order as completed. |
| Mobile completion (project-scoped) | `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/complete` | Always — this endpoint marks the work order as completed. |

### Delivery semantics

- **Fire-and-forget.** All four call sites invoke `sendWorkOrderToCustomerApi(...)` without `await` and attach a `.catch(...)` that only logs to the console. A customer API failure will **never** roll back the work order or fail the user-facing request.
- **No retries.** The service writes one row to `customer_api_logs` per attempt with `retry_count = 0`. There is no automatic retry loop. If a delivery fails you must either fix the work order and re-complete it, or have your customer-side endpoint queue / retry on its end.
- **Project copy.** When a project is duplicated via the "Copy Project" button, all customer API settings (URL, auth type, header name, secret env var name, send-photos toggle, enabled flag) are copied to the new project.

---

## Configuration

### Step 1: Navigate to Project Settings

1. Log in as an Administrator
2. Go to **Projects** in the sidebar
3. Click the **Edit** button on the project you want to configure

### Step 2: Enable Customer API

Scroll down to the **Customer API Integration** section and configure:

| Setting | Database column | Description |
|---------|-----------------|-------------|
| **Enable Customer API** | `customer_api_enabled` | Toggle to enable/disable API integration |
| **API Endpoint URL** | `customer_api_url` (varchar 500) | The URL where work order data will be POSTed |
| **Authentication Type** | `customer_api_auth_type` | One of `none`, `api_key`, `bearer_token`, `basic_auth` |
| **API Key Header Name** | `customer_api_key_header` (varchar 100) | Header name for API key (only used when auth type is `api_key`) |
| **Secret Environment Variable** | `customer_api_secret_env_var` (varchar 100) | Name of the env var on the server containing the secret |
| **Include Photos** | `customer_api_send_photos` (default `true`) | Whether to send photos as base64-encoded data |

### Step 3: Set Up Authentication

Choose an authentication type based on your customer's requirements:

#### No Authentication (`none`)
Use for internal or trusted network endpoints. No `Authorization` or API-key header is sent.

#### API Key (`api_key`)
- Set **Authentication Type** to "API Key (Header)"
- Enter the header name (e.g. `X-API-Key`). If left blank, MeterFlo defaults to `X-API-Key`.
- Set **Secret Environment Variable** to a name like `PROJECT_1_API_KEY`
- Add the actual API key to your server environment variables. MeterFlo sends `<HeaderName>: <secret value>`.

#### Bearer Token (`bearer_token`)
- Set **Authentication Type** to "Bearer Token"
- Set **Secret Environment Variable** to a name like `PROJECT_1_TOKEN`
- Add the actual token to your server environment variables
- MeterFlo will send: `Authorization: Bearer <token>`

#### Basic Authentication (`basic_auth`)
- Set **Authentication Type** to "Basic Authentication"
- Set **Secret Environment Variable** to a name like `PROJECT_1_BASIC_AUTH`
- Store credentials in `username:password` format in the environment variable
- MeterFlo will Base64-encode the value and send: `Authorization: Basic <encoded>`

> **Important:** If `customer_api_auth_type` is anything other than `none` and either the secret env var name is missing or the env var itself is not set on the server, MeterFlo logs a warning to the console and sends the request **without** an auth header. Set the env var on the server before enabling auth.

---

## Environment Variables

For security, API credentials are stored as environment variables on the server, not in the database.

### Windows Server (PM2)

Add to `deploy/ecosystem.config.cjs`:

```javascript
env: {
  NODE_ENV: 'production',
  PORT: 3000,
  // Customer API secrets
  PROJECT_1_API_KEY: 'your-api-key-here',
  PROJECT_2_TOKEN: 'your-bearer-token-here',
}
```

Then restart PM2:
```cmd
pm2 restart meterflo
```

### Replit

Add secrets in the Replit Secrets panel with the matching variable names.

---

## Payload Format

When the customer API fires, MeterFlo sends a JSON `POST` with `Content-Type: application/json` and the following body shape:

```json
{
  "workOrderId": 123,
  "customerWoId": "WO-2024-001",
  "status": "Completed",
  "oldMeterNumber": "SYS12345678",
  "newMeterNumber": "SYS87654321",
  "oldMeterReading": "10523",
  "newMeterReading": "0",
  "oldModuleId": "MOD-ABC123",
  "newModuleId": "MOD-XYZ789",
  "oldModuleReading": "5024",
  "newModuleReading": "0",
  "oldModuleType": "ITRON",
  "newModuleType": "ITRON-2",
  "latitude": "39.7392",
  "longitude": "-104.9903",
  "gpsAccuracy": null,
  "serviceAddress": "123 Main Street",
  "serviceCity": "Denver",
  "serviceState": "CO",
  "serviceZip": "80202",
  "completedAt": "2025-12-28T14:30:00.000Z",
  "completedBy": "user-uuid-here",
  "notes": "System replaced successfully",
  "troubleCode": null,
  "serviceType": "Residential",
  "meterType": null,
  "beforePhoto": "base64-encoded-image-data...",
  "afterPhoto": "base64-encoded-image-data...",
  "signature": "base64-encoded-signature-data..."
}
```

### Field Descriptions

| Field | Type | Description |
|-------|------|-------------|
| `workOrderId` | number | MeterFlo internal work order ID |
| `customerWoId` | string | Customer's work order ID |
| `status` | string | Work order status (almost always `"Completed"` — see "When the API fires" above) |
| `oldMeterNumber` | string \| null | Old system serial number (from `old_system_id`) |
| `newMeterNumber` | string \| null | New system serial number (from `new_system_id`) |
| `oldMeterReading` | string \| null | Final reading from old system (from `old_system_reading`, serialized as a string) |
| `newMeterReading` | string \| null | Initial reading on new system (from `new_system_reading`, serialized as a string) |
| `oldModuleId` | string \| null | Old module serial number (from `old_module_id`) |
| `newModuleId` | string \| null | New module serial number (from `new_module_id`) |
| `oldModuleReading` | string \| null | Final reading from old module (from `old_module_read`, serialized as a string) |
| `newModuleReading` | string \| null | Initial reading on new module (from `new_module_read`, serialized as a string) |
| `oldModuleType` | string \| null | Old module type/model (from `old_module_type`) |
| `newModuleType` | string \| null | New module type/model (from `new_module_type`) |
| `latitude` | string \| null | GPS latitude — see "GPS handling" below |
| `longitude` | string \| null | GPS longitude — see "GPS handling" below |
| `gpsAccuracy` | string \| null | **Currently always `null`.** No upstream column populates this field today; it is reserved for future use. |
| `serviceAddress` | string \| null | Service location address (from `service_address`, falls back to `address`) |
| `serviceCity` | string \| null | Service location city (from `service_city`, falls back to `city`) |
| `serviceState` | string \| null | Service location state (from `service_state`, falls back to `state`) |
| `serviceZip` | string \| null | Service location ZIP (from `service_zip`, falls back to `zip`) |
| `completedAt` | string \| null | ISO 8601 timestamp of completion (`completed_at`) |
| `completedBy` | string \| null | User ID who completed the work (`completed_by`) |
| `notes` | string \| null | Field notes (`notes`) |
| `troubleCode` | string \| null | Trouble code if present on the work order (from `trouble_code` / `trouble`). Usually `null` since trouble work orders generally don't trigger the API. |
| `serviceType` | string \| null | Service type (`service_type`) |
| `meterType` | string \| null | Equipment type/model. Sourced from `meter_type` or `new_meter_type`; `null` if neither is set. |
| `beforePhoto` | string \| null | Base64-encoded before photo. Only present when **Include Photos** is enabled and a before image was found. |
| `afterPhoto` | string \| null | Base64-encoded after photo. Same conditions as `beforePhoto`. |
| `signature` | string \| null | Base64-encoded signature image. Same conditions as `beforePhoto`. |

### Note on field names

The payload uses legacy "meter" field names for backward compatibility with existing customer integrations. The mapping to the actual work order columns is:

- `oldMeterNumber` ← `old_system_id`
- `newMeterNumber` ← `new_system_id`
- `oldMeterReading` ← `old_system_reading`
- `newMeterReading` ← `new_system_reading`
- `meterType` ← `meter_type` or `new_meter_type` (whichever is set)

Module fields (`oldModuleId`, `newModuleId`, `oldModuleReading`, `newModuleReading`, `oldModuleType`, `newModuleType`) keep their natural names and may be `null` if the work order has no module data. Note the underlying reading columns are `old_module_read` / `new_module_read` (no trailing `ing`), which differs from the system reading columns.

### GPS handling

`latitude` and `longitude` are derived as follows:

1. If the work order has explicit `latitude` / `longitude` properties (uncommon), those are used directly.
2. Otherwise the service reads the work order's `new_gps` value (falling back to `old_gps`), which is stored as a single `"lat,lng"` string, and splits on the comma. Both halves are trimmed.
3. If neither is available, both fields are `null`.

### Photo handling

When **Include Photos** is enabled and the calling endpoint passes a work order folder path, the service tries to find each photo in this order:

1. If the caller passed an explicit path or directory (e.g. `<folder>/before` or a specific file), it walks that directory recursively and returns the first image (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`).
2. If nothing was found, it looks for a `before` / `after` / `signature` subfolder under the work-order folder and returns the first image there.
3. If still nothing, it scans files at the root of the work-order folder for filenames containing `-before-`, `_before_`, `before-`, `before_` (and the same for `after` / `signature`).

The found image is read from disk and base64-encoded into the payload. If no image is found, the corresponding field is simply omitted from the JSON.

---

## API Logging

Every outbound call writes one row to the `customer_api_logs` table:

| Column | Description |
|--------|-------------|
| `id` | Log entry ID |
| `project_id` | Project ID |
| `work_order_id` | Work order ID |
| `customer_wo_id` | Customer work order ID |
| `request_url` | API endpoint URL (or `"N/A"` if the request never left the server) |
| `request_method` | Always `POST` |
| `request_payload` | The JSON payload that was sent (string) |
| `response_status` | HTTP status code, or `null` if the request never completed |
| `response_body` | Raw response body returned by the customer API |
| `success` | Boolean — `true` only when the response was 2xx |
| `error_message` | Error message if `success` is `false` |
| `retry_count` | **Always `0`.** No automatic retry mechanism exists today. |
| `created_at` | Timestamp of the API call |

### Viewing logs in the UI

Administrators (and any user with the `settings.customerApiLogs` permission) can view Customer API logs in the web app:

1. Go to **Settings** in the sidebar
2. Open the **Customer API Logs** card
3. Filter by project or success/failure status

Non-admin users only see logs from projects they are assigned to.

### Viewing logs via the REST API

For programmatic access, the same data is exposed via:

```
GET /api/customer-api-logs
```

Query parameters (all optional):

| Param | Type | Description |
|-------|------|-------------|
| `projectId` | integer | Filter to a single project. Non-admins must be assigned to this project or they receive `403`. |
| `success` | `"true"` \| `"false"` | Filter by success state |
| `limit` | integer | Maximum rows to return (default `100`) |

Authentication is required (Replit OIDC session). The caller must have the `settings.customerApiLogs` permission (admins always do). The response is a JSON array of log rows enriched with a `projectName` field.

### Viewing logs via SQL

```sql
SELECT * FROM customer_api_logs
WHERE project_id = 1
ORDER BY created_at DESC
LIMIT 50;
```

---

## Expected Response

Your customer API should return:
- **2xx status code** for success (any 2xx is treated as success)
- Any other status code is treated as a failure and logged with `success = false` and `error_message = "HTTP <status>: <statusText>"`

MeterFlo logs the response body for debugging purposes regardless of outcome. Because calls are fire-and-forget, a non-2xx response does **not** block the user-facing work order completion.

---

## Troubleshooting

### API Calls Not Being Made

1. Verify **Enable Customer API** is turned on for the project.
2. Verify **API Endpoint URL** is set — if it's blank the service short-circuits and returns success without sending anything (you will see `[CustomerAPI] API not enabled for project <id>` in the server logs).
3. Confirm the work order actually transitioned to `Completed`. Trouble reports do not trigger the API in any of the four call sites.
4. Confirm you are looking at the right call site. The dashboard PATCH endpoint only fires the API when the status transitions from non-Completed → Completed; saving an already-Completed work order will not re-trigger.

### Authentication Failures

1. Verify the **Secret Environment Variable** name matches exactly what is set on the server.
2. Restart PM2 (or the Node process) after adding or changing environment variables — they are read at request time but the new env vars must be present in the running process.
3. Check the console for `[CustomerAPI] Environment variable <name> not found` — this means the env var is missing on the server.
4. Check PM2 logs: `pm2 logs meterflo`.

### Connection Errors

1. Verify the endpoint URL is reachable from the server.
2. Check firewall rules allow outbound connections.
3. For HTTPS endpoints, ensure SSL certificates are valid.

### Checking Logs

View PM2 logs for API call information:
```cmd
pm2 logs meterflo --lines 100 | findstr CustomerAPI
```

Query the database for failed API log entries:
```sql
SELECT * FROM customer_api_logs
WHERE success = false
ORDER BY created_at DESC;
```

---

## Security Recommendations

1. **Use HTTPS** — Always use HTTPS endpoints for customer APIs.
2. **Rotate Secrets** — Regularly rotate API keys and tokens.
3. **Limit Access** — Use API keys with minimal required permissions.
4. **Monitor Logs** — Regularly review API logs for failures or anomalies.
5. **Test First** — Test with a staging endpoint before production.
6. **Implement idempotency on your side.** Because MeterFlo does not retry, but operators may re-complete a work order, your endpoint should be safe to receive the same `workOrderId` more than once.

---

## Sample Customer API Implementation

Here's a simple Node.js/Express endpoint to receive MeterFlo data:

```javascript
const express = require('express');
const app = express();

app.use(express.json({ limit: '50mb' }));

app.post('/api/meterflo/work-orders', (req, res) => {
  const apiKey = req.headers['x-api-key'];

  if (apiKey !== process.env.EXPECTED_API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const workOrder = req.body;

  console.log('Received work order:', workOrder.customerWoId);
  console.log('Status:', workOrder.status);
  console.log('Old System ID:', workOrder.oldMeterNumber);
  console.log('New System ID:', workOrder.newMeterNumber);
  console.log('Old Reading:', workOrder.oldMeterReading);
  console.log('New Reading:', workOrder.newMeterReading);
  console.log('System Type:', workOrder.meterType);
  console.log('Completed At:', workOrder.completedAt);

  // Process photos if included
  if (workOrder.beforePhoto) {
    const photoBuffer = Buffer.from(workOrder.beforePhoto, 'base64');
    // Save or process the photo
  }

  // Update your database
  // ...

  res.json({
    success: true,
    message: 'Work order received',
    workOrderId: workOrder.workOrderId
  });
});

app.listen(3001, () => {
  console.log('Customer API listening on port 3001');
});
```

---

## Implementation Files

If you need to dig into the code:

- **Service** — `server/customerApiService.ts` (payload assembly, auth, photo lookup, logging, fetch call).
- **Trigger sites in `server/routes.ts`:**
  - `~line 2788` — dashboard `PATCH /api/projects/:projectId/work-orders/:workOrderId` (status → Completed transition)
  - `~line 9724` — mobile `POST /api/projects/:projectId/mobile/work-orders/:workOrderId/complete-changeout` (only when the changeout succeeds)
  - `~line 10192` — mobile `POST /api/mobile/workorders/:workOrderId/complete`
  - `~line 10671` — mobile `POST /api/mobile/projects/:projectId/work-orders/:workOrderId/complete`
- **Log API endpoint** — `server/routes.ts ~line 6076` (`GET /api/customer-api-logs`).
- **Project copy of API settings** — `server/routes.ts ~line 1698`.
- **Schema** — `shared/schema.ts`:
  - Auth-type enum at `~line 75` (`customerApiAuthTypes`)
  - `projects` columns at `~lines 106–111`
  - `customer_api_logs` table at `~line 179`
  - Project insert schema additions at `~lines 567–572`
  - Permission key `SETTINGS_CUSTOMER_API_LOGS` at `~line 1067`
- **Storage method** — `server/storage.ts` `getCustomerApiLogs(...)` at `~line 1821`.

---

*Last updated: April 2026*
