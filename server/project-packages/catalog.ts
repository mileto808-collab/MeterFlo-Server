import type { PoolClient } from "pg";

export type Column = { name: string; type: string; generated: boolean; identity: boolean; default: string | null };
export type ForeignKey = { columns: string[]; schema: string; table: string; references: string[]; definition: string; name: string };
export type Table = { schema: string; name: string; columns: Column[]; primary: string[]; foreign: ForeignKey[]; unique: string[][] };
export const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
export const relation = (schema: string, table: string) => `${quote(schema)}.${quote(table)}`;
export const tableKey = (table: Pick<Table, "schema" | "name">) => `${table.schema}.${table.name}`;
export const writable = (table: Table) => table.columns.filter(column => !column.generated);

export async function catalog(client: PoolClient, schemas: string[]): Promise<Table[]> {
  const tables = await client.query(`SELECT n.nspname AS schema,c.relname AS name,c.oid FROM pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=ANY($1) AND c.relkind='r' ORDER BY 1,2`, [schemas]);
  const result: Table[] = [];
  for (const row of tables.rows) {
    const columns = await client.query(`SELECT a.attname AS name,format_type(a.atttypid,a.atttypmod) AS type,
      a.attgenerated<>'' AS generated,a.attidentity<>'' AS identity,pg_get_expr(d.adbin,d.adrelid) AS default
      FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid=$1 AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attnum`, [row.oid]);
    const keys = await client.query(`SELECT con.contype AS kind,con.conname AS name,
      ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY x(id,ord)
        JOIN pg_attribute a ON a.attrelid=con.conrelid AND a.attnum=x.id ORDER BY x.ord) AS columns,
      rn.nspname AS schema,rc.relname AS table,
      ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY x(id,ord)
        JOIN pg_attribute a ON a.attrelid=con.confrelid AND a.attnum=x.id ORDER BY x.ord) AS references,
      pg_get_constraintdef(con.oid) AS definition
      FROM pg_constraint con LEFT JOIN pg_class rc ON rc.oid=con.confrelid
      LEFT JOIN pg_namespace rn ON rn.oid=rc.relnamespace
      WHERE con.conrelid=$1 AND con.contype IN('p','u','f')`, [row.oid]);
    result.push({ schema: row.schema, name: row.name, columns: columns.rows,
      primary: keys.rows.find(key => key.kind === "p")?.columns ?? [],
      unique: keys.rows.filter(key => key.kind === "u").map(key => key.columns),
      foreign: keys.rows.filter(key => key.kind === "f").map(({ kind, ...key }) => key) });
  }
  return result;
}

const credentials = /password|secret|private.?key|access.?token|refresh.?token|auth.?token|token_hash|api.?key|credential|authorization|^cookie$/i;
export const privateField = (name: string) => credentials.test(name) && !/(_env_var|_header|_fingerprint|_configured|_expires_at|_id|_name|_type)$/.test(name);
export function sanitize(value: any): any {
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, privateField(key) ? (typeof item === "string" ? "" : null) : sanitize(item)]));
  return value;
}

export async function* rows(client: PoolClient, schema: string, table: Table) {
  // Numeric and bigint strings round-trip without JavaScript precision loss.
  const exact = table.columns.filter(column => /^(bigint|numeric|decimal)/.test(column.type));
  const expression = `to_jsonb(t)${exact.map(column => `||jsonb_build_object('${column.name.replaceAll("'", "''")}',t.${quote(column.name)}::text)`).join("")}`;
  const cursor = `package_${Math.random().toString(16).slice(2)}`;
  await client.query(`DECLARE ${quote(cursor)} NO SCROLL CURSOR FOR SELECT ${expression} AS value FROM ${relation(schema, table.name)} t`);
  try {
    for (;;) {
      const batch = await client.query(`FETCH 500 FROM ${quote(cursor)}`);
      if (!batch.rows.length) break;
      for (const row of batch.rows) yield row.value;
    }
  } finally { await client.query(`CLOSE ${quote(cursor)}`); }
}

export function ordered(tables: Table[]): Table[] {
  const pending = [...tables], result: Table[] = [], keys = new Set(tables.map(tableKey));
  while (pending.length) {
    const index = pending.findIndex(table => table.foreign.every(key => key.schema === table.schema && key.table === table.name ||
      !keys.has(`${key.schema}.${key.table}`) || result.some(done => done.schema === key.schema && done.name === key.table)));
    if (index < 0) throw new Error("This project has cyclic table dependencies. Restore its PostgreSQL archive for analysis; a MeterFlo import requires schema review.");
    result.push(...pending.splice(index, 1));
  }
  return result;
}
