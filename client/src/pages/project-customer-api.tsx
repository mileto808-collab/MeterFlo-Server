import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute, useSearch } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { customerPushSchema, customerPushSettings, type CustomerPushSettings } from "@shared/customer-api-settings";
import ProjectApiImport from "@/pages/project-api-import";
import { CustomerApiDeliveries } from "@/components/customer-api-deliveries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Cable, Check, CircleAlert, Clock3, CloudDownload, ExternalLink, LockKeyhole, RefreshCw, Save, Send } from "lucide-react";

type CredentialStatus = "available" | "missing" | "not_required";
type SettingsEnvelope = { settings: CustomerPushSettings; credentialStatus: CredentialStatus; canEdit: boolean };
type FieldErrors = Partial<Record<keyof CustomerPushSettings, string[]>>;

async function parseError(error: unknown): Promise<{ message: string; errors?: FieldErrors }> {
  const text = error instanceof Error ? error.message : "The settings could not be saved.";
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const body = JSON.parse(match[0]);
      return { message: body.message || text.replace(/^\d+:\s*/, ""), errors: body.errors };
    }
  } catch { /* fall through to readable request error */ }
  return { message: text.replace(/^\d+:\s*/, "") };
}

function defaults(): CustomerPushSettings {
  return customerPushSettings({});
}

export default function ProjectCustomerApi({ projectId: explicitProjectId, embedded = false }: { projectId?: number; embedded?: boolean } = {}) {
  const [, params] = useRoute("/projects/:projectId/customer-api");
  const projectId = explicitProjectId ?? Number(params?.projectId);
  const [, navigate] = useLocation();
  const search = useSearch();
  const { user, hasPermission } = usePermissions();
  const { toast } = useToast();
  const canPull = hasPermission("project.apiImport");
  const canReadPush = hasPermission("projects.edit") || hasPermission("settings.customerApiLogs");
  const canReadLogs = hasPermission("settings.customerApiLogs");
  const isAdmin = user?.role === "admin" || user?.subroleKey === "administrator";
  const [embeddedSection, setEmbeddedSection] = useState(new URLSearchParams(search).get("direction"));
  const sectionParam = embedded ? embeddedSection : new URLSearchParams(search).get("section");
  const section = sectionParam === "pull" && canPull ? "pull" : canReadPush ? "push" : "pull";
  const [form, setForm] = useState<CustomerPushSettings>(defaults);
  const [formProjectId, setFormProjectId] = useState(projectId);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const visibleForm = formProjectId === projectId ? form : defaults();
  const endpoint = `/api/projects/${projectId}/customer-api`;

  const settingsQuery = useQuery<SettingsEnvelope>({
    queryKey: [endpoint],
    enabled: !!projectId && canReadPush && section === "push",
    retry: false,
  });
  const settings = settingsQuery.data?.settings;

  useEffect(() => {
    setForm(defaults());
    setFormProjectId(projectId);
    setFieldErrors({});
  }, [projectId]);

  useEffect(() => {
    if (settings) {
      setForm({ ...settings });
      setFormProjectId(projectId);
      setFieldErrors({});
    }
  }, [settings, projectId]);

  const saveMutation = useMutation({
    mutationFn: async (nextSettings: CustomerPushSettings) => {
      const response = await apiRequest("PUT", endpoint, nextSettings);
      return response.json() as Promise<SettingsEnvelope>;
    },
    onSuccess: envelope => {
      queryClient.setQueryData([endpoint], envelope);
      setForm(envelope.settings);
      setFormProjectId(projectId);
      setFieldErrors({});
      toast({ title: "Push delivery settings saved", description: "Project configuration is stored separately from project details." });
    },
    onError: async error => {
      const result = await parseError(error);
      setFieldErrors(result.errors || {});
      toast({ title: "Could not save push settings", description: result.message, variant: "destructive" });
    },
  });

  const projectQuery = useQuery<{ id: number; name: string }>({
    queryKey: ["/api/projects", projectId],
    enabled: !!projectId && (canReadPush || canPull),
    retry: false,
  });

  const setField = <K extends keyof CustomerPushSettings>(key: K, value: CustomerPushSettings[K]) => {
    setFormProjectId(projectId);
    setForm(current => ({ ...current, [key]: value }));
    setFieldErrors(current => ({ ...current, [key]: undefined }));
  };
  const submit = () => {
    const checked = customerPushSchema.safeParse(visibleForm);
    if (!checked.success) {
      const next: FieldErrors = {};
      for (const issue of checked.error.issues) {
        const key = issue.path[0] as keyof CustomerPushSettings;
        next[key] = [...(next[key] || []), issue.message];
      }
      setFieldErrors(next);
      toast({ title: "Check the highlighted settings", description: "Correct the marked fields before saving.", variant: "destructive" });
      return;
    }
    setFieldErrors({});
    saveMutation.mutate(checked.data);
  };

  const hasAccess = canReadPush || canPull;
  const activeTabs = useMemo(() => [
    ...(canReadPush ? [{ key: "push", label: "Push delivery", icon: Send }] : []),
    ...(canPull ? [{ key: "pull", label: "Pull import", icon: CloudDownload }] : []),
  ], [canReadPush, canPull]);
  const chooseSection = (next: "push" | "pull") => {
    if (embedded) setEmbeddedSection(next);
    else navigate(`/projects/${projectId}/customer-api?section=${next}`);
  };

  if (!projectId || Number.isNaN(projectId)) {
    return <main className="mx-auto max-w-4xl p-8"><Alert variant="destructive"><CircleAlert className="h-4 w-4" /><AlertTitle>Invalid project</AlertTitle><AlertDescription>Customer API setup needs a valid project URL.</AlertDescription></Alert></main>;
  }
  if (!hasAccess) {
    return <main className="mx-auto max-w-3xl p-8"><Card><CardHeader><CardTitle>Customer API access unavailable</CardTitle><CardDescription>Your account does not have permission to configure push delivery, view delivery logs, or import customer work orders.</CardDescription></CardHeader></Card></main>;
  }

  return (
    <div className={embedded ? "min-w-0" : "min-h-[100dvh] bg-[hsl(var(--background))]"}>
      <div className={embedded ? "min-w-0" : "mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-9"}>
        <header className="mb-7 flex flex-col justify-between gap-5 border-b border-border/70 pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Cable className="h-4 w-4 text-primary" />Project integrations</div>
            <h2 className={embedded ? "text-xl font-semibold tracking-tight" : "font-display text-3xl font-semibold tracking-tight md:text-4xl"}>Customer API</h2>
            <p className="mt-2 text-sm text-muted-foreground">{projectQuery.data?.name || `Project ${projectId}`} · Separate controls for inbound work orders and outbound completion data.</p>
          </div>
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Customer API direction">
            {activeTabs.map(tab => {
              const Icon = tab.icon;
              const selected = section === tab.key;
              return <Button key={tab.key} role="tab" aria-selected={selected} variant={selected ? "default" : "outline"} onClick={() => chooseSection(tab.key as "push" | "pull")}><Icon className="mr-2 h-4 w-4" />{tab.label}</Button>;
            })}
          </div>
        </header>

        {section === "push" && canReadPush && (
          <>
            {settingsQuery.isLoading ? <div className="space-y-4"><Skeleton className="h-24 w-full rounded-xl" /><Skeleton className="h-72 w-full rounded-xl" /></div> :
              settingsQuery.isError ? <Alert variant="destructive" className="mb-5"><CircleAlert className="h-4 w-4" /><AlertTitle>Push settings unavailable</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{settingsQuery.error.message}</span><Button size="sm" variant="outline" onClick={() => settingsQuery.refetch()}><RefreshCw className="mr-2 h-4 w-4" />Try again</Button></AlertDescription></Alert> :
                <>
                  {settingsQuery.data && !settingsQuery.data.canEdit && <Alert className="mb-5 border-primary/25 bg-primary/5"><LockKeyhole className="h-4 w-4 text-primary" /><AlertTitle>Read-only access</AlertTitle><AlertDescription>You can inspect delivery outcomes, but saving push settings requires projects.edit.</AlertDescription></Alert>}
                  <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,.65fr)]">
                    <Card className="overflow-hidden">
                      <CardHeader className="border-b bg-primary/[0.035]">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div><CardTitle className="font-display text-xl">Push delivery</CardTitle><CardDescription className="mt-1">Send captured work-order data on completion or when a Trouble / Unable to Complete report is submitted.</CardDescription></div>
                          <Badge variant={visibleForm.customerApiEnabled ? "default" : "outline"}>{visibleForm.customerApiEnabled ? "Enabled" : "Disabled"}</Badge>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-6 p-5 md:p-7">
                        <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/20 p-4">
                          <div><Label htmlFor="push-enabled" className="text-base font-semibold">Enable outbound delivery</Label><p className="mt-1 text-sm text-muted-foreground">Deliver completed work orders and Trouble / Unable to Complete reports to this endpoint.</p></div>
                          <Switch id="push-enabled" checked={visibleForm.customerApiEnabled} onCheckedChange={value => setField("customerApiEnabled", value)} disabled={!settingsQuery.data?.canEdit} data-testid="switch-customer-api-enabled" />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="push-url">Customer endpoint URL</Label>
                          <Input id="push-url" type="url" autoComplete="url" value={visibleForm.customerApiUrl} onChange={event => setField("customerApiUrl", event.target.value)} placeholder="https://api.customer.example/work-orders" disabled={!settingsQuery.data?.canEdit} data-testid="input-customer-api-url" />
                          {fieldErrors.customerApiUrl?.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
                          <p className="text-xs text-muted-foreground">HTTP(S) POST destination; credentials must not be embedded in the URL.</p>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label>Authentication</Label>
                            <Select value={visibleForm.customerApiAuthType} onValueChange={value => setField("customerApiAuthType", value as CustomerPushSettings["customerApiAuthType"])} disabled={!settingsQuery.data?.canEdit}>
                              <SelectTrigger data-testid="select-customer-api-auth-type"><SelectValue /></SelectTrigger>
                              <SelectContent><SelectItem value="none">No authentication</SelectItem><SelectItem value="api_key">API key header</SelectItem><SelectItem value="bearer_token">Bearer token</SelectItem><SelectItem value="basic_auth">Basic authentication</SelectItem></SelectContent>
                            </Select>
                            {fieldErrors.customerApiAuthType?.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
                          </div>
                          {visibleForm.customerApiAuthType === "api_key" && <div className="space-y-2">
                            <Label htmlFor="key-header">API key header name</Label>
                            <Input id="key-header" value={visibleForm.customerApiKeyHeader} onChange={event => setField("customerApiKeyHeader", event.target.value)} placeholder="X-API-Key" disabled={!settingsQuery.data?.canEdit} data-testid="input-customer-api-key-header" />
                            {fieldErrors.customerApiKeyHeader?.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
                            <p className="text-xs text-muted-foreground">Leave blank to use X-API-Key.</p>
                          </div>}
                        </div>

                        {visibleForm.customerApiAuthType !== "none" && <div className="space-y-2">
                          <Label htmlFor="secret-env">Server environment variable name</Label>
                          <Input id="secret-env" autoComplete="off" value={visibleForm.customerApiSecretEnvVar} onChange={event => setField("customerApiSecretEnvVar", event.target.value.toUpperCase())} placeholder="CUSTOMER_API_TOKEN" disabled={!settingsQuery.data?.canEdit} data-testid="input-customer-api-secret-env-var" />
                          {fieldErrors.customerApiSecretEnvVar?.map(message => <p key={message} className="text-sm text-destructive">{message}</p>)}
                          <p className="text-xs text-muted-foreground">Enter the variable name only. Secret values are never displayed or stored in this form.</p>
                        </div>}

                        <div className="flex items-center justify-between gap-4 rounded-xl border p-4">
                          <div><Label htmlFor="send-photos" className="text-base font-semibold">Include field images</Label><p className="mt-1 text-sm text-muted-foreground">Send before, after, trouble, signature, and other images with the work-order payload.</p></div>
                          <Switch id="send-photos" checked={visibleForm.customerApiSendPhotos} onCheckedChange={value => setField("customerApiSendPhotos", value)} disabled={!settingsQuery.data?.canEdit} data-testid="switch-customer-api-send-photos" />
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
                          <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">Settings save independently; project details and existing configuration are not submitted here.</p>
                          {settingsQuery.data?.canEdit && <Button onClick={submit} disabled={saveMutation.isPending} data-testid="button-save-push"><Save className="mr-2 h-4 w-4" />{saveMutation.isPending ? "Saving…" : "Save push settings"}</Button>}
                        </div>
                      </CardContent>
                    </Card>

                    <div className="space-y-5">
                      <Card>
                        <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Check className="h-4 w-4 text-primary" />What gets delivered</CardTitle><CardDescription>Fixed delivery contract</CardDescription></CardHeader>
                        <CardContent className="space-y-4 text-sm">
                          <p className="leading-relaxed text-muted-foreground">A completed work order or submitted trouble report is sent as a fixed JSON POST. A successful customer response is recorded as delivered; timeouts and unsuccessful responses enter the retry schedule, with each outcome visible in delivery activity. This endpoint configuration does not change inbound imports.</p>
                          <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed"><strong className="block text-foreground">Automatic recovery</strong><span className="mt-1 block text-muted-foreground">30-second request timeout · up to five attempts · retry waits of 1, 5, 15, then 60 minutes.</span></div>
                          <div className="rounded-lg border bg-muted/20 p-3 text-xs leading-relaxed"><strong className="block text-foreground">Saved credential status</strong><span className="mt-1 block text-muted-foreground">{settingsQuery.data?.credentialStatus === "available" ? "The credential for the last-saved authentication settings is available. Its value stays hidden." : settingsQuery.data?.credentialStatus === "missing" ? "The credential for the last-saved settings is not currently available; delivery may fail until it is configured." : "The last-saved authentication settings do not require a credential."} Unsaved edits are not checked until saved.</span></div>
                          {user?.role === "admin" && <a className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline" href="/documentation?doc=customer-api#push-delivery-field-reference">Push delivery field reference <ExternalLink className="h-3.5 w-3.5" /></a>}
                        </CardContent>
                      </Card>
                      {canReadLogs && <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Clock3 className="h-4 w-4 text-primary" />Delivery activity</CardTitle><CardDescription>Project-scoped attempts and outcomes. Administrators can retry eligible deliveries.</CardDescription></CardHeader><CardContent><CustomerApiDeliveries isAdmin={isAdmin} projects={projectQuery.data ? [projectQuery.data] : []} fixedProjectId={projectId} /></CardContent></Card>}
                    </div>
                  </div>
                </>}
          </>
        )}

        {section === "pull" && canPull && <ProjectApiImport projectId={projectId} embedded={embedded} />}
      </div>
    </div>
  );
}
