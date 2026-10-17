# MeterFlo Mobile API Documentation

Inventory-enabled sync downloads additionally require `inventory.view`; missing permission returns 403 without inventory or work-order data. Grant this permission to inventory technicians through role management. See `INVENTORY.md` for reservations, actual-use payloads and removal/return handling.

## Project inventory (additive contract)

Project responses include `inventoryEnabled`, default false. Enabled sync downloads add each work order's `inventoryAllocation` and top-level `inventory:{contractVersion:1,enabled,items,warehouses}`. Preserve item/warehouse IDs, exact serial strings and allocation revision.

Completion uploads can include `inventoryUsage:{operationId:UUID,revision,mode,used,dispositions}` inside the work-order object. `used` contains `{warehouseId,itemId,quantity,serials}`; `dispositions` contains `{equipment:"system"|"module",serial,disposition:"returned"|"scrapped"|"left_onsite",warehouseId,ruleId,ruleRevision,policyRevision}`. Reading-only uses empty arrays and `mode:"reading_only"`. Reuse the UUID on retry. Do not allocate offline or bypass stock conflicts with force-overwrite. Completion and stock consumption commit together; repeated completion is not deducted twice.

### Project equipment-removal rules

Enabled sync downloads and `GET /api/projects/:projectId/work-orders/:workOrderId/inventory` also expose:
- `removalContractVersion:1` on sync metadata, `removalRules` and one-element `removalPolicies`;
- `workflow:{wizardMode,equipment,readingEquipment}` for the project's changeout and reading scopes (`system`, `module`, or `both`);
- rule `{id,name,equipment:"system"|"module"|"both",stage:"field"|"warehouse",outcome:"returned"|"scrapped"|"left_onsite"|"released",active,revision}`;
- policy `{id:"removal-policy",revision,requireSystemReturn,requireModuleReturn}`.

Show only active **field** rules applicable to the removed equipment. When its policy requires return, show only `outcome:"returned"`. Display the configured name, not a hardcoded outcome label. Do not show warehouse-only rules to technicians. No eligible rule is a configuration error, not permission to invent a fallback. Return choices require an accessible active return location; other choices must have `warehouseId:null`. A fixed changeout project cannot use Reading only to avoid stock/removal checks. Reading-only projects cannot reserve or consume replacement stock; hide removal and stock controls. Filter system/module controls to the effective project workflow and preserve hidden historical fields.

Refresh metadata before submitting. A changed rule/policy revision requires review while preserving local captures; the server returns `INVENTORY_CONFLICT` rather than silently converting the choice. Legacy clients may omit rule metadata only for `returned`, which resolves to the active default return rule; arbitrary legacy scrap/leave-onsite choices are rejected. The server saves rule ID/version/name and operational outcome as historical snapshots. Renaming or disabling a rule does not cancel existing pending returns.

The separately maintained Expo app still needs native rule-driven selectors and refresh/review behavior; these server/API additions do not add native UI. After receipt, warehouse release/scrap is a separate authorized online workflow described in `INVENTORY.md`.

See **Project Inventory Control** in Documentation, or [INVENTORY.md](INVENTORY.md), for complete examples, permissions, receiving/transfer commands, imports and backup rules. The separate Expo app must implement this contract; adding server fields alone does not add native inventory UI.

Shipment quarantine is separate from usable inventory and from removed-device returns. Held/unidentified, scrapped and unresolved in-transit units cannot be allocated or consumed by mobile completion. Warehouse receiving, shipment inspection and short-close UI are implemented in the web app, not automatically in Expo. The existing sync allocation/catalog contract is unchanged; do not derive usable availability from original ordered or physically received quantities. See the guided receiving and shipment-exception examples in `INVENTORY.md`.

Complete REST API reference for building the MeterFlo mobile application.

This reference documents the HTTP contract. For workflow configuration, wizard behavior, offline retry strategy, and upload decision rules, see the separate **MeterFlo Mobile App Synchronization Guide** on the Documentation page.

### Dashboard APK distribution (separate from native updates)

Authorized administrators can now upload/publish APKs in **Settings → Mobile
Application Updates → Android APK Releases**. All authenticated Dashboard roles
can download the current release. This does **not** change mobile login, the
`mobileConfig` fields from `/api/users/:id/projects`, GitHub Android release polling,
or existing iOS options. Native clients do not automatically switch to these files.
Windows/Linux servers use protected local storage without Replit; hosted Replit
deployments use private App Storage. See the administrator guide for configuration,
field examples, backups, publication/withdrawal and Android installation.

These instance-wide endpoints use the existing MeterFlo session. All metadata
responses are `Cache-Control: no-store`; internal storage paths/bucket locations
are not exposed.

| Endpoint | Access / behavior |
| --- | --- |
| `GET /api/mobile-releases/latest` | Any authenticated user. Returns `{"release":null}` if unpublished, otherwise `{"release":{...}}`. A missing/inaccessible published binary is a `503` error, not a successful empty list. |
| `GET` or `HEAD /api/mobile-releases/:id/download` | Authenticated binary download/preflight. Ordinary users can download only the current latest (`410` if replaced); managers can inspect any completed build. Withdrawn/missing release metadata returns `404`. Attachment content type is `application/vnd.android.package-archive`; GET streams exact bytes. |
| `GET /api/mobile-releases` | Requires `settings.mobileConfig`. Returns `releases`, `latestId`, `pendingCleanup` (removed-release plus expired-upload jobs), `pendingUploadCleanup`, and current provider availability/limits. |
| `POST /api/mobile-releases/uploads/init` | Requires management permission. JSON: `{"fileName":"MeterFlo-2.4.0.apk","totalSize":6521217,"totalChunks":2,"metadata":{"version":"2.4.0","buildCode":240,"notes":"Offline sync fixes"}}`. Returns `201 {"uploadId":"uuid"}`. Size limit 512 MiB; chunks 5 MiB except the final remainder. |
| `POST /api/mobile-releases/uploads/chunk` | Owner plus management permission. Multipart fields `uploadId`, integer `chunkIndex` (zero-based), file `chunk`; exact expected chunk size required. |
| `POST /api/mobile-releases/uploads/finalize` | Owner plus management permission. JSON `{"uploadId":"uuid"}`. Requires all chunks and valid base APK structure; returns `201` with unpublished release metadata. |
| `DELETE /api/mobile-releases/uploads/:id` | Owner plus management permission. Cancels/stages cleanup; expired sessions are cleaned automatically. |
| `POST /api/mobile-releases/:id/publish` | Management permission. Explicitly sets this completed release latest; returns its metadata. |
| `DELETE /api/mobile-releases/:id` | Management permission. Current latest additionally requires JSON `{"withdrawLatest":true}`, otherwise `409`. No automatic older-release fallback. Returns message and pending cleanup count. |
| `POST /api/mobile-releases/cleanup` | Management permission. Retries removed binaries and expired uploads; returns `{"pendingCleanup":0}` on complete release cleanup. |

Release metadata contains `id`, `version`, nullable `buildCode`, `notes`, `fileName`,
`size` (bytes), `sha256`, `uploadedAt` (UTC ISO timestamp), and nullable `publishedAt`.
Version/build fields are **administrator-supplied**, not extracted or verified.
Errors are JSON `{"message":"..."}` with `400` validation, `401` authentication,
`403` permission/ownership, `404` missing session/release, `409` withdrawal conflict,
`410` expired upload/replaced download, `429` too many pending uploads, or `503`
storage/database unavailability. A HEAD response has no body; do not try to parse
its error JSON. A stream failure after headers aborts the transfer; retry it rather
than accepting a partial file. Downloads do not require buffering the whole APK
inside browser JavaScript.

---

## Table of Contents
1. [Authentication](#authentication)
2. [Projects](#projects)
3. [Sync Endpoints](#sync-endpoints)
4. [Work Order Operations](#work-order-operations)
5. [Bulk Operations](#bulk-operations)
6. [Mobile JSON Endpoints (Base64 Photos)](#mobile-json-endpoints-base64-photos)
7. [Photo & Signature Upload (Multipart)](#photo--signature-upload-multipart)
8. [Important Notes](#important-notes)

---

## Authentication

### Login
```
POST /api/auth/local/login
```

**Request Body:**
```json
{
  "username": "jsmith",
  "password": "YOUR_PASSWORD"
}
```

**Success Response (200):**
```json
{
  "message": "Login successful",
  "user": {
    "id": "user-uuid-here",
    "username": "jsmith",
    "role": "user"
  }
}
```

**Error Responses:**
- `400` - Username and password required
- `401` - Invalid username or password  
- `403` - Account is locked (includes `reason` field)

**Session:** Login creates a session cookie. The mobile app must maintain cookies for all subsequent requests.

---

### Get Current User
```
GET /api/auth/user
```

Returns the currently authenticated user's full profile.

**Response:**
```json
{
  "id": "user-uuid",
  "email": "jsmith@example.com",
  "username": "jsmith",
  "firstName": "John",
  "lastName": "Smith",
  "profileImageUrl": null,
  "role": "user",
  "subroleId": 3,
  "subroleKey": "field_technician",
  "isLocked": false,
  "lockedAt": null,
  "lockedReason": null,
  "lastLoginAt": "2025-12-27T08:00:00Z",
  "address": "123 Main St",
  "city": "Springfield",
  "state": "IL",
  "zip": "62701",
  "phone": "555-1234",
  "website": null,
  "notes": null,
  "createdAt": "2025-01-15T...",
  "updatedAt": "2025-12-27T..."
}
```

Note: `passwordHash` is excluded from the response for security. The `subroleKey` field is added dynamically based on `subroleId`.

---

### Get Current User's Groups
```
GET /api/auth/user/groups
```

Returns groups the current user is a member of.

**Response:**
```json
[
  {
    "id": 1,
    "name": "North District",
    "description": "Northern service area technicians"
  }
]
```

---

### Logout
```
GET /api/logout
```

Ends the current session and redirects to `/`. Mobile clients should follow the redirect or treat any successful 3xx response as logout completion.

---

## Projects

### Get User's Assigned Projects
```
GET /api/users/:userId/projects
```

Use the `user.id` from login response. Returns all projects the user is assigned to.

**Response:**
```json
{
  "projects": [
    {
      "id": 1,
      "name": "Springfield Water District",
      "description": "Meter replacement project for Springfield",
      "databaseName": "springfield_water_1",
      "isActive": true,
      "wizardMode": "changeout",
      "systemReadingDecimalPlaces": 3,
      "moduleReadingDecimalPlaces": 3
    }
  ],
  "mobileConfig": {
    "updateUrl": null,
    "iosUpdateSource": null,
    "appStoreId": null
  }
}
```

---

## Recommended Mobile Login Flow

1. **Login:** `POST /api/auth/local/login` → get `user.id`
2. **Get Projects:** `GET /api/users/{user.id}/projects` → get project list
3. **User selects project** → store `projectId` for all subsequent API calls
4. **Initial Sync:** `GET /api/projects/{projectId}/mobile/sync/download` (no lastSyncTimestamp)
5. **Incremental Sync:** Use `serverTimestamp` from previous response as `lastSyncTimestamp`

### Exact reading text

Reading inputs must be sent as strings, for example `"00001.0012"`, not
`1.0012`. This preserves leading zeros, fractional trailing zeros and digits
beyond JavaScript's safe numeric precision. Use `null` to clear a reading.

Camel-case work-order responses retain their legacy numeric reading fields for
older clients and add these authoritative string-or-null fields:

| Canonical write field | Authoritative response field | Example |
| --- | --- | --- |
| `oldSystemReading` | `oldSystemReadingText` | `"00001.0012"` |
| `newSystemReading` | `newSystemReadingText` | `"00000"` |
| `oldModuleRead` (workflow alias `oldModuleReading`) | `oldModuleReadText` | `"00900719925474099312345.123456"` |
| `newModuleRead` (workflow alias `newModuleReading`) | `newModuleReadText` | `"00023.000000"` |

Prefer the text companion when caching or displaying camel-case records. Do not
run readings through `Number`, `parseFloat`, `parseInt`, or `toFixed`. Store them
as text offline and submit that text in the **canonical write field**, not in the
read-only `*Text` companion. A legacy numeric-only echo of an unchanged value
retains the stored exact value; genuinely new numeric input cannot convey its
original leading zeros.

The snake-case sync download keeps its existing string reading keys
(`old_system_reading`, `new_system_reading`, `old_module_read`, `new_module_read`)
and returns their exact text when available. It also includes their nullable
`*_text` database companions. Older records without captured text fall back to
the database's numeric string, without rounding its digits or inventing zeros.
Zeros discarded before this change cannot be reconstructed.

### Project reading precision

`GET /api/projects`, `GET /api/projects/:id`, and the projects inside
`GET /api/users/:userId/projects` include the following settings:

| Field | Type | Allowed values | Default when unconfigured | Use |
|-------|------|----------------|---------------------------|-----|
| `systemReadingDecimalPlaces` | integer | 0–6 inclusive | 3 | Maximum fractional digits in captured old/new **system** readings |
| `moduleReadingDecimalPlaces` | integer | 0–6 inclusive | 3 | Maximum fractional digits in captured old/new **module** readings |

For example, a project's response may contain
`"systemReadingDecimalPlaces": 0, "moduleReadingDecimalPlaces": 6`.
That project allows a system reading of `"00123"` and a module reading of
`"123.456789"`, but not a system reading of `"123.1"`.
These are maximum limits, not required padding or display formatting.

| Option | When to use | Valid example | Over-limit example |
|--------|-------------|---------------|--------------------|
| 0 | Whole-number registers | `"123"` | `"123.1"` |
| 1 | Registers reporting tenths | `"123.4"` | `"123.45"` |
| 2 | Registers reporting hundredths | `"123.45"` | `"123.456"` |
| 3 | Default; registers reporting thousandths | `"123.456"` | `"123.4567"` |
| 4 | Registers requiring four fractional digits | `"123.4567"` | `"123.45678"` |
| 5 | Registers requiring five fractional digits | `"123.45678"` | `"123.456789"` |
| 6 | Highest supported capture precision | `"123.456789"` | `"123.4567890"` |

Whole numbers (including `"0"`) are valid with every option. A fractional zero
still counts as a digit: `"123.0"` is not a new whole-number capture when the
limit is 0. Negative values, exponent notation, and non-numeric strings are not
valid readings. Send decimal strings with a period; do not use `parseFloat`,
rounding, or truncation before upload. The web form normalizes a keyboard comma
to a period without dropping digits. Web wizard inputs reject over-limit typing
and paste, retaining the previous value without a precision error for that
rejected attempt. The mobile client should use the same input guard.

**Configuration authorization:** administrators have **Configure reading precision**
(`projects.readingPrecision`) by default. Delegated operators need that explicit
permission plus existing project-create/edit permissions and, for editing precision,
project assignment. For example, an authorized
`PATCH /api/projects/3` body is
`{"systemReadingDecimalPlaces":0,"moduleReadingDecimalPlaces":6}`.
Omit a field to retain its current value; do not send null to reset it.
Invalid setting types, fractional settings, or settings outside 0–6 return 400.
An unauthorized write of either protected key returns 403, even if its value is
unchanged. Operators without this permission must omit both keys when saving
unrelated project settings. Read access to the limits requires normal project
access, not the configuration permission.

**Mobile implementation:** load/cache both limits by project ID from the project
response alongside existing wizard settings. Use a missing/null fallback:

```typescript
const systemLimit = project.systemReadingDecimalPlaces ?? 3;
const moduleLimit = project.moduleReadingDecimalPlaces ?? 3;
```

Never use `value || 3`, which incorrectly replaces an intentional 0. Refresh
`GET /api/projects/:id` at project selection, before opening an online capture
wizard, and before uploading offline captures. Work-order sync-download does
not replace this project configuration request. While offline, use the last
cached settings for that project (or 3 when no setting was supplied), and retain
the exact queued reading strings.

The server always checks its current configuration. A limit changed since
offline capture can cause rejection; retain the queued record, refresh project
settings, and ask the technician to correct/reconfirm the reading or the
administrator to correct the project's limit. Never silently round readings,
discard a failed queue entry, or treat `forceOverwrite` as a validation bypass.

Completion, trouble reports that include an old reading, and direct work-order
writes reject changed over-limit readings with
400 before saving the reading or completion files:

```json
{
  "code": "READING_PRECISION",
  "message": "New system reading must be a non-negative whole number (0 decimal places).",
  "errors": [
    {
      "field": "newSystemReading",
      "decimalPlaces": 0,
      "message": "New system reading must be a non-negative whole number (0 decimal places)."
    }
  ]
}
```

Batch sync-upload keeps its HTTP 200 envelope and reports each rejected record
as `status: "error"` with the same `code`, `message`, and `errors`; check
`results` and `summary.errors`, not only HTTP status or envelope `success`.
Unchanged historical readings echoed in edit/sync requests are retained even
when they exceed a newer limit. Imported customer baselines are not automatically
rounded, rewritten, or restricted by technician capture precision.

---

## Sync Endpoints

### Download Work Orders
```
GET /api/projects/:projectId/mobile/sync/download
```

Downloads work orders with incremental sync support.

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `lastSyncTimestamp` | ISO date | Only return records updated after this time |
| `assignedUserId` | string | Filter by assigned user ID |
| `assignedGroupId` | string | Filter by assigned group name |
| `status` | string | Filter by status |
| `limit` | number | Pagination limit |
| `offset` | number | Pagination offset |

> **CRITICAL:** Work orders with status "Completed" or "Closed" are **always excluded** from mobile sync responses. This is a system-enforced rule that cannot be overridden. Mobile devices should only receive active work orders.

**Response:**
```json
{
  "success": true,
  "serverTimestamp": "2025-12-27T12:00:00.000Z",
  "workOrders": [
    {
      "id": 123,
      "customer_wo_id": "WO-001",
      "status": "Open",
      "old_system_id": "SYS123",
      "old_system_type": "FLOWIQ2200",
      "old_system_read": 12345,
      "new_system_id": null,
      "new_system_type": "FLOWIQ3100",
      "new_system_read": null,
      "old_module_id": "MOD456",
      "old_module_type": "AMI-2000",
      "old_module_read": 54321,
      "new_module_id": null,
      "new_module_type": "AMI-3000",
      "new_module_read": null,
      "service_address": "123 Main St",
      "city": "Springfield",
      "state": "IL",
      "zip_code": "62701",
      "assigned_user_id": "user-123",
      "assigned_group_id": null,
      "assigned_user_username": "jsmith",
      "assigned_user_display_name": "John Smith",
      "scheduled_at": "2025-12-28T09:00:00Z",
      "completed_at": null,
      "trouble_code": null,
      "gps_coordinates": null,
      "updated_at": "2025-12-27T10:00:00Z",
      "created_at": "2025-12-20T08:00:00Z"
    }
  ],
  "referenceData": {
    "workOrderStatuses": [
      {"id": 1, "code": "Open", "label": "Open", "isDefault": true},
      {"id": 2, "code": "In Progress", "label": "In Progress"}
    ],
    "troubleCodes": [
      {"id": 1, "code": "TC001", "label": "Meter locked", "description": "Meter locked/inaccessible"}
    ],
    "systemTypes": [
      {"id": 1, "productId": "FLOWIQ2200", "productLabel": "FLOWIQ 2200"}
    ],
    "moduleTypes": [
      {"id": 1, "productId": "AMI-2000", "productLabel": "AMI 2000"}
    ],
    "serviceTypes": [
      {"id": 1, "code": "Water", "label": "Water", "isDefault": true}
    ],
    "assignees": {
      "users": [
        {"type": "user", "id": "user-123", "label": "John Smith", "username": "jsmith"},
        {"type": "user", "id": "user-456", "label": "Mary Jones", "username": "mjones"}
      ],
      "groups": [
        {"type": "group", "id": "group:1", "label": "North District", "key": "North District"},
        {"type": "group", "id": "group:2", "label": "South District", "key": "South District"}
      ]
    }
  },
  "meta": {
    "count": 1,
    "projectId": 1,
    "projectName": "Springfield Water District"
  }
}
```

**Note:** Work order fields use snake_case as they come directly from PostgreSQL. No default pagination limit is applied unless you specify `limit` parameter.

---

### Upload Work Order Updates
```
POST /api/projects/:projectId/mobile/sync/upload
```

Upload batched work order updates with conflict detection.

**Request Body:**
```json
{
  "workOrders": [
    {
      "id": 123,
      "clientUpdatedAt": "2025-12-27T10:00:00Z",
      "forceOverwrite": false,
      "status": "In Progress",
      "notes": "Started work on location"
    }
  ],
  "clientSyncTimestamp": "2025-12-27T10:00:00Z"
}
```

Note: Update fields are placed directly in the object alongside `id`, `clientUpdatedAt`, and `forceOverwrite`.

**Response:**
```json
{
  "success": true,
  "serverTimestamp": "2025-12-27T12:00:00.000Z",
  "results": [
    {"id": 123, "status": "success"},
    {"id": 124, "status": "success"},
    {
      "id": 456,
      "status": "conflict",
      "conflict": true,
      "message": "Server has newer data - please sync and retry. Use forceOverwrite:true to override.",
      "serverUpdatedAt": "2025-12-27T11:00:00Z"
    },
    {"id": 789, "status": "error", "message": "Work order not found"}
  ],
  "summary": {
    "total": 4,
    "successful": 2,
    "conflicts": 1,
    "errors": 1
  }
}
```

**Conflict Handling:** 
- Server compares `clientUpdatedAt` with the server's `updated_at` timestamp
- If server version is newer than client's `clientUpdatedAt`, update is rejected as conflict
- Set `forceOverwrite: true` to override and force the update
- On conflict, sync again to get latest data then retry or show user both versions

---

## Work Order Operations

### Get Single Work Order
```
GET /api/projects/:projectId/work-orders/:workOrderId
```

Fetch complete details for a single work order. Use this for refreshing individual work order data.

**Response:** Full work order object in **snake_case** format (matching bulk sync):
```json
{
  "id": 1046,
  "customer_wo_id": "WO-1046",
  "status": "Open",
  "old_system_id": "SYS123456",
  "old_system_type": "FLOWIQ2200",
  "old_system_read": 12345,
  "new_system_id": null,
  "new_system_type": "FLOWIQ3100",
  "new_system_read": null,
  "old_module_id": "MOD789012",
  "old_module_type": "AMI-2000",
  "old_module_read": 54321,
  "new_module_id": null,
  "new_module_type": "AMI-3000",
  "new_module_read": null,
  "old_gps": "40.7128,-74.0060",
  "new_gps": null,
  "service_address": "123 Main St",
  "city": "Springfield",
  "state": "IL",
  "zip": "62701",
  "customer_name": "John Doe",
  "customer_id": "CUST-001",
  "phone": "555-1234",
  "email": "john@example.com",
  "route": "R1",
  "zone": "North",
  "service_type": "Water",
  "notes": "Gate code 1234",
  "trouble": null,
  "assigned_user_id": "user-uuid",
  "assigned_group_id": null,
  "assigned_user_username": "jsmith",
  "assigned_user_display_name": "John Smith",
  "scheduled_at": "2025-12-28T09:00:00Z",
  "scheduled_by": "user-uuid",
  "scheduled_by_username": "admin",
  "completed_at": null,
  "completed_by": null,
  "completed_by_username": null,
  "signature_data": null,
  "signature_name": null,
  "attachments": null,
  "created_at": "2025-12-20T08:00:00Z",
  "created_by": "admin",
  "updated_at": "2025-12-27T10:00:00Z",
  "updated_by": "jsmith"
}
```

**Note on System vs Module fields:**
- `old_system_id` / `new_system_id` - System (meter) serial numbers
- `old_module_id` / `new_module_id` - Communication module serial numbers
- `*_type` fields - Equipment type/model names
- `*_read` fields - Meter readings (stored as integers)

The presence of `old_system_id` and/or `old_module_id` determines what type of changeout is required.

**Note:** This endpoint returns the same snake_case format as the bulk sync endpoint, so no additional field mapping is required.

---

### Get Work Order by System ID
```
GET /api/projects/:projectId/work-orders/by-system/:systemId
GET /api/projects/:projectId/work-orders/by-meter/:systemId  (legacy alias)
```

Look up a work order by old system ID (`old_system_id`). Useful for barcode/QR scanning workflows.

Both endpoints are supported - the `/by-meter` route is maintained for backward compatibility with existing mobile app implementations.

**Response:** Same snake_case format as above.

---

### Claim Work Order
```
POST /api/projects/:projectId/work-orders/:workOrderId/claim
```

Assigns work order to current user and clears any group assignment. Called automatically when launching the meter changeout wizard.

**Response:**
```json
{
  "message": "Work order assigned to you",
  "workOrder": {...},
  "claimed": true
}
```

If already assigned to this user:
```json
{
  "message": "Already assigned to you",
  "workOrder": {...},
  "claimed": false
}
```

---

### Submit Changeout, Reading, or Trouble Workflow
```
POST /api/projects/:projectId/work-orders/:workOrderId/system-changeout
```

This is the current wizard submission endpoint for successful changeouts, reading-only submissions, and trouble reports. It supports system-only, module-only, or combined system+module scopes.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `photos` - File array (up to 20 photos)
- `data` - JSON string with changeout data

#### Scope Detection

Send `changeoutScope` as `"system"`, `"module"`, or `"both"`. If it is omitted, the API falls back to the IDs present on the work order:
- **System changeout**: Work order has `old_system_id` set
- **Module changeout**: Work order has `old_module_id` set  
- **Both**: Work order has both `old_system_id` and `old_module_id` set

Required fields in the submission depend on which IDs are present:

| Work Order Has | Required Fields |
|----------------|-----------------|
| `old_system_id` only | `oldSystemReading`, `newSystemId`, `newSystemReading` |
| `old_module_id` only | `oldModuleReading`, `newModuleId`, `newModuleReading` |
| Both IDs | All system AND module fields above |

For reading-only submissions, send `isReadingOnly: true`. Only the relevant new reading fields are required; the server copies the old IDs and equipment types. Successful submissions also require `gpsCoordinates` and `signatureName`. Trouble submissions use `canChange: false` and require `troubleCode`.

**Successful Changeout Data (System Only):**
```json
{
  "canChange": true,
  "changeoutScope": "system",
  "isReadingOnly": false,
  "troubleCode": null,
  "troubleNote": null,
  "oldSystemReading": "12345",
  "newSystemId": "NEW123456",
  "newSystemReading": "00000",
  "gpsCoordinates": "40.7128,-74.0060",
  "signatureData": "data:image/png;base64,iVBORw0KGgo...",
  "signatureName": "John Doe",
  "photoTypes": ["before", "before", "after", "after"]
}
```

**Successful Changeout Data (Module Only):**
```json
{
  "canChange": true,
  "changeoutScope": "module",
  "isReadingOnly": false,
  "troubleCode": null,
  "troubleNote": null,
  "oldModuleReading": "54321",
  "newModuleId": "MOD789012",
  "newModuleReading": "00000",
  "gpsCoordinates": "40.7128,-74.0060",
  "signatureData": "data:image/png;base64,iVBORw0KGgo...",
  "signatureName": "John Doe",
  "photoTypes": ["before", "before", "after", "after"]
}
```

**Successful Changeout Data (Both System and Module):**
```json
{
  "canChange": true,
  "changeoutScope": "both",
  "isReadingOnly": false,
  "troubleCode": null,
  "troubleNote": null,
  "oldSystemReading": "12345",
  "newSystemId": "NEW123456",
  "newSystemReading": "00000",
  "oldModuleReading": "54321",
  "newModuleId": "MOD789012",
  "newModuleReading": "00000",
  "gpsCoordinates": "40.7128,-74.0060",
  "signatureData": "data:image/png;base64,iVBORw0KGgo...",
  "signatureName": "John Doe",
  "photoTypes": ["before", "before", "after", "after"]
}
```

**Trouble Report Data:**
```json
{
  "canChange": false,
  "troubleCode": "TC001",
  "troubleNote": "Meter locked in cabinet, no key available",
  "gpsCoordinates": "40.7128,-74.0060",
  "photoTypes": ["trouble", "trouble"]
}
```

**Photo Types:** `"before"`, `"after"`, `"trouble"`

**Response:**
```json
{
  "success": true,
  "message": "System changeout completed successfully",
  "uploadedPhotos": [
    "before_1.jpg",
    "after_1.jpg",
    "WO-001-signature.png"
  ]
}
```

---

### Update Work Order Status
```
PATCH /api/projects/:projectId/work-orders/:workOrderId
```

**Request Body:**
```json
{
  "status": "In Progress"
}
```

---

## Bulk Operations

### Bulk Claim
```
POST /api/projects/:projectId/mobile/work-orders/bulk-claim
```

Claim multiple work orders at once.

**Request Body:**
```json
{
  "workOrderIds": [1, 2, 3, 4, 5]
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {"id": 1, "claimed": true},
    {"id": 2, "claimed": true},
    {"id": 3, "claimed": false, "message": "Already assigned to you"},
    {"id": 4, "claimed": true},
    {"id": 5, "claimed": false, "message": "Work order not found"}
  ],
  "summary": {
    "total": 5,
    "claimed": 3,
    "skipped": 2
  }
}
```

---

### Bulk Status Update
```
POST /api/projects/:projectId/mobile/work-orders/bulk-status
```

Update status on multiple work orders.

**Request Body:**
```json
{
  "workOrderIds": [1, 2, 3],
  "status": "In Progress"
}
```

**Response:**
```json
{
  "success": true,
  "results": [
    {"id": 1, "updated": true},
    {"id": 2, "updated": true},
    {"id": 3, "updated": false, "message": "Work order not found"}
  ],
  "summary": {
    "total": 3,
    "updated": 2,
    "failed": 1
  }
}
```

---

## Mobile JSON Endpoints (Base64 Photos)

These supported compatibility endpoints accept JSON payloads with base64-encoded photos. New wizard implementations should use the multipart `/system-changeout` contract above so changeout, reading-only, and trouble behavior stay aligned with the web app.

### Report Trouble (JSON)
```
POST /api/mobile/workorders/:workOrderId/trouble
```

Report a trouble code with optional photos.

**Request Body:**
```json
{
  "projectId": 2,
  "troubleCode": "02",
  "notes": "Customer refused meter change",
  "oldMeterReading": 12345,
  "photos": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "filename": "trouble_0.jpg"
    }
  ]
}
```

**Required Fields:**
- `projectId` - Project ID
- `troubleCode` - Trouble code (e.g., "01", "02", "03")

**Optional Fields:**
- `notes` - Additional notes
- `oldMeterReading` - Current meter reading
- `photos` - Array of photo objects with `base64` and `filename`

**Photo Storage:** Photos are saved with server-generated collision-proof filenames in the format:
```
{customerWoId}-trouble-{YYYYMMDD}-{uuid}.jpg
```
Example: `WO-1058-trouble-20251228-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`

The `filename` field in the request is ignored - the server enforces standardized naming for consistency.

**Response:**
```json
{
  "success": true,
  "workOrder": { /* updated work order object */ },
  "message": "Trouble reported successfully"
}
```

---

### Complete Meter Changeout (JSON)
```
POST /api/mobile/workorders/:workOrderId/complete
```

Complete a meter changeout with photos and signature. Supports system-only, module-only, or combined changeouts.

**Request Body (System + Module Changeout):**
```json
{
  "projectId": 2,
  "oldSystemReading": 12345,
  "newSystemReading": 0,
  "newSystemId": "SYS123456",
  "oldModuleReading": 54321,
  "newModuleReading": 0,
  "newModuleId": "MOD789012",
  "gpsCoordinates": "39.7294,-104.8337",
  "signatureData": "data:image/png;base64,iVBORw0KGgo...",
  "signatureName": "John Smith",
  "completedAt": "2025-12-28T04:00:00.000Z",
  "notes": "Installation complete",
  "beforePhotos": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "filename": "1058-before-1.jpg"
    }
  ],
  "afterPhotos": [
    {
      "base64": "data:image/jpeg;base64,/9j/4AAQSkZJRg...",
      "filename": "1058-after-1.jpg"
    }
  ]
}
```

**Required Fields:**
- `projectId` - Project ID

**System Fields (required when work order has `old_system_id`):**
- `oldSystemReading` - Old system final reading
- `newSystemReading` - New system initial reading
- `newSystemId` - New system serial number

**Module Fields (required when work order has `old_module_id`):**
- `oldModuleReading` - Old module final reading
- `newModuleReading` - New module initial reading
- `newModuleId` - New module serial number

**Optional Fields:**
- `gpsCoordinates` - GPS coordinates (format: "lat,lng")
- `signatureData` - Base64-encoded signature image
- `signatureName` - Customer name for signature
- `completedAt` - Completion timestamp (ISO 8601)
- `notes` - Additional notes
- `beforePhotos` - Array of before photo objects
- `afterPhotos` - Array of after photo objects

**Photo Storage:** Photos are saved with server-generated collision-proof filenames:
```
{customerWoId}-before-{YYYYMMDD}-{uuid}.jpg
{customerWoId}-after-{YYYYMMDD}-{uuid}.jpg
```
Example: `WO-1058-before-20251228-a1b2c3d4-e5f6-7890-abcd-ef1234567890.jpg`

The `filename` fields in requests are ignored - the server enforces standardized naming for consistency.

**Response:**
```json
{
  "success": true,
  "workOrder": { /* updated work order object */ },
  "message": "Meter changeout completed successfully"
}
```

---

## Photo & Signature Upload (Multipart)

These endpoints support standalone photo and signature updates. Wizard photos and signatures should normally travel in the `/system-changeout` request.

### Upload Photos
```
POST /api/projects/:projectId/mobile/work-orders/:workOrderId/photos
```

Upload photos for a work order separately from the changeout workflow.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `photos` - File array
- `photoTypes` - JSON array matching files: `["before", "after", "trouble"]`

**Response:**
```json
{
  "success": true,
  "uploadedPhotos": [
    {"filename": "before_1700000000000_0.jpg", "type": "before", "path": "before/before_1700000000000_0.jpg"},
    {"filename": "after_1700000000000_1.jpg", "type": "after", "path": "after/after_1700000000000_1.jpg"}
  ],
  "workOrderId": 123,
  "message": "2 photo(s) uploaded successfully"
}
```

---

### Upload Signature
```
POST /api/projects/:projectId/mobile/work-orders/:workOrderId/signature
```

Upload signature as base64 data or file.

**Option 1 - JSON Body:**
```json
{
  "signatureName": "John Doe",
  "signatureData": "data:image/png;base64,iVBORw0KGgo..."
}
```

**Option 2 - Multipart Form:**
- `signature` - Image file
- `signatureName` - Text field

**Response:**
```json
{
  "success": true,
  "workOrderId": 123,
  "signatureName": "John Doe",
  "message": "Signature saved successfully"
}
```

---

## Important Notes

### 1. System/Module Readings
Database stores readings as **INTEGER** - leading zeros are stripped. 
- Input: `"00012345"` → Stored: `12345`
- Client should handle display formatting if leading zeros are needed

### 2. Foreign Key Constraints
Be aware of these when debugging:
- `updated_by` and `created_by` → reference `users.username` (string)
- `completed_by` and `scheduled_by` → reference `users.id` (UUID)

### 3. Offline Sync Pattern
```
1. On app launch:
   - Check network status
   - If online: Sync with lastSyncTimestamp from local storage
   
2. During offline work:
   - Queue all changes locally with clientUpdatedAt timestamp
   - Store the serverUpdatedAt from when record was downloaded
   
3. When back online:
   - Upload queued changes via /sync/upload
   - Handle conflicts by showing user both versions
   - Download latest changes via /sync/download
   - Update lastSyncTimestamp in local storage
```

### 4. GPS Format
Comma-separated latitude and longitude string:
```
"40.7128,-74.0060"
```

### 5. Signature Data Format
Base64 encoded PNG with data URI prefix:
```
"data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
```

### 6. Photo Filename Convention
All uploaded photos are automatically renamed by the server using UUID-based collision-proof naming:
```
{customerWoId}-{type}-{YYYYMMDD}-{uuid}.jpg
```
Where:
- `customerWoId` - The work order's customer WO ID (sanitized for filesystem)
- `type` - Photo type: `before`, `after`, or `trouble`
- `YYYYMMDD` - Upload date
- `uuid` - Cryptographically secure UUID v4 for uniqueness

This ensures files never collide, even during concurrent uploads from multiple technicians.

### 7. Webhooks
Automatically triggered on work order completion if the project has `webhookUrl` configured. External systems receive real-time notifications with the completed work order data.

### 8. Error Response Format
All error responses follow this format:
```json
{
  "message": "Human-readable error message"
}
```

Common HTTP status codes:
- `400` - Bad request (validation error)
- `401` - Not authenticated
- `403` - Forbidden (no permission)
- `404` - Resource not found
- `500` - Server error

---

## Quick Reference

| Action | Method | Endpoint |
|--------|--------|----------|
| Login | POST | `/api/auth/local/login` |
| Get User | GET | `/api/auth/user` |
| Get User Groups | GET | `/api/auth/user/groups` |
| Logout | GET | `/api/logout` |
| Get Projects | GET | `/api/users/:userId/projects` |
| Get Work Order | GET | `/api/projects/:projectId/work-orders/:workOrderId` |
| Download Sync | GET | `/api/projects/:projectId/mobile/sync/download` |
| Upload Sync | POST | `/api/projects/:projectId/mobile/sync/upload` |
| Claim WO | POST | `/api/projects/:projectId/work-orders/:workOrderId/claim` |
| Wizard submission | POST | `/api/projects/:projectId/work-orders/:workOrderId/system-changeout` |
| Bulk Claim | POST | `/api/projects/:projectId/mobile/work-orders/bulk-claim` |
| Bulk Status | POST | `/api/projects/:projectId/mobile/work-orders/bulk-status` |
| Upload Photos | POST | `/api/projects/:projectId/mobile/work-orders/:workOrderId/photos` |
| Upload Signature | POST | `/api/projects/:projectId/mobile/work-orders/:workOrderId/signature` |

---

## Server-side auditing

Authenticated mobile work-order changes, normal/force sync and completion are
audited on the server with the session's verified user identity. Do not submit an
audit actor or generate duplicate client-side audit events. Committed changes
share a transaction with their audit entries; a server audit failure must be
treated as a failed write and handled by normal offline retry logic.

Exact reading strings and their text companions preserve zeros in audit
differences. Replaying an unchanged record does not create a false business
change. Photos/signature content is not copied into audit entries.

Audit administration remains permission-gated web functionality; mobile
authentication is unchanged. See [Audit Logs](AUDIT_LOGS.md) for coverage and
limitations, including external SQL changes and backup/restore behavior.

*Last verified against server routes: October 2026*
