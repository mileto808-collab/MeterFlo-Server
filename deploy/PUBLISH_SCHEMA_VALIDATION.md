# Publishing the trouble-code and customer-handoff schema changes

Publish owns changes to Replit-managed production PostgreSQL. Do not add build
hooks, startup repairs or production migration scripts to bypass its validation.

## Current staged trouble-code cutover

Some installed project schemas still have work-order foreign keys referencing
`public.trouble_codes.code`. Removing `trouble_codes_code_key` before those
references move to `rule_key` fails PostgreSQL dependency validation.

The schema therefore retains that unique constraint for this publish. This
temporarily requires exact trouble-code values to be globally unique, in
addition to the scoped catalog rules. It is not a second application read path.
Remove the temporary constraint only after a read-only check of the target
production database confirms that no work-order foreign keys still reference
`trouble_codes.code`. Do not use `CASCADE` to remove those dependencies.

## Referenced unique keys and ordering

The schema comparison omitted standalone unique indexes used as foreign-key
targets. Development now represents the trouble-code UUID key and relevant
inventory identities as actual `UNIQUE` constraints, retaining their indexes.

New handoff references use `(project_id, _key)`, the existing composite primary
keys. These two entities persist their immutable domain IDs as `_key`; the
development records were checked for equality before changing references.
This avoids depending on an existing-table unique constraint that the generated
migration might add after its dependent foreign key.

The development/standalone schema generator uses the same primary-key targets.
No managed-production runtime or deployment DDL was added.

## Verification and publishing

1. Have Agent recompute the supported development-to-production schema diff.
   This is read-only; do not recover or use production connection credentials.
2. Check the full generated order, not just the first failing statement.
   The staged migration must not drop `trouble_codes_code_key`.
3. For the current change, Agent can save the diff as ignored verification
   output and run:

   ```sh
   npx --no-install tsx tests/support/validate-publish-reference-diff.ts generated-artifacts/publish-key-validation/schema-diff.json
   ```

   The validator creates its own disposable PostgreSQL cluster. It reproduces
   the original dependency failure, applies the complete regenerated SQL in
   its original order, and checks populated synthetic records and handoff
   integrity. It also invokes the real startup initializer twice in an owned
   child process and verifies that the retained key and index survive. A SQL
   diff that passes before startup is insufficient if initialization removes
   a schema-declared constraint afterward.
   It accepts no caller-supplied database URL and does not access
   production. Its representative fixture is not a full production clone;
   Publish still performs the authoritative fork validation.
4. Restart the development application and verify that the retained trouble-code
   key still exists, then recompute the diff. Retry **Publish** normally.
   Keep existing records if asked about uniqueness.
   Do **not** truncate the trouble-code or inventory-return tables and do not
   select production-data overwrite. Existing production trouble-code values
   and return identities were checked to be unique.
5. Once publishing succeeds, verify the actual production trouble-code foreign
   keys read-only before scheduling removal of the temporary global-code key.

Development type checking, customer-handoff domain/backup tests, and all 43
regenerated statements passed for this change. No production schema or data
was changed by Agent.
