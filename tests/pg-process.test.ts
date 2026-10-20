import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { runPgProcess } from "../server/backups/pg-process";

test("backup success waits for delayed final writes, finish and file close", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meterflo-pg-output-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const create = fs.createWriteStream;
  let finished = false, closed = false;
  const mock = t.mock.method(fs, "createWriteStream", (...args: Parameters<typeof fs.createWriteStream>) => {
    const stream = create(...args);
    const write = (stream as any)._write;
    (stream as any)._write = function (chunk: Buffer, encoding: string, callback: (error?: Error) => void) {
      setTimeout(() => write.call(this, chunk, encoding, callback), 100);
    };
    stream.once("finish", () => { finished = true; });
    stream.once("close", () => { closed = true; });
    return stream;
  });
  try {
    const file = path.join(root, "dump.sql");
    const sql = "SELECT 'Unicode: café 日本語';\n-- PostgreSQL database dump complete\n";
    const result = await runPgProcess(process.execPath, ["-e", `process.stdout.write(${JSON.stringify(sql)})`], {}, file);
    assert.equal(result.success, true, result.stderr);
    assert(finished && closed, "No consumer may read/rewrite the dump before the destination finishes and closes");
    assert.equal(await fs.promises.readFile(file, "utf8"), sql);
    // The backup's next step rewrites audit hooks; there must be no late writer.
    await fs.promises.writeFile(file, "-- filtered\n" + sql);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(await fs.promises.readFile(file, "utf8"), "-- filtered\n" + sql);
  } finally { mock.mock.restore(); }
});

test("nonzero PostgreSQL exit is a failure and removes incomplete output", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meterflo-pg-exit-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "partial.sql");
  const result = await runPgProcess(process.execPath, ["-e",
    "process.stdout.write('partial SQL');process.stderr.write('fixture database error');process.exitCode=2"], {}, file);
  assert.equal(result.success, false);
  assert.match(result.stderr, /fixture database error/);
  await assert.rejects(fs.promises.access(file));
});

test("a disk write failure rejects success, stops the producer and cleans partial output", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meterflo-pg-disk-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "partial.sql");
  const mock = t.mock.method(fs, "createWriteStream", () => {
    fs.writeFileSync(file, "partial");
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        callback(Object.assign(new Error("fixture ENOSPC"), { code: "ENOSPC" }));
      },
    });
    process.nextTick(() => destination.emit("open", 999));
    return destination as fs.WriteStream;
  });
  try {
    const result = await runPgProcess(process.execPath, ["-e", "process.stdout.write('SQL');setInterval(()=>{},1000)"], {}, file);
    assert.equal(result.success, false);
    assert.match(result.stderr, /Backup output could not be completed.*ENOSPC/);
    await assert.rejects(fs.promises.access(file));
  } finally { mock.mock.restore(); }
});

test("an output open error preserves a pre-existing destination", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meterflo-pg-open-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "protected.sql");
  await fs.promises.writeFile(file, "existing backup");
  const mock = t.mock.method(fs, "createWriteStream", () => {
    const destination = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    process.nextTick(() => destination.destroy(Object.assign(new Error("fixture EACCES"), { code: "EACCES" })));
    return destination as fs.WriteStream;
  });
  try {
    const result = await runPgProcess(process.execPath, ["-e", "process.stdout.write('new SQL')"], {}, file);
    assert.equal(result.success, false);
    assert.match(result.stderr, /EACCES/);
    assert.equal(await fs.promises.readFile(file, "utf8"), "existing backup");
  } finally { mock.mock.restore(); }
});

test("spawn failure cannot report a completed backup", async t => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meterflo-pg-spawn-"));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "failed.sql");
  const result = await runPgProcess(path.join(root, "missing-tool"), [], {}, file);
  assert.equal(result.success, false);
  assert.match(result.stderr, /could not run/);
  await assert.rejects(fs.promises.access(file));
});

test("commands without output files still collect stdout, stderr and exit status", async () => {
  const result = await runPgProcess(process.execPath, ["-e", "process.stdout.write('restore complete');process.stderr.write('NOTICE: fixture')"], {});
  assert.deepEqual(result, { success: true, stdout: "restore complete", stderr: "NOTICE: fixture" });
});
