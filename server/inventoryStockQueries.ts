import type { PoolClient } from "pg";
import type { SerialQuery, StockQuery } from "../shared/inventory-stock-query";
import { readRelationalInventory } from "./inventoryRelational";

type Client = Pick<PoolClient, "query">;
const literal = (value: string) => `%${value.trim().toLowerCase().replace(/[\\%_]/g, "\\$&")}%`;

/** Only pre-cutover projects need the aggregate migration, under its existing lock. */
export async function prepareStockQueries(client: Client, projectId: number) {
  const { rows } = await client.query("SELECT version FROM public.inventory_relational_projects WHERE project_id=$1", [projectId]);
  if (!rows.length) await readRelationalInventory(client, projectId);
  else if (rows[0].version !== 1) throw new Error("Unsupported inventory relational storage version.");
}

const joins = `FROM public.inventory_quantities b
  JOIN public.inventory_items i ON i.project_id=b.project_id AND i.id=b.item_id
  JOIN public.inventory_warehouses w ON w.project_id=b.project_id AND w.id=b.warehouse_id
  LEFT JOIN public.inventory_categories c ON c.project_id=i.project_id AND c.id=i.category_id`;

export function stockPredicate(projectId: number, input: StockQuery) {
  const args: unknown[] = [projectId], clauses = ["b.project_id=$1"];
  const add = (sql: string, value: unknown) => { args.push(value); clauses.push(sql.replace("?", `$${args.length}`)); };
  if (input.q.trim()) {
    args.push(literal(input.q));
    const p = `$${args.length}`;
    clauses.push(`(lower(concat_ws(' ',i.sku,i.name,w.code,w.name)) LIKE ${p}
      OR EXISTS(SELECT 1 FROM public.inventory_stock_serials s WHERE s.project_id=b.project_id
        AND s.warehouse_id=b.warehouse_id AND s.item_id=b.item_id AND lower(s.serial) LIKE ${p}))`);
  }
  if (input.warehouse !== "all") add("b.warehouse_id=?", input.warehouse);
  if (input.category !== "all") add("btrim(coalesce(c.name,''))=?", input.category);
  if (input.tracking !== "all") add("i.tracking=?", input.tracking);
  const availability = { all: "", "in-stock": "b.quantity>0", available: "b.quantity-b.reserved>0",
    reserved: "b.reserved>0", "out-of-stock": "b.quantity<=0" }[input.availability];
  if (availability) clauses.push(availability);
  return { args, where: clauses.join(" AND ") };
}

export async function queryStock(client: Client, projectId: number, input: StockQuery) {
  const { args, where } = stockPredicate(projectId, input);
  const { rows: [counts] } = await client.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE ${where})::int AS filtered,
    coalesce(sum(b.quantity) FILTER(WHERE ${where}),0)::float8 AS quantity,
    coalesce(sum(b.reserved) FILTER(WHERE ${where}),0)::float8 AS reserved
    ${joins} WHERE b.project_id=$1`, args);
  const sort = input.sort.startsWith("location") ? "w.name,w.code" :
    input.sort.startsWith("available") ? "(b.quantity-b.reserved)" : "i.name,i.sku";
  const direction = input.sort.endsWith("desc") ? "DESC" : "ASC";
  const order = sort.split(",").map(part => `${part} ${direction}`).join(",");
  const offset = Math.min(input.offset, Math.max(0, Math.ceil(counts.filtered / input.limit) - 1) * input.limit);
  const { rows } = await client.query(`SELECT b.item_id AS "itemId",b.warehouse_id AS "warehouseId",
    b.quantity,b.reserved,b.revision,
    json_build_object('id',i.id,'sku',i.sku,'name',i.name,'category',coalesce(c.name,''),'unit',i.unit,'tracking',i.tracking) AS item,
    json_build_object('id',w.id,'name',w.name,'code',w.code,'type',w.type) AS warehouse,
    (SELECT count(*)::int FROM public.inventory_stock_serials s WHERE s.project_id=b.project_id
      AND s.warehouse_id=b.warehouse_id AND s.item_id=b.item_id) AS "serialCount"
    ${joins} WHERE ${where} ORDER BY ${order},b.warehouse_id,b.item_id LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
  [...args, input.limit, offset]);
  const { rows: [marker] } = await client.query("SELECT revision FROM public.inventory_relational_projects WHERE project_id=$1", [projectId]);
  return { ...counts, rows: rows.map(row => ({ ...row, serials: [] })), offset, revision: marker?.revision ?? 0 };
}

