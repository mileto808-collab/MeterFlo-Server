import "dotenv/config";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import bcrypt from "bcryptjs";
import { pool } from "../../server/db";
import { storage } from "../../server/storage";
import { initializeCustomerApi } from "../../server/customerApiService";

const fixtureFile = "/tmp/meterflo-customer-api-ui-fixture.json";
async function main() {
if (process.argv[2] === "cleanup") {
  const fixture = JSON.parse(await fs.readFile(fixtureFile, "utf8"));
  await pool.query(`DELETE FROM public.projects WHERE id=$1`, [fixture.projectId]);
  await pool.query(`DELETE FROM public.sessions
    WHERE sess->'passport'->>'user'=ANY($1::text[])
      OR sess->'passport'->'user'->'claims'->>'sub'=ANY($1::text[])`, [[fixture.admin.id,fixture.viewer.id]]);
  await pool.query(`DELETE FROM public.users WHERE id=ANY($1::text[])`, [[fixture.admin.id,fixture.viewer.id]]);
  await pool.query(`DELETE FROM public.subroles WHERE id=$1`, [fixture.viewerSubroleId]);
  await fs.unlink(fixtureFile);
  await pool.end();
  console.log("Customer API UI fixtures removed.");
} else {
  await initializeCustomerApi();
  const suffix = randomUUID().slice(0, 8);
  const password = `Test-only-${randomUUID()}!`;
  const hash = await bcrypt.hash(password, 10);
  const adminSubrole = await storage.getAdministratorSubrole();
  if (!adminSubrole) throw new Error("Start MeterFlo once to initialize the administrator subrole");
  const admin = await storage.createLocalUser(`retry-admin-${suffix}`, hash, "admin", "Retry", "Test", null, adminSubrole.id);
  const viewerSubrole = await storage.createSubrole({ key: `retry-viewer-${suffix}`, label: `Retry viewer ${suffix}`, baseRole: "user" });
  await storage.setSubrolePermissions(viewerSubrole.id, ["settings.customerApiLogs","nav.settings","nav.dashboard"]);
  const viewer = await storage.createLocalUser(`retry-viewer-${suffix}`, hash, "user", "Viewer", "Test", null, viewerSubrole.id);
  const received: any[] = [];
  const receiver = createServer(async (req, res) => {
    if (req.method === "GET") {
      res.setHeader("Content-Type", "application/json");
      return res.end(JSON.stringify(received));
    }
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push({ idempotencyKey: req.headers["idempotency-key"], payload: JSON.parse(body) });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"accepted":true}');
  });
  await new Promise<void>(resolve => receiver.listen(0, "127.0.0.1", resolve));
  const receiverUrl = `http://127.0.0.1:${(receiver.address() as { port: number }).port}`;
  const projectName = `Customer retry UI test ${suffix}`;
  const { rows: [project] } = await pool.query(
    `INSERT INTO public.projects(name,customer_api_enabled,customer_api_url,customer_api_auth_type,customer_api_send_photos)
     VALUES ($1,true,$2,'none',false) RETURNING id`, [projectName,receiverUrl]);
  await pool.query(`INSERT INTO public.user_projects(user_id,project_id) VALUES ($1,$2)`, [viewer.id,project.id]);
  const deliveryId = randomUUID();
  const payload = JSON.stringify({ schemaVersion: 2, deliveryId, projectId: project.id, workOrderId: 1, customerWoId: `TEST-${suffix}`, status: "Completed", newSystemId: "test-meter" });
  await pool.query(
    `INSERT INTO public.customer_api_deliveries(id,project_id,work_order_id,customer_wo_id,version_key,snapshot,payload,status,attempt_count,cycle_attempts,last_error,last_response_status)
     VALUES ($1,$2,1,$3,'fixture-v1','{}',$4,'failed',1,5,'HTTP 503: Service Unavailable',503)`,
    [deliveryId,project.id,`TEST-${suffix}`,payload]);
  await pool.query(
    `INSERT INTO public.customer_api_logs(project_id,work_order_id,customer_wo_id,request_url,request_payload,response_status,response_body,success,error_message,delivery_id,attempt_number,triggered_by)
     VALUES ($1,1,$2,$3,$4,503,'{"error":"Test receiver was unavailable"}',false,'HTTP 503',$5,1,'automatic')`,
    [project.id,`TEST-${suffix}`,receiverUrl,payload,deliveryId]);
  await fs.writeFile(fixtureFile, JSON.stringify({
    projectId: project.id,projectName,deliveryId,receiverUrl,viewerSubroleId: viewerSubrole.id,
    admin: { id: admin.id,username: admin.username,password }, viewer: { id: viewer.id,username: viewer.username,password },
  }), { mode: 0o600 });
  console.log(`Customer API UI fixture ready. Details: ${fixtureFile}`);
}
}
main().catch(error => { console.error("Customer API UI fixture failed:", error.message); process.exitCode = 1; });
