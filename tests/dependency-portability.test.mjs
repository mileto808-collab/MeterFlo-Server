import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { checkDependencyPortability, scanDependencyText, isDependencyConfiguration } from "../script/check-dependency-portability.mjs";

const internal = "package-firewall.replit.internal";
const script = path.resolve("script/check-dependency-portability.mjs");
test("host detection covers scoped tarballs, credentials, escaped JSON and registry configs without revealing values", () => {
  for (const file of ["package-lock.json", "nested/npm-shrinkwrap.json", "nested/.npmrc", "pnpm-lock.yaml", "yarn.lock", ".yarnrc.yml", "bun.lock"]) {
    assert.ok(isDependencyConfiguration(file));
    const fixtureCredentials = ["DO_NOT_PRINT", "FAKE_TEST_PASSWORD"];
    const parsed = new URL(`https://${internal}./npm/@scope/name/-/name-1.tgz?token=FAKE_QUERY`);
    parsed.username = fixtureCredentials[0];
    parsed.password = fixtureCredentials[1];
    parsed.port = "80";
    const url = parsed.href.replace(internal, internal.toUpperCase());
    const text = file.endsWith(".json") ? JSON.stringify({packages:{"node_modules/example":{resolved:url}}}) : `registry=${url}`;
    const findings = scanDependencyText(file, text);
    assert.deepEqual(findings, [{file, rule:"internal-package-download-host"}]);
    assert.ok(!JSON.stringify(findings).includes("FAKE_"));
    assert.ok(!JSON.stringify(findings).includes("DO_NOT_PRINT"));
  }
  assert.equal(scanDependencyText("package-lock.json", '{"resolved":"http:\\/\\/package-firewall.replit.internal\\/npm\\/x.tgz"}').length, 1);
  assert.equal(scanDependencyText("package-lock.json", '{"resolved":"http://\\u0070ackage-firewall.replit.internal/npm/x.tgz"}').length, 1);
  assert.equal(scanDependencyText(".npmrc", `@scope:registry=//${internal}/npm/`).length, 1);
  for (const url of ["https://registry.npmjs.org/@scope/name/-/name-1.tgz", "https://example.com/archive.tgz",
    `https://${internal}.example.org/x.tgz`, `https://registry.npmjs.org/path/${internal}/x.tgz`]) {
    assert.deepEqual(scanDependencyText("package-lock.json", JSON.stringify({resolved:url})), []);
  }
  assert.deepEqual(scanDependencyText("package.json", "{bad-json"), [{file:"package.json", rule:"invalid-dependency-json"}]);
});
test("working-tree, staged and ZIP checks fail closed and inspect index content independently", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "meterflo-portability-"));
  const git = (...args) => execFileSync("git", args, {cwd:root, stdio:"ignore"});
  const write = (name, content) => {fs.mkdirSync(path.dirname(path.join(root,name)), {recursive:true}); fs.writeFileSync(path.join(root,name),content);};
  const lock = JSON.stringify({lockfileVersion:3, packages:{"node_modules/example":{version:"1.0.0", resolved:`http://${internal}/npm/example/-/example-1.tgz`}}});
  const clean = lock.replace(`http://${internal}/npm/`, "https://registry.npmjs.org/");
  try {
    write("package.json", '{"name":"fixture"}'); write("package-lock.json",lock);
    assert.equal(checkDependencyPortability(root,{filesOnly:true}).length,1,"ZIP works without Git or installed dependencies");
    git("init","-q"); git("add","package.json","package-lock.json");
    write("package-lock.json",clean);
    assert.deepEqual(checkDependencyPortability(root),[]);
    assert.equal(checkDependencyPortability(root,{staged:true}).length,1,"clean working file cannot hide bad staged lock");
    git("add","package-lock.json");
    assert.deepEqual(checkDependencyPortability(root,{staged:true}),[]);
    const fixtureCredentials = ["fake", "FAKE_CONFIG"].join(":");
    write("nested/.npmrc",`registry=http://${fixtureCredentials}@${internal}/npm/`);
    assert.equal(checkDependencyPortability(root).length,1,"new untracked dependency configuration is checked");
    assert.equal(checkDependencyPortability(root,{filesOnly:true}).length,1);
    const run = spawnSync(process.execPath,[script], {cwd:root,encoding:"utf8"});
    assert.equal(run.status,1);assert.ok(!run.stdout.includes("FAKE_CONFIG"));
    fs.rmSync(path.join(root,"nested"),{recursive:true});
    const linkHash = execFileSync("git", ["hash-object","-w","--stdin"], {cwd:root,input:"outside-private-config",encoding:"utf8"}).trim();
    git("update-index","--add","--cacheinfo",`120000,${linkHash},.npmrc`);
    assert.ok(checkDependencyPortability(root,{staged:true}).some(f=>f.rule==="unverified-dependency-file"));
    git("update-index","--force-remove",".npmrc");
    write("node_modules/unused/package-lock.json",lock);
    assert.deepEqual(checkDependencyPortability(root,{filesOnly:true}),[],"installed packages are not distribution source");
    fs.rmSync(path.join(root,"package-lock.json"));
    assert.ok(checkDependencyPortability(root,{filesOnly:true}).some(f=>f.rule==="missing-npm-lockfile"));
    assert.equal(spawnSync(process.execPath,[script,"--files","--staged"],{cwd:root}).status,2);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test("actual build refuses internal URLs before removing a prior build", {
  skip:!fs.existsSync(path.resolve("node_modules/tsx/dist/cli.mjs")),
}, () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"meterflo-build-portability-"));
  try {
    fs.mkdirSync(path.join(root,"script"));
    fs.mkdirSync(path.join(root,"dist"));
    fs.copyFileSync(script,path.join(root,"script/check-dependency-portability.mjs"));
    fs.writeFileSync(path.join(root,"dist/prior-build"),"keep");
    fs.writeFileSync(path.join(root,"package.json"),'{"name":"fixture"}');
    fs.writeFileSync(path.join(root,"package-lock.json"),JSON.stringify({resolved:`http://${internal}/npm/example.tgz`}));
    const env={PATH:process.env.PATH,HOME:root,NODE_ENV:"production"};
    if(process.env.LD_LIBRARY_PATH) env.LD_LIBRARY_PATH=process.env.LD_LIBRARY_PATH;
    const run=spawnSync(process.execPath,[
      path.resolve("node_modules/tsx/dist/cli.mjs"),path.resolve("script/build.ts"),
    ],{cwd:root,env,encoding:"utf8",timeout:30000});
    assert.equal(run.status,1);
    assert.ok(run.stdout.includes("internal-package-download-host"));
    assert.equal(fs.readFileSync(path.join(root,"dist/prior-build"),"utf8"),"keep");
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
