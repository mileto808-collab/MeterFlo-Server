import { notifyInventoryChanged } from "./inventoryNotifications";
import type { PoolClient } from "pg";
import type { InventoryState } from "../shared/inventory";
import { inventoryCategoryLabels } from "../shared/inventory-categories";
import { storedCategoryState } from "./inventoryCategories";
import { arrayTable, columnName, relationalEntities } from "./inventoryRelationalModel";
import { normalizeInventoryLocations } from "../shared/inventory-location-types";

type Row = Record<string, any>;
export type RelationalRows = { columns: Record<string, string>; keys: string[]; rows: Row[] };
type Tables = Map<string, RelationalRows>;
const own = (obj: Row, key: string) => Object.hasOwn(obj, key) && obj[key] !== undefined;
const at = (obj: Row, path: string) => path.split(".").reduce((value, key) => value?.[key], obj);
const set = (obj: Row, path: string, value: unknown) => {
  const keys = path.split("."), last = keys.pop()!;
  let parent = obj;
  for (const key of keys) parent = parent[key] ??= {};
  parent[last] = value;
};
const remove = (obj: Row, path: string) => {
  const keys = path.split("."), last = keys.pop()!;
  const parent = keys.length ? at(obj, keys.join(".")) : obj;
  if (parent) delete parent[last];
};
const fields = (obj: Row) => Object.keys(obj).filter(key => obj[key] !== undefined);
const translated = (columns: Record<string, string>) => Object.fromEntries(Object.entries(columns).map(([key, type]) => [columnName(key), type]));
function valuesTable(tables: Tables, name: string, child: boolean) {
  const table: RelationalRows = {
    columns: { project_id: "integer", parent_id: "text", ...(child ? { path: "text", line_no: "integer" } : {}), field: "text", value_no: "integer", value: "text" },
    keys: ["parent_id", ...(child ? ["path", "line_no"] : []), "field", "value_no"], rows: [],
  };
  tables.set(arrayTable(name), table);
  return table;
}
function addValues(table: RelationalRows, parent: Row, obj: Row, arrays: string[]) {
  for (const field of arrays) for (const [index, value] of (obj[field] ?? []).entries())
    table.rows.push({ ...parent, field, value_no: index, value });
}
function decodeObject(row: Row, columns: Record<string, string>, json: string[] = []) {
  const result: Row = {};
  for (const field of [...Object.keys(columns), ...json])
      if (row._fields.includes(field)) result[field] = columns[field] === "numeric" && row[columnName(field)] != null
        ? Number(row[columnName(field)]) : row[columnName(field)];
  return result;
}
const keyOf = (row: Row, keys: string[]) => JSON.stringify(keys.map(key => row[key]));

