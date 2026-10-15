// Owns a fresh PostgreSQL cluster and app process. No target/database URL option.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { fileURLToPath } from "node:url";
import pg from "pg";

const checkout = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
if (args.length !== 1 || args[0] !== "--confirm-disposable-checkout")
  throw new Error("Use --confirm-disposable-checkout only in a separate test checkout.");
const bin = process.env.INVENTORY_VOLUME_PG_BIN;
if (!bin || !path.isAbsolute(bin)) throw new Error("Set INVENTORY_VOLUME_PG_BIN to the PostgreSQL bin directory.");
const tool = name => path.join(bin, name + (process.platform === "win32" ? ".exe" : ""));
for (const name of ["initdb", "pg_ctl", "postgres"]) await access(tool(name));
await access(path.join(checkout, "dist/index.cjs"));
await access(path.join(checkout, "node_modules/drizzle-kit/bin.cjs"));
const output = path.join(checkout, "generated-artifacts/inventory-volume");
await mkdir(output, { recursive: true });
for (const name of ["metrics.json", "cleanup.json"]) await rm(path.join(output, name), { force: true });
const root = await mkdtemp(path.join(os.tmpdir(), "meterflo-volume-"));
const data = path.join(root, "postgres"), runId = randomUUID();
const freePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.on("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});
const databasePort = await freePort();
let appPort = await freePort();
while (appPort === databasePort) appPort = await freePort();
const env = {};
// Do not inherit production secrets, PG defaults, NODE_OPTIONS or a live .env.
for (const key of ["PATH", "Path", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC",
  "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "LANG"])
  if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  DATABASE_URL: `postgresql://mf_volume@127.0.0.1:${databasePort}/postgres`,
  SESSION_SECRET: randomUUID() + randomUUID(),
  NODE_ENV: "production", COOKIE_SECURE: "false", HOST: "127.0.0.1", PORT: String(appPort),
  DOTENV_CONFIG_PATH: path.join(root, "empty.env"), INVENTORY_VOLUME_ACCEPTANCE: "1",
  INVENTORY_VOLUME_STANDALONE_CONFIG: path.join(root, "sandbox.json"),
});
if (process.env.CHROMIUM_PATH) env.CHROMIUM_PATH = process.env.CHROMIUM_PATH;
const config = { runId, databasePort, appPort, baseURL: `http://127.0.0.1:${appPort}` };
await writeFile(env.DOTENV_CONFIG_PATH, "", { mode: 0o600 });
await writeFile(env.INVENTORY_VOLUME_STANDALONE_CONFIG, JSON.stringify(config), { mode: 0o600 });
let app, active, pgStarted = false, interrupted = false, passed = false, stage = "initialization";
const run = (exe, argv, { cwd = root, visible = false, timeout = 180_000, expected = [0] } = {}) => new Promise((resolve, reject) => {
  const child = spawn(exe, argv, { cwd, env, stdio: visible ? "inherit" : "ignore", windowsHide: true });
  active = child;
  const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
  child.once("error", error => { clearTimeout(timer); reject(error); });
  child.once("close", code => {
    clearTimeout(timer); active = undefined;
    expected.includes(code) && !interrupted ? resolve() : reject(new Error(`${stage} failed (exit ${code}).`));
  });
});
const interrupt = () => { interrupted = true; active?.kill(); app?.kill(); };
process.on("SIGINT", interrupt);
process.on("SIGTERM", interrupt);
let failure;
try {
  console.log("Creating disposable PostgreSQL cluster; the installed application is not used.");
  stage = "PostgreSQL initialization";
  await run(tool("initdb"), ["-D", data, "-U", "mf_volume", "--auth=trust", "--encoding=UTF8", "--no-locale"]);
  stage = "PostgreSQL startup";
  // Mark ownership before startup so cleanup also handles a partial start.
  pgStarted = true;
  await run(tool("pg_ctl"), ["-D", data, "-l", path.join(root, "postgres.log"),
    "-o", `-h 127.0.0.1 -p ${databasePort}${process.platform === "win32" ? "" : ` -k "${root}"`}`, "-w", "start"]);
  stage = "Empty database schema setup";
  await run(process.execPath, [path.join(checkout, "node_modules/drizzle-kit/bin.cjs"), "push", "--force"], { cwd: checkout });
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("CREATE TABLE public.inventory_volume_sandbox(run_id text NOT NULL)");
    await client.query("INSERT INTO public.inventory_volume_sandbox VALUES($1)", [runId]);
    // Keep project files in the disposable directory, never in the installed app.
    await client.query("INSERT INTO public.system_settings(key,value) VALUES('project_files_path',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [path.join(root, "files")]);
  } finally { await client.end(); }
  stage = "Disposable application startup";
  let ready = false;
  app = spawn(process.execPath, [path.join(checkout, "dist/index.cjs")], { cwd: root, env, stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
  let startupText = "";
  app.stdout.on("data", bytes => {
    startupText = (startupText + bytes.toString()).slice(-8192);
    if (startupText.includes(`serving on port ${appPort}`)) ready = true;
  });
  let appSpawnError;
  app.on("error", error => { appSpawnError = error; });
  for (let tries = 0; !ready && tries < 180; tries++) {
    if (appSpawnError || app.exitCode !== null || interrupted) throw new Error("Disposable app did not start.");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Disposable application startup timed out.");
  stage = "Engine boundaries and persistence";
  await run(process.execPath, ["--import", "tsx", "--test", "tests/inventory-volume.test.ts", "tests/inventory-persistence.test.ts"],
    { cwd: checkout, visible: true });
  stage = "Full-system backup restoration";
  await run(process.execPath, ["--import", "tsx", "--test", "tests/inventory-system-backup.test.ts"],
    { cwd: checkout, visible: true });
  stage = "Inventory acceptance";
  console.log("Running the real signed-in workload against the disposable server.");
  await run(process.execPath, ["--import", "tsx", "--test", "tests/inventory-volume-integration.test.ts"],
    { cwd: checkout, visible: true, timeout: 660_000 });
  const metrics = JSON.parse(await readFile(path.join(output, "metrics.json"), "utf8"));
  if (!metrics.passed || metrics.runId !== runId || metrics.environment?.platform !== process.platform)
    throw new Error("Current-run acceptance evidence is missing or failed.");
  passed = true;
} catch (error) {
  failure = error;
  console.error(error instanceof Error ? error.message : "Standalone acceptance failed.");
} finally {
  let serverStopped = !app, postgresStopped = !pgStarted, filesRemoved = false;
  if (app) {
    if (app.exitCode === null) {
      app.kill();
      await new Promise(resolve => {
        const timer = setTimeout(() => { app.kill("SIGKILL"); resolve(); }, 10_000);
        app.once("close", () => { clearTimeout(timer); resolve(); });
      });
    }
    serverStopped = app.exitCode !== null || app.signalCode !== null;
  }
  if (pgStarted) {
    try {
      stage = "Disposable PostgreSQL cleanup";
      interrupted = false;
      await run(tool("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { timeout: 60_000 });
      postgresStopped = true;
    } catch {
      try {
        await run(tool("pg_ctl"), ["-D", data, "status"], { expected: [3], timeout: 10_000 });
        postgresStopped = true;
      } catch { postgresStopped = false; }
    }
  }
  if (serverStopped && postgresStopped) {
    try { await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); filesRemoved = true; }
    catch { filesRemoved = false; }
  }
  const cleaned = serverStopped && postgresStopped && filesRemoved;
  await writeFile(path.join(output, "cleanup.json"), JSON.stringify({ runId, acceptancePassed: passed, cleaned, serverStopped, postgresStopped, filesRemoved }, null, 2));
  process.off("SIGINT", interrupt); process.off("SIGTERM", interrupt);
  if (!cleaned) console.error("Cleanup was incomplete. Do not assume the disposable processes/data were removed.");
  if (!passed || !cleaned || failure) process.exitCode = 1;
  else console.log("Standalone acceptance passed and disposable resources were cleaned.");
}
