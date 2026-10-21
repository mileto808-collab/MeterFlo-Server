import fs from "node:fs/promises";
import { createWriteStream, createReadStream } from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { finished } from "node:stream/promises";
import { createInterface } from "node:readline";
import archiver from "archiver";
import unzipper from "unzipper";
import { Transform } from "node:stream";
import { pool } from "../db";
import { runPgCommand } from "../pgBackup";
import { withBackupExclusive } from "../backups/lock";
import { auditedOperation } from "../auditService";
import { capture, type Snapshot } from "./capture";
import { rows, tableKey } from "./catalog";
import { captureFiles, digest, safeRelative, type PackageFile } from "./files";
import { cleanupPackageStages } from "./stage-cleanup";

export type Manifest = { format: "meterflo-project-package"; version: 1; packageId: string; createdAt: string;
  project: { id: number; name: string; databaseName: string }; snapshot: Omit<Snapshot, "project">;
  folder: string; roots: Record<string, string>; files: PackageFile[]; security: string[] };
const MAX_EXPANDED = 4 * 1024 ** 3, MAX_FILES = 50000;

export async function createProjectPackage(projectId: number) {
  return withBackupExclusive(() => auditedOperation("projectPackageBackup", "projects", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-project-package-"));
    const packageId = randomUUID(), prefix = `mf_pkg_${packageId.replaceAll("-", "").slice(0, 16)}`;
    const client = await pool.connect();
    let snapshot: Snapshot | undefined;
    try {
      await cleanupPackageStages(client);
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await client.query("SELECT pg_advisory_xact_lock(195378,$1)", [projectId]);
      snapshot = await capture(client, projectId, prefix);
      const captured = await captureFiles(client, snapshot.project, directory);
      const manifest: Manifest = { format: "meterflo-project-package", version: 1, packageId, createdAt: new Date().toISOString(),
        project: { id: projectId, name: snapshot.project.name, databaseName: snapshot.project.database_name },
        snapshot: { tables: snapshot.tables, schemas: snapshot.schemas, counts: snapshot.counts },
        folder: captured.folder, roots: captured.roots, files: captured.files,
        security: ["No other projects or instance settings", "Login and transfer credentials excluded; imported users are inactive",
          "MeterFlo restores pause automatic imports, exports and customer delivery", "Checksums establish integrity, not authenticity"] };
      for (const table of snapshot.tables) {
        const name = `data/${table.schema === "public" ? "public" : table.schema === "meterflo_audit" ? "history" : "work"}/${table.name}.jsonl`;
        if (!safeRelative(name)) throw new Error("Unsupported table name in portable package.");
        await fs.mkdir(path.dirname(path.join(directory, name)), { recursive: true, mode: 0o700 });
        const file = await fs.open(path.join(directory, name), "wx", 0o600);
        try { for await (const row of rows(client, snapshot.schemas[table.schema], table)) await file.writeFile(JSON.stringify(row) + "\n"); }
        finally { await file.close(); }
        manifest.files.push({ path: name, size: (await fs.stat(path.join(directory, name))).size, sha256: await digest(path.join(directory, name)) });
      }
      await client.query("COMMIT");
      const connection = new URL(process.env.DATABASE_URL!);
      const dumped = await runPgCommand("pg_dump", ["-h", connection.hostname, "-p", connection.port || "5432",
        "-U", decodeURIComponent(connection.username), "-d", decodeURIComponent(connection.pathname.slice(1)),
        "--format=custom", "--no-owner", "--no-acl", ...Object.values(snapshot.schemas).flatMap(schema => ["--schema", schema])],
      { PGPASSWORD: decodeURIComponent(connection.password) }, path.join(directory, "project.backup"));
      if (!dumped.success) throw new Error("Could not create the native PostgreSQL project archive. Check PostgreSQL tool availability/version.");
      const readme = `METERFLO COMPLETE SINGLE-PROJECT BACKUP
Project: ${snapshot.project.name}
Created (UTC): ${manifest.createdAt}
Package identity: ${packageId}

This ZIP contains one project's relational data, work orders, inventory (including
previously enabled inventory), logs, audit history and project-owned files.
Shared rows are included only as required references; unrelated project data,
instance settings, working passwords, transfer tokens and private keys are not included.
Application functions, views and login configuration come from the MeterFlo installation.
Keep this archive private: project data and historical audit evidence are sensitive.

PGADMIN / POSTGRESQL ANALYSIS
1. Extract the ZIP. Create an EMPTY PostgreSQL database in pgAdmin.
2. Right-click that database > Restore. Select project.backup (Custom format).
   Use No owner and No privileges; use pg_restore matching or newer than pg_dump.
3. Refresh Schemas. The archive has three self-contained namespaces:
   ${snapshot.schemas.public} : project + referenced public/inventory tables
   ${snapshot.schemas[snapshot.project.database_name]} : project work-order tables
   ${snapshot.schemas.meterflo_audit} : original project audit history
4. For example, open Query Tool:
   SELECT * FROM "${snapshot.schemas[snapshot.project.database_name]}".work_orders;
   SELECT * FROM "${snapshot.schemas.public}".projects;
   SELECT * FROM "${snapshot.schemas.meterflo_audit}".events ORDER BY occurred_at;
   Original row identities, constraints, indexes and generated-ID sequences are retained.
5. PostgreSQL does not restore the files/ directory onto the filesystem. That directory
   contains the matching documents, FTP incoming/outgoing files, inspection photos and
   secure-exchange objects. See manifest.json for paths, row counts and SHA-256 checksums.
This analytical database is not a replacement for installing/running MeterFlo.

METERFLO (WINDOWS, LINUX OR REPLIT)
1. Install/update MeterFlo normally. Keep its own administrator; this package does not
   replace users, credentials, site settings, other projects or the local audit trail.
2. Create an EMPTY destination project. In Settings > System > Backup & Restore >
   Project Databases choose Restore for that empty project, then select this ZIP.
3. The destination project keeps its name and database identity. MeterFlo copies the
   project's settings/data/files and maps relational identities safely. A nonempty
   destination is rejected rather than destructively overwritten. Legacy JSON restore
   remains available separately.
   If the source used a separate FTP root, configure separate destination FTP storage
   before restoring when needed to prevent collisions with old FTP files retained in
   the document tree. Existing destination files are never overwritten.
4. Review inactive imported user/group identities and assign real destination users.
   Re-enter integration credentials. Review and explicitly re-enable paused file/API
   imports, exports, HTTPS/SFTP access and customer delivery when appropriate.
5. Imported historical audit entries are marked as imported evidence with source package,
   original event/operation identities and timestamps, separate from the authenticated
   restore action. They never replace the destination's existing audit history.

MeterFlo imports validated data files, not executable SQL from an uploaded archive.
SHA-256 checksums detect damaged/incomplete files; they do not authenticate the sender.
Unknown versions/schema fields, missing bytes, unsafe paths and linked files are refused.
`;
      await fs.writeFile(path.join(directory, "README.txt"), readme, { mode: 0o600 });
      for (const name of ["project.backup", "README.txt"])
        manifest.files.push({ path: name, size: (await fs.stat(path.join(directory, name))).size, sha256: await digest(path.join(directory, name)) });
      const encodedManifest = JSON.stringify(manifest, null, 2);
      if (manifest.files.length + 1 > 50_000 || manifest.files.reduce((size, file) => size + file.size, 0) > 4 * 1024 ** 3 ||
        Buffer.byteLength(encodedManifest) > 16 * 1024 ** 2)
        throw new Error("Project exceeds the current complete-package limits (50,000 entries / 4 GiB expanded / 16 MiB manifest). No incomplete backup was produced.");
      await fs.writeFile(path.join(directory, "manifest.json"), encodedManifest, { mode: 0o600 });
      if (new Set(manifest.files.map(file => file.path.toLowerCase())).size !== manifest.files.length)
        throw new Error("Project filenames differ only by case and cannot be restored safely across Windows/Linux. Rename the conflicting files before backing up.");
      const zip = path.join(directory, "complete-project.zip"), stream = createWriteStream(zip, { mode: 0o600 });
      const archive = archiver("zip", { zlib: { level: 6 } });
      const complete = finished(stream);
      archive.on("error", error => stream.destroy(error)); stream.once("error", () => archive.abort()); archive.pipe(stream);
      for (const file of [...manifest.files, { path: "manifest.json" }]) archive.file(path.join(directory, file.path), { name: file.path });
      await Promise.all([archive.finalize(), complete]);
      if ((await fs.stat(zip)).size > 2 * 1024 ** 3)
        throw new Error("Project ZIP exceeds the current 2 GiB restore upload limit. No unusable backup was delivered.");
      return { directory, zip, manifest };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      await fs.rm(directory, { recursive: true, force: true }); throw error;
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      for (const name of snapshot ? Object.values(snapshot.schemas) : [`${prefix}_data`, `${prefix}_work`, `${prefix}_history`])
        await client.query(`DROP SCHEMA IF EXISTS "${name}" CASCADE`).catch(() => {});
      client.release();
    }
  }, projectId));
}

