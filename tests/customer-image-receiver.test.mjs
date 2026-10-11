import test from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createImageReceiver, decodeImage } from "../examples/customer-image-receiver.mjs";

// Complete 1x1 PNG, not a shortened documentation placeholder.
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
const photo = (type, filename = `${type}/sample.png`) => ({ filename, type, contentType: "image/png", data: PNG });
const payload = overrides => ({
  schemaVersion: 2, deliveryId: randomUUID(), projectId: 1, workOrderId: 42, customerWoId: "0002042",
  updatedAt: "2026-10-11T20:00:00.000Z", deliveryCreatedAt: "2026-10-11T20:00:01.000Z",
  signatureName: "Demo signer", ...overrides,
});

test("fixture PNG has valid chunks/CRCs and a complete red RGBA pixel; large base64 decoding is bounded", () => {
  const bytes = Buffer.from(PNG, "base64");
  const crc32 = buffer => {
    let crc = 0xffffffff;
    for (const byte of buffer) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ 0xffffffff) >>> 0;
  };
  let offset = 8;
  const imageData = [];
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + size);
    assert.equal(crc32(bytes.subarray(offset + 4, offset + 8 + size)), bytes.readUInt32BE(offset + 8 + size));
    if (type === "IDAT") imageData.push(data);
    offset += size + 12;
  }
  assert.equal(offset, bytes.length);
  assert.deepEqual(inflateSync(Buffer.concat(imageData)), Buffer.from([0, 255, 0, 0, 255]));
  const large = Buffer.alloc(1024 * 1024, 255);
  assert.deepEqual(decodeImage(large.toString("base64"), large.length), large);
  assert.throws(() => decodeImage("Zh==", 100), /Noncanonical/);
});

async function fixture(t, options = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "customer-receiver-test-"));
  const file = path.join(dir, "receiver.sqlite");
  const db = new Database(file);
  const app = createImageReceiver({
    db, authenticate: req => req.get("X-Demo-Key") === "local-test-only" ? { id: "demo" } : null,
    authorizeProject: (_, id) => id === 1, ...options,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (db.open) db.close();
    await rm(dir, { recursive: true, force: true });
  });
  const send = async (body, extra = {}) => {
    const response = await fetch(`${url}/work-orders`, {
      method: "POST", headers: {
        "Content-Type": "application/json", "X-Demo-Key": "local-test-only",
        "Idempotency-Key": body.deliveryId, "X-MeterFlo-Delivery-Id": body.deliveryId, ...extra,
      }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };
  return { dir, file, db, url, send };
}

test("all categories, multiple before images and compatibility aliases decode byte-for-byte; retrieval is protected", async t => {
  const { db, url, send } = await fixture(t);
  const input = payload({ photos: [
    photo("before"), photo("before", "../../untrusted-name.png"),
    photo("after"), photo("trouble"), photo("signature"), photo("photo"),
  ], beforePhoto: PNG, afterPhoto: PNG, signature: PNG });
  const result = await send(input);
  assert.equal(result.status, 200);
  assert.equal(result.body.images.length, 6);
  const rows = db.prepare("SELECT * FROM images").all();
  assert.equal(rows.length, 6);
  for (const row of rows) {
    assert.deepEqual(row.bytes, Buffer.from(PNG, "base64"));
    assert.match(row.id, /^[a-f0-9-]{36}$/);
    assert.equal(row.delivery, input.deliveryId);
    assert.equal(row.wo, 42);
  }
  const imageUrl = url + result.body.images[0].url;
  assert.equal((await fetch(imageUrl)).status, 401);
  const image = await fetch(imageUrl, { headers: { "X-Demo-Key": "local-test-only" } });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(PNG, "base64"));
  const saved = JSON.parse(db.prepare("SELECT metadata FROM work_orders").get().metadata);
  assert.equal(saved.signatureName, "Demo signer");
  assert.equal(saved.photos, undefined);
  assert.equal(saved.signature, undefined);
});

