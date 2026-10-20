import ssh2, { type Server as SshServer, type Connection, type AuthContext } from "ssh2";
const { Server, utils } = ssh2;
import { createHash, timingSafeEqual } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../db";
import { serveSftpFiles } from "./embedded-files";
import { activeSftpAccount, sftpEvent, sftpSettings, standaloneSftpSupported, verifySftpPassword } from "./embedded-service";
import { TransferError } from "./sftp";
let listener: SshServer | null = null, fingerprint: string | null = null, lastError: string | null = null;
const connections = new Map<Connection, { accountId?: string; peer: string }>();
const failures = new Map<string, { count: number; until: number }>();
let control = Promise.resolve();
function disconnect(client: Connection) {
  client.end();
  // ssh2's server Connection exposes end(), not destroy(). Close its owned transport too,
  // so an uncooperative peer cannot hold listener shutdown or credential revocation open.
  (client as Connection & { _sock: import("node:net").Socket })._sock.destroy();
}
export const sftpRuntime = () => ({ running: !!listener?.address(), fingerprint, error: lastError });
export function disconnectSftpAccount(id: string) {
  for (const [connection, session] of connections) if (session.accountId === id) disconnect(connection);
}
export async function stopEmbeddedSftp() {
  const old = listener; listener = null;
  for (const client of connections.keys()) disconnect(client);
  connections.clear();
  if (old?.address()) await new Promise<void>(resolve => old.close(() => resolve()));
}
async function hostKey() {
  const directory = path.resolve(".meterflo-sftp");
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const actual = await fs.realpath(directory);
  const normalize = (value: string) => process.platform === "win32" ? path.normalize(value).toLowerCase() : value;
  if (normalize(actual) !== normalize(directory)) throw new Error("Host-key directory cannot be a symlink.");
  const filename = path.join(directory, "host_ed25519");
  try {
    const info = await fs.lstat(filename);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Host key must be a regular private file.");
    if (process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Restrict host-key file permissions to the service account.");
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
    const pair = utils.generateKeyPairSync("ed25519");
    // Never replace a host key. A restored DB on a different host must not silently change an existing key.
    try { await fs.writeFile(filename, pair.private, { flag: "wx", mode: 0o600 }); }
    catch (write: any) { if (write.code !== "EEXIST") throw write; }
  }
  const bytes = await fs.readFile(filename), parsed = utils.parseKey(bytes);
  if (parsed instanceof Error || Array.isArray(parsed) || !parsed.isPrivateKey()) throw new Error("Host key is invalid; restore the original key.");
  fingerprint = "SHA256:" + createHash("sha256").update(parsed.getPublicSSH()).digest("base64").replace(/=+$/, "");
  return bytes;
}
function failedPeer(peer: string) {
  const now = Date.now();
  for (const [key, value] of failures) if (value.until < now) failures.delete(key);
  if (!failures.has(peer) && failures.size >= 4096) return; // Bound memory under address churn.
  const failure = failures.get(peer) || { count: 0, until: now + 15 * 60000 };
  failure.count++; failures.set(peer, failure);
}
function acceptClient(client: Connection, info: { ip: string }) {
  const peer = info.ip;
  if (connections.size >= 64 || [...connections.values()].filter(v => v.peer === peer).length >= 4 ||
    (failures.get(peer)?.count || 0) >= 20 && (failures.get(peer)?.until || 0) > Date.now()) {
    disconnect(client); return;
  }
  const session: { accountId?: string; peer: string } = { peer };
  connections.set(client, session);
  const idle = setTimeout(() => disconnect(client), 120000); idle.unref();
  const authenticationDeadline = setTimeout(() => disconnect(client), 20000); authenticationDeadline.unref();
  let authBusy = false, attempts = 0, channels = 0;
  const reject = (ctx: AuthContext) => { failedPeer(peer); ctx.reject(["publickey", "password"]); if (++attempts >= 6) client.end(); };
  client.on("authentication", ctx => {
    idle.refresh();
    // OpenSSH first asks which methods are available. That is discovery, not a failed login.
    if (ctx.method === "none") { ctx.reject(["publickey", "password"]); return; }
    if (authBusy || !/^[A-Za-z0-9_-]{3,64}$/.test(ctx.username)) return reject(ctx);
    authBusy = true;
    void (async () => {
      const candidate = (await pool.query("SELECT id FROM public.sftp_server_accounts WHERE username=$1", [ctx.username])).rows[0];
      const account = candidate ? await activeSftpAccount(candidate.id).catch(() => null) : null;
      let valid = false;
      if (ctx.method === "password") {
        // Use equal-cost password derivation for unknown users; never log password/SSH packet objects.
        const dummy = "0".repeat(32) + ":" + "0".repeat(128);
        valid = await verifySftpPassword(ctx.password, account?.auth_type === "password" ? account.password_hash : dummy);
        valid = valid && !!account && account.auth_type === "password";
      } else if (ctx.method === "publickey" && account?.auth_type === "publicKey") {
        const key = utils.parseKey(account.public_key);
        if (!(key instanceof Error) && !Array.isArray(key)) {
          const expected = key.getPublicSSH();
          valid = expected.length === ctx.key.data.length && timingSafeEqual(expected, ctx.key.data);
          if (valid && ctx.signature) valid = !!ctx.blob && key.verify(ctx.blob, ctx.signature, ctx.hashAlgo);
        }
      }
      if (!valid || !account) {
        await sftpEvent(account?.project_id || null, ctx.username, "authentication", "failed", "SFTP authentication rejected.");
        return reject(ctx);
      }
      // Unsigned public-key probes merely acknowledge that the key is eligible; ssh2 requests its signature.
      if (ctx.method === "publickey" && !ctx.signature) { ctx.accept(); return; }
      session.accountId = account.id;
      await sftpEvent(account.project_id, account.username, "authentication", "success", "SFTP-only project session authenticated.");
      ctx.accept();
    })().catch(() => reject(ctx)).finally(() => { authBusy = false; });
  });
  client.on("ready", () => {
    clearTimeout(authenticationDeadline);
    idle.refresh();
    client.on("session", (accept, rejectSession) => {
      if (!session.accountId || channels >= 1) return rejectSession();
      channels++;
      const channel = accept();
      channel.on("sftp", (acceptSftp) => {
        const stream = acceptSftp();
        // Protocol requests, including directory/status requests, refresh the idle deadline.
        for (const event of ["OPEN", "READ", "WRITE", "CLOSE", "OPENDIR", "READDIR", "STAT", "REALPATH"])
          stream.on(event as any, () => idle.refresh());
        serveSftpFiles(stream, session.accountId!);
      });
      channel.on("shell", (_accept, rejectShell) => rejectShell());
      channel.on("exec", (_accept, rejectExec) => rejectExec());
      channel.on("pty", (_accept, rejectPty) => rejectPty());
      channel.on("env", (_accept, rejectEnv) => rejectEnv());
      channel.on("subsystem", (_accept, rejectSubsystem) => rejectSubsystem());
      channel.on("close", () => { channels--; });
    });
    client.on("tcpip", (_accept, rejectForward) => rejectForward());
    client.on("request", (_accept, rejectForward) => rejectForward?.());
  });
  client.on("error", () => {}); // Never log SSH errors: they may include protocol/authentication material.
  client.on("close", () => { clearTimeout(idle); clearTimeout(authenticationDeadline); connections.delete(client); });
}
export async function restartEmbeddedSftp() {
  const run = control.then(async () => {
    await stopEmbeddedSftp(); lastError = null;
    if (!standaloneSftpSupported()) return sftpRuntime();
    const settings = await sftpSettings();
    if (!settings.enabled) return sftpRuntime();
    try {
      const key = await hostKey();
      const server = new Server({ hostKeys: [key], ident: "MeterFlo_SFTP", greeting: "MeterFlo project file exchange. SFTP only.",
        keepaliveInterval: 15000, keepaliveCountMax: 3 }, acceptClient);
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(settings.port, settings.host, () => { server.off("error", reject); resolve(); });
      });
      listener = server;
      server.on("error", () => { lastError = "SFTP listener failed. Check the bind address, port availability, host-key permissions, and service account."; void stopEmbeddedSftp(); });
      await sftpEvent(null, "server", "server_started", "success", "Standalone SFTP listener started.");
    } catch {
      await stopEmbeddedSftp();
      lastError = "SFTP could not start. Check the bind address, port availability, .meterflo-sftp host key, and service-account permissions.";
      await sftpEvent(null, "server", "server_start", "failed", lastError).catch(() => {});
      throw new TransferError(lastError, 503);
    }
    return sftpRuntime();
  });
  control = run.then(() => {}, () => {});
  return run;
}
export async function initializeEmbeddedSftp() {
  if (!standaloneSftpSupported()) return;
  await restartEmbeddedSftp().catch(() => console.error("Optional SFTP listener failed to start. Review SFTP Server settings; HTTPS and the application remain available."));
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
    // Registering a handler disables Node's default exit; do not leave the HTTP server alive on stop.
    const deadline = setTimeout(() => process.exit(1), 5000); deadline.unref();
    void stopEmbeddedSftp().finally(() => process.exit(0));
  });
}
