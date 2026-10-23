---
name: Publishing schema ownership
description: Why runtime-only fields can appear as destructive removals during publishing.
---

Schema declarations alone do not protect active fields during publishing. Changes must exist in the actual development database before a user publishes, and declared constraints must agree with standalone upgrade rules.

**Why:** A development snapshot lacked active visit-default columns that production startup could create. Publishing proposed dropping/recreating those columns and deleting their values. Startup-only upgrades depend on whether a preview has restarted and are not a reliable development schema application boundary. After schema alignment and the workspace guard correction, the user confirmed that republishing completed without errors; preservation of individual production values was not independently verified.

**How to apply:** Keep additive development setup in post-merge maintenance and preserve nullable historical settings without backfilling business defaults. Test repeated reconciliation against a populated, owned PostgreSQL cluster, including column identities and constraint enforcement. Before delivery, apply and verify required tables and columns in the actual development database: a passing clean-schema sandbox does not prove the workspace schema was installed. Never use production data overwrite, publish-build database pushes, or new production startup DDL to repair the mismatch.

Production diff tools can reject task-agent access even when publishing logs are readable.

**Why:** The production database comparison returned an authenticated-user requirement in an isolated task environment. Runtime log visibility does not imply production database permission.

**How to apply:** Report the unverified live diff explicitly, continue safe isolated checks, and use the supported production read-only tools from an authorized main session. Do not recover connection credentials or route around access controls.

Do not assume a schema comparison's table filter isolates its sequence changes.

**Why:** The installed Drizzle tooling discovered an unrelated inventory identity sequence during a projects-only comparison and proposed dropping it, even with the table filter set.

**How to apply:** Inspect every proposed statement before applying a focused comparison. Preserve independently owned sequences explicitly in disposable tests, and never use a broad forced schema push against this app's mixed declarative/application-managed schema as a shortcut.

Do not use `REPLIT_ENVIRONMENT=production` to identify a published app.

**Why:** Replit's editor and post-merge runner also supplied that platform label. Treating it as the app's deployment stage rejected legitimate development setup.

**How to apply:** Use the documented published-runtime flag `REPLIT_DEPLOYMENT=1`; require workspace signals such as the dev domain for development-only scripts. Test the editor's production platform label separately from actual published-runtime rejection.

Retain the trouble-code global unique key until a read-only production check
confirms that installed project work-order foreign keys no longer reference
the descriptive code.

**Why:** The supported comparison emitted public-schema changes without the
per-project reference conversion, so removing that key failed dependency
validation. The retained key is a staged cutover safeguard, not a permanent
requirement for globally unique project code values or a legacy application
read path.

**How to apply:** Keep the source declaration and actual development constraint
aligned during the stage. Clearly disclose the temporary global-code
restriction. Never use CASCADE or direct production DDL; verify installed
references before planning a separate removal through Publish.

Verify the retained key and comparison after full development startup, not just
immediately after applying the development repair.

**Why:** The original generated-SQL test passed, but an older initialization
cleanup removed the declared unique key on restart, so the next Publish again
proposed the blocked removal. Testing the SQL alone missed that drift.

**How to apply:** Startup must not automatically remove schema-declared keys.
Include real initialization in an owned child process in migration regression
checks, and check the actual development constraint and fresh diff after a
workspace restart before recommending another publish.

Inspect referenced unique-key representation and the entire generated statement
order, not just the first failure.

**Why:** Standalone unique indexes supporting foreign keys were omitted by
comparison, while existing-table UNIQUE constraints were added after new
foreign keys. A public-only diff can therefore drop a needed index or reference
a key not yet created.

**How to apply:** Represent required candidate keys as actual constraints and
prefer already-existing primary keys for new references where they are the
same immutable domain identity. Prove any identity equivalence before changing
references. Validate the unchanged generated order on an owned populated
database and retain the authoritative Publish fork check. Never truncate
already-unique business records to satisfy a generic uniqueness warning.