export async function openProjectPackage(zip: string) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-project-import-"));
  try {
    const archive = await unzipper.Open.file(zip);
    if (archive.files.length > MAX_FILES) throw new Error("Project package contains too many files.");
    const names = new Set<string>(); let expanded = 0;
    for (const file of archive.files) {
      if (file.type !== "File" || !safeRelative(file.path) || names.has(file.path) ||
        (((file as any).externalFileAttributes >>> 16) & 0o170000) === 0o120000) throw new Error("Unsafe or duplicate ZIP entry.");
      names.add(file.path); expanded += file.uncompressedSize;
      if (expanded > MAX_EXPANDED) throw new Error("Project package exceeds the 4 GiB expanded limit.");
    }
    if (new Set([...names].map(name => name.toLowerCase())).size !== names.size) throw new Error("Case-conflicting ZIP filenames are not portable.");
    const manifestEntry = archive.files.find(file => file.path === "manifest.json");
    if (!manifestEntry || manifestEntry.uncompressedSize > 16 * 1024 ** 2) throw new Error("Missing or oversized package manifest.");
    const chunks: Buffer[] = []; let manifestBytes = 0;
    for await (const chunk of manifestEntry.stream()) {
      manifestBytes += chunk.length;
      if (manifestBytes > 16 * 1024 ** 2) throw new Error("Oversized package manifest.");
      chunks.push(chunk);
    }
    const manifest = JSON.parse(Buffer.concat(chunks).toString()) as Manifest;
    if (manifest.format !== "meterflo-project-package" || manifest.version !== 1 || !Array.isArray(manifest.files) ||
      !Array.isArray(manifest.snapshot?.tables) || !Number.isSafeInteger(manifest.project?.id) || manifest.project.id <= 0 ||
      !/^project_[a-z0-9_]+$/.test(manifest.project.databaseName) || !/^[a-f0-9-]{36}$/.test(manifest.packageId) ||
      typeof manifest.project.name !== "string" || !safeRelative(manifest.folder) || manifest.folder.includes("/") ||
      !manifest.roots || !["documents", "ftp", "inventory"].every(kind => typeof manifest.roots[kind as keyof typeof manifest.roots] === "string"))
      throw new Error("Unsupported or invalid complete-project package.");
    if (manifest.files.length !== names.size - 1) throw new Error("Incomplete package file inventory.");
    const listed = new Set<string>();
    for (const file of manifest.files) {
      if (!safeRelative(file.path) || listed.has(file.path) || !names.has(file.path) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256))
        throw new Error("Invalid file inventory or checksum.");
      listed.add(file.path);
      const entry = archive.files.find(entry => entry.path === file.path)!;
      if (entry.uncompressedSize !== file.size) throw new Error("Package file size does not match its manifest.");
      const target = path.join(directory, file.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      const stream = createWriteStream(target, { flags: "wx", mode: 0o600 });
      let transferred = 0;
      const bounded = new Transform({ transform(chunk, _encoding, callback) {
        transferred += chunk.length;
        callback(transferred > file.size ? new Error("Expanded file exceeds its declared size.") : null, chunk);
      } });
      await (await import("node:stream/promises")).pipeline(entry.stream(), bounded, stream);
      if (await digest(target) !== file.sha256) throw new Error("Package checksum verification failed.");
      if (file.kind && !["documents", "ftp", "inventory", "exchange"].includes(file.kind)) throw new Error("Unsupported project file category.");
      if (file.kind === "exchange" && (!file.ref || !["local", "app_storage"].includes(file.ref.provider) ||
        !new RegExp(`^meterflo-exchange/${manifest.project.id}/[a-f0-9-]{36}\\.bin$`).test(file.key ?? ""))) throw new Error("Invalid exchange file identity.");
    }
    if (!listed.has("project.backup") || !listed.has("README.txt")) throw new Error("Incomplete native project archive.");
    return { directory, manifest };
  } catch (error) { await fs.rm(directory, { recursive: true, force: true }); throw error; }
}

export async function* packageRows(directory: string, manifest: Manifest, table: Snapshot["tables"][number]) {
  const group = table.schema === "public" ? "public" : table.schema === "meterflo_audit" ? "history" : "work";
  const file = `data/${group}/${table.name}.jsonl`;
  if (!safeRelative(file) || !manifest.files.some(entry => entry.path === file)) throw new Error(`Missing data for ${tableKey(table)}.`);
  let count = 0;
  const input = createReadStream(path.join(directory, file)), lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 64 * 1024 ** 2) throw new Error("A project record exceeds the 64 MiB import limit.");
      if (!line) throw new Error("Empty project data record.");
      const row = JSON.parse(line);
      if (!row || Array.isArray(row) || typeof row !== "object") throw new Error("Invalid project data record.");
      count++; yield row;
    }
  } finally { lines.close(); input.destroy(); }
  if (count !== manifest.snapshot.counts[tableKey(table)]) throw new Error(`Record count mismatch for ${tableKey(table)}.`);
}
