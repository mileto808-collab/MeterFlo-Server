import { z } from "zod";
import { TransferError } from "./sftp";

export function sftpEventScope(projectId: number, query: any, timezone: string, global = false, before?: string) {
  const args: any[] = [projectId], terms = [global ? "(project_id=$1 OR project_id IS NULL)" : "project_id=$1"];
  const parameter = (value: unknown) => { args.push(value); return `$${args.length}`; };
  if (query.search) terms.push(`concat_ws(' ',username,action,status,file_name,message) ILIKE ${parameter("%" + z.string().max(200).parse(query.search) + "%")}`);
  for (const [key, op] of [["from", ">="], ["to", "<"]] as const) if (query[key]) {
    const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(query[key]), parsed = new Date(date);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new TransferError("Invalid filter date.");
    terms.push(`created_at ${op} ((${parameter(date)}::date${key === "to" ? "+1" : ""})::timestamp AT TIME ZONE ${parameter(timezone)})`);
  }
  if (query.from && query.to && query.from > query.to) throw new TransferError("From date must not follow To date.");
  if (before) terms.push(`created_at <= ${parameter(z.string().datetime().parse(before))}::timestamptz`);
  return { args, parameter, where: terms.join(" AND ") };
}
