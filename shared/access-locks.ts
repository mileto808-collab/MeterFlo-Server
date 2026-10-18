import { z } from "zod";

export const accessLockPermissions = {
  site: "security.manageSiteAccessLocks",
  project: "projects.manageAccessLocks",
} as const;

export const accessLockUpdate = z.object({
  locked: z.boolean(),
  message: z.string().trim().max(1000),
  expectedUpdatedAt: z.string().datetime().nullable(),
}).strict().refine(value => !value.locked || value.message.length > 0, {
  message: "Enter a message explaining why access is locked.", path: ["message"],
});

export interface AccessLock {
  scope: "site" | "project";
  projectId: number | null;
  locked: boolean;
  message: string;
  updatedAt: string | null;
  updatedBy: string | null;
}
export interface AccessLockStatus {
  site: AccessLock;
  project: AccessLock | null;
  canManageSite: boolean;
  canManageProject: boolean;
  blocked: { scope: "site" | "project"; projectId: number | null; message: string } | null;
}