/** Pure codec: no relationship is stored only inside a live aggregate document. */
export function inventoryToRelational(input: InventoryState, projectId: number): Tables {
  const state = normalizeInventoryLocations(storedCategoryState(input));
  const tables: Tables = new Map();
  tables.set("inventory_categories", {
    columns: { project_id: "integer", id: "uuid", name: "text", active: "boolean", _position: "integer" },
    keys: ["id"], rows: (state.categoryCatalog ?? []).map((category, index) => ({ project_id: projectId, ...category, _position: index })),
  });
  for (const model of relationalEntities) {
    const table: RelationalRows = {
      columns: { project_id: "integer", _key: "text", _position: "integer", _fields: "text[]", _paths: "text[]", ...translated(model.columns),
        ...Object.fromEntries((model.json ?? []).map(field => [columnName(field), "jsonb"])) },
      keys: model.name === "inventory_items" ? ["id"] : ["_key"], rows: [],
    };
    // The old item JSON column is an archive, not a second source of truth.
    if (model.name === "inventory_items") table.columns.data = "jsonb";
    if (model.name === "inventory_receipts") table.columns.related_order_id = "text";
    tables.set(model.name, table);
    const arrays = model.arrays?.length ? valuesTable(tables, model.name, false) : undefined;
    for (const child of model.children ?? []) {
      tables.set(child.name, { columns: { project_id: "integer", parent_id: "text", path: "text", line_no: "integer", _fields: "text[]", ...translated(child.columns) },
        keys: ["parent_id", "path", "line_no"], rows: [] });
      if (child.arrays?.length) valuesTable(tables, child.name, true);
    }
    for (const [index, obj] of ((state as any)[model.field] ?? []).entries()) {
      const key = String(model.key === "_position" ? index : obj[model.key ?? "id"]);
      const paths = (model.children ?? []).flatMap(child => child.paths.filter(path => at(obj, path) !== undefined));
      const allowed = new Set([...Object.keys(model.columns), ...(model.json ?? []), ...(model.arrays ?? []), ...(model.children ?? []).flatMap(child => child.paths.map(path => path.split(".")[0])), ...(model.field === "items" ? ["category"] : [])]);
      for (const field of fields(obj)) if (!allowed.has(field))
        throw new Error(`Inventory relational mapping missing ${model.field}.${field}; no data was discarded.`);
      const row: Row = { project_id: projectId, _key: key, _position: index, _fields: fields(obj).filter(field => field !== "category"), _paths: paths };
      for (const field of Object.keys(model.columns)) row[columnName(field)] = obj[field] ?? null;
      for (const field of model.json ?? []) {
        const metadata = obj[field] === undefined ? null : structuredClone(obj[field]);
        if (metadata) for (const path of paths.filter(path => path.startsWith(`${field}.`)))
          remove(metadata, path.slice(field.length + 1));
        row[columnName(field)] = metadata;
      }
      if (model.name === "inventory_items") row.data = {};
      if (model.name === "inventory_receipts")
        row.related_order_id = state.orders.some(order => order.id === obj.reference) ? obj.reference : null;
      table.rows.push(row);
      if (arrays) addValues(arrays, { project_id: projectId, parent_id: key }, obj, model.arrays!);
      for (const child of model.children ?? []) for (const path of child.paths) {
        for (const [lineIndex, line] of (at(obj, path) ?? []).entries()) {
          const lineRow: Row = { project_id: projectId, parent_id: key, path, line_no: lineIndex, _fields: fields(line) };
          const allowedLine = new Set([...Object.keys(child.columns), ...(child.arrays ?? [])]);
          for (const field of fields(line)) if (!allowedLine.has(field))
            throw new Error(`Inventory relational mapping missing ${child.name}.${field}; no data was discarded.`);
          for (const field of Object.keys(child.columns)) lineRow[columnName(field)] = line[field] ?? null;
          tables.get(child.name)!.rows.push(lineRow);
          if (child.arrays?.length) addValues(tables.get(arrayTable(child.name))!,
            { project_id: projectId, parent_id: key, path, line_no: lineIndex }, line, child.arrays);
        }
      }
    }
  }
  const reserved = new Map<string, number>();
  for (const allocation of state.allocations) if (allocation.status === "reserved") for (const line of allocation.lines) {
    const key = JSON.stringify([line.warehouseId, line.itemId]);
    reserved.set(key, (reserved.get(key) ?? 0) + line.quantity);
  }
  tables.set("inventory_quantities", { columns: { project_id: "integer", warehouse_id: "text", item_id: "text", quantity: "integer", reserved: "integer", serials: "jsonb", revision: "integer", _position: "integer" },
    keys: ["warehouse_id", "item_id"], rows: state.stock.map((stock, index) => ({
      project_id: projectId, warehouse_id: stock.warehouseId, item_id: stock.itemId, quantity: stock.quantity,
      reserved: reserved.get(JSON.stringify([stock.warehouseId, stock.itemId])) ?? 0,
      serials: [], revision: stock.revision, _position: index,
    })) });
  tables.set("inventory_stock_serials", { columns: { project_id: "integer", warehouse_id: "text", item_id: "text", serial: "text", _position: "integer" },
    keys: ["item_id", "serial"], rows: state.stock.flatMap(stock => stock.serials.map((serial, index) => ({
      project_id: projectId, warehouse_id: stock.warehouseId, item_id: stock.itemId, serial, _position: index,
    }))) });
  tables.set("inventory_operations", { columns: { project_id: "integer", operation_id: "text", fingerprint: "text" },
    keys: ["operation_id"], rows: Object.entries(state.operations).map(([id, fingerprint]) => ({ project_id: projectId, operation_id: id, fingerprint })) });
  tables.set("inventory_order_counters", { columns: { project_id: "integer", counter_key: "text", value: "integer" },
    keys: ["counter_key"], rows: Object.entries(state.orderNumberCounters ?? {}).map(([key, value]) => ({ project_id: projectId, counter_key: key, value })) });
  const refs: Row[] = [];
  const itemReferences = (value: unknown, result = new Set<string>()): Set<string> => {
    if (Array.isArray(value)) value.forEach(entry => itemReferences(entry, result));
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) {
      if (key === "itemId" && typeof entry === "string") result.add(entry);
      else itemReferences(entry, result);
    }
    return result;
  };
  for (const draft of state.shipmentDrafts ?? []) for (const itemId of itemReferences([draft.capture, draft.pending?.payload]))
    refs.push({ project_id: projectId, draft_id: draft.id, item_id: itemId });
  tables.set("inventory_capture_item_refs", { columns: { project_id: "integer", draft_id: "text", item_id: "text" }, keys: ["draft_id", "item_id"], rows: refs });
  return tables;
}

