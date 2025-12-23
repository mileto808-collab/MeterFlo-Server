# WorkFlow Pro - Work Order Management System

## Overview
WorkFlow Pro is a full-stack work order management system designed for field operations, offering role-based access control (RBAC) to create, assign, track, and manage work orders across projects. It features a modern React frontend, a Node.js/Express backend, PostgreSQL for data persistence, and Replit Auth for secure authentication. The system supports multi-tenancy with per-project database schemas, customizable work order statuses, advanced search and reporting capabilities, and robust file management, aiming to streamline field service operations for businesses.

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
    - **File Storage**: Configurable root directory with project-specific file structures.
- **Work Order Management**: Create, edit, assign, track. Customizable statuses, audit fields, and completion validation.
- **User Management**: Role assignment via subroles, user lock/unlock, password reset.
- **Project Management**: Project creation, editing, and per-project database backup/restore.
- **File Management**: Project-level and work order-specific file uploads, secure storage, and folder renaming on project updates.
- **Import/Export**: CSV/Excel/JSON import with configurable delimiters and column mapping. Advanced search and reports with CSV/Excel/PDF export.
- **Scheduled Imports**: FTP directory monitoring for automated file processing.
- **System Settings**: Configurable max file size, allowed extensions, and work order statuses.
- **Filter Preferences**: User-customizable filter visibility for work orders, search, and user pages.
- **Data Integrity**: Foreign key constraints with `ON DELETE RESTRICT` for critical relationships. ID-based assignment for users and groups.

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