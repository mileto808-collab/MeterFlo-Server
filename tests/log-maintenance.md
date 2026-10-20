# Log-maintenance verification

Build the client, then run the unit and signed-in browser/API suites in the owned
disposable PostgreSQL/app sandbox:

```sh
npm run build
node tests/support/project-workspace-sandbox.mjs tests/log-maintenance-workspace.cjs
```

The sandbox does not inherit development/production database credentials.
Tests additionally create/drop randomly named fixture schemas and temporary
log directories. They never change a real instance's policy or delete its logs.
`npm run test:log-maintenance` runs the same build-and-sandbox command.
Fixtures cover recovery protection, cutoff/project filters, preview ownership
and expiry, changed/locked items, 500-item batches, concurrency, policy restart
persistence, disabled defaults, errors, archive-budget ordering, symlinks,
filename restrictions, active-file inode preservation and writer rotation.

Signed-in browser/API checks need the sandbox's running application, a built client
(`npm run build`), Playwright and Chromium. The harness uses normal local login
and role-management endpoints, creates disposable accounts/subroles, proxies
unrelated read APIs, and serves the production UI against an isolated log service.
Cleanup/policy requests affect only its fixture schema and temporary files.

Playwright is a development dependency. Do not invoke the signed-in suite outside
the owned sandbox: it deliberately creates disposable users/subroles through
normal role-management APIs and refuses to run without the ownership config.

The default Chromium executable is `/repl/tools/bin/chromium`.
The owned sandbox supplies a loopback URL, never a production endpoint. Desktop/phone captures go to
`/tmp/log-maintenance-checks`. Do not run this fixture harness on production.

The browser harness permits only expected 403 responses from the application's
global timezone/routing providers for its delegated log-only account.
Responses other than 403 on those routes still fail the test.
It still requires successful log-maintenance requests, no unintended denied
backup requests, no browser exceptions, and bounded page/component widths.

Coverage also includes explicit manual-only failed/partial import cleanup,
latest completed diagnostics despite a newer active run, rechecking eligibility,
project-scoped SFTP/HTTPS history, resolved export attempts, payload/file/replay
preservation, backward-compatible retention categories, archive-only policies,
and fair bounded automatic batches that do not starve other histories/archives.
Configured unsuccessful API imports remain protected because their stored
checkpoints/settings support manual retries even after newer runs complete.
