import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../server/db";
import { storage } from "../server/storage";
import { ensureProjectFtpDirectory, resolveProjectFtpFile } from "../server/fileStorage";

async function main() {
  const ownership = JSON.parse(await fs.readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG || "", "utf8"));
  assert.equal(ownership.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const project = (await storage.getProject(fixture.projectId))!;
  const root = await ensureProjectFtpDirectory(project.name, project.id);
  for (const name of ["incoming", "outgoing"]) {
    const info = await fs.lstat(path.join(root, name));
    assert(info.isDirectory() && !info.isSymbolicLink());
  }
  if (process.argv[2] === "prepare") {
    const csv = "wo,customer,name,address,service\nLOCAL-FOLDER-1,C-LOCAL,Local customer,102 Test St,workspace-fixture\n";
    await fs.writeFile(path.join(root, "incoming/local_admin.csv"), csv);
    await fs.writeFile(path.join(root, "legacy_admin.csv"), csv.replace("LOCAL-FOLDER-1", "LEGACY-FOLDER-1"));
    await fs.writeFile(path.join(root, "outgoing/manual_customer.csv"), "customer download\n");
    await fs.writeFile(path.join(root, "outgoing/not_an_import.csv"), csv.replace("LOCAL-FOLDER-1", "MUST-NOT-IMPORT"));
    const outside = path.join(path.dirname(root), "not-public.csv");
    await fs.writeFile(outside, "private fixture\n");
    await fs.symlink(outside, path.join(root, "outgoing/link.csv"));
    for (const value of ["../not-public.csv", "incoming/../../not-public.csv", "outgoing/link.csv", "C:\\Windows\\test.csv", ".meterflo-sftp-staging/file.csv"])
      await assert.rejects(resolveProjectFtpFile(project.name, project.id, value));
  } else if (process.argv[2] === "upload") {
    const name = process.argv[3];
    assert(name && path.basename(name) === name);
    assert.match(await fs.readFile(path.join(root, "incoming", name), "utf8"), /INBOUND-SFTP-1/);
    await assert.rejects(fs.access(path.join(root, name)));
  } else if (process.argv[2] === "legacy-export") {
    const name = process.argv[3];
    assert(name && path.basename(name) === name);
    await fs.rename(path.join(root, "outgoing", name), path.join(root, name));
  }
  console.log("PASS real shared FTP folders and local file access");
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => pool.end());
