import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import express from "express";
import { build } from "esbuild";
import { prepareBuildOutput } from "../script/build-output";
import { completeWindowsUpdate, requiredUpdateFiles } from "../script/windows-update-runner.mjs";
import { waitForUpdatedBuild } from "../script/windows-update-health.mjs";
import { toolCommand, acquireUpdateLock, verifyCheckout } from "../script/windows-update-tools.mjs";

function temporary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meterflo update "));
  const write = (file: string, value = "fixture") => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), value);
  };
  return { root, write, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
function fixture(fail?: string, invalidPm2 = false) {
  const f = temporary(), calls: string[] = [];
  for (const file of requiredUpdateFiles) f.write(file);
  f.write(".env", "protected fixture");
  f.write("dist/index.cjs", "prior compiled build");
  const run = (tool: string, args: string[]) => {
    const key = `${tool === process.execPath ? "node" : tool} ${args.join(" ")}`;
    calls.push(key);
    if (fail && tool !== "git" && key.includes(fail)) throw new Error(`Fixture failure: ${fail}`);
    if (key === "pm2 jlist") return JSON.stringify([{
      name: "meterflo", pid: 123,
      pm2_env: { status: "online", pm_cwd: f.root,
        pm_exec_path: path.join(f.root, invalidPm2 ? "dist/index.js" : "dist/index.cjs") },
    }]);
    return "";
  };
  return { ...f, calls, run };
}

test("every distributed update dependency is Git-tracked and not ignored", () => {
  const files = [...requiredUpdateFiles, "tests/windows-updates.test.ts", "deploy/WINDOWS_DEPLOYMENT.md"];
  execFileSync("git", ["ls-files", "--error-unmatch", ...files], { stdio: "pipe" });
  const ignored = spawnSync("git", ["check-ignore", "--no-index", ...files], { encoding: "utf8" });
  assert.equal(ignored.status, 1, ignored.stdout);
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  for (const dependency of ["esbuild", "vite", "tsx", "typescript"])
    assert.ok(pkg.devDependencies[dependency], `${dependency} must be installed by --include=dev`);
  assert.equal(pkg.scripts["migrate:inventory-relational"], "tsx script/migrate-inventory-relational.ts");
});

test("Windows npm/PM2 use Node CLI files without shell quoting or loss of spaces", () => {
  const execPath = "C:\\Program Files\\nodejs\\node.exe";
  const npm = toolCommand("npm", ["ci", "--include=dev"], {
    platform: "win32", execPath, searchPath: "C:\\Tools with spaces",
    exists: (file: string) => file === "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js",
  });
  assert.deepEqual(npm, { executable: execPath, argv: [
    "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js", "ci", "--include=dev",
  ] });
  const pm2 = toolCommand("pm2", ["restart", "meterflo"], {
    platform: "win32", execPath, searchPath: "C:\\Users\\Fixture User\\AppData\\Roaming\\npm",
    exists: (file: string) => file.endsWith("Roaming\\npm\\node_modules\\pm2\\bin\\pm2"),
  });
  assert.equal(pm2.argv[0], "C:\\Users\\Fixture User\\AppData\\Roaming\\npm\\node_modules\\pm2\\bin\\pm2");
  assert.throws(() => toolCommand("npm", [], {
    platform: "win32", execPath, searchPath: "", exists: () => false,
  }), /CLI not found/);
});

test("fresh Git checkouts distribute CMD as CRLF and reviewed SQL as LF regardless of autocrlf", () => {
  const f = temporary();
  try {
    for (const file of [".gitattributes", "deploy/Update-MeterFlo.cmd", "migrations/inventory-category-ids.sql"])
      f.write(file, fs.readFileSync(file, "utf8"));
    const git = (args: string[], cwd = f.root) =>
      execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" });
    git(["init", "--quiet"]);
    git(["add", ".gitattributes", "deploy/Update-MeterFlo.cmd", "migrations/inventory-category-ids.sql"]);
    git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture"]);
    for (const autocrlf of ["true", "false", "input"]) {
      const checkout = path.join(f.root, `checkout-${autocrlf}`);
      git(["-c", `core.autocrlf=${autocrlf}`, "clone", "--quiet", f.root, checkout]);
      const cmd = fs.readFileSync(path.join(checkout, "deploy/Update-MeterFlo.cmd"), "utf8");
      assert.match(cmd, /\r\n/);
      assert.doesNotMatch(cmd, /(^|[^\r])\n/);
      assert.ok(!fs.readFileSync(path.join(checkout, "migrations/inventory-category-ids.sql")).includes(13));
    }
  } finally { f.cleanup(); }
});

test("overlapping updates and stale locks are blocked without deleting another lock", () => {
  const f = temporary();
  try {
    const release = acquireUpdateLock(f.root);
    assert.throws(() => acquireUpdateLock(f.root), { code: "EEXIST" });
    assert.ok(fs.existsSync(path.join(f.root, "generated-artifacts/windows-update.lock")));
    release();
    acquireUpdateLock(f.root)();
  } finally { f.cleanup(); }
});

test("checkout preflight blocks tracked edits/wrong branches without requiring local backups in Git", () => {
  const f = temporary();
  try {
    f.write("private-local-backup.sql", "never add this to Git");
    let branch = "main", status = "";
    const run = (_tool: string, args: string[]) => {
      if (args[0] === "rev-parse") return f.root;
      if (args[0] === "branch") return branch;
      assert.ok(args.includes("--untracked-files=no"));
      return status;
    };
    verifyCheckout(f.root, run);
    status = " M script/build.ts";
    assert.throws(() => verifyCheckout(f.root, run), /Tracked local Git changes/);
    status = ""; branch = "customer-edits";
    assert.throws(() => verifyCheckout(f.root, run), /main branch/);
    assert.equal(fs.readFileSync(path.join(f.root, "private-local-backup.sql"), "utf8"), "never add this to Git");
  } finally { f.cleanup(); }
});

test("update order includes build dependencies, physical schema, exact-build health and final PM2 save", async () => {
  const f = fixture();
  try {
    await completeWindowsUpdate(f.root, { run: f.run, log: () => {} });
    const index = (step: string) => {
      const found = f.calls.findIndex(call => !call.startsWith("git ") && call.includes(step));
      assert.ok(found >= 0, step); return found;
    };
    assert.ok(index("pm2 stop") < index("npm ci --include=dev --include=optional"));
    assert.ok(index("npm run check") < index("npm run build"));
    assert.ok(index("npm run test:windows-updates") < index("npm run build"));
    assert.ok(index("npm run build") < index("migrate-inventory-relational.ts --standalone"));
    assert.ok(index("migrate-inventory-relational.ts") < index("pm2 restart"));
    assert.ok(index("migrate-inventory-relational.ts") < index("migrate-attachment-folders.ts --check"));
    assert.ok(index("migrate-attachment-folders.ts --check") < index("pm2 restart"));
    assert.ok(index("pm2 restart") < index("windows-update-health.mjs"));
    assert.ok(index("windows-update-health.mjs") < index("pm2 save"));
    assert.ok(!f.calls.some(call => /\bnpx\b|audit fix|reset --hard|db:push|--update-env/.test(call)));
    assert.ok(!f.calls.some(call => /migrate-attachment-folders.*--(?:apply|resume)/.test(call)));
    assert.equal(fs.readFileSync(path.join(f.root, ".env"), "utf8"), "protected fixture");
  } finally { f.cleanup(); }
});

for (const failure of ["npm ci", "npm run check", "npm run test:windows-updates", "npm run build",
  "migrate-inventory-relational.ts", "migrate-attachment-folders.ts", "pm2 restart", "windows-update-health.mjs"]) {
  test(`failure at ${failure} stops maintenance without saving an unhealthy process`, async () => {
    const f = fixture(failure);
    try {
      await assert.rejects(completeWindowsUpdate(f.root, { run: f.run, log: () => {} }), /Fixture failure/);
      assert.equal(f.calls.at(-1), "pm2 stop meterflo");
      assert.ok(!f.calls.includes("pm2 save"));
      if (!["pm2 restart", "windows-update-health.mjs"].includes(failure))
        assert.ok(!f.calls.includes("pm2 restart meterflo"));
      assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "prior compiled build");
      assert.equal(fs.readFileSync(path.join(f.root, ".env"), "utf8"), "protected fixture");
    } finally { f.cleanup(); }
  });
}

