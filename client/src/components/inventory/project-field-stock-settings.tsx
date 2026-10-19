import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { InventoryState } from "@shared/inventory";
import { fieldStockSettings, type FieldStockSettings } from "@shared/inventory-field-stock";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export function ProjectFieldStockSettings({ projectId }: { projectId: number }) {
  const key = ["/api/projects", projectId, "inventory"];
  const query = useQuery<{ state: InventoryState }>({ queryKey: key });
  const [draft, setDraft] = useState<FieldStockSettings | null>(null);
  const [dirty, setDirty] = useState(false);
  const client = useQueryClient();
  const { toast } = useToast();
  useEffect(() => { if (query.data && !dirty) setDraft(fieldStockSettings(query.data.state)); }, [query.data, dirty]);
  const mutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/projects/${projectId}/inventory/commands`,
      { operationId: crypto.randomUUID(), action: "fieldSettings", data: draft }),
    onSuccess: async () => {
      setDirty(false);
      await client.invalidateQueries({ queryKey: key });
      await client.invalidateQueries({ predicate: q => q.queryKey.includes(projectId) && q.queryKey.includes("inventory") });
      toast({ title: "Field inventory settings saved" });
    },
    onError: (error: Error) => toast({ title: "Could not save field inventory settings", description: error.message, variant: "destructive" }),
  });
  if (query.isError) return <div role="alert" className="rounded-lg border p-4">Field inventory settings could not load. <Button type="button" variant="outline" onClick={() => void query.refetch()}>Retry</Button></div>;
  if (!draft) return <p className="text-sm text-muted-foreground">Loading field inventory settings…</p>;
  const change = (patch: Partial<FieldStockSettings>) => { setDraft({ ...draft, ...patch }); setDirty(true); };
  const warehouses = query.data?.state.warehouses.filter(w => w.active && w.type === "physical") ?? [];
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Field inventory settings">
    <div><h3 className="font-medium">Field inventory stock</h3><p className="text-sm text-muted-foreground">Choose where technicians take stock. Saves independently of the project form.</p></div>
    <div className="space-y-1"><Label htmlFor="field-stock-source-mode">Default field stock source</Label>
      <Select value={draft.sourceMode} onValueChange={v => change({ sourceMode: v as FieldStockSettings["sourceMode"], warehouseId: null })}>
        <SelectTrigger id="field-stock-source-mode"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="assigned_vehicle">Assigned vehicle stock</SelectItem><SelectItem value="project_warehouse">Project warehouse stock</SelectItem>
        </SelectContent>
      </Select>
    </div>
    {draft.sourceMode === "project_warehouse" ? <div className="space-y-1"><Label htmlFor="field-stock-warehouse">Project stock warehouse</Label>
      <Select value={draft.warehouseId ?? ""} onValueChange={warehouseId => change({ warehouseId })}>
        <SelectTrigger id="field-stock-warehouse"><SelectValue placeholder="Choose a physical warehouse" /></SelectTrigger>
        <SelectContent>{warehouses.map(w => <SelectItem key={w.id} value={w.id}>{w.code} · {w.name}</SelectItem>)}</SelectContent>
      </Select><p className="text-xs text-muted-foreground">Deduct directly from this warehouse. Vehicle transfers are not required.</p>
      {!!draft.warehouseId && !warehouses.some(w => w.id === draft.warehouseId) && <p role="alert" className="text-sm text-destructive">The saved warehouse is inactive or unavailable. Choose an active warehouse.</p>}
    </div> : <p className="text-xs text-muted-foreground">Assign one or more technicians to a vehicle in Inventory → Locations. Technicians sharing a vehicle share its stock balance. Multiple assigned vehicles prompt a choice, remembered on this device for this project.</p>}
    <div className="space-y-1"><Label htmlFor="field-stock-fulfillment">Normal kit fulfillment</Label>
      <Select value={draft.fulfillment} onValueChange={v => change({ fulfillment: v as FieldStockSettings["fulfillment"] })}>
        <SelectTrigger id="field-stock-fulfillment"><SelectValue /></SelectTrigger><SelectContent>
          <SelectItem value="components">Loose components</SelectItem><SelectItem value="kits">Preassembled kits</SelectItem>
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">Stock is deducted only at completion. Labor is non-stock. Existing reservations keep their locations and stock representation. Inventory maintainers/configurators can explicitly change the source or fulfillment for an exception; the system never falls back to another location when stock is short.</p>
    </div>
    <Button type="button" disabled={!dirty || mutation.isPending || draft.sourceMode === "project_warehouse" && !warehouses.some(w => w.id === draft.warehouseId)}
      onClick={() => mutation.mutate()}>Save field inventory settings</Button>
  </section>;
}
