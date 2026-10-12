import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { privateEnvironmentPath, privateConfigPath, scanText } from "./secret-patterns.mjs";

export function git(root, args, input = undefined) {
  return execFileSync("git", args, { cwd: root, input, encoding: "utf8",
    stdio: ["pipe", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 });
}

export function checkRepository(root, { staged = false, config } = {}) {
  config = config?.replaceAll("\\", "/");
  const findings = [];
  const tracked = git(root, ["ls-files", "-z"]).split("\0").filter(Boolean);
  // An ignore rule does not protect secrets already in the index.
  for (const file of tracked) if (privateEnvironmentPath(file) || privateConfigPath(file))
    findings.push({ file, rule: "private-file-tracked", blocking: true });
  const safePaths = [".env.example", "deploy/ecosystem.config.example.cjs"];
  const probe = [".env", ".env.production", ".env.development", ".env.production.local", "nested/.env.staging",
    "deploy/ecosystem.config.cjs", "generated-artifacts/probe.json"];
  let ignored;
  try { ignored = git(root, ["check-ignore", "--no-index", "-z", "--stdin"], [...probe, ...safePaths].join("\0") + "\0"); }
  catch (error) { if (error.status !== 1) throw error; ignored = error.stdout.toString(); }
  const protectedPaths = new Set(ignored.split("\0"));
  for (const file of probe) if (!protectedPaths.has(file))
    findings.push({ file, rule: "missing-ignore-protection", blocking: true });
  for (const file of safePaths) if (protectedPaths.has(file))
    findings.push({ file, rule: "safe-template-ignored", blocking: true });
  if (staged) {
    // Never let an unstaged ignore edit conceal weaker committed protections.
    if (git(root, ["show", ":.gitignore"]) !== fs.readFileSync(path.join(root, ".gitignore"), "utf8"))
      findings.push({ file: ".gitignore", rule: "ignore-rules-not-staged", blocking: true });
  }
  const files = staged
    ? git(root, ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]).split("\0").filter(Boolean)
    : git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
  if (config) files.push(config.replaceAll("\\", "/"));
  for (const file of new Set(files)) {
    if (privateEnvironmentPath(file) || (privateConfigPath(file) && file !== config)) {
      if (!tracked.includes(file))
        findings.push({ file, rule: "private-file-not-ignored", blocking: true });
      continue;
    }
    let text;
    if (staged && file !== config) text = git(root, ["show", `:${file}`]);
    else {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error("Configuration must be inside repository");
      if (!fs.existsSync(absolute)) continue; // Tracked deletion; no content can be committed.
      const stat = fs.lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        findings.push({ file, rule: "unverified-symbolic-link", blocking: true }); continue;
      }
      if (stat.size > 10 * 1024 * 1024) {
        findings.push({ file, rule: "unverified-large-file", blocking: true }); continue;
      }
      text = fs.readFileSync(absolute).toString("utf8");
    }
    if (text.includes("\0")) continue; // No binary/OCR detection claimed.
    findings.push(...scanText(file, text).filter(finding => finding.blocking));
  }
  return findings;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    const configIndex = args.indexOf("--config");
    if (args.some((arg, i) => !["--staged", "--config"].includes(arg) && (configIndex < 0 || i !== configIndex + 1)) ||
        (configIndex >= 0 && (!args[configIndex + 1] || args[configIndex + 1].startsWith("--")))) throw new Error("Invalid arguments");
    const root = git(process.cwd(), ["rev-parse", "--show-toplevel"]).trim();
    if (configIndex >= 0 && !fs.existsSync(path.resolve(root, args[configIndex + 1]))) throw new Error("Missing configuration");
    const findings = checkRepository(root, { staged: args.includes("--staged"), config: configIndex >= 0 ? args[configIndex + 1] : undefined });
    console.log(JSON.stringify({ checked: args.includes("--staged") ? "index" : "working-tree",
      findings, passed: findings.length === 0 }, null, 2));
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error("Deployment secret check could not complete. Check Git metadata, file access and arguments; no source values were printed.");
    process.exitCode = 2;
  }
}
