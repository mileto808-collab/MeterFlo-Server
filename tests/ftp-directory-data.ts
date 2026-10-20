import assert from "node:assert/strict";
import { readFile, readdir, unlink, access, mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { randomUUID } from "node:crypto";
async function main() {
  assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Owned sandbox required");
  const config = JSON.parse(await readFile(process.env.WORKSPACE_UI_SANDBOX_CONFIG!, "utf8"));
  assert.equal(config.ownedWorkspaceSandbox, true);
  const fixture = JSON.parse(await readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  process.chdir(path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG!));
  const { pool } = await import("../server/db");
  const { enableAuditing, withAuditContext } = await import("../server/auditContext");
  enableAuditing();
  try {
    await withAuditContext({ actorId: fixture.id, actorLabel: fixture.username, actorKind: "user",
      source: "ftpDirectoryAcceptance", operationId: randomUUID() }, async () => {
      const { workOrderColumnGuide } = await import("../server/file-transfers/column-guide");
      const guide = await workOrderColumnGuide(fixture.projectId);
      const { rows: columns } = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='work_orders'", [fixture.schema]);
      assert.deepEqual(guide.columns.map(c => c.databaseColumn).sort(), columns.map(c => c.column_name).sort());
      assert.ok(guide.columns.some(c => c.requirement === "required"));
      const { getFtpFilesPath } = await import("../server/fileStorage");
      const root = await getFtpFilesPath();
      const folders = await readdir(root);
      assert.equal(folders.length, 1);
      const target = path.join(root, folders[0], "Project FTP Files", "custom.csv");
      await access(target);
      const { createPgBackupArchive, restoreFilesFromPgArchive } = await import("../server/pgBackup");
      const response = new PassThrough() as any;
      response.setHeader = () => {};
      response.status = () => response;
      response.json = () => { throw Error("Archive failed"); };
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      const end = new Promise<void>((resolve, reject) => { response.on("end", resolve); response.on("error", reject); });
      await createPgBackupArchive(response, "project");
      await end;
      const buffer = Buffer.concat(chunks);
      const unzipper = await import("unzipper");
      const archive = await unzipper.Open.buffer(buffer);
      assert.ok(archive.files.some(f => f.path.startsWith("ftp_files/") && f.path.endsWith("/custom.csv")));
      await unlink(target);
      const restored = await restoreFilesFromPgArchive(buffer, path.join(path.dirname(process.env.WORKSPACE_UI_SANDBOX_CONFIG!), "restore-documents"));
      assert.deepEqual(restored.errors, []);
      await access(target);
      const { rows: [project] } = await pool.query("SELECT name FROM public.projects WHERE id=$1", [fixture.projectId]);
      const token = `${fixture.projectId}-${randomUUID()}`;
      const journal = path.join(root, ".meterflo-project-deletions", token);
      await mkdir(journal, { recursive: true });
      await writeFile(path.join(journal, "manifest.json"), JSON.stringify({ projectId: fixture.projectId,
        projectName: project.name, root, token, folders: [folders[0]] }));
      await rename(path.join(root, folders[0]), path.join(journal, "files"));
      const { pendingProjectFileCleanups } = await import("../server/projectDeletion");
      const { getProjectFilesPath } = await import("../server/fileStorage");
      assert.deepEqual(await pendingProjectFileCleanups(await getProjectFilesPath()), []);
      await access(target);
      console.log("Live column help and custom FTP backup/restore verified.");
    });
  } finally { await pool.end(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
