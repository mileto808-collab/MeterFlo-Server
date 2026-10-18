import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface WorkOrderSubStatus {
  id: string;
  parentStatusId: number;
  parentStatusCode: string;
  parentStatusLabel: string;
  projectId: number | null;
  code: string;
  label: string;
  description: string | null;
  color: string | null;
  sortOrder: number;
  routingPriority: number | null;
  active: boolean;
}

interface WorkOrderStatusOption {
  id: number;
  code: string;
  label: string;
}

interface Props {
  projectId?: number;
  canEdit: boolean;
}

interface FormState {
  parentStatusId: string;
  code: string;
  label: string;
  description: string;
  color: string;
  sortOrder: string;
  routingPriority: string;
  active: boolean;
}

const blankForm: FormState = {
  parentStatusId: "",
  code: "",
  label: "",
  description: "",
  color: "#64748b",
  sortOrder: "0",
  routingPriority: "",
  active: true,
};

const statusColor = (color: string | null) => {
  if (!color) return undefined;
  const named: Record<string, string> = {
    blue: "#3b82f6", green: "#22c55e", orange: "#f97316", red: "#ef4444",
    yellow: "#eab308", purple: "#a855f7", gray: "#6b7280",
  };
  return named[color.toLowerCase()] || color;
};

export function WorkOrderSubStatusManager({ projectId, canEdit }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<WorkOrderSubStatus | null>(null);
  const [editing, setEditing] = useState<WorkOrderSubStatus | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const scopeKey = projectId ? ["/api/projects", projectId, "work-order-sub-statuses"] : ["/api/work-order-sub-statuses"];
  const endpoint = projectId ? `/api/projects/${projectId}/work-order-sub-statuses` : "/api/work-order-sub-statuses";

  const { data: definitions = [], isLoading, isError, refetch } = useQuery<WorkOrderSubStatus[]>({
    queryKey: scopeKey,
    queryFn: async () => {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load work-order sub-statuses");
      return response.json();
    },
  });
  const { data: parentStatuses = [] } = useQuery<WorkOrderStatusOption[]>({
    queryKey: ["/api/work-order-statuses"],
  });

  const invalidateDefinitions = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/work-order-sub-statuses"] });
    if (projectId) {
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "work-order-sub-statuses"] });
    } else {
      queryClient.invalidateQueries({
        predicate: query => Array.isArray(query.queryKey) && query.queryKey[2] === "work-order-sub-statuses",
      });
    }
  };
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        return apiRequest("PATCH", `${endpoint}/${editing.id}`, {
          label: form.label.trim(),
          description: form.description.trim() || null,
          color: form.color || null,
          sortOrder: Number(form.sortOrder) || 0,
          routingPriority: form.routingPriority.trim() === "" ? null : Number(form.routingPriority),
          active: form.active,
        });
      }
      return apiRequest("POST", endpoint, {
        parentStatusId: Number(form.parentStatusId),
        code: form.code.trim(),
        label: form.label.trim(),
        description: form.description.trim() || null,
        color: form.color || null,
        sortOrder: Number(form.sortOrder) || 0,
        routingPriority: form.routingPriority.trim() === "" ? null : Number(form.routingPriority),
        active: form.active,
      });
    },
    onSuccess: () => {
      invalidateDefinitions();
      setDialogOpen(false);
      toast({ title: editing ? "Sub-status updated" : "Sub-status created" });
    },
    onError: (error: Error) => toast({ title: "Could not save sub-status", description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (definition: WorkOrderSubStatus) => apiRequest("DELETE", `${endpoint}/${definition.id}`),
    onSuccess: () => {
      invalidateDefinitions();
      setConfirmDelete(null);
      toast({ title: "Sub-status deleted" });
    },
    onError: (error: Error) => {
      setConfirmDelete(null);
      toast({
        title: "Sub-status could not be deleted",
        description: `${error.message}${error.message.toLowerCase().includes("used") ? " Edit the sub-status and deactivate it instead." : ""}`,
        variant: "destructive",
      });
    },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ ...blankForm, parentStatusId: parentStatuses[0] ? String(parentStatuses[0].id) : "" });
    setDialogOpen(true);
  };
  const openEdit = (definition: WorkOrderSubStatus) => {
    setEditing(definition);
    setForm({
      parentStatusId: String(definition.parentStatusId),
      code: definition.code,
      label: definition.label,
      description: definition.description || "",
      color: definition.color || "#64748b",
      sortOrder: String(definition.sortOrder),
      routingPriority: definition.routingPriority === null || definition.routingPriority === undefined ? "" : String(definition.routingPriority),
      active: definition.active,
    });
    setDialogOpen(true);
  };
  const updateForm = (patch: Partial<FormState>) => setForm(previous => ({ ...previous, ...patch }));
  const routingPriorityValid = form.routingPriority.trim() === "" || (/^\d+$/.test(form.routingPriority.trim()) && Number(form.routingPriority) <= 100000);
  const copyIdentity = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      toast({ title: "Sub-status ID copied" });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the UUID manually.", variant: "destructive" });
    }
  };

  return (
    <Card data-testid={projectId ? "project-work-order-sub-statuses" : "global-work-order-sub-statuses"}>
      <CardHeader className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
        <div className="min-w-0 space-y-1">
          <CardTitle>Work Order Sub-statuses</CardTitle>
          <CardDescription>
            Sub-statuses add detail beneath a core status. They inherit its workflow rules and cannot override them.
          </CardDescription>
        </div>
        {canEdit && (
          <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={openCreate} disabled={parentStatuses.length === 0}>
            <Plus className="mr-2 h-4 w-4" /> Add sub-status
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3" aria-label="Loading sub-statuses">
            <Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" />
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <span>Sub-statuses could not be loaded.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Try again</Button>
          </div>
        ) : definitions.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
            <p className="font-medium">No sub-statuses yet</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a focused step for one of the existing work-order statuses.</p>
            {canEdit && <Button type="button" variant="outline" className="mt-4" onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Create first sub-status</Button>}
          </div>
        ) : (
          <div className="divide-y rounded-lg border">
            {definitions.map(definition => (
              <div key={definition.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full border" style={{ backgroundColor: statusColor(definition.color) || "transparent" }} />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{definition.label}</span>
                      <span className="text-xs text-muted-foreground">{definition.code}</span>
                      <Badge variant="outline">{definition.parentStatusLabel}</Badge>
                      {definition.projectId === null && <Badge variant="secondary">Shared</Badge>}
                      {definition.routingPriority !== null && definition.routingPriority !== undefined && <Badge variant="outline">Route priority {definition.routingPriority}</Badge>}
                      {!definition.active && <Badge variant="outline">Inactive</Badge>}
                    </div>
                    {definition.description && <p className="mt-1 text-sm text-muted-foreground">{definition.description}</p>}
                    {projectId && definition.projectId === projectId && (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>Immutable ID</span><code className="select-all break-all">{definition.id}</code>
                        <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Copy ID for ${definition.label}`} onClick={() => copyIdentity(definition.id)}><Copy className="h-3.5 w-3.5" /></Button>
                      </div>
                    )}
                  </div>
                </div>
                {canEdit && (projectId ? definition.projectId === projectId : definition.projectId === null) && (
                  <div className="flex shrink-0 gap-1 sm:justify-end">
                    <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${definition.label}`} onClick={() => openEdit(definition)}><Pencil className="h-4 w-4" /></Button>
                    <Button type="button" size="icon" variant="ghost" aria-label={`Delete ${definition.label}`} onClick={() => setConfirmDelete(definition)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit sub-status" : "Create sub-status"}</DialogTitle>
            <DialogDescription>{editing ? "Code and parent status are fixed after creation." : "Add a named step under an existing core status."}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            {!editing && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="sub-status-parent">Parent status</Label>
                  <Select value={form.parentStatusId} onValueChange={value => updateForm({ parentStatusId: value })}>
                    <SelectTrigger id="sub-status-parent"><SelectValue placeholder="Choose core status" /></SelectTrigger>
                    <SelectContent>{parentStatuses.map(status => <SelectItem key={status.id} value={String(status.id)}>{status.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sub-status-code">Code</Label>
                  <Input id="sub-status-code" value={form.code} onChange={event => updateForm({ code: event.target.value })} placeholder="e.g. awaiting_parts" maxLength={80} />
                </div>
              </>
            )}
            <div className="space-y-2">
              <Label htmlFor="sub-status-label">Name</Label>
              <Input id="sub-status-label" value={form.label} onChange={event => updateForm({ label: event.target.value })} placeholder="e.g. Awaiting parts" maxLength={120} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-status-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
              <Textarea id="sub-status-description" value={form.description} onChange={event => updateForm({ description: event.target.value })} rows={3} maxLength={500} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sub-status-color">Color</Label>
                <div className="flex items-center gap-2"><Input id="sub-status-color" type="color" className="h-10 w-14 p-1" value={form.color.startsWith("#") ? form.color : "#64748b"} onChange={event => updateForm({ color: event.target.value })} /><span className="text-sm text-muted-foreground">{form.color}</span></div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="sub-status-order">Sort order</Label>
                <Input id="sub-status-order" type="number" value={form.sortOrder} onChange={event => updateForm({ sortOrder: event.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sub-status-routing-priority">Routing priority <span className="font-normal text-muted-foreground">(optional; lower is more urgent)</span></Label>
              <Input id="sub-status-routing-priority" type="number" min="0" step="1" inputMode="numeric" value={form.routingPriority} onChange={event => updateForm({ routingPriority: event.target.value })} placeholder="Unrated" data-testid="sub-status-routing-priority" />
              <p className="text-xs text-muted-foreground">Priority 0 is valid and ranks ahead of 1. Unrated values are considered after rated work; this does not change display order.</p>
              {!routingPriorityValid && <p role="alert" className="text-xs text-destructive">Enter a whole number from 0 to 100,000 or leave it empty.</p>}
            </div>
            <div className="flex items-center justify-between rounded-md border p-3">
              <div><Label htmlFor="sub-status-active">Active</Label><p className="text-xs text-muted-foreground">Inactive values remain visible on existing work orders.</p></div>
              <Switch id="sub-status-active" checked={form.active} onCheckedChange={active => updateForm({ active })} />
            </div>
            {saveMutation.isError && <p role="alert" className="text-sm text-destructive">{saveMutation.error.message}</p>}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row">
            <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button type="button" disabled={!form.label.trim() || !routingPriorityValid || (!editing && (!form.code.trim() || !form.parentStatusId)) || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create sub-status"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={open => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-destructive" />Delete sub-status?</AlertDialogTitle>
            <AlertDialogDescription>
              Delete “{confirmDelete?.label}”? This cannot be undone. Values already used by work orders cannot be deleted; edit the sub-status and deactivate it instead.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteMutation.isPending} onClick={event => { event.preventDefault(); if (confirmDelete) deleteMutation.mutate(confirmDelete); }}>
              {deleteMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
