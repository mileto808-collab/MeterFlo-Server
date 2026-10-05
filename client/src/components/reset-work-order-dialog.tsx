import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import type { ResetWorkOrderOptions } from "@shared/work-order-reset";
export type { ResetWorkOrderOptions } from "@shared/work-order-reset";

type Assignee = { id?: string; key?: string; label?: string };

type ResetWorkOrderDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (options: ResetWorkOrderOptions) => void;
  pending: boolean;
  assigneesData: any;
  workOrderLabel: string;
  canChangeAssignment?: boolean;
};

const USER_PLACEHOLDER = "__choose_technician__";
const GROUP_PLACEHOLDER = "__choose_group__";

export function ResetWorkOrderDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
  assigneesData,
  workOrderLabel,
  canChangeAssignment = true,
}: ResetWorkOrderDialogProps) {
  const [capturedData, setCapturedData] =
    useState<ResetWorkOrderOptions["capturedData"]>("clear");
  const [attachments, setAttachments] =
    useState<ResetWorkOrderOptions["attachments"]>("keep");
  const [assignment, setAssignment] =
    useState<ResetWorkOrderOptions["assignment"]>("keep");
  const [assignedUserId, setAssignedUserId] = useState("");
  const [assignedGroupId, setAssignedGroupId] = useState("");

  const users = useMemo<Assignee[]>(
    () => (Array.isArray(assigneesData?.users) ? assigneesData.users : []),
    [assigneesData],
  );
  const groups = useMemo<Assignee[]>(
    () => (Array.isArray(assigneesData?.groups) ? assigneesData.groups : []),
    [assigneesData],
  );

  useEffect(() => {
    if (!open) return;
    setCapturedData("clear");
    setAttachments("keep");
    setAssignment("keep");
    setAssignedUserId("");
    setAssignedGroupId("");
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (pending && !nextOpen) return;
    onOpenChange(nextOpen);
  };

  const selectionMissing =
    (assignment === "user" && !assignedUserId) ||
    (assignment === "group" && !assignedGroupId);

  const handleConfirm = () => {
    if (pending || selectionMissing) return;
    onConfirm({
      capturedData,
      attachments,
      assignment,
      ...(assignment === "user" ? { assignedUserId } : {}),
      ...(assignment === "group" ? { assignedGroupId } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        data-testid="reset-work-order-dialog"
        className="max-h-[min(90dvh,44rem)] overflow-y-auto sm:max-w-xl"
      >
        <DialogHeader className="pr-7">
          <DialogTitle>Reset {workOrderLabel} to Open?</DialogTitle>
          <DialogDescription>
            This completed work order will return to Open so it can be worked
            again.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section
            aria-labelledby="reset-records-heading"
            className="rounded-md border bg-muted/30 p-4"
          >
            <h3
              id="reset-records-heading"
              className="mb-2 text-sm font-semibold"
            >
              What changes
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              Old time tracking, completion and scheduling audit fields, and
              the technician&apos;s signature and name will be cleared. Notes
              remain, and this reset and the previous captured values will be logged.
            </p>
          </section>

          <div className="space-y-2">
            <Label htmlFor="reset-captured-data">Captured changeout data</Label>
            <Select
              value={capturedData}
              onValueChange={(value) =>
                setCapturedData(value === "keep" ? "keep" : "clear")
              }
              disabled={pending}
            >
              <SelectTrigger
                id="reset-captured-data"
                data-testid="reset-captured-data-select"
                aria-label="Choose what to do with captured changeout data"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="clear">Clear captured data</SelectItem>
                <SelectItem value="keep">Keep captured data</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-sm text-muted-foreground">
              Covers new system and module IDs, readings and types, and New GPS.
              Old system and module details, Old GPS, and customer information stay unchanged.
              Previous captured values are saved in Notes whether you keep or clear them.
            </p>
            {capturedData === "clear" && (
              <p
                className="text-sm font-medium text-destructive"
                role="alert"
                data-testid="reset-captured-data-warning"
              >
                These captured fields will be cleared after their previous values are recorded in Notes.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-attachments">Attachments</Label>
            <Select
              value={attachments}
              onValueChange={(value) =>
                setAttachments(value === "delete" ? "delete" : "keep")
              }
              disabled={pending}
            >
              <SelectTrigger
                id="reset-attachments"
                data-testid="reset-attachments-select"
                aria-label="Choose what to do with attachments"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep attachments</SelectItem>
                <SelectItem value="delete">
                  Delete attachments
                </SelectItem>
              </SelectContent>
            </Select>
            {attachments === "delete" && (
              <p
                className="text-sm font-medium text-destructive"
                role="alert"
                data-testid="reset-attachments-warning"
              >
                Attachments will be permanently deleted and cannot be restored.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="reset-assignment">Assignment</Label>
            <Select
              value={assignment}
              onValueChange={(value) => {
                const nextAssignment =
                  value === "user" || value === "group" ? value : "keep";
                setAssignment(nextAssignment);
                if (nextAssignment !== "user") setAssignedUserId("");
                if (nextAssignment !== "group") setAssignedGroupId("");
              }}
              disabled={pending}
            >
              <SelectTrigger
                id="reset-assignment"
                data-testid="reset-assignment-select"
                aria-label="Choose assignment"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="keep">Keep current assignment</SelectItem>
                <SelectItem value="user" disabled={!canChangeAssignment}>Assign to a technician</SelectItem>
                <SelectItem value="group" disabled={!canChangeAssignment}>Assign to a group</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {assignment === "user" && (
            <div className="space-y-2">
              <Label htmlFor="reset-technician">New technician</Label>
              <Select
                value={assignedUserId || USER_PLACEHOLDER}
                onValueChange={(value) =>
                  setAssignedUserId(value === USER_PLACEHOLDER ? "" : value)
                }
                disabled={pending}
              >
                <SelectTrigger
                  id="reset-technician"
                  data-testid="reset-technician-select"
                  aria-label="Choose new technician"
                >
                  <SelectValue placeholder="Select a technician" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={USER_PLACEHOLDER} disabled>
                    Select a technician
                  </SelectItem>
                  {users.map((user) => {
                    const value = user.id == null ? "" : String(user.id);
                    if (!value) return null;
                    return (
                      <SelectItem key={value} value={value}>
                        {user.label || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {users.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No technicians are available to assign.
                </p>
              )}
            </div>
          )}

          {assignment === "group" && (
            <div className="space-y-2">
              <Label htmlFor="reset-group">New group</Label>
              <Select
                value={assignedGroupId || GROUP_PLACEHOLDER}
                onValueChange={(value) =>
                  setAssignedGroupId(value === GROUP_PLACEHOLDER ? "" : value)
                }
                disabled={pending}
              >
                <SelectTrigger
                  id="reset-group"
                  data-testid="reset-group-select"
                  aria-label="Choose new group"
                >
                  <SelectValue placeholder="Select a group" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GROUP_PLACEHOLDER} disabled>
                    Select a group
                  </SelectItem>
                  {groups.map((group) => {
                    const value = String(group.key || group.label || "");
                    if (!value) return null;
                    return (
                      <SelectItem key={value} value={value}>
                        {group.label || value}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
              {groups.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No groups are available to assign.
                </p>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={pending}
            data-testid="reset-cancel-button"
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={pending || selectionMissing}
            data-testid="reset-confirm-button"
          >
            {pending ? "Resetting…" : "Yes, reset to Open"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}