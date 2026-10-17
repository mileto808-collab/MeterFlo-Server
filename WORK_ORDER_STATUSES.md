# Core status and sub-status hierarchy

The existing core `status` code remains authoritative for work-order validation, completion, scheduling, reopening, inventory and reporting. A sub-status is an optional relational identity, not a replacement status string or copied rule set. Existing orders have no sub-status until one is selected.

`public.work_order_sub_statuses` stores UUID, parent core status ID, optional project ID, code, label, description, color, active flag and sort order. Null project means a shared definition; otherwise the definition belongs only to that project. Administrators manage shared definitions in Settings beside Work Order Statuses. Authorized project managers manage local definitions in saved Project Settings with `projects.manageSubStatuses` plus project access. Shared entries shown there are read-only.

Definitions also have an optional integer **routing priority**, separate from display sort order. Lower numbers mean greater urgency (Critical = 0, Priority = 1); blank is unrated. Route planning protects appointments before priority and does not change inherited parent-status rules. See [Work-order routing](WORK_ORDER_ROUTING.md) for provider setup, project overrides and navigation.

- Core status rules always apply, including rules added later. Project customizations cannot weaken core safeguards.
- Parent, code, scope and UUID are immutable. Rename the label freely; deactivate a used definition rather than deleting it. Unused definitions may be deleted.
- Work orders store `sub_status_id` alongside `status`; inserts and updates validate parent, project scope and active selection in PostgreSQL. Unchanged inactive assignments remain valid historical references.
- Changing core status clears an incompatible retained sub-status. Explicitly assigning a different incompatible sub-status is rejected.
- Existing inapplicable historical work-order fields are not cleared by this feature.
- Sub-statuses describe workflow position; Trouble codes still describe the reason for a problem.

## API

Authenticated reads:

- `GET /api/work-order-sub-statuses`: shared definitions.
- `GET /api/projects/:projectId/work-order-sub-statuses`: shared and accessible project definitions, including inactive entries for historical display.

POST creates a definition using `parentStatusId`, `code`, `label`, optional `description`, `color` (six-digit hex), `sortOrder`, and `active`. PATCH `/:id` accepts only mutable display fields and active flag. DELETE `/:id` rejects referenced definitions. Project ownership always comes from the route, never the request body.

Project work-order create/update accepts optional `subStatusId` (UUID or null). List filters accept `subStatusId`. JSON responses include camel-case identity in mapped work orders; raw database responses may also include `sub_status_id`. Exports display a readable parent and sub-status, without changing the stored core code.

Mobile sync reference data includes `workOrderSubStatuses`; each downloaded work order includes `subStatusId` as well as its raw field. Upload accepts `subStatusId`, or the matching snake-case alias, and applies the same database checks. Native selectors require an update in the separate mobile repository.

## Migration and backups

Startup installs the table, validation triggers and a nullable column on existing project schemas. New project schemas install the same constraints. Older standalone databases sometimes have only the unique core status code constraint despite the declared Drizzle ID primary key; migration adds an ID unique index without replacing their existing code foreign keys.

Project backup version 2.6 includes scoped definitions and work-order references. Restoring local definitions into a different project remaps their UUIDs instead of stealing another project's definitions. A project restore does not modify shared configuration: missing shared definitions must be restored by an administrator first, or through a full-system backup. Retired historical assignments are preserved during trusted transactional restore.

Full-system backups include the shared/local table. Clean configuration backups include shared definitions only, since they omit customer projects. Audit events preserve definition and work-order changes.

A configurable project-specific business-rule editor is a separate extension; this foundation supplies stable sub-status identities and preserves inherited core behavior.
