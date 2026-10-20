import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import nodemailer from "nodemailer";
import { createSupportRequestHandler, supportAttachments } from "../server/supportRequests";
import { validateSupportAttachments } from "../shared/support-request";
import { pool } from "../server/db";

test("support email: verified account/projects, real MIME attachments, validation and failure handling", async () => {
  const user = { id: "verified-account-id", username: "verified-tech", email: "account@example.test",
    firstName: "Verified", lastName: "Technician", role: "user" };
  let projects = [{ id: 11, name: "Assigned project <one>" }, { id: 22, name: "Assigned project two" }];
  const saved: any[] = [], delivery: any[] = [], mail: any[] = [], raw: string[] = [];
  let fail = false, missingConfiguration = false;
  const settings: Record<string, string> = {
    support_form_email: "support@example.test", smtp_host: "test.invalid", smtp_port: "25",
    smtp_user: "sender@example.test", smtp_from_email: "sender@example.test", smtp_secure: "false",
  };
  const store = {
    getUser: async (id: string) => id === user.id ? user : undefined,
    getUserProjects: async () => projects,
    getProject: async (id: number) => projects.find(p => p.id === id),
    getSetting: async (key: string) => missingConfiguration ? null : settings[key] || null,
    createSupportSubmission: async (data: any) => { const item = { ...data, id: saved.length + 1 }; saved.push(item); return item; },
    updateSupportSubmissionDelivery: async (...args: any[]) => { delivery.push(args); },
  };
  const stream = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  const app = express();
  app.use(express.json());
  app.post("/api/support", (req: any, res, next) => {
    if (req.headers["x-test-account"] !== user.id) return void res.sendStatus(401);
    req.user = { claims: { sub: user.id } }; next();
  }, supportAttachments, createSupportRequestHandler({
    store: store as any, password: () => "test-only",
    transport: (() => ({ sendMail: async (options: any) => {
      assert.ok(saved.length, "Submission is recorded before email sending");
      if (fail) throw new Error("Internal transport detail must not be exposed");
      mail.push(options);
      raw.push((await stream.sendMail(options)).message.toString());
      return { accepted: ["support@example.test"], rejected: [] };
    } })) as any,
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const url = `http://127.0.0.1:${address.port}/api/support`;
  const fields = { name: "Different contact", email: "reply@example.test", subject: "Support attachment test",
    priority: "medium", message: "Message with <script>never execute</script>." };
  const post = async (data: any, authenticated = true) => fetch(url, { method: "POST",
    headers: { ...(authenticated ? { "x-test-account": user.id } : {}),
      ...(data instanceof FormData ? {} : { "Content-Type": "application/json" }) },
    body: data instanceof FormData ? data : JSON.stringify(data) });
  const multipart = (files: Array<{ name: string; content: string | Buffer }>, extras: Record<string, string> = {}) => {
    const form = new FormData();
    Object.entries({ ...fields, ...extras }).forEach(([key, value]) => form.append(key, value));
    files.forEach(file => form.append("attachments", new Blob([file.content]), file.name));
    return form;
  };
  try {
    assert.equal((await post(multipart([{ name: "diagnostic.log", content: "test log" }]), false)).status, 401);
    const bytes = "Attachment content must survive delivery.\n";
    let response = await post(multipart([{ name: "diagnostic.log", content: bytes }],
      { projectId: "11", userId: "spoofed-account", emailSent: "true" }));
    assert.equal(response.status, 200, await response.text());
    assert.equal(saved[0].userId, user.id);
    assert.equal(saved[0].emailSent, false);
    assert.deepEqual(delivery[0], [1, true, null]);
    assert.equal(mail[0].replyTo, fields.email);
    for (const expected of [user.id, user.username, user.email, fields.email, "Assigned project <one> (#11)", "Assigned project two (#22)"])
      assert.ok(mail[0].text.includes(expected), expected);
    assert.ok(mail[0].text.includes("Current project: Assigned project <one> (#11)"));
    assert.ok(mail[0].html.includes("Assigned project &lt;one&gt;"));
    assert.ok(!mail[0].html.includes("<script>"));
    assert.ok(mail[0].html.includes("&lt;script&gt;"));
    assert.equal(mail[0].attachments[0].content.toString(), bytes);
    assert.equal(mail[0].attachments[0].contentType, "text/plain");
    assert.ok(raw[0].includes('filename=diagnostic.log') || raw[0].includes('filename="diagnostic.log"'));
    assert.ok(raw[0].includes(Buffer.from(bytes).toString("base64")), "MIME carries the full attachment bytes");

    assert.equal((await post({ ...fields, projectId: 999 })).status, 403);
    assert.equal(saved.length, 1);
    assert.equal((await post({ ...fields, projectId: "not-an-id" })).status, 400);
    assert.equal((await post(multipart([{ name: "program.exe", content: "blocked" }]))).status, 400);
    assert.equal((await post(multipart([{ name: "too-big.log", content: Buffer.alloc(5 * 1024 * 1024 + 1) }]))).status, 413);
    assert.equal((await post(multipart(Array.from({ length: 6 }, (_, i) => ({ name: `file-${i}.txt`, content: "log" }))))).status, 413);
    assert.equal((await post(multipart(Array.from({ length: 4 }, (_, i) => ({ name: `total-${i}.txt`, content: Buffer.alloc(4 * 1024 * 1024) }))))).status, 413);
    assert.equal(saved.length, 1, "Invalid uploads never create or send requests");
    projects = [];
    response = await post(fields);
    assert.equal(response.status, 200);
    assert.ok(mail[1].text.includes("No assigned projects"));
    assert.equal(mail[1].attachments.length, 0);
    fail = true;
    response = await post(multipart([{ name: "retry.log", content: "keep selected file" }]));
    assert.equal(response.status, 502);
    const failure = await response.json() as any;
    assert.equal(failure.emailSent, false);
    assert.ok(failure.message.includes("saved"));
    assert.ok(!failure.message.includes("Internal transport detail"));
    assert.deepEqual(delivery.at(-1), [3, false, "SMTP delivery failed."]);
    missingConfiguration = true; fail = false;
    assert.equal((await post(fields)).status, 502);
    assert.deepEqual(delivery.at(-1), [4, false, "Support email or SMTP is not configured."]);
    assert.ok(validateSupportAttachments([{ name: "test.log", size: 6 * 1024 * 1024 }]));
    assert.equal(validateSupportAttachments([{ name: "valid.LOG", size: 1024 }]), null);
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    stream.close();
    await pool.end();
  }
});