function arrayIndex(rows: Row[], child = false) {
  const index = new Map<string, any[]>();
  for (const row of rows.sort((a, b) => a.value_no - b.value_no)) {
    const key = JSON.stringify([row.parent_id, ...(child ? [row.path, row.line_no] : []), row.field]);
    if (!index.has(key)) index.set(key, []);
    index.get(key)!.push(row.value);
  }
  return index;
}
export function inventoryFromRelational(tables: Map<string, Row[]>, revision: number, collections: string[]): InventoryState {
  const state: Row = { revision };
  state.categoryCatalog = (tables.get("inventory_categories") ?? []).sort((a, b) => a._position - b._position)
    .map(row => ({ id: row.id, name: row.name, active: row.active }));
  for (const model of relationalEntities) {
    const arrays = arrayIndex(tables.get(arrayTable(model.name)) ?? []);
    const childArrays = new Map((model.children ?? []).map(child => [child.name, arrayIndex(tables.get(arrayTable(child.name)) ?? [], true)]));
    const childLines = new Map<string, Row[]>();
    for (const child of model.children ?? []) for (const line of (tables.get(child.name) ?? []).sort((a, b) => a.line_no - b.line_no)) {
      const obj = decodeObject(line, child.columns);
      for (const field of child.arrays ?? []) if (line._fields.includes(field))
        obj[field] = childArrays.get(child.name)!.get(JSON.stringify([line.parent_id, line.path, line.line_no, field])) ?? [];
      const key = JSON.stringify([child.name, line.parent_id, line.path]);
      if (!childLines.has(key)) childLines.set(key, []);
      childLines.get(key)!.push(obj);
    }
    const entities = (tables.get(model.name) ?? []).sort((a, b) => a._position - b._position).map(row => {
      const obj = decodeObject(row, model.columns, model.json);
      for (const field of model.arrays ?? []) if (row._fields.includes(field))
        obj[field] = arrays.get(JSON.stringify([row._key, field])) ?? [];
      for (const child of model.children ?? []) for (const path of child.paths)
        if (row._paths.includes(path)) set(obj, path, childLines.get(JSON.stringify([child.name, row._key, path])) ?? []);
      if (model.field === "items") obj.category = "";
      return obj;
    });
    if (collections.includes(model.field)) state[model.field] = entities;
  }
  const serials = new Map<string, string[]>();
  for (const row of (tables.get("inventory_stock_serials") ?? []).sort((a, b) => a._position - b._position)) {
    const key = JSON.stringify([row.warehouse_id, row.item_id]);
    if (!serials.has(key)) serials.set(key, []);
    serials.get(key)!.push(row.serial);
  }
  state.stock = (tables.get("inventory_quantities") ?? []).sort((a, b) => a._position - b._position).map(row => ({
    warehouseId: row.warehouse_id, itemId: row.item_id, quantity: row.quantity, revision: row.revision,
    serials: serials.get(JSON.stringify([row.warehouse_id, row.item_id])) ?? [],
  }));
  state.operations = Object.fromEntries((tables.get("inventory_operations") ?? []).map(row => [row.operation_id, row.fingerprint]));
  if (collections.includes("orderNumberCounters")) state.orderNumberCounters =
    Object.fromEntries((tables.get("inventory_order_counters") ?? []).map(row => [row.counter_key, row.value]));
  return inventoryCategoryLabels(state as InventoryState);
}

