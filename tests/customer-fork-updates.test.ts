import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { prepareForkReview, reviewFork } from "../script/customer-fork-update";
import { reviewGit, type ReviewGit } from "../script/core-release-git";
import { checkCoreReleaseReadiness } from "../script/core-release-readiness";
import { coreUpdatePreview, gitReader } from "../server/coreUpdatePreview";
import { loadCustomerRelease } from "../shared/customer-release";

const approvedSource = "https://example.invalid/approved-core.git";
const confirmations = { tests: true, customizations: true, dependencies: true, migrations: true };
function fixture(conflict = false) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "meterflo-fork-"));
  const core = path.join(temporary, "core"), source = path.join(temporary, "customer");
  const target = path.join(temporary, "review with spaces");
  const git = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args],
    { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const write = (cwd: string, file: string, value: any) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    fs.writeFileSync(path.join(cwd, file), typeof value === "string" ? value : JSON.stringify(value));
  };
  const version = (v: string) => {
    write(core, "package.json", { name: "fixture", version: v, type: "module" });
    write(core, "package-lock.json", { name: "fixture", version: v, lockfileVersion: 3, packages: { "": { name: "fixture", version: v } } });
  };
  fs.mkdirSync(core);
  git(core, "init", "-q"); git(core, "config", "user.name", "Fixture"); git(core, "config", "user.email", "fixture@example.invalid");
  write(core, ".gitignore", ".env\nmeterflo.instance.json\ncustomer-packages/\nProject Files/\ncustomer.db\nnode_modules/\ndist/\n");
  write(core, "meterflo.release.json", { extensionApiVersion: 1, schemaVersion: 1, migrations: [] });
  version("1.0.0"); write(core, "behavior.txt", "original shared behavior\n");
  git(core, "add", "."); git(core, "commit", "-qm", "Baseline"); git(core, "tag", "v1.0.0");
  const baseline = git(core, "rev-parse", "HEAD");
  version("1.1.0"); write(core, "core-new.txt", "core improvement\n");
  if (conflict) write(core, "behavior.txt", "new core behavior\n");
  git(core, "add", "."); git(core, "commit", "-qm", "Core update"); git(core, "tag", "v1.1.0");
  const commit = git(core, "rev-parse", "HEAD");
  git(temporary, "clone", "-q", core, source); git(source, "checkout", "-qb", "customer", baseline);
  git(source, "config", "user.name", "Customer"); git(source, "config", "user.email", "customer@example.invalid");
  write(source, "customer-only.txt", "customer workflow\n");
  if (conflict) write(source, "behavior.txt", "customer customized behavior\n");
  git(source, "add", "."); git(source, "commit", "-qm", "Customer custom work");
  write(source, "meterflo.instance.json", { coreSource: approvedSource, coreBaseline: { version: "1.0.0", commit: baseline },
    installedSchemaVersion: 1, approvedMigrations: [], extensions: [] });
  write(source, ".env", "PRIVATE_RUNTIME_FIXTURE\n");
  write(source, "Project Files/attachment.txt", "PRIVATE_ATTACHMENT_FIXTURE\n");
  write(source, "customer.db", "PRIVATE_DATABASE_FIXTURE\n");
  const customerStart = git(source, "rev-parse", "HEAD"), origin = git(source, "remote", "get-url", "origin");
  const runner: ReviewGit = (cwd, args) => reviewGit(cwd, args.map(arg => arg === approvedSource ? core : arg));
  const prepare = (options: Partial<Parameters<typeof prepareForkReview>[0]> = {}) =>
    prepareForkReview({ root: source, target, tag: "v1.1.0", commit, git: runner, ...options });
  const checkout = path.join(target, "checkout");
  const commitReview = () => {
    git(checkout, "config", "user.name", "Customer reviewer"); git(checkout, "config", "user.email", "reviewer@example.invalid");
    git(checkout, "add", "-u"); git(checkout, "commit", "-qm", "Reviewed combined customer and core");
  };
  const unchanged = () => {
    assert.equal(git(source, "rev-parse", "HEAD"), customerStart);
    assert.equal(git(source, "remote", "get-url", "origin"), origin);
    assert.equal(git(source, "status", "--porcelain"), "");
    assert.equal(fs.readFileSync(path.join(source, ".env"), "utf8"), "PRIVATE_RUNTIME_FIXTURE\n");
    assert.equal(fs.readFileSync(path.join(source, "Project Files/attachment.txt"), "utf8"), "PRIVATE_ATTACHMENT_FIXTURE\n");
    assert.equal(fs.readFileSync(path.join(source, "customer.db"), "utf8"), "PRIVATE_DATABASE_FIXTURE\n");
  };
  return { temporary, core, source, target, checkout, git, write, version, commit, baseline, customerStart,
    runner, prepare, commitReview, unchanged, cleanup: () => fs.rmSync(temporary, { recursive: true, force: true }) };
}

