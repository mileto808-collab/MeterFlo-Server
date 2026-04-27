# MeterFlo Mobile App Synchronization Guide

This document provides comprehensive instructions for updating the mobile application to synchronize with the web application's workflow configuration, search methods, time tracking, file uploads, and other features.

---

## Table of Contents

1. [API Endpoints](#1-api-endpoints)
2. [Project Configuration Fields](#2-project-configuration-fields)
3. [Workflow Mode Implementation](#3-workflow-mode-implementation)
4. [Search Method Configuration](#4-search-method-configuration)
5. [Time Tracking Implementation](#5-time-tracking-implementation)
6. [Step Visibility Configuration](#6-step-visibility-configuration)
7. [Reading-Only Mode Safeguards](#7-reading-only-mode-safeguards)
8. [Inactive Projects Handling](#8-inactive-projects-handling)
9. [Mode-Aware Labels](#9-mode-aware-labels)
10. [Trouble / "Report Issue" Path](#10-trouble--report-issue-path)
11. [Chunked File Uploads (Production-Safe)](#11-chunked-file-uploads-production-safe)
12. [Offline Handling](#12-offline-handling)

---

## 1. API Endpoints

All endpoints require an authenticated session cookie unless otherwise noted.

### 1.1 Authentication

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/local/login` | Username/password login (mobile bypasses Cloudflare Turnstile) |
| GET | `/api/auth/user` | Returns the current authenticated user (use to verify session) |
| GET | `/api/login` | Replit OIDC web login flow (web only) |
| GET | `/api/logout` | End the current session |

### 1.2 Project Configuration

**Endpoint:** `GET /api/projects/:id`

> Note: the URL parameter is `:id`, even though most other project-scoped routes use `:projectId`.

The mobile app must fetch project configuration after authentication and when:
- User switches projects
- App resumes from background
- User pulls to refresh

Cache these settings locally and refresh periodically to ensure updated policies are honored.

### 1.3 Work Orders

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects/:projectId/work-orders` | List work orders (supports search/filter query params) |
| GET | `/api/projects/:projectId/work-orders/:workOrderId` | Fetch a single work order |
| POST | `/api/projects/:projectId/work-orders` | Create a work order (blocked on inactive projects) |
| PATCH | `/api/projects/:projectId/work-orders/:workOrderId` | Update / submit a completed work order (blocked on inactive projects) |

Time tracking is **not** part of this payload — it has its own endpoints (Section 5).

### 1.4 Time Tracking

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/projects/:projectId/work-orders/:workOrderId/time-tracking` | Fetch the most recent time-tracking session for a work order |
| POST | `/api/projects/:projectId/work-orders/:workOrderId/time-tracking` | Save a new time-tracking session (`startTime`, `endTime`) |

### 1.5 File Uploads

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/projects/:projectId/files` | Upload a project-level file |
| POST | `/api/projects/:projectId/work-orders/:workOrderId/files` | Upload a file attached to a work order (photos, signatures) |
| POST | `/api/projects/:projectId/ftp-files` | Upload a project FTP file |

For files larger than 5 MB — and for all uploads in production — use the chunked endpoints in Section 11 instead.

### 1.6 Lookup / Reference Data

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/work-order-statuses` | Configurable work order status values |
| GET | `/api/trouble-codes` | Trouble codes shown on the "Report Issue" path |
| GET | `/api/service-types` | Service types (Water / Electric / Gas / custom) |

---

## 2. Project Configuration Fields

The project response (`GET /api/projects/:id`) includes these configuration fields. All field names match the `projects` table in `shared/schema.ts`.

### 2.1 Workflow Mode Settings

| Field | Type | Values | Default | Description |
|-------|------|--------|---------|-------------|
| `wizardMode` | string | `"changeout"`, `"reading_only"`, `"user_choice"` | `"changeout"` | Determines which workflow to present |
| `wizardGpsMode` | string | `"automatic"`, `"manual_step"`, `"disabled"` | `"automatic"` | How GPS location is captured |

> **Important:** the manual GPS value is `"manual_step"` (not `"manual"`).

### 2.2 Step Visibility Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wizardShowGpsStep` | boolean | true | Show/hide GPS capture step |
| `wizardShowNotesStep` | boolean | true | Show/hide Notes step |
| `wizardShowBeforePhotosStep` | boolean | true | Show/hide Before Photos step |
| `wizardShowAfterPhotosStep` | boolean | true | Show/hide After Photos step |
| `wizardShowSignatureStep` | boolean | true | Show/hide Signature step |

### 2.3 Search Method Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `searchShowBarcodeScan` | boolean | true | Enable camera barcode scanning |
| `searchShowQrCodeScan` | boolean | true | Enable camera QR code scanning |
| `searchShowManualEntry` | boolean | true | Enable manual text entry search |
| `searchShowHidScanner` | boolean | true | Enable Bluetooth HID scanner |

### 2.4 Equipment Type Settings

These two fields control whether the wizard captures **System**, **Module**, or **both** during each workflow mode. They were added after the original mobile spec and the mobile app must respect them.

| Field | Type | Values | Default | Description |
|-------|------|--------|---------|-------------|
| `changeoutEquipmentType` | string | `"system"`, `"module"`, `"both"`, `"user_choice"` | `"both"` | Equipment scope for changeout mode |
| `readingEquipmentType` | string | `"system"`, `"module"`, `"both"`, `"user_choice"` | `"both"` | Equipment scope for reading-only mode |

Behavior:
- `"system"` — only show System ID / System Reading fields
- `"module"` — only show Module ID / Module Reading fields
- `"both"` — show both System and Module fields
- `"user_choice"` — let the technician pick at the start of the wizard

### 2.5 Operational Hours / Timezone

These fields restrict when work orders may be scheduled. The mobile app should read them when validating any in-app scheduling UI and when interpreting timestamps.

| Field | Type | Description |
|-------|------|-------------|
| `operationalHoursEnabled` | boolean | If true, scheduling is restricted to the configured window |
| `operationalHoursStart` | string | Start time in `"HH:mm"` 24-hour format |
| `operationalHoursEnd` | string | End time in `"HH:mm"` 24-hour format |
| `operationalHoursDays` | string[] | Allowed weekdays (e.g. `["mon","tue","wed","thu","fri"]`) |
| `timezone` | string | IANA timezone (e.g. `"America/Chicago"`); falls back to the global system timezone |

Project holidays are fetched separately via `GET /api/projects/:projectId/holidays` (dates excluded from scheduling).

### 2.6 Project Status

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | boolean | If false, the server blocks work order **create** and **edit** operations (read is still allowed). See Section 8. |

---

## 3. Workflow Mode Implementation

The mobile app must implement three workflow modes based on the `wizardMode` field.

### 3.1 Changeout Mode (`wizardMode === "changeout"`)

Full meter changeout workflow with all steps:

1. **Work Order Selection** - Find and select work order
2. **Confirmation** - "Can you proceed with this work order?" (Yes / No - Report Issue)
3. **Old Reading Capture** - Capture current meter reading (with toggle if existing reading present)
4. **Before Photos** - Take photos of existing equipment (if enabled)
5. **Physical Change Confirmation** - Confirm equipment has been changed
6. **New System/Module ID Capture** - Scan or enter new equipment IDs (driven by `changeoutEquipmentType`)
7. **New Reading Capture** - Enter initial reading on new equipment
8. **After Photos** - Take photos of new installation (if enabled)
9. **GPS Capture** - Capture location (based on GPS mode)
10. **Notes** - Add any field notes (if enabled)
11. **Signature** - Capture customer/technician signature (if enabled)
12. **Review & Submit**

If the technician selects "No - Report Issue" at step 2, follow the trouble path in Section 10 instead.

**Labels to use:**
- "New System ID"
- "New Module ID"
- "New Reading"

### 3.2 Reading Only Mode (`wizardMode === "reading_only"`)

Simplified workflow for capturing readings without equipment change:

1. **Work Order Selection** - Find and select work order
2. **Confirmation** - "Can you proceed with this work order?" (Yes / No - Report Issue)
3. **Reading Capture** - Capture current meter reading (driven by `readingEquipmentType`)
4. **GPS Capture** - Capture location (based on GPS mode, if enabled)
5. **Notes** - Add any field notes (if enabled)
6. **Review & Submit**

**Critical Implementation Details:**
- Automatically set `newSystemId = oldSystemId`
- Automatically set `newModuleId = oldModuleId`
- Readings are saved to the **new** reading fields
- Skip Before Photos, After Photos, and physical change steps
- Hide or disable New ID entry fields
- Honor `readingEquipmentType` to decide which of System / Module reading inputs to show

**Labels to use:**
- "Current Reading" (instead of "New Reading")
- "Meter Reading" (instead of "New System Reading")

### 3.3 User Choice Mode (`wizardMode === "user_choice"`)

Present a selection modal when the technician starts a work order:

```
┌─────────────────────────────────────────┐
│     What would you like to do?          │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │   Complete Changeout            │    │
│  │   Replace meter and capture     │    │
│  │   new equipment information     │    │
│  └─────────────────────────────────┘    │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │   Capture Reading Only          │    │
│  │   Record current meter reading  │    │
│  │   without equipment change      │    │
│  └─────────────────────────────────┘    │
│                                         │
└─────────────────────────────────────────┘
```

- Store the user's selection for that work order session
- If "Complete Changeout" → Follow Changeout Mode flow (apply `changeoutEquipmentType`)
- If "Capture Reading Only" → Follow Reading Only Mode flow (apply `readingEquipmentType`)

---

## 4. Search Method Configuration

Search methods apply in TWO places:
1. **Starting a work order** - Finding and selecting a work order to begin
2. **Capturing New IDs** - Scanning/entering new System and Module IDs during changeout

### 4.1 Available Search Methods

| Method | Field | Description |
|--------|-------|-------------|
| Camera Barcode | `searchShowBarcodeScan` | Use device camera to scan 1D barcodes |
| Camera QR Code | `searchShowQrCodeScan` | Use device camera to scan QR codes |
| Manual Entry | `searchShowManualEntry` | Type to search by WO ID, system ID, module ID, address, or customer ID |
| Bluetooth HID | `searchShowHidScanner` | External Bluetooth barcode/QR scanner |

### 4.2 Search Method Selection Logic

```javascript
const enabledMethods = [];
if (project.searchShowBarcodeScan) enabledMethods.push('barcode');
if (project.searchShowQrCodeScan) enabledMethods.push('qrcode');
if (project.searchShowManualEntry) enabledMethods.push('manual');
if (project.searchShowHidScanner) enabledMethods.push('hid');

if (enabledMethods.length === 1) {
  // Open that method directly - no selection screen
  openSearchMethod(enabledMethods[0]);
} else if (enabledMethods.length > 1) {
  // Show selection screen with available options
  showSearchMethodSelector(enabledMethods);
}
```

### 4.3 Bluetooth HID Scanner Implementation

When HID scanner is selected:
- Display an input field that is **READ-ONLY**
- User cannot type in this field
- The Bluetooth scanner sends data as keyboard input
- Field receives the scanned data automatically
- Prevents manual editing to ensure data accuracy

```jsx
<TextInput
  value={scannedValue}
  editable={false}  // READ-ONLY
  placeholder="Waiting for scanner input..."
  onChangeText={(text) => setScannedValue(text)}
/>
```

### 4.4 New ID Capture in Wizard

During the changeout wizard, when capturing New System ID or New Module ID:
- Use the same search method configuration
- Apply the same single-method auto-open logic
- After successfully capturing one ID, use a ref-based approach to prevent redundant scanner triggers:

```javascript
const lastAutoSelectedTarget = useRef(null);

// When an ID is successfully captured
if (capturedId && lastAutoSelectedTarget.current !== targetField) {
  lastAutoSelectedTarget.current = targetField;
}

// When user clears a captured ID
const handleClearId = () => {
  setCapturedId(null);
  lastAutoSelectedTarget.current = null; // Reset to allow re-entry
};
```

---

## 5. Time Tracking Implementation

Time tracking measures how long a field technician works on each work order. **It is sent to its own dedicated endpoint** — it is *not* part of the work order PATCH payload.

### 5.1 When to Start the Timer

Capture `startTime` (locally, in the app) when the user taps EITHER:
- **"Yes - Proceed"** - Confirming they can work on the order
- **"No - Report Issue"** - Reporting a problem with the work order

```javascript
const handleConfirmation = (canProceed) => {
  const startTime = new Date().toISOString();
  setSessionStartTime(startTime);
  
  if (canProceed) {
    navigateToNextStep();
  } else {
    navigateToTroubleCapture();
  }
};
```

### 5.2 When to Stop the Timer & Submit

Capture `endTime` when the work order is **successfully submitted**, then POST the session to the time-tracking endpoint:

```javascript
const handleSubmit = async () => {
  // 1. Submit the work order itself (no time fields here)
  await api.patch(
    `/api/projects/${projectId}/work-orders/${workOrderId}`,
    workOrderData
  );

  // 2. Save time tracking as a separate call
  const endTime = new Date().toISOString();
  await api.post(
    `/api/projects/${projectId}/work-orders/${workOrderId}/time-tracking`,
    { startTime: sessionStartTime, endTime }
  );
};
```

The server returns `400` if either `startTime` or `endTime` is missing.

### 5.3 Server Storage

The server stores time tracking in the `work_order_time_tracking` table (in the public schema):

| Column | Type | Description |
|--------|------|-------------|
| `id` | integer | Primary key |
| `projectId` | integer | FK to `projects.id` (cascade delete) |
| `systemWorkOrderId` | text | Identifier derived from the work order's `customerWoId` (falls back to numeric work order id when `customerWoId` is empty) |
| `startTime` | timestamp | When work began |
| `endTime` | timestamp | When work was submitted |
| `createdAt` | timestamp | Row creation timestamp |

Note: there is **no** `userId` column. The technician identity is captured implicitly through the authenticated session at POST time but is not persisted on the row.

### 5.4 Reopened Work Orders

If a wizard is reopened for the same work order:
- Start a **new** time tracking session
- The `GET` endpoint returns the **most recent** session
- Previous sessions are preserved in history (they remain in the table)

---

## 6. Step Visibility Configuration

Build the wizard step list dynamically based on project settings.

### 6.1 Step Registry

```javascript
const buildStepList = (project, workflowMode) => {
  const steps = [];

  // Always include core steps
  steps.push({ id: 'confirmation', component: ConfirmationStep });

  if (workflowMode === 'changeout') {
    steps.push({ id: 'oldReading', component: OldReadingStep });

    if (project.wizardShowBeforePhotosStep) {
      steps.push({ id: 'beforePhotos', component: BeforePhotosStep });
    }

    steps.push({ id: 'physicalChange', component: PhysicalChangeStep });
    steps.push({ id: 'newIds', component: NewIdsStep });
    steps.push({ id: 'newReading', component: NewReadingStep });

    if (project.wizardShowAfterPhotosStep) {
      steps.push({ id: 'afterPhotos', component: AfterPhotosStep });
    }
  } else {
    // reading_only mode
    steps.push({ id: 'reading', component: ReadingStep });
  }

  // GPS step (both modes)
  if (project.wizardShowGpsStep && project.wizardGpsMode !== 'disabled') {
    if (project.wizardGpsMode === 'manual_step') {
      steps.push({ id: 'gps', component: GpsStep });
    }
    // If 'automatic', capture GPS silently - no user step
  }

  // Notes step (both modes)
  if (project.wizardShowNotesStep) {
    steps.push({ id: 'notes', component: NotesStep });
  }

  // Signature step (both modes)
  if (project.wizardShowSignatureStep) {
    steps.push({ id: 'signature', component: SignatureStep });
  }

  steps.push({ id: 'review', component: ReviewStep });

  return steps;
};
```

### 6.2 GPS Mode Handling

| Mode | Value | Behavior |
|------|-------|----------|
| Automatic | `"automatic"` | Capture GPS silently in the background once the user confirms they can proceed; no user step |
| Manual | `"manual_step"` | Show a GPS step where the user confirms/captures location manually |
| Disabled | `"disabled"` | No GPS capture at all |

### 6.3 Data Persistence

Even if a step becomes hidden mid-session (due to config change):
- Preserve any captured data locally
- Do not submit data for disabled steps
- Prevent data loss during offline sync

---

## 7. Reading-Only Mode Safeguards

When `wizardMode === "reading_only"` (or the user picked "Capture Reading Only" in `user_choice` mode):

### 7.1 ID Field Handling

```javascript
// On work order load in reading-only mode
const initializeReadingOnlyMode = (workOrder) => {
  setNewSystemId(workOrder.oldSystemId);
  setNewModuleId(workOrder.oldModuleId);
  setIsReadingOnlyMode(true);
};

// New ID fields should be read-only or hidden
<TextInput
  value={newSystemId}
  editable={false}  // Prevent editing
  style={styles.disabledInput}
/>
```

### 7.2 Equipment Type Filtering

Honor `readingEquipmentType`:
- `"system"` — only require/display the System reading; do not show the Module reading input
- `"module"` — only require/display the Module reading; do not show the System reading input
- `"both"` — display both
- `"user_choice"` — show both as optional and let the technician pick which to capture

### 7.3 Pre-Submission Validation

```javascript
const validateReadingOnlySubmission = () => {
  // Ensure IDs match
  if (newSystemId !== oldSystemId) {
    setNewSystemId(oldSystemId);
  }
  if (newModuleId !== oldModuleId) {
    setNewModuleId(oldModuleId);
  }

  // Ensure at least the required reading is captured (per readingEquipmentType)
  if (!hasRequiredReading()) {
    showError("Please capture the meter reading");
    return false;
  }

  return true;
};
```

---

## 8. Inactive Projects Handling

The server allows **reading** project and work order data on inactive projects, but **blocks creating or editing** work orders. Specifically:

| Operation | Behavior on inactive project |
|-----------|------------------------------|
| `GET /api/projects/:id` | Allowed — returns the project with `isActive: false` |
| `GET /api/projects/:projectId/work-orders` | Allowed |
| `GET /api/projects/:projectId/work-orders/:workOrderId` | Allowed |
| `POST /api/projects/:projectId/work-orders` | **403** — `"Cannot create work orders on inactive projects"` |
| `PATCH /api/projects/:projectId/work-orders/:workOrderId` | **403** — `"Cannot edit work orders on inactive projects"` |
| Scheduled FTP / database imports | Skipped automatically |

### 8.1 Check Project Status

```javascript
const fetchProject = async (projectId) => {
  const response = await api.get(`/api/projects/${projectId}`);
  const project = response.data;

  if (!project.isActive) {
    showBlockingMessage("This project is currently inactive. Work orders cannot be processed.");
    return project; // Still return so existing data can be viewed read-only
  }

  return project;
};
```

### 8.2 Refresh on Resume

```javascript
useEffect(() => {
  const handleAppStateChange = (nextAppState) => {
    if (nextAppState === 'active') {
      refreshCurrentProject();
    }
  };

  AppState.addEventListener('change', handleAppStateChange);
  return () => AppState.removeEventListener('change', handleAppStateChange);
}, []);
```

### 8.3 API Error Handling

The server returns `403 Forbidden` with one of two specific messages:

```javascript
const handleApiError = (error) => {
  if (error.response?.status === 403) {
    const message = error.response?.data?.message || '';
    if (message.includes('inactive project')) {
      showAlert(
        "Project Inactive",
        "This project has been deactivated. Please contact your administrator."
      );
      refreshProjectList();
    }
  }
};
```

---

## 9. Mode-Aware Labels

Update UI labels based on the current workflow mode:

### 9.1 Label Configuration

```javascript
const labels = {
  changeout: {
    newSystemId: "New System ID",
    newModuleId: "New Module ID",
    newReading: "New Reading",
    newSystemReading: "New System Reading",
    newModuleReading: "New Module Reading",
    pageTitle: "Meter Changeout",
    confirmButton: "Complete Changeout",
  },
  reading_only: {
    newSystemId: "System ID",  // Display only, not editable
    newModuleId: "Module ID",  // Display only, not editable
    newReading: "Current Reading",
    newSystemReading: "Current System Reading",
    newModuleReading: "Current Module Reading",
    pageTitle: "Reading Capture",
    confirmButton: "Submit Reading",
  },
};

const getLabel = (key) => {
  const mode = isReadingOnlyMode ? 'reading_only' : 'changeout';
  return labels[mode][key] || labels.changeout[key];
};
```

### 9.2 Usage in Components

```jsx
<Text style={styles.label}>{getLabel('newReading')}</Text>
<TextInput
  value={newReading}
  onChangeText={setNewReading}
  placeholder={`Enter ${getLabel('newReading').toLowerCase()}`}
/>
```

---

## 10. Trouble / "Report Issue" Path

When the technician taps **"No - Report Issue"** at the confirmation step, the wizard takes a separate path. The mobile app must implement this flow in addition to the success path.

### 10.1 Flow

1. **Trouble Code Selection** — Pull from `GET /api/trouble-codes` and present the available codes for selection.
2. **Trouble Notes** — Free-text field (optional) describing the issue.
3. **Trouble Photos** — Optional photo capture documenting the problem.
4. **Review & Submit** — Submit the work order with the trouble information attached.

### 10.2 Submission Payload

The work order PATCH should include:

| Field | Description |
|-------|-------------|
| `troubleCode` | The selected trouble code value |
| `troubleNotes` | Optional free-text notes |
| `troublePhotos` | Photo files (uploaded via the file endpoints in Section 1.5 / Section 11) |

The work order is marked complete with the trouble status (rather than the normal completion status). Standard fields like new IDs, new readings, before/after photos, and signature are **not** required on this path.

### 10.3 Time Tracking on the Trouble Path

Time tracking still applies. The timer started in Section 5.1 continues to run, and `endTime` should be captured + submitted when the trouble report is submitted, exactly like the success path.

### 10.4 GPS on the Trouble Path

When the user selects "No - Report Issue":
- Stop any in-progress automatic GPS capture
- Clear any captured coordinates
- Do not include GPS data in the trouble submission

---

## 11. Chunked File Uploads (Production-Safe)

In production, large single-request uploads can be rejected by the reverse proxy before reaching the server (this commonly affects APKs and high-resolution photo bundles). The mobile app **must** use chunked uploads for any file larger than 5 MB.

### 11.1 When to Use

| File Size | Strategy |
|-----------|----------|
| ≤ 5 MB | Direct POST to the file endpoint (Section 1.5) |
| > 5 MB | Three-step chunked flow described below |

### 11.2 Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/files/chunked/init` | Begin a chunked upload session |
| POST | `/api/files/chunked/chunk` | Upload one 5 MB chunk |
| POST | `/api/files/chunked/finalize` | Assemble the chunks and persist the file |

### 11.3 Constraints

- **Chunk size:** 5 MB (`5 * 1024 * 1024` bytes)
- **Maximum chunks per file:** 200 (server rejects larger values with 400)
- **Concurrent sessions per user:** 3 max (server returns 429 when exceeded)
- **Allowed target URLs** (must match exactly one of):
  - `/api/projects/:projectId/files`
  - `/api/projects/:projectId/work-orders/:workOrderId/files`
  - `/api/projects/:projectId/ftp-files`
- **Customer role:** blocked at `init` with 403
- **Project assignment:** non-admin users must be assigned to the target project

### 11.4 Init Request

```javascript
POST /api/files/chunked/init
Content-Type: application/json

{
  "fileName": "before-photo.jpg",
  "totalChunks": 7,
  "targetUrl": "/api/projects/12/work-orders/345/files"
}
```

**Response:**
```json
{ "uploadId": "<uuid>" }
```

### 11.5 Chunk Request

For each chunk, send a `multipart/form-data` request:

```
POST /api/files/chunked/chunk
Content-Type: multipart/form-data

chunk:       <binary 5 MB slice>
uploadId:    <uuid from init>
chunkIndex:  <0-based index>
```

### 11.6 Finalize Request

```javascript
POST /api/files/chunked/finalize
Content-Type: application/json

{ "uploadId": "<uuid>" }
```

The server assembles the chunks, validates the total file size against the system `max_file_size_mb` setting and the project's allowed extensions, then routes the assembled file to the same persistence path as the direct upload endpoint.

### 11.7 Reference Implementation

The web app's `client/src/lib/chunkedUpload.ts` is the canonical implementation. The mobile app should mirror its behavior:
1. If `file.size <= CHUNK_SIZE`, do a single direct POST to `targetUrl`.
2. Otherwise, call `init` → loop `chunk` → `finalize`.
3. Report progress to the user (uploading vs finalizing stages).
4. Surface server error messages (`error.message`) to the user — they include actionable detail like "File exceeds maximum size of N MB" or "File type X not allowed".

### 11.8 Photos & Signatures

For photo uploads in the wizard, send each captured photo through this flow against `/api/projects/:projectId/work-orders/:workOrderId/files`. Doing this avoids the production reverse-proxy size limit and gives the user a visible progress indicator.

---

## 12. Offline Handling

### 12.1 Configuration Caching

Cache project configuration locally:

```javascript
const cacheProjectConfig = async (project) => {
  await AsyncStorage.setItem(
    `project_config_${project.id}`,
    JSON.stringify({
      ...project,
      cachedAt: new Date().toISOString(),
    })
  );
};

const getCachedConfig = async (projectId) => {
  const cached = await AsyncStorage.getItem(`project_config_${projectId}`);
  return cached ? JSON.parse(cached) : null;
};
```

### 12.2 Work Order Queue

Queue completed work orders for retry when offline. Remember to also queue the time-tracking POST (Section 5.2) and any pending chunked uploads (Section 11):

```javascript
const submitWorkOrder = async (payload) => {
  try {
    await api.patch(
      `/api/projects/${projectId}/work-orders/${workOrderId}`,
      payload
    );
    showSuccess("Work order submitted successfully");
  } catch (error) {
    if (!navigator.onLine || error.message === 'Network Error') {
      await queueForRetry(payload);
      showInfo("Saved offline. Will submit when connection restores.");
    } else {
      throw error;
    }
  }
};
```

### 12.3 Background Sync

Retry queued submissions when connection restores:

```javascript
const processOfflineQueue = async () => {
  const queue = await getOfflineQueue();

  for (const item of queue) {
    try {
      await api.patch(item.url, item.payload);
      await removeFromQueue(item.id);
    } catch (error) {
      console.log('Retry failed, will try again later:', error);
      break; // Stop on first failure
    }
  }
};
```

---

## Summary Checklist

Before release, verify the mobile app:

- [ ] Authenticates via `/api/auth/local/login` and verifies the session via `/api/auth/user`
- [ ] Fetches project configuration from `/api/projects/:id` (note: `:id`, not `:projectId`)
- [ ] Implements all three workflow modes (`changeout`, `reading_only`, `user_choice`)
- [ ] Honors `changeoutEquipmentType` and `readingEquipmentType` (system / module / both / user_choice)
- [ ] Respects search method configuration (barcode, QR, manual, HID)
- [ ] Auto-opens single search method when only one is enabled
- [ ] HID scanner input field is read-only
- [ ] Captures time tracking start on confirmation (Yes or No - Report Issue)
- [ ] Captures time tracking end on successful submission
- [ ] Submits time tracking via the dedicated `POST .../time-tracking` endpoint, NOT in the work order PATCH payload
- [ ] Dynamically builds step list based on visibility settings
- [ ] Handles GPS mode using the correct enum values: `"automatic"`, `"manual_step"`, `"disabled"`
- [ ] In reading-only mode: forces `newId = oldId`
- [ ] Displays mode-aware labels
- [ ] Implements the trouble / "Report Issue" path (trouble codes, notes, photos)
- [ ] Reads inactive project state and shows a blocking message before create/edit
- [ ] Handles 403 errors for inactive projects (`"Cannot create..."` / `"Cannot edit..."`)
- [ ] Refreshes project config on app resume
- [ ] Uses chunked uploads (`/api/files/chunked/...`) for files > 5 MB, including photos in production
- [ ] Limits itself to 3 concurrent chunked upload sessions per user
- [ ] Queues submissions for offline retry (work orders, time tracking, file uploads)

---

## Questions?

If you need clarification on any API response format or behavior, check the web application's implementation in:
- `client/src/components/system-changeout-wizard.tsx` — Wizard logic, step management, time tracking start/end
- `client/src/components/start-system-changeout-dialog.tsx` — Work order selection and search methods
- `client/src/lib/chunkedUpload.ts` — Reference implementation of the chunked upload flow
- `server/routes.ts` — All API endpoints and validation
- `server/storage.ts` — `getWorkOrderTimeTracking` / `saveWorkOrderTimeTracking` storage logic
- `shared/schema.ts` — Data types, enums, and field definitions (including `projects` table and `work_order_time_tracking` table)
