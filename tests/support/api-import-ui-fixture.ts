import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import bcrypt from "bcryptjs";
import { pool } from "../../server/db";
import { storage } from "../../server/storage";
import { createProjectSchema } from "../../server/projectDb";
import { initializeApiImports } from "../../server/apiImportService";

const file = "/tmp/meterflo-api-import-ui-fixture.json";
async function main() {
  if (process.argv[2] === "cleanup") {
    const fixture = JSON.parse(await fs.readFile(file, "utf8"));
    await pool.query(`DROP SCHEMA "${fixture.schema}" CASCADE`);
    await pool.query(`DELETE FROM public.projects WHERE id=$1`, [fixture.projectId]);
    await pool.query(`DELETE FROM public.sessions WHERE sess->'passport'->'user'->'claims'->>'sub'=ANY($1::text[])`, [[fixture.admin.id, fixture.viewer.id]]);
    await pool.query(`DELETE FROM public.users WHERE id=ANY($1::text[])`, [[fixture.admin.id, fixture.viewer.id]]);
    await pool.query(`DELETE FROM public.subroles WHERE id=$1`, [fixture.viewerSubroleId]);
    await fs.unlink(file); await pool.end(); console.log("API Import UI fixtures removed."); return;
  }
  await initializeApiImports();
  const suffix = randomUUID().slice(0, 8), password = `Test-only-${randomUUID()}!`;
  const hash = await bcrypt.hash(password, 10);
  const adminSubrole = await storage.getAdministratorSubrole();
  const admin = await storage.createLocalUser(`pull-admin-${suffix}`, hash, "admin", "API", "Test", null, adminSubrole?.id);
  const viewerSubrole = await storage.createSubrole({ key: `pull-viewer-${suffix}`, label: "API pull test viewer", baseRole: "user" });
  await storage.setSubrolePermissions(viewerSubrole.id, ["nav.projects", "nav.dashboard", "projects.view", "project.workOrders", "workOrders.view"]);
  const viewer = await storage.createLocalUser(`pull-viewer-${suffix}`, hash, "user", "API Viewer", "Test", null, viewerSubrole.id);
  const service = (await storage.getServiceTypes())[0].code;
  const source = createServer((req, res) => {
    const query = new URL(req.url!, "http://test.invalid").searchParams;
    res.setHeader("Content-Type", "application/json");
    if (query.has("fail")) { res.writeHead(401); res.end('{"error":"Fixture authentication failure"}'); return; }
    res.end(JSON.stringify({ data: [{ woId: "API-UI-0001", customerId: "UI-C1", customerName: "API test customer",
      address: "123 Fixture Street", serviceType: service, reading: "0.001" }] }));
  });
  await new Promise<void>(resolve => source.listen(0, "127.0.0.1", resolve));
  const sourceUrl = `http://127.0.0.1:${(source.address() as any).port}/orders`;
  const { rows: [project] } = await pool.query(`INSERT INTO public.projects(name) VALUES($1) RETURNING id,name`, [`API import UI fixture ${suffix}`]);
  const schema = await createProjectSchema(project.name, project.id);
  await pool.query(`UPDATE public.projects SET database_name=$2 WHERE id=$1`, [project.id, schema]);
  await storage.assignUserToProject(viewer.id, project.id);
  const fixture = { projectId: project.id, schema, sourceUrl, viewerSubroleId: viewerSubrole.id,
    admin: { id: admin.id, username: admin.username, password }, viewer: { id: viewer.id, username: viewer.username, password },
    settings: { name: "Customer fixture feed", endpoint: sourceUrl, recordsPath: "data", fieldMapping: {
      woId: "customerWoId", customerId: "customerId", customerName: "customerName", address: "address", serviceType: "serviceType", reading: "oldSystemReading",
    } } };
  await fs.writeFile(file, JSON.stringify(fixture), { mode: 0o600 });
  console.log(`API Import UI fixture ready; test-only login/source details in ${file}`);
}
main().catch(() => { console.error("API import fixture setup failed"); process.exitCode = 1; });
