# MeterFlo - Utility Meter Work Order Management System

## Overview
Android APK distribution is independent of the native update source and of Replit:
authorized administrators upload and explicitly publish builds for authenticated
Dashboard users. Standalone Windows/Linux installations use protected local storage
(`MOBILE_APK_STORAGE=local`, absolute `MOBILE_APK_LOCAL_DIR`) and existing PostgreSQL
metadata, with no Replit bucket or identity dependency. Only Replit-hosted
deployments use private App Storage for durable binaries; never use their ephemeral
deployment filesystem or silently fall back to it. Keep binary/staging files outside
Git/deployment bundles and back up both the metadata database and selected byte store.
The existing GitHub/iOS mobile update settings and mobile authentication remain unchanged.

MeterFlo is a full-stack utility meter work order management system designed for field operations, offering role-based access control (RBAC) to create, assign, track, and manage meter work orders across projects. It features a modern React frontend, a Node.js/Express backend, PostgreSQL for data persistence, and application-managed username/password authentication. Authentication and session storage are managed by the application and do not depend on Replit or an external identity provider. The system supports multi-tenancy with per-project database schemas, customizable work order statuses, advanced search and reporting capabilities, and robust file management, aiming to streamline field service operations for businesses.

## User Preferences
Preferred communication style: Simple, everyday language.

## System Architecture

### UI/UX Decisions
- **Frontend Framework**: React 18 with TypeScript
- **UI Components**: Shadcn/ui (built on Radix UI)
- **Styling**: Tailwind CSS with theming (light/dark mode)

### Technical Implementations
- **Backend**: Node.js with Express, TypeScript
- **API**: RESTful JSON API (`/api` prefix)
- **Authentication**: Application-managed username/password login, with passwords verified against bcrypt hashes. Passport.js manages authenticated sessions stored in PostgreSQL through `connect-pg-simple`; authentication does not depend on Replit or OpenID Connect.
- **State Management**: TanStack React Query for server state.
- **Form Handling**: React Hook Form with Zod validation.
- **Build Tool**: Vite for frontend, esbuild for backend.
- **Standalone dependency portability**: Keep locked package downloads on verified public addresses while preserving versions/integrity. Internal package-firewall URLs cannot resolve on standalone Windows/Linux; changing npm's registry alone does not repair embedded lockfile URLs. Run `npm run check:dependency-portability` and its staged variant after dependency changes. The build checks distribution files before deleting old output; this does not disable managed install protections. Use `npm ci --include=dev --registry=https://registry.npmjs.org` on standalone servers, and follow the Windows guide's maintenance/recovery procedure.
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Shared `drizzle-zod` schema between client and server.

### Feature Specifications
- **Role-Based Access Control (RBAC)**: Subrole-driven design with granular permissions. Subroles (Administrator, Project Manager, Field Technician, Viewer) determine access levels, automatically mapping to main roles (admin, user, customer). Permissions are managed via a central registry and synced to the database.
- **Project-Based Access Control**: Non-admin users can only view and manage users, user groups, and resources within their assigned projects. The system uses a three-way intersection check (`caller projects ∩ group projects ∩ target user projects`) to prevent cross-project privilege escalation. Admin users bypass all project-based restrictions. API responses are filtered to exclude cross-project data for non-admin users.
- **Multi-Tenancy**:
    - **Database Isolation**: Each project gets its own PostgreSQL schema (e.g., `projectName_projectID`).
    - **File Storage**: Configurable root directory with structure: `Project Files/ProjectName_ID/Work Orders/customerWoId/` for work order attachments, plus `Project Documents/` and `Project FTP Files/` subfolders. Legacy folders are automatically migrated.
