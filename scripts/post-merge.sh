#!/bin/bash
set -e

# Reinstall dependencies in case package.json changed (e.g. dotenv was added).
npm install --no-audit --no-fund

# Inventory's relational schema is maintained outside Drizzle. Install additive
# fields before the restarted app reads or posts inspection disposition history.
if [ -n "${REPL_ID:-}" ]; then
  npx tsx script/migrate-inventory-relational.ts --development
fi
