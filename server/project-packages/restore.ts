import fs from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { pool } from "../db";
import { auditedOperation } from "../auditService";
import { withBackupExclusive } from "../backups/lock";
import { openProjectPackage, packageRows, type Manifest } from "./archive";
import { catalog, ordered, quote, relation, tableKey, writable, sanitize, privateField, type Table } from "./catalog";
import { restoreFiles } from "./files";

const configuration = new Set(["project_holidays", "project_service_types", "system_type_projects", "module_type_projects", "work_order_closing_policy"]);
const ignored = new Set(["access_locks"]); // Destination authorization is never taken from an uploaded archive.
const forbidden = /^(sessions|system_settings|subroles|permissions|subrole_permissions|mobile_apk_|backup_|instance_)/;
const marker = "project_package_restores";
const scalar = (value: any) => JSON.stringify(value);
type Mappings = Map<string, Map<string, Map<string, any>>>;
function remember(maps: Mappings, key: string, original: any, mapped: any, columns: string[]) {
  let table = maps.get(key); if (!table) maps.set(key, table = new Map());
  for (const column of columns) {
    if (original[column] == null) continue;
    let values = table.get(column); if (!values) table.set(column, values = new Map());
    values.set(scalar(original[column]), mapped[column]);
  }
}
function get(maps: Mappings, key: string, column: string, value: any) {
  return maps.get(key)?.get(column)?.get(scalar(value)) ?? value;
}
const groupFor = (schema: string) => schema === "public" ? "public" : schema === "meterflo_audit" ? "history" : "work";
async function* batches<T>(input: AsyncIterable<T>, size = 500) {
  let batch: T[] = [];
  for await (const value of input) { batch.push(value); if (batch.length >= size) { yield batch; batch = []; } }
  if (batch.length) yield batch;
}

