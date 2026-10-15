import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:net";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";

// No dotenv, database module, caller-supplied URL, or existing cluster is used here.
export function standaloneEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(["path", "systemroot", "windir", "comspec", "pathext",
    "temp", "tmp", "tmpdir", "home", "userprofile", "localappdata", "appdata",
    "lang", "lc_all", "ld_library_path", "playwright_browsers_path"]);
  return Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())));
}

async function freePort() {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

export async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill();
  const timer = setTimeout(() => child.kill("SIGKILL"), 5000);
  try { await exited; } finally { clearTimeout(timer); }
}

export async function startVolumeStandalone(output: string) {
  const root = process.cwd();
  await access(resolve(root, "dist/index.cjs")); // Build explicitly; never start a dev preview.
  const release = JSON.parse(await readFile(resolve(root, "dist/customer-release.json"), "utf8"));
  if (release.extensions?.length) throw new Error("Use a clean core checkout without customer extensions for isolated volume acceptance");
  const buildSha256 = createHash("sha256").update(await readFile(resolve(root, "dist/index.cjs"))).digest("hex");
  const bin = process.env.INVENTORY_VOLUME_PG_BIN;
  const executable = (name: string) => bin ? join(bin, `${name}${process.platform === "win32" ? ".exe" : ""}`) : name;
  const work = await mkdtemp(join(tmpdir(), "meterflo-volume-"));
  const data = join(work, "postgres");
  const env: NodeJS.ProcessEnv = {
    ...standaloneEnvironment(process.env),
    NODE_ENV: "production", HOST: "127.0.0.1", COOKIE_SECURE: "false",
    SESSION_SECRET: randomUUID() + randomUUID(), DOTENV_CONFIG_PATH: join(work, "absent.env"),
    LOG_DIR: join(work, "logs"),
  };
  const logs: string[] = [];
  let app: ChildProcess | undefined, clusterCreated = false, closed = false;
  const children = new Set<ChildProcess>();
  const run = async (command: string, args: string[], cwd = work) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    children.add(child);
    child.stdout!.on("data", () => {}); // Do not retain startup/default account credentials.
    child.stderr!.on("data", () => {});
    const timer = setTimeout(() => { void stopChild(child); }, 90_000);
    try {
      const [code] = await once(child, "exit");
      if (code !== 0) throw new Error(`${command.split(/[\\/]/).at(-1)} failed (exit ${code}); check PostgreSQL tools and fresh-cluster prerequisites`);
    } finally { clearTimeout(timer); children.delete(child); }
  };
  const close = async () => {
    if (closed) return;
    // Do not remove a database directory until all processes using it have stopped.
    for (const child of children) await stopChild(child);
    if (app) await stopChild(app);
    if (clusterCreated) {
      // A failed pg_ctl start may not have created a live server.
      const status = spawn(executable("pg_ctl"), ["-D", data, "status"], { cwd: work, env, stdio: "ignore", windowsHide: true });
      const [code] = await once(status, "exit");
      if (code === 0) await run(executable("pg_ctl"), ["-D", data, "-m", "immediate", "-w", "-t", "30", "stop"]);
      else if (code !== 3) throw new Error("Could not establish that the disposable PostgreSQL server stopped; temporary directory retained");
    }
    await rm(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    closed = true;
  };
  const interrupted = () => { void close().finally(() => process.exit(130)); };
  process.once("SIGINT", interrupted);
  process.once("SIGTERM", interrupted);
  try {
    await run(executable("initdb"), ["-D", data, "-U", "volume", "--auth=trust", "--encoding=UTF8", "--locale=C"]);
    const dbPort = await freePort(), appPort = await freePort();
    env.DATABASE_URL = `postgresql://volume@127.0.0.1:${dbPort}/inventory_volume`;
    env.PORT = String(appPort);
    // A config file avoids pg_ctl -o shell-quoting differences between cmd and POSIX.
    await writeFile(join(data, "postgresql.auto.conf"),
      `listen_addresses = '127.0.0.1'\nport = ${dbPort}\nunix_socket_directories = ''\n`);
    // initdb creates a new, private cluster; no administration connection to an installed server.
    // Set this before pg_ctl: a partial startup must also be stopped.
    clusterCreated = true;
    await run(executable("pg_ctl"), ["-D", data, "-l", join(work, "postgres.log"), "-w", "-t", "30", "start"]);
    const admin = new pg.Client({ connectionString: `postgresql://volume@127.0.0.1:${dbPort}/postgres` });
    let databaseVersion = "";
    let databaseSettings: Record<string, string> = {};
    try {
      await admin.connect();
      await admin.query("CREATE DATABASE inventory_volume");
      databaseVersion = (await admin.query("SELECT version() AS version")).rows[0].version;
      databaseSettings = Object.fromEntries((await admin.query(`SELECT name, current_setting(name) AS value
        FROM pg_settings WHERE name IN ('shared_buffers','fsync','synchronous_commit','max_connections')`)).rows
        .map(row => [row.name, row.value]));
    } finally { await admin.end(); }
    await run(process.execPath, [resolve(root, "node_modules/drizzle-kit/bin.cjs"), "push", "--force",
      "--config", resolve(root, "drizzle.config.ts")], root);
    app = spawn(process.execPath, [resolve(root, "dist/index.cjs")], {
      cwd: work, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    let startupError = false, serving = false, startupTail = "";
    app.once("error", () => { startupError = true; });
    // Keep only lifecycle information, not API bodies, usernames, cookies or bootstrap passwords.
    app.stdout!.on("data", chunk => {
      startupTail = (startupTail + chunk.toString()).slice(-500);
      if (startupTail.includes(`serving on port ${appPort}`)) serving = true;
    });
    app.stderr!.on("data", () => {});
    const baseURL = `http://127.0.0.1:${appPort}`;
    const deadline = Date.now() + 90_000;
    while (true) {
      if (startupError || app.exitCode !== null) throw new Error("Disposable standalone application exited during startup");
      try {
        const response = await fetch(`${baseURL}/api/auth/user`, { redirect: "error", signal: AbortSignal.timeout(1000) });
        if (serving && response.status === 401) break;
      } catch { /* only our just-created loopback process is probed */ }
      if (Date.now() > deadline) throw new Error("Disposable standalone application did not become ready within 90s");
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    logs.push("New temporary PostgreSQL cluster and loopback standalone server started.");
    return { baseURL, env, databaseVersion, databaseSettings, buildSha256,
      checkBoundaries: () => run(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "--test",
        resolve(root, "tests/inventory-volume.test.ts"), resolve(root, "tests/inventory-persistence.test.ts")], root),
      checkSystemBackup: () => run(process.execPath, [resolve(root, "node_modules/tsx/dist/cli.mjs"), "--test",
        resolve(root, "tests/inventory-system-backup.test.ts")], root),
      close: async () => {
      try { await close(); }
      finally {
        process.removeListener("SIGINT", interrupted);
        process.removeListener("SIGTERM", interrupted);
        await mkdir(output, { recursive: true });
        await writeFile(join(output, "cleanup.json"), JSON.stringify({ cleaned: closed, events: logs }, null, 2));
      }
    } };
  } catch (error) {
    try { await close(); }
    finally {
      process.removeListener("SIGINT", interrupted);
      process.removeListener("SIGTERM", interrupted);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, "cleanup.json"), JSON.stringify({ cleaned: closed, phase: "startup" }));
    }
    throw error;
  }
}
