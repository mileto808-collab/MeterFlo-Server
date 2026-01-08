# System Administration Guide

This guide covers the operational requirements, business logic, and configuration guidelines for MeterFlo administrators.

---

## Table of Contents

1. [System Users](#system-users)
2. [Core Status Codes](#core-status-codes)
3. [Service Types](#service-types)
4. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
5. [Scheduled File Imports](#scheduled-file-imports)
6. [Operational Hours](#operational-hours)
7. [Project Timezones](#project-timezones)
8. [Multi-Tenancy Architecture](#multi-tenancy-architecture)
9. [File Management](#file-management)
10. [Database Considerations](#database-considerations)
11. [Customer API Integration](#customer-api-integration)
12. [Backup and Restore](#backup-and-restore)
13. [Web Application Updates](#web-application-updates)

---

## System Users

### Required System Users

The following system users must exist in the global users table for certain features to function correctly:

#### `file_import` User

**Purpose:** Used as the `createdBy` value for work orders created by scheduled file imports.

**Requirements:**
- Username: `file_import`
- Must exist in the global `users` table (not project-specific)
- Can have any role (Viewer recommended for security)
- Should not be deleted or renamed

**How to Create:**
1. Navigate to **Users** in the sidebar
2. Click **Add User**
3. Set username to `file_import`
4. Assign the **Viewer** subrole (lowest access level)
5. Save the user

**Why This Is Required:**
Work orders have a `createdBy` field with a foreign key constraint to the `users` table. Scheduled imports need a valid username for this field. Without the `file_import` user, scheduled imports will fail with a foreign key constraint violation.

---

## Core Status Codes

### Protected Status Codes

The following work order status codes are considered "core" and have special protections:

| Code | Purpose |
|------|---------|
| **Open** | Default status for new work orders |
| **Closed** | Work order has been closed without completion |
| **Completed** | Work order has been successfully completed |
| **Scheduled** | Work order has been assigned a scheduled date/time |
| **Trouble** | Work order encountered an issue requiring attention |

### Restrictions on Core Statuses

- **Cannot be deleted** - These status codes cannot be removed from the system
- **Code cannot be renamed** - The internal code identifier cannot be changed
- **Label and Color can be customized** - You can change how the status is displayed

### Custom Status Codes

Administrators can create additional status codes beyond the core five:
1. Navigate to **Settings** > **Work Order Status Codes**
2. Click **Add Status Code**
3. Define a unique code, label, and color
4. Mark as default if it should be the starting status for new work orders

---

## Service Types

### Managing Service Types

Service types categorize the type of work to be performed (e.g., "Install", "Remove", "Exchange").

**Best Practices:**
- Create descriptive service type names
- Assign distinct colors for visual differentiation
- Consider your field technicians when naming types

**Creating Service Types:**
1. Navigate to **Settings** > **Service Types**
2. Click **Add Service Type**
3. Enter a name and select a color
4. Save

### Service Type Retention Policy

**Important Considerations:**
- Service types can be deleted from the system settings
- Work orders store service type as a **text field**, not a reference
- Deleting a service type does **not** affect existing work orders
- Existing work orders will continue to display the service type name as it was when assigned

**Recommended Approach:**
1. Avoid deleting service types that have been used on work orders
2. If a service type is no longer needed, consider renaming it or marking it clearly as "Deprecated"
3. The system does not prevent deletion, so exercise caution

**Color-Coded Display:**
Service types use a predefined color palette for consistent visual identification:
- Blue, Green, Orange, Red, Yellow, Purple, Gray
- Colors are displayed as outline badges with colored text
- Select colors that provide good contrast and are easy to distinguish

---

## Role-Based Access Control (RBAC)

### Subrole System

MeterFlo uses a subrole-driven permission system. Users are assigned a subrole, which determines their permissions.

### Default Subroles

| Subrole | Base Role | Description |
|---------|-----------|-------------|
| **Administrator** | admin | Full system access with all permissions |
| **Project Manager** | user | Manage projects and work orders |
| **Field Technician** | user | Create and edit work orders in the field |
| **Viewer** | user | Read-only access to projects and work orders |

### Permission Categories

Permissions are organized into the following categories:

- **Navigation** - Access to main sidebar items (Dashboard, Projects, Users, etc.)
- **Project Menu** - Access to items under each project (Work Orders, Documents, Import, etc.)
- **Settings** - Access to individual settings cards
- **Maintenance** - Access to backup and restore features
- **Project Actions** - Ability to create, edit, or delete projects
- **Work Order Actions** - Ability to create, edit, assign, or delete work orders
- **User Actions** - Ability to manage user accounts

### Custom Subroles

Administrators can create custom subroles:
1. Navigate to **Settings** > **Subroles**
2. Click **Add Subrole**
3. Enter a name, key, and description
4. Select the base role (admin, user, or customer)
5. Configure permissions for the new subrole

**Important:** The **Administrator** subrole automatically receives all permissions and cannot have permissions removed.

---

## Scheduled File Imports

### Overview

Scheduled file imports automatically process files from FTP directories on a configurable schedule.

### Prerequisites

1. **Create the `file_import` user** (see [System Users](#system-users) section)
2. Configure an FTP directory for the project
3. Set up a file import configuration with column mapping

### Configuration Steps

1. Navigate to **Project** > **File Import**
2. Click **Add Import Configuration**
3. Configure:
   - **Name** - Descriptive name for this configuration
   - **Delimiter** - CSV delimiter character (comma, semicolon, tab, pipe)
   - **Has Header** - Whether the first row contains column names
   - **Column Mapping** - Map source columns to work order fields
   - **Schedule** - How often to check for new files
   - **File Pattern** - Optional glob pattern to match specific files (e.g., `*.csv`, `workorders_*.xlsx`)

### File Pattern Matching

- Leave blank or use `*` to match all files
- Use glob patterns for specific matching:
  - `*.csv` - All CSV files
  - `workorders_*.xlsx` - Excel files starting with "workorders_"
  - `2024-*.csv` - CSV files starting with "2024-"

### Schedule Frequency Options

Available scheduling frequencies:

| Frequency | Description |
|-----------|-------------|
| Every 5 minutes | High-frequency polling |
| Every 15 minutes | Moderate frequency |
| Every 30 minutes | Standard frequency |
| Hourly | Once per hour |
| Every 2 hours | Low frequency |
| Every 6 hours | Very low frequency |
| Daily | Once per day |
| Weekly | Once per week |
| Custom | Define a custom cron expression |

**Note:** Higher frequencies (5-15 minutes) increase server load. Use only when near-real-time imports are required.

### Column Normalization

The import system uses automatic column normalization to handle header variations:

**How It Works:**
1. File headers are normalized to lowercase with underscores (e.g., "Customer WO ID" becomes "customer_wo_id")
2. Column mapping values are also normalized during lookup
3. Exact match is attempted first, then normalized match

**Example Normalization:**
| Original Header | Normalized |
|-----------------|------------|
| Customer WO ID | customer_wo_id |
| Old Meter Number | old_meter_number |
| Service Type | service_type |
| ADDRESS | address |

**Best Practice:** When configuring column mapping, select the exact header names as they appear in your files. The system handles case and spacing differences automatically.

### Troubleshooting

If scheduled imports fail:
1. Check the **File Import History** in Settings
2. Verify the `file_import` user exists
3. Confirm column mapping matches your file headers
4. Check file permissions in the FTP directory
5. Review error details in the import history for specific column issues

---

## Operational Hours

### Per-Project Scheduling Restrictions

Each project can define operational hours to restrict when work orders can be scheduled.

### Configuration

1. Navigate to **Projects** > [Select Project] > **Edit Project**
2. Enable **Operational Hours**
3. Configure:
   - **Start Time** - When the workday begins (e.g., 08:00)
   - **End Time** - When the workday ends (e.g., 17:00)
   - **Operational Days** - Which days of the week are operational (Mon-Sun)

### Holiday Exclusions

Projects can define holidays when scheduling is not allowed:
1. In the project settings, navigate to **Holidays**
2. Add dates that should be excluded from scheduling
3. Optionally provide a holiday name for reference

### Behavior

- Work orders cannot be scheduled outside operational hours
- The calendar view will display non-operational times as unavailable
- Drag-and-drop rescheduling respects operational hour restrictions

---

## Project Timezones

### Per-Project Timezone Support

Each project can have its own timezone setting, which affects how dates and times are displayed.

### Configuration

1. Navigate to **Projects** > [Select Project] > **Edit Project**
2. Select the appropriate **Timezone** for the project's geographic location

### Available Timezones

- Eastern Time (ET)
- Central Time (CT)
- Mountain Time (MT)
- Arizona Time (AZ)
- Pacific Time (PT)
- Alaska Time (AK)
- Hawaii Time (HI)
- UTC

### Behavior

- All times are stored in UTC in the database
- Times are converted to the project timezone for display
- If no project timezone is set, the global system timezone is used
- Work order scheduled times respect the project timezone

---

## Multi-Tenancy Architecture

### Database Isolation

Each project has its own isolated PostgreSQL schema for work order data.

### Schema Naming Convention

Project schemas follow the pattern: `{project_name}_{project_id}`

Example: A project named "CSU Water" with ID 7 would have schema `csu_water_7`

### What's Stored Per-Project

- Work orders
- Work order photos and signatures
- Meter data (old/new meter numbers, readings)
- Import configurations
- Import history (project-specific)

### What's Stored Globally

- Users
- Projects metadata
- Subroles and permissions
- System settings
- Work order status codes
- Service types
- Trouble codes
- System types
- User groups

---

## File Management

### Directory Structure

Files are organized under a configurable root directory:

```
Project Files/
  {ProjectName}_{ID}/
    Work Orders/
      {CustomerWoId}/
        before_*.jpg
        after_*.jpg
        signature_*.png
    Project Documents/
    Project FTP Files/
```

### Configuration

1. Navigate to **Settings** > **Project Files Directory**
2. Set the root path for project files
3. The system will automatically create subdirectories as needed

### File Upload Limits

Configure upload restrictions in **Settings** > **File Upload Settings**:
- **Maximum File Size** - Default 100 MB
- **Allowed Extensions** - Comma-separated list (e.g., `jpg,png,pdf,xlsx`)

---

## Database Considerations

### Foreign Key Constraints

Critical foreign key relationships exist that prevent accidental data loss:

| Table | Field | References | On Delete |
|-------|-------|------------|-----------|
| work_orders | createdBy | users.username | RESTRICT |
| work_orders | assignedTo | users.id | SET NULL |
| work_orders | assignedGroup | user_groups.id | SET NULL |
| user_projects | userId | users.id | CASCADE |
| project_holidays | projectId | projects.id | CASCADE |

### ID-Based Assignments

Work order assignments use IDs rather than names to ensure data integrity:
- `assignedTo` - User ID (UUID string)
- `assignedGroup` - User Group ID (integer)

This ensures assignments remain valid even if usernames or group names change.

---

## Customer API Integration

### Overview

Projects can be configured to push completed work order data to external customer systems.

### Configuration

1. Navigate to **Projects** > [Select Project] > **Edit Project**
2. Enable **Customer API Integration**
3. Configure:
   - **API URL** - The endpoint to send data to
   - **Authentication Type** - None, API Key, Bearer Token, or Basic Auth
   - **Credentials** - Stored as environment variables for security

### Supported Authentication Types

| Type | Header | Value Source |
|------|--------|--------------|
| None | - | - |
| API Key | Custom header name | Environment variable |
| Bearer Token | Authorization | `Bearer {env_var_value}` |
| Basic Auth | Authorization | `Basic {base64(user:pass)}` |

### API Logs

All outbound API calls are logged in the **Customer API Logs** section of Settings for debugging purposes.

---

## Backup and Restore

### Backup Types

Three backup types are available:

| Type | Contents | Use Case |
|------|----------|----------|
| **Database Only** | Project database schema and data | Quick backup, no files needed |
| **Database + Files** | Database plus all project files | Full project backup |
| **Files Only** | Project files only (photos, documents) | When database is backed up separately |

### Creating Backups

1. Navigate to **Maintenance**
2. Select the project to backup
3. Choose the backup type
4. Click **Create Backup**
5. Download the backup file

**Backup File Format:**
- Database exports: SQL dump format
- Combined backups: ZIP archive containing SQL and file directories
- Files only: ZIP archive of project file directories

### Restoring from Backup

**Preconditions for Restore:**
1. The target project must exist (restoring does not create projects)
2. You must have Administrator permissions
3. The backup file must match the expected format for the restore type
4. For database restores, the project schema will be dropped and recreated

**Restore Steps:**
1. Navigate to **Maintenance**
2. Select the target project
3. Upload the backup file
4. Confirm the restore operation
5. Wait for the restore to complete

**Warning:** Restoring a backup will **permanently overwrite** existing data in the target project. This operation cannot be undone. Create a backup before restoring if you need to preserve current data.

### Restore Safeguards

The system implements the following safeguards:

1. **Confirmation Required** - Users must explicitly confirm restore operations
2. **Admin Only** - Only users with Administrator subrole can perform restores
3. **File Validation** - Backup files are validated before restore begins
4. **Transaction Safety** - Database restores use transactions where possible

**What Restore Does NOT Do:**
- Create new projects (project must exist)
- Migrate data between different schema versions
- Restore global settings or user accounts (only project data)
- Merge data with existing records (full replacement only)

### System Backups

Full system backups (all projects and global data) can be created by administrators and include:
- All project databases
- All project files
- Global configuration
- User accounts and permissions

### Backup Best Practices

1. **Schedule Regular Backups** - Create backups before major changes
2. **Store Backups Externally** - Download and store backup files outside the system
3. **Test Restore Process** - Periodically verify backups can be restored
4. **Document Backup Schedule** - Maintain a log of when backups were created
5. **Version Control** - Keep multiple backup versions, not just the latest

---

## Web Application Updates

MeterFlo includes a built-in update checking system that integrates with GitHub releases. This allows administrators to track new versions and apply updates to production server instances.

### Configuration

1. Navigate to **Settings** > **Web Application Updates**
2. Enter the GitHub releases API URL for your MeterFlo repository:
   ```
   https://api.github.com/repos/YOUR-ORG/YOUR-REPO/releases/latest
   ```
3. Click **Save** to store the configuration

### Release Process

When developing on your main server (development):

1. Make your code changes and test thoroughly
2. Update the version number in `package.json` (e.g., `1.0.0` to `1.0.1`)
3. Commit and push changes to GitHub

On GitHub:

1. Go to your repository and click **Releases** on the right side
2. Click **Create a new release** or **Draft a new release**
3. Click "Choose a tag" and type a new tag matching your version (e.g., `v1.0.1`)
4. Add a release title and describe what changed in the release notes
5. Click **Publish release**

**Important:** The repository must have at least one published release for the update check to work. Without a release, the check will return "Repository or release not found."

### Checking for Updates

On production server instances:

1. Open the app and navigate to **Settings** > **Web Application Updates**
2. Click **Check for Updates** to query GitHub for the latest release
3. If an update is available, you'll see the new version number and release notes
4. Click **Preview Changes** to see which files will be modified

### Applying Updates

To apply an update to a server instance:

1. SSH into the server or access the terminal
2. Navigate to the MeterFlo application directory
3. Run `git pull` to fetch and apply the latest changes
4. Restart the application

### Version Numbering

The version is stored in `package.json` at the root of the project. Use semantic versioning:

| Change Type | Example | When to Use |
|-------------|---------|-------------|
| **Patch** | 1.0.0 → 1.0.1 | Bug fixes, minor corrections |
| **Minor** | 1.0.0 → 1.1.0 | New features, backwards compatible |
| **Major** | 1.0.0 → 2.0.0 | Breaking changes, major redesigns |

### Permissions

The following permission is required to access web update features:

- **settings.webUpdate** - View configuration, check for updates, preview changes

Only users with the Administrator subrole have this permission by default.

### Troubleshooting

**"Repository or release not found"**
- Verify the GitHub repository exists and is accessible
- Ensure the repository has at least one published release
- Check the URL format is correct

**"GitHub API rate limit exceeded"**
- GitHub limits unauthenticated API requests to 60 per hour
- Wait an hour and try again, or reduce check frequency

**Update check shows no new version available**
- Verify the `package.json` version matches what you expect
- Check the GitHub release tag matches the intended version

---

## Best Practices

### Security

- Assign users the minimum permissions necessary for their role
- Use strong passwords for all user accounts
- Store API credentials in environment variables, never in code
- Regularly review user access and remove inactive accounts

### Data Integrity

- Never delete the `file_import` user if using scheduled imports
- Avoid deleting core status codes
- Use project-specific timezones for accurate time tracking
- Configure operational hours to prevent accidental scheduling errors

### Performance

- Archive completed projects rather than keeping them active
- Regularly clean up old import files from FTP directories
- Monitor the File Import History for failed imports

---

## Troubleshooting

### Common Issues

**Scheduled Import Fails with "Foreign Key Constraint"**
- Ensure the `file_import` user exists in the Users table

**Work Order Times Display Incorrectly**
- Check the project timezone setting
- Verify the global timezone setting if no project timezone is configured

**Cannot Delete a Status Code**
- Core status codes (Open, Closed, Completed, Scheduled, Trouble) cannot be deleted

**File Upload Fails**
- Check the maximum file size setting
- Verify the file extension is in the allowed list

**User Cannot Access a Project**
- Verify the user is assigned to the project directly or through a user group
- Check the user's subrole has the necessary permissions