export async function queryStockSerials(client: Client, projectId: number, input: SerialQuery) {
  const args = [projectId, input.warehouse, input.item, literal(input.q)];
  const from = `FROM public.inventory_stock_serials WHERE project_id=$1 AND warehouse_id=$2 AND item_id=$3`;
  const { rows: [counts] } = await client.query(`SELECT count(*)::int AS total,
    count(*) FILTER(WHERE lower(serial) LIKE $4)::int AS filtered ${from}`, args);
  const offset = Math.min(input.offset, Math.max(0, Math.ceil(counts.filtered / input.limit) - 1) * input.limit);
  const { rows } = await client.query(`SELECT serial ${from} AND lower(serial) LIKE $4
    ORDER BY _position,serial LIMIT $5 OFFSET $6`, [...args, input.limit, offset]);
  const { rows: [marker] } = await client.query("SELECT revision FROM public.inventory_relational_projects WHERE project_id=$1", [projectId]);
  return { ...counts, serials: rows.map(row => row.serial as string), offset, revision: marker?.revision ?? 0 };
}

export async function stockSummary(client: Client, projectId: number) {
  const { rows: [result] } = await client.query(`SELECT
    (SELECT count(*)::int FROM public.inventory_warehouses WHERE project_id=$1 AND active) AS locations,
    (SELECT count(*)::int FROM public.inventory_warehouses WHERE project_id=$1 AND type='vehicle') AS vehicles,
    (SELECT count(*)::int FROM public.inventory_items WHERE project_id=$1 AND active) AS items,
    (SELECT count(*)::int FROM public.inventory_items WHERE project_id=$1 AND tracking='serialized') AS serialized,
    (SELECT coalesce(sum(quantity),0)::float8 FROM public.inventory_quantities WHERE project_id=$1) AS quantity,
    (SELECT count(*)::int FROM public.inventory_orders WHERE project_id=$1 AND status IN ('draft','released','partial')) AS orders,
    (SELECT count(*)::int FROM public.inventory_counts WHERE project_id=$1 AND status='open') AS counts`, [projectId]);
  return result;
}

/** Filter dependencies are requested only when opened, and are themselves bounded/searchable. */
export async function stockOptions(client: Client, projectId: number, search: string) {
  const args = [projectId, literal(search)];
  const { rows: warehouses } = await client.query(`SELECT w.id,w.name,w.code FROM public.inventory_warehouses w
    WHERE w.project_id=$1 AND lower(concat_ws(' ',w.name,w.code)) LIKE $2
    AND EXISTS(SELECT 1 FROM public.inventory_quantities b WHERE b.project_id=w.project_id AND b.warehouse_id=w.id)
    ORDER BY w.name,w.id LIMIT 200`, args);
  const { rows: categories } = await client.query(`SELECT DISTINCT btrim(c.name) AS name FROM public.inventory_categories c
    JOIN public.inventory_items i ON i.project_id=c.project_id AND i.category_id=c.id
    JOIN public.inventory_quantities b ON b.project_id=i.project_id AND b.item_id=i.id
    WHERE c.project_id=$1 AND lower(c.name) LIKE $2 ORDER BY name LIMIT 200`, args);
  return { warehouses, categories: categories.map(row => row.name) };
}
