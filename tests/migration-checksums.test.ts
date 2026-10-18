import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { inspectMigrationBytes, migrationHash } from "../shared/migration-integrity";
import { loadCustomerRelease } from "../shared/customer-release";
import { checkMigrationFiles } from "../script/migration-checksums";

const sql = Buffer.from("-- Reviewed migration\nSELECT 'café';\n", "utf8");
const checksum = migrationHash(sql);
const crlf = Buffer.from(sql.toString("utf8").replace(/\n/g, "\r\n"));
const cli = path.resolve("script/migration-checksums.ts");
const tsx = path.resolve("node_modules/tsx/dist/cli.mjs");
const build = path.resolve("script/build.ts");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meterflo-checksum path-"));
  const write = (file: string, data: string | Buffer | object) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), typeof data === "object" && !Buffer.isBuffer(data) ? JSON.stringify(data) : data as string | Buffer);
  };
  const migration = { id: "core.fixture", ownership: "core", file: "migrations/fixture.sql", sha256: checksum, reversible: false };
  write("package.json", { name: "checksum-fixture", version: "2.1.1", type: "module" });
  write("package-lock.json", { name: "checksum-fixture", version: "2.1.1", lockfileVersion: 3, packages: {} });
  write("meterflo.release.json", { extensionApiVersion: 1, schemaVersion: 2, migrations: [migration] });
  write("meterflo.instance.json", { installedSchemaVersion: 2, extensions: [], approvedMigrations: [{ id: migration.id, sha256: checksum }] });
  write(migration.file, sql);
  write(".env", "PRIVATE_CONFIGURATION_FIXTURE");
  write("customer-local.txt", "CUSTOMER_MODIFICATION_FIXTURE");
  write("dist/index.cjs", "PREVIOUS_HEALTHY_BUILD");
  const run = (...args: string[]) => spawnSync(process.execPath, [tsx, cli, ...args], { cwd: root, encoding: "utf8", timeout: 30000 });
  const addExtension = () => {
    fs.cpSync(path.resolve("examples/customer-report"), path.join(root, "customer-packages/project-report"), { recursive: true });
    const file = "customer-packages/project-report/package.json";
    const pkg = JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
    pkg.meterfloExtension.migrations = [{ ...migration, id: "extension.fixture", ownership: "extension:project-report", file: "migration.sql" }];
    write(file, pkg);
    write("customer-packages/project-report/migration.sql", sql);
    const instance = JSON.parse(fs.readFileSync(path.join(root, "meterflo.instance.json"), "utf8"));
    instance.extensions = [{ directory: "customer-packages/project-report" }];
    instance.approvedMigrations.push({ id: "extension.fixture", sha256: checksum });
    write("meterflo.instance.json", instance);
  };
  return { root, write, migration, run, addExtension, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("byte inspection permits only an exact CRLF-to-LF checksum recovery", () => {
  assert.equal(inspectMigrationBytes(sql, checksum).status, "match");
  const result = inspectMigrationBytes(crlf, checksum);
  assert.equal(result.status, "crlf-only");
  assert.deepEqual(result.corrected, sql);
  for (const bytes of [
    Buffer.from(sql.toString().replace("SELECT", "DELETE")),
    Buffer.from(sql.toString().replace("café", "cafe").replace(/\n/g, "\r\n")),
    Buffer.from(sql.toString().trimEnd()),
    Buffer.from(sql.toString().replace(/\n/g, "\r")),
  ]) {
    assert.equal(inspectMigrationBytes(bytes, checksum).status, "mismatch");
    assert.equal(inspectMigrationBytes(bytes, checksum).corrected, null);
  }
  for (const bytes of [Buffer.from([0xff, 0xfe, 0x61, 0x00]), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), crlf]), Buffer.from([0xff])]) {
    assert.equal(inspectMigrationBytes(bytes, checksum).status, "unsupported-encoding");
    assert.equal(inspectMigrationBytes(bytes, checksum).corrected, null);
  }
});

