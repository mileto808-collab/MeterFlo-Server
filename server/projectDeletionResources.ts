import path from "node:path";
import type { PoolClient } from "pg";
import { exchangeStore, type ExchangeRef } from "./file-transfers/https-storage";
import { assertPrivateApkDirectory } from "./mobileReleaseStorage";

export type ProjectObject = ExchangeRef & { provider: "app_storage"; key: string };
export type ProjectExchange = { local: string[]; objects: ProjectObject[] };
export type ExchangeCleanupStore = Pick<typeof exchangeStore, "remove" | "projectKeys">;

export async function projectExchangeResources(client: PoolClient, id: number, filesRoot: string,
  store: ExchangeCleanupStore = exchangeStore): Promise<ProjectExchange> {
  const { rows } = await client.query(`SELECT provider,location,storage_key FROM public.https_transfer_files WHERE project_id=$1
    UNION ALL SELECT provider,location,NULL FROM public.https_transfer_settings WHERE project_id=$1`, [id]);
  const local = new Set<string>(), objects = new Map<string, ProjectObject>(), refs = new Map<string, ExchangeRef>();
  const defaultRoot = path.resolve(filesRoot, "Secure File Exchange", String(id));
  for (const row of rows) {
    if (row.provider !== "local" && row.provider !== "app_storage") throw new Error("Unknown exchange storage; project deletion was cancelled.");
    if (row.provider === "local") {
      if (!path.isAbsolute(row.location)) throw new Error("Unsafe project exchange directory; deletion was cancelled.");
      assertPrivateApkDirectory(row.location);
      if (path.resolve(row.location) !== defaultRoot) local.add(path.resolve(row.location));
    } else {
      const ref = { provider: "app_storage" as const, location: row.location };
      refs.set(row.location, ref);
      if (row.storage_key) objects.set(`${row.location}:${row.storage_key}`, { ...ref, key: row.storage_key });
    }
  }
  // Enumerate before deleting metadata. Capture exact keys in the durable journal:
  // retries must never enumerate a restored/new project reusing the numeric ID.
  for (const ref of refs.values())
    for (const key of await store.projectKeys(ref, id)) objects.set(`${ref.location}:${key}`, { ...ref, provider: "app_storage", key });
  const captured = [...objects.values()];
  if (!validateProjectObjects(captured, id)) throw new Error("Unsafe project exchange keys; deletion was cancelled.");
  return { local: [...local], objects: captured };
}

export function exchangeFolder(id: number) { return `meterflo-exchange/${id}`; }
export function validateProjectObjects(objects: ProjectObject[], id: number) {
  return Array.isArray(objects) && objects.length <= 50000 && objects.every(object =>
    object?.provider === "app_storage" && typeof object.location === "string" && object.location.length <= 1000 &&
    new RegExp(`^meterflo-exchange/${id}/[a-f0-9-]{36}\\.bin$`).test(object.key));
}

/** Remove only this project's evidence; append-only protection stays enabled elsewhere. */
export async function purgeProjectAudit(client: PoolClient, id: number) {
  await client.query("SELECT set_config('meterflo.audit_retention','authorized',true)");
  await client.query(`DELETE FROM meterflo_audit.events WHERE project_id=$1 OR
    (entity_type='system_settings' AND starts_with(entity_id,'project_deletion_'||$1::text||'-'))`, [id]);
  await client.query("DELETE FROM meterflo_audit.operations WHERE project_id=$1", [id]);
  await client.query("DELETE FROM meterflo_audit.entity_scopes WHERE project_id=$1", [id]);
  await client.query("DELETE FROM meterflo_audit.project_scopes WHERE project_id=$1", [id]);
  await client.query("SELECT set_config('meterflo.audit_retention','',true)");
}