test("concurrent retries, reopening durable storage and stale revisions do not duplicate or overwrite work", async t => {
  const { db, file, send } = await fixture(t);
  const input = payload({ photos: [photo("before")] });
  const results = await Promise.all(Array.from({ length: 8 }, () => send(input)));
  for (const result of results) assert.deepEqual(result, results[0]);
  assert.equal(db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
  const reopened = new Database(file);
  assert.equal(reopened.prepare("SELECT count(*) AS n FROM receipts").get().n, 1);
  reopened.close();
  const stale = await send(payload({
    updatedAt: "2026-10-10T20:00:00.000Z", photos: [photo("after")],
  }));
  assert.equal(stale.body.state, "ignored-stale");
  assert.equal(db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
  assert.equal(db.prepare("SELECT count(*) AS n FROM receipts").get().n, 2);
});

test("off versus enabled-empty and standalone signature; absent bytes do not delete prior images", async t => {
  const { db, send } = await fixture(t);
  assert.equal((await send(payload({ workOrderId: 1 }))).body.images.length, 0);
  assert.equal((await send(payload({ workOrderId: 2, photos: [] }))).body.images.length, 0);
  const sig = await send(payload({ workOrderId: 3, photos: [], signature: PNG }));
  assert.equal(sig.body.images[0].type, "signature");
  assert.equal(sig.body.images[0].contentType, "image/png");
  const newer = payload({ workOrderId: 3, updatedAt: "2026-10-12T00:00:00Z" });
  assert.equal((await send(newer)).status, 200);
  const refs = JSON.parse(db.prepare("SELECT refs FROM work_orders WHERE wo=3").get().refs);
  assert.equal(refs.length, 1);
});

test("invalid base64, mismatched MIME, unknown format and project/header errors never persist partial work", async t => {
  const { db, send } = await fixture(t);
  for (const image of [
    { ...photo("before"), data: "%%%=" },
    { ...photo("before"), data: `data:image/png;base64,${PNG}` },
    { ...photo("before"), contentType: "image/jpeg" },
    { ...photo("before"), data: Buffer.from("not an image").toString("base64") },
  ]) assert.equal((await send(payload({ photos: [photo("after"), image] }))).status, 422);
  assert.equal((await send(payload({ projectId: 2 }))).status, 403);
  assert.equal((await send(payload(), { "Idempotency-Key": randomUUID() })).status, 422);
  for (const table of ["images", "receipts", "work_orders"]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
});

test("per-image, aggregate, count and HTTP body limits return 413 without accepting a delivery", async t => {
  const small = await fixture(t, { maxImageBytes: 8 });
  assert.equal((await small.send(payload({ photos: [photo("before")] }))).status, 413);
  const aggregate = await fixture(t, { maxTotalBytes: Buffer.from(PNG, "base64").length });
  assert.equal((await aggregate.send(payload({ photos: [photo("before"), photo("after")] }))).status, 413);
  const count = await fixture(t, { maxImages: 1 });
  assert.equal((await count.send(payload({ photos: [photo("before"), photo("after")] }))).status, 413);
  const body = await fixture(t, { jsonLimit: "100b" });
  assert.equal((await body.send(payload({ photos: [photo("before")] }))).status, 413);
  for (const f of [small, aggregate, count, body]) {
    assert.equal(f.db.prepare("SELECT count(*) AS n FROM receipts").get().n, 0);
  }
});

test("a storage failure rolls back images, work-order update and receipt, and the same ID can recover", async t => {
  const { db, send } = await fixture(t);
  db.exec("CREATE TRIGGER simulate_failure BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'dummy storage failure'); END");
  const input = payload({ photos: [photo("before")] });
  const failure = await send(input);
  assert.equal(failure.status, 503);
  assert.equal(failure.body.error, "Storage unavailable; retry later");
  for (const table of ["images", "receipts", "work_orders"]) {
    assert.equal(db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
  }
  db.exec("DROP TRIGGER simulate_failure");
  assert.equal((await send(input)).status, 200);
  assert.equal(db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
});

test("MeterFlo collects supported files with categories and does not embed PDFs or symlinks", async t => {
  const { readDeliveryPhotos } = await import("../server/customerApiPayload.ts");
  const { dir } = await fixture(t);
  await mkdir(path.join(dir, "before"));
  await writeFile(path.join(dir, "before", "sample.PNG"), Buffer.from(PNG, "base64"));
  await writeFile(path.join(dir, "after-sample.png"), Buffer.from(PNG, "base64"));
  await writeFile(path.join(dir, "note.pdf"), "dummy PDF");
  await symlink(path.join(dir, "after-sample.png"), path.join(dir, "linked.png"));
  const photos = await readDeliveryPhotos(dir);
  assert.deepEqual(photos.map(p => p.type).sort(), ["after", "before"]);
  for (const p of photos) assert.equal(p.data, PNG);
});

test("the guide embeds the exact runnable receiver and links its image section from the admin guide", async () => {
  const guide = await readFile(new URL("../CUSTOMER_API_INTEGRATION.md", import.meta.url), "utf8");
  const source = await readFile(new URL("../examples/customer-image-receiver.mjs", import.meta.url), "utf8");
  assert.ok(guide.includes(`\`\`\`javascript\n${source.trimEnd()}\n\`\`\``));
  const admin = await readFile(new URL("../SYSTEM_ADMIN_GUIDE.md", import.meta.url), "utf8");
  assert.ok(admin.includes("/documentation?doc=customer-api#receiving-and-storing-field-images"));
});

test("the documented demo sender executes unchanged apart from the disposable receiver port", async t => {
  const { dir, url, db } = await fixture(t, {
    authenticate: req => req.get("X-Demo-Key") === "local-demo-only" ? { id: "demo" } : null,
  });
  const guide = await readFile(new URL("../CUSTOMER_API_INTEGRATION.md", import.meta.url), "utf8");
  const snippets = [...guide.matchAll(/```javascript\n([\s\S]*?)\n```/g)].map(match => match[1]);
  const sender = snippets.find(code => code.startsWith("// Save as send-demo.mjs"));
  assert.ok(sender);
  assert.ok(sender.includes(PNG), "Documentation must use the verified complete PNG");
  const file = path.join(dir, "send-demo.mjs");
  await writeFile(file, sender.replaceAll("http://127.0.0.1:5101", url));
  const result = await promisify(execFile)(process.execPath, [file], { timeout: 15000 });
  assert.match(result.stdout, /Decoded\/retrieved PNG matches original bytes/);
  assert.equal(db.prepare("SELECT count(*) AS n FROM images").get().n, 1);
  const launcher = await readFile(new URL("../examples/customer-image-receiver-demo.mjs", import.meta.url), "utf8");
  assert.ok(snippets.includes(launcher.trimEnd()), "The documented launcher must match the runnable file");
});
