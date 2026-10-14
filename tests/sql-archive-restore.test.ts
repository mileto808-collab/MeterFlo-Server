import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import express from "express";
import multer from "multer";
import archiver from "archiver";
import unzipper from "unzipper";

// Run the actual route bodies with real multipart uploads and ZIP/file helpers.
// Extract only these declarations so importing the full application cannot
// initialize a database, run migrations, or touch shared project files.
function sourceFile(file: string) {
  return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
}
function compile(source: string) {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}
const routes = sourceFile("server/routes.ts");
const endpointNames = [
  "/api/system/restore", "/api/system/restore/init",
  "/api/system/restore/chunk", "/api/system/restore/finalize",
];
const endpointSources = new Map<string, string>();
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(routes) === "app.post" &&
      ts.isStringLiteral(node.arguments[0])) {
    const endpoint = node.arguments[0].text;
    if (endpointNames.includes(endpoint)) endpointSources.set(endpoint, node.getText(routes) + ";");
  }
  ts.forEachChild(node, visit);
}
visit(routes);
assert.equal(endpointSources.size, endpointNames.length, "all real restore endpoints located");

const pgSource = sourceFile("server/pgBackup.ts");
const helperNames = ["extractBackupFromArchive", "restoreFilesFromPgArchiveData"];
const helperSource = pgSource.statements.filter(node =>
  ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text || "")
).map(node => node.getText(pgSource).replace(/^export\s+/, "")).join("\n");
assert.equal(pgSource.statements.filter(node =>
  ts.isFunctionDeclaration(node) && helperNames.includes(node.name?.text || "")
).length, helperNames.length);

async function archive(format: string) {
  const zip = archiver("zip");
  const buffers: Buffer[] = [];
  zip.on("data", chunk => buffers.push(chunk));
  const finished = new Promise<Buffer>((resolve, reject) => {
    zip.on("end", () => resolve(Buffer.concat(buffers)));
    zip.on("error", reject);
  });
  zip.append("SELECT 1; -- never executed by these tests", { name: "database_backup.sql" });
  zip.append(JSON.stringify({ format, backupDate: "2026-10-14", schemas: ["fixture"] }),
    { name: "backup_metadata.json" });
  zip.append("replacement attachment", { name: "project_files/existing.txt" });
  zip.append("new attachment", { name: "project_files/new.txt" });
  await zip.finalize();
  return finished;
}

type Mode = "db-failure" | "db-throw" | "success" | "file-errors" | "path-throw" | "file-throw";
async function fixture(mode: Mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sql-archive-test-"));
  const filesRoot = path.join(root, "files");
  const sqlRoot = path.join(root, "sql");
  fs.mkdirSync(filesRoot);
  fs.mkdirSync(sqlRoot);
  fs.writeFileSync(path.join(filesRoot, "existing.txt"), "original attachment");
  // A directory where the archive expects a file forces a real write failure.
  if (mode === "file-errors") fs.mkdirSync(path.join(filesRoot, "new.txt"));
  let dbCalls = 0, pathCalls = 0, fileCalls = 0;
  const order: string[] = [];
  const sessions = new Map();
  const quietConsole = { log() {}, error() {}, warn() {} };
  const helpers = vm.createContext({
    fs, path, os: { tmpdir: () => sqlRoot }, unzipper, console: quietConsole,
  });
  vm.runInContext(compile(helperSource), helpers);
  const app = express();
  app.use(express.json());
  const context = vm.createContext({
    app, Buffer, fs: fs.promises, existsSync: fs.existsSync, unlinkSync: fs.unlinkSync,
    path, os: { tmpdir: () => sqlRoot }, console: quietConsole,
    randomUUID, chunkedUploadSessions: sessions,
    largeUpload: multer({ storage: multer.memoryStorage() }),
    chunkUpload: multer({ storage: multer.memoryStorage() }),
    isAuthenticated(req: any, _res: any, next: () => void) {
      req.user = { claims: { sub: "fixture-operator" } };
      next();
    },
    storage: {
      async getUser() { return { id: "fixture-operator" }; },
      async hasPermission() { return true; },
    },
    permissionKeys: { MAINTENANCE_SYSTEM_RESTORE: "fixture-restore" },
    SystemRestoreError: class extends Error {},
    extractBackupFromArchive: helpers.extractBackupFromArchive,
    async restorePgBackup(sqlFile: string, options: any) {
      dbCalls++;
      order.push("database");
      assert.equal(options.clearExisting, false, "tests never request database clearing");
      assert.ok(fs.existsSync(sqlFile));
      if (mode === "db-throw") throw new Error("forced database exception");
      return { success: mode !== "db-failure", error: mode === "db-failure" ? "forced database failure" : undefined,
        warnings: ["fixture database warning"] };
    },
    async getProjectFilesPath() {
      pathCalls++;
      order.push("path");
      if (mode === "path-throw") throw new Error("forced file path failure");
      return filesRoot;
    },
    async restoreFilesFromPgArchive(buffer: Buffer, target: string) {
      fileCalls++;
      order.push("files");
      assert.equal(target, filesRoot);
      if (mode === "file-throw") throw new Error("forced file helper failure");
      return helpers.restoreFilesFromPgArchiveData(buffer, target);
    },
  });
  vm.runInContext(compile([...endpointSources.values()].join("\n")), context);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    filesRoot, sqlRoot, sessions, order,
    counts: () => ({ dbCalls, pathCalls, fileCalls }),
    async upload(buffer: Buffer, chunked: boolean, restoreFiles = true) {
      if (!chunked) {
        const form = new FormData();
        form.set("backup", new Blob([new Uint8Array(buffer)]), "fixture.zip");
        form.set("restoreFiles", String(restoreFiles));
        form.set("clearExisting", "false");
        return fetch(`${base}/api/system/restore`, { method: "POST", body: form });
      }
      const initialized = await fetch(`${base}/api/system/restore/init`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: "fixture.zip", totalChunks: 2, clearExisting: false }),
      });
      assert.equal(initialized.status, 200);
      const { uploadId } = await initialized.json();
      const split = Math.floor(buffer.length / 2);
      // Out-of-order arrival also verifies finalize assembles by chunk index.
      for (const index of [1, 0]) {
        const form = new FormData();
        form.set("uploadId", uploadId);
        form.set("chunkIndex", String(index));
        form.set("chunk", new Blob([new Uint8Array(index ? buffer.subarray(split) : buffer.subarray(0, split))]));
        assert.equal((await fetch(`${base}/api/system/restore/chunk`, { method: "POST", body: form })).status, 200);
      }
      return fetch(`${base}/api/system/restore/finalize`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ uploadId }),
      });
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

