import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

export const EXTENSION_API_VERSION = 1;
export type Migration = { id: string; file: string; sha256: string; ownership: string; reversible: boolean };
export type ExtensionScreen = { id: string; title: string; report: string };
export type CustomerExtension = {
  id: string; name: string; version: string; directory: string; serverEntry: string;
  permission: string; screens: ExtensionScreen[]; minCoreVersion: string; maxCoreVersionExclusive: string;
  extensionApiVersion: number; migrations: Migration[]; contentHash: string;
};
export type CustomerRelease = {
  version: string; extensionApiVersion: number; schemaVersion: number; coreSource: string | null;
  extensions: CustomerExtension[]; migrations: Migration[]; blockers: string[];
  approvedMigrations: {id: string; sha256: string}[]; installedSchemaVersion: number | null;
};
export function compareReleaseVersions(a: string, b: string) {
  const parse = (s: string) => {
    if (!/^\d+\.\d+\.\d+$/.test(s)) throw new Error("Release versions must be major.minor.patch");
    const values=s.split(".").map(Number);
    if(values.some(v=>!Number.isSafeInteger(v) || v<0))throw new Error("Invalid release version components");
    return values;
  };
  const av = parse(a), bv = parse(b);
  for (let i=0;i<3;i++) if (av[i] !== bv[i]) return av[i] > bv[i] ? 1 : -1;
  return 0;
}
export function validateCoreSource(source: unknown): string | null {
  if (source === undefined || source === null || source === "") return null;
  if (typeof source !== "string") throw new Error("Invalid core source");
  let url: URL;
  try {url = new URL(source);} catch {throw new Error("Invalid core source URL");}
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("Core source must be an HTTPS Git URL without embedded credentials");
  return url.href;
}
export function ownedPath(root: string, relative: string) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes(".."))
    throw new Error("Package paths must remain within their owner directory");
  const base = fs.realpathSync(root), file = fs.realpathSync(path.resolve(root, relative));
  if (!file.startsWith(base + path.sep)) throw new Error("Package path escapes its owner directory");
  return file;
}
export function packageHash(root: string) {
  const hash = createHash("sha256");
  const walk = (dir: string, prefix: string) => {
    for (const entry of fs.readdirSync(dir, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      if (["node_modules",".git","dist",".cache"].includes(entry.name)) continue;
      if (entry.isSymbolicLink()) throw new Error("Customer packages must not contain symbolic links");
      if (entry.name.startsWith(".env") || entry.name === ".npmrc") throw new Error("Private configuration does not belong in customer package source");
      const file = path.join(dir,entry.name), name = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(file,name);
      else if (entry.isFile()) {hash.update(name);hash.update("\0");hash.update(fs.readFileSync(file));hash.update("\0");}
    }
  };
  walk(root,""); return hash.digest("hex");
}
function readJson(file: string): any {
  try{return JSON.parse(fs.readFileSync(file,"utf8"));}
  catch{throw new Error("Customer/core JSON could not be read; check file access and structure without sharing private values");}
}
function migrationList(root: string, entries: any, owner: string): Migration[] {
  if (!Array.isArray(entries)) throw new Error("Migration declarations must be an array");
  return entries.map(m => {
    if (!m || typeof m.id !== "string" || !/^[a-z0-9][a-z0-9._-]{0,95}$/.test(m.id) ||
        !/^[a-f0-9]{64}$/.test(m.sha256) || m.ownership !== owner || typeof m.reversible !== "boolean")
      throw new Error("Invalid migration ownership or checksum declaration");
    const file = ownedPath(root,m.file);
    if (!file.endsWith(".sql") || createHash("sha256").update(fs.readFileSync(file)).digest("hex") !== m.sha256)
      throw new Error("Migration file does not match its declared checksum");
    return {id:m.id,file:m.file,sha256:m.sha256,ownership:owner,reversible:m.reversible};
  });
}
export function loadCustomerRelease(root = process.cwd(), instanceFile = path.join(root,"meterflo.instance.json"), coreRoot = root): CustomerRelease {
  const pkg = readJson(path.join(coreRoot,"package.json"));
  compareReleaseVersions(pkg.version,pkg.version);
  const core = readJson(path.join(coreRoot,"meterflo.release.json"));
  if (core.extensionApiVersion !== EXTENSION_API_VERSION || !Number.isSafeInteger(core.schemaVersion) || core.schemaVersion < 1)
    throw new Error("Unsupported core release metadata");
  const instance = fs.existsSync(instanceFile) ? readJson(instanceFile) : {extensions:[]};
  if(Object.keys(instance).some(key=>!["coreSource","extensions","approvedMigrations","installedSchemaVersion"].includes(key)))
    throw new Error("Instance manifest supports release configuration only; keep credentials in the protected environment and business settings in the database");
  if(instance.installedSchemaVersion!==undefined && (!Number.isSafeInteger(instance.installedSchemaVersion) || instance.installedSchemaVersion<1))
    throw new Error("Invalid declared schema version");
  if (!Array.isArray(instance.extensions)) throw new Error("Customer extension declarations must be an array");
  const approvals = instance.approvedMigrations ?? [];
  if (!Array.isArray(approvals) || approvals.some((m:any)=> !m || typeof m.id !== "string" || !/^[a-f0-9]{64}$/.test(m.sha256)))
    throw new Error("Invalid migration approvals");
  const blockers: string[] = [], ids = new Set<string>();
  const extensions: CustomerExtension[] = instance.extensions.map((item:any) => {
    const dir = ownedPath(root,item.directory), extensionPackage = readJson(path.join(dir,"package.json"));
    const x = extensionPackage.meterfloExtension;
    if (!x || !/^[a-z][a-z0-9-]{1,47}$/.test(x.id) || ids.has(x.id)) throw new Error("Invalid or duplicate extension identifier");
    ids.add(x.id); compareReleaseVersions(extensionPackage.version,extensionPackage.version);
    if (typeof extensionPackage.name !== "string" || typeof x.permission !== "string" || !Array.isArray(x.screens) ||
        !x.screens.length || x.screens.length > 20 || new Set(x.screens.map((s:any)=>s.id)).size !== x.screens.length ||
        x.screens.some((s:any)=>!s || !/^[a-z][a-z0-9-]{1,47}$/.test(s.id) || !/^[a-z][a-z0-9-]{1,47}$/.test(s.report) ||
          typeof s.title !== "string" || !s.title.trim() || s.title.length > 100))
      throw new Error("Invalid extension permission or screen declarations");
    const entry = ownedPath(dir,x.serverEntry);
    if (!/\.(mjs|js|ts)$/.test(entry)) throw new Error("Unsupported extension entry type");
    if (x.extensionApiVersion !== EXTENSION_API_VERSION || compareReleaseVersions(pkg.version,x.minCoreVersion) < 0 ||
        compareReleaseVersions(pkg.version,x.maxCoreVersionExclusive) >= 0) blockers.push(`Extension ${x.id} is incompatible with core ${pkg.version}`);
    const migrations = migrationList(dir,x.migrations ?? [],`extension:${x.id}`);
    return {id:x.id,name:extensionPackage.name,version:extensionPackage.version,directory:item.directory,serverEntry:x.serverEntry,
      permission:x.permission,screens:x.screens,minCoreVersion:x.minCoreVersion,maxCoreVersionExclusive:x.maxCoreVersionExclusive,
      extensionApiVersion:x.extensionApiVersion,migrations,contentHash:packageHash(dir)};
  });
  const migrations = [...migrationList(coreRoot,core.migrations,"core"),...extensions.flatMap(x=>x.migrations)];
  if (new Set(migrations.map(m=>m.id)).size !== migrations.length) throw new Error("Migration identifiers must be unique across owners");
  for (const m of migrations) if (!approvals.some((a:any)=>a.id === m.id && a.sha256 === m.sha256))
    blockers.push(`Migration ${m.id} requires reviewed application and checksum approval; no SQL will be applied automatically`);
  return {version:pkg.version,extensionApiVersion:core.extensionApiVersion,schemaVersion:core.schemaVersion,
    coreSource:validateCoreSource(instance.coreSource),extensions,migrations,blockers,approvedMigrations:approvals,
    installedSchemaVersion:instance.installedSchemaVersion ?? null};
}
export function publicRelease(release: CustomerRelease) {
  return {version:release.version,extensionApiVersion:release.extensionApiVersion,schemaVersion:release.schemaVersion,
    coreSource:release.coreSource,extensions:release.extensions.map(({directory,serverEntry,migrations,...x})=>x),
    migrations:release.migrations.map(({file,...m})=>m),blockers:release.blockers,
    installedSchemaVersion:release.installedSchemaVersion};
}
