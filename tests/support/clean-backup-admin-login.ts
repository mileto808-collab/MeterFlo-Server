import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD } from "../../server/bootstrapAdmin";

export async function verifyCleanAdminLogin(databaseUrl: string, oldPassword: string) {
  assert.ok(process.env.WORKSPACE_UI_SANDBOX_CONFIG, "Owned database sandbox required.");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meterflo-clean-login-"));
  const port = await new Promise<number>((resolve, reject) => {
    const server = net.createServer().once("error", reject).listen(0, "127.0.0.1", () => {
      const number = (server.address() as net.AddressInfo).port;
      server.close(() => resolve(number));
    });
  });
  const child = spawn(process.execPath, [path.resolve("dist/index.cjs")], { cwd: root,
    env: { ...process.env, DATABASE_URL: databaseUrl, HOST: "127.0.0.1", PORT: String(port),
      COOKIE_SECURE: "false", SESSION_SECRET: randomUUID() + randomUUID(), NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"] });
  const output: Buffer[] = [];
  child.stdout.on("data", data => output.push(data));
  child.stderr.on("data", data => output.push(data));
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt++) {
      if (child.exitCode !== null) throw new Error("Restored app exited before becoming ready; see clean-admin-login.log.");
      try { if ((await fetch(base + "/api/auth/user")).status === 401) { ready = true; break; } } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    assert.ok(ready, "Restored app must start");
    const login = (password: string) => fetch(base + "/api/auth/local/login", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: BOOTSTRAP_ADMIN_USERNAME, password }),
    });
    assert.equal((await login(oldPassword)).status, 401, "Source password must not authenticate");
    const response = await login(BOOTSTRAP_ADMIN_PASSWORD);
    assert.equal(response.status, 200, "Installation default must authenticate after clean restore");
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    assert.ok(cookie);
    assert.equal((await fetch(base + "/api/users", { headers: { Cookie: cookie } })).status, 200, "Restored administrator must have actual administrative access");
  } finally {
    if (child.exitCode === null) {
      const stopped = once(child, "exit"), timer = setTimeout(() => child.kill("SIGKILL"), 10000);
      timer.unref(); child.kill("SIGTERM"); await stopped; clearTimeout(timer);
    }
    await fs.mkdir("generated-artifacts/project-deletion", { recursive: true });
    await fs.writeFile("generated-artifacts/project-deletion/clean-admin-login.log", Buffer.concat(output));
    await fs.rm(root, { recursive: true, force: true });
  }
}
