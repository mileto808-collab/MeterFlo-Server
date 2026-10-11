# System Administration Guide

This guide covers the operational requirements, business logic, and configuration guidelines for MeterFlo administrators. It also walks through how to set up a new project and how a field technician processes a work order from start to finish.

---

## Table of Contents

1. [System Users](#system-users)
2. [Core Status Codes](#core-status-codes)
3. [Service Types, System Types, Module Types & Trouble Codes](#service-types-system-types-module-types--trouble-codes)
4. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
5. [Project-Based Access Control](#project-based-access-control)
6. [Settings Page Reference](#settings-page-reference)
7. [Setting Up a New Project](#setting-up-a-new-project)
8. [Processing a Work Order](#processing-a-work-order)
9. [Wizard Workflow Modes](#wizard-workflow-modes)
10. [Search Methods (Mobile / Wizard)](#search-methods-mobile--wizard)
11. [Operational Hours & Holidays](#operational-hours--holidays)
12. [Project Timezones](#project-timezones)
13. [Inactive Projects](#inactive-projects)
14. [Copy Project](#copy-project)
15. [Scheduled File Imports](#scheduled-file-imports)
16. [Multi-Tenancy Architecture](#multi-tenancy-architecture)
17. [File Management](#file-management)
18. [Database Considerations](#database-considerations)
19. [Customer API Integration](#customer-api-integration)
20. [Real-Time Updates](#real-time-updates)
21. [Cloudflare Turnstile (Login Protection)](#cloudflare-turnstile-login-protection)
22. [Backup and Restore](#backup-and-restore)
23. [Web Application Updates](#web-application-updates)
24. [Logging](#logging)
25. [Best Practices](#best-practices)
26. [Troubleshooting](#troubleshooting)

---

## System Users

### Required system users

Two accounts must exist in the global `users` table for the system to function correctly:

#### `admin`

The primary administrator account. Created automatically on first run. Should never be deleted — the Clean Database Backup specifically preserves this account so a freshly-restored server is still loginable.

#### `file_import`

Used as the `created_by` value for work orders created by scheduled file imports.

**Requirements:**
- Username: `file_import`
- Must exist in the global `users` table (not project-specific)
- Can have any subrole (Viewer recommended for least privilege)
- Should not be deleted or renamed

**How to create:**
1. Navigate to **Users** in the sidebar
2. Click **Add User**
3. Set username to `file_import`
4. Assign the **Viewer** subrole
5. Save the user

**Why this is required:**
Work orders have a `created_by` field with a foreign key to `users.username` (`ON DELETE RESTRICT`). Scheduled imports need a valid username for this column. Without the `file_import` user, scheduled imports will fail with a foreign key constraint violation.

---

## Core Status Codes

### Protected status codes

The following work order status codes are considered "core" and have special protections:

| Code | Purpose |
|------|---------|
| **Open** | Default status for new work orders |
| **Closed** | Work order has been closed without completion |
| **Completed** | Work order has been successfully completed |
| **Scheduled** | Work order has been assigned a scheduled date/time |
| **Trouble** | Work order encountered an issue requiring attention |

### Restrictions on core statuses

- **Cannot be deleted** — these status codes cannot be removed from the system.
- **Code cannot be renamed** — the internal code identifier is immutable.
- **Label and Color can be customized** — you can change how the status is displayed.

### Custom status codes

Administrators can create additional status codes beyond the core five:
1. Navigate to **Settings** → **Work Order Status Codes**
2. Click **Add Status Code**
3. Define a unique code, label, and color
4. Mark as default if it should be the starting status for new work orders

> The `status` column on every project's work orders table has a foreign key to `public.work_order_statuses(code)` with `ON DELETE RESTRICT`, so a status code in active use cannot be deleted from the database even if the UI somehow allowed it.

---

## Service Types, System Types, Module Types & Trouble Codes

These are global lookup tables shared by every project, but service types must additionally be **enabled per project** before they can be used.

### Service types

Service types categorize the type of work to be performed (e.g. "Install", "Remove", "Exchange").

- Defined globally in **Settings** → **Service Types**.
- Linked to projects through the `project_service_types` join table.
- A project must have at least one enabled service type before work orders (manual entry, file imports, scheduled imports) can be created. Imports without a `service_type` value will be skipped with an error if more than one service type is enabled; if exactly one is enabled, that one is used as the default.
- Work order rows reference the service type via the `service_type` column, which has a foreign key to `public.service_types(code)` with `ON DELETE RESTRICT` — a service type in use cannot be deleted.

### System types & module types

Global catalogs of meter / radio equipment models. Maintained in **Settings** → **System Types** and **Settings** → **Module Types**. The `old_system_type`, `new_system_type`, `old_module_type`, and `new_module_type` columns on each project's work orders table reference these tables by `product_id` with `ON DELETE RESTRICT`.

### Trouble codes

Reasons a technician could not complete a changeout (e.g. "Cannot Locate Meter", "Customer Refused"). Defined globally in **Settings** → **Trouble Codes**. The `trouble` column on work orders references these by `code` with `ON DELETE RESTRICT`.

---

## Role-Based Access Control (RBAC)

### Subrole system

MeterFlo uses a subrole-driven permission system. Every user is assigned a subrole, which maps to a base role and a set of granular permissions.

### Default subroles

Created automatically on first run:

| Subrole | Base Role | Description |
|---------|-----------|-------------|
| **Administrator** | admin | Full system access — automatically receives every permission. Cannot have permissions removed. |
| **Project Manager** | user | Manage projects and work orders |
| **Field Technician** | user | Create and edit work orders in the field |
| **Viewer** | user | Read-only access to projects and work orders |

### Permission categories

Permissions are grouped into:

- **Navigation** — access to main sidebar items (Dashboard, Projects, Users, etc.)
- **Project Menu** — access to per-project pages (Work Orders, Documents, Import, Calendar, etc.)
- **Settings** — access to individual settings cards
- **Maintenance** — access to backup and restore features
- **Project Actions** — create, edit, copy, or delete projects (`projects.viewInactive` controls visibility of inactive projects)
- **Work Order Actions** — create, edit, assign, or delete work orders
- **User Actions** — manage user accounts

### Custom subroles

Administrators can create custom subroles:
1. Navigate to **Settings** → **Subroles**
2. Click **Add Subrole**
3. Enter a name, key, and description
4. Select the base role (admin, user, or customer)
5. Configure individual permissions for the new subrole

> The **Administrator** subrole always receives any newly added permission automatically — you do not need to grant new permissions to admins after each release.

---

## Project-Based Access Control

In addition to subrole permissions, non-admin users are restricted by their **project assignments**:

- Non-admin users can only see and act on users, user groups, and resources within projects they are assigned to.
- The system uses a three-way intersection check (`caller's projects ∩ group's projects ∩ target user's projects`) to prevent cross-project privilege escalation.
- API responses are filtered to exclude cross-project data for non-admin users.
- **Admins bypass all project-based restrictions.**

To assign a user to a project:
1. **Users** → click the user → **Projects** tab → add the project.
2. Or **Projects** → edit the project → **Assigned Users** section.

---

## Settings Page Reference

The **Settings** page is the main control surface for the whole system. It is laid out as a stack of cards, each card focused on one area of configuration. Three cards have no permission gate and are visible to every signed-in user — **Profile** and **Appearance** sit at the top of the page, and **Security** sits at the very bottom. All other cards are gated by individual permissions and only appear if the current user's subrole grants the matching permission key.

The two subsections below group the cards by visibility (Account vs Administrative). Administrative cards are listed in the order they appear on the page.

### Account cards (always visible)

These three cards have no permission gate and appear for every signed-in user.

#### Profile
Shows the signed-in user's avatar, name, email, and current main role. The **Edit** button opens a dialog for updating first / last name, email, phone, address (street, city, state, zip), and changing the account password.
- Permission: *(none — always visible)*

#### Appearance
Switches the UI between **Light** and **Dark** themes for the current browser. The choice is stored locally in the browser, not on the user account.
- Permission: *(none — always visible)*

#### Security
Confirms the current session and provides a **Log Out** button. Rendered at the very bottom of the Settings page.
- Permission: *(none — always visible)*

### Administrative cards (permission-gated)

These cards only render if the signed-in user's subrole includes the listed permission. Administrators always see all of them.

#### Contact & Support Forms
Sets the destination email addresses for the public **Contact Us** and **Support** forms, plus the SMTP server (host, port, user, from-address, SSL/TLS, certificate validation) used to send those emails. The SMTP password itself is read from the `SMTP_PASSWORD` secret rather than from this form.
- Permission: `settings.contactSupport`

#### Project Files Directory
Configures the root directory used for all project file storage. Files for each project end up under `{root}/{ProjectName}_{ID}/...`. See [File Management](#file-management) and [Multi-Tenancy Architecture](#multi-tenancy-architecture) for the full directory layout.
- Permission: `settings.projectFiles`

#### File Upload Settings
Sets the maximum allowed upload size per file and the comma-separated list of allowed file extensions. An empty extension list allows all file types.
- Permission: `settings.fileUpload`

#### Timezone
Controls the **global** default timezone used in the UI and a master switch for whether timestamps are shown in the local zone or in UTC. Each project can override this with its own zone — see [Project Timezones](#project-timezones).
- Permission: `settings.timezone`

#### Customer API Logs
A read-only viewer for every outbound call MeterFlo has made to a project's customer API. Includes filters by project and success/failure, and an expandable view that shows the request URL, payload, response status, response body, and any error message. See [Customer API Integration](#customer-api-integration) and [`CUSTOMER_API_INTEGRATION.md`](./CUSTOMER_API_INTEGRATION.md) for how to configure outgoing calls.
- Permission: `settings.customerApiLogs`

#### Mobile Application Updates
Configures where the MeterFlo mobile app looks for updates. For Android, set the GitHub Releases API URL the app should poll. For iOS, choose the update source (disabled, App Store with App Store ID, or EAS Updates).
- Permission: `settings.mobileConfig`

#### Web Application Updates
Configures the GitHub Releases API URL the web app should check, runs an on-demand update check, and previews the exact shell command to run on the server to apply an update (with a fallback hard-reset command). The card itself does not run the update — the displayed command must be executed on the server. See [Web Application Updates](#web-application-updates).
- Permission: `settings.webUpdate`

#### Security Settings
Toggles **Cloudflare Turnstile** pre-login bot protection and stores the Turnstile site key and secret. See [Cloudflare Turnstile (Login Protection)](#cloudflare-turnstile-login-protection) for the verification flow and emergency bypass.
- Permission: `settings.security`

#### File Import History
Cross-project log of every one-time and scheduled file import, with the date, source, file name, project, user, status, and imported / failed row counts.
- Permission: `settings.importHistory`

#### External Database Import History
Cross-project log of every external-database import run (the SQL-source equivalent of file imports), with the same date / source / project / status / row-count columns as the file-import log.
- Permission: `settings.dbImportHistory`

#### Work Order Statuses
Manage the global catalog of work order status codes — add custom statuses, change the displayed label and color, and pick which status is the default for new work orders. The five core statuses (Open, Closed, Completed, Scheduled, Trouble) are protected. See [Core Status Codes](#core-status-codes).
- Permission: `settings.statuses`

#### Trouble Codes
Manage the global list of reasons a technician could not complete a changeout (e.g. "Cannot Locate Meter"). These codes are referenced from work orders with `ON DELETE RESTRICT`. See [Trouble codes](#trouble-codes).
- Permission: `settings.troubleCodes`

#### User Groups
Define groups of users and assign projects to those groups. Group members inherit access to every project assigned to the group, which is the easiest way to grant a team access to many projects at once.
- Permission: `settings.userGroups`

#### Access Levels
Manage **subroles** — the named bundles of permissions that drive [Role-Based Access Control (RBAC)](#role-based-access-control-rbac). Create, edit, copy, and delete subroles, and toggle individual permissions per subrole. The four built-in subroles (Administrator, Project Manager, Field Technician, Viewer) cannot be deleted.
- Permission: `settings.accessLevels` *(also visible to any user with the admin main role)*

#### Service Types
Manage the global catalog of service types (e.g. "Water", "Electric", "Gas") that projects can enable. A project must have at least one enabled service type before it can accept work orders. See [Service types](#service-types).
- Permission: `settings.serviceTypes`

#### System Types
Manage the global catalog of meter / system equipment models referenced by work order `old_system_type` and `new_system_type` columns. See [System types & module types](#system-types--module-types).
- Permission: `settings.systemTypes`

#### Module Types
Manage the global catalog of radio / module equipment models referenced by work order `old_module_type` and `new_module_type` columns. See [System types & module types](#system-types--module-types).
- Permission: `settings.moduleTypes`

> Backup and restore controls live on the dedicated **Maintenance** page rather than on Settings — see [Backup and Restore](#backup-and-restore).

---

## Setting Up a New Project

This is the recommended order for setting up a brand-new project from a clean install.

### Prerequisites
- An Administrator account is logged in.
- The two required system users (`admin`, `file_import`) exist (see [System Users](#system-users)).
- At least one **Service Type** is defined in **Settings** → **Service Types**.

### Step 1 — Create the project shell

1. Navigate to **Projects** in the sidebar.
2. Click **Add Project**.
3. Fill in the basic information:
   - **Name** — the display name (also used in the file directory and database schema name).
   - **Description** — optional, free text.
   - **Active** — leave on. Toggle off to hide the project (see [Inactive Projects](#inactive-projects)).
   - **Customer Email**, **Phone**, **Address / City / State / Zip**, **Notes** — optional contact / location metadata.
4. Click **Save**. The system creates:
   - A row in the global `projects` table.
   - A dedicated PostgreSQL schema named `project_{snake_case_project_name}_{project_id}` for this project's work orders.
   - The project's file directory: `Project Files/{ProjectName}_{ID}/` with `Work Orders/`, `Project Documents/`, and `Project FTP Files/` subfolders.

### Step 2 — Assign service types

1. Open the project edit page.
2. In the **Service Types** section, enable each service type that applies to this project.
3. If you only enable one service type, file imports that omit `service_type` will use that type automatically.

### Step 3 — Configure the wizard / workflow

In the **Wizard Configuration** section of the project edit page:

- **Wizard Mode** — choose `Changeout`, `Reading Only`, or `User Choice` (see [Wizard Workflow Modes](#wizard-workflow-modes)).
- **Changeout Equipment Type** — `system`, `module`, `both`, or `user_choice` — what gets changed in changeout mode.
- **Reading Equipment Type** — same options for reading-only mode.
- **Show Before Photos Step** / **Show After Photos Step** — toggle on/off.
- **GPS Mode** — controls whether GPS capture is required, optional, or hidden.
- **Show Notes Step** / **Show Signature Step** — toggle on/off.

### Step 4 — Configure search methods

In the **Search Methods** section, enable how technicians can look up work orders in the mobile wizard:

- **Camera Barcode Scan**
- **Camera QR Code Scan**
- **Manual Entry**
- **Bluetooth HID Scanner**

If only one is enabled, the wizard skips the selection screen and opens directly into that method.

### Step 5 — Configure operational hours (optional)

In the **Operational Hours** section, enable and set:
- **Start Time** and **End Time** (e.g. `08:00`, `17:00`).
- **Operational Days** — pick the days of the week that count as workdays. Stored as full lowercase names (`monday`, `tuesday`, …, `sunday`).
- Add **Holidays** in the Holidays section for project-specific date exclusions.

See [Operational Hours & Holidays](#operational-hours--holidays).

### Step 6 — Set the project timezone (optional)

In the **Timezone** dropdown, pick the project's local timezone. Choices are:

| Display label | Stored value |
|---------------|--------------|
| Use global timezone setting | `__global__` (falls back to system default) |
| Eastern Time (ET) | `America/New_York` |
| Central Time (CT) | `America/Chicago` |
| Mountain Time (MT) | `America/Denver` |
| Arizona (MST – no DST) | `America/Phoenix` |
| Pacific Time (PT) | `America/Los_Angeles` |
| Alaska Time (AKT) | `America/Anchorage` |
| Hawaii Time (HST) | `Pacific/Honolulu` |
| UTC (Coordinated Universal Time) | `UTC` |

### Step 7 — Configure the customer API (optional)

If completed work orders need to be pushed to an external system, fill in the **Customer API Integration** section. Full setup details live in [`CUSTOMER_API_INTEGRATION.md`](./CUSTOMER_API_INTEGRATION.md).

### Step 8 — Assign users

1. Use the **Assigned Users** section on the project edit page to grant non-admin users access.
2. Or add the project to a **User Group** under **Settings** → **User Groups** so all members of that group inherit access.

### Step 9 — Load work orders

Three ways to bring work orders into a project:

1. **Manual entry** — open the project, click **Add Work Order**.
2. **One-time file import** — **Project** → **File Import** → upload a CSV/Excel/JSON file and map columns.
3. **Scheduled FTP import** — see [Scheduled File Imports](#scheduled-file-imports).

> Imports require at least one service type enabled on the project. Customer WO IDs are auto-generated if not provided.

### Step 10 — (Optional) Configure route sheets, file storage, and reports

These work out-of-the-box once the project has work orders, and are accessible from the project sidebar.

---

## Processing a Work Order

This is the field-technician workflow as implemented by the System Changeout Wizard. The exact step list depends on the project's wizard configuration (see [Wizard Workflow Modes](#wizard-workflow-modes)).

### 1. Find the work order

From the **Start Changeout / Reading Capture** dialog, the technician picks one of the enabled search methods:

- Scan a barcode or QR code with the device camera
- Scan with an external Bluetooth HID scanner (input field is read-only to prevent typos)
- Type a search term — work order ID, system ID, module ID, address, or customer ID — into manual entry

If only one search method is enabled, the dialog opens straight into it.

### 2. Mode selection (only in `User Choice` wizard mode)

The technician picks **Changeout** (replace equipment) or **Reading Only** (capture readings without replacing). In `Changeout` or `Reading Only` mode this step is skipped.

### 3. Can you proceed?

The wizard asks **"Can the changeout / reading proceed?"**. The technician answers:

- **Yes – Proceed** — start time is recorded in `work_order_time_tracking`, the wizard moves to the next step.
- **No – Report Issue** — start time is also recorded, and the wizard jumps to **Trouble Capture**.

### 4. Trouble Capture (only on the "No" branch)

The technician picks a trouble code (from the global trouble code list), optionally adds a note, optionally captures trouble photos, and submits. The work order's status becomes `Trouble`. The customer API is **not** called for trouble reports.

### 5. Old reading capture

Captures the existing system reading and/or module reading depending on the configured equipment type. If the work order already has old readings stored, the wizard offers a toggle so the technician can either keep them or capture fresh values.

### 6. Before photos (if enabled)

The technician takes one or more "before" photos using the device camera. Photos are saved into `Project Files/{ProjectName}_{ID}/Work Orders/{customerWoId}/` with filenames like `{customerWoId}-before-1.jpg`, `{customerWoId}-before-2.jpg`, etc.

### 7. Physical change (changeout flow only)

A simple confirmation step that the equipment swap has happened. (Reading-only flows skip this.)

### 8. Capture new system / module ID

The technician scans or types the new equipment IDs. The same set of search methods configured for the lookup applies here. Auto-selection prevents duplicate scanner triggers.

### 9. New reading capture

Captures the initial reading on the new equipment. In Reading Only mode, the new ID is automatically set equal to the old ID since no swap occurred.

### 10. After photos (if enabled)

"After" photos of the installed equipment, saved into the work order folder with filenames like `{customerWoId}-after-1.jpg`, `{customerWoId}-after-2.jpg`, etc.

### 11. GPS (if enabled)

Captures the device's GPS coordinates. Stored on the work order as a single `"lat,lng"` string in `new_gps`.

### 12. Notes (if enabled)

Free-text field notes. Appended to the work order's notes column with a timestamped header (`[Changeout Report - <timestamp>]` or `[Reading Report - <timestamp>]`).

### 13. Signature (if enabled)

Customer signature captured on screen. Saved as `{customerWoId}-signature.png` in the work order folder.

### 14. Confirm & submit

The technician reviews the captured data and submits. The server:

1. Updates the work order's status to `Completed`, persists all readings/IDs, and writes the report header into `notes`.
2. Records the end time in `work_order_time_tracking` (start–end gives the duration shown in the System | Module Details accordion and on the PDF report).
3. Triggers any configured project webhook.
4. Calls the customer API if configured (fire-and-forget — see [`CUSTOMER_API_INTEGRATION.md`](./CUSTOMER_API_INTEGRATION.md)).
5. Emits a Server-Sent Event (SSE) so connected dashboards refresh in real time.

If the wizard is reopened later, a new time-tracking session starts; the most recent session is what gets displayed.

---

## Wizard Workflow Modes

Configured per-project in the **Wizard Configuration** section. Stored on the `projects` table as `wizard_mode`.

| Mode | Internal value | Description |
|------|----------------|-------------|
| **Changeout** | `changeout` | Full meter changeout flow: old reading, before photos, physical change, new ID/reading, after photos, GPS, notes, signature. |
| **Reading Only** | `reading_only` | Simplified flow for capturing readings without replacing equipment. New IDs are auto-set equal to old IDs and saved into the new-reading fields. |
| **User Choice** | `user_choice` | The technician picks Changeout or Reading Only at the start of each work order. |

Each step (Before Photos, After Photos, GPS, Notes, Signature) can be independently shown or hidden via the per-project toggles.

### Equipment type

Independently per mode (`changeout_equipment_type` / `reading_equipment_type`):

| Value | Meaning |
|-------|---------|
| `system` | Capture system data only |
| `module` | Capture module data only |
| `both` | Capture both system and module data |
| `user_choice` | Let the technician pick at the start |

---

## Search Methods (Mobile / Wizard)

Per-project toggles control which search methods are available, both in the **Start Changeout / Reading Capture** dialog and the wizard's New ID capture step:

| Setting | Field |
|---------|-------|
| Camera Barcode Scan | `searchShowBarcodeScan` |
| Camera QR Code Scan | `searchShowQrCodeScan` |
| Manual Entry | `searchShowManualEntry` |
| Bluetooth HID Scanner | `searchShowHidScanner` |

If only one method is enabled, the selection screen is skipped and the wizard opens directly into that method. The HID scanner input is **read-only** to ensure scanned data accuracy.

---

## Operational Hours & Holidays

### Per-project scheduling restrictions

Each project can define operational hours that restrict when work orders may be scheduled.

### Configuration

1. **Projects** → edit project → **Operational Hours**
2. Toggle **Enable Operational Hours**
3. Configure:
   - **Start Time** (e.g. `08:00`)
   - **End Time** (e.g. `17:00`)
   - **Operational Days** — checkboxes for the days of the week. Stored as an array of full lowercase names (`monday`, `tuesday`, `wednesday`, `thursday`, `friday`, `saturday`, `sunday`).

### Holiday exclusions

In the project edit page's **Holidays** section, add specific dates that should be excluded from scheduling. Each holiday is stored in `project_holidays` (`ON DELETE CASCADE` from `projects.id`) and may include an optional name.

### Behavior

- Work orders cannot be scheduled outside operational hours.
- The calendar view greys out non-operational times.
- Drag-and-drop rescheduling on the calendar respects operational hour restrictions.

---

## Project Timezones

Each project can have its own timezone setting that affects how dates and times are displayed and how scheduling boundaries are evaluated.

### Configuration

1. **Projects** → edit project
2. Pick a value in the **Timezone** dropdown (see the [Setting Up a New Project → Step 6](#step-6--set-the-project-timezone-optional) table for the full list of values).

### Behavior

- All times are stored in UTC in the database.
- For display and scheduling boundary checks, times are converted to the project timezone using `date-fns-tz`.
- If the project is set to **Use global timezone setting**, the system falls back to the global timezone configured under **Settings** → **Timezone**.

---

## Inactive Projects

Projects can be marked active or inactive via the **Active** toggle on the project edit page.

- Inactive projects are **hidden** from the sidebar and the Projects page for users without the `projects.viewInactive` permission.
- Users with `projects.viewInactive` see an **"Inactive"** badge and can toggle **"Show Inactive"** to view them.
- Work order **creation and editing** is blocked on inactive projects (HTTP 403).
- Scheduled imports (database and FTP) automatically skip inactive projects.

Useful for archiving completed projects without losing their data.

---

## Copy Project

Users with project-creation permissions can duplicate an existing project via the **Copy Project** button on the project edit page. The copy includes:

- Operational hours, timezone, and holidays
- Wizard configuration (mode, equipment types, step toggles)
- Search method settings
- Customer API configuration (URL, auth type, header name, secret env var name, send-photos flag, enabled flag)
- Service type assignments (the project_service_types links)

The copy does **not** include user assignments or work orders. The new project is named "Copy of {Original Name}" and you are redirected to its edit page.

---

## Scheduled File Imports

### Overview

Scheduled file imports automatically process files from FTP directories on a configurable schedule.

### Prerequisites

1. The `file_import` user exists (see [System Users](#system-users)).
2. The project has at least one service type enabled.
3. An FTP directory is configured for the project.
4. A file import configuration with column mapping exists.

### Configuration steps

1. Navigate to **Project** → **File Import**.
2. Click **Add Import Configuration**.
3. Configure:
   - **Name** — descriptive name.
   - **Delimiter** — comma, semicolon, tab, or pipe.
   - **Has Header** — whether the first row contains column names.
   - **Column Mapping** — map source columns to work order fields.
   - **Schedule** — see frequencies below.
   - **File Pattern** — optional glob (e.g. `*.csv`, `workorders_*.xlsx`).

### Schedule frequency options

These are the only values accepted by the scheduler:

| Frequency value | Cron equivalent | Description |
|-----------------|-----------------|-------------|
| `manual` | (none) | Not scheduled — only runs when triggered manually. |
| `every_15_minutes` | `*/15 * * * *` | Every 15 minutes |
| `every_30_minutes` | `*/30 * * * *` | Every 30 minutes |
| `hourly` | `0 * * * *` | Top of every hour |
| `every_2_hours` | `0 */2 * * *` | Every 2 hours |
| `every_6_hours` | `0 */6 * * *` | Every 6 hours |
| `every_12_hours` | `0 */12 * * *` | Every 12 hours |
| `daily` | `0 0 * * *` | Once per day at midnight |
| `weekly` | `0 0 * * 0` | Once per week (Sunday at midnight) |
| `monthly` | `0 0 1 * *` | Once per month (1st at midnight) |
| `custom` | (your cron expression) | Use the **Custom Cron Expression** field |

> Sub-15-minute polling is intentionally not supported. Use a `custom` cron expression only when necessary; the scheduler validates the expression with `node-cron` before activating.

### File pattern matching

- Leave blank or use `*` to match all files
- `*.csv` — all CSV files
- `workorders_*.xlsx` — Excel files starting with `workorders_`
- `2024-*.csv` — CSV files starting with `2024-`

### Column normalization

The import system normalizes headers to make column matching forgiving:

1. File headers are lowercased and spaces become underscores (e.g. "Customer WO ID" → `customer_wo_id`).
2. Column mapping values are normalized the same way during lookup.
3. An exact match is tried first, then the normalized match.

| Original Header | Normalized |
|-----------------|------------|
| Customer WO ID | `customer_wo_id` |
| Old Meter Number | `old_meter_number` |
| Service Type | `service_type` |
| ADDRESS | `address` |

> Configure column mapping using the exact header names as they appear in your files. The system handles case and spacing differences automatically.

### Auto-defaults during import

- If a row omits `customer_wo_id`, one is auto-generated.
- If a row omits `service_type` and exactly one service type is enabled on the project, that one is used.
- If a row omits `service_type` and multiple service types are enabled, the row is skipped and an error is logged.

### Troubleshooting

If scheduled imports fail:
1. Check the **File Import History** in **Settings**.
2. Verify the `file_import` user exists.
3. Confirm column mapping matches your file headers.
4. Confirm the project is **Active** — inactive projects are skipped.
5. Confirm the project has at least one service type enabled.
6. Check file permissions in the FTP directory.

---

## Multi-Tenancy Architecture

### Database isolation

Each project has its own isolated PostgreSQL schema for work order data.

### Schema naming convention

Project schemas follow the pattern `project_{snake_case_project_name}_{project_id}`.

Example: a project named "CSU Water" with ID 7 lives in schema `project_csu_water_7`.

### What is stored per-project (in the project schema)

- Work orders (the `work_orders` table)

### What is stored globally (in the public schema)

- Users
- Projects metadata
- Project assignments and user groups
- Subroles and permissions
- System settings
- Work order status codes
- Service types (and the `project_service_types` join)
- Trouble codes
- System types and module types
- File import configurations (`file_import_configs`, scoped to a project via the `project_id` column)
- File import history (`file_import_history`)
- Customer API logs
- Work order time tracking

### File storage

Files are stored on disk (not in the database). See [File Management](#file-management) below.

---

## File Management

### Directory structure

Files live under a configurable root directory:

```
Project Files/
  {ProjectName}_{ID}/
    Work Orders/
      {customerWoId}/
        {customerWoId}-before-1.jpg   <- before photos (root, numbered)
        {customerWoId}-after-1.jpg    <- after photos (root, numbered)
        {customerWoId}-signature.png  <- signature
        ...other attachments
    Project Documents/
    Project FTP Files/
```

**Default write pattern:** the wizard saves photos and signatures as plain files at the root of the work-order folder, with filenames containing `-before-`, `-after-`, or `-signature` so the type can be inferred.

**Backwards compatibility:** the customer API photo lookup also tolerates the older `before/`, `after/`, and `signature/` subfolder layout — it checks subfolders first and then falls back to the root-filename patterns above. Existing folders in the older layout will continue to work without migration.

### Configuration

1. **Settings** → **Project Files Directory** — set the root path.
2. The system creates the per-project subdirectories automatically when a project is created.
3. Renaming a project also renames its files folder and database schema.

### File upload limits

Configure under **Settings** → **File Upload Settings**:
- **Maximum File Size** — default 100 MB
- **Allowed Extensions** — comma-separated list (e.g. `jpg,png,pdf,xlsx`)

---

## Database Considerations

### Foreign key constraints (per-project work_orders table)

All FK relationships on each project's `work_orders` table use `ON DELETE RESTRICT ON UPDATE CASCADE`, meaning referenced rows cannot be deleted while a work order references them, but renames cascade.

| Column | References | On Delete |
|--------|------------|-----------|
| `created_by` | `public.users(username)` | RESTRICT |
| `updated_by` | `public.users(username)` | RESTRICT |
| `assigned_user_id` | `public.users(id)` | RESTRICT |
| `assigned_group_id` | `public.user_groups(name)` | RESTRICT |
| `completed_by` | `public.users(id)` | RESTRICT |
| `scheduled_by` | `public.users(id)` | RESTRICT |
| `status` | `public.work_order_statuses(code)` | RESTRICT |
| `service_type` | `public.service_types(code)` | RESTRICT |
| `trouble` | `public.trouble_codes(code)` | RESTRICT |
| `old_system_type` / `new_system_type` | `public.system_types(product_id)` | RESTRICT |
| `old_module_type` / `new_module_type` | `public.module_types(product_id)` | RESTRICT |

### Foreign key constraints (global tables)

| Table | Field | References | On Delete |
|-------|-------|------------|-----------|
| `user_subroles` | `subrole_id` | `subroles.id` | CASCADE |
| `user_projects` | `user_id` | `users.id` | CASCADE |
| `user_projects` | `project_id` | `projects.id` | CASCADE |
| `project_holidays` | `project_id` | `projects.id` | CASCADE |

### Unique constraints

Each project's work orders table enforces unique constraints on `old_system_id`, `new_system_id`, `old_module_id`, and `new_module_id`. Duplicate values are rejected by the database and logged to `error.log`.

### ID-based assignments

Work order assignments use IDs / names rather than free text, which keeps assignments valid even if usernames or group names change:
- `assigned_user_id` — user UUID (`varchar(50)`)
- `assigned_group_id` — user group name (`varchar(100)`, references `user_groups.name`)

---

## Customer API Integration

Projects can be configured to push completed work order data to external customer systems. Each project has its own configuration, supporting `none`, `api_key`, `bearer_token`, and `basic_auth` authentication.

Projects also have an independent **API Import** option for pulling work orders from a customer's HTTP(S) JSON REST API. Excel/text imports and direct database imports remain available. Administrators configure endpoints, server secret-variable names, source-field mappings, record paths, pagination, and optional polling intervals (manual by default; scheduled intervals must be at least 15 minutes).

Use **Test / preview** before **Pull now**. Every row needs a stable customer work-order ID, customer ID/name, address, and valid service code. Readings/identifiers should be strings to preserve exact decimals and leading zeros. The importer creates Open baseline work orders; it does not import completion or new-device capture data.

Create-only is the default and skips matching work-order IDs. Optional safe updates apply only to explicitly selected baseline fields on untouched Open records originally created by API Import. Row-version checks, technician data, notes/reset history, photos/signatures, assignments, scheduling, and time tracking protect existing work. Imported changes never trigger outbound completion delivery.

The project's **API Import → Run history** shows counts and diagnostics, persistent transient retries, cancellation, and interrupted runs. Admins can retry unsuccessful runs with a retained configuration. Disabling a source stops queued retries and cancels ongoing processing at a page boundary. Removing a source retains its imported work orders and history.

Non-admin access to configured previews, Pull Now, and history requires the **`project.apiImport`** permission plus project assignment. Only admins can configure/remove sources, preview unsaved endpoints, or retry failed history. Inbound and outbound enabled settings are independent; this is not unrestricted two-way synchronization.

The full setup, payload, log endpoint, and troubleshooting guide lives in:

→ [`CUSTOMER_API_INTEGRATION.md`](./CUSTOMER_API_INTEGRATION.md)

Logs of every outbound call are visible in **Settings** → **Customer API Logs** (requires the `settings.customerApiLogs` permission).

---

## Real-Time Updates

The web app uses Server-Sent Events (SSE) so dashboards stay current without manual refreshes:

- The server emits events when work orders are created, updated, or deleted, and when files are added or removed.
- Connected clients use `useProjectEvents` / `useGlobalEvents` hooks that automatically invalidate the relevant TanStack Query caches.
- A 20-second heartbeat keeps the connection alive; the client reconnects automatically if disconnected.

There is no admin configuration required — SSE is on by default.

---

## Cloudflare Turnstile (Login Protection)

Optional pre-login bot protection. When enabled, users must complete a Turnstile challenge before reaching the login page. React Native mobile apps bypass the check and authenticate directly.

- Configured under **Settings** → **Security Settings**.
- Successful verification is stored in a signed cookie (`turnstile_verified`, 24-hour expiry), with session storage as a fallback.
- **Emergency bypass:** set environment variable `TURNSTILE_EMERGENCY_BYPASS=true` to disable Turnstile without database access — useful if you get locked out. See [Recovery & Troubleshooting](#recovery--troubleshooting) below.
- **Windows / reverse proxy notes:** ensure `COOKIE_SECURE=true` if serving over HTTPS, and that the proxy forwards cookies. Verification loops usually mean cookies are being dropped — see the troubleshooting note below before assuming Turnstile itself is at fault.

### Recovery & Troubleshooting

If Turnstile is misconfigured (bad site key, bad secret, blocked Cloudflare script, dropped cookies behind a proxy, etc.) every browser-based login can fail and lock administrators out of the system. There are two ways out, and either one is enough on its own.

> **Verification loop?** If users complete the challenge but get sent back to it again immediately, the problem is almost always cookies being dropped between the browser and the server (HTTPS without `COOKIE_SECURE=true`, a reverse proxy not forwarding cookies, or `SameSite` issues). Fix that first before assuming Turnstile is broken. The recovery methods below are for when you genuinely cannot get past the challenge.

#### Method A — Emergency environment-variable bypass

Setting `TURNSTILE_EMERGENCY_BYPASS=true` makes the Turnstile gate / status checks report "no challenge required", regardless of what the database says. The mobile app already bypasses Turnstile, so this only affects the web login.

The Node process reads `process.env` at startup, so **the app must be restarted after changing the variable**. After you regain access and clean the configuration up, remove the variable and restart again so production goes back to normal.

##### Windows server (PM2)

1. Open `ecosystem.config.cjs` in the MeterFlo install folder.
2. In the `env` block of the `meterflo` app, add the variable:

   ```js
   module.exports = {
     apps: [
       {
         name: "meterflo",
         script: "dist/index.js",
         env: {
           NODE_ENV: "production",
           // ... existing variables ...
           TURNSTILE_EMERGENCY_BYPASS: "true",
         },
       },
     ],
   };
   ```
3. Save the file, then restart from an Administrator PowerShell or Command Prompt:

   ```powershell
   pm2 restart meterflo --update-env
   ```

##### Linux server (PM2 or systemd)

If you run MeterFlo with PM2, follow the same steps as the Windows section — edit `ecosystem.config.cjs`, then:

```bash
pm2 restart meterflo --update-env
```

If you run MeterFlo as a `systemd` service, edit the unit file (typically `/etc/systemd/system/meterflo.service`) and add the variable to the `[Service]` section:

```ini
[Service]
Environment=TURNSTILE_EMERGENCY_BYPASS=true
```

Then reload and restart:

```bash
sudo systemctl daemon-reload
sudo systemctl restart meterflo
```

If the service uses an `EnvironmentFile=` instead, add `TURNSTILE_EMERGENCY_BYPASS=true` to that file and run the same `daemon-reload` + `restart` pair.

##### Replit

1. Open the **Secrets** pane in the workspace.
2. Add a new secret with **Key** = `TURNSTILE_EMERGENCY_BYPASS` and **Value** = `true`.
3. Restart the **Start application** workflow so the new value is picked up.

#### Method B — Disable Turnstile directly in the database

The on/off switch for Turnstile is stored as a row in the `public.system_settings` table with `key = 'turnstile_enabled'`. Setting that row's `value` to `'false'` turns Turnstile off immediately on the next request — no app restart is required, and the change persists across deploys.

The exact SQL is the same on every platform:

```sql
UPDATE public.system_settings
SET value = 'false'
WHERE key = 'turnstile_enabled';
```

##### Windows server (pgAdmin)

1. Open **pgAdmin** and connect to the MeterFlo PostgreSQL database.
2. Right-click the database → **Query Tool**.
3. Paste and run the `UPDATE` statement above.
4. Confirm the row count is `1` and commit (pgAdmin commits automatically when the query succeeds).
5. Reload the login page in the browser — the Turnstile challenge should be gone.

##### Linux server (psql or pgAdmin)

Either use pgAdmin exactly as above, or connect with `psql` from the shell:

```bash
psql "$DATABASE_URL" -c "UPDATE public.system_settings SET value='false' WHERE key='turnstile_enabled';"
```

(If the database is on a different host or you do not have `DATABASE_URL` exported, substitute the full connection string.)

##### Replit

1. Open the database query tool from the workspace tools sidebar (or run `psql "$DATABASE_URL"` in the Shell).
2. Run the same `UPDATE` statement shown above.
3. Reload the login page.

#### After you regain access

Once you can sign in, clean up so production stops running in bypass mode:

1. Sign in as `admin`.
2. Go to **Settings** → **Security Settings** and either turn Turnstile off cleanly (toggle and save) or fix the bad site key / secret and confirm a normal login works in a private browser window.
3. If you used Method A (env-var bypass), remove `TURNSTILE_EMERGENCY_BYPASS` from the place you set it (PM2 ecosystem file, systemd unit, or Replit Secrets) and restart the app one more time so the bypass is no longer active.
4. If you used Method B (database edit) and you do want Turnstile on, re-enable it from **Settings** → **Security Settings** rather than flipping the row back manually — the UI also re-checks the site key and secret are present.

---

## Backup and Restore

### Backup types

Four backup types are available, exposed via `GET /api/system/backup?type=<type>` (per-project database and files backups also have their own endpoints under `/api/projects/:projectId/database/backup` and `/api/projects/:projectId/files/backup`):

| Type | Internal value | Contents | Use case |
|------|----------------|----------|----------|
| **Full Database Backup** | `database` | Complete `pg_dump` of every schema (users, projects, work orders, settings — everything). | Full data migration to another server. |
| **Clean Database Backup** | `clean` | Full schema for every table + minimal seed data: subroles, permissions, subrole_permissions, system_settings, work_order_statuses, trouble_codes, service_types. Includes only the `admin` and `file_import` user accounts. Disables Cloudflare Turnstile so you can log in immediately on the fresh server. | Spinning up a fresh server / production replica. Restore to an empty database — no need to run `npm run db:push`. |
| **Web App Files Backup** | `files` | The web application's source files on disk (excludes uploaded user content). | Backing up the deployed application code, e.g. before an update. |
| **Project Files Backup** | `project` | All files under `Project Files/` (photos, signatures, documents, FTP files). | Backing up uploaded content separately from the database. |

### Creating a backup

1. Navigate to **Maintenance** (or **Settings** → **Backup & Restore**).
2. Choose the backup type.
3. Click **Create Backup**.
4. Download the resulting archive when it finishes.

### Restoring from backup

**Preconditions:**
1. You must have Administrator permissions.
2. The archive must match the expected format for the restore operation (the system reads the embedded metadata).
3. For `database` and `clean` restores, the public schema and project schemas will be dropped and recreated as they are restored.

**Restore steps:**
1. **Maintenance** → choose the appropriate restore action.
2. Upload the backup archive.
3. Confirm the restore operation.
4. Wait for the restore to complete; you will be logged out if your own account is replaced.

> **Warning:** Restoring permanently overwrites existing data. The operation cannot be undone. Take a fresh backup before restoring if you need to keep the current data.

### What restore does NOT do

- It does not merge data — it is a full replacement.
- It does not migrate between schema versions; restore the same MeterFlo version that produced the backup.
- A `files` or `project` restore does not touch the database, and a `database` or `clean` restore does not touch on-disk files.

### Backup best practices

1. **Schedule regular backups** — and run one before major changes (updates, restores, schema migrations).
2. **Store backups externally** — download and keep them off the server.
3. **Test restores periodically** — a backup you have not test-restored is not a backup you can rely on.
4. **Keep multiple versions** — not just the latest.
5. For fresh deployments, prefer the **Clean Database Backup** — it gives you a working login without dragging customer data along.

---

## Web Application Updates

MeterFlo includes a built-in update checker that integrates with GitHub releases. It lets administrators see whether a newer version is available and apply updates to a production server.

### Configuration

1. Navigate to **Settings** → **Web Application Updates**.
2. Enter the GitHub releases API URL for your MeterFlo repository:
   ```
   https://api.github.com/repos/YOUR-ORG/YOUR-REPO/releases/latest
   ```
3. Click **Save**.

### Release process

On the development machine:
1. Make and test your code changes.
2. Bump the version in `package.json` (e.g. `1.0.0` → `1.0.1`).
3. Commit and push to GitHub.

On GitHub:
1. Open the repo and click **Releases**.
2. Click **Create a new release** (or **Draft a new release**).
3. Choose a tag matching your version (e.g. `v1.0.1`).
4. Add a release title and notes.
5. Click **Publish release**.

> The repo must have at least one published release for the update check to work. Without one you will see "Repository or release not found."

### Checking for updates

On a production server:
1. **Settings** → **Web Application Updates**.
2. Click **Check for Updates**.
3. If an update is available, you will see the new version number and release notes.
4. Click **Preview Changes** to see which files will be modified.

### Applying an update

1. SSH into the server (or open a terminal on it).
2. `cd` into the MeterFlo application directory:
   - Windows (XAMPP): `cd c:/xampp/htdocs/meterflo`
   - Linux: `cd /var/www/meterflo`
   - macOS: `cd /Applications/XAMPP/htdocs/meterflo`
3. Pull the latest code:
   ```bash
   git pull origin main
   ```
4. Restart the application (Node.js process or service).

> Run `git pull` from the application directory only — running it from the wrong directory will fail or update the wrong project.

### Version numbering

The version lives in `package.json`. Use semantic versioning:

| Change Type | Example | When to use |
|-------------|---------|-------------|
| **Patch** | 1.0.0 → 1.0.1 | Bug fixes, minor corrections |
| **Minor** | 1.0.0 → 1.1.0 | New features, backwards compatible |
| **Major** | 1.0.0 → 2.0.0 | Breaking changes, major redesigns |

### Permissions

- **`settings.webUpdate`** — view configuration, check for updates, preview changes. Granted to Administrator by default.

### Troubleshooting

**"Repository or release not found"**
- Verify the repo exists and is accessible.
- Verify it has at least one published release.
- Check the URL format.

**"GitHub API rate limit exceeded"**
- Unauthenticated GitHub API calls are limited to 60 per hour. Wait an hour or use an authenticated request.

**Update check shows no new version available**
- Verify the running `package.json` version is what you expect.
- Verify the GitHub release tag matches the intended version.

---

## Logging

MeterFlo writes operational errors to a persistent log file for production debugging.

- **Location:** `./logs/` (override with the `LOG_DIR` environment variable).
- **Error log:** `./logs/error.log` — every error with stack trace and contextual data.
- **Info / warn / debug:** console only (not persisted to disk). Set `NODE_ENV=development` to enable debug output.
- **Rotation:** logs rotate automatically when they exceed 10 MB. Rotated files use a timestamp suffix (e.g. `error-2026-01-10T05-00-00-000Z.log`).
- **Format:**

  ```
  [2026-01-10T05:00:00.000Z] [ERROR] Database constraint violation during insert
    Context: { "error": { ... }, "suggestion": "..." }
  ```

For Customer API call logs (different system) see **Settings** → **Customer API Logs** or [`CUSTOMER_API_INTEGRATION.md`](./CUSTOMER_API_INTEGRATION.md).

---

## Best Practices

### Security
- Assign users the minimum permissions necessary for their role.
- Use strong passwords for all user accounts.
- Store API credentials in environment variables, never in code or the database.
- Regularly review user access and remove inactive accounts.
- Keep Cloudflare Turnstile enabled in production unless you have an alternative bot protection layer.

### Data integrity
- Never delete the `file_import` user if you use scheduled imports.
- Avoid renaming the `admin` user.
- Avoid deleting status codes, service types, system/module types, or trouble codes that are in use — the database will reject the delete, but it is friendlier to confirm beforehand.
- Use project-specific timezones for accurate scheduling and reporting.
- Configure operational hours to prevent accidental scheduling errors.

### Performance
- Mark completed projects as **Inactive** rather than keeping them visible.
- Regularly clean up old import files from FTP directories.
- Monitor the **File Import History** for failed imports.
- Use the lowest-frequency schedule that meets your business needs — `every_15_minutes` is the smallest interval offered for a reason.

---

## Troubleshooting

### Common issues

**Scheduled import fails with "Foreign key constraint"**
- Ensure the `file_import` user exists in the Users table.

**Scheduled import silently skips a project**
- Check the project is **Active** — inactive projects are skipped.
- Check the project has at least one service type enabled.

**Work order times display incorrectly**
- Check the project's timezone setting.
- If the project uses **Use global timezone setting**, check the global timezone under **Settings** → **Timezone**.

**Cannot delete a status code / service type / system or module type / trouble code**
- Core status codes can never be deleted.
- Anything currently referenced by a work order is protected by `ON DELETE RESTRICT` and cannot be deleted until the references are cleared.

**File upload fails**
- Check the **Maximum File Size** setting.
- Verify the file extension is in the **Allowed Extensions** list.

**User cannot access a project**
- Verify the user is assigned to the project (directly or through a user group).
- Verify the user's subrole has the necessary permissions.
- If the project is inactive, only users with `projects.viewInactive` will see it.

**Stuck in a Turnstile verification loop**
- Make sure cookies are being forwarded by your reverse proxy.
- On HTTPS servers, set `COOKIE_SECURE=true`.
- Use the `TURNSTILE_EMERGENCY_BYPASS=true` environment variable to disable Turnstile temporarily and recover.

**Real-time dashboard not updating**
- Check the browser console for SSE connection errors.
- Reverse proxies must allow the SSE connection (no buffering, long-lived connection allowed).

---

*Last updated: April 2026*
