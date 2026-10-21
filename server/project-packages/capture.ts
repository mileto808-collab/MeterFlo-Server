import type { PoolClient } from "pg";
import { catalog, quote, relation, tableKey, writable, rows, sanitize, privateField, type Table } from "./catalog";

export type Snapshot = { project: any; tables: Table[]; schemas: Record<string, string>; counts: Record<string, number> };

export async function capture(client: PoolClient, projectId: number, prefix: string): Promise<Snapshot> {
  const { rows: [project] } = await client.query("SELECT * FROM public.projects WHERE id=$1", [projectId]);
  if (!project?.database_name || !/^project_[a-z0-9_]+$/.test(project.database_name)) throw new Error("Project database was not found.");
  const schemas: Record<string, string> = { public: `${prefix}_data`, [project.database_name]: `${prefix}_work`, meterflo_audit: `${prefix}_history` };
  const tables = await catalog(client, Object.keys(schemas));
  for (const name of Object.values(schemas)) await client.query(`CREATE SCHEMA ${quote(name)}`);
  const lookup = new Map(tables.map(table => [tableKey(table), table]));
  for (const table of tables) {
    const destination = relation(schemas[table.schema], table.name);
    await client.query(`CREATE TABLE ${destination} (LIKE ${relation(table.schema, table.name)} INCLUDING ALL)`);
    for (const column of table.columns) {
      if (!column.identity && column.default?.includes("nextval(")) {
        const sequence = `${table.name.slice(0, 30)}_${column.name.slice(0, 15)}_seq`;
        const qualified = relation(schemas[table.schema], sequence);
        await client.query(`CREATE SEQUENCE ${qualified}`);
        await client.query(`ALTER TABLE ${destination} ALTER COLUMN ${quote(column.name)} SET DEFAULT nextval('${qualified.replaceAll("'", "''")}'::regclass)`);
        await client.query(`ALTER SEQUENCE ${qualified} OWNED BY ${destination}.${quote(column.name)}`);
      } else if (column.default && /\b(public|project_[a-z0-9_]+)\./.test(column.default)) {
        throw new Error(`Non-portable database default in ${tableKey(table)}.${column.name}; backup needs schema review.`);
      }
    }
  }
  const scope = (table: Table) => table.schema === "public" && table.name === "projects" ? `s.id=${projectId}` :
    table.columns.some(column => column.name === "project_id") ? `(s.project_id=${projectId} OR s.project_id IS NULL)` : "true";
  const owned = new Set(tables.filter(table => table.schema === project.database_name ||
    table.schema === "public" && (table.name === "projects" || table.columns.some(column => column.name === "project_id"))).map(tableKey));
  for (let changed = true; changed;) {
    changed = false;
    for (const table of tables) if (table.schema === "public" && !owned.has(tableKey(table)) &&
      table.foreign.some(key => owned.has(`${key.schema}.${key.table}`))) {
      owned.add(tableKey(table)); changed = true;
    }
  }
  async function copy(table: Table, predicate: string) {
    const columns = writable(table).map(column => quote(column.name)).join(",");
    const source = relation(table.schema, table.name), destination = relation(schemas[table.schema], table.name);
    const result = await client.query(`INSERT INTO ${destination}(${columns}) OVERRIDING SYSTEM VALUE
      SELECT ${writable(table).map(column => `s.${quote(column.name)}`).join(",")} FROM ${source} s
      WHERE (${predicate}) AND (${scope(table)}) ON CONFLICT DO NOTHING`);
    if (result.rowCount && table.schema === "public" && table.name === "users") {
      await client.query(`UPDATE ${destination} SET password_hash=NULL,subrole_id=NULL,role='user',is_locked=true,
        locked_at=NULL,locked_reason='Inactive identity preserved by project backup',last_login_at=NULL,
        profile_image_url=NULL,address=NULL,city=NULL,state=NULL,zip=NULL,phone=NULL,website=NULL,notes=NULL`);
    }
    return result.rowCount ?? 0;
  }
  for (const table of tables) {
    if (table.schema === project.database_name) await copy(table, "true");
    else if (table.schema === "public" && table.name === "projects") await copy(table, `s.id=${projectId}`);
    else if (table.columns.some(column => column.name === "project_id")) await copy(table, `s.project_id=${projectId}`);
  }
  // Set-based dependency closure: project descendants, then only referenced shared rows.
  for (let changes = 1; changes;) {
    changes = 0;
    for (const child of tables) for (const key of child.foreign) {
      const parent = lookup.get(`${key.schema}.${key.table}`);
      if (!parent) throw new Error(`Unsupported external table dependency: ${key.schema}.${key.table}`);
      const match = key.columns.map((column, index) => `c.${quote(column)}=s.${quote(key.references[index])}`).join(" AND ");
      changes += await copy(parent, `EXISTS(SELECT 1 FROM ${relation(schemas[child.schema], child.name)} c WHERE ${match})`);
      if (owned.has(tableKey(parent)) && owned.has(tableKey(child))) {
        const reverse = key.columns.map((column, index) => `s.${quote(column)}=p.${quote(key.references[index])}`).join(" AND ");
        changes += await copy(child, `EXISTS(SELECT 1 FROM ${relation(schemas[parent.schema], parent.name)} p WHERE ${reverse})`);
      }
    }
    const history = tables.find(table => table.schema === "meterflo_audit" && table.name === "operations");
    if (history) changes += await copy(history, `s.id IN(SELECT operation_id FROM ${relation(schemas.meterflo_audit, "events")})`);
    const members = tables.find(table => table.schema === "public" && table.name === "user_group_members");
    if (members) changes += await copy(members, `s.group_id IN(SELECT id FROM ${relation(schemas.public, "user_groups")})`);
  }
  const counts: Record<string, number> = {};
  for (const table of tables) {
    if (!table.primary.length) {
      const count = await client.query(`SELECT count(*) AS n FROM ${relation(schemas[table.schema], table.name)}`);
      if (Number(count.rows[0].n)) throw new Error(`Table ${tableKey(table)} has no primary key; cannot verify a portable snapshot.`);
    }
    const sensitive = table.columns.filter(column => privateField(column.name) && /text|character/.test(column.type));
    for (const column of sensitive) {
      const limit = Math.min(Number(column.type.match(/\((\d+)\)/)?.[1] ?? 64), 64);
      // Distinct nonfunctional placeholders also preserve unique token-hash constraints.
      await client.query(`UPDATE ${relation(schemas[table.schema], table.name)}
        SET ${quote(column.name)}=left(md5(random()::text)||md5(random()::text),${limit})`);
    }
    const json = table.columns.filter(column => /^jsonb?$/.test(column.type));
    if (json.length && table.primary.length) for await (const row of rows(client, schemas[table.schema], table)) {
      const updated = json.filter(column => row[column.name] != null).map(column => ({ column, value: sanitize(row[column.name]) }));
      if (!updated.length) continue;
      await client.query(`UPDATE ${relation(schemas[table.schema], table.name)} SET
        ${updated.map(({ column }, i) => `${quote(column.name)}=$${i + 1}::${column.type}`).join(",")}
        WHERE ${table.primary.map((column, i) => `${quote(column)}=$${updated.length + i + 1}`).join(" AND ")}`,
      [...updated.map(({ value }) => JSON.stringify(value)), ...table.primary.map(column => row[column])]);
    }
    counts[tableKey(table)] = Number((await client.query(`SELECT count(*) AS n FROM ${relation(schemas[table.schema], table.name)}`)).rows[0].n);
    for (const column of table.columns.filter(column => column.identity || column.default?.includes("nextval("))) {
      const sequence = (await client.query("SELECT pg_get_serial_sequence($1,$2) AS name", [relation(schemas[table.schema], table.name), column.name])).rows[0].name;
      if (sequence) await client.query(`SELECT setval($1::regclass,COALESCE(max(${quote(column.name)}),1),count(*)>0) FROM ${relation(schemas[table.schema], table.name)}`, [sequence]);
    }
    for (const key of table.foreign) {
      const target = schemas[key.schema];
      const definition = key.definition.replace(/REFERENCES\s+(?:(?:"[^"]+"|[a-z0-9_]+)\.)?(?:"[^"]+"|[a-z0-9_]+)\s*\(/i,
        `REFERENCES ${relation(target, key.table)} (`);
      await client.query(`ALTER TABLE ${relation(schemas[table.schema], table.name)} ADD CONSTRAINT ${quote(key.name)} ${definition}`);
    }
  }
  return { project, tables, schemas, counts };
}
