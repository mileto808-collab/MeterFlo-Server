import "dotenv/config";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { promises as fs } from "node:fs";
import { pool } from "../../server/db";
import { storage } from "../../server/storage";
import { createProjectSchema } from "../../server/projectDb";
import { initializeInventory } from "../../server/inventoryMigration";
const file = "/tmp/meterflo-inventory-ui-fixture.json";
async function main() {
  if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(await fs.readFile(file, "utf8"));
    await pool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
    for (const table of ["inventory_movements", "inventory_quantities", "inventory_items", "inventory_state"]) await pool.query(`DELETE FROM public.${table} WHERE project_id=$1`, [fixture.projectId]);
    await pool.query("DELETE FROM public.projects WHERE id=$1", [fixture.projectId]);
    await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=$1", [fixture.id]);
    await pool.query("DELETE FROM public.users WHERE id=$1", [fixture.id]);
    if (fixture.viewer) {
      await pool.query("DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=$1", [fixture.viewer.id]);
      await pool.query("DELETE FROM public.users WHERE id=$1", [fixture.viewer.id]);
      await pool.query("DELETE FROM public.subrole_permissions WHERE subrole_id=$1", [fixture.viewerRoleId]);
      await pool.query("DELETE FROM public.subroles WHERE id=$1", [fixture.viewerRoleId]);
    }
    await fs.unlink(file); return;
  }
  await initializeInventory(pool);
  const suffix = randomUUID().slice(0, 8), password = `Fixture-${randomUUID()}!`;
  const admin = await storage.ensureAdministratorSubrole();
  const user = await storage.createLocalUser(`inventory-ui-${suffix}`, await bcrypt.hash(password, 4), "admin", "Inventory", "Fixture", null, admin.id);
  const { rows: [project] } = await pool.query("INSERT INTO public.projects(name,inventory_enabled) VALUES($1,true) RETURNING id,name", [`Inventory UI fixture ${suffix}`]);
  const schema = await createProjectSchema(project.name, project.id);
  await pool.query("UPDATE public.projects SET database_name=$2 WHERE id=$1", [project.id, schema]);
  await storage.assignUserToProject(user.id, project.id);
  const viewerRole = await storage.createSubrole({ key: `inventory-viewer-fixture-${suffix}`, label: "Inventory test viewer", baseRole: "user" });
  await storage.setSubrolePermissions(viewerRole.id, ["workOrders.view", "projects.view"]);
  const viewerPassword = `Fixture-${randomUUID()}!`;
  const viewer = await storage.createLocalUser(`inventory-viewer-${suffix}`, await bcrypt.hash(viewerPassword, 4), "user", "Inventory", "Viewer", null, viewerRole.id);
  await storage.assignUserToProject(viewer.id, project.id);
  await fs.writeFile(file, JSON.stringify({ projectId: project.id, schema, id: user.id, username: user.username, password,
    viewerRoleId: viewerRole.id, viewer: { id: viewer.id, username: viewer.username, password: viewerPassword } }), { mode: 0o600 });
  console.log("Isolated inventory UI fixture created.");
}
main().catch(() => { console.error("Inventory fixture setup failed."); process.exitCode = 1; }).finally(() => pool.end());
