# WorkFlow Pro - Work Order Management System

## Overview

WorkFlow Pro is a full-stack work order management application designed for field operations. It provides role-based access control with three user types (admin, user, customer), enabling organizations to create, assign, track, and manage work orders across projects. The system features a modern React frontend with a Node.js/Express backend, using PostgreSQL for data persistence and Replit Auth for authentication.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state caching and synchronization
- **UI Components**: Shadcn/ui component library built on Radix UI primitives
- **Styling**: Tailwind CSS with CSS variables for theming (light/dark mode support)
- **Form Handling**: React Hook Form with Zod validation
- **Build Tool**: Vite with hot module replacement

### Backend Architecture
- **Runtime**: Node.js with Express
- **Language**: TypeScript (ESM modules)
- **API Pattern**: RESTful JSON API with `/api` prefix
- **Authentication**: Replit OpenID Connect (OIDC) with Passport.js
- **Session Management**: Express sessions stored in PostgreSQL via connect-pg-simple

### Data Storage
- **Database**: PostgreSQL with Drizzle ORM
- **Schema Location**: `shared/schema.ts` (shared between client and server)
- **Migrations**: Drizzle Kit with `db:push` command
- **Tables**: users, sessions, projects, workOrders

### Role-Based Access Control (Subrole-Driven Design)
The system uses a unified permission model where **subroles** (access levels) are the primary mechanism for authorization. The main role (`admin`, `user`, `customer`) is now derived from the subrole and used only for portal routing.

**User Types**:
- **Internal User**: Team members with configurable access levels (subroles)
- **Customer**: External customers with limited portal access

**Subroles (Access Levels)**:
- **Administrator**: Full system access with all permissions (auto-sets role to "admin")
- **Project Manager**: `projects.manage`, `projects.view`, `workOrders.create`, `workOrders.edit`, `workOrders.delete`
- **Field Technician**: `projects.view`, `workOrders.create`, `workOrders.edit`
- **Viewer**: `projects.view` (read-only access)

**Auto-Sync Behavior**:
- When a subrole is assigned, the main role is automatically synced based on the subrole's `baseRole` property
- The "Administrator" subrole sets the main role to "admin"
- All other internal user subroles set the main role to "user"
- Existing admin users are automatically migrated to have the Administrator subrole on startup

**Permission Registry System** (shared/permissionRegistry.ts):
The system uses a central permission registry that auto-syncs to the database. New permissions appear in the Access Levels UI automatically once registered.

**Permission Categories**:
- **Navigation** (6): `nav.dashboard`, `nav.projects`, `nav.users`, `nav.maintenance`, `nav.settings`, `nav.searchReports`
- **Project Menu** (5): `project.workOrders`, `project.documents`, `project.import`, `project.ftpFiles`, `project.dbImport`
- **Settings** (11): `settings.projectFiles`, `settings.fileUpload`, `settings.timezone`, `settings.importHistory`, `settings.dbImportHistory`, `settings.accessLevels`, `settings.statuses`, `settings.troubleCodes`, `settings.userGroups`, `settings.serviceTypes`, `settings.meterTypes`
- **Maintenance** (4): `maintenance.projectBackup`, `maintenance.projectRestore`, `maintenance.systemBackup`, `maintenance.systemRestore`
- **Project Actions** (4): `projects.view`, `projects.create`, `projects.edit`, `projects.delete`
- **Work Order Actions** (4): `workOrders.view`, `workOrders.create`, `workOrders.edit`, `workOrders.delete`
- **User Actions** (6): `users.view`, `users.create`, `users.edit`, `users.delete`, `users.lock`, `users.resetPassword`

**Default Subroles with Permissions**:
- **Administrator**: All permissions (full system access)
- **Project Manager**: Navigation, project menu, view/create/edit actions, settings for statuses/trouble codes
- **Field Technician**: Dashboard, work orders view/create/edit, project documents
- **Viewer**: Dashboard, projects.view, workOrders.view (read-only access)