- **Work Order Management**: Create, edit, assign, track. Customizable statuses, audit fields (scheduledAt, scheduledBy, completedAt, completedBy), and completion validation. Calendar view with month/week/day views, drag-and-drop rescheduling, and unscheduled work order search panel.
- **Audit History**: Dedicated permission-gated Audit Logs page with verified actors, project-scoped search, exact reading differences and safe before/after values. Tracks application changes and backup/restore/import lifecycle outcomes. Sensitive/unstructured values use changed markers. Separate PostgreSQL history survives ordinary record deletion and application restores; automatic retention is off by default. Audit inventory integrates with Log Maintenance, while cleanup requires separate global audit permissions. Does not reconstruct past activity or monitor external pgAdmin/SQL/scripts. See `AUDIT_LOGS.md`, also available on the Documentation page.
- **System Changeout Workflow**: Dynamic scope selection (Change System, Change Module, Change Both) determines which fields are shown throughout the wizard. Supports flexible old reading capture with toggle switches when existing readings are present. Module and system data are handled independently based on selected scope.
- **Project Reading Precision**: Independent system/module maximum fractional digits (0–6, default 3), configured with `projects.readingPrecision` plus normal project permissions. Web entry validates without truncation; server create/edit/completion and mobile sync enforce current limits while preserving unchanged historical baselines. Startup applies an additive project-settings migration; project APIs expose both settings for the separately maintained mobile app.
- **Configurable Wizard Workflow Modes**: Per-project configuration allows three wizard modes:
  - **Changeout Mode**: Full meter changeout flow with old reading capture, before photos, physical change, new ID/reading capture, after photos, GPS, notes, and signature.
  - **Reading Only Mode**: Simplified flow for capturing readings without equipment change. Readings are saved to new reading fields, and new IDs are automatically set equal to old IDs.
  - **User Choice Mode**: Field technicians select their workflow at the start of each work order (changeout or reading only).
  Step visibility (GPS, Notes, Before Photos, After Photos, Signature) is configurable per-project via the Wizard Configuration section in Project settings.
