# Log-maintenance verification

Run `npm run test:log-maintenance` in development. Tests create and drop their
own randomly named PostgreSQL schema and temporary filesystem directory. They
never change the real retention policy or delete existing MeterFlo logs/history.
Fixtures cover recovery protection, cutoff/project filters, preview ownership
and expiry, changed/locked items, 500-item batches, concurrency, policy restart
persistence, disabled defaults, errors, archive-budget ordering, symlinks,
filename restrictions, active-file inode preservation and writer rotation.

Signed-in browser/API checks need a running development workflow, a built client
(`npm run build`), Playwright and Chromium. The harness uses normal local login
and role-management endpoints, creates disposable accounts/subroles, proxies
unrelated read APIs, and serves the production UI against an isolated log service.
Cleanup/policy requests affect only its fixture schema and temporary files.

If Playwright isn't installed in the project, a temporary tool install avoids
adding it to production dependencies:

```sh
npm install --prefix /tmp/meterflo-browser-tools --no-audit --no-fund playwright
PLAYWRIGHT_MODULE_PATH=/tmp/meterflo-browser-tools/node_modules/playwright \
  node --import tsx tests/log-maintenance-ui.cjs
```

The default Chromium executable is `/repl/tools/bin/chromium`; override with
`CHROMIUM_PATH` outside that environment. Tests use the development domain supplied
by `REPLIT_DEV_DOMAIN`, not a production endpoint. Desktop/phone captures go to
`/tmp/log-maintenance-checks`. Do not run this fixture harness on production.

The browser harness expects the existing global timezone hook's admin-only
`/api/settings/timezone` request to return 403 for its delegated log operator.
It still requires successful log-maintenance requests, no unintended denied
backup requests, no browser exceptions, and bounded page/component widths.