**Database Tables**: `subroles`, `permissions`, `subrole_permissions` (junction table)
**Constants**: `ADMINISTRATOR_SUBROLE_KEY` defined in `shared/schema.ts`
**Storage Methods**: `syncPermissionsFromRegistry()`, `ensureDefaultSubroles()`, `getUserEffectivePermissions()`

### Multi-Tenant Architecture
- **Per-Project Database Schemas**: Each project gets its own PostgreSQL schema (format: `projectName_projectID`) for data isolation
- **User-Project Assignments**: Many-to-many relationship via `user_projects` junction table
- **File Storage**: Configurable root directory with structure `Project Files/projectName_projectID/customerWoId/` (uses customer work order ID for folder names; legacy folders using numeric work order ID are still supported for backward compatibility)
- **System Settings**: Stored in `system_settings` table (includes configurable project files path)

### Project Structure
```
├── client/src/          # React frontend
│   ├── components/      # UI components (Shadcn/ui)
│   ├── hooks/           # Custom React hooks
│   ├── lib/             # Utilities and query client
│   └── pages/           # Route components
│       ├── dashboard.tsx         # Main dashboard with project list
│       ├── projects.tsx          # Admin project management
│       ├── project-work-orders.tsx  # Project-scoped work orders
│       ├── project-import.tsx    # Import work orders (CSV/Excel with delimiter options)
│       ├── project-files.tsx     # Project-level document management
│       ├── work-order-files.tsx  # File management per work order
│       ├── search-reports.tsx    # Advanced search with CSV/Excel/PDF export
│       ├── maintenance.tsx       # Database backup/restore per project
│       ├── users.tsx             # User management (admin only)
│       └── settings.tsx          # System settings (file size, extensions)
├── server/              # Express backend
│   ├── routes.ts        # API route definitions
│   ├── storage.ts       # Main database access layer
│   ├── projectDb.ts     # Per-project schema management + backup/restore
│   ├── fileStorage.ts   # File storage service
│   └── replitAuth.ts    # Authentication setup
├── shared/              # Shared code between client/server
│   └── schema.ts        # Drizzle schema and Zod types
```

