#!/bin/bash
set -e

# Reinstall dependencies in case package.json changed (e.g. dotenv was added).
npm install --no-audit --no-fund
