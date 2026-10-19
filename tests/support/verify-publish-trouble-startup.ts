import assert from "node:assert/strict";

// This guard runs before server imports, which otherwise use DATABASE_URL.
if (process.env.REPL_ID !== "owned-publishing-test" ||
    process.env.REPLIT_DEV_DOMAIN !== "owned-publishing-test.replit.dev")
  throw new Error("Run only through the internally owned publishing validator.");

const { pool } = await import("../../server/db");
try {
  const { initializeAllProjectTroubleCodes } = await import("../../server/projectTroubleCodes");
  const retainedKey = async () => (await pool.query(`SELECT oid,conindid FROM pg_constraint
    WHERE conrelid='public.trouble_codes'::regclass AND conname='trouble_codes_code_key' AND contype='u'`)).rows;
  const originalKey = await retainedKey();
  assert.equal(originalKey.length, 1, "Publish-stage key must exist before startup");
  const codes = (await pool.query("SELECT id,code,label,rule_key FROM public.trouble_codes ORDER BY id")).rows;
  for (let pass = 1; pass <= 2; pass++) {
    await initializeAllProjectTroubleCodes();
    assert.deepEqual(await retainedKey(), originalKey, `Initialization ${pass} must retain the same constraint and index`);
    assert.deepEqual((await pool.query("SELECT id,code,label,rule_key FROM public.trouble_codes ORDER BY id")).rows, codes);
    const orders = (await pool.query("SELECT id,trouble FROM project_publish_reference_fixture.work_orders ORDER BY id")).rows;
    assert.deepEqual(orders, [{ id: 101, trouble: codes[0].rule_key }, { id: 102, trouble: codes[1].rule_key }],
      "UUID reference conversion retains the original trouble-code identities");
  }
  console.log("PASS: real startup initialization twice preserves the declared publish-stage unique key and index while retaining UUID work-order references and catalog records.");
} finally { await pool.end(); }