/** Delta writes keep unrelated records untouched; the caller holds the project lock. */
export async function writeRelationalInventory(client: Pick<PoolClient, "query">, projectId: number, after: InventoryState, before?: InventoryState) {
  const next = inventoryToRelational(after, projectId), previous = before ? inventoryToRelational(before, projectId) : undefined;
  // All relation names and column definitions come from the static model above.
  for (const [name, table] of [...next].reverse()) {
    const prior = previous?.get(name);
    const nextKeys = new Set(table.rows.map(row => keyOf(row, table.keys)));
    // Occupancy uses positional row keys for lossless legacy ordering, but also
    // has a unique item/serial identity. Removing an early entry shifts later
    // identities into existing keys: delete those changed keys before upserting,
    // or an intermediate UPDATE collides with a later, not-yet-shifted row.
    const nextRows = name === "inventory_serial_occupancy"
      ? new Map(table.rows.map(row => [keyOf(row, table.keys), row])) : undefined;
    const deleted = prior?.rows.filter(row => {
      const replacement = nextRows?.get(keyOf(row, table.keys));
      return !nextKeys.has(keyOf(row, table.keys)) || replacement &&
        (replacement.item_id !== row.item_id || replacement.serial !== row.serial);
    });
    if (previous && !deleted?.length) continue;
    const keys = table.keys.map(key => `"${key}"`);
    const match = table.keys.map(key => `saved."${key}"=existing."${key}"`).join(" AND ");
    const definitions = table.keys.map(key => `"${key}" ${table.columns[key]}`).join(",");
    if (previous) {
      await client.query(`DELETE FROM public.${name} existing WHERE project_id=$1 AND EXISTS
        (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS saved(${definitions}) WHERE ${match})`,
      [projectId, JSON.stringify(deleted)]);
    } else if (name === "inventory_serial_occupancy") {
      await client.query(`DELETE FROM public.${name} WHERE project_id=$1`, [projectId]);
    } else {
      await client.query(`DELETE FROM public.${name} existing WHERE project_id=$1 AND NOT EXISTS
        (SELECT 1 FROM jsonb_to_recordset($2::jsonb) AS saved(${definitions}) WHERE ${match})`,
      [projectId, JSON.stringify(table.rows.map(row => Object.fromEntries(table.keys.map(key => [key, row[key]]))))]);
    }
  }
  for (const [name, table] of next) {
    const prior = new Map(previous?.get(name)?.rows.map(row => [keyOf(row, table.keys), JSON.stringify(row)]));
    const changed = table.rows.filter(row => prior.get(keyOf(row, table.keys)) !== JSON.stringify(row));
    const columns = Object.keys(table.columns);
    const keys = ["project_id", ...table.keys];
    const updates = columns.filter(key => !keys.includes(key));
    for (let start = 0; start < changed.length; start += 500) {
      await client.query(`INSERT INTO public.${name} (${columns.map(key => `"${key}"`).join(",")})
        SELECT ${columns.map(key => `"${key}"`).join(",")} FROM jsonb_to_recordset($1::jsonb) AS entries(
          ${Object.entries(table.columns).map(([key, type]) => `"${key}" ${type}`).join(",")})
        ON CONFLICT (${keys.map(key => `"${key}"`).join(",")}) ${updates.length
          ? `DO UPDATE SET ${updates.map(key => `"${key}"=EXCLUDED."${key}"`).join(",")}`
          : "DO NOTHING"}`,
      [JSON.stringify(changed.slice(start, start + 500))]);
    }
  }
  const collections = Object.keys(normalizeInventoryLocations(storedCategoryState(after)));
  await client.query(`INSERT INTO public.inventory_relational_projects(project_id,version,revision,collections)
    VALUES($1,1,$2,$3) ON CONFLICT(project_id) DO UPDATE SET revision=EXCLUDED.revision,collections=EXCLUDED.collections`,
  [projectId, after.revision, collections]);
  await notifyInventoryChanged(client, projectId, after.revision);
}
