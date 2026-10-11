import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { httpLoginCookiePolicy } from "../server/httpLoginRecovery";

test("recovery is explicit and takes precedence without changing the permanent policy", () => {
  for (const value of [undefined, "", "false", "TRUE", "1", " true "]) {
    assert.deepEqual(httpLoginCookiePolicy({ COOKIE_SECURE: "true", EMERGENCY_HTTP_LOGIN: value }),
      { enabled: false, secure: true });
  }
  assert.deepEqual(httpLoginCookiePolicy({ COOKIE_SECURE: "true", EMERGENCY_HTTP_LOGIN: "true" }),
    { enabled: true, secure: false });
  assert.deepEqual(httpLoginCookiePolicy({ COOKIE_SECURE: "false", EMERGENCY_HTTP_LOGIN: "true" }),
    { enabled: true, secure: false });
  assert.deepEqual(httpLoginCookiePolicy({ COOKIE_SECURE: "false", EMERGENCY_HTTP_LOGIN: "false" }),
    { enabled: false, secure: false });
  assert.deepEqual(httpLoginCookiePolicy({}), { enabled: false, secure: false });
});

test("recovery instructions and template include activation, shutdown and server-wide risk", () => {
  for (const file of ["deploy/WINDOWS_DEPLOYMENT.md", "SYSTEM_ADMIN_GUIDE.md", "replit.md"]) {
    const text = readFileSync(file, "utf8");
    assert.ok(text.includes("EMERGENCY_HTTP_LOGIN=true"));
    assert.ok(text.includes("restart"));
  }
  const guide = readFileSync("deploy/WINDOWS_DEPLOYMENT.md", "utf8");
  assert.ok(guide.includes("EMERGENCY_HTTP_LOGIN=false"));
  assert.ok(guide.includes("#### Temporary HTTP login recovery"));
  assert.ok(guide.includes("All users"));
  assert.ok(guide.includes("does **not** revoke"));
  assert.ok(readFileSync(".env.example", "utf8").includes("EMERGENCY_HTTP_LOGIN=false"));
});
