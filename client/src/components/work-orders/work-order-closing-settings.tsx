import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock3, Loader2, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";

type ClosingSettings = { enabled: boolean; afterHours: number; canManage: boolean };

export function WorkOrderClosingSettings({ projectId, isEditing }: { projectId?: number; isEditing: boolean }) {
  const { toast } = useToast();
  const queryKey = ["/api/projects", projectId, "work-order-closing"];
  const { data, isLoading, isError, refetch } = useQuery<ClosingSettings>({
    queryKey,
    queryFn: async () => {
      const response = await fetch(`/api/projects/${projectId}/work-order-closing`, { credentials: "include" });
      if (!response.ok) throw new Error("Unable to load work-order closing settings");
      return response.json();
    },
    enabled: isEditing && !!projectId,
  });
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState("168");
  const [unit, setUnit] = useState<"hours" | "days">("hours");
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setHours(String(data.afterHours ?? 168));
    setUnit("hours");
  }, [data]);

  const save = useMutation({
    mutationFn: async () => {
      if (!projectId) throw new Error("Save this project first");
      const afterHours = Number(hours) * (unit === "days" ? 24 : 1);
      if (!Number.isInteger(afterHours) || afterHours < 1 || afterHours > 87600) {
        throw new Error("Duration must be between 1 and 87,600 hours.");
      }
      const response = await apiRequest("PUT", `/api/projects/${projectId}/work-order-closing`, { enabled, afterHours });
      return response.json() as Promise<ClosingSettings>;
    },
    onSuccess: (next) => {
      queryClient.setQueryData(queryKey, next);
      setEnabled(next.enabled);
      setHours(String(next.afterHours ?? 168));
      setUnit("hours");
      toast({ title: "Closing policy saved", description: "The project review window is up to date." });
    },
    onError: (error: Error) => toast({ title: "Unable to save closing policy", description: error.message, variant: "destructive" }),
  });
  const displayedDuration = Number(hours);
  const max = unit === "days" ? 3650 : 87600;

  return (
    <Card className="mt-6 border-border/80">
      <CardHeader className="pb-4">
        <div className="flex items-start gap-3">
          <span className="rounded-lg bg-primary/10 p-2 text-primary"><Clock3 className="h-5 w-5" /></span>
          <div className="min-w-0">
            <CardTitle className="text-base">Automatic work-order closing</CardTitle>
            <CardDescription className="mt-1 max-w-2xl">
              After a Completed work order has had time for review, MeterFlo can close it automatically and protect its captured evidence.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {!isEditing ? (
          <div className="rounded-md border border-dashed bg-muted/40 p-4 text-sm text-muted-foreground">
            Save the project first. Then return to Work Orders to configure its independent closing policy.
          </div>
        ) : isLoading ? (
          <div className="space-y-3" aria-label="Loading closing settings">
            <div className="h-4 w-40 animate-pulse rounded bg-muted" />
            <div className="h-10 w-full animate-pulse rounded bg-muted" />
          </div>
        ) : isError ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <span>Closing settings could not be loaded.</span><Button variant="outline" size="sm" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4 rounded-lg border bg-background p-4">
              <div className="min-w-0">
                <Label htmlFor="auto-close-enabled" className="text-sm font-semibold">Enable automatic closing</Label>
                <p className="mt-1 text-sm text-muted-foreground">Only Completed work orders are eligible. Manual closing is unaffected.</p>
              </div>
              <Switch id="auto-close-enabled" checked={enabled} disabled={!data?.canManage || save.isPending} onCheckedChange={setEnabled} />
            </div>
            <p className="rounded-md border-l-2 border-primary/50 bg-primary/5 px-3 py-2 text-sm text-muted-foreground">
              Enabling or changing this policy gives existing Completed work orders the full configured interval from the policy change—there is no immediate mass close. Reopened work orders start a fresh interval.
            </p>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-end">
              <div className="space-y-2">
                <Label htmlFor="auto-close-duration">Review window</Label>
                <Input id="auto-close-duration" type="number" min={1} max={max} step={1} value={hours}
                  onChange={event => setHours(event.target.value)} disabled={!data?.canManage || save.isPending}
                  aria-describedby="auto-close-help" data-testid="input-work-order-close-hours" />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant={unit === "hours" ? "secondary" : "outline"} onClick={() => {
                  if (unit !== "hours") setHours(current => String(Number(current) * 24));
                  setUnit("hours");
                }} disabled={!data?.canManage || save.isPending}>Hours</Button>
                <Button type="button" variant={unit === "days" ? "secondary" : "outline"} onClick={() => {
                  if (unit !== "days") setHours(current => String(Math.max(1, Math.round(Number(current) / 24))));
                  setUnit("days");
                }} disabled={!data?.canManage || save.isPending}>Days</Button>
                <span className="self-center text-sm text-muted-foreground">{unit === "hours" ? "hours" : "days"} ({Number.isFinite(displayedDuration) ? displayedDuration * (unit === "days" ? 24 : 1) : 0} total hours)</span>
              </div>
            </div>
            <p id="auto-close-help" className="text-xs text-muted-foreground">Choose 1–87,600 hours (up to 3,650 days). Checked every minute while the server is running; overdue orders are checked again after startup. Orders without a recorded completion time are not automatically closed. Restored policies are paused until reviewed and re-enabled.</p>
            <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="flex items-start gap-2 text-xs text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />Closed work orders cannot be edited until reopened. Reopening preserves evidence and starts a fresh review interval.</p>
              {data?.canManage && <Button type="button" onClick={() => save.mutate()} disabled={save.isPending || !hours || Number(hours) < 1 || Number(hours) > max}>
                {save.isPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving</> : "Save closing policy"}
              </Button>}
            </div>
            {!data?.canManage && <p className="text-xs text-muted-foreground">You can view this policy but do not have permission to change it.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
