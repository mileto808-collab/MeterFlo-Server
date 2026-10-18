import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Do not execute .cmd shims through a shell: paths with spaces and argument
// boundaries must survive, and credentials must never be printed as commands.
export function toolCommand(tool, args, {
  platform = process.platform, execPath = process.execPath,
  searchPath = process.env.PATH ?? "", exists = fs.existsSync,
} = {}) {
  let executable = tool;
  let argv = args;
  if (platform === "win32" && ["npm", "pm2"].includes(tool)) {
    const paths = path.win32;
    const relative = tool === "npm" ? "node_modules/npm/bin/npm-cli.js" : "node_modules/pm2/bin/pm2";
    const cli = [paths.dirname(execPath), ...searchPath.split(";")]
      .map(directory => paths.join(directory, relative)).find(file => exists(file));
    if (!cli) throw new Error(`${tool} CLI not found. Use the Windows account that installed Node/PM2.`);
    executable = execPath;
    argv = [cli, ...args];
  }
  return { executable, argv };
}

export function execute(tool, args, root, capture = false) {
  const { executable, argv } = toolCommand(tool, args);
  const result = spawnSync(executable, argv, {
    cwd: root, shell: false, encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    timeout: 15 * 60 * 1000, maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${tool} ${args[0] ?? ""} failed. Update stopped; inspect local diagnostics. No automatic database rollback was attempted.`);
  return capture ? result.stdout.trim() : "";
}

export function acquireUpdateLock(root) {
  fs.mkdirSync(path.join(root, "generated-artifacts"), { recursive: true });
  const lock = path.join(root, "generated-artifacts/windows-update.lock");
  const descriptor = fs.openSync(lock, "wx");
  try { fs.writeFileSync(descriptor, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })); }
  finally { fs.closeSync(descriptor); }
  return () => fs.unlinkSync(lock);
}

export function verifyCheckout(root, run = execute) {
  const actualRoot = run("git", ["rev-parse", "--show-toplevel"], root, true);
  if (fs.realpathSync(actualRoot).toLowerCase() !== fs.realpathSync(root).toLowerCase())
    throw new Error("MeterFlo must be the Git checkout root.");
  if (run("git", ["branch", "--show-current"], root, true) !== "main")
    throw new Error("Expected the main branch. Reconcile your branch before updating.");
  // Local backups/scripts must not be forced into Git. Git pull itself rejects
  // untracked-file collisions instead of overwriting them.
  if (run("git", ["status", "--porcelain", "--untracked-files=no"], root, true))
    throw new Error("Tracked local Git changes need review. Nothing was reset or stopped; commit/reconcile code changes before updating.");
}

export function verifyPm2(root, read) {
  const processes = JSON.parse(read("pm2", ["jlist"], root, true));
  const matches = processes.filter(process => process.name === "meterflo");
  const same = (a, b) => path.resolve(a ?? "").toLowerCase() === path.resolve(b).toLowerCase();
  if (!matches.length || matches.some(process =>
    !same(process.pm2_env?.pm_cwd, root) ||
    !same(process.pm2_env?.pm_exec_path, path.join(root, "dist/index.cjs"))))
    throw new Error("PM2 meterflo must use this installation's working directory and dist/index.cjs. Correct the private PM2 configuration before updating.");
  return matches;
}
