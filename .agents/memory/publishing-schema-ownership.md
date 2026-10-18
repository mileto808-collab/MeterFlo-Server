---
name: Publishing schema ownership
description: Why runtime-only fields can appear as destructive removals during publishing.
---

Schema declarations alone do not protect active fields during publishing. Changes must exist in the actual development database before a user publishes, and declared constraints must agree with standalone upgrade rules.

**Why:** A development snapshot lacked active visit-default columns that production startup could create. Publishing proposed dropping/recreating those columns and deleting their values. Startup-only upgrades depend on whether a preview has restarted and are not a reliable development schema application boundary. After schema alignment and the workspace guard correction, the user confirmed that republishing completed without errors; preservation of individual production values was not independently verified.

**How to apply:** Keep additive development setup in post-merge maintenance and preserve nullable historical settings without backfilling business defaults. Test repeated reconciliation against a populated, owned PostgreSQL cluster, including column identities and constraint enforcement. Never use production data overwrite, publish-build database pushes, or new production startup DDL to repair the mismatch.

Production diff tools can reject task-agent access even when publishing logs are readable.

**Why:** The production database comparison returned an authenticated-user requirement in an isolated task environment. Runtime log visibility does not imply production database permission.

**How to apply:** Report the unverified live diff explicitly, continue safe isolated checks, and use the supported production read-only tools from an authorized main session. Do not recover connection credentials or route around access controls.

Do not assume a schema comparison's table filter isolates its sequence changes.

**Why:** The installed Drizzle tooling discovered an unrelated inventory identity sequence during a projects-only comparison and proposed dropping it, even with the table filter set.

**How to apply:** Inspect every proposed statement before applying a focused comparison. Preserve independently owned sequences explicitly in disposable tests, and never use a broad forced schema push against this app's mixed declarative/application-managed schema as a shortcut.

Do not use `REPLIT_ENVIRONMENT=production` to identify a published app.

**Why:** Replit's editor and post-merge runner also supplied that platform label. Treating it as the app's deployment stage rejected legitimate development setup.

**How to apply:** Use the documented published-runtime flag `REPLIT_DEPLOYMENT=1`; require workspace signals such as the dev domain for development-only scripts. Test the editor's production platform label separately from actual published-runtime rejection.
