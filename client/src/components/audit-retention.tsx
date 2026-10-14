import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Archive, Check, HardDrive, Loader2, ShieldAlert } from "lucide-react";
import type { AuditPreview, AuditRetention as AuditRetentionPolicy, AuditRetentionSummary } from "@shared/audit";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 bytes";
  const units = ["bytes", "KB", "MB", "GB", "TB"];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unit).toLocaleString(undefined, { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}
function formatDate(value: string | null, timezone: string): string {
  if (!value) return "—";
  try { return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value)); }
  catch { return new Date(value).toLocaleString(); }
}
function localTimeToIso(value: string, timezone: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return undefined;
  const fields = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] || 0)];
  const target = Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]);
  let candidate = target;
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(candidate)).map((part) => [part.type, Number(part.value)]));
      const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
      const adjustment = target - represented;
      candidate += adjustment;
      if (adjustment === 0) break;
    }
    return new Date(candidate).toISOString();
  } catch { return undefined; }
}
async function send<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  return response.json();
}

export function AuditRetention({ timezone }: { timezone: string }) {
  const { data, isLoading, isError, error, refetch } = useQuery<AuditRetentionSummary>({
    queryKey: ["/api/audit/retention"],
    queryFn: async () => {
      const response = await fetch("/api/audit/retention", { credentials: "include" });
      if (!response.ok) throw new Error(await response.text() || `Request failed (${response.status})`);
      return response.json();
    },
  });
  const [policy, setPolicy] = useState<AuditRetentionPolicy>({ automatic: false, days: 365 });
  const [initialized, setInitialized] = useState(false);
  const [beforeLocal, setBeforeLocal] = useState("");
  const [preview, setPreview] = useState<AuditPreview | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [actionError, setActionError] = useState("");
  const [resultMessage, setResultMessage] = useState("");
  useEffect(() => {
    if (data && !initialized) { setPolicy(data.policy); setInitialized(true); }
  }, [data, initialized]);

  const savePolicy = useMutation({
    mutationFn: (next: AuditRetentionPolicy) => send<AuditRetentionPolicy>("PUT", "/api/audit/retention", next),
    onSuccess: (saved) => {
      setPolicy(saved);
      setInitialized(true);
      setActionError("");
      void queryClient.invalidateQueries({ queryKey: ["/api/audit/retention"] });
    },
    onError: (err: Error) => setActionError(err.message || "Could not save retention policy."),
  });
  const previewMutation = useMutation({
    mutationFn: (before: string) => send<AuditPreview>("POST", "/api/audit/retention/preview", { before }),
    onSuccess: (value) => { setPreview(value); setActionError(""); setResultMessage(""); },
    onError: (err: Error) => { setPreview(null); setActionError(err.message || "Could not preview audit cleanup."); },
  });
  const cleanup = useMutation({
    mutationFn: (token: string) => send<{ removed: number }>("POST", "/api/audit/retention/cleanup", { token, confirm: true }),
    onSuccess: async (result) => {
      setConfirmOpen(false);
      setPreview(null);
      setResultMessage(`${result.removed.toLocaleString()} audit events removed.`);
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ["/api/audit/retention"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/audit"] });
    },
    onError: (err: Error) => setActionError(err.message || "Audit cleanup failed."),
  });
  const createPreview = () => {
    if (!beforeLocal) { setActionError("Choose a cutoff date and time before previewing."); return; }
    const cutoff = localTimeToIso(beforeLocal, timezone);
    if (!cutoff) { setActionError("Enter a valid cutoff date and time."); return; }
    previewMutation.mutate(cutoff);
  };

  return <section aria-labelledby="audit-retention-title" className="space-y-4">
    <div><div className="flex items-center gap-2"><Archive className="h-5 w-5 text-primary" /><h2 id="audit-retention-title" className="text-xl font-semibold">Audit retention</h2></div><p className="mt-1 text-sm text-muted-foreground">Global retention controls. Preview eligible records before explicitly confirming deletion.</p></div>
    <Alert className="border-amber-500/30 bg-amber-500/[0.045]"><ShieldAlert className="h-4 w-4" /><AlertTitle>Global scope</AlertTitle><AlertDescription>This retention policy applies across all projects. Automatic cleanup is off by default; saving the policy does not remove records.</AlertDescription></Alert>
    {isLoading ? <div className="grid gap-4 lg:grid-cols-2"><Skeleton className="h-64 w-full" /><Skeleton className="h-64 w-full" /></div>
      : isError ? <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Could not load retention settings</AlertTitle><AlertDescription className="flex flex-wrap items-center gap-3"><span>{error instanceof Error ? error.message : "Retention summary failed to load."}</span><Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button></AlertDescription></Alert>
      : data ? <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader><CardTitle>Stored audit history</CardTitle><CardDescription>Global volume and coverage, across every project.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
              <div><p className="text-3xl font-semibold tabular-nums">{data.count.toLocaleString()}</p><p className="text-sm text-muted-foreground">events retained</p></div>
              <div><p className="flex items-center gap-2 text-xl font-semibold tabular-nums"><HardDrive className="h-4 w-4 text-muted-foreground" />{formatBytes(data.bytes)}</p><p className="text-sm text-muted-foreground">estimated storage</p></div>
            </div>
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2"><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Oldest event</p><p className="mt-1 text-sm">{formatDate(data.oldest, timezone)}</p></div><div><p className="text-xs uppercase tracking-wide text-muted-foreground">Newest event</p><p className="mt-1 text-sm">{formatDate(data.newest, timezone)}</p></div></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Retention controls</CardTitle><CardDescription>Choose the age threshold for globally retained audit records.</CardDescription></CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4 rounded-md border p-3"><div><Label htmlFor="audit-auto-retention">Automatic cleanup</Label><p className="mt-1 text-xs text-muted-foreground">Off means records are only removed after a manual preview and confirmation.</p></div><Switch id="audit-auto-retention" checked={policy.automatic} onCheckedChange={(automatic) => setPolicy((current) => ({ ...current, automatic }))} /></div>
            <div className="max-w-xs space-y-2"><Label htmlFor="audit-retention-days">Keep records for (days)</Label><Input id="audit-retention-days" type="number" min={1} max={3650} step={1} value={policy.days} onChange={(event) => setPolicy((current) => ({ ...current, days: Number(event.target.value) }))} /><p className="text-xs text-muted-foreground">Allowed range: 1–3,650 days.</p></div>
            <Button onClick={() => savePolicy.mutate(policy)} disabled={savePolicy.isPending || policy.days < 1 || policy.days > 3650}><Check className="mr-2 h-4 w-4" />{savePolicy.isPending ? "Saving…" : "Save retention policy"}</Button>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Manual cleanup</CardTitle><CardDescription>Every cleanup begins with a time-bounded server preview. Nothing is removed until you confirm.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-end">
              <div className="space-y-1.5"><Label htmlFor="audit-before">Remove records older than</Label><Input id="audit-before" type="datetime-local" value={beforeLocal} onChange={(event) => { setBeforeLocal(event.target.value); setPreview(null); setActionError(""); setResultMessage(""); }} /><p className="text-xs text-muted-foreground">Interpreted in {timezone}; sent as an ISO timestamp.</p></div>
              <div><Button variant="secondary" onClick={createPreview} disabled={previewMutation.isPending || !beforeLocal}>{previewMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Preview eligible records</Button></div>
            </div>
            {preview && <div className="space-y-3 rounded-lg border border-amber-500/40 bg-amber-500/[0.05] p-4" role="status"><div className="flex items-start gap-3"><HardDrive className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-400" /><div><p className="font-medium">Preview is ready</p><p className="text-sm text-muted-foreground">{preview.count.toLocaleString()} eligible events · older than {formatDate(preview.before, timezone)}</p><p className="mt-1 text-xs text-muted-foreground">Expires {formatDate(preview.expiresAt, timezone)}{preview.limited ? " · result capped by the server; create another preview for remaining records." : ""}</p></div></div><Button variant="destructive" onClick={() => setConfirmOpen(true)} disabled={preview.count === 0}>Review irreversible deletion</Button></div>}
            {actionError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Action could not be completed</AlertTitle><AlertDescription>{actionError}</AlertDescription></Alert>}
            {resultMessage && <Alert><Check className="h-4 w-4" /><AlertTitle>Cleanup complete</AlertTitle><AlertDescription>{resultMessage}</AlertDescription></Alert>}
          </CardContent>
        </Card>
      </div> : null}
    <Dialog open={confirmOpen} onOpenChange={(open) => { if (!cleanup.isPending) setConfirmOpen(open); }}>
      <DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-destructive" />Confirm global audit deletion</DialogTitle><DialogDescription>This permanently removes {preview?.count.toLocaleString() ?? 0} audit events created before {preview ? formatDate(preview.before, timezone) : "the selected cutoff"}. The action cannot be undone. A fresh server preview is required before deletion.</DialogDescription></DialogHeader>
        {preview?.limited && <Alert><AlertDescription>This preview is capped. Only records included in this preview will be removed; run another preview for remaining eligible records.</AlertDescription></Alert>}
        <DialogFooter><Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={cleanup.isPending}>Cancel</Button><Button variant="destructive" onClick={() => preview && cleanup.mutate(preview.token)} disabled={!preview || cleanup.isPending}>{cleanup.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Permanently remove events</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
