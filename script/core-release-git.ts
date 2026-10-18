import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { preparationEnvironment } from "./customer-release-stage";

const exec = promisify(execFile);
export type GitResult = { code: number; stdout: string };
export type ReviewGit = (cwd: string, args: string[]) => Promise<GitResult>;
export const reviewGit: ReviewGit = async (cwd, args) => {
  const env = { ...preparationEnvironment(), GIT_TERMINAL_PROMPT: "0",
    ...(process.env.SSH_AUTH_SOCK ? { SSH_AUTH_SOCK: process.env.SSH_AUTH_SOCK } : {}) };
  try {
    const result = await exec("git", ["-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false",
      "-c", "protocol.ext.allow=never", ...args], { cwd, env, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout: result.stdout };
  } catch (error: any) {
    // Never expose stderr, command arguments, remote credentials or source contents.
    return { code: Number.isInteger(error.code) ? error.code : -1, stdout: "" };
  }
};
export async function gitText(git: ReviewGit, cwd: string, args: string[]) {
  const result = await git(cwd, args);
  if (result.code !== 0) throw new Error(`Git ${args[0]} failed. Check repository access/history privately; no live source was replaced.`);
  return result.stdout;
}
export const commitPattern = /^[a-f0-9]{40}$/;
export const tagPattern = /^v\d+\.\d+\.\d+$/;
export type CoreIdentity = {
  version: string; schemaVersion: number; extensionApiVersion: number;
  migrations: { id: string; file: string; sha256: string; ownership: string; reversible: boolean }[];
};
export function validateDependencyLock(pkg: any, lock: any) {
  if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version ||
      lock.name !== pkg.name || lock.lockfileVersion !== 3)
    throw new Error("Package and root lockfile version/name must agree (lockfile version 3 required).");
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const entries = (value: any) => JSON.stringify(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b)));
    if (entries(pkg[field]) !== entries(lock.packages[""][field]))
      throw new Error("Package and lockfile dependency declarations disagree.");
  }
}
export function protectedSourceFile(file: string) {
  const name = file.replaceAll("\\", "/").toLowerCase();
  return /(^|\/)(\.env(?:\..*)?|\.npmrc)$/.test(name) && !name.endsWith("/.env.example") && name !== ".env.example" ||
    /^(project files|uploads|logs|backups)\//.test(name) ||
    /(^|\/)(meterflo\.instance\.json|meterflo\.activation\.json|meterflo-stage-receipt\.json|ecosystem\.config\.cjs)$/.test(name) ||
    /\.(db|sqlite|sqlite3|dump|bak)$/.test(name);
}
export async function coreIdentity(git: ReviewGit, cwd: string, commit: string, tag: string): Promise<CoreIdentity> {
  if (!commitPattern.test(commit) || !tagPattern.test(tag)) throw new Error("Select an exact numbered tag and full 40-character commit.");
  const json = async (file: string) => {
    try { return JSON.parse(await gitText(git, cwd, ["show", `${commit}:${file}`])); }
    catch { throw new Error(`Core ${file} is unavailable or invalid; verify the selected release.`); }
  };
  const pkg = await json("package.json"), lock = await json("package-lock.json"), metadata = await json("meterflo.release.json");
  if (pkg.version !== tag.slice(1)) throw new Error("Core tag and package version must agree.");
  validateDependencyLock(pkg, lock);
  if (!Number.isSafeInteger(metadata.schemaVersion) || metadata.schemaVersion < 1 ||
      metadata.extensionApiVersion !== 1 || !Array.isArray(metadata.migrations) ||
      new Set(metadata.migrations.map((m: any) => m?.id)).size !== metadata.migrations.length)
    throw new Error("Core release schema/API/migration metadata is invalid.");
  for (const m of metadata.migrations) {
    if (!m || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(m.id) || m.ownership !== "core" ||
        typeof m.reversible !== "boolean" || !/^[a-f0-9]{64}$/.test(m.sha256) ||
        typeof m.file !== "string" || !/^migrations\/[a-zA-Z0-9_./-]+\.sql$/.test(m.file) || m.file.split("/").includes(".."))
      throw new Error("Core migration ownership/path/checksum declaration is invalid.");
    const mode = await gitText(git, cwd, ["ls-tree", commit, "--", m.file]);
    if (!/^100(644|755) blob /.test(mode)) throw new Error("Core migration must be a regular tracked SQL file.");
    const bytes = await gitText(git, cwd, ["show", `${commit}:${m.file}`]);
    if (createHash("sha256").update(bytes).digest("hex") !== m.sha256)
      throw new Error("Core migration bytes do not match the declared checksum; no normalization or approval was performed.");
  }
  const files = (await gitText(git, cwd, ["ls-tree", "-r", "--name-only", "-z", commit])).split("\0").filter(Boolean);
  if (files.some(protectedSourceFile)) throw new Error("Core release tracks protected instance/data files; reconcile ownership before preparing it.");
  return { ...metadata, version: pkg.version };
}
