import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { checkRepository, git } from "../script/check-deployment-secrets.mjs";
import { scanText } from "../script/secret-patterns.mjs";
import { auditHistory } from "../script/audit-secret-history.mjs";
const require = createRequire(import.meta.url);
const { validateProductionConfig } = require("../deploy/pm2-config-policy.cjs");
const root = resolve(".");
const ignores = readFileSync(".gitignore", "utf8");
const fixtureSecret = "fixture_secret_DO_NOT_PRINT";
// Allowlist child environments: do not inherit any live credential values.
const childEnv = { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, HOME: tmpdir() };

function fixtureRepo(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "meterflo-secret-check-"));
  try {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.name", "Fixture"]);
    git(dir, ["config", "user.email", "fixture@example.invalid"]);
    writeFileSync(join(dir, ".gitignore"), ignores);
    writeFileSync(join(dir, ".env.example"), "SESSION_SECRET=CHANGE_ME\n");
    git(dir, ["add", ".gitignore", ".env.example"]);
    git(dir, ["commit", "-qm", "Synthetic fixture"]);
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("shipped PM2 template derives install root and does not shadow .env settings", () => {
  const config = require("../deploy/ecosystem.config.example.cjs");
  assert.equal(config.apps[0].cwd, root);
  assert.equal(config.apps[0].script, join(root, "dist", "index.cjs"));
  assert.deepEqual(config.apps[0].env, { NODE_ENV: "production" });
  assert.deepEqual(scanText("deploy/ecosystem.config.example.cjs",
    readFileSync("deploy/ecosystem.config.example.cjs", "utf8")).filter(f => f.blocking), []);
});

test("runtime guard rejects credential overrides, alternate environments and CLI arguments without values", () => {
  const base = require("../deploy/ecosystem.config.example.cjs");
  for (const patch of [{ env: { NODE_ENV: "production", SMTP_PASSWORD: fixtureSecret } },
    { env: { NODE_ENV: "production", COOKIE_SECURE: "false" } },
    { env_production: { SESSION_SECRET: fixtureSecret } }, { args: [fixtureSecret] },
    { node_args: [`--secret=${fixtureSecret}`] }, { env_file: ".env" }]) {
    assert.throws(() => validateProductionConfig({ apps: [{ ...base.apps[0], ...patch }] }), error => {
      assert.ok(!String(error).includes(fixtureSecret)); return true;
    });
  }
});

test("patterns distinguish placeholders and never return credentials", () => {
  const findings = scanText("notes.txt", `SMTP_PASSWORD=${fixtureSecret}\nSESSION_SECRET=CHANGE_ME\n`);
  assert.ok(findings.some(f => f.blocking && f.key === "SMTP_PASSWORD"));
  assert.ok(findings.some(f => !f.blocking && f.classification === "placeholder"));
  assert.ok(!JSON.stringify(findings).includes(fixtureSecret));
  assert.ok(scanText("notes.txt", `postgresql://user:${fixtureSecret}@localhost/db`).some(f => f.blocking));
  assert.ok(scanText("notes.txt", "postgresql://user:CHANGE_ME@localhost/db").every(f => !f.blocking));
});

test("static config check rejects unguarded, computed or secret environment blocks", () => {
  for (const source of [
    `module.exports={apps:[{env:{SMTP_PASSWORD:'${fixtureSecret}'}}]}`,
    "module.exports=validateProductionConfig({apps:[{env:{...settings}}]})",
    "module.exports=validateProductionConfig({apps:[{env:settings}]})",
    "module.exports=validateProductionConfig({apps:[{env:{NODE_ENV:'production'}}]});\n// SESSION_SECRET: 'CHANGE_ME'",
  ]) assert.ok(scanText("deploy/ecosystem.config.example.cjs", source).some(f => f.blocking));
});

test("ignore checks include environment variants while retaining safe example", () => fixtureRepo(dir => {
  assert.deepEqual(checkRepository(dir), []);
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  assert.ok(checkRepository(dir).some(f => f.rule === "missing-ignore-protection"));
}));

test("credential literals in the safe environment example are blocked", () => fixtureRepo(dir => {
  writeFileSync(join(dir, ".env.example"), `SESSION_SECRET=${fixtureSecret}\n`);
  assert.ok(checkRepository(dir).some(f => f.blocking && f.key === "SESSION_SECRET"));
}));

test("non-ignored private variant is rejected before it is staged, without reading values", () => fixtureRepo(dir => {
  writeFileSync(join(dir, ".ENV.staging"), `SESSION_SECRET=${fixtureSecret}\n`);
  const findings = checkRepository(dir);
  assert.ok(findings.some(f => f.rule === "private-file-not-ignored"));
  assert.ok(!JSON.stringify(findings).includes(fixtureSecret));
}));

test("tracked private files are rejected even if ignored and without reading their values", () => fixtureRepo(dir => {
  writeFileSync(join(dir, ".env.production"), `SMTP_PASSWORD=${fixtureSecret}\n`);
  git(dir, ["add", "-f", ".env.production"]);
  const findings = checkRepository(dir, { staged: true });
  assert.ok(findings.some(f => f.file === ".env.production" && f.rule === "private-file-tracked"));
  assert.ok(!JSON.stringify(findings).includes(fixtureSecret));
}));

test("force-added PM2 dumps are rejected even for unrecognized credential names", () => fixtureRepo(dir => {
  writeFileSync(join(dir, "dump.pm2"), JSON.stringify({ CUSTOM_CREDENTIAL: fixtureSecret }));
  git(dir, ["add", "-f", "dump.pm2"]);
  const findings = checkRepository(dir, { staged: true });
  assert.ok(findings.some(f => f.file === "dump.pm2" && f.rule === "private-file-tracked"));
  assert.ok(!JSON.stringify(findings).includes(fixtureSecret));
}));

test("staged check reads index rather than cleaned-up working file", () => fixtureRepo(dir => {
  writeFileSync(join(dir, "notes.txt"), `SMTP_PASSWORD=${fixtureSecret}\n`);
  git(dir, ["add", "notes.txt"]);
  writeFileSync(join(dir, "notes.txt"), "Nothing secret here\n");
  assert.ok(checkRepository(dir, { staged: true }).some(f => f.rule === "credential-assignment"));
  assert.deepEqual(checkRepository(dir), []);
}));

test("unstaged ignore edits cannot hide weak staged protections", () => fixtureRepo(dir => {
  writeFileSync(join(dir, ".gitignore"), ".env\n");
  git(dir, ["add", ".gitignore"]);
  writeFileSync(join(dir, ".gitignore"), ignores);
  assert.ok(checkRepository(dir, { staged: true }).some(f => f.rule === "ignore-rules-not-staged"));
}));

test("history audit finds removed synthetic exposure, records coverage, and emits no values", () => fixtureRepo(dir => {
  writeFileSync(join(dir, "old-config.txt"), `SMTP_PASSWORD=${fixtureSecret}\nSESSION_SECRET=CHANGE_ME\n`);
  git(dir, ["add", "old-config.txt"]);
  git(dir, ["commit", "-qm", "Synthetic history"]);
  git(dir, ["rm", "-q", "old-config.txt"]);
  git(dir, ["commit", "-qm", "Removed fixture"]);
  const report = auditHistory(dir);
  assert.equal(report.coverage.reachableCommits, 3);
  assert.ok(report.findings.some(f => f.key === "SMTP_PASSWORD" && f.classification === "potential-credential"));
  assert.ok(report.findings.some(f => f.key === "SESSION_SECRET" && f.classification === "placeholder"));
  assert.ok(!JSON.stringify(report).includes(fixtureSecret));
}));

test("actual dotenv bootstrap loads dummy config, honors external precedence and reloads on restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "meterflo-dotenv-"));
  try {
    const config = require("../deploy/ecosystem.config.example.cjs");
    mkdirSync(join(dir, "deploy"));
    copyFileSync("deploy/ecosystem.config.example.cjs", join(dir, "deploy", "ecosystem.config.cjs"));
    copyFileSync("deploy/pm2-config-policy.cjs", join(dir, "deploy", "pm2-config-policy.cjs"));
    const copied = require(join(dir, "deploy", "ecosystem.config.cjs"));
    assert.equal(copied.apps[0].cwd, dir);
    const dotenv = require.resolve("dotenv/config");
    const policy = resolve("server/httpLoginRecovery.ts");
    const tsx = require.resolve("tsx/esm");
    const launch = (external = {}) => {
      const script = `import '${policy}'; import {httpLoginCookiePolicy} from '${policy}';
        const p=httpLoginCookiePolicy(process.env);
        console.log(JSON.stringify({production:process.env.NODE_ENV==='production',
          port:process.env.PORT,host:process.env.HOST,...p,
          secretLoaded:process.env.SESSION_SECRET==='${fixtureSecret}'}));`;
      const result = spawnSync(process.execPath, ["--import", tsx, "--require", dotenv, "--input-type=module", "-e", script],
        { cwd: copied.apps[0].cwd, env: { ...childEnv, ...config.apps[0].env, ...external }, encoding: "utf8" });
      assert.equal(result.status, 0, "Isolated bootstrap must exit cleanly");
      return JSON.parse(result.stdout.trim());
    };
    writeFileSync(join(dir, ".env"), `SESSION_SECRET=${fixtureSecret}\nPORT=3010\nHOST=127.0.0.1\nCOOKIE_SECURE=true\nEMERGENCY_HTTP_LOGIN=true\n`);
    assert.deepEqual(launch(), { production: true, port: "3010", host: "127.0.0.1", enabled: true, secure: false, secretLoaded: true });
    writeFileSync(join(dir, ".env"), `SESSION_SECRET=${fixtureSecret}\nPORT=3011\nHOST=127.0.0.1\nCOOKIE_SECURE=true\nEMERGENCY_HTTP_LOGIN=false\n`);
    assert.equal(launch().secure, true);
    assert.equal(launch().port, "3011");
    assert.equal(launch({ EMERGENCY_HTTP_LOGIN: "true" }).enabled, true, "Cached external overrides must not be hidden");
    assert.equal(launch({ EMERGENCY_HTTP_LOGIN: "false", PORT: "3020", COOKIE_SECURE: "false" }).secure, false);
    assert.equal(launch({ PORT: "3020" }).port, "3020");
    assert.equal(launch({ SESSION_SECRET: "fixture_external_secret" }).secretLoaded, false,
      "An approved external secret must win without being printed");
    // Choosing a different cwd does not silently load the application's .env.
    const noFile = mkdtempSync(join(tmpdir(), "meterflo-no-dotenv-"));
    try {
      const result = execFileSync(process.execPath, ["--require", dotenv, "-e",
        "console.log(JSON.stringify({loaded:Object.hasOwn(process.env,'SESSION_SECRET')}))"],
        { cwd: noFile, env: childEnv, encoding: "utf8" });
      assert.deepEqual(JSON.parse(result), { loaded: false });
    } finally { rmSync(noFile, { recursive: true, force: true }); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
