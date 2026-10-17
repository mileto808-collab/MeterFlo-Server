import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import pg from "pg";
import { standaloneEnvironment } from "./inventory-volume-standalone";

/** No caller-supplied database URL or installed cluster credentials are accepted. */
export async function publishingPostgres() {
  const directory = await mkdtemp(join(tmpdir(), "meterflo-publishing-"));
  const data = join(directory, "postgres");
  const env = standaloneEnvironment(process.env);
  const run = async (command: string, args: string[], extraEnv = env) => {
    const child = spawn(command, args, { cwd: directory, env: extraEnv, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => { output = (output + chunk).slice(-16000); });
    child.stderr.on("data", chunk => { output = (output + chunk).slice(-16000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), 60000);
    try {
      const [code] = await once(child, "exit");
      if (code !== 0) throw new Error(`${command} failed: ${output}`);
      return output;
    } finally { clearTimeout(timer); }
  };
  let started = false;
  let pool: pg.Pool | undefined;
  const close = async () => {
    await pool?.end();
    if (started) {
      // Stop before deleting; retain the directory if stop fails.
      await run("pg_ctl", ["-D", data, "-m", "immediate", "-w", "-t", "30", "stop"]);
      started = false;
    }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    await run("initdb", ["-D", data, "-U", "publishing_test", "--auth=trust", "--encoding=UTF8", "--locale=C"]);
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = (listener.address() as { port: number }).port;
    await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
    await writeFile(join(data, "postgresql.auto.conf"),
      `listen_addresses = '127.0.0.1'\nport = ${port}\nunix_socket_directories = '${directory.replaceAll("'", "''")}'\n`);
    await run("pg_ctl", ["-D", data, "-l", join(directory, "postgres.log"), "-w", "-t", "30", "start"]);
    started = true;
    const connectionString = `postgresql://publishing_test@127.0.0.1:${port}/postgres`;
    pool = new pg.Pool({ connectionString });
    return { pool, directory, close, run, env: {
      ...env, DATABASE_URL: connectionString, DOTENV_CONFIG_PATH: join(directory, "absent.env"),
      REPL_ID: "owned-publishing-test", NODE_ENV: "development", TSX_TSCONFIG_PATH: resolve("tsconfig.json"),
    } };
  } catch (error) {
    await close();
    throw error;
  }
}
