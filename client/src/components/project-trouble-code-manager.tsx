import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Loader2, Pencil, Plus, RotateCcw, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

export interface ProjectTroubleCode {
  id: number;
  code: string;
  label: string;
  description: string | null;
  sortOrder: number;
  projectId: number | null;
  ruleKey: string;
  active: boolean;
}

interface Props {
  projectId: number;
  canEdit: boolean;
}

export function ProjectTroubleCodeManager({ projectId, canEdit }: Props) {
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProjectTroubleCode | null>(null);
  const [pendingStatus, setPendingStatus] = useState<ProjectTroubleCode | null>(null);
  const [form, setForm] = useState({ code: "", label: "", description: "", sortOrder: "0" });
  const queryKey = ["/api/projects", projectId, "trouble-codes"];
  const endpoint = `/api/projects/${projectId}/trouble-codes`;
  const { data: definitions = [], isLoading, isError, refetch } = useQuery<ProjectTroubleCode[]>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Could not load project trouble codes");
      return response.json();
    },
    enabled: Number.isInteger(projectId) && projectId > 0,
  });
  const invalidateCodes = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/trouble-codes"] });
    queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "trouble-codes"] });
    queryClient.invalidateQueries({ predicate: query => Array.isArray(query.queryKey) && String(query.queryKey[0] || "").includes("/api/trouble-codes") });
    queryClient.invalidateQueries({ queryKey: ["/api/search/work-orders"] });
  };
  const save = useMutation({
    mutationFn: async () => editing
      ? apiRequest("PATCH", `${endpoint}/${editing.id}`, { code: form.code.trim(), label: form.label.trim(), description: form.description.trim() || null, sortOrder: Number(form.sortOrder) || 0 })
      : apiRequest("POST", endpoint, { code: form.code.trim(), label: form.label.trim(), description: form.description.trim() || undefined, sortOrder: Number(form.sortOrder) || 0 }),
    onSuccess: () => {
      invalidateCodes();
      setDialogOpen(false);
      toast({ title: editing ? "Project trouble code updated" : "Project trouble code added" });
    },
    onError: (error: Error) => toast({ title: "Could not save trouble code", description: error.message, variant: "destructive" }),
  });
  const updateActive = useMutation({
    mutationFn: async (definition: ProjectTroubleCode) => apiRequest("PATCH", `${endpoint}/${definition.id}`, { active: !definition.active }),
    onSuccess: () => {
      invalidateCodes();
      setPendingStatus(null);
      toast({ title: "Trouble code status updated" });
    },
    onError: (error: Error) => toast({ title: "Could not update trouble code", description: error.message, variant: "destructive" }),
  });
  const openCreate = () => {
    setEditing(null);
    setForm({ code: "", label: "", description: "", sortOrder: "0" });
    setDialogOpen(true);
  };
  const openEdit = (item: ProjectTroubleCode) => {
    setEditing(item);
    setForm({ code: item.code, label: item.label, description: item.description || "", sortOrder: String(item.sortOrder) });
    setDialogOpen(true);
  };
  const copyIdentity = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key);
      toast({ title: "Rule ID copied" });
    } catch {
      toast({ title: "Copy unavailable", description: "Select and copy the Rule ID manually.", variant: "destructive" });
    }
  };

  return (
    <Card data-testid="project-trouble-code-manager">
      <CardHeader className="flex flex-col items-stretch justify-between gap-4 sm:flex-row sm:items-start">
        <div className="space-y-1">
          <CardTitle>Project Trouble Codes</CardTitle>
          <CardDescription>Shared core codes are read-only here. Add project-specific choices without changing customer rules.</CardDescription>
        </div>
        {canEdit && <Button type="button" className="w-full shrink-0 sm:w-auto" onClick={openCreate} data-testid="button-add-project-trouble-code"><Plus className="mr-2 h-4 w-4" />Add project code</Button>}
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>Code and name can be edited. Saved work orders refer to the permanent Rule ID, not the code. Core codes must be unique across every project; project codes must be unique within their project and cannot match a core code.</p>
        </div>
        {isLoading ? <div className="space-y-3" aria-label="Loading trouble codes"><Skeleton className="h-14 w-full" /><Skeleton className="h-14 w-full" /></div>
          : isError ? <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/30 p-4 text-sm"><span>Trouble codes could not be loaded.</span><Button type="button" variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div>
          : definitions.length === 0 ? <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center"><p className="font-medium">No trouble codes are available</p><p className="mt-1 text-sm text-muted-foreground">Project codes will appear here alongside shared core codes.</p></div>
          : <div className="divide-y rounded-lg border">
            {definitions.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label)).map(item => (
              <div key={item.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between" data-testid={`project-trouble-code-${item.id}`}>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{item.label}</span><code className="text-xs text-muted-foreground">{item.code}</code><Badge variant={item.projectId === null ? "secondary" : "outline"}>{item.projectId === null ? "Core · shared" : "Project custom"}</Badge>{!item.active && <Badge variant="outline">Retired</Badge>}</div>
                  {item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><span>Rule ID</span><code className="select-all break-all">{item.ruleKey}</code><Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Copy Rule ID for ${item.label}`} onClick={() => copyIdentity(item.ruleKey)}><Copy className="h-3.5 w-3.5" /></Button></div>
                </div>
                {canEdit && item.projectId === projectId && <div className="flex shrink-0 gap-1 sm:justify-end">
                  <Button type="button" size="icon" variant="ghost" aria-label={`Edit ${item.label}`} onClick={() => openEdit(item)}><Pencil className="h-4 w-4" /></Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setPendingStatus(item)}>{item.active ? <><X className="mr-2 h-4 w-4" />Retire</> : <><RotateCcw className="mr-2 h-4 w-4" />Reactivate</>}</Button>
                </div>}
              </div>
            ))}
          </div>}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
          <DialogHeader><DialogTitle>{editing ? "Edit project trouble code" : "Add project trouble code"}</DialogTitle><DialogDescription>{editing ? "Update the code, name, or description. Saved work orders stay linked by the permanent Rule ID." : "Create a project-specific choice. Other projects may reuse this code; it must not match a core code or another code in this project."}</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2"><Label htmlFor="project-trouble-code">Code</Label><Input id="project-trouble-code" value={form.code} onChange={event => setForm(previous => ({ ...previous, code: event.target.value }))} maxLength={50} placeholder="e.g. CABINET_SEAL_DAMAGED" data-testid="input-project-trouble-code" /><p className="text-xs text-muted-foreground">Editable display code; saved work orders use the permanent Rule ID. Codes may repeat in unrelated projects.</p></div>
            <div className="space-y-2"><Label htmlFor="project-trouble-label">Name</Label><Input id="project-trouble-label" value={form.label} onChange={event => setForm(previous => ({ ...previous, label: event.target.value }))} maxLength={100} autoFocus /></div>
            <div className="space-y-2"><Label htmlFor="project-trouble-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label><Textarea id="project-trouble-description" value={form.description} onChange={event => setForm(previous => ({ ...previous, description: event.target.value }))} rows={3} maxLength={2000} /></div>
            {editing && <div className="space-y-2"><Label htmlFor="project-trouble-rule-id">Generated Rule ID</Label><Input id="project-trouble-rule-id" value={editing.ruleKey} readOnly className="font-mono text-xs" /><p className="text-xs text-muted-foreground">Permanent identifier used by saved work orders. It cannot be changed.</p></div>}
            <div className="space-y-2"><Label htmlFor="project-trouble-order">Sort order</Label><Input id="project-trouble-order" type="number" value={form.sortOrder} onChange={event => setForm(previous => ({ ...previous, sortOrder: event.target.value }))} /></div>
            {save.isError && <p role="alert" className="text-sm text-destructive">{save.error.message}</p>}
          </div>
          <DialogFooter className="flex-col-reverse gap-2 sm:flex-row"><Button type="button" variant="outline" onClick={() => setDialogOpen(false)} disabled={save.isPending}>Cancel</Button><Button type="button" disabled={!form.label.trim() || (!editing && !form.code.trim()) || save.isPending} onClick={() => save.mutate()}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editing ? "Save changes" : "Create code"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!pendingStatus} onOpenChange={open => !open && setPendingStatus(null)}>
        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{pendingStatus?.active ? "Retire this trouble code?" : "Reactivate this trouble code?"}</AlertDialogTitle><AlertDialogDescription>{pendingStatus?.active ? `“${pendingStatus?.label}” will no longer be offered for new work orders. Existing work-order references and historical labels remain intact.` : `“${pendingStatus?.label}” will again be available for new work orders.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={updateActive.isPending}>Cancel</AlertDialogCancel><AlertDialogAction disabled={updateActive.isPending} onClick={event => { event.preventDefault(); if (pendingStatus) updateActive.mutate(pendingStatus); }}>{updateActive.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{pendingStatus?.active ? "Confirm retirement" : "Confirm reactivation"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