test("real Git clean merge preserves custom source and protected live data; approval pins combined revision", async () => {
  const f = fixture();
  try {
    const review = await f.prepare();
    assert.equal(review.state, "review"); assert.equal(review.customerStart, f.customerStart);
    assert.equal(f.git(f.checkout, "rev-parse", "HEAD"), f.customerStart, "merge remains uncommitted");
    assert.equal(fs.readFileSync(path.join(f.checkout, "customer-only.txt"), "utf8"), "customer workflow\n");
    assert.equal(fs.readFileSync(path.join(f.checkout, "core-new.txt"), "utf8"), "core improvement\n");
    assert.equal(fs.existsSync(path.join(f.checkout, ".env")), false);
    assert.equal(fs.existsSync(path.join(f.checkout, "customer.db")), false);
    assert.equal(fs.existsSync(path.join(f.checkout, "Project Files")), false);
    assert.equal(f.git(f.checkout, "remote"), "", "review cannot accidentally push into the live source");
    await assert.rejects(reviewFork(f.target, "approve", confirmations, f.runner), /commit the combined/);
    f.commitReview();
    await assert.rejects(reviewFork(f.target, "approve", undefined, f.runner), /confirmations/);
    const approved = await reviewFork(f.target, "approve", confirmations, f.runner);
    assert.equal(approved.state, "approved");
    assert.equal(approved.combinedCommit, f.git(f.checkout, "rev-parse", "HEAD"));
    assert.equal(approved.approval?.kind, "operator-attestation");
    assert.equal((await reviewFork(f.target, "status", undefined, f.runner)).state, "approved");
    const cliOutput = execFileSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"),
      path.resolve("script/customer-fork-cli.ts"), "status", "--target", f.target], { encoding: "utf8" });
    assert.match(cliOutput, /"state": "approved"/);
    assert.doesNotMatch(cliOutput, /PRIVATE_RUNTIME|PRIVATE_ATTACHMENT|PRIVATE_DATABASE/);
    assert.equal(fs.existsSync(path.join(f.checkout, "meterflo-stage-receipt.json")), false);
    f.write(f.checkout, "customer-only.txt", "edited after approval");
    await assert.rejects(reviewFork(f.target, "status", undefined, f.runner), /Approved checkout changed/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("real conflicts resume after manual resolution; abort retains all evidence and cannot resume", async () => {
  const f = fixture(true);
  try {
    const first = await f.prepare();
    assert.equal(first.state, "conflicts"); assert.deepEqual(first.conflicts, ["behavior.txt"]);
    assert.equal((await reviewFork(f.target, "resume", undefined, f.runner)).state, "conflicts");
    f.write(f.checkout, "behavior.txt", "reviewed behavior combining both contracts\n");
    f.git(f.checkout, "add", "behavior.txt");
    assert.equal((await reviewFork(f.target, "resume", undefined, f.runner)).state, "review");
    f.commitReview();
    assert.equal((await reviewFork(f.target, "approve", confirmations, f.runner)).state, "approved");
    const next = path.join(f.temporary, "abandon");
    await f.prepare({ target: next });
    const before = fs.readFileSync(path.join(next, "checkout/behavior.txt"), "utf8");
    assert.equal((await reviewFork(next, "abort", undefined, f.runner)).state, "aborted");
    assert.equal(fs.readFileSync(path.join(next, "checkout/behavior.txt"), "utf8"), before);
    await assert.rejects(reviewFork(next, "resume", undefined, f.runner), /abandoned/);
    f.unchanged();
  } finally { f.cleanup(); }
});

for (const dirty of ["staged", "unstaged", "untracked"]) {
  test(`${dirty} customer source cannot be silently excluded or overwritten`, async () => {
    const f = fixture();
    try {
      f.write(f.source, dirty === "untracked" ? "new-customer-code.ts" : "customer-only.txt", "uncommitted customer work");
      if (dirty === "staged") f.git(f.source, "add", "customer-only.txt");
      const before = f.git(f.source, "status", "--porcelain");
      await assert.rejects(f.prepare(), /staged, unstaged or untracked/);
      assert.equal(f.git(f.source, "status", "--porcelain"), before);
      assert.equal(fs.existsSync(f.target), false);
    } finally { f.cleanup(); }
  });
}

test("missing adoption, moved tags, unrelated baseline and unavailable access stop safely", async () => {
  const f = fixture();
  try {
    await assert.rejects(f.prepare({ commit: "0".repeat(40) }), /tag moved|full commit/);
    await assert.rejects(f.prepare(), /Target already exists/);
    const denied = async (): Promise<{ code: number; stdout: string }> => ({ code: 128, stdout: "" });
    await assert.rejects(f.prepare({ target: path.join(f.temporary, "denied"), git: denied }), /Git rev-parse failed/);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.source, "meterflo.instance.json"), "utf8"));
    delete manifest.coreBaseline; f.write(f.source, "meterflo.instance.json", manifest);
    await assert.rejects(f.prepare({ target: path.join(f.temporary, "missing") }), /verified coreBaseline/);
    manifest.coreBaseline = { version: "1.1.0", commit: f.commit };
    f.write(f.source, "meterflo.instance.json", manifest);
    await assert.rejects(f.prepare({ target: path.join(f.temporary, "unrelated") }), /Missing\/unrelated/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("interrupted fetch and completed-but-unrecorded merge resume without touching live source", async () => {
  const f = fixture();
  try {
    let interrupt = true;
    const runner: ReviewGit = async (cwd, args) => {
      if (interrupt && args[0] === "fetch") { interrupt = false; return { code: 128, stdout: "" }; }
      return f.runner(cwd, args);
    };
    await assert.rejects(f.prepare({ git: runner }), /Git fetch failed/);
    assert.equal((await reviewFork(f.target, "status", undefined, f.runner)).phase, "fetch");
    const result = await reviewFork(f.target, "resume", undefined, f.runner);
    assert.equal(result.state, "review");
    f.commitReview();
    assert.equal((await reviewFork(f.target, "resume", undefined, f.runner)).state, "review");
    f.unchanged();
  } finally { f.cleanup(); }
});

test("interruption after checkout can resume; existing target and inside paths never overwritten", async () => {
  const f = fixture();
  try {
    let interrupted = false;
    const runner: ReviewGit = async (cwd, args) => {
      const result = await f.runner(cwd, args);
      if (!interrupted && args[0] === "checkout") { interrupted = true; throw new Error("Injected interruption after checkout"); }
      return result;
    };
    await assert.rejects(f.prepare({ git: runner }), /Injected interruption/);
    assert.equal((await reviewFork(f.target, "resume", undefined, f.runner)).state, "review");
    await assert.rejects(f.prepare({ target: path.join(f.source, "inside") }), /outside/);
    await assert.rejects(f.prepare({ target: f.temporary }), /outside/);
    await assert.rejects(f.prepare(), /already exists/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("schema and lockfile incompatibilities require explicit reconciliation before approval", async () => {
  const f = fixture();
  try {
    f.write(f.core, "meterflo.release.json", { extensionApiVersion: 1, schemaVersion: 2, migrations: [] });
    f.git(f.core, "add", "."); f.git(f.core, "commit", "-qm", "Reviewed schema-changing release"); f.git(f.core, "tag", "-f", "v1.1.0");
    const review = await f.prepare({ commit: f.git(f.core, "rev-parse", "HEAD") });
    assert.ok(review.reviewRequired.some(line => line.includes("schema differs")));
    f.commitReview();
    await assert.rejects(reviewFork(f.target, "approve", confirmations, f.runner), /migration readiness/);
    const manifest = JSON.parse(fs.readFileSync(path.join(f.checkout, "meterflo.instance.json"), "utf8"));
    manifest.installedSchemaVersion = 2; f.write(f.checkout, "meterflo.instance.json", manifest);
    const pkg = JSON.parse(fs.readFileSync(path.join(f.checkout, "package.json"), "utf8"));
    pkg.dependencies = { "customer-dependency": "1.0.0" }; f.write(f.checkout, "package.json", pkg);
    f.git(f.checkout, "add", "-u"); f.git(f.checkout, "commit", "-qm", "Unreconciled dependency");
    await assert.rejects(reviewFork(f.target, "approve", confirmations, f.runner), /dependency declarations disagree/);
    const lock = JSON.parse(fs.readFileSync(path.join(f.checkout, "package-lock.json"), "utf8"));
    lock.packages[""].dependencies = pkg.dependencies; f.write(f.checkout, "package-lock.json", lock);
    f.git(f.checkout, "add", "-u"); f.git(f.checkout, "commit", "-qm", "Reconciled dependency");
    assert.equal((await reviewFork(f.target, "approve", confirmations, f.runner)).state, "approved");
    manifest.installedSchemaVersion = 3; f.write(f.checkout, "meterflo.instance.json", manifest);
    await assert.rejects(reviewFork(f.target, "status", undefined, f.runner), /readiness|configuration changed/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("supported customer packages are copied exactly, never secrets, and changed snapshots block approval", async () => {
  const f = fixture();
  try {
    fs.cpSync("examples/customer-report", path.join(f.source, "customer-packages/project-report"), { recursive: true });
    const pkgFile = path.join(f.source, "customer-packages/project-report/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgFile, "utf8"));
    pkg.meterfloExtension.minCoreVersion = "1.0.0"; pkg.meterfloExtension.maxCoreVersionExclusive = "2.0.0";
    fs.writeFileSync(pkgFile, JSON.stringify(pkg));
    const manifest = JSON.parse(fs.readFileSync(path.join(f.source, "meterflo.instance.json"), "utf8"));
    manifest.extensions = [{ directory: "customer-packages/project-report" }]; f.write(f.source, "meterflo.instance.json", manifest);
    await f.prepare();
    assert.equal(fs.readFileSync(path.join(f.checkout, "customer-packages/project-report/package.json"), "utf8"), JSON.stringify(pkg));
    f.commitReview();
    f.write(f.checkout, "customer-packages/project-report/new.mjs", "// changed package");
    await assert.rejects(reviewFork(f.target, "approve", confirmations, f.runner), /package changed/);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("maintainer readiness checks versions, root lock, exact migration bytes and immutable tags without mutation", async () => {
  const f = fixture();
  try {
    const head = f.git(f.core, "rev-parse", "HEAD"), tags = f.git(f.core, "tag");
    const result = await checkCoreReleaseReadiness(f.core, "v1.1.0");
    assert.equal(result.tagExists, true); assert.equal(result.tests, "not-run-by-this-command");
    await assert.rejects(checkCoreReleaseReadiness(f.core, "v9.9.9"), /tag and package version/);
    f.write(f.core, "migrations/core.sql", "SELECT 1;\n");
    const sha256 = createHash("sha256").update("SELECT 1;\n").digest("hex");
    f.write(f.core, "meterflo.release.json", { extensionApiVersion: 1, schemaVersion: 1,
      migrations: [{ id: "core.test", file: "migrations/core.sql", ownership: "core", sha256, reversible: true }] });
    await assert.rejects(checkCoreReleaseReadiness(f.core, "v1.1.0"), /working tree/);
    f.git(f.core, "add", "."); f.git(f.core, "commit", "-qm", "Migration");
    await assert.rejects(checkCoreReleaseReadiness(f.core, "v1.1.0"), /tag points/);
    f.write(f.core, "migrations/core.sql", "SELECT 2;\n"); f.git(f.core, "add", "."); f.git(f.core, "commit", "-qm", "Tampered migration");
    await assert.rejects(checkCoreReleaseReadiness(f.core, "v1.1.0"), /checksum/);
    assert.equal(f.git(f.core, "tag"), tags);
    assert.equal(f.git(f.core, "rev-parse", "v1.1.0"), head);
    f.unchanged();
  } finally { f.cleanup(); }
});

test("preview distinguishes merge review from extension staging without weakening staging gates", async () => {
  const f = fixture();
  try {
    const preview = await coreUpdatePreview(loadCustomerRelease(f.source), async args =>
      gitReader(f.source)(args.map(arg => arg === approvedSource ? f.core : arg)));
    assert.equal(preview.canPrepare, false);
    assert.ok(preview.blockers.some(line => line.includes("direct core modifications")));
    assert.equal(preview.forkReview.canPrepare, true);
    assert.ok(preview.forkReview.command.includes(f.commit));
    f.write(f.source, "new.ts", "// unsaved custom source");
    const dirty = await coreUpdatePreview(loadCustomerRelease(f.source), async args =>
      gitReader(f.source)(args.map(arg => arg === approvedSource ? f.core : arg)));
    assert.equal(dirty.forkReview.canPrepare, false); assert.equal(dirty.forkReview.command, "");
  } finally { f.cleanup(); }
});

test("later customer work, tracked private files and unrelated history cannot be silently lost", async () => {
  const f = fixture();
  try {
    await f.prepare(); f.commitReview();
    f.write(f.source, "later-work.txt", "later customer work");
    f.git(f.source, "add", "later-work.txt"); f.git(f.source, "commit", "-qm", "Later work");
    const laterHead = f.git(f.source, "rev-parse", "HEAD");
    await assert.rejects(reviewFork(f.target, "approve", confirmations, f.runner), /source advanced/);
    assert.equal(f.git(f.source, "rev-parse", "HEAD"), laterHead);
    f.git(f.source, "add", "-f", ".env"); f.git(f.source, "commit", "-qm", "Tracked private fixture");
    await assert.rejects(f.prepare({ target: path.join(f.temporary, "private-blocked") }), /Protected instance/);
    f.git(f.source, "rm", "--cached", ".env"); f.git(f.source, "commit", "-qm", "Stop tracking private fixture");
    f.git(f.source, "checkout", "--orphan", "unrelated");
    f.git(f.source, "add", "-u"); f.git(f.source, "commit", "-qm", "Independent source root");
    const unrelatedHead = f.git(f.source, "rev-parse", "HEAD");
    await assert.rejects(f.prepare({ target: path.join(f.temporary, "unrelated-history") }), /Missing\/unrelated/);
    assert.equal(f.git(f.source, "rev-parse", "HEAD"), unrelatedHead);
  } finally { f.cleanup(); }
});
