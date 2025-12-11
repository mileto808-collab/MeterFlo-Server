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

### Role-Based Access Control
- **Admin**: Full access to all features including user management, project creation, data import, and settings
- **User**: Access controlled by subrole (access level) with granular permissions
- **Customer**: Limited view of completed work orders for their assigned project only

### Granular Permission System (Subroles)
Users with the "user" role can be assigned a subrole that determines their specific permissions:
- **Project Manager**: `projects.manage`, `projects.view`, `workOrders.create`, `workOrders.edit`, `workOrders.delete`
- **Field Technician**: `projects.view`, `workOrders.create`, `workOrders.edit`
- **Viewer**: `projects.view` (read-only access)

**Permission Types**:
- `projects.manage` - Create/edit/delete projects
- `projects.view` - View assigned projects
- `workOrders.create` - Create work orders
- `workOrders.edit` - Edit work orders
- `workOrders.delete` - Delete work orders
- `users.manage` - Manage user accounts
- `settings.manage` - Access system settings
- `maintenance.manage` - Access database backup/restore

**Database Tables**: `subroles`, `permissions`, `subrole_permissions` (junction table)

### Multi-Tenant Architecture
- **Per-Project Database Schemas**: Each project gets its own PostgreSQL schema (format: `projectName_projectID`) for data isolation
- **User-Project Assignments**: Many-to-many relationship via `user_projects` junction table
- **File Storage**: Configurable root directory with structure `Project Files/projectName_projectID/workOrderID/`
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
- **Project Files**: Separate file storage for project-level documents (in `_project_documents` subdirectory)
- **Import Feature**: CSV/Excel/JSON import with configurable delimiters (comma, semicolon, tab, pipe), column mapping, header toggle
- **Scheduled File Imports**: FTP directory monitoring with automatic file renaming after processing (adds `_completed_YYYY-MM-DD` suffix)
- **Search & Reports**: Advanced work order search across all projects with CSV/Excel/PDF export
- **Work Orders Page**: Search functionality and sortable column headers for WO ID, Address, Service, Route, Zone, Old Meter, and Status
- **Maintenance**: Per-project database backup to JSON and restore functionality
- **File Settings**: Configurable max file size (up to 1GB) and allowed extensions in system settings
- **Work Order Statuses**: Customizable status codes via Settings page (Open, Completed, Scheduled, Skipped by default); stored in `work_order_statuses` table with label, color, and default flag
- **Schema Changes**: Removed priority field from work orders; added updatedBy field to track who last modified a work order (stores user's display name)
- **Audit Fields**: Read-only display of assigned_to, created_by, created_at, updated_by, updated_at, completed_at in work order edit form

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