import * as fs from "node:fs/promises";
import * as path from "node:path";
import { pool } from "./db";
import { getProjectFilesPath } from "./fileStorage";
import { getProjectDirectoryName } from "./attachmentPaths";
import { planAttachmentMigration, readAttachmentJournal, type AttachmentProject } from "./attachmentMigration";

export async function inventoryInstanceAttachments(hashFiles = true) {
  const root = await getProjectFilesPath();
  const result = await pool.query("SELECT id,name,database_name FROM public.projects ORDER BY id");
  const projects: AttachmentProject[] = [];
  for (const project of result.rows) {
    const entry: AttachmentProject = { id: project.id, name: project.name, workOrders: [] };
    projects.push(entry);
    // No filesystem ownership to resolve for projects without a directory.
    try { await fs.lstat(path.join(root, getProjectDirectoryName(project.name, project.id))); }
    catch (error: any) { if (error.code === "ENOENT") continue; throw error; }
    if (!project.database_name || !/^[a-zA-Z0-9_]+$/.test(project.database_name)) {
      throw new Error(`Project ${project.id} has files but no valid work-order schema. Review ownership before migration.`);
    }
    let last = 0;
    while (true) {
      const { rows } = await pool.query(
        `SELECT id,customer_wo_id AS "customerWoId" FROM "${project.database_name}".work_orders
         WHERE id>$1 ORDER BY id LIMIT 2500`, [last]);
      entry.workOrders.push(...rows);
      if (rows.length < 2500) break;
      last = rows[rows.length - 1].id;
    }
  }
  return planAttachmentMigration(root, projects, hashFiles);
}

export async function assertAttachmentLayoutReady() {
  const plan = await inventoryInstanceAttachments(false);
  let unfinished = false;
  try { unfinished = !(await readAttachmentJournal(plan.root, true)).complete; }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  try { await fs.lstat(path.join(plan.root, ".meterflo-attachment-migration", "lock")); unfinished = true; }
  catch (error: any) { if (error.code !== "ENOENT") throw error; }
  if (unfinished || plan.moves.length || plan.directories.length || plan.blockers.length) {
    throw new Error(`Attachment maintenance required (${plan.moves.length} files, ${plan.blockers.length} review blockers). ` +
      "Stop MeterFlo and run: npx --no-install tsx script/migrate-attachment-folders.ts --dry-run. " +
      "Resolve blockers, then use --apply --offline or --resume --offline. No files were moved by this check.");
  }
}
