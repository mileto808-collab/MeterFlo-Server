import { AsyncLocalStorage } from "node:async_hooks";
import type { AccessLock } from "../shared/access-locks";

// Request-local only: background services do not inherit a global user filter.
export const accessLockContext = new AsyncLocalStorage<Map<number, AccessLock>>();
export function projectAccessVisible(projectId: number) {
  return !accessLockContext.getStore()?.has(projectId);
}
