import { randomBytes, randomUUID, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { isIP } from "node:net";
import ssh2 from "ssh2";
const { utils } = ssh2;
import { z } from "zod";
import { pool } from "../db";
import { TransferError } from "./sftp";
const scrypt = promisify(derive);
export const standaloneSftpSupported = () => !process.env.REPL_ID && process.env.REPLIT_DEPLOYMENT !== "1";
export const serverInput = z.object({
  enabled: z.boolean(), host: z.string().refine(v => isIP(v) !== 0, "Bind address must be an IPv4 or IPv6 address."),
  port: z.number().int().min(1).max(65535),
  publicHost: z.string().trim().max(253).refine(v => !v || isIP(v) !== 0 || /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(v),
    "Enter a hostname or IP address, without a URL, path, or port."),
}).refine(v => !v.enabled || !!v.publicHost, "Set the customer-facing hostname before enabling SFTP.")
  .refine(v => !v.enabled || v.port !== Number(process.env.PORT || 5000), "SFTP must use a different port than the MeterFlo web server.");
export const accountInput = z.object({
  username: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/), label: z.string().trim().min(1).max(120),
  authType: z.enum(["publicKey", "password"]), publicKey: z.string().trim().max(16384).optional(),
  password: z.string().min(16).max(256).optional(), canUpload: z.boolean(), canDownload: z.boolean(),
  expiresAt: z.string().datetime(),
}).refine(v => v.canUpload || v.canDownload, "Select upload and/or download access.")
  .refine(v => Date.parse(v.expiresAt) > Date.now() && Date.parse(v.expiresAt) <= Date.now() + 365 * 86400000,
    "Expiry must be in the future and within 365 days.")
  .refine(v => v.authType === "password" ? !!v.password : !!v.publicKey, "Supply credentials for the selected authentication method.");
export async function hashSftpPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${hash.toString("hex")}`;
}
export async function verifySftpPassword(password: string, saved: string) {
  if (typeof password !== "string" || password.length > 256 || !/^[a-f0-9]{32}:[a-f0-9]{128}$/.test(saved)) return false;
  const [salt, hash] = saved.split(":");
  const actual = await scrypt(password, salt, 64) as Buffer, expected = Buffer.from(hash, "hex");
  return timingSafeEqual(actual, expected);
}
export async function sftpSettings() {
  const row = (await pool.query("SELECT * FROM public.sftp_server_settings WHERE id=1")).rows[0];
  return { enabled: row?.enabled ?? false, host: row?.host ?? "0.0.0.0", port: row?.port ?? 2222, publicHost: row?.public_host ?? "" };
}
export function accountDto(row: any) {
  return { id: row.id, username: row.username, label: row.label, authType: row.auth_type, canUpload: row.can_upload, canDownload: row.can_download,
    expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at };
}
export async function sftpEvent(projectId: number | null, username: string, action: string, status: string,
  message: string, fileName?: string, bytes = 0) {
  await pool.query(`INSERT INTO public.sftp_server_events(id,project_id,username,action,status,message,file_name,bytes)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [randomUUID(), projectId, username, action, status, message, fileName || null, bytes]);
}
export async function createSftpAccount(projectId: number, body: unknown) {
  const input = accountInput.parse(body);
  let publicKey: string | null = null, hash: string | null = null;
  if (input.authType === "publicKey") {
    const parsed = utils.parseKey(input.publicKey!);
    if (parsed instanceof Error)
      throw new TransferError(`Invalid OpenSSH public key: ${parsed.message}`);
    if (Array.isArray(parsed) || parsed.isPrivateKey())
      throw new TransferError("Enter one OpenSSH public key, never a private key.");
    if (!["ssh-ed25519", "ssh-rsa", "ecdsa-sha2-nistp256", "ecdsa-sha2-nistp384", "ecdsa-sha2-nistp521"].includes(parsed.type))
      throw new TransferError("Use an Ed25519, RSA, or ECDSA public key.");
    publicKey = `${parsed.type} ${parsed.getPublicSSH().toString("base64")}`;
  } else hash = await hashSftpPassword(input.password!);
  try {
    const { rows: [row] } = await pool.query(`INSERT INTO public.sftp_server_accounts
      (id,project_id,username,label,auth_type,public_key,password_hash,can_upload,can_download,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [randomUUID(), projectId, input.username, input.label, input.authType, publicKey, hash, input.canUpload, input.canDownload, input.expiresAt]);
    await sftpEvent(projectId, input.username, "account_created", "success", "Project transfer account created.");
    return accountDto(row);
  } catch (error: any) {
    if (error.code === "23505") throw new TransferError("That SFTP username is already used. Choose a unique project-specific username.", 409);
    throw error;
  }
}
/** Rechecked for every request, not only at login: project deletion/lock/revocation take effect immediately. */
export async function activeSftpAccount(id: string) {
  const row = (await pool.query(`SELECT a.*,p.name AS project_name FROM public.sftp_server_accounts a
    JOIN public.projects p ON p.id=a.project_id
    WHERE a.id=$1 AND a.revoked_at IS NULL AND a.expires_at>now() AND p.is_active=true
    AND EXISTS(SELECT 1 FROM public.sftp_server_settings WHERE id=1 AND enabled=true)
    AND NOT EXISTS(SELECT 1 FROM public.access_locks WHERE locked=true AND (project_id IS NULL OR project_id=a.project_id))`, [id])).rows[0];
  if (!row) throw new TransferError("Transfer account or project is unavailable.", 403);
  return row;
}