test("strict release loading names the migration without silently normalizing it", () => {
  const f = fixture();
  try {
    assert.deepEqual(loadCustomerRelease(f.root).blockers, []);
    f.write(f.migration.file, crlf);
    assert.throws(() => loadCustomerRelease(f.root), /core\/core.fixture.*migrations\/fixture.sql.*CRLF-to-LF/);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.migration.file)), crlf);
    f.write(f.migration.file, Buffer.from("SELECT 'PRIVATE_SQL_FIXTURE';\r\n"));
    assert.throws(() => loadCustomerRelease(f.root), error =>
      error instanceof Error && /Not a verified line-ending-only mismatch/.test(error.message) && !error.message.includes("PRIVATE_SQL_FIXTURE"));
  } finally { f.cleanup(); }
});

test("read-only CLI reports hashes, changes nothing, and exits nonzero on mismatch", () => {
  const f = fixture();
  try {
    f.write(f.migration.file, crlf);
    const files = [f.migration.file, "meterflo.release.json", "meterflo.instance.json", ".env", "customer-local.txt", "dist/index.cjs"];
    const snapshot = () => files.map(file => migrationHash(fs.readFileSync(path.join(f.root, file))));
    const before = snapshot();
    const result = f.run("--check");
    assert.equal(result.status, 1);
    const report = JSON.parse(result.stdout.split("\n")[0]);
    assert.equal(report.owner, "core");
    assert.equal(report.expected, checksum);
    assert.equal(report.actual, migrationHash(crlf));
    assert.equal(report.lfHash, checksum);
    assert.equal(report.status, "crlf-only");
    assert.deepEqual(snapshot(), before);
    assert.equal(fs.existsSync(path.join(f.root, "generated-artifacts")), false);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE_CONFIGURATION_FIXTURE|café/);
  } finally { f.cleanup(); }
});

test("explicit core repair retains original-byte backup, approvals, settings, customer edits and previous build", () => {
  const f = fixture();
  try {
    f.write(f.migration.file, crlf);
    const preserved = ["meterflo.release.json", "meterflo.instance.json", ".env", "customer-local.txt", "dist/index.cjs"]
      .map(file => [file, fs.readFileSync(path.join(f.root, file))] as const);
    const result = f.run("--repair-core", f.migration.id);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.migration.file)), sql);
    const backupDir = path.join(f.root, "generated-artifacts/migration-checksum-backups");
    assert.equal(fs.readdirSync(backupDir).length, 1);
    assert.deepEqual(fs.readFileSync(path.join(backupDir, fs.readdirSync(backupDir)[0])), crlf);
    for (const [file, bytes] of preserved) assert.deepEqual(fs.readFileSync(path.join(f.root, file)), bytes, file);
    assert.deepEqual(loadCustomerRelease(f.root).blockers, []);
    assert.equal(f.run("--repair-core", f.migration.id).status, 0);
    assert.equal(fs.readdirSync(backupDir).length, 1, "Repeated repair is a no-op");
    assert.equal(f.run("--check").status, 0);
  } finally { f.cleanup(); }
});

test("modified SQL, wrong manifests, unsupported encodings and invalid repair arguments remain blocked", () => {
  const f = fixture();
  try {
    for (const bytes of [Buffer.from("DELETE FROM important;\r\n"), Buffer.from([0xff, 0xfe, 0x00]), Buffer.concat([crlf, Buffer.from("\r\n")])]) {
      f.write(f.migration.file, bytes);
      const result = f.run("--repair-core", f.migration.id);
      assert.equal(result.status, 1);
      assert.deepEqual(fs.readFileSync(path.join(f.root, f.migration.file)), bytes);
    }
    f.write(f.migration.file, crlf);
    f.write("meterflo.release.json", { extensionApiVersion: 1, schemaVersion: 2, migrations: [{ ...f.migration, sha256: "0".repeat(64) }] });
    assert.equal(f.run("--repair-core", f.migration.id).status, 1);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.migration.file)), crlf);
    for (const args of [["--repair-core"], ["--force"], ["--repair-core", "../outside"], ["--check", "--repair-core", f.migration.id]])
      assert.equal(f.run(...args).status, 1);
    assert.equal(fs.existsSync(path.join(f.root, "generated-artifacts")), false);
  } finally { f.cleanup(); }
});

