import assert from "node:assert/strict";
import { readFile, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function readInventorySandbox(file: string, databaseUrl: string | undefined) {
  const resolved = await realpath(file);
  const parent = path.dirname(resolved);
  assert.equal(path.dirname(parent), await realpath(os.tmpdir()), "Sandbox must be in the OS temporary directory");
  assert.ok(path.basename(parent).startsWith("meterflo-volume-"), "Owned sandbox directory required");
  assert.equal(path.basename(resolved), "sandbox.json");
  const config = JSON.parse(await readFile(resolved, "utf8"));
  assert.match(config.runId, /^[0-9a-f-]{36}$/);
  for (const port of [config.databasePort, config.appPort])
    assert.ok(Number.isInteger(port) && port > 1024 && port < 65536);
  assert.notEqual(config.databasePort, config.appPort);
  assert.equal(config.baseURL, `http://127.0.0.1:${config.appPort}`);
  assert.equal(databaseUrl, `postgresql://mf_volume@127.0.0.1:${config.databasePort}/postgres`,
    "Only the runner's disposable database is permitted");
  return config as { runId: string; databasePort: number; appPort: number; baseURL: string };
}
