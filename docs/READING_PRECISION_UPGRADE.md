# Reading precision database upgrade

Projects store independent integer precision settings from **0 through 6**.
Zero and six are intentional settings; the upgrade does not replace them.
Newly added columns default to 3.

Startup verifies both columns and these validated PostgreSQL checks:

- `projects_system_reading_decimal_places_check`
- `projects_module_reading_decimal_places_check`

Schema-tool definitions declare the same checks. Existing unconstrained columns
are not proof that the upgrade is complete. Unvalidated checks are validated;
a same-named check with an unexpected expression stops the upgrade for DBA review
rather than being dropped or silently trusted.

## DBA-prepared installations

If the application's runtime connection cannot alter tables (including read-only
connections), have the DBA run the upgrade first using a securely configured
table-owner connection:

```sh
npm run migrate:reading-precision
```

Use the normal secure connection configuration; do not put credentials in command
arguments, logs, or source control. Stop if the command fails. A fully prepared
database requires only catalog reads on subsequent startup, not ALTER privileges,
write transactions, or scans of the projects table.

The upgrade takes an exclusive projects-table lock for the transaction when
preparation is needed. Schedule that work in an appropriate maintenance window.
Concurrent initializers serialize safely. Changes roll back together on failure.

## Invalid existing settings

The upgrade inspects existing settings before installing/validating checks and
fails if either is outside 0–6. The diagnostic includes a total and up to 20
project IDs with their settings, not project names or credentials. For a complete
read-only inspection, the DBA can run:

```sql
SELECT id, system_reading_decimal_places, module_reading_decimal_places
FROM public.projects
WHERE system_reading_decimal_places NOT BETWEEN 0 AND 6
   OR module_reading_decimal_places NOT BETWEEN 0 AND 6
ORDER BY id;
```

This query assumes both columns already exist. If one is missing, inspect the
existing column alone. Review the intended settings with the configuration owner,
explicitly correct only approved values, and rerun the upgrade. Do not automatically
clamp values or reset all settings to 3.

## Windows updates

Continue using the tracked procedure in `deploy/WINDOWS_DEPLOYMENT.md`.
This additive startup upgrade does not bypass inventory maintenance, checksum,
release approval, protected configuration, or running-build verification.
Do not substitute a generic schema push or database reset. For limited-privilege
service accounts, the DBA preparation above must precede the service restart.
Linux tests do not establish real Windows/PM2 acceptance.

## Automated verification

`npm run test:reading-precision-migration` owns and removes a temporary PostgreSQL
cluster; it never uses the configured application database. PostgreSQL's `initdb`
and `pg_ctl` must be available. Coverage includes missing/partial columns,
unconstrained columns, zero/six preservation, repeated/concurrent initialization,
invalid values in either column, transaction rollback, unvalidated/misleading
checks, and a prepared read-only non-owner connection.