export async function restoreProjectPackage(zip: string, projectId: number) {
  const opened = await openProjectPackage(zip);
  try {
    return await withBackupExclusive(() => auditedOperation("projectPackageRestore", "projects", async () => {
      const { directory, manifest } = opened;
      const client = await pool.connect(), maps: Mappings = new Map(), reuse = new Map<string, Set<string>>();
      let copied: Awaited<ReturnType<typeof restoreFiles>> | undefined, committed = false, commitAttempted = false;
      let target: any;
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(195378,$1)", [projectId]);
        target = (await client.query("SELECT * FROM public.projects WHERE id=$1 FOR UPDATE", [projectId])).rows[0];
        if (!target?.database_name || !/^project_[a-z0-9_]+$/.test(target.database_name)) throw new Error("Destination project database was not found.");
        const actual = await catalog(client, ["public", target.database_name]);
        const destination = (table: Table) => relation(table.schema === "public" ? "public" : target.database_name, table.name);
        for (const table of actual) {
          if (table.schema === target.database_name) {
            await client.query(`LOCK TABLE ${relation(table.schema, table.name)} IN ACCESS EXCLUSIVE MODE`);
            if ((await client.query(`SELECT 1 FROM ${relation(table.schema, table.name)} LIMIT 1`)).rowCount)
              throw new Error("A complete ZIP can only restore into an empty project. Existing work orders or prior project restores were found.");
          } else if (table.columns.some(column => column.name === "project_id") && !configuration.has(table.name) &&
            !["user_projects", "user_column_preferences", "user_filter_preferences"].includes(table.name)) {
            if ((await client.query(`SELECT 1 FROM ${relation("public", table.name)} WHERE project_id=$1 LIMIT 1`, [projectId])).rowCount)
              throw new Error("Destination project already has inventory, logs, schedules or other records. Create an empty project with Inventory disabled.");
          }
        }
        const normalized = actual.map(table => ({ ...table,
          schema: table.schema === target.database_name ? manifest.project.databaseName : table.schema,
          foreign: table.foreign.map(key => ({ ...key, schema: key.schema === target.database_name ? manifest.project.databaseName : key.schema })) }));
        const lookup = new Map(normalized.map(table => [tableKey(table), table]));
        const selected: Table[] = [];
        const descriptorKeys = new Set<string>();
        for (const source of manifest.snapshot.tables) {
          const key = tableKey(source), count = manifest.snapshot.counts[key];
          if (!["public", "meterflo_audit", manifest.project.databaseName].includes(source.schema) ||
            !/^[a-z][a-z0-9_]*$/.test(source.name) || descriptorKeys.has(key) || !Number.isSafeInteger(count) || count < 0)
            throw new Error("Invalid project table inventory.");
          descriptorKeys.add(key);
          if (!count || source.schema === "meterflo_audit" || ignored.has(source.name)) continue;
          if (source.schema === "public" && forbidden.test(source.name)) throw new Error("Package contains forbidden instance/security data.");
          // Restore-provenance records are imported below, not as executable schema.
          if (source.schema !== "public" && source.name === marker) continue;
          const table = lookup.get(key);
          if (!table) throw new Error(`Destination needs a compatible MeterFlo upgrade: missing table ${key}.`);
          if (source.columns.some(column => !table.columns.some(actual => actual.name === column.name)))
            throw new Error(`Destination schema does not support every field in ${key}. Upgrade MeterFlo before restoring.`);
          selected.push(table);
        }
        if (manifest.snapshot.counts["public.projects"] !== 1 || !selected.some(table => table.schema === manifest.project.databaseName && table.name === "work_orders") &&
          !descriptorKeys.has(`${manifest.project.databaseName}.work_orders`))
          throw new Error("Package must contain exactly one project and its work-order table.");
        // Only referenced shared definitions, never arbitrary instance tables.
        const allowed = new Set(normalized.filter(table => table.schema === manifest.project.databaseName ||
          table.name === "projects" || table.columns.some(column => column.name === "project_id")).map(tableKey));
        for (let changed = true; changed;) {
          changed = false;
          for (const table of normalized) if (allowed.has(tableKey(table))) for (const foreign of table.foreign) {
            const key = `${foreign.schema}.${foreign.table}`;
            if (!allowed.has(key)) { allowed.add(key); changed = true; }
          }
          for (const table of normalized) if (!allowed.has(tableKey(table)) &&
            table.foreign.some(foreign => allowed.has(`${foreign.schema}.${foreign.table}`) &&
              lookup.get(`${foreign.schema}.${foreign.table}`)?.columns.some(column => column.name === "project_id"))) {
            allowed.add(tableKey(table)); changed = true;
          }
        }
        allowed.add("public.user_group_members");
        for (const table of selected) if (!allowed.has(tableKey(table))) throw new Error("Unrelated table found in project package.");
        const tables = ordered(selected), descriptors = new Map(manifest.snapshot.tables.map(table => [tableKey(table), table]));
        const input = (table: Table) => packageRows(directory, manifest, descriptors.get(tableKey(table))!);
        const referenced = (table: Table) => [...new Set([...table.primary, ...table.columns.filter(column => ["name", "username"].includes(column.name)).map(column => column.name),
          ...normalized.flatMap(child => child.foreign.filter(key => key.schema === table.schema && key.table === table.name).flatMap(key => key.references))])];
        const identityColumns = (table: Table) => table.columns.filter(column => column.identity || column.default?.includes("nextval("));
        const owned = (table: Table, row: any) => table.schema !== "public" || row.project_id != null ||
          ["users", "user_groups", "user_group_members"].includes(table.name);
        const mapForeign = (table: Table, source: any) => {
          const row = { ...source };
          for (const key of table.foreign) for (let index = 0; index < key.columns.length; index++)
            row[key.columns[index]] = get(maps, `${key.schema}.${key.table}`, key.references[index], row[key.columns[index]]);
          if (row.project_id != null) row.project_id = projectId;
          return row;
        };
        const projectRow = (source: any) => ({ ...source, id: projectId, name: target.name, database_name: target.database_name,
          customer_api_enabled: false, webhook_enabled: false });
        // Reserve all global generated identities first. UUID business identities
        // remain intact; collisions reject rather than corrupt JSON lineage.
        for (const table of tables) {
          const key = tableKey(table), reused = new Set<string>(); reuse.set(key, reused);
          for await (const batch of batches(input(table))) {
            const serial = table.schema === "public" ? identityColumns(table) : [];
            const allocated = new Map<string, any[]>();
            for (const column of serial) {
              const sequence = (await client.query("SELECT pg_get_serial_sequence($1,$2) AS name", [destination(table), column.name])).rows[0].name;
              if (!sequence) throw new Error("Missing generated-ID sequence in destination.");
              allocated.set(column.name, (await client.query("SELECT nextval($1::regclass) AS id FROM generate_series(1,$2)", [sequence, batch.length])).rows.map(row => row.id));
            }
            for (let index = 0; index < batch.length; index++) {
              const source = batch[index];
              if (source.project_id != null && Number(source.project_id) !== manifest.project.id ||
                table.schema === "public" && table.name === "projects" && Number(source.id) !== manifest.project.id)
                throw new Error("Package contains another project's records.");
              let mapped = mapForeign(table, source);
              if (table.schema === "public" && table.name === "projects") mapped = projectRow(mapped);
              else if (table.schema === "public" && table.name === "users") {
                mapped.id = randomUUID(); mapped.username = `${String(source.username || source.first_name || "Archived_user").replace(/\s+/g, "_").slice(0, 75)}__import_${randomUUID().slice(0, 8)}`;
              } else {
                for (const [column, values] of allocated) mapped[column] = values[index];
                // Project-owned network records use globally unique UUIDs, unlike
                // project-scoped inventory lineage. Allocate new IDs and map FKs.
                if (table.schema === "public" && owned(table, source) && table.primary.length === 1 &&
                  table.columns.find(column => column.name === table.primary[0])?.type === "uuid")
                  mapped[table.primary[0]] = randomUUID();
                if (table.schema === "public" && table.name === "sftp_server_accounts")
                  mapped.username = `${String(source.username).slice(0, 75)}__import_${randomUUID().slice(0, 8)}`;
                if (table.name === "user_groups") mapped.name = `${String(source.name).slice(0, 65)} [import ${randomUUID().slice(0, 8)}]`;
                if (!owned(table, source)) {
                  const names = new Set(table.columns.map(column => column.name));
                  const scopedCore = names.has("project_id") && source.project_id == null ?
                    (names.has("code") ? [[...(names.has("status_code") ? ["status_code"] : []), "code", "project_id"]] :
                      names.has("name") ? [["name", "project_id"]] : []) : [];
                  const natural = [...scopedCore, ...table.unique, ...(serial.length ? [] : [table.primary])];
                  for (const columns of natural.filter(columns => columns.length && columns.every(column => mapped[column] != null || column === "project_id"))) {
                    const found = (await client.query(`SELECT * FROM ${destination(table)} WHERE ${columns.map((column, i) => `${quote(column)} IS NOT DISTINCT FROM $${i + 1}`).join(" AND ")} LIMIT 1`,
                      columns.map(column => mapped[column]))).rows[0];
                    if (found) { mapped = found; reused.add(scalar(table.primary.map(column => source[column]))); break; }
                  }
                }
              }
              remember(maps, key, source, mapped, referenced(table));
            }
          }
        }
        copied = await restoreFiles(manifest.files, directory, target);
        const transform = (value: any, name = ""): any => {
          if (Array.isArray(value)) return value.map(item => transform(item, name));
          if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, transform(item, key)]));
          if (["projectId", "project_id"].includes(name) && Number(value) === manifest.project.id) return projectId;
          if (["userId", "user_id", "userIds", "assignedUserIds", "assignedUserId", "claimedBy", "claimedUserId", "installerId", "completedBy", "scheduledBy", "actorId"].includes(name))
            return get(maps, "public.users", "id", value);
          if (["groupId", "group_id", "assignedGroupId", "assigned_group_id", "workGroupId"].includes(name))
            return get(maps, "public.user_groups", "name", get(maps, "public.user_groups", "id", value));
          if (typeof value === "string") {
            const normalized = value.replaceAll("\\", "/");
            if (/^(\/?project-files\/|\/?Project Files\/|\/api\/projects\/)/.test(normalized) ||
              Object.values(manifest.roots).some(root => typeof root === "string" && normalized.startsWith(root.replaceAll("\\", "/") + "/"))) {
              let result = normalized.split(manifest.folder).join(copied!.folder).replaceAll(`inventory-${manifest.project.id}/`, `inventory-${projectId}/`);
              result = result.replace(`/api/projects/${manifest.project.id}/`, `/api/projects/${projectId}/`);
              for (const [kind, root] of Object.entries(manifest.roots))
                if (normalized.startsWith(root.replaceAll("\\", "/") + "/")) result = copied!.roots[kind] + normalized.slice(root.replaceAll("\\", "/").length);
              return result;
            }
          }
          return value;
        };
        for (const name of configuration) if (actual.some(table => table.schema === "public" && table.name === name))
          await client.query(`DELETE FROM ${relation("public", name)} WHERE project_id=$1`, [projectId]);
        for (const table of tables) {
          const key = tableKey(table);
          const convert = (source: any) => {
            let row = mapForeign(table, source);
            for (const column of referenced(table)) row[column] = get(maps, key, column, source[column]);
            if (table.schema === "public" && table.name === "projects") row = projectRow(row);
            if (table.name === "users") Object.assign(row, { password_hash: null, subrole_id: null, role: "user", is_locked: true,
              locked_reason: "Imported inactive identity; review account access before enabling", email: null });
            for (const column of table.columns) {
              if (/^jsonb?$/.test(column.type)) row[column.name] = transform(sanitize(row[column.name]));
              else if (typeof row[column.name] === "string" && !privateField(column.name)) row[column.name] = transform(row[column.name], column.name);
              if (privateField(column.name) && /text|character/.test(column.type))
                row[column.name] = createHash("sha256").update(randomUUID()).digest("hex").slice(0, Math.min(Number(column.type.match(/\((\d+)\)/)?.[1] ?? 64), 64));
            }
            if (/(import_configs|export_configs|external_database_configs|sftp.*(settings|projects|accounts|users)|https_transfer_(settings|tokens))/.test(table.name))
              for (const column of ["enabled", "is_enabled", "is_active"]) if (Object.hasOwn(row, column)) row[column] = false;
            if (table.name === "api_import_configs") {
              row.settings = { ...row.settings, isEnabled: false };
              row.next_run_at = null;
            }
            if (/^(api_import_runs|file_import_runs|file_export_runs|external_database_import_runs)$/.test(table.name) &&
              ["pending", "queued", "running", "processing", "retrying", "cancelling"].includes(row.status))
              row.status = "cancelled";
            if (/sftp.*(accounts|users)|https_transfer_(tokens|credentials)/.test(table.name)) {
              for (const column of ["enabled", "is_enabled", "is_active"]) if (Object.hasOwn(row, column)) row[column] = false;
              if (Object.hasOwn(row, "revoked_at")) row.revoked_at = new Date().toISOString();
            }
            if (table.name === "customer_api_deliveries" && ["pending", "retrying", "retry", "queued", "processing"].includes(row.status)) row.status = "paused";
            if (table.name === "https_transfer_settings" || table.name === "https_transfer_files") {
              if (table.name === "https_transfer_files") {
                const mapped = copied!.keys.get(`${source.provider}:${source.location}:${source.storage_key}`);
                if (!mapped) throw new Error("Exchange file metadata has no verified bytes in this package.");
                row.storage_key = mapped;
              }
              row.provider = copied!.exchange.provider; row.location = copied!.exchange.location;
            }
            return row;
          };
          if (table.name === "projects" && table.schema === "public") {
            for await (const source of input(table)) {
              const row = convert(source), columns = writable(table).filter(column => !["id", "name", "database_name"].includes(column.name));
              await client.query(`UPDATE public.projects SET ${columns.map(column => `${quote(column.name)}=r.${quote(column.name)}`).join(",")}
                FROM jsonb_populate_record(NULL::public.projects,$1::jsonb) r WHERE projects.id=$2`, [JSON.stringify(row), projectId]);
            }
            continue;
          }
          const self = table.foreign.filter(key => key.schema === table.schema && key.table === table.name);
          const insert = async (sources: any[]) => {
            const data = sources.filter(source => !reuse.get(key)?.has(scalar(table.primary.map(column => source[column])))).map(convert);
            if (!data.length) return;
            const columns = writable(table).map(column => quote(column.name)).join(",");
            await client.query(`INSERT INTO ${destination(table)}(${columns}) OVERRIDING SYSTEM VALUE
              SELECT ${columns} FROM jsonb_populate_recordset(NULL::${destination(table)},$1::jsonb)`, [JSON.stringify(data)]);
          };
          if (self.length) {
            const pending = []; for await (const row of input(table)) pending.push(row);
            const done: any[] = [];
            while (pending.length) {
              const index = pending.findIndex(row => self.every(foreign => foreign.columns.some(column => row[column] == null) ||
                done.some(parent => foreign.columns.every((column, i) => row[column] === parent[foreign.references[i]]))));
              if (index < 0) throw new Error("Cyclic or missing parent record in project data.");
              const [row] = pending.splice(index, 1); await insert([row]); done.push(row);
            }
          } else for await (const batch of batches(input(table))) await insert(batch);
          if (table.schema !== "public") for (const column of identityColumns(table)) {
            const sequence = (await client.query("SELECT pg_get_serial_sequence($1,$2) AS name", [destination(table), column.name])).rows[0].name;
            if (sequence) await client.query(`SELECT setval($1::regclass,COALESCE(max(${quote(column.name)}),1),count(*)>0) FROM ${destination(table)}`, [sequence]);
          }
        }
        await importHistory(client, directory, manifest, projectId);
        await client.query(`CREATE TABLE IF NOT EXISTS ${relation(target.database_name, marker)}
          (package_id uuid PRIMARY KEY, imported_at timestamptz NOT NULL DEFAULT now(), original_project_id integer NOT NULL, original_project_name text NOT NULL)`);
        const previous = manifest.snapshot.tables.find(table => table.schema === manifest.project.databaseName && table.name === marker);
        if (previous) for await (const row of packageRows(directory, manifest, previous))
          await client.query(`INSERT INTO ${relation(target.database_name, marker)} VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
            [row.package_id, row.imported_at, row.original_project_id, row.original_project_name]);
        await client.query(`INSERT INTO ${relation(target.database_name, marker)}(package_id,original_project_id,original_project_name) VALUES($1,$2,$3)`,
          [manifest.packageId, manifest.project.id, manifest.project.name]);
        commitAttempted = true; await client.query("COMMIT"); committed = true;
        return { restored: manifest.snapshot.counts[`${manifest.project.databaseName}.work_orders`] ?? 0, errors: [],
          files: copied.written, packageId: manifest.packageId, databaseCommitted: true,
          warnings: ["Imported user identities are inactive. Review assignments and account access.",
            "Review and explicitly re-enable integrations and schedules; credentials and destination access locks were not imported."] };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        if (commitAttempted && !committed && target) {
          try {
            const probe = await pool.query(`SELECT 1 FROM ${relation(target.database_name, marker)} WHERE package_id=$1`, [opened.manifest.packageId]);
            committed = !!probe.rowCount;
          } catch { throw Object.assign(new Error("Restore commit outcome is unconfirmed. Do not retry or remove files; inspect the project's restore marker first.", { cause: error }), { databaseCommitted: "unknown" }); }
        }
        if (!committed) await copied?.rollback();
        if (committed) throw Object.assign(new Error("The database restore committed, but its final response failed. Do not replay the restore; refresh the destination project.", { cause: error }), { databaseCommitted: true });
        throw error;
      } finally { client.release(); }
    }, projectId));
  } finally { await fs.rm(opened.directory, { recursive: true, force: true }); }
}

async function importHistory(client: import("pg").PoolClient, directory: string, manifest: Manifest, projectId: number) {
  const prefix = `import:${manifest.packageId}:${projectId}:`;
  for (const name of ["operations", "events"]) {
    const table = manifest.snapshot.tables.find(table => table.schema === "meterflo_audit" && table.name === name);
    if (!table) continue;
    const actual = (await catalog(client, ["meterflo_audit"])).find(table => table.name === name);
    if (!actual) throw new Error("Audit storage must be initialized before a complete project restore.");
    for await (const batch of batches(packageRows(directory, manifest, table))) {
      const imported = batch.map(original => name === "operations" ? { ...original, id: prefix + original.id, project_id: projectId,
        actor_kind: "historical", source: "backup_import" } : { ...original, id: randomUUID(), operation_id: prefix + original.operation_id,
        project_id: projectId, actor_kind: "historical", source: "backup_import", metadata: { ...original.metadata,
          importedHistory: { packageId: manifest.packageId, sourceProjectId: manifest.project.id, eventId: original.id,
            sequence: original.sequence, operationId: original.operation_id, actorId: original.actor_id, source: original.source, actorKind: original.actor_kind } } });
      if (batch.some(row => row.project_id != null && Number(row.project_id) !== manifest.project.id ||
        name === "events" && Number(row.project_id) !== manifest.project.id))
        throw new Error("Audit history contains records from a different project.");
      const columns = writable(actual).filter(column => column.name !== "sequence").map(column => quote(column.name)).join(",");
      await client.query(`INSERT INTO ${relation("meterflo_audit", name)}(${columns})
        SELECT ${columns} FROM jsonb_populate_recordset(NULL::${relation("meterflo_audit", name)},$1::jsonb)`, [JSON.stringify(imported)]);
    }
  }
}
