import type { PoolClient } from "pg";
import { z } from "zod";

const completion = z.object({ id: z.string().uuid(), work_order_id: z.number().int().positive(),
  actor_id: z.string(), actor_label: z.string(), assignment_version: z.number().int().nonnegative(),
  fingerprint: z.string(), evidence: z.object({ schema: z.string(), prior: z.any(), next: z.object({ id: z.number().int() }).passthrough(), usage: z.any() }).passthrough(),
  status: z.enum(["pending", "failed", "succeeded", "not_required"]), attempts: z.number().int().nonnegative(),
  next_attempt_at: z.string(), created_at: z.string() }).passthrough();
export const changeoutBackupSchema = z.object({
  completions: z.array(completion),
  drafts: z.array(z.object({ submission_id: z.string().uuid(), work_order_id: z.number().int().positive(),
    user_id: z.string(), assignment_version: z.number().int(), revision: z.number().int().positive(), step: z.string(),
    capture: z.record(z.unknown()) }).passthrough()),
  installations: z.array(z.object({ item_id: z.string(), serial: z.string(), work_order_id: z.number().int(),
    completion_id: z.string().uuid(), active: z.boolean() }).passthrough()),
});
export type ChangeoutBackup = z.infer<typeof changeoutBackupSchema>;
export async function exportChangeouts(client: PoolClient, projectId: number): Promise<ChangeoutBackup> {
  const result: any = {};
  for (const [key, table] of [["completions", "changeout_completions"], ["drafts", "changeout_drafts"], ["installations", "changeout_installation_claims"]]) {
    const { rows } = await client.query(`SELECT row_to_json(t) AS value FROM public.${table} t WHERE project_id=$1`, [projectId]);
    result[key] = rows.map(r => r.value);
  }
  return result;
}
export function validateChangeouts(value: unknown, ids: Set<number>) {
  if (!value) return;
  const parsed = changeoutBackupSchema.parse(value);
  const completions = new Set(parsed.completions.map(c => c.id));
  for (const row of [...parsed.completions, ...parsed.drafts, ...parsed.installations])
    if (!ids.has(row.work_order_id)) throw new Error("Changeout recovery refers to a missing work order.");
  for (const row of parsed.completions)
    if (row.evidence.next.id !== row.work_order_id) throw new Error("Completion evidence belongs to another work order.");
  for (const row of parsed.installations)
    if (!completions.has(row.completion_id)) throw new Error("Installed serial has no accepted completion.");
}
export async function restoreChangeouts(client: PoolClient, projectId: number, schema: string, value?: ChangeoutBackup) {
  await client.query("DELETE FROM public.changeout_installation_claims WHERE project_id=$1", [projectId]);
  await client.query("DELETE FROM public.changeout_completions WHERE project_id=$1", [projectId]);
  await client.query("DELETE FROM public.changeout_drafts WHERE project_id=$1", [projectId]);
  if (!value) return;
  for (const [key, table] of [["completions", "changeout_completions"], ["drafts", "changeout_drafts"], ["installations", "changeout_installation_claims"]] as const) {
    for (const original of value[key]) {
      const row: any = { ...original, project_id: projectId };
      if (key === "completions") row.evidence = { ...row.evidence, schema };
      await client.query(`INSERT INTO public.${table} SELECT * FROM jsonb_populate_record(NULL::public.${table},$1)`, [JSON.stringify(row)]);
    }
  }
}
