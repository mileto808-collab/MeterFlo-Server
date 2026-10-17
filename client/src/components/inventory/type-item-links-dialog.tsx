import { useRef } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { InventoryItem } from "@shared/inventory";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

type TypeLinkRow = { id: number; productId: string; productLabel: string };
type TypeLinksSnapshot = {
  systemTypes: TypeLinkRow[];
  moduleTypes: TypeLinkRow[];
  links: Array<{ id: string; equipment: "system" | "module"; typeId: number; itemId: string }>;
  items: InventoryItem[];
};

const selectClass = "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const itemSupportsEquipment = (itemId: string, equipment: "system" | "module", items: InventoryItem[], visited = new Set<string>()): boolean => {
  if (visited.has(itemId)) return false;
  const item = items.find(value => value.id === itemId);
  if (!item) return false;
  if (item.equipment === equipment) return true;
  const next = new Set(visited).add(itemId);
  return item.components.some(component => itemSupportsEquipment(component.itemId, equipment, items, next));
};

export function TypeItemLinksDialog({ open, onOpenChange, projectId, canMaintain, catalogItems }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: string;
  canMaintain: boolean;
  catalogItems: InventoryItem[];
}) {
  const { toast } = useToast();
  const attempts = useRef(new Map<string, string>());
  const typeLinksKey = [`/api/projects/${projectId}/inventory/type-links`];
  const typeLinks = useQuery<TypeLinksSnapshot>({
    queryKey: typeLinksKey,
    enabled: !!projectId && open,
    queryFn: async () => (await apiRequest("GET", `/api/projects/${projectId}/inventory/type-links`)).json(),
  });
  const typeLinkMutation = useMutation({
    mutationFn: async (value: { equipment: "system" | "module"; typeId: number; itemId: string | null }) => {
      const fingerprint = JSON.stringify(value);
      let operationId = attempts.current.get(fingerprint);
      if (!operationId) {
        operationId = crypto.randomUUID();
        attempts.current.set(fingerprint, operationId);
      }
      const response = await apiRequest("POST", `/api/projects/${projectId}/inventory/commands`, {
        operationId, action: "typeLink", data: value,
      });
      return response.json();
    },
    onSuccess: async (_result, value) => {
      attempts.current.delete(JSON.stringify(value));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: typeLinksKey }),
        queryClient.invalidateQueries({ queryKey: [`/api/projects/${projectId}/inventory`] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "work-orders"] }),
      ]);
      toast({ title: "Type link saved", description: "Planned item requirements will use this project mapping." });
    },
    onError: (error: Error) => toast({ title: "Could not save type link", description: error.message, variant: "destructive" }),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Type item links</DialogTitle>
        <DialogDescription>Choose the project inventory item or preassembled kit technicians should use for each system or module type. Imports create planned requirements from these links; they never reserve stock. Type IDs are matched explicitly, never inferred from catalog IDs.</DialogDescription>
      </DialogHeader>
      {typeLinks.isLoading ? <div className="space-y-3" role="status" aria-label="Loading equipment types"><div className="h-12 animate-pulse rounded bg-muted" /><div className="h-12 animate-pulse rounded bg-muted" /></div> :
        typeLinks.isError ? <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm"><p>Equipment types could not load.</p><Button className="mt-2" size="sm" variant="outline" onClick={() => void typeLinks.refetch()}>Retry</Button></div> :
        <div className="space-y-5">
          {(["system", "module"] as const).map(equipment => {
            const types = equipment === "system" ? typeLinks.data?.systemTypes ?? [] : typeLinks.data?.moduleTypes ?? [];
            const items = typeLinks.data?.items ?? catalogItems;
            return <section key={equipment} className="space-y-2">
              <h3 className="text-sm font-semibold capitalize">{equipment} types</h3>
              {types.length ? types.map(type => {
                const linked = typeLinks.data?.links.find(link => link.equipment === equipment && link.typeId === type.id)?.itemId ?? "";
                return <div key={`${equipment}-${type.id}`} className="grid gap-2 rounded-md border p-3 sm:grid-cols-[1fr_1fr] sm:items-center">
                  <div className="min-w-0"><p className="break-words text-sm font-medium">{type.productLabel}</p><p className="text-xs text-muted-foreground">Type #{type.id}</p></div>
                  <div className="space-y-1">
                    <Label htmlFor={`type-link-${equipment}-${type.id}`}>Installation item</Label>
                    <select id={`type-link-${equipment}-${type.id}`} className={selectClass} value={linked} disabled={!canMaintain || typeLinkMutation.isPending} onChange={event => typeLinkMutation.mutate({ equipment, typeId: type.id, itemId: event.target.value || null })}>
                      <option value="">No item linked</option>
                      {items.filter(item => item.id === linked || (item.active && itemSupportsEquipment(item.id, equipment, items))).map(item => <option key={item.id} value={item.id}>{item.sku} · {item.name}{!item.active ? " · inactive mapping" : item.components.length ? " · kit" : ""}</option>)}
                    </select>
                  </div>
                </div>;
              }) : <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No assigned {equipment} types are available in this project.</p>}
            </section>;
          })}
          {!canMaintain && <p className="text-xs text-muted-foreground">Inventory maintenance permission is required to change these links.</p>}
        </div>}
    </DialogContent>
  </Dialog>;
}