test("extension mismatches are identified and never rewritten; preflight blocks partial core repair", () => {
  const f = fixture();
  try {
    f.addExtension();
    f.write("customer-packages/project-report/migration.sql", crlf);
    assert.throws(() => loadCustomerRelease(f.root), /extension:project-report\/extension.fixture.*migration.sql/);
    const result = f.run("--check");
    assert.equal(result.status, 1);
    assert.match(result.stdout, /"owner":"extension:project-report"/);
    assert.equal(f.run("--repair-core", "extension.fixture").status, 1);
    f.write(f.migration.file, crlf);
    assert.equal(f.run("--repair-core", f.migration.id).status, 1);
    assert.deepEqual(fs.readFileSync(path.join(f.root, f.migration.file)), crlf);
    assert.deepEqual(fs.readFileSync(path.join(f.root, "customer-packages/project-report/migration.sql")), crlf);
    assert.equal(fs.existsSync(path.join(f.root, "generated-artifacts")), false);
    f.write("customer-packages/project-report/migration.sql", sql);
    assert.equal(f.run("--repair-core", f.migration.id).status, 0);
    assert.deepEqual(loadCustomerRelease(f.root).blockers, []);
  } finally { f.cleanup(); }
});

test("a repaired checksum cannot approve a migration or bypass separate schema readiness", () => {
  const f = fixture();
  try {
    f.write("meterflo.instance.json", { extensions: [], installedSchemaVersion: 1, approvedMigrations: [] });
    f.write(f.migration.file, crlf);
    assert.equal(f.run("--repair-core", f.migration.id).status, 0);
    const release = loadCustomerRelease(f.root);
    assert.equal(release.installedSchemaVersion, 1);
    assert.match(release.blockers.join(), /requires reviewed application and checksum approval/);
    assert.deepEqual(release.approvedMigrations, []);
  } finally { f.cleanup(); }
});

test("real Git autocrlf checkouts preserve declared core SQL bytes without changing customer files", () => {
  const f = fixture();
  const git = (root: string, ...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  try {
    f.write(".gitattributes", fs.readFileSync(".gitattributes"));
    f.write("migrations/nested/nested.sql", sql);
    git(f.root, "init", "-q");
    git(f.root, "config", "user.name", "Fixture");
    git(f.root, "config", "user.email", "fixture@example.invalid");
    git(f.root, "-c", "core.autocrlf=false", "add", ".");
    git(f.root, "commit", "-qm", "Fixture");
    for (const mode of ["true", "false", "input"]) {
      const clone = path.join(f.root, `checkout-${mode}`);
      git(f.root, "-c", `core.autocrlf=${mode}`, "clone", "-q", "--no-local", "--", f.root, clone);
      assert.deepEqual(fs.readFileSync(path.join(clone, f.migration.file)), sql, mode);
      // A directory-level migration rule must also cover future nested migrations.
      assert.deepEqual(fs.readFileSync(path.join(clone, "migrations/nested/nested.sql")), sql, mode);
      assert.deepEqual(loadCustomerRelease(clone).blockers, []);
    }
    f.write(f.migration.file, crlf);
    f.write("customer-local.txt", "Keep this direct customer edit");
    git(f.root, "add", "customer-local.txt");
    const index = git(f.root, "diff", "--cached");
    checkMigrationFiles(f.root, f.migration.id);
    assert.equal(git(f.root, "diff", "--cached"), index);
    assert.equal(fs.readFileSync(path.join(f.root, "customer-local.txt"), "utf8"), "Keep this direct customer edit");
  } finally { f.cleanup(); }
});

test("actual build rejects checksum changes before removing dist and the chained restart never executes", () => {
  const f = fixture();
  try {
    f.write(f.migration.file, crlf);
    f.write("script/check-dependency-portability.mjs", fs.readFileSync("script/check-dependency-portability.mjs"));
    const command = `"${process.execPath}" "${tsx}" "${build}" && "${process.execPath}" -e "require('fs').writeFileSync('restart-called','unexpected')"`;
    const result = spawnSync(command, { shell: true, cwd: f.root, encoding: "utf8", timeout: 30000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Migration file does not match its declared checksum/);
    assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "PREVIOUS_HEALTHY_BUILD");
    assert.equal(fs.existsSync(path.join(f.root, "restart-called")), false);
  } finally { f.cleanup(); }
});
