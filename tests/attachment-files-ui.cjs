if (!process.env.WORKSPACE_UI_SANDBOX_CONFIG) throw new Error("Run in the owned workspace sandbox.");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { chromium } = require("@playwright/test");

(async () => {
  const fixture = JSON.parse(await fs.readFile("/tmp/meterflo-inventory-ui-fixture.json", "utf8"));
  const browser = await chromium.launch({ executablePath: "/repl/tools/bin/chromium", args: ["--no-sandbox"] });
  const context = await browser.newContext({ baseURL: require("./support/workspace-ui-base.cjs")() });
  try {
    assert.equal((await context.request.post("/api/auth/local/login", { data: fixture })).status(), 200);
    const p = fixture.projectId, base = `/api/projects/${p}`;
    const service = (await (await context.request.get("/api/service-types")).json())[0].code;
    const created = await context.request.post(`${base}/work-orders`, { data: {
      customerWoId: `ATTACHMENT_${p}`, customerId: "ATTACHMENT_FIXTURE",
      customerName: "Attachment fixture", address: "100 Fixture St", status: "Open", serviceType: service,
    } });
    assert.equal(created.status(), 201);
    const order = await created.json(), filesUrl = `${base}/work-orders/${order.id}/files`;
    const bytes = Buffer.from("Canonical attachment evidence\n");
    const upload = await context.request.post(filesUrl, { multipart: {
      file: { name: "evidence.txt", mimeType: "text/plain", buffer: bytes },
    } });
    assert.equal(upload.status(), 201);
    const listed = await context.request.get(filesUrl);
    assert.equal(listed.status(), 200);
    const body = await listed.json();
    assert.ok(JSON.stringify(body).includes("evidence.txt"));
    const downloaded = await context.request.get(`${filesUrl}/evidence.txt/download`);
    assert.equal(downloaded.status(), 200);
    assert.deepEqual(await downloaded.body(), bytes);
    execFileSync(process.execPath, ["--import", "tsx", "script/migrate-attachment-folders.ts", "--dry-run"], {
      env: process.env, stdio: "inherit",
    });
    execFileSync(process.execPath, ["--import", "tsx", "script/migrate-attachment-folders.ts", "--check"], {
      env: process.env, stdio: "inherit",
    });
    assert.equal((await context.request.delete(`${filesUrl}/evidence.txt`)).status(), 204);
    const empty = await (await context.request.get(filesUrl)).json();
    assert.ok(!JSON.stringify(empty).includes("evidence.txt"));
    const documents = `${base}/files`;
    assert.equal((await context.request.post(documents, { multipart: {
      file: { name: "document.txt", mimeType: "text/plain", buffer: bytes },
    } })).status(), 201);
    assert.ok(JSON.stringify(await (await context.request.get(documents)).json()).includes("document.txt"));
    const document = await context.request.get(`${documents}/document.txt/download`);
    assert.equal(document.status(), 200);
    assert.deepEqual(await document.body(), bytes);
    assert.equal((await context.request.delete(`${documents}/document.txt`)).status(), 204);
    console.log("PASS canonical attachment upload/list/download/delete, byte integrity, read-only CLI inventory and readiness.");
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
