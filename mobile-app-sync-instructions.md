# MeterFlo Mobile App Synchronization Guide

This document provides comprehensive instructions for updating the mobile application to synchronize with the web application's workflow configuration, search methods, time tracking, and other features.

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
10. [Offline Handling](#10-offline-handling)

---

## 1. API Endpoints

### Fetch Project Configuration

**Endpoint:** `GET /api/projects/:projectId`

The mobile app must fetch project configuration after authentication and when:
- User switches projects
- App resumes from background
- User pulls to refresh

Cache these settings locally and refresh periodically to ensure updated policies are honored.

### Submit Work Order Completion

**Endpoint:** `PATCH /api/projects/:projectId/work-orders/:workOrderId`

Include time tracking data in the completion payload (see Section 5).

---

## 2. Project Configuration Fields

The project response includes these configuration fields that the mobile app must read and apply:

### Workflow Mode Settings

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `wizardMode` | string | `"changeout"`, `"reading_only"`, `"user_choice"` | Determines which workflow to present |
| `wizardGpsMode` | string | `"automatic"`, `"manual"`, `"disabled"` | How GPS location is captured |

### Step Visibility Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `wizardShowGpsStep` | boolean | true | Show/hide GPS capture step |
| `wizardShowNotesStep` | boolean | true | Show/hide Notes step |
| `wizardShowBeforePhotosStep` | boolean | true | Show/hide Before Photos step |
| `wizardShowAfterPhotosStep` | boolean | true | Show/hide After Photos step |
| `wizardShowSignatureStep` | boolean | true | Show/hide Signature step |

### Search Method Settings

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `searchShowBarcodeScan` | boolean | true | Enable camera barcode scanning |
| `searchShowQrCodeScan` | boolean | true | Enable camera QR code scanning |
| `searchShowManualEntry` | boolean | true | Enable manual text entry search |
| `searchShowHidScanner` | boolean | false | Enable Bluetooth HID scanner |

### Project Status

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | boolean | If false, block all work order operations |

---

## 3. Workflow Mode Implementation

The mobile app must implement three workflow modes based on the `wizardMode` field:

### 3.1 Changeout Mode (`wizardMode === "changeout"`)

Full meter changeout workflow with all steps:

1. **Work Order Selection** - Find and select work order
2. **Confirmation** - "Can you proceed with this work order?"
3. **Old Reading Capture** - Capture current meter reading (with toggle if existing reading present)
4. **Before Photos** - Take photos of existing equipment (if enabled)
5. **Physical Change Confirmation** - Confirm equipment has been changed
6. **New System/Module ID Capture** - Scan or enter new equipment IDs
7. **New Reading Capture** - Enter initial reading on new equipment
8. **After Photos** - Take photos of new installation (if enabled)
9. **GPS Capture** - Capture location (based on GPS mode)
10. **Notes** - Add any field notes (if enabled)
11. **Signature** - Capture customer/technician signature (if enabled)
12. **Review & Submit**

**Labels to use:**
- "New System ID"
- "New Module ID"
- "New Reading"

### 3.2 Reading Only Mode (`wizardMode === "reading_only"`)

Simplified workflow for capturing readings without equipment change:

1. **Work Order Selection** - Find and select work order
2. **Confirmation** - "Can you proceed with this work order?"
3. **Reading Capture** - Capture current meter reading
4. **GPS Capture** - Capture location (based on GPS mode, if enabled)
5. **Notes** - Add any field notes (if enabled)
6. **Review & Submit**

**Critical Implementation Details:**
- Automatically set `newSystemId = oldSystemId`
- Automatically set `newModuleId = oldModuleId`
- Readings are saved to the new reading fields
- Skip Before Photos, After Photos, physical change steps
- Hide or disable New ID entry fields

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
- If "Complete Changeout" → Follow Changeout Mode flow
- If "Capture Reading Only" → Follow Reading Only Mode flow

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

Time tracking measures how long a field technician works on each work order.

### 5.1 When to Start Timer

Capture `startTime` when the user taps EITHER:
- **"Yes - Proceed"** - Confirming they can work on the order
- **"No - Report Issue"** - Reporting a problem with the work order

```javascript
const handleConfirmation = (canProceed) => {
  const startTime = new Date().toISOString();
  setTimeTrackingStart(startTime);
  
  if (canProceed) {
    navigateToNextStep();
  } else {
    navigateToIssueReport();
  }
};
```

### 5.2 When to Stop Timer

Capture `endTime` when the work order is **successfully submitted**.

```javascript
const handleSubmit = async () => {
  const endTime = new Date().toISOString();
  
  const payload = {
    ...workOrderData,
    startTime: timeTrackingStart,
    endTime: endTime,
  };
  
  await submitWorkOrder(payload);
};
```

### 5.3 Server Storage

The server stores time tracking in the `work_order_time_tracking` table:
- `workOrderId` - Reference to the work order
- `projectId` - Reference to the project
- `userId` - The technician who performed the work
- `startTime` - When work began
- `endTime` - When work was submitted

### 5.4 Reopened Work Orders

If a wizard is reopened for the same work order:
- Start a **new** time tracking session
- The server displays the most recent session
- Previous sessions are preserved in history

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
    if (project.wizardGpsMode === 'manual') {
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

| Mode | Behavior |
|------|----------|
| `automatic` | Capture GPS silently in background when wizard starts; no user step |
| `manual` | Show GPS step where user confirms/captures location manually |
| `disabled` | No GPS capture at all |

### 6.3 Data Persistence

Even if a step becomes hidden mid-session (due to config change):
- Preserve any captured data locally
- Do not submit data for disabled steps
- Prevent data loss during offline sync

---

## 7. Reading-Only Mode Safeguards

When `wizardMode === "reading_only"`:

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

### 7.2 Pre-Submission Validation

Before submitting in reading-only mode:

```javascript
const validateReadingOnlySubmission = () => {
  // Ensure IDs match
  if (newSystemId !== oldSystemId) {
    setNewSystemId(oldSystemId);
  }
  if (newModuleId !== oldModuleId) {
    setNewModuleId(oldModuleId);
  }
  
  // Ensure reading is captured
  if (!newReading) {
    showError("Please capture the meter reading");
    return false;
  }
  
  return true;
};
```

---

## 8. Inactive Projects Handling

### 8.1 Check Project Status

When fetching project data, check the `isActive` field:

```javascript
const fetchProject = async (projectId) => {
  const response = await api.get(`/api/projects/${projectId}`);
  const project = response.data;
  
  if (!project.isActive) {
    showBlockingMessage("This project is currently inactive. Work orders cannot be processed.");
    navigateToProjectList();
    return null;
  }
  
  return project;
};
```

### 8.2 Refresh on Resume

When the app resumes from background:

```javascript
useEffect(() => {
  const handleAppStateChange = (nextAppState) => {
    if (nextAppState === 'active') {
      // Refresh project data to check if still active
      refreshCurrentProject();
    }
  };
  
  AppState.addEventListener('change', handleAppStateChange);
  return () => AppState.removeEventListener('change', handleAppStateChange);
}, []);
```

### 8.3 API Error Handling

The server returns `403 Forbidden` for work order operations on inactive projects:

```javascript
const handleApiError = (error) => {
  if (error.response?.status === 403) {
    const message = error.response?.data?.message;
    if (message?.includes('inactive')) {
      showAlert("Project Inactive", "This project has been deactivated. Please contact your administrator.");
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

## 10. Offline Handling

### 10.1 Configuration Caching

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

### 10.2 Work Order Queue

Queue completed work orders for retry when offline:

```javascript
const submitWorkOrder = async (payload) => {
  try {
    await api.patch(`/api/projects/${projectId}/work-orders/${workOrderId}`, payload);
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

### 10.3 Background Sync

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

- [ ] Fetches project configuration from `/api/projects/:projectId`
- [ ] Implements all three workflow modes (changeout, reading_only, user_choice)
- [ ] Respects search method configuration (barcode, QR, manual, HID)
- [ ] Auto-opens single search method when only one is enabled
- [ ] HID scanner input field is read-only
- [ ] Captures time tracking start on confirmation
- [ ] Captures time tracking end on successful submission
- [ ] Dynamically builds step list based on visibility settings
- [ ] Handles GPS mode (automatic, manual, disabled)
- [ ] In reading-only mode: forces newId = oldId
- [ ] Displays mode-aware labels
- [ ] Blocks operations on inactive projects
- [ ] Refreshes project config on app resume
- [ ] Queues submissions for offline retry
- [ ] Handles 403 errors for inactive projects

---

## Questions?

If you need clarification on any API response format or behavior, check the web application's implementation in:
- `client/src/components/work-order-wizard.tsx` - Wizard logic and step management
- `client/src/components/start-changeout-dialog.tsx` - Work order selection and search methods
- `server/routes.ts` - API endpoints and validation
- `shared/schema.ts` - Data types and field definitions
