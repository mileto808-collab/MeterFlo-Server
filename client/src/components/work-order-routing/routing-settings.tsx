import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Map, Route, Save } from "lucide-react";
import { defaultRoutingConfiguration, isRoutingBrowserReference, isRoutingServerReference, type RoutingConfiguration, type RoutingReadiness, type RoutingProvider } from "@shared/workOrderRouting";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";

export function routingSettingsEndpoint(projectId?: number) {
  return projectId ? `/api/projects/${projectId}/routing/settings` : "/api/routing/settings";
}

export function RoutingSettings({ projectId, compact = false }: { projectId?: number; compact?: boolean }) {
  const endpoint = routingSettingsEndpoint(projectId);
  const { data, isLoading, isError, refetch } = useQuery<RoutingReadiness>({
    queryKey: [endpoint],
    queryFn: async () => {
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Routing settings could not be loaded");
      return response.json();
    },
  });
  const [form, setForm] = useState<RoutingConfiguration>(defaultRoutingConfiguration);
  useEffect(() => { if (data?.configuration) setForm(data.configuration); }, [data?.revision, data?.configuration]);
  const save = useMutation({
    mutationFn: async () => apiRequest("PUT", endpoint, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [endpoint] });
      queryClient.invalidateQueries({ queryKey: ["/api/projects", projectId, "routing", "settings"] });
    },
  });
  const editable = data?.canManage ?? false;
  const patch = (values: Partial<RoutingConfiguration>) => setForm(current => ({ ...current, ...values }));
  const referencesAreValid = isRoutingServerReference(form.serverKeyEnv.trim()) && isRoutingBrowserReference(form.browserKeyEnv.trim())
    && !(form.serverKeyEnv.trim() && form.browserKeyEnv.trim() && form.serverKeyEnv.trim() === form.browserKeyEnv.trim());
  if (isLoading) return <div className="space-y-3" data-testid="routing-settings-loading"><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>;
  if (isError || !data) return <div className="flex items-center justify-between rounded-lg border border-destructive/30 p-4 text-sm" role="alert"><span>Routing readiness could not be checked.</span><Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></div>;
  return (
    <Card data-testid={projectId ? "project-routing-settings" : "site-routing-settings"} className={compact ? "border-0 shadow-none" : ""}>
      {!compact && <CardHeader><CardTitle className="flex items-center gap-2"><Route className="h-5 w-5 text-primary" />{projectId ? "Project routing" : "Maps & routing"}</CardTitle><CardDescription>Configure provider references and limits. Secret values stay server-side; only environment-variable names belong here.</CardDescription></CardHeader>}
      <CardContent className={compact ? "p-0" : "space-y-5"}>
        <div className="flex items-start gap-3 rounded-lg border bg-muted/30 p-3">
          {data.ready && data.mapReady ? <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" /> : <AlertCircle className="mt-0.5 h-5 w-5 text-amber-700" />}
          <div><p className="text-sm font-semibold">{data.disabled ? "Route optimization is disabled" : data.ready && data.mapReady ? "Routing and map display are ready" : data.ready ? "Route planning ready · map setup needed" : "Setup needed"}</p><p className="mt-1 text-sm text-muted-foreground">{data.message}</p><p className="mt-2 text-xs text-muted-foreground">Effective provider: {data.effective.provider === "geoapify" ? "Geoapify" : "Google Maps"} · {data.effective.source === "site" ? "site default" : "project configuration"} · up to {data.effective.maxStops} stops</p></div>
        </div>
        {!editable ? <p className="text-sm text-muted-foreground">You can view readiness, but do not have permission to change this configuration.</p> : (
          <div className="grid gap-4 sm:grid-cols-2">
          {projectId ? <div className="space-y-2 sm:col-span-2"><Label>Project behavior</Label><Select value={form.mode} onValueChange={mode => patch({ mode: mode as RoutingConfiguration["mode"] })}><SelectTrigger data-testid="routing-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="inherit">Use site default</SelectItem><SelectItem value="override">Use project-specific configuration</SelectItem><SelectItem value="disabled">Disable route optimization</SelectItem></SelectContent></Select></div> : <div className="space-y-2 sm:col-span-2"><Label>Sitewide route optimization</Label><Select value={form.mode === "disabled" ? "disabled" : "override"} onValueChange={mode => patch({ mode: mode as "disabled" | "override" })}><SelectTrigger data-testid="routing-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="override">Enabled when provider credentials are ready</SelectItem><SelectItem value="disabled">Disabled</SelectItem></SelectContent></Select></div>}
            {(!projectId || form.mode === "override") && <>
              <div className="space-y-2"><Label>Provider</Label><Select value={form.provider} onValueChange={provider => patch({ provider: provider as RoutingProvider })}><SelectTrigger data-testid="routing-provider"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="geoapify">Geoapify</SelectItem><SelectItem value="google">Google Maps Platform</SelectItem></SelectContent></Select></div>
              <div className="space-y-2"><Label>Maximum stops</Label><Input type="number" min={1} max={24} step={1} value={form.maxStops} onChange={event => patch({ maxStops: Number(event.target.value) })} data-testid="routing-max-stops" /></div>
              <div className="space-y-2"><Label>Daily plans</Label><Input type="number" min={1} max={1000} step={1} value={form.dailyPlans} onChange={event => patch({ dailyPlans: Number(event.target.value) })} data-testid="routing-daily-plans" /></div>
              <div className="space-y-2"><Label>Server key environment variable</Label><Input value={form.serverKeyEnv} onChange={event => patch({ serverKeyEnv: event.target.value })} placeholder={form.provider === "geoapify" ? "GEOAPIFY_SERVER_KEY" : "GOOGLE_MAPS_SERVER_KEY"} autoComplete="off" pattern="(METERFLO_ROUTING_|GOOGLE_MAPS_|GEOAPIFY_)[A-Z0-9_]+" data-testid="routing-server-key-env" /><p className="text-xs text-muted-foreground">Reference only. Never enter a key value. Allowed prefixes: METERFLO_ROUTING_, GOOGLE_MAPS_, GEOAPIFY_.</p></div>
              <div className="space-y-2"><Label>Browser map key environment variable</Label><Input value={form.browserKeyEnv} onChange={event => patch({ browserKeyEnv: event.target.value })} placeholder={form.provider === "geoapify" ? "GEOAPIFY_BROWSER_KEY" : "GOOGLE_MAPS_BROWSER_KEY"} autoComplete="off" pattern="(METERFLO_ROUTING_|GOOGLE_MAPS_|GEOAPIFY_)[A-Z0-9_]+" data-testid="routing-browser-key-env" /><p className="text-xs text-muted-foreground">Use a public, domain-restricted browser key. Allowed prefixes: METERFLO_ROUTING_, GOOGLE_MAPS_, GEOAPIFY_.</p></div>
            </>}
            {projectId && <p className="text-xs text-muted-foreground sm:col-span-2">For new project credentials, use METERFLO_ROUTING_PROJECT_{projectId}_SERVER and METERFLO_ROUTING_PROJECT_{projectId}_BROWSER. An instance administrator can assign other references.</p>}
            <div className="sm:col-span-2 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/30 p-3 text-xs text-muted-foreground"><span><Map className="mr-1 inline h-3.5 w-3.5" />Provider requests transmit route locations. Geoapify map tiles require visible attribution; quotas and terms depend on your plan.</span><span>Credentials are not shown here.</span></div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3"><Button onClick={() => save.mutate()} disabled={save.isPending || !referencesAreValid || !Number.isInteger(form.maxStops) || form.maxStops < 1 || form.maxStops > 24 || !Number.isInteger(form.dailyPlans) || form.dailyPlans < 1 || form.dailyPlans > 1000} data-testid="save-routing-settings"><Save className="mr-2 h-4 w-4" />{save.isPending ? "Saving…" : "Save routing settings"}</Button>{!referencesAreValid && <span className="text-sm text-destructive">Use allowed uppercase prefixes and distinct references. Browser names must include BROWSER and cannot include SERVER, SECRET or PRIVATE.</span>}{save.isError && <span role="alert" className="text-sm text-destructive">{save.error.message || "Settings could not be saved."}</span>}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