for (const chunked of [false, true]) {
  const uploadType = chunked ? "chunked" : "direct";
  for (const format of ["pg_dump_sql", "pg_dump_full", "pg_dump_clean", "full_system"]) {
    test(`${uploadType} ${format}: database failure leaves all existing files untouched`, async () => {
      const f = await fixture("db-failure");
      try {
        const response = await f.upload(await archive(format), chunked);
        assert.equal(response.status, 500);
        const result = await response.json();
        assert.equal(result.success, false);
        assert.equal(result.filesRestored, 0);
        assert.equal(result.error, "forced database failure");
        assert.deepEqual(result.warnings, ["fixture database warning"]);
        assert.deepEqual(f.counts(), { dbCalls: 1, pathCalls: 0, fileCalls: 0 });
        assert.equal(fs.readFileSync(path.join(f.filesRoot, "existing.txt"), "utf8"), "original attachment");
        assert.deepEqual(fs.readdirSync(f.filesRoot), ["existing.txt"]);
        assert.deepEqual(fs.readdirSync(f.sqlRoot), [], "temporary SQL removed on failure");
        assert.equal(f.sessions.size, 0, "upload session consumed");
      } finally { await f.close(); }
    });
  }
  test(`${uploadType}: thrown database error skips files and cleans temporary SQL`, async () => {
    const f = await fixture("db-throw");
    try {
      assert.equal((await f.upload(await archive("pg_dump_sql"), chunked)).status, 500);
      assert.deepEqual(f.counts(), { dbCalls: 1, pathCalls: 0, fileCalls: 0 });
      assert.equal(fs.readFileSync(path.join(f.filesRoot, "existing.txt"), "utf8"), "original attachment");
      assert.deepEqual(fs.readdirSync(f.filesRoot), ["existing.txt"]);
      assert.deepEqual(fs.readdirSync(f.sqlRoot), []);
      assert.equal(f.sessions.size, 0);
    } finally { await f.close(); }
  });
  for (const mode of ["success", "file-errors", "path-throw", "file-throw"] as const) {
    test(`${uploadType}: ${mode} truthfully reports a committed database`, async () => {
      const f = await fixture(mode);
      try {
        const response = await f.upload(await archive("pg_dump_full"), chunked);
        assert.equal(response.status, 200, "partial success remains compatible with the restore UI");
        const result = await response.json();
        assert.equal(result.databaseCommitted, true);
        assert.equal(result.success, mode === "success");
        assert.deepEqual(result.warnings, ["fixture database warning"]);
        assert.equal(result.format, "pg_dump_full");
        assert.equal(result.backupDate, "2026-10-14");
        assert.equal(result.filesRestored, mode === "success" ? 2 : mode === "file-errors" ? 1 : 0);
        assert.equal(result.errors.length, mode === "success" ? 0 : 1);
        if (mode !== "success") assert.equal(result.message, "Database restored; file restore incomplete");
        if (mode === "success" || mode === "file-errors") {
          assert.equal(fs.readFileSync(path.join(f.filesRoot, "existing.txt"), "utf8"), "replacement attachment");
        }
        assert.deepEqual(f.order, mode === "path-throw" ? ["database", "path"] : ["database", "path", "files"]);
        assert.deepEqual(fs.readdirSync(f.sqlRoot), [], "temporary SQL removed after committed restore");
        assert.equal(f.sessions.size, 0);
      } finally { await f.close(); }
    });
  }
}

test("direct SQL archive with file restoration disabled commits database without touching files", async () => {
  const f = await fixture("success");
  try {
    const result = await (await f.upload(await archive("pg_dump_clean"), false, false)).json();
    assert.equal(result.success, true);
    assert.equal(result.databaseCommitted, true);
    assert.equal(result.message, "Clean database restore completed");
    assert.equal(result.filesRestored, 0);
    assert.deepEqual(f.counts(), { dbCalls: 1, pathCalls: 0, fileCalls: 0 });
    assert.equal(fs.readFileSync(path.join(f.filesRoot, "existing.txt"), "utf8"), "original attachment");
    assert.deepEqual(fs.readdirSync(f.sqlRoot), []);
  } finally { await f.close(); }
});
