# System Administration Guide

## Project inventory control

Inventory is an optional per-project feature managed through the project form and registered Inventory role permissions. It supports physical/vehicle warehouses, scanned serialized and quantity-based stock, vendor purchase orders, transfers, kits, cycle counts, quarantined returns and work-order reservations/consumption. See [INVENTORY.md](INVENTORY.md) / **Documentation > Project Inventory Control** for field examples, posting permissions and operational procedures.

Before enabling a project, provision warehouses/access and catalog data, review saved import mappings, and grant technicians the required inventory view/assign permissions. Before disabling, resolve reservations and unfinished stock operations. New inventory tables are included in database backups; include project files to back up item images. Restores cannot merge inventory blindly or discard consumed-stock relationships.

## Customer-owned core updates

See **Documentation → Customer Core Updates & Extensions** (`CUSTOMER_CORE_UPDATES.md`)
for ownership boundaries, instance manifest fields, the report SDK example,
permissions, staged standalone activation and customer-owned Replit publishing.
Update previews do not offer a hard-reset fallback. Preserve customer data/configuration;
unavailable or incompatible releases are blockers, not proof that an instance is current.

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
A viewer for outbound deliveries and their attempts, including automatic retry status, admin retry actions, filters, and expandable request/response/error details. Project-filtered delivery activity is also available under **Customer API → Push delivery**. Inbound history is separate under **Customer API → Pull import**. See [Customer API Integration](#customer-api-integration) and the [Customer API guide](/documentation?doc=customer-api) for configuration and troubleshooting.
- Permission: `settings.customerApiLogs`

#### Mobile Application Updates
Configures where the MeterFlo mobile app looks for updates. For Android, set the GitHub Releases API URL the app should poll. For iOS, choose the update source (disabled, App Store with App Store ID, or EAS Updates).
- Permission: `settings.mobileConfig`

##### Android APK Releases and dashboard downloads

In **Settings → Mobile Application Updates → Android APK Releases**, an administrator
can upload Android builds and explicitly publish the one users should download.
This is instance-wide distribution, not a per-project attachment.

**Access:** the existing **Mobile App Configuration** permission
(`settings.mobileConfig`) controls listing/history, uploading, publishing, deleting,
and storage cleanup on both the page and API. Administrators have access by default.
To delegate it, use **Users → Access Levels**, grant the permission and Settings
navigation access to the user's access level, and assign that access level.
The grant is checked again on each upload step and before finalization/publication.
All signed-in roles, including technicians and customers, can see and download the
latest published APK on their Dashboard without this management permission.
Anonymous visitors cannot fetch release metadata or bytes.

| Field or action | Example | How to use it |
| --- | --- | --- |
| APK file | `MeterFlo-2.4.0.apk` | Select a trusted **base APK**, not an AAB, split APK, text file, or generic ZIP renamed to `.apk`. Maximum **512 MiB (536,870,912 bytes)**. Use an ASCII filename starting with a letter/digit; spaces, dots, hyphens, underscores and parentheses are accepted, but paths and special characters are not. |
| Version | `2.4.0` | Required display label, 1–64 characters. Enter the actual app version from your build. This label is administrator-supplied, not extracted or verified against the manifest. |
| Android build/version code | `240` | Optional integer from **1 to 2,100,000,000**. Leave blank if unknown. Match your Android `versionCode`; this value is also administrator-supplied and does not change the APK itself. |
| Release notes | `Fixes offline sync; install before Monday's shift.` | Optional, at most 5,000 characters. Users see these notes on the Dashboard. Do not put credentials or private customer data here. |
| Upload APK | Click after filling the fields | Uploads in bounded 5 MiB chunks with progress. Wait for success; the release is then **unpublished**. It does not replace the Dashboard download until you explicitly publish it. After an error, correct the cause and retry from the selected file. |
| Publish / set latest | Publish `2.4.0` | Makes this completed release the single latest release atomically. Publishing `2.3.9` later deliberately makes that release latest; filenames and version labels are not automatically sorted. Concurrent publishes are serialized. |
| Download | Download the listed APK | Opens an authenticated same-origin browser attachment download, without loading the whole APK into JavaScript memory. Management users can inspect unpublished/older builds; ordinary users can download only the current published release. |
| Delete | Delete an obsolete `2.3.9` build | Confirm removal. To delete the **latest** release, explicitly confirm withdrawal or publish a replacement first. Withdrawal leaves the Dashboard with **no published release**; no older build is silently promoted. |
| Retry storage cleanup | Retry after restoring disk/bucket access | Removed releases cannot be advertised or downloaded even if physical file cleanup fails. A visible pending-cleanup notice remains until cleanup succeeds. The retry also clears expired uploads. Automatic cleanup runs at startup and every five minutes. |

The history shows version, build code, uploaded date, filename, size, notes, and the
latest marker. The Dashboard shows the latest version, published date, notes, and
**Download APK**. Pages refresh on focus and poll every minute. Loading, no published
release, session/permission failures, and storage errors are separate states with
retry controls. A stale download is checked before opening; refresh if the release
was replaced or withdrawn. Transfers already started cannot be recalled.

**Validation and trust:** the server verifies bounded ZIP structure, safe and unique
entry names, expansion limits, all entry CRCs/sizes, Android binary manifest structure
and base `classes.dex` header, then records SHA-256. These are structural/integrity
checks—not malware scanning, APK signature validation, device compatibility, or
proof that the entered version/build code matches the APK. Only distribute builds
from your trusted signing/build process. For upgrades, retain the same application
ID and signing certificate and use a higher embedded Android version code.

**Installing:** on Android, open the downloaded APK, allow “Install unknown apps”
for the browser/file manager if permitted by your organization, and follow Android's
installation prompts. This website does not install automatically. If Android
rejects an upgrade, check application ID, signing certificate, embedded version
code, device requirements, and device-management policy. Revoke the temporary
unknown-app permission after installation if required.

**Storage and deployment:**

- **Replit:** APK bytes and staging chunks use private **App Storage**, not the
  published app's temporary filesystem. In the editor, open **App Storage → Create
  new bucket**, enter a name, and create the bucket. Attach/use that bucket in this
  app. Its ID is available from the bucket's **Settings** view; optionally pin it
  using `MOBILE_APK_BUCKET_ID`. Set `MOBILE_APK_STORAGE=app_storage` if an explicit
  provider is needed. The SDK authenticates through the hosted runtime; no Replit
  login or credential value is added to the application login flow. If no accessible
  bucket exists, Settings reports storage unavailable and disables uploads rather
  than pretending the filesystem is durable. Restart after changing service
  configuration. Local storage is rejected on published Replit deployments.
  If no bucket ID is pinned, releases use the app's default bucket; keep that
  default unchanged across restores, or perform an explicit storage migration.
- **Standalone Windows:** set `MOBILE_APK_STORAGE=local` and, for example,
  `MOBILE_APK_LOCAL_DIR=C:\MeterFloData\Mobile APK Releases` in the private `.env`
  or approved service environment. Grant the Node/PM2 service account read/write
  access. This is independent of Replit and does not initialize hosted credentials.
- **Standalone Linux:** use `MOBILE_APK_STORAGE=local` and, for example,
  `MOBILE_APK_LOCAL_DIR=/var/lib/meterflo/mobile-apks`; create/protect the directory
  for the service account. The path must be absolute. Do not expose it through a
  static web server.
- When not specified, standalone local storage uses **Project Files Directory /
  Mobile APK Releases**. A protected data directory **outside the Git checkout** and
  Apache document root is recommended so code-update/clean scripts cannot erase it.
  Individual records retain their original provider/location; changing the current
  root or bucket is **not** a migration of existing releases.

Metadata/publication state and upload ownership live in PostgreSQL. Startup performs
an additive, repeatable table initialization; the normal dependency-install/update
process does not erase release records or bytes. Upload sessions expire one hour
after initialization, are owner-bound, and are limited to three pending sessions per
user / twenty per instance. Temporary local assembly files are deleted after each
attempt. Provider failures do not trigger an alternate-storage fallback.

**Backups:** back up PostgreSQL **and** the release directory or App Storage bucket;
database-only backups do not contain APK bytes. Preserve the configured
provider/location and service access on restore. Cross-platform or cross-bucket
transfers need an explicit byte/metadata migration or fresh uploads; a database
restore alone does not make another host's release files available. Keep APKs,
staging chunks and test fixtures out of Git and deployment bundles. `.env.example`
contains safe configuration examples, never credentials.

**Native app update behavior is unchanged.** Dashboard APK downloads are manual
distribution. They do not modify the existing GitHub Android update URL, iOS update
options, or the `mobileConfig` returned by `/api/users/:id/projects`. An Expo app
does not automatically discover these uploads without a separate native-app update.

#### Web Application Updates
Checks the approved core source configured in the customer workspace instance manifest. The legacy GitHub Releases API URL remains saved but does not override that source. Preview displays compatibility/local-change blockers and, when safe, a candidate-staging command; there is no destructive fallback. The card does not activate or publish updates. See [Web Application Updates](#web-application-updates).
- Permission: `settings.webUpdate`

#### Security Settings
Toggles the **Cloudflare Turnstile** web-page verification gate and stores the Turnstile site key and secret. This does not enforce Turnstile on direct credential API requests. See [Cloudflare Turnstile (Login Protection)](#cloudflare-turnstile-login-protection) for the verification flow, security limitation, and emergency bypass.
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

Create the project, then open its **Customer API** menu item. **Push delivery** configures the receiving endpoint, authentication and image preference for completed/trouble outcomes; **Pull import** configures independent inbound work-order sources. Project create/edit links to this canonical page instead of maintaining duplicate controls. Existing settings are preserved. Full setup details and examples live in the [Customer API guide](/documentation?doc=customer-api#push-delivery-field-reference).

### Step 8 — Assign users

1. Use the **Assigned Users** section on the project edit page to grant non-admin users access.
2. Or add the project to a **User Group** under **Settings** → **User Groups** so all members of that group inherit access.

### Step 9 — Load work orders

Work-order loading options include:

1. **Manual entry** — open the project, click **Add Work Order**.
2. **One-time file import** — **Project** → **File Import** → upload a CSV/Excel/JSON file and map columns.
3. **Scheduled FTP import** — see [Scheduled File Imports](#scheduled-file-imports).
4. **Customer API → Pull import** — pull from a customer's HTTP(S) JSON REST feed; see [Customer API Integration](#customer-api-integration) and the detailed [API Import field reference](/documentation?doc=customer-api#api-import-field-reference).

> Configure the project's eligible service types first. Unlike file-import ID/default handling, API Import requires an explicit stable customer work-order ID and service code on every row; it never generates an ID or infers a missing service type.

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

The technician picks a trouble code (from the global trouble code list), optionally adds a note, optionally captures trouble photos, and submits. The work order's status becomes `Trouble`. If outbound Customer API delivery is enabled, that saved outcome queues an asynchronous customer delivery; inbound pull configuration is independent.

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
4. Queues persistent asynchronous outbound delivery if enabled, with automatic retries and administrator troubleshooting/retry actions — see the [Customer API guide](/documentation?doc=customer-api).
5. Emits a Server-Sent Event (SSE) so connected dashboards refresh in real time.

If the wizard is reopened later, a new time-tracking session starts; the most recent session is what gets displayed.

---

### Exact reading text and leading zeros

Web reading forms preserve the entered text for all old/new system and module
readings. For example, `00001.0012`, `00000`, and `00023.000000` retain their
leading and trailing zeros when saved and reopened. The numeric database
columns remain available for compatibility; separate original-text values are
added automatically when the server starts on Replit, Windows, or Linux.
The application's database role needs permission to migrate its project
tables; migration failures are reported rather than silently losing formatting.

Work-order displays, edits, wizard prefill, print reports, customer deliveries,
and exports use the exact text. Resetting with **Clear captured data** clears
both forms of the new readings and logs the prior exact values in Notes.
**Keep captured data** retains them; old-equipment baseline readings remain.
Project JSON backups retain the text and restore it with the numeric data.

Records saved before this change use the database's numeric string as fallback.
Zeros already discarded cannot be recovered, so the app does not add guessed
padding. For imports, supply readings as text. XLSX exports use string cells;
CSV contains the exact strings, but spreadsheet programs may auto-convert
them on opening—import reading columns as **Text**, or use the XLSX export.

### Project reading precision

In **Projects → Create/Edit Project → Wizard Configuration → Reading Precision**, configure separate
**System reading** and **Module reading** maximum decimal places. Administrators
have **Configure reading precision** (`projects.readingPrecision`) by default.
To delegate this setting, grant that permission in the normal access-level
permission editor together with project create/edit access; non-admins must
also be assigned to a project to change its limits. Users without the permission
can see effective limits but cannot change them.

Only applicable precision controls are shown. **Changeout Only** uses Changeout
Equipment Type; **Reading Only** uses Reading Equipment Type. **User Choice**
shows the combined equipment allowed by both workflows. System-only shows just
system precision; module-only shows just module precision; both or equipment
user-choice keeps both available. Changing the scope hides unused limits without
erasing them.

Manual work-order creation, details, and editing follow the same equipment scope
for old/new IDs, types, and readings. GPS and customer information remain common
to both equipment types. Hidden existing equipment data is preserved; it is not
cleared by an unrelated manual save.

**Print PDF** follows this same effective project equipment scope, including the
union of scopes in User Choice workflow mode. Historical/imported IDs, types,
and readings for hidden equipment are not printed or erased. Only populated,
applicable old/new equipment columns are printed; GPS remains available even
when there is no visible equipment data. Customer information, notes, signatures,
time tracking, and the existing photo options remain unchanged.

Each visible selector offers 0 through 6. New/existing unconfigured projects default to
3 for each. For example, set system=0 and module=6 for whole-number system
registers and six-digit module registers. Copy Project inherits both source
limits, including an explicit 0.

| Option | Use | Valid reading | Over-limit reading |
|--------|-----|---------------|--------------------|
| 0 | Whole numbers | `123` | `123.1` |
| 1 | Tenths | `123.4` | `123.45` |
| 2 | Hundredths | `123.45` | `123.456` |
| 3 | Thousandths; default | `123.456` | `123.4567` |
| 4 | Four fractional digits | `123.4567` | `123.45678` |
| 5 | Five fractional digits | `123.45678` | `123.456789` |
| 6 | Six fractional digits | `123.456789` | `123.4567890` |

Limits apply to newly captured/changed old and new readings of the matching
equipment type, in changeout, reading-only, and user-choice workflows. They do
not pad readings; shorter fractions and whole numbers, including 0, remain
valid. With a 0 limit, enter `123`, not `123.0`. Wizard inputs prevent over-limit
typing or paste: the previous value stays unchanged, without a precision error
for the rejected attempt. Readings are never silently rounded or truncated.
Existing/imported baseline and historical
values are not rewritten merely because the limit changes; an unrelated edit
can retain an unchanged historical reading.

The server enforces current limits on web writes, mobile completion, and mobile
batch uploads. An offline capture made under an older limit may be rejected
after reconnection. Correct/reconfirm the reading or have an authorized operator
correct the project setting; forcing a sync conflict overwrite does not bypass
precision validation. The separate mobile app must consume the settings described
in the mobile synchronization guide.

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

Open a project's **Customer API** sidebar item for **Push delivery** and **Pull import**. These independently enabled sections are the canonical setup location; project create/edit links here after project creation. Existing `/projects/<id>/api-import` bookmarks continue to open the importer.

Push sends completed/readings/trouble outcomes and captured data to the customer's endpoint. Its six settings are **Enable outbound delivery**, **Customer endpoint URL**, **Authentication**, conditional **API key header name**, conditional **Server environment variable name**, and **Include field images**. For example, use `https://api.customer.example/v1/completions`, select **Bearer token**, enter variable name `CUSTOMER_API_TOKEN` after configuring that variable on the independent server, choose the image preference, enable, and **Save push settings**. Incomplete disabled drafts can be saved; enabled saves validate HTTP(S), header/variable-name syntax and server credential availability. No actual credential value is stored in the form or returned by the API.

**Customer-side image handling:** when **Include field images** is on, available image bytes are base64 inside the same JSON POST—not separate uploads or public download URLs. The customer must validate/decode the bytes, store them against the work order, and serve them through its own authorized application. Compatibility before/after/signature fields can repeat `photos` entries; saved signatures can also appear separately. Prepared retries preserve the original images. Give the customer's developer the [field-image receiver instructions and runnable example](/documentation?doc=customer-api#receiving-and-storing-field-images), including duplicate protection, durable acceptance, size limits and troubleshooting, before enabling images for a production integration.

No authentication requires no variable; API key header defaults to `X-API-Key` (or enter the customer's header such as `X-Customer-Key`); Bearer uses the token alone as the variable value; Basic uses `username:password` in the variable. Images include before/after/trouble/signature/other categories. Turning them off omits image bytes but preserves attachment filenames/signature name. Previously prepared retry payloads are unchanged. All six fields and every option have examples and instructions in the [Push delivery field reference](/documentation?doc=customer-api#push-delivery-field-reference).

Push settings require `projects.edit`; non-admins must be project-assigned. `settings.customerApiLogs` alone allows read-only settings/activity, not editing. Pull-only access never grants push editing. Delivery activity is filtered to this project, exposes attempts/errors, and retains administrator-only retry actions. POST/JSON, the 30-second timeout and five-attempt cycle (1, 5, 15 and 60-minute retries) are fixed, not omitted settings. Enabling does not backfill older completions or enable pull sources.

Projects also have an independent **Pull import** section for pulling work orders from a customer's HTTP(S) JSON REST API. Excel/text imports and direct database imports remain available. Administrators configure endpoints, server secret-variable names, source-field mappings, record paths, pagination, and optional polling intervals (manual by default; scheduled intervals must be at least 15 minutes).

For the complete field-by-field reference, use **Documentation → Customer API Integration** or open the [API Import field reference](/documentation?doc=customer-api#api-import-field-reference). It follows the Add/Edit form, including all four authentication methods, required mappings and every target/update checkbox, JSON filters, watermarks, all pagination options, schedule/enablement, and copyable mock configurations. Each field/option includes a practical example, accepted values, defaults, and instructions. See [complete examples](/documentation?doc=customer-api#complete-configurations-and-pagination-examples) and [operator actions](/documentation?doc=customer-api#operator-actions-and-examples).

Start with Schedule `0`, choose **Add API source**, then **Test & preview unsaved settings → Create source → Pull now**. Configure credential values in the environment of the actual Windows/Linux service account running MeterFlo and enter only their variable names in the form; inbound settings are not copied from outbound delivery. For Cursor/Next URL, the current form hides page-size controls: set them while Page number is selected before switching strategies.

**Current limitation:** saving/toggling a source can reset its saved cursor/watermark, even for an enable/disable change. Do not rely on pause/resume keeping incremental checkpoints; the next new pull can reread earlier records safely through stable IDs and protected updates. See the detailed guide's checkpoint-reset warning.

Use **Test / preview** before **Pull now**. Every row needs a stable customer work-order ID, customer ID/name, address, and valid service code. Readings/identifiers should be strings to preserve exact decimals and leading zeros. The importer creates Open baseline work orders; it does not import completion or new-device capture data.

Create-only is the default and skips matching work-order IDs. Optional safe updates apply only to explicitly selected baseline fields on untouched Open records originally created by API Import. Row-version checks, technician data, notes/reset history, photos/signatures, assignments, scheduling, and time tracking protect existing work. Imported changes never trigger outbound completion delivery.

The project's **API Import → Run history** shows counts and diagnostics, persistent transient retries, cancellation, and interrupted runs. Admins can retry unsuccessful runs with a retained configuration. Disabling a source stops queued retries and cancels ongoing processing at a page boundary. Removing a source retains its imported work orders and history.

Non-admin access to configured previews, Pull Now, and history requires the **`project.apiImport`** permission plus project assignment. Only admins can configure/remove sources, preview unsaved endpoints, or retry failed history. Inbound and outbound enabled settings are independent; this is not unrestricted two-way synchronization.

The full setup, payload, log endpoint, and troubleshooting guide lives in:

→ [Customer API Integration](/documentation?doc=customer-api)

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

Optional verification gate for the web login page. When enabled and verification is required, browser navigation requires a Turnstile challenge before displaying the login form. React Native mobile authentication remains unchanged and authenticates directly.

**Security limitation:** the web pages check the server's verification status, but the shared `POST /api/auth/local/login` endpoint does **not** enforce Turnstile verification. Direct HTTP clients can submit credentials without completing the challenge. Valid account credentials are still required, but this page gate must not be treated as server-side protection against automated password attempts. Enforcing that protection requires a coordinated authentication change that can securely distinguish exempt mobile clients; the current mobile contract has deliberately been retained.

- **Home first:** signed-out visitors to `/` see the public Home page without a login form or automatic security redirect. Feature links, Contact Us, and theme controls remain public.
- **Log In:** select the Home page's **Log In** button. With verification required, the flow is **Home → Security verification (`/turnstile`) → Login (`/login`)**. With Turnstile disabled or the emergency bypass active, the button leads directly to Login. Browsers with a valid previous verification also proceed directly to Login.
- **Separate Login page:** enter your username and password on `/login`, not on Home. Use **Back to Home** to leave without signing in. Direct visits and refreshes check server verification before displaying the form; submission checks again in case verification expired while the form was open. Legacy `/auth` links lead to the same login flow.
- **Logout:** both the sidebar and Settings **Log Out** controls complete logout and return to Home, without automatically opening Turnstile. Successful sign-in retains the normal authenticated dashboard destination. Logout does not deliberately revoke a still-valid separate Turnstile cookie, so a repeat login may skip the challenge within its existing lifetime.
- **Challenge Point:** Security Settings now describes the fixed **Home → Security verification → Login** flow instead of offering an inline challenge option. Previously saved `login` challenge-point values use the separate verification page too; saving Security Settings writes `turnstile`, without deleting keys or changing the enabled toggle.
- **Failures:** unavailable or malformed status/configuration responses, missing site keys, blocked challenge scripts, verification errors, and failure to confirm verification show an error with retry and a route back Home. They do not silently open the login form. Configuration and verification requests have bounded waits; retry after checking the connection or ask the administrator to correct configuration using the recovery instructions below.
- Configured under **Settings** → **Security Settings**.
- Successful verification is stored in a signed cookie (`turnstile_verified`, 24-hour expiry), with session storage as a fallback.
- **Emergency bypass:** set environment variable `TURNSTILE_EMERGENCY_BYPASS=true` to disable Turnstile without database access — useful if you get locked out. See [Recovery & Troubleshooting](#recovery--troubleshooting) below.
- **Windows / reverse proxy notes:** ensure `COOKIE_SECURE=true` if serving over HTTPS, and that the proxy forwards cookies. Verification loops usually mean cookies are being dropped — see the troubleshooting note below before assuming Turnstile itself is at fault.

### Recovery & Troubleshooting

If Turnstile is misconfigured (bad site key, bad secret, blocked Cloudflare script, dropped cookies behind a proxy, etc.) every browser-based login can fail and lock administrators out of the system. There are two ways out, and either one is enough on its own.

> **Verification loop?** If users complete the challenge but get sent back to it again immediately, the problem is almost always cookies being dropped between the browser and the server (HTTPS without `COOKIE_SECURE=true`, a reverse proxy not forwarding cookies, or `SameSite` issues). Fix that first before assuming Turnstile is broken. The recovery methods below are for when you genuinely cannot get past the challenge.

#### Method A — Emergency environment-variable bypass

Setting `TURNSTILE_EMERGENCY_BYPASS=true` makes the Turnstile gate / status checks report "no challenge required", regardless of what the database says. The mobile app already bypasses Turnstile, so this only affects the web login.

**Session-cookie lockout is separate:** if `COOKIE_SECURE=true` prevents login over HTTP, a server operator can temporarily set `EMERGENCY_HTTP_LOGIN=true` and restart MeterFlo. This server-wide override permits HTTP session cookies for all users; it does not bypass passwords, locked accounts, session expiry, roles or Turnstile. An administrator warning remains visible while active. Use a trusted local/private connection, correct HTTPS/`COOKIE_SECURE`, set the override to `false` in the effective service environment, restart and clear recovery-era browser cookies. See the [complete HTTP login recovery instructions](/documentation?doc=windows-deployment#temporary-http-login-recovery) for PM2/environment precedence and verification.

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

Legacy JSON full-system database restores apply public tables, project work orders and inventory in one transaction. A failed project or database row rolls back the database changes; incomplete snapshots are rejected before data replacement. Fresh project schemas are prepared first, so empty schemas/schema migrations and advanced sequence counters can remain after a failure. Inventory backups preserve original work-order IDs (including deleted-ID gaps) and require **Clear existing data** when replacing nonempty projects.

New JSON system backups include service/system/module catalogs and their project assignments. Older archives that omitted these tables can restore only if the referenced status, trouble, service and equipment codes already exist on the destination; missing prerequisites are rejected before replacement. Omitted lookup catalogs are retained, rather than cleared.

Files are not part of that database transaction. If database restoration succeeds but files fail, Maintenance reports **System Restore Incomplete**. Review server logs and restore the missing files before resuming work; do not assume the database was rolled back. Direct and chunked uploads use the same replacement choice and outcome reporting. Local audit history and the authenticated initiating operator survive the database restore. If audit hook verification fails after the database commits, the response explicitly reports the committed database and incomplete restore; repair auditing before resuming work.

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

MeterFlo checks numbered releases from the approved MeterFlo core source, independent
of the customer's Git origin. Git-backed instances verify tags and compatibility;
published instances without Git can receive notices from a public approved GitHub
release feed. Private/non-GitHub sources require workspace access.

### Configuration

1. Navigate to **Settings** → **Web Application Updates**.
2. Configure `meterflo.instance.json` in the customer's workspace with the approved
   HTTPS `coreSource`, verified schema revision and separately owned extension packages.
   See `CUSTOMER_CORE_UPDATES.md` for field examples. The legacy Releases API URL remains:
   ```
   https://api.github.com/repos/YOUR-ORG/YOUR-REPO/releases/latest
   ```
3. Saving the legacy URL does not configure or replace the approved core source.
   Prepare/build the customer-composed workspace before publishing it.

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
3. If an approved update is available, the checker shows its candidate version.
4. Click **Preview Changes** to review changed filenames and compatibility blockers.
   Git-backed previews fetch references only and do not modify the working tree.

### Applying an update

Follow `CUSTOMER_CORE_UPDATES.md`: reconcile direct core edits first, prepare a
separate pinned candidate, test the customer-composed build, review schema readiness
and confirm backups. Use explicit same-schema PM2 activation on standalone instances,
or update/test the customer-owned workspace and explicitly republish on Replit.
The checker never applies SQL, resets the workspace, stops the service or publishes.

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

## Log Maintenance

Open **Maintenance → Log maintenance**. Administrators have access by default.
To delegate this globally, grant a subrole **Navigation → Maintenance** and
**Maintenance → Log Management** in Settings → User Groups / subroles. This
permission allows permanent history cleanup and retention changes across all
projects, not only the user's assigned projects. Ordinary users cannot call the
maintenance endpoints without it.

### Inventory and protected records

Each inventory card shows record/file count, estimated bytes, protected count,
and oldest/newest timestamp. **Refresh** reloads this information without
changing settings or deleting anything. File dates use modification time;
database dates use the original attempt/run start time.

| Category | What can be cleaned | What stays protected |
| --- | --- | --- |
| Archived error reports | MeterFlo `error-<UTC timestamp>[-suffix].log` archives in `LOG_DIR` | Other filenames, symlinks, hard links and files outside the trusted directory |
| Active error reports | Explicit manual selection truncates `error.log` in place | Automatic cleanup never truncates the active log |
| Customer API attempt history | Old attempts attached to a delivered queue record; successful legacy attempts without a delivery record | Pending, processing, retrying, paused or failed deliveries' attempts; unsuccessful legacy attempts; orphaned attempts with an unknown delivery |
| API imports | Completed successful (`succeeded`) runs that are not the latest run for their source | Latest diagnostics and all queued, running, retrying, failed, partial, interrupted or cancelled runs |
| Database imports | Completed `success` runs with no failed records, excluding the latest run for their configuration | Latest runs, incomplete runs and unsuccessful history |
| File imports | Completed `success` runs with no failed records, excluding the latest run for a scheduled configuration; successful manual imports | Latest scheduled runs, incomplete and unsuccessful history |

Delivery queue records, snapshots, payloads (including image data), work orders,
Notes, attachments, import configuration, recovery checkpoints, cursors,
watermarks and version/deduplication records are **never deleted by this feature**.
The separate protected-payload byte estimate is not a cleanup target. Resolve
delivery/import failures to reduce growing protected history; plan database
capacity for retained application data.

### Retention settings and examples

| Setting | Default / allowed values | How to use it |
| --- | --- | --- |
| Automatic cleanup | **Off** / On or Off | Leave Off for preview-and-confirm cleanup only. Turn On and Save policy to allow hourly bounded cleanup of eligible history and archives; active `error.log` stays untouched. Saving does not immediately delete anything. |
| Rotation size (MiB) | **10**, whole numbers **1–100** | Example: `20` rotates the app's active error log on a subsequent write when its existing size exceeds 20 MiB. Applies even when automatic deletion is Off. A single large entry can exceed the threshold until the next write. |
| Archive retention (days) | **30**, whole numbers **1–3650** | Example: `14` makes archives modified more than 14 days ago eligible for hourly deletion when automatic cleanup is On. |
| Archive budget (MiB) | **200**, whole numbers **10–10000** | Example: `500` removes the oldest archives first when their combined size exceeds 500 MiB, even if they are younger than the archive-day setting. Active/external logs are excluded. |
| History retention (days) | **90**, whole numbers **1–3650** | Example: `180` cleans eligible database history whose attempt/run started more than 180 days ago; recovery-protected history is excluded regardless of age. |
| Save policy | Explicit action | Validate and persist the settings. Example: save `Off, 10, 30, 200, 90` to retain manual-only deletion. Saving invalidates prior cleanup previews and records the actor in recent history. |

Settings survive restart. Cleanup runs once an hour after the server starts, with
at most **500 files/rows combined per pass**. History cleanup also has a
15-second work budget, with bounded row-lock/query waits. Remaining eligible items wait for
later passes. Age/budget limits are retention targets, not hard disk-capacity
guarantees. Multiple server processes serialize cleanup and policy saves with a
database lock. Other processes refresh their rotation threshold on the hourly
tick. An invalid saved policy stops automatic deletion until corrected.

### Manual cleanup: preview, cancel and confirm

1. **Log categories:** select one or more categories. Example: Customer API
   attempt history and API imports. Active error reports is never preselected;
   choose it only if you intentionally want to discard the current error file.
2. **Project (optional):** All projects / global is the default. Example: select
   North District to limit database history to that project. File logs are
   global, so a project filter and file categories cannot be combined.
3. **Delete records older than:** choose a local date/time. Example:
   `2026-07-01 00:00` selects records strictly before that cutoff; the UI sends
   its UTC equivalent. Future cutoffs are rejected. This manual date is
   independent of automatic retention and can remove newer eligible history.
4. **Preview cleanup:** creates an actor-bound, 10-minute preview containing up
   to 500 candidate items. Nothing is deleted. The preview reports count,
   estimated bytes, expiry and whether another batch will be needed.
5. **Review irreversible cleanup:** inspect the confirmation before proceeding.
   **Cancel** closes it without deleting anything. Back up troubleshooting
   evidence you need before choosing **Permanently clean selected logs**:
   deleted request/response history and error messages cannot be recovered in
   the app. Queue payloads remain, but deleted attempt diagnostics do not.
6. Review **Recent cleanup history** for the actual removed/skipped counts,
   estimated bytes, actor identifier, timestamp and safe error descriptions.
   Items changed/locked since preview are skipped; retry from a fresh preview.
   Filesystem/database failures are reported, not claimed as successful cleanup.

Previews expire on restart, policy changes or successful use. In a multi-process
deployment, route preview and confirmation to the same process (sticky routing).
Only the latest 20 cleanup attempts/policy changes are retained. An entry marked
“Cleanup started; completion has not yet been recorded” indicates an interrupted
operation; inspect storage and preview again, rather than assuming it completed.

### Storage and operator limits

Database byte totals are estimates, not free-disk measurements. Deleting rows
makes PostgreSQL space reusable through normal vacuum/autovacuum; it does **not**
promise an immediate reduction in database file size. This feature never runs
`VACUUM FULL`. It does not expose raw logs or add downloads.

PM2 stdout/stderr, proxy and operating-system logs are explicitly outside this
feature. For Windows/PM2 operator steps, see the deployment guide's **Log
maintenance and external log rotation** section. Monitor these independently.
`LOG_DIR` must be a real writable directory without symlinks in its path; only
allowlisted regular files with a single hard link are managed. Inspection stops
at 10,000 directory entries rather than performing unbounded filesystem work.

## Audit Logs

MeterFlo records permission-gated application audit history, separate from
diagnostic logs. Open **Audit Logs** in the sidebar. Grant `audit.view` through
**Settings → Access Levels** for assigned-project history; `audit.viewAllProjects`
adds global/all-project history. `audit.manageRetention` additionally permits
global expiration with preview/confirmation and requires both view permissions.
Automatic audit deletion defaults off.

Events include verified actors, committed field changes and backup/restore/import
outcomes. Reading differences preserve exact captured text. Sensitive content is
redacted. Auditing starts with this deployment; it does not monitor external
pgAdmin/SQL/scripts. Application restores preserve local audit history in the
separate PostgreSQL `meterflo_audit` schema.

See [MeterFlo Audit Logs](AUDIT_LOGS.md) for coverage, field examples, permissions,
scope, retention, interrupted operations, privacy and standalone deployment.

*Last updated: October 2026*
