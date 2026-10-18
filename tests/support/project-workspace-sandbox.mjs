// Runs real signed-in browser acceptance against an owned temporary PostgreSQL cluster.
// No inherited database/session credentials or arbitrary target URL are accepted.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import pg from "pg";

const cwd = process.cwd();
const fixtureFile = "/tmp/meterflo-inventory-ui-fixture.json";
try { await access(fixtureFile); throw new Error("An inventory browser fixture already exists; clean it up before starting this sandbox."); }
catch (error) { if (error.code !== "ENOENT") throw error; }
const root = await mkdtemp(path.join(os.tmpdir(), "meterflo-workspace-"));
const out = path.join(cwd, "generated-artifacts/project-workspace");
await mkdir(out, { recursive: true });
const runId = randomUUID();
const freePort = () => new Promise(resolve => {
  const server = net.createServer().listen(0, "127.0.0.1", () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const databasePort = await freePort(), appPort = await freePort();
const env = {};
for (const key of ["PATH", "HOME", "LANG", "TMPDIR"]) if (process.env[key]) env[key] = process.env[key];
Object.assign(env, {
  DATABASE_URL: `postgresql://workspace_ui@127.0.0.1:${databasePort}/postgres`,
  SESSION_SECRET: randomUUID() + randomUUID(), COOKIE_SECURE: "false", NODE_ENV: "production",
  HOST: "127.0.0.1", PORT: String(appPort), DOTENV_CONFIG_PATH: path.join(root, "empty.env"),
  WORKSPACE_UI_SANDBOX_CONFIG: path.join(root, "browser.json"),
});
await writeFile(env.DOTENV_CONFIG_PATH, "", { mode: 0o600 });
await writeFile(env.WORKSPACE_UI_SANDBOX_CONFIG, JSON.stringify({
  ownedWorkspaceSandbox: true, runId, baseURL: `http://127.0.0.1:${appPort}`,
}), { mode: 0o600 });
const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { cwd, env, stdio: "inherit", ...options });
  child.once("error", reject);
  child.once("exit", code => code === 0 ? resolve() : reject(new Error(`${path.basename(command)} ${args[0] ?? ""} failed (${code})`)));
});
let started = false, app, ownedFixture = false, passed = false;
try {
  await run("initdb", ["-D", path.join(root, "pg"), "-U", "workspace_ui", "--auth=trust", "--encoding=UTF8", "--no-locale"], { stdio: "ignore" });
  started = true;
  await run("pg_ctl", ["-D", path.join(root, "pg"), "-l", path.join(root, "postgres.log"), "-o", `-h 127.0.0.1 -p ${databasePort} -k ${root}`, "-w", "start"]);
  await run(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "push", "--force"], { stdio: "ignore" });
  const db = new pg.Client({ connectionString: env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("INSERT INTO public.system_settings(key,value) VALUES('project_files_path',$1) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [path.join(root, "files")]);
    await db.query("INSERT INTO public.service_types(code,label,color) VALUES('workspace-fixture','Workspace service','blue')");
    await db.query("INSERT INTO public.system_types(product_id,product_label) VALUES('workspace-fixture','Workspace meter')");
  } finally { await db.end(); }
  const log = createWriteStream(path.join(out, "server.log"));
  app = spawn(process.execPath, [path.join(cwd, "dist/index.cjs")], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  app.stdout.pipe(log); app.stderr.pipe(log);
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${appPort}/api/auth/user`)).status === 401) { ready = true; break; } } catch {}
    if (app.exitCode !== null) throw new Error("Sandbox app exited; inspect generated-artifacts/project-workspace/server.log");
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Sandbox app did not become ready");
  await run(process.execPath, ["--import", "tsx", "script/migrate-inventory-relational.ts", "--standalone"]);
  const tests = process.argv.slice(2);
  const failures = [];
  for (const test of tests.length ? tests : [
    "tests/project-configuration-ui.cjs", "tests/inventory-configuration-toolbar-ui.cjs", "tests/inventory-location-types-ui.cjs",
    "tests/inventory-removal-ui.cjs", "tests/inventory-phone-layout-ui.cjs",
    "tests/inventory-page-editors-ui.cjs", "tests/projects-responsive-ui.cjs",
    "tests/settings-workspace-ui.cjs",
  ]) {
    if (!/^tests\/[\w-]+\.cjs$/.test(test)) throw new Error("Expected a browser test under tests/");
    console.log(`Running ${test}`);
    // Management suites deliberately change location definitions and role grants.
    // Give each suite its own project/accounts, rather than leaking that state
    // into a later suite's default-location or authorization assumptions.
    ownedFixture = true;
    await run(process.execPath, ["--import", "tsx", "tests/support/inventory-ui-fixture.ts", "create"]);
    const fixture = JSON.parse(await readFile(fixtureFile, "utf8"));
    const baseURL = `http://127.0.0.1:${appPort}`;
    const login = await fetch(`${baseURL}/api/auth/local/login`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(fixture),
    });
    if (!login.ok) throw new Error("Owned fixture login failed");
    const cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const endpoint = `${baseURL}/api/projects/${fixture.projectId}/inventory`;
    const command = async (action, data) => {
      const response = await fetch(`${endpoint}/commands`, {
        method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ operationId: randomUUID(), action, data }),
      });
      if (!response.ok) throw new Error(`Owned fixture ${action} setup failed (${response.status})`);
      return (await response.json()).state;
    };
    const physicalId = "57e15eca-f991-4328-a091-000000000001";
    await command("warehouse", { id: randomUUID(), code: "WORKSPACE", name: "Workspace fixture warehouse",
      type: "physical", locationTypeId: physicalId, expectedLocationTypeRevision: 1,
      address: "Disposable fixture only", active: true, userIds: [] });
    try { await run(process.execPath, [test]); }
    catch (error) { failures.push(test); console.error(error.message); }
    finally {
      await run(process.execPath, ["--import", "tsx", "tests/support/inventory-ui-fixture.ts", "cleanup"]);
      ownedFixture = false;
    }
  }
  if (failures.length) throw new Error(`Browser checks failed: ${failures.join(", ")}`);
  passed = true;
} finally {
  if (app && app.exitCode === null) {
    app.kill();
    await new Promise(resolve => {
      const timer = setTimeout(() => { app.kill("SIGKILL"); }, 10000);
      app.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }
  if (started) await run("pg_ctl", ["-D", path.join(root, "pg"), "-m", "fast", "-w", "stop"]);
  if (ownedFixture) await rm(fixtureFile, { force: true });
  await rm(root, { recursive: true, force: true });
  await writeFile(path.join(out, "sandbox-result.json"), JSON.stringify({ runId, passed, cleaned: true }, null, 2));
}
