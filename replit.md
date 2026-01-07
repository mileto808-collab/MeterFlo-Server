# MeterFlo - Utility Meter Work Order Management System

## Overview
MeterFlo is a full-stack utility meter work order management system designed for field operations, offering role-based access control (RBAC) to create, assign, track, and manage meter work orders across projects. It features a modern React frontend, a Node.js/Express backend, PostgreSQL for data persistence, and Replit Auth for secure authentication. The system supports multi-tenancy with per-project database schemas, customizable work order statuses, advanced search and reporting capabilities, and robust file management, aiming to streamline field service operations for businesses.

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
- **Authentication**: Replit OpenID Connect (OIDC) via Passport.js, with session management in PostgreSQL.
- **State Management**: TanStack React Query for server state.
- **Form Handling**: React Hook Form with Zod validation.
- **Build Tool**: Vite for frontend, esbuild for backend.
- **Database**: PostgreSQL with Drizzle ORM.
- **Schema**: Shared `drizzle-zod` schema between client and server.

### Feature Specifications
- **Role-Based Access Control (RBAC)**: Subrole-driven design with granular permissions. Subroles (Administrator, Project Manager, Field Technician, Viewer) determine access levels, automatically mapping to main roles (admin, user, customer). Permissions are managed via a central registry and synced to the database.
- **Multi-Tenancy**:
    - **Database Isolation**: Each project gets its own PostgreSQL schema (e.g., `projectName_projectID`).
    - **File Storage**: Configurable root directory with structure: `Project Files/ProjectName_ID/Work Orders/customerWoId/` for work order attachments, plus `Project Documents/` and `Project FTP Files/` subfolders. Legacy folders are automatically migrated.
- **Work Order Management**: Create, edit, assign, track. Customizable statuses, audit fields (scheduledAt, scheduledBy, completedAt, completedBy), and completion validation. Calendar view with month/week/day views, drag-and-drop rescheduling, and unscheduled work order search panel.
- **Operational Hours**: Per-project scheduling restrictions with configurable start/end times, operational days (Mon-Sun), and holiday exclusions. Per-project timezone support with fallback to global timezone setting. Uses `date-fns-tz` for deterministic timezone conversion.
- **User Management**: Role assignment via subroles, user lock/unlock, password reset.
- **Project Management**: Project creation, editing, and per-project database backup/restore.
- **File Management**: Project-level and work order-specific file uploads, secure storage, and folder renaming on project updates.
- **Import/Export**: CSV/Excel/JSON import with configurable delimiters and column mapping. Advanced search and reports with CSV/Excel/PDF export.
- **Route Sheets**: Generate printable PDF route sheets with barcodes or QR codes encoding old meter numbers. Available in both Work Orders and Search & Reports pages.
- **Scheduled Imports**: FTP directory monitoring for automated file processing.
- **System Settings**: Configurable max file size, allowed extensions, and work order statuses.
- **Filter Preferences**: User-customizable filter visibility for work orders, search, and user pages.
- **Data Integrity**: Foreign key constraints with `ON DELETE RESTRICT` for critical relationships. ID-based assignment for users and groups.
- **Real-Time Updates**: SSE-based live updates eliminate manual browser refreshes. Server-side event emitter broadcasts work order changes to connected clients. Client hooks (`useProjectEvents`, `useGlobalEvents`) automatically invalidate TanStack Query cache on events. 30-second heartbeat with automatic reconnection.
- **Customer API Integration**: Outbound REST API to push completed work order data to customer backend systems. Per-project configuration with support for multiple auth types (API key, bearer token, basic auth). Credentials stored as environment variables for security. Optional base64 photo encoding for before/after images and signatures. All API calls logged in `customer_api_logs` table for debugging.

### System Design Choices
- **Storage Interface**: `IStorage` interface abstracts database operations.
- **Shared Schema**: Centralized `shared/schema.ts` for database schema and types.
- **Query Key Convention**: React Query uses URL paths for query keys.
- **Authentication Guard**: Middleware for API route protection, `useAuth` hook for frontend.

## External Dependencies

### Authentication
- **Replit Auth**: OpenID Connect
- **connect-pg-simple**: PostgreSQL session store

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