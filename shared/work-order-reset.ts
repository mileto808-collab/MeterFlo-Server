import { z } from "zod";

export const resetWorkOrderOptionsSchema = z.object({
  capturedData: z.enum(["keep", "clear"]),
  attachments: z.enum(["keep", "delete"]),
  assignment: z.enum(["keep", "none", "user", "group"]),
  assignedUserId: z.string().trim().min(1).optional(),
  assignedGroupId: z.string().trim().min(1).optional(),
}).strict().superRefine((options, ctx) => {
  if (options.assignment === "user" && !options.assignedUserId) {
    ctx.addIssue({ code: "custom", path: ["assignedUserId"], message: "Select a technician" });
  }
  if (options.assignment === "group" && !options.assignedGroupId) {
    ctx.addIssue({ code: "custom", path: ["assignedGroupId"], message: "Select a group" });
  }
});

export type ResetWorkOrderOptions = z.infer<typeof resetWorkOrderOptionsSchema>;

const capturedDataFields = [
  ["newSystemId", "New System ID"],
  ["newSystemReading", "New System Reading"],
  ["newSystemType", "New System Type"],
  ["newModuleId", "New Module ID"],
  ["newModuleRead", "New Module Reading"],
  ["newModuleType", "New Module Type"],
  ["newGps", "New GPS"],
] as const;

type CapturedDataSnapshot = Record<
  (typeof capturedDataFields)[number][0],
  string | number | null
>;

export function resetAssignment(
  current: { assignedUserId: string | null; assignedGroupId: string | null },
  options: ResetWorkOrderOptions,
) {
  if (options.assignment === "none") {
    return { assignedUserId: null, assignedGroupId: null };
  }
  if (options.assignment === "user") {
    return { assignedUserId: options.assignedUserId!, assignedGroupId: null };
  }
  if (options.assignment === "group") {
    return { assignedUserId: null, assignedGroupId: options.assignedGroupId! };
  }
  return current;
}

export function appendResetNote(
  notes: string | null,
  timestamp: string,
  actor: string,
  options: ResetWorkOrderOptions,
  previousData: CapturedDataSnapshot,
) {
  const assignment = options.assignment === "keep" ? "kept" :
    options.assignment === "none" ? "None (unassigned)" :
    options.assignment === "user" ? `technician ${options.assignedUserId}` : `group ${options.assignedGroupId}`;
  const snapshot = capturedDataFields.map(([key, label]) => {
    const value = previousData[key];
    return `${label}: ${value == null || value === "" ? "(not captured)" : String(value)}`;
  }).join("\n");
  const entry = [
    `Reset to Open at ${timestamp} by ${actor}`,
    `Attachments: ${options.attachments === "keep" ? "kept" : "deleted"}; Assignment: ${assignment}`,
    `Captured data: ${options.capturedData === "keep" ? "kept" : "cleared"}`,
    "Previous captured data:",
    snapshot,
  ].join("\n");
  return notes ? `${notes}\n\n${entry}` : entry;
}

export class WorkOrderResetError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}