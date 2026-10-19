#!/bin/bash
set -e

# Reinstall dependencies in case package.json changed (e.g. dotenv was added).
npm install --no-audit --no-fund

# Inventory's relational schema is maintained outside Drizzle. Install additive
# fields before the restarted app reads/posts inspection history or vendor-kit provenance.
if [ -n "${REPL_ID:-}" ]; then
  npx tsx script/migrate-inventory-relational.ts --development
  # Publishing compares actual dev/prod databases, not TypeScript declarations.
  # Install additive scheduling fields before a publish, even if no preview was
  # opened after the merge. Never run this command in a production build hook.
  npx tsx script/migrate-visit-scheduling.ts --development
  npx tsx script/migrate-route-dispatch.ts --development
  npx tsx script/migrate-gps.ts --development
fi
