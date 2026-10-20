import { z } from "zod";
import { pool } from "../db";
import { projectZone } from "./exports";
import { filePublic } from "./https-service";
import { TransferError } from "./sftp";
import * as XLSX from "xlsx";
export async function exchangeRecords(projectId: number, query: any, options: {
  events?: boolean; all?: boolean; directions?: string[]; credentialId?: string;
} = {}) {
  const timezone = await projectZone(projectId), args: any[] = [projectId], clauses = ["f.project_id=$1"];
  const parameter = (value: any) => { args.push(value); return `$${args.length}`; };
  if (options.events && options.directions) clauses.push(`(f.file_id IS NULL OR x.direction=ANY(${parameter(options.directions)}::text[]))`);
  if (query.search) clauses.push(`concat_ws(' ',f.${options.events ? "action" : "status"},f.message,c.name,x.file_name) ILIKE ${parameter("%" + z.string().max(200).parse(query.search) + "%")}`);
  if (!options.events) {
    const direction = z.enum(["all", "inbox", "outbox"]).parse(query.direction || "all");
    clauses.push(`f.direction=ANY(${parameter(options.directions || ["inbox", "outbox"])}::text[])`);
    if (direction !== "all") clauses.push(`f.direction=${parameter(direction)}`);
    if (query.status) clauses.push(`f.status=${parameter(z.string().regex(/^[a-z_]{1,30}$/).parse(query.status))}`);
    if (options.credentialId) clauses.push(`(f.direction='outbox' OR f.credential_id=${parameter(options.credentialId)}::uuid)`);
  }
  for (const [key, operator] of [["from", ">="], ["to", "<"]] as const) if (query[key]) {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query[key]), parsed = new Date(date);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new TransferError("Invalid filter date.");
    clauses.push(`f.created_at ${operator} ((${parameter(date)}::date${key === "to" ? "+1" : ""})::timestamp AT TIME ZONE ${parameter(timezone)})`);
  }
  if (query.from && query.to && query.from > query.to) throw new TransferError("From date must not follow To date.");
  const from = options.events ? `public.https_transfer_events f LEFT JOIN public.https_transfer_files x ON x.id=f.file_id
    LEFT JOIN public.https_transfer_credentials c ON c.id=f.credential_id` :
    `public.https_transfer_files f LEFT JOIN public.https_transfer_credentials c ON c.id=f.credential_id
    LEFT JOIN public.https_transfer_files x ON x.id=f.id`;
  const where = " WHERE " + clauses.join(" AND ");
  const total = Number((await pool.query("SELECT count(*) FROM " + from + where, args)).rows[0].count);
  if (options.all && total > 25000) throw new TransferError("More than 25,000 entries match. Narrow the filters.");
  const limit = options.all ? 25000 : z.coerce.number().int().min(1).max(100).parse(query.limit || 25);
  const offset = options.all ? 0 : z.coerce.number().int().min(0).parse(query.offset || 0);
  const rows = (await pool.query(`SELECT f.*,c.name AS credential_name,x.file_name AS event_file_name FROM ${from}${where}
    ORDER BY f.created_at DESC,f.id LIMIT ${parameter(limit)} OFFSET ${parameter(offset)}`, args)).rows;
  return { total, timezone, rows: rows.map(row => options.events ? { id: row.id, action: row.action, message: row.message,
    fileName: row.event_file_name, credentialName: row.credential_name, createdAt: row.created_at } : filePublic(row)) };
}
const escape = (v: any) => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export function exchangeReport(page: Awaited<ReturnType<typeof exchangeRecords>>, events: boolean, csv: boolean, excel = false) {
  const format = (value: any) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "long", timeZone: page.timezone }).format(new Date(value)) : "";
  const headers = events ? ["Date", "Action", "File", "Credential", "Message"] :
    ["Date", "Direction", "File", "Status", "Bytes", "SHA256", "Credential", "Processed", "Acknowledged", "Message"];
  const rows = page.rows.map((r: any) => events ? [format(r.createdAt), r.action, r.fileName, r.credentialName, r.message] :
    [format(r.createdAt), r.direction, r.fileName, r.status, r.size, r.sha256, r.credentialName, format(r.processedAt), format(r.acknowledgedAt), r.message]);
  if (excel) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), events ? "Activity" : "Files");
    return XLSX.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }
  if (csv) return [headers, ...rows].map(row => row.map(v => {
    const text = String(v ?? ""); return '"' + (/^[=+\-@\t\r]/.test(text) ? "'" + text : text).replace(/"/g, '""') + '"';
  }).join(",")).join("\r\n");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>HTTPS file exchange</title><style>
    body{font:13px Arial,sans-serif;margin:24px}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ccc;padding:6px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}
    @media print{button{display:none}body{margin:0}tr{break-inside:avoid}}@page{size:landscape;margin:12mm}</style></head><body>
    <button onclick="window.print()">Print / Save PDF</button><h1>HTTPS exchange ${events ? "history" : "files"}</h1>
    <p>${page.total} matching entries · Timezone: ${escape(page.timezone)}</p><table><thead><tr>${headers.map(h => "<th>" + h + "</th>").join("")}</tr></thead>
    <tbody>${rows.map(row => "<tr>" + row.map(v => "<td>" + escape(v) + "</td>").join("") + "</tr>").join("")}</tbody></table></body></html>`;
}