### Recent Changes (December 2024)
- **User Management**: Local username/password authentication, user lock/unlock, password reset, last admin protection
- **Inline Create Forms**: Add User and Add Work Order now use inline form views instead of popup dialogs, matching the edit experience
- **Project Files**: Separate file storage for project-level documents (in `_project_documents` subdirectory)
- **Import Feature**: CSV/Excel/JSON import with configurable delimiters (comma, semicolon, tab, pipe), column mapping, header toggle
- **Scheduled File Imports**: FTP directory monitoring with automatic file renaming after processing (adds `_completed_YYYY-MM-DD` suffix)
- **Search & Reports**: Advanced work order search across all projects with CSV/Excel/PDF export
- **Work Orders Page**: Search functionality, sortable column headers, advanced filters (status, service type, date range), and export buttons (CSV, Excel, PDF)
- **Maintenance**: Per-project database backup to JSON and restore functionality
- **File Settings**: Configurable max file size (up to 1GB) and allowed extensions in system settings
- **Work Order Statuses**: Customizable status codes via Settings page (Open, Completed, Scheduled, Skipped by default); stored in `work_order_statuses` table with label, color, and default flag
- **Schema Changes**: Removed priority field from work orders; added updatedBy field to track who last modified a work order (stores user's display name)
- **Audit Fields**: Read-only display of assigned_to, created_by, created_at, updated_by, updated_at, completed_at in work order edit form
- **Filter Preferences**: Users can customize which filter fields are visible on Work Orders, Search & Reports, and Users pages; preferences stored per user per page in `user_filter_preferences` table; uses FilterSelector component similar to ColumnSelector
- **Foreign Key ID Columns**: Added foreign key ID columns to work orders for improved data integrity. Uses dual storage (text + ID columns) for backward compatibility. Includes: service_type_id, status_id, trouble_code_id, old_meter_type_id, new_meter_type_id, assigned_user_id, assigned_group_id, created_by_id, updated_by_id. Resolver methods automatically populate IDs when text values are set. Both columns are kept in sync during create/update operations.
- **ID-Based Filtering**: Work Orders and Search & Reports filters for Assigned To, Assigned Group, Created By, and Updated By now use ID-based matching for more reliable filtering. Assigned To and Assigned Group are now separate filters - Assigned To shows only users, Assigned Group shows only groups. Filters use ID-first matching with fallback to display label for backward compatibility.
- **Referential Integrity with ON DELETE RESTRICT**: All foreign key constraints on work order tables now use ON DELETE RESTRICT instead of SET NULL. This prevents deletion of referenced records (service types, statuses, trouble codes, meter types, users, groups) while they are still associated with work orders. Affected columns: service_type_id, status_id, trouble_code_id, old_meter_type_id, new_meter_type_id, assigned_user_id, assigned_group_id, created_by_id, updated_by_id.
- **Assignment Field Migration**: Removed legacy `assigned_to` text column from database schema. Assignment is now handled by two separate ID-based fields: `assigned_user_id` (references users table) and `assigned_group_id` (references user_groups table). Work order forms use separate dropdowns for user and group assignment. Schema updated in projectDb.ts and shared/schema.ts. Frontend updated in project-work-orders.tsx and search-reports.tsx to display assigned names from IDs.
- **File Storage Folder Naming**: Work order file uploads now create folders named after the customer work order ID (`customer_wo_id`) instead of the internal work order ID. Backward compatibility maintained: if a legacy folder exists (using numeric ID), files continue to be stored there. Implemented in `server/fileStorage.ts` with `legacyWorkOrderId` fallback parameter.
- **Completed Status Validation**: Work orders cannot be set to "Completed" status unless all required fields are filled: Old Meter ID, Old Meter Reading, New Meter ID, New Meter Reading, New GPS, Signature, Signature Name, and Attachments. Validation enforced on both frontend and backend.
- **CompletedAt Automation**: Work orders automatically set `completedAt` timestamp when status changes to "Completed". Uses `isCompletedStatus()` helper that recognizes both status codes (e.g., "02") and status labels (e.g., "Completed") by querying the work_order_statuses table.
- **Subrole-Driven RBAC**: Major refactoring of role-based access control. The main role (`admin`, `user`, `customer`) is now auto-derived from the subrole's `baseRole` property. The "Administrator" subrole automatically sets role to "admin"; all other internal user subroles set role to "user". Users page UI simplified: no direct "Admin" role option; users select "Internal User" or "Customer" as type, then choose access level (subrole). The `getRoleForSubrole()` method accepts a fallback role parameter for users without a subrole assigned.
- **Granular Permission System**: Implemented central permission registry (shared/permissionRegistry.ts) with 36+ granular permissions organized by category. Settings page now checks individual permissions (`settings.projectFiles`, `settings.statuses`, etc.) instead of a single admin role check. Sidebar navigation checks `nav.*` permissions. Project sub-menus check `project.*` permissions. Registry auto-syncs to database on startup.

### Key Design Patterns
- **Storage Interface**: `IStorage` interface in `storage.ts` abstracts database operations, making it testable and swappable
- **Shared Schema**: Database schema and TypeScript types are shared between frontend and backend using `drizzle-zod`
- **Query Key Convention**: React Query uses URL paths as query keys (e.g., `["/api/work-orders"]`)
- **Authentication Guard**: `isAuthenticated` middleware protects API routes; frontend uses `useAuth` hook

## External Dependencies

### Authentication
- **Replit Auth**: OpenID Connect authentication via `openid-client` and Passport.js
- **Session Store**: PostgreSQL-backed sessions using `connect-pg-simple`

### Database
- **PostgreSQL**: Primary database (requires `DATABASE_URL` environment variable)
- **Drizzle ORM**: Type-safe database queries and migrations

### UI/UX Libraries
- **Radix UI**: Accessible component primitives (dialogs, dropdowns, forms, etc.)
- **Lucide React**: Icon library
- **date-fns**: Date formatting and manipulation
- **embla-carousel-react**: Carousel component

### Development
- **Vite**: Frontend build tool with HMR
- **esbuild**: Server bundling for production
- **tsx**: TypeScript execution for development