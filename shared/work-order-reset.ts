import { z } from "zod";

export const resetWorkOrderOptionsSchema = z.object({
  attachments: z.enum(["keep", "delete"]),
  assignment: z.enum(["keep", "user", "group"]),
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

export function resetAssignment(
  current: { assignedUserId: string | null; assignedGroupId: string | null },
  options: ResetWorkOrderOptions,
) {
  if (options.assignment === "user") {
    return { assignedUserId: options.assignedUserId!, assignedGroupId: null };
  }
  if (options.assignment === "group") {
    return { assignedUserId: null, assignedGroupId: options.assignedGroupId! };
  }
  return current;
}

export function appendResetNote(notes: string | null, timestamp: string, actor: string, options: ResetWorkOrderOptions) {
  const assignment = options.assignment === "keep" ? "kept" :
    options.assignment === "user" ? `technician ${options.assignedUserId}` : `group ${options.assignedGroupId}`;
  const entry = `Reset to Open at ${timestamp} by ${actor}\nAttachments: ${options.attachments === "keep" ? "kept" : "deleted"}; Assignment: ${assignment}`;
  return notes ? `${notes}\n\n${entry}` : entry;
}

export class WorkOrderResetError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}