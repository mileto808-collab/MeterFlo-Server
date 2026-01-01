# MeterFlo Mobile API Documentation

Complete REST API reference for building the MeterFlo mobile application.

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
  "password": "password123"
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
POST /api/auth/logout
```

Destroys the current session.

---

## Projects

### Get User's Assigned Projects
```
GET /api/users/:userId/projects
```

Use the `user.id` from login response. Returns all projects the user is assigned to.

**Response:**
```json
[
  {
    "id": 1,
    "name": "Springfield Water District",
    "description": "Meter replacement project for Springfield",
    "databaseName": "springfield_water_1",
    "createdAt": "2025-01-15T...",
    "updatedAt": "2025-12-20T..."
  },
  {
    "id": 2,
    "name": "Metro Gas Company",
    "description": "Gas meter upgrades",
    "databaseName": "metro_gas_2"
  }
]
```

---

## Recommended Mobile Login Flow

1. **Login:** `POST /api/auth/local/login` → get `user.id`
2. **Get Projects:** `GET /api/users/{user.id}/projects` → get project list
3. **User selects project** → store `projectId` for all subsequent API calls
4. **Initial Sync:** `GET /api/projects/{projectId}/mobile/sync/download` (no lastSyncTimestamp)
5. **Incremental Sync:** Use `serverTimestamp` from previous response as `lastSyncTimestamp`

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
      "old_meter_id": "MTR123",
      "old_meter_reading": 12345,
      "new_meter_id": null,
      "new_meter_reading": null,
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
      {"id": 1, "name": "Open", "isDefault": true},
      {"id": 2, "name": "In Progress"},
      {"id": 3, "name": "Completed"},
      {"id": 4, "name": "Trouble"}
    ],
    "troubleCodes": [
      {"id": 1, "code": "TC001", "description": "Meter locked/inaccessible"},
      {"id": 2, "code": "TC002", "description": "Dog on property"}
    ],
    "meterTypes": [
      {"id": 1, "name": "Residential"},
      {"id": 2, "name": "Commercial"}
    ],
    "serviceTypes": [
      {"id": 1, "name": "Water"},
      {"id": 2, "name": "Gas"}
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
  "old_meter_id": "MTR123456",
  "old_meter_reading": 12345,
  "old_gps": "40.7128,-74.0060",
  "new_meter_id": null,
  "new_meter_reading": null,
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
  "old_meter_type": "Residential",
  "new_meter_type": null,
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

**Note:** This endpoint returns the same snake_case format as the bulk sync endpoint, so no additional field mapping is required.

---

### Get Work Order by Meter ID
```
GET /api/projects/:projectId/work-orders/by-meter/:meterId
```

Look up a work order by old meter ID. Useful for barcode/QR scanning workflows.

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

### Complete Meter Changeout
```
POST /api/projects/:projectId/work-orders/:workOrderId/meter-changeout
```

Complete a meter changeout with photos, GPS, and signature.

**Content-Type:** `multipart/form-data`

**Form Fields:**
- `photos` - File array (up to 20 photos)
- `data` - JSON string with changeout data

**Successful Changeout Data:**
```json
{
  "canChange": true,
  "troubleCode": null,
  "troubleNote": null,
  "oldMeterReading": "12345",
  "newMeterId": "NEW123456",
  "newMeterReading": "00000",
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
  "message": "Meter changeout completed successfully",
  "uploadedPhotos": [
    "/files/Project_1/Work Orders/WO-001/before_1.jpg",
    "/files/Project_1/Work Orders/WO-001/after_1.jpg"
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

These endpoints accept JSON payloads with base64-encoded photos, ideal for mobile apps that don't use multipart form-data.

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

Complete a meter changeout with photos and signature.

**Request Body:**
```json
{
  "projectId": 2,
  "oldMeterReading": 12345,
  "newMeterReading": 12400,
  "newMeterId": "ABC123",
  "newMeterType": "AC250",
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

**Optional Fields:**
- `oldMeterReading` - Old meter final reading
- `newMeterReading` - New meter initial reading
- `newMeterId` - New meter serial number
- `newMeterType` - New meter type code
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
    "/files/Project_1/Work Orders/WO-001/before_2.jpg",
    "/files/Project_1/Work Orders/WO-001/after_3.jpg"
  ]
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

### 1. Meter Readings
Database stores meter readings as **INTEGER** - leading zeros are stripped. 
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
| Logout | POST | `/api/auth/logout` |
| Get Projects | GET | `/api/users/:userId/projects` |
| Get Work Order | GET | `/api/projects/:projectId/work-orders/:workOrderId` |
| Download Sync | GET | `/api/projects/:projectId/mobile/sync/download` |
| Upload Sync | POST | `/api/projects/:projectId/mobile/sync/upload` |
| Claim WO | POST | `/api/projects/:projectId/work-orders/:workOrderId/claim` |
| Changeout | POST | `/api/projects/:projectId/work-orders/:workOrderId/meter-changeout` |
| Bulk Claim | POST | `/api/projects/:projectId/mobile/work-orders/bulk-claim` |
| Bulk Status | POST | `/api/projects/:projectId/mobile/work-orders/bulk-status` |
| Upload Photos | POST | `/api/projects/:projectId/mobile/work-orders/:workOrderId/photos` |
| Upload Signature | POST | `/api/projects/:projectId/mobile/work-orders/:workOrderId/signature` |

---

*Last updated: December 28, 2025*
