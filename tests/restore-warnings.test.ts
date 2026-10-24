import { test } from "node:test";
import assert from "node:assert/strict";
import { recordRestoreWarnings, safeRestoreWarning } from "../server/restoreWarnings";

test("restore diagnostics redact values and credentials without removing useful schema details", () => {
  const warning = safeRestoreWarning(`NOTICE: schema "project_fixture" already exists; password=example-secret postgresql://user:pass@host/db value 'private''value'`);
  assert.match(warning, /schema "project_fixture" already exists/);
  for (const secret of ["example-secret", "user:pass", "private", "host/db"]) assert.ok(!warning.includes(secret));
});

for (const route of ["/api/system/restore", "/api/system/restore/finalize"]) {
  test(`${route} logs each warning and returns identical safe details without changing success`, () => {
    const logs: unknown[][] = [];
    const original = console.warn;
    console.warn = (...args) => { logs.push(args); };
    try {
      let result: any;
      let continued = false;
      const res: any = { statusCode: 200, json: (body: unknown) => { result = body; return res; } };
      recordRestoreWarnings({ route: { path: route } } as any, res, () => { continued = true; });
      res.json({ success: true, filesRestored: 0, warnings: ['NOTICE: schema "fixture" already exists', "WARNING: value 'private'", "", null] });
      assert.equal(continued, true);
      assert.equal(result.success, true);
      assert.equal(result.filesRestored, 0);
      assert.equal(logs.length, 2);
      for (let i = 0; i < logs.length; i++) {
        const diagnostic = JSON.parse(logs[i][1] as string);
        assert.equal(diagnostic.path, route);
        assert.equal(diagnostic.warning, result.warnings[i]);
        assert.equal(diagnostic.warningNumber, i + 1);
        assert.equal(diagnostic.warningCount, 2);
        assert.equal(diagnostic.status, 200);
      }
      res.statusCode = 500;
      res.json({ success: false, message: "Restore failed" });
      assert.equal(result.success, false);
      assert.equal(logs.length, 2, "No fabricated warnings on errors");
    } finally { console.warn = original; }
  });
}
