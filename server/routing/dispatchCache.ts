import { randomUUID } from "node:crypto";
import type { RoutingResult } from "../../shared/workOrderRouting";

export interface DispatchEntry {
  id: string;
  plannerId: string;
  route: RoutingResult;
  shareableOrigin: boolean;
  dispatched: boolean;
  activatedAt?: number;
}

// Provider content is deliberately transient: never serialize this cache into
// business records, backups, logs or a permanent geometry store.
export class DispatchCache {
  private entries = new Map<string, DispatchEntry>();
  constructor() {
    const timer = setInterval(() => this.prune(), 60_000);
    timer.unref();
  }
  private prune() {
    for (const [id, entry] of this.entries)
      if (Date.parse(entry.route.expiresAt) <= Date.now()) this.entries.delete(id);
  }
  add(plannerId: string, route: RoutingResult, shareableOrigin: boolean) {
    this.prune();
    // Bound both per-planner and instance memory without extending any expiry.
    const own = [...this.entries.values()].filter(entry => entry.plannerId === plannerId);
    while (own.length >= 50) this.entries.delete(own.shift()!.id);
    while (this.entries.size >= 500) this.entries.delete(this.entries.keys().next().value!);
    const id = randomUUID();
    const entry = { id, plannerId, route: structuredClone(route), shareableOrigin, dispatched: false };
    entry.route.dispatchPlanId = id;
    this.entries.set(id, entry);
    return id;
  }
  get(id: string) { this.prune(); return this.entries.get(id); }
  received(projectId: number, assigneeId: string) {
    this.prune();
    return [...this.entries.values()].filter(entry =>
      entry.dispatched && entry.route.projectId === projectId && entry.route.assigneeId === assigneeId);
  }
}