test("missing distribution files and wrong PM2 entry points fail before stopping", async () => {
  const f = fixture(undefined, true);
  try {
    await assert.rejects(completeWindowsUpdate(f.root, { run: f.run, log: () => {} }), /dist\/index.cjs/);
    assert.ok(!f.calls.includes("pm2 stop meterflo"));
    fs.unlinkSync(path.join(f.root, requiredUpdateFiles[0]));
    await assert.rejects(completeWindowsUpdate(f.root, { run: f.run }), /Missing update file/);
  } finally { f.cleanup(); }
});

test("health rejects a stale build even when its version is identical", async () => {
  await assert.rejects(waitForUpdatedBuild({
    url: "http://127.0.0.1:1/api/system/release-health",
    expected: { version: "2.1.1", buildId: "new" }, attempts: 3, sleep: async () => {},
    read: async () => ({ ready: true, version: "2.1.1", buildId: "old" }),
  }), /expected build twice/);
});

test("real HTTP health tolerates startup delay but requires consecutive current-build responses", async () => {
  let calls = 0;
  const server = http.createServer((_request, response) => {
    const n = ++calls;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ ready: n !== 3, version: "2.1.1", buildId: n === 1 ? "old" : "new" }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    await waitForUpdatedBuild({ url: `http://127.0.0.1:${address.port}/api/system/release-health`,
      expected: { version: "2.1.1", buildId: "new" }, sleep: async () => {}, attempts: 6 });
    assert.equal(calls, 5);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("the actual compiled release-health handler reports its embedded build identity", async () => {
  const f = temporary();
  let server: ReturnType<typeof http.createServer> | undefined;
  try {
    const compiled = path.join(f.root, "health.cjs");
    await build({ entryPoints: ["server/customerExtensions.ts"], outfile: compiled,
      platform: "node", format: "cjs", bundle: true, logLevel: "silent",
      define: { __METERFLO_BUILD_ID__: JSON.stringify("compiled-health-fixture") } });
    const { registerCustomerExtensions } = createRequire(compiled)(compiled);
    const app = express();
    await registerCustomerExtensions(app, {
      auth: (_req: unknown, _res: unknown, next: () => void) => next(), storage: {},
    }, { blockers: [], extensions: [], version: "2.1.1" });
    server = http.createServer(app);
    await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
    const address = server.address() as { port: number };
    await waitForUpdatedBuild({
      url: `http://127.0.0.1:${address.port}/api/system/release-health`,
      expected: { version: "2.1.1", buildId: "compiled-health-fixture" }, sleep: async () => {},
    });
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    f.cleanup();
  }
});

async function compile(directory: string) {
  for (const file of ["index.cjs", "public/index.html", "customer-release.json"]) {
    await fsp.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fsp.writeFile(path.join(directory, file), "new output");
  }
}
test("compiler failure and incomplete compilation preserve the entire installed build", async () => {
  const f = temporary();
  f.write("dist/index.cjs", "previous");
  try {
    await assert.rejects(prepareBuildOutput(f.root, async () => { throw new Error("compiler failed"); }), /compiler failed/);
    assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "previous");
    await assert.rejects(prepareBuildOutput(f.root, async directory => {
      await fsp.mkdir(directory); await fsp.writeFile(path.join(directory, "index.cjs"), "incomplete");
    }));
    assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "previous");
  } finally { f.cleanup(); }
});
test("successful compilation promotes complete output and retains prior output", async () => {
  const f = temporary(); f.write("dist/index.cjs", "previous");
  try {
    await prepareBuildOutput(f.root, compile);
    assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "new output");
    const backup = fs.readdirSync(path.join(f.root, "generated-artifacts"))[0];
    assert.equal(fs.readFileSync(path.join(f.root, "generated-artifacts", backup, "previous-dist/index.cjs"), "utf8"), "previous");
  } finally { f.cleanup(); }
});
test("Windows-style promotion failure restores the original directory", async () => {
  const f = temporary(); f.write("dist/index.cjs", "previous");
  try {
    await assert.rejects(prepareBuildOutput(f.root, compile, async (from, to) => {
      if (String(from).endsWith("next-dist")) throw new Error("EPERM fixture");
      await fsp.rename(from, to);
    }), /EPERM/);
    assert.equal(fs.readFileSync(path.join(f.root, "dist/index.cjs"), "utf8"), "previous");
  } finally { f.cleanup(); }
});
