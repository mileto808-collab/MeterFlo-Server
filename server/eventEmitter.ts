import { EventEmitter } from "events";
import { pool } from "./db";
import { auditContext } from "./auditContext";
import type { PoolClient } from "pg";

export interface ProjectEvent {
  type: "workorder_created" | "workorder_updated" | "workorder_deleted" | "file_added" | "file_deleted";
  projectId: number;
  workOrderId?: number;
  userId?: string;
  timestamp: string;
}

class ProjectEventEmitter extends EventEmitter {
  private clients: Map<number, Set<(event: ProjectEvent) => void>> = new Map();
  private globalClients: Set<(event: ProjectEvent) => void> = new Set();
  refreshProjects() {
    for (const projectId of this.clients.keys())
      this.emitProjectEvent({ type: "workorder_updated", projectId, timestamp: new Date().toISOString() });
  }

  subscribeToProject(projectId: number, callback: (event: ProjectEvent) => void): () => void {
    if (!this.clients.has(projectId)) {
      this.clients.set(projectId, new Set());
    }
    this.clients.get(projectId)!.add(callback);

    return () => {
      const projectClients = this.clients.get(projectId);
      if (projectClients) {
        projectClients.delete(callback);
        if (projectClients.size === 0) {
          this.clients.delete(projectId);
        }
      }
    };
  }

  subscribeGlobal(callback: (event: ProjectEvent) => void): () => void {
    this.globalClients.add(callback);
    return () => {
      this.globalClients.delete(callback);
    };
  }

  emitProjectEvent(event: ProjectEvent): void {
    const projectClients = this.clients.get(event.projectId);
    if (projectClients) {
      projectClients.forEach((callback) => {
        try {
          callback(event);
        } catch (error) {
          console.error("Error in SSE client callback:", error);
        }
      });
    }

    this.globalClients.forEach((callback) => {
      try {
        callback(event);
      } catch (error) {
        console.error("Error in global SSE client callback:", error);
      }
    });
  }

  getClientCount(projectId?: number): number {
    if (projectId !== undefined) {
      return this.clients.get(projectId)?.size || 0;
    }
    let total = this.globalClients.size;
    this.clients.forEach((clients) => {
      total += clients.size;
    });
    return total;
  }
}

export const projectEventEmitter = new ProjectEventEmitter();

export function emitWorkOrderCreated(projectId: number, workOrderId: number, userId?: string): void {
  persistWorkOrderEvent("workorder_created", projectId, workOrderId, userId);
}

export function emitWorkOrderUpdated(projectId: number, workOrderId: number, userId?: string): void {
  persistWorkOrderEvent("workorder_updated", projectId, workOrderId, userId);
}

function persistWorkOrderEvent(type: ProjectEvent["type"], projectId: number, workOrderId: number, userId?: string) {
  void pool.query(`INSERT INTO public.changeout_events(project_id,work_order_id,type,actor_id,operation_id)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
  [projectId, workOrderId, type, userId ?? null, auditContext.getStore()?.operationId ?? null])
    .catch(() => console.error("Work-order notification persistence failed; clients refresh on reconnect."));
}

/** PostgreSQL delivers NOTIFY after commit to every app process. On reconnect,
 * resynchronize subscribed projects instead of assuming every event was seen. */
export function startChangeoutEvents() {
  let stopped = false;
  const connect = async () => {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      const connection = client;
      let failed = false;
      const retry = () => {
        if (failed || stopped) return;
        failed = true; connection.release(true);
        const timer = setTimeout(connect, 5000); timer.unref();
      };
      connection.on("error", retry);
      connection.on("end", retry);
      connection.on("notification", message => {
        if (message.channel !== "meterflo_changeouts" || !message.payload) return;
        try { projectEventEmitter.emitProjectEvent(JSON.parse(message.payload)); }
        catch { console.error("Invalid work-order notification."); }
      });
      await connection.query("LISTEN meterflo_changeouts");
      projectEventEmitter.refreshProjects();
    } catch {
      if (client) { try { client.release(true); } catch {} }
      if (!stopped) { const timer = setTimeout(connect, 5000); timer.unref(); }
    }
  };
  void connect();
  return () => { stopped = true; };
}

export function emitWorkOrderDeleted(projectId: number, workOrderId: number, userId?: string): void {
  persistWorkOrderEvent("workorder_deleted", projectId, workOrderId, userId);
}

export function emitFileAdded(projectId: number, workOrderId?: number, userId?: string): void {
  projectEventEmitter.emitProjectEvent({
    type: "file_added",
    projectId,
    workOrderId,
    userId,
    timestamp: new Date().toISOString(),
  });
}

export function emitFileDeleted(projectId: number, workOrderId?: number, userId?: string): void {
  projectEventEmitter.emitProjectEvent({
    type: "file_deleted",
    projectId,
    workOrderId,
    userId,
    timestamp: new Date().toISOString(),
  });
}