- **Operational Hours**: Per-project scheduling restrictions with configurable start/end times, operational days (Mon-Sun), and holiday exclusions. Per-project timezone support with fallback to global timezone setting. Uses `date-fns-tz` for deterministic timezone conversion.
- **User Management**: Role assignment via subroles, user lock/unlock, password reset.
- **Project Management**: Project creation, editing, and per-project database backup/restore.
- **File Management**: Project-level and work order-specific file uploads, secure storage, and folder renaming on project updates.
- **Import/Export**: CSV/Excel/JSON import with configurable delimiters and column mapping. Advanced search and reports with CSV/Excel/PDF export. Both manual and scheduled imports auto-generate customer_wo_id if not provided and use the project's default service type when only one is configured. Imports require at least one service type configured for the project; if multiple service types exist and none is provided in the data, the row is skipped with an error.
- **Route Sheets**: Generate printable PDF route sheets with barcodes or QR codes encoding old meter numbers. Available in both Work Orders and Search & Reports pages.
- **Scheduled Imports**: FTP directory monitoring for automated file processing.
- **System Settings**: Configurable max file size, allowed extensions, and work order statuses.
- **Filter Preferences**: User-customizable filter visibility for work orders, search, and user pages.
- **Data Integrity**: Foreign key constraints with `ON DELETE RESTRICT` for critical relationships. ID-based assignment for users and groups.
- **Real-Time Updates**: SSE-based live updates eliminate manual browser refreshes. Server-side event emitter broadcasts work order changes to connected clients. Client hooks (`useProjectEvents`, `useGlobalEvents`) automatically invalidate TanStack Query cache on events. 30-second heartbeat with automatic reconnection.
- **Customer API Integration**: Per-project outbound REST delivery of completion and trouble-report data, with credentials in server environment variables and optional image/signature encoding. A transactional PostgreSQL outbox survives restarts, retries failed deliveries in bounded backoff cycles, and supports admin retry and per-attempt troubleshooting in Settings → Customer API Logs. See `CUSTOMER_API_INTEGRATION.md` for the payload and delivery contract.
- **Customer API Pull Import**: Independent per-project JSON REST GET sources supplement file/database uploads. Admin-managed mappings, authenticated server-side fetches, bounded pagination, read-only previews, optional persisted interval polling, retries, and diagnostic history are available through API Import. Stable customer IDs prevent duplicates; create-only is default, and opt-in baseline updates require untouched API-created Open records with matching row versions. Import writes cannot generate outbound completion deliveries. Non-admin use requires `project.apiImport` and project assignment.
- **Cloudflare Turnstile Web Verification**: Optional web-page gate requiring a security challenge before displaying the web login form when verification is required. Admin-configurable via Settings > Security Settings. The shared `POST /api/auth/local/login` endpoint does not enforce Turnstile; mobile authentication remains unchanged, and direct API clients can submit credentials without a challenge. This is not server-side protection against automated password attempts. Adding that protection requires a coordinated, securely authorized mobile exemption rather than spoofable client headers.
  - **Public Home and Separate Login**: Signed-out `/` displays marketing content and a Log In button, never a login form or an automatic Turnstile redirect. `/login` checks server verification and redirects to `/turnstile` only when required; verified/disabled/bypassed browsers proceed directly. Legacy `/auth` links enter the same flow. Login submission rechecks verification expiry, success returns to the authenticated dashboard, and completed logout returns Home. Security Settings presents the dedicated pre-login flow; legacy inline challenge-point values are handled compatibly.
  - **Verification Storage**: Uses a signed cookie (`turnstile_verified`) with 24-hour expiry. Falls back to session storage if cookie unavailable. Cookie-based approach is more reliable across reverse proxies.
  - **Emergency Bypass**: Set environment variable `TURNSTILE_EMERGENCY_BYPASS=true` to disable Turnstile verification without database access. Useful for recovery if locked out due to misconfiguration.
  - **HTTP Session Recovery**: `EMERGENCY_HTTP_LOGIN=true` temporarily overrides `COOKIE_SECURE` so session cookies can travel over HTTP for all users, without bypassing passwords, account locks, expiry, roles or Turnstile. Signed-in administrators see a persistent warning. Restrict to a trusted local/private connection, correct HTTPS/cookie configuration, set the flag to `false` in the effective service environment and restart, then clear recovery-era cookies. See `deploy/WINDOWS_DEPLOYMENT.md`, Section 12, “Temporary HTTP login recovery.” This does not require Replit.
  - **Windows Server Deployment**: Ensure `COOKIE_SECURE=true` if using HTTPS. The reverse proxy must forward cookies correctly. If verification loops occur, check that cookies are being sent with requests.
  - **Deployment Configuration**: Copy the tracked `deploy/ecosystem.config.example.cjs` to the ignored local `deploy/ecosystem.config.cjs`; it derives install-root paths and permits only `NODE_ENV=production` in PM2 configuration. The application loads root `.env`; inherited service variables take precedence. Put host/port/cookie/recovery settings and credentials in the protected environment, never PM2 config/arguments. Run `npm run check:deployment-secrets` and the staged variant before committing; audit findings/rotation limits are in `deploy/SECRET_AUDIT.md`. Existing private config is not automatically migrated.
- **Work Order Time Tracking**: Measures field technician work duration on each work order. Start time is captured when the user confirms they can proceed ("Yes - Proceed") or report an issue ("No - Report Issue") in the wizard. End time is captured when the work order is successfully submitted. Time tracking data is stored in the `work_order_time_tracking` table in the public schema. Displayed in the System | Module Details accordion with start time, end time, and calculated duration. Also included in the PDF report. If the wizard is reopened, a new time tracking session begins (most recent session is displayed).
- **Copy Project**: Users with project creation permissions can duplicate an existing project with all its settings (operational hours, timezone, wizard configuration, customer API settings, holidays) via a "Copy Project" button on the project edit page. The copied project is named "Copy of [Original Name]" and the user is redirected to edit it. User assignments and work orders are NOT copied.
- **Inactive Projects**: Projects can be marked as active/inactive via a toggle on the project edit page. Inactive projects are hidden from the sidebar and Projects page for users without `projects.viewInactive` permission. Users with the permission see an "Inactive" badge on inactive projects and can toggle "Show Inactive" to view them. Work order creation/editing is blocked on inactive projects with a 403 error. Scheduled imports (database and FTP) automatically skip inactive projects.
- **Search Method Configuration**: Per-project settings to control which work order search methods are available in the Start Changeout/Reading Capture dialog and the wizard's ID capture steps. Four configurable options:
  - **Camera Barcode Scan**: Use device camera to scan 1D barcodes
  - **Camera QR Code Scan**: Use device camera to scan QR codes
  - **Manual Entry**: Search by typing work order ID, system ID, module ID, address, or customer ID
  - **Bluetooth HID Scanner**: Use an external Bluetooth barcode/QR scanner device with read-only input field
  When only one search method is enabled, the dialog/wizard opens directly to that method without showing a selection screen. The HID scanner input is read-only to ensure scanned data accuracy and prevent manual editing.
  - **Wizard ID Capture**: The same search methods apply to the New System/Module ID capture step in the changeout wizard. Auto-selection uses a ref-based approach (`lastAutoSelectedTarget`) to prevent redundant scanner triggers after successful capture. Clearing a captured ID resets the auto-selection state to allow re-entry.
