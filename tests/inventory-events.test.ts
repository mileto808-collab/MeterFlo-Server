import assert from "node:assert/strict";
import test from "node:test";
import { isInventoryQueryForProject, INVENTORY_EVENT_CHANNEL } from "../shared/inventory-events";
import { notifyInventoryChanged } from "../server/inventoryNotifications";

test("inventory invalidation covers every tab, lazy stock detail and work-order allocation, but not another project", () => {
  for (const key of [
    ["/api/projects/3/inventory"],
    ["/api/projects/3/inventory", "stock", "context"],
    ["/api/projects/3/inventory", "stock", "/api/projects/3/inventory/stock/serials?item=a"],
    ["/api/projects/3/inventory/stock/options"],
    ["/api/projects", "3", "work-orders", 8, "inventory"],
    ["/api/projects/3/work-orders/8/inventory"],
    [["/api/projects/3/inventory"], "detail"],
  ]) assert.equal(isInventoryQueryForProject(key, 3), true, JSON.stringify(key));
  for (const key of [
    ["/api/projects/30/inventory"], ["/api/projects/3/inventory-other"],
    ["/api/projects", 30, "work-orders", 8, "inventory"],
    ["/api/projects/3/work-orders"], ["/api/users"], [],
  ]) assert.equal(isInventoryQueryForProject(key, 3), false, JSON.stringify(key));
});

test("notification uses a parameterized transactional PostgreSQL command and metadata only", async () => {
  const calls: unknown[][] = [];
  const client = { query: async (...args: unknown[]) => { calls.push(args); } };
  await notifyInventoryChanged(client as any, 3, 12);
  assert.deepEqual(calls, [["SELECT pg_notify($1,$2)", [INVENTORY_EVENT_CHANNEL, '{"projectId":3,"revision":12}']]]);
  await notifyInventoryChanged(client as any, 3);
  assert.deepEqual(calls[1], ["SELECT pg_notify($1,$2)", [INVENTORY_EVENT_CHANNEL, '{"projectId":3}']]);
});
