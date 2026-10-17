import type { PoolClient } from "pg";
import { pool } from "./db";
import { storage } from "./storage";
import { INVENTORY_EVENT_CHANNEL, type InventoryLiveEvent } from "../shared/inventory-events";
import { inventoryPermissions } from "../shared/inventory";

type Subscriber = (event: InventoryLiveEvent) => void;
const subscribers = new Map<number, Set<Subscriber>>();
let listener: PoolClient | null = null;
let connecting: Promise<void> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
const queued = new Map<number, InventoryLiveEvent>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function dispatch(event: InventoryLiveEvent) {
  for (const callback of subscribers.get(event.projectId) ?? []) callback(event);
}

function scheduleReconnect() {
  if (reconnectTimer || !subscribers.size) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void ensureListener().catch(scheduleReconnect);
  }, 2000);
  reconnectTimer.unref();
}

async function ensureListener(): Promise<void> {
  if (listener) return;
  if (connecting) return connecting;
  connecting = (async () => {
    const client = await pool.connect();
    const lost = () => {
      if (listener !== client) return;
      listener = null;
      client.release(true);
      scheduleReconnect();
    };
    client.on("error", lost);
    client.on("end", lost);
    client.on("notification", message => {
      if (message.channel !== INVENTORY_EVENT_CHANNEL) return;
      try {
        const data = JSON.parse(message.payload ?? "");
        if (!Number.isSafeInteger(data.projectId) || data.projectId <= 0) return;
        queued.set(data.projectId, {
          type: "inventory_updated", projectId: data.projectId,
          ...(Number.isSafeInteger(data.revision) && data.revision >= 0 ? { revision: data.revision } : {}),
        });
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            flushTimer = null;
            const events = [...queued.values()];
            queued.clear();
            events.forEach(dispatch);
          }, 75);
          flushTimer.unref();
        }
      } catch { /* Ignore malformed notifications rather than forwarding arbitrary payloads. */ }
    });
    try {
      await client.query(`LISTEN ${INVENTORY_EVENT_CHANNEL}`);
      listener = client;
      // Catch up after a database-listener outage, even without a new movement.
      for (const projectId of subscribers.keys()) dispatch({ type: "resync", projectId });
    } catch (error) {
      client.release(true);
      throw error;
    }
  })().finally(() => { connecting = null; });
  return connecting;
}

export async function subscribeInventoryEvents(projectId: number, callback: Subscriber) {
  const callbacks = subscribers.get(projectId) ?? new Set<Subscriber>();
  subscribers.set(projectId, callbacks);
  callbacks.add(callback);
  const unsubscribe = () => {
    callbacks.delete(callback);
    if (!callbacks.size) subscribers.delete(projectId);
  };
  try { await ensureListener(); }
  catch (error) { unsubscribe(); scheduleReconnect(); throw error; }
  return unsubscribe;
}

export async function inventoryStreamPermissions(projectId: number, userId: string): Promise<string[] | null> {
  const [user, project] = await Promise.all([storage.getUser(userId), storage.getProject(projectId)]);
  if (!user || user.isLocked || !project?.inventoryEnabled) return null;
  const permissions = await storage.getUserEffectivePermissions(user);
  if (!permissions.includes(inventoryPermissions.view)) return null;
  if (project.isActive === false && !permissions.includes("projects.viewInactive")) return null;
  if (!await storage.isAdminUser(user) && !await storage.isUserAssignedToProject(user.id, projectId)) return null;
  return permissions.sort();
}

export async function inventoryStreamAllowed(projectId: number, userId: string): Promise<boolean> {
  return !!await inventoryStreamPermissions(projectId, userId);
}
