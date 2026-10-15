import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { readInventorySandbox } from "./helpers/inventory-sandbox";

test("standalone admission rejects remote/live targets and mismatched ownership configuration", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "meterflo-volume-"));
  const file = path.join(root, "sandbox.json");
  const config = { runId: randomUUID(), databasePort: 32111, appPort: 32112, baseURL: "http://127.0.0.1:32112" };
  const url = "postgresql://mf_volume@127.0.0.1:32111/postgres";
  try {
    await writeFile(file, JSON.stringify(config));
    assert.equal((await readInventorySandbox(file, url)).runId, config.runId);
    for (const invalid of [undefined, "postgresql://postgres@127.0.0.1:5432/postgres", "postgresql://mf_volume@customer.example:32111/postgres"])
      await assert.rejects(readInventorySandbox(file, invalid), /disposable database/);
    for (const override of [{ baseURL: "https://customer.example" }, { appPort: config.databasePort }, { runId: "not-owned" }]) {
      await writeFile(file, JSON.stringify({ ...config, ...override }));
      await assert.rejects(readInventorySandbox(file, url));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
