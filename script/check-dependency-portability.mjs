import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dependencyNames = new Set([
  "package.json", "package-lock.json", "npm-shrinkwrap.json", ".npmrc",
  "pnpm-lock.yaml", "pnpm-workspace.yaml", "yarn.lock", ".yarnrc", ".yarnrc.yml", "bun.lock",
]);
const excludedDirectories = new Set([
  ".git", "node_modules", "dist", ".cache", ".local", ".agents", "logs", "generated-artifacts",
  "Project Files", "Mobile APK Releases", "attached_assets",
]);
export function isDependencyConfiguration(file) {
  return dependencyNames.has(path.posix.basename(file.replaceAll("\\", "/")));
}
function internalDownload(text) {
  // Parse the host only. Never return URLs, credentials, query strings or source text.
  for (const token of text.replaceAll("\\/", "/").match(/(?:https?:)?\/\/[^\s"'<>]+/gi) || []) {
    try {
      const host = new URL(token.startsWith("//") ? `https:${token}` : token).hostname.toLowerCase().replace(/\.$/, "");
      if (host === "replit.internal" || host.endsWith(".replit.internal")) return true;
    } catch { /* Non-URL syntax is handled separately for JSON files. */ }
  }
  return false;
}
export function scanDependencyText(file, text) {
  let blocked = internalDownload(text);
  if (file.endsWith(".json")) {
    let value;
    try { value = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { return [{file, rule:"invalid-dependency-json"}]; }
    const visit = (item) => {
      if (typeof item === "string") blocked ||= internalDownload(item);
      else if (Array.isArray(item)) item.forEach(visit);
      else if (item && typeof item === "object") Object.values(item).forEach(visit);
    };
    visit(value); // Includes decoded Unicode escapes and nested legacy lockfile entries.
  }
  return blocked ? [{file, rule:"internal-package-download-host"}] : [];
}
function git(root, args) {
  return execFileSync("git", args, {cwd:root, encoding:"utf8", stdio:["ignore","pipe","ignore"], maxBuffer:32*1024*1024});
}
function distributionFiles(root, relative = "") {
  return fs.readdirSync(path.join(root, relative), {withFileTypes:true}).flatMap(entry => {
    const name = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return excludedDirectories.has(entry.name) ? [] : distributionFiles(root, name);
    return isDependencyConfiguration(name) ? [name] : [];
  });
}
export function checkDependencyPortability(root, {staged = false, filesOnly = false} = {}) {
  if (staged && filesOnly) throw new Error("Conflicting check modes");
  const files = filesOnly ? distributionFiles(root) : git(root, staged
    ? ["ls-files", "--cached", "-z"]
    : ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(isDependencyConfiguration);
  const findings = [];
  const readable = new Set();
  const stagedLinks = staged ? new Set(git(root, ["ls-files", "--stage", "-z"]).split("\0")
    .map(entry => /^120000 [0-9a-f]+ [0-3]\t(.*)$/s.exec(entry)?.[1]).filter(Boolean)) : new Set();
  for (const file of new Set(files)) {
    let text;
    if (stagedLinks.has(file)) {
      findings.push({file, rule:"unverified-dependency-file"}); continue;
    }
    if (staged) text = git(root, ["show", `:${file}`]);
    else {
      const absolute = path.resolve(root, file);
      if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error("File outside distribution");
      let stat;
      try {stat = fs.lstatSync(absolute);}
      catch (error) {if (error.code === "ENOENT") continue; throw error;}
      if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16*1024*1024) {
        findings.push({file, rule:"unverified-dependency-file"}); continue;
      }
      text = fs.readFileSync(absolute, "utf8");
    }
    readable.add(file);
    findings.push(...scanDependencyText(file, text));
  }
  if (!readable.has("package.json")) findings.push({file:"package.json", rule:"missing-dependency-manifest"});
  if (!readable.has("package-lock.json") && !readable.has("npm-shrinkwrap.json"))
    findings.push({file:"package-lock.json", rule:"missing-npm-lockfile"});
  return findings;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => !["--staged", "--files"].includes(arg))) throw new Error("Invalid arguments");
    const findings = checkDependencyPortability(process.cwd(), {
      staged:args.includes("--staged"), filesOnly:args.includes("--files"),
    });
    console.log(JSON.stringify({checked:args.includes("--staged") ? "index" : args.includes("--files") ? "distribution" : "working-tree",
      findings, passed:findings.length === 0}, null, 2));
    process.exitCode = findings.length ? 1 : 0;
  } catch {
    console.error("Dependency portability check could not complete. Check arguments, Git metadata and file access; no source values were printed.");
    process.exitCode = 2;
  }
}
