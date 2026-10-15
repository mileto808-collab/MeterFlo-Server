import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { standaloneEnvironment, stopChild } from "./helpers/inventory-volume-standalone";

test("standalone children cannot inherit instance URLs, credentials, dotenv or runtime preload flags", () => {
  const env = standaloneEnvironment({
    PATH: "tools", SystemRoot: "windows", TEMP: "temp", HOME: "home",
    PLAYWRIGHT_BROWSERS_PATH: "browsers",
    DATABASE_URL: "must-not-be-used", PGHOST: "must-not-be-used",
    PGPASSWORD: "must-not-be-used", SMTP_PASSWORD: "must-not-be-used",
    SESSION_SECRET: "must-not-be-used", REPLIT_DEV_DOMAIN: "must-not-be-used",
    INVENTORY_VOLUME_BASE_URL: "must-not-be-used", NODE_OPTIONS: "must-not-be-used",
    DOTENV_CONFIG_PATH: "must-not-be-used", COOKIE_SECURE: "must-not-be-used",
    database_url: "must-not-be-used", node_options: "must-not-be-used",
  });
  assert.deepEqual(env, { PATH: "tools", SystemRoot: "windows", TEMP: "temp", HOME: "home",
    PLAYWRIGHT_BROWSERS_PATH: "browsers" });
});

test("child cleanup stops a running server and is safe after exit", async () => {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  await stopChild(child);
  assert.ok(child.exitCode !== null || child.signalCode !== null);
  await stopChild(child);
});
