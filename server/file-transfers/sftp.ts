import SftpClient from "ssh2-sftp-client";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { Writable } from "node:stream";
import { pool } from "../db";
import { sftpConnectionInput, type SftpPublic } from "../../shared/file-transfers";
export class TransferError extends Error { constructor(message: string, public status = 400) { super(message); } }
function encryptionKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new TransferError("Server credential encryption is not configured.", 503);
  return createHash("sha256").update(secret).update("meterflo-sftp-credentials").digest();
}
const credentialBinding = (project: number, host: string, port: number, user: string, fingerprint: string, auth: string) =>
  Buffer.from(JSON.stringify([project, host, port, user, fingerprint, auth]));
function seal(data: unknown, binding: Buffer) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(binding);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(value => value.toString("base64")).join(".");
}
function unseal(value: string, binding: Buffer) {
  try {
    const [iv, tag, bytes] = value.split(".").map(part => Buffer.from(part, "base64"));
    const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv); decipher.setAAD(binding); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(bytes), decipher.final()]).toString());
  } catch { throw new TransferError("Saved SFTP credentials are unavailable. Re-enter and save the credentials.", 409); }
}
export function remoteDirectory(value: string) {
  if (!value.startsWith("/") || value.includes("\0") || value.includes("\\") || value.split("/").includes(".."))
    throw new TransferError("Use an absolute SFTP directory without parent-path segments.");
  return path.posix.normalize(value);
}
export function publicConnection(row: any): SftpPublic | null {
  if (!row) return null;
  return { name: row.name, host: row.host, port: row.port, username: row.username, hostFingerprint: row.host_fingerprint,
    authType: row.auth_type, hasCredentials: !!row.encrypted_secret };
}
export async function getConnection(projectId: number) {
  return (await pool.query("SELECT * FROM public.project_sftp_connections WHERE project_id=$1", [projectId])).rows[0];
}
export function connectionIdentity(row: any) {
  if (!row) throw new TransferError("Configure the project's SFTP connection first.");
  return createHash("sha256").update(JSON.stringify([row.host, row.port, row.username, row.host_fingerprint])).digest("hex");
}
export async function saveConnection(projectId: number, body: unknown) {
  const input = sftpConnectionInput.parse(body), current = await getConnection(projectId);
  input.hostFingerprint = "SHA256:" + Buffer.from(input.hostFingerprint.slice(7), "base64").toString("base64").replace(/=+$/, "");
  const replacement = input.authType === "password" ? !!input.password : !!input.privateKey;
  if (!replacement && (!current || current.auth_type !== input.authType))
    throw new TransferError("Enter credentials for the selected authentication method.");
  if (!replacement && (current.host !== input.host || current.port !== input.port || current.username !== input.username ||
    current.host_fingerprint !== input.hostFingerprint)) throw new TransferError("Re-enter credentials when changing the SSH server, user or verified host key.");
  const binding = credentialBinding(projectId, input.host, input.port, input.username, input.hostFingerprint, input.authType);
  const secret = replacement ? seal(input.authType === "password" ? { password: input.password } :
    { privateKey: input.privateKey, passphrase: input.passphrase || undefined }, binding) : current.encrypted_secret;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query(`INSERT INTO public.project_sftp_connections(project_id,name,host,port,username,host_fingerprint,auth_type,encrypted_secret)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(project_id) DO UPDATE SET name=$2,host=$3,port=$4,username=$5,
    host_fingerprint=$6,auth_type=$7,encrypted_secret=$8,updated_at=now() RETURNING *`,
  [projectId, input.name, input.host, input.port, input.username, input.hostFingerprint, input.authType, secret])).rows[0];
    if (current && connectionIdentity(current) !== connectionIdentity(row)) {
      await client.query(`DELETE FROM public.file_export_checkpoints WHERE config_id IN
        (SELECT id FROM public.file_exports WHERE project_id=$1 AND destination='sftp')`, [projectId]);
      await client.query(`UPDATE public.file_export_runs SET status='cancelled',message='SFTP destination changed. Start a new export.'
        WHERE project_id=$1 AND snapshot->>'destination'='sftp' AND status IN ('queued','failed','interrupted')`, [projectId]);
    }
    await client.query("COMMIT"); return publicConnection(row);
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function withSftp<T>(projectId: number, fn: (client: SftpClient) => Promise<T>, identity?: string): Promise<T> {
  const row = await getConnection(projectId);
  if (!row) throw new TransferError("Configure the project's SFTP connection first.");
  if (identity && connectionIdentity(row) !== identity)
    throw new TransferError("The SFTP destination changed. Cancel this pending export and create a new run.", 409);
  const client = new SftpClient();
  let timer: NodeJS.Timeout | undefined;
  try {
    const expected = Buffer.from(row.host_fingerprint.slice(7), "base64").toString("hex");
    const operation = async () => {
      await client.connect({ host: row.host.replace(/^\[|\]$/g, ""), port: row.port, username: row.username,
      ...unseal(row.encrypted_secret, credentialBinding(projectId, row.host, row.port, row.username, row.host_fingerprint, row.auth_type)),
      hostHash: "sha256", hostVerifier: (hash: string) => {
        const actual = Buffer.from(hash), target = Buffer.from(expected);
        return actual.length === target.length && timingSafeEqual(actual, target);
      }, readyTimeout: 20000 });
      return fn(client);
    };
    return await Promise.race([operation(), new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { (client as unknown as { client: { destroy(): void } }).client.destroy();
        reject(new TransferError("SFTP operation timed out. Retry preserves the pending export identity.", 504)); }, 120000);
      timer.unref();
    })]);
  } catch (error) {
    if (error instanceof TransferError) throw error;
    throw new TransferError("SFTP operation failed. Check credentials, verified host key, directory permissions and connectivity.", 502);
  } finally { clearTimeout(timer); await client.end().catch(() => {}); }
}
export function digest(buffer: Buffer) { return createHash("sha256").update(buffer).digest("hex"); }
export async function readSftpFile(client: SftpClient, filename: string, limit: number) {
  const chunks: Buffer[] = []; let size = 0, exceeded = false;
  const sink = new Writable({ write(chunk, _encoding, done) {
    size += chunk.length;
    if (size > limit) { exceeded = true; return done(new Error("SFTP file size limit exceeded.")); }
    chunks.push(Buffer.from(chunk)); done();
  } });
  try { await client.get(filename, sink); }
  catch (error) { if (exceeded) throw new TransferError("The remote file exceeds the permitted size."); throw error; }
  return Buffer.concat(chunks);
}
export async function deliverSftp(projectId: number, directory: string, filename: string, id: string, bytes: Buffer, identity: string) {
  const folder = remoteDirectory(directory);
  return withSftp(projectId, async client => {
    const target = path.posix.join(folder, filename), partial = path.posix.join(folder, `.${filename}.${id}.part`);
    if (await client.exists(target)) {
      const stat = await client.stat(target);
      if (stat.size !== bytes.length || digest(await readSftpFile(client, target, bytes.length)) !== digest(bytes))
        throw new TransferError("A different file already exists at the export destination; it was not overwritten.", 409);
      return; // Retry after an acknowledgement was lost: same identity, same bytes.
    }
    try {
      await client.put(bytes, partial);
      if ((await client.stat(partial)).size !== bytes.length) throw new TransferError("SFTP upload size verification failed.", 502);
      await client.rename(partial, target); // Standard SFTP rename refuses an existing target.
    } finally { if (await client.exists(partial)) await client.delete(partial).catch(() => {}); }
  }, identity);
}
