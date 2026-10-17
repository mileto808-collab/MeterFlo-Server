import type { PoolClient } from "pg";
import { INVENTORY_EVENT_CHANNEL } from "../shared/inventory-events";

// PostgreSQL delivers NOTIFY only after the enclosing transaction commits.
// This also covers writes from another server process and discards rollbacks.
export async function notifyInventoryChanged(client: Pick<PoolClient, "query">, projectId: number, revision?: number) {
  await client.query("SELECT pg_notify($1,$2)", [
    INVENTORY_EVENT_CHANNEL, JSON.stringify({ projectId, ...(revision === undefined ? {} : { revision }) }),
  ]);
}