- **System Backup/Restore**: Two backup types available:
  - **Full Database Backup**: Complete pg_dump of all users, projects, work orders, and settings. For full data migration.
  - **Clean Database Backup**: Full schema + configuration data for fresh server deployments.
    - **Includes**: Full database schema (all tables) + configuration data
    - **Configuration data**: subroles, permissions, subrole_permissions, system_settings, work_order_statuses, trouble_codes, service_types
    - **Users**: Admin and file_import accounts only (two-pass INSERT with NULL subrole_id, then UPDATE)
    - **Disables**: Cloudflare Turnstile (for easy login on fresh server)
    - **Restore to**: Empty database (no need to run `npm run db:push` or migrations)
    - Does NOT include: projects, work orders, other users, user groups, system/module types, import history

### System Design Choices
- **Storage Interface**: `IStorage` interface abstracts database operations.
- **Shared Schema**: Centralized `shared/schema.ts` for database schema and types.
- **Query Key Convention**: React Query uses URL paths for query keys.
- **Authentication Guard**: Middleware for API route protection, `useAuth` hook for frontend.

## External Dependencies

### Authentication
- **Local username/password authentication**: Application-managed login with bcrypt password hashes and Passport.js session handling.
- **connect-pg-simple**: PostgreSQL session store for Express sessions.
- Authentication does not require Replit Auth, OpenID Connect, or a Replit-specific identity provider.

### Database
- **PostgreSQL**
- **Drizzle ORM**

### UI/UX Libraries
- **Radix UI**: Accessible component primitives
- **Lucide React**: Icon library
- **date-fns**: Date manipulation
- **embla-carousel-react**: Carousel component

### Development Tools
- **Vite**: Frontend build tool
- **esbuild**: Server bundling
- **tsx**: TypeScript execution

## Logging System

### Log Files
The application uses persistent file-based logging for production debugging:

- **Location**: `./logs/` directory (configurable via `LOG_DIR` environment variable)
- **Error Log**: `./logs/error.log` - Contains all errors with stack traces and context
- Info, warn, and debug messages are output to console only (not persisted to file)

### Log Rotation
- Logs automatically rotate when they exceed 10MB
- Rotated files are named with timestamps (e.g., `error-2026-01-10T05-00-00-000Z.log`)

### Log Format
```
[2026-01-10T05:00:00.000Z] [ERROR] Database constraint violation during insert
  Context: {
    "error": {
      "name": "Error",
      "message": "duplicate key value violates unique constraint...",
      "stack": "..."
    },
    "suggestion": "Check for duplicate system/module IDs in the data"
  }
```

### Environment Variables
- `LOG_DIR`: Override default log directory (default: `./logs`)
- `NODE_ENV`: Set to `development` to enable debug logging

### Data Integrity Constraints
- **Unique System/Module IDs**: Each project enforces unique constraints on `old_system_id`, `new_system_id`, `old_module_id`, and `new_module_id` columns. Duplicate values will be rejected by the database and logged to `error.log`.