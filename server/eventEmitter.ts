import { EventEmitter } from "events";

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
  projectEventEmitter.emitProjectEvent({
    type: "workorder_created",
    projectId,
    workOrderId,
    userId,
    timestamp: new Date().toISOString(),
  });
}

export function emitWorkOrderUpdated(projectId: number, workOrderId: number, userId?: string): void {
  projectEventEmitter.emitProjectEvent({
    type: "workorder_updated",
    projectId,
    workOrderId,
    userId,
    timestamp: new Date().toISOString(),
  });
}

export function emitWorkOrderDeleted(projectId: number, workOrderId: number, userId?: string): void {
  projectEventEmitter.emitProjectEvent({
    type: "workorder_deleted",
    projectId,
    workOrderId,
    userId,
    timestamp: new Date().toISOString(),
  });
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
