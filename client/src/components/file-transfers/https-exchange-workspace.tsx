import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownToLine, ArrowUpFromLine, ChevronLeft, ChevronRight, Clipboard, Download, FileDown, FileSpreadsheet, Loader2, Printer, RefreshCw, RotateCw, Search, Settings2, ShieldCheck, Trash2, UserRoundPlus, X } from "lucide-react";
import type { HttpsContext, HttpsCredential, HttpsEvent, HttpsFile, HttpsFilePage } from "@shared/https-transfers";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { formatDateTimeInTimezone } from "@/lib/timezone";
import { useIsMobile } from "@/hooks/use-mobile";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type View = "files" | "instructions" | "activity" | "settings" | "credentials";
type FileDirection = "all" | "inbox" | "outbox";
type QueryResult = { rows: HttpsEvent[]; total: number; timezone: string };
const PAGE_SIZE = 25;
const apiBase = (projectId: number) => `/api/projects/${projectId}/file-transfers/https`;
const messageOf = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Please try again.";

async function jsonRequest<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.message || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}
function buildFilters(direction: FileDirection, status: string, search: string, from: string, to: string, offset: number) {
  const params = new URLSearchParams({ direction, limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  return params.toString();
}
function allMatchingFilters(query: string) {
  const params = new URLSearchParams(query);
  params.delete("limit");
  params.delete("offset");
  return params.toString();
}
function statusStyle(status: string) {
  if (["processed", "acknowledged", "received"].includes(status)) return "border-emerald-700/20 bg-emerald-50 text-emerald-800";
  if (["failed", "partial", "rejected", "expired"].includes(status)) return "border-destructive/30 bg-destructive/5 text-destructive";
  if (["pending", "processing", "available", "uploaded"].includes(status)) return "border-amber-700/20 bg-amber-50 text-amber-900";
  return "";
}
function StatusPill({ status }: { status: string }) {
  return <Badge variant="outline" className={`capitalize ${statusStyle(status)}`}>{status}</Badge>;
}
function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}

function CustomerInstructions({ context, origin }: { context: HttpsContext; origin: string }) {
  const { toast } = useToast();
  const endpoint = `${origin}${context.apiPath}`;
  const printedPage = () => {
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>MeterFlo secure file exchange instructions</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:850px;margin:36px auto;padding:0 24px;color:#18333d}h1,h2{color:#123b48}code,pre{background:#edf3f4;border-radius:4px;padding:2px 4px}pre{padding:14px;white-space:pre-wrap;word-break:break-word}.callout{border-left:4px solid #25836e;padding:10px 14px;background:#eff7f3}@media print{body{margin:0}}</style></head><body><h1>MeterFlo secure file exchange</h1><p>Project-specific customer API endpoint: <code>${escapeHtml(endpoint)}</code></p><p>Customer tokens are project-scoped bearer credentials; do not place a token in a URL. Store it in an environment variable and send it only over HTTPS.</p><div class="callout"><strong>Uploads:</strong> PUT a binary file to <code>/inbox/{URL-encoded-file-name}</code> with Authorization: Bearer, a unique Idempotency-Key (8–128 characters), and Content-Type: application/octet-stream. Supported: CSV, XLS, XLSX, JSON; maximum ${context.maxUploadMB} MB. Repeating the same key, filename, and bytes returns the original file; reusing the key with different content returns 409. X-Content-SHA256 is optional.</div><h2>Check incoming processing</h2><p>GET <code>/inbox</code> to list uploads, then GET <code>/inbox/{fileId}</code> for processing status. Incoming files are processed by this project’s enabled Import configuration(s) using source HTTPS. Configure the filename pattern, mapping, and schedule in Imports.</p><h2>Download outgoing files</h2><p>GET <code>/outbox</code> to list available files, then GET <code>/outbox/{fileId}/download</code>. POST <code>/outbox/{fileId}/ack</code> only after the download has completed successfully. Configure an HTTPS outbox destination in Exports.</p><h2>cURL example</h2><pre>export METERFLO_TOKEN="&lt;PROJECT_TOKEN&gt;"\nexport METERFLO_API="${escapeHtml(endpoint)}"\ncurl -X PUT "$METERFLO_API/inbox/work-orders.csv" \\\\\n  -H "Authorization: Bearer $METERFLO_TOKEN" \\\\\n  -H "Content-Type: application/octet-stream" \\\\\n  -H "Idempotency-Key: $(uuidgen)" \\\\\n  --data-binary @work-orders.csv\ncurl -H "Authorization: Bearer $METERFLO_TOKEN" "$METERFLO_API/inbox"</pre><h2>PowerShell example</h2><pre>$env:METERFLO_TOKEN = "&lt;PROJECT_TOKEN&gt;"\n$api = "${escapeHtml(endpoint)}"\n$headers = @{ Authorization = "Bearer $env:METERFLO_TOKEN"; "Idempotency-Key" = [guid]::NewGuid().ToString() }\nInvoke-WebRequest -Method Put -Uri "$api/inbox/work-orders.csv" -Headers $headers -ContentType "application/octet-stream" -InFile ".\\\\work-orders.csv"\nInvoke-RestMethod -Uri "$api/inbox" -Headers @{ Authorization = "Bearer $env:METERFLO_TOKEN" }\n# Outbox: download first, then acknowledge only after the file is saved successfully.</pre><p>Never share Replit workspace SSH credentials. Customer tokens are shown once when created or rotated.</p></body></html>`;
    const win = window.open("", "_blank");
    if (!win) return toast({ title: "Could not open print view", description: "Allow pop-ups for this app and try again.", variant: "destructive" });
    win.document.open(); win.document.write(html); win.document.close(); win.focus(); win.print();
  };
  const curl = `export METERFLO_TOKEN="<PROJECT_TOKEN>"\nexport METERFLO_API="${endpoint}"\ncurl -X PUT "$METERFLO_API/inbox/work-orders.csv" \\\n  -H "Authorization: Bearer $METERFLO_TOKEN" \\\n  -H "Content-Type: application/octet-stream" \\\n  -H "Idempotency-Key: $(uuidgen)" \\\n  --data-binary @work-orders.csv\ncurl -H "Authorization: Bearer $METERFLO_TOKEN" "$METERFLO_API/inbox"`;
  const powershell = `$env:METERFLO_TOKEN = "<PROJECT_TOKEN>"\n$api = "${endpoint}"\n$headers = @{ Authorization = "Bearer $env:METERFLO_TOKEN"; "Idempotency-Key" = [guid]::NewGuid().ToString() }\nInvoke-WebRequest -Method Put -Uri "$api/inbox/work-orders.csv" -Headers $headers -ContentType "application/octet-stream" -InFile ".\\work-orders.csv"\nInvoke-RestMethod -Uri "$api/inbox" -Headers @{ Authorization = "Bearer $env:METERFLO_TOKEN" }\n# For outbox files: download successfully, then POST /outbox/{fileId}/ack.`;
  const copy = async (text: string, label: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: `${label} copied` }); }
    catch { toast({ title: "Copy failed", description: "Clipboard access is unavailable. Select and copy the text instead.", variant: "destructive" }); }
  };
  return <div className="space-y-3">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-base font-semibold">Customer instructions</h2><p className="mt-1 text-sm text-muted-foreground">Share the HTTPS endpoint and examples with a project customer. Tokens are never included in these instructions.</p></div><Button variant="outline" size="sm" onClick={printedPage}><Printer className="mr-1.5 h-4 w-4" />Print instructions</Button></div>
    {!context.settings.enabled && <div className="rounded-md border border-amber-700/20 bg-amber-50/70 p-3 text-sm text-amber-950">HTTPS Exchange is currently disabled. Enable and test storage in Settings before sharing this endpoint.</div>}
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Project endpoint</CardTitle><CardDescription>Use the current app origin; it updates automatically for this installation.</CardDescription></CardHeader><CardContent><code className="block break-all rounded bg-muted px-3 py-2 text-sm">{endpoint}</code><p className="mt-2 text-xs text-muted-foreground">The project API path is project-scoped. Tokens are bearer credentials and must not be placed in URLs.</p></CardContent></Card>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ArrowDownToLine className="h-4 w-4 text-primary" />Customer uploads</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>PUT a binary file to <code>/inbox/{`{URL-encoded-file-name}`}</code>. Use the existing Import configuration with source <strong>HTTPS</strong> to process inbound files; configure its filename pattern, mapping, and schedule in Imports. A retried file is marked received for the next matching manual or scheduled import; retry does not force an immediate import.</p><ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground"><li>CSV, XLS, XLSX, or JSON; up to {context.maxUploadMB} MB.</li><li>Send <code>Content-Type: application/octet-stream</code>, bearer authorization, and a unique 8–128 character <code>Idempotency-Key</code>.</li><li>Same key + filename + bytes returns the original file ID on retry; changed content with the same key returns 409.</li><li>Optional <code>X-Content-SHA256</code> is verified when supplied.</li><li>GET <code>/inbox</code> to list files and GET <code>/inbox/{`{fileId}`}</code> to check processing.</li></ul></CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><ArrowUpFromLine className="h-4 w-4 text-primary" />Customer downloads</CardTitle></CardHeader><CardContent className="space-y-2 text-sm"><p>Configure an <strong>HTTPS outbox</strong> destination in Exports. Customers GET <code>/outbox</code>, then GET <code>/outbox/{`{fileId}`}/download</code>.</p><p className="rounded border border-amber-700/20 bg-amber-50/70 p-2 text-xs text-amber-950">Acknowledge only after the download succeeds: POST <code>/outbox/{`{fileId}`}/ack</code>. Acknowledgement makes the file eligible for retention cleanup.</p></CardContent></Card>
    </div>
    <div className="grid gap-3 lg:grid-cols-2">
      <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm">cURL · upload example</CardTitle><Button size="sm" variant="outline" onClick={() => copy(curl, "cURL example")}><Clipboard className="mr-1 h-3.5 w-3.5" />Copy</Button></CardHeader><CardContent><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{curl}</pre></CardContent></Card>
      <Card><CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2"><CardTitle className="text-sm">PowerShell · upload example</CardTitle><Button size="sm" variant="outline" onClick={() => copy(powershell, "PowerShell example")}><Clipboard className="mr-1 h-3.5 w-3.5" />Copy</Button></CardHeader><CardContent><pre className="overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">{powershell}</pre></CardContent></Card>
    </div>
    <div className="rounded-md border border-amber-700/20 bg-amber-50/70 p-3 text-xs leading-relaxed text-amber-950"><ShieldCheck className="mr-1 inline h-4 w-4" /><strong>TLS is required in every environment, including tests.</strong> On standalone Windows/Linux, terminate HTTPS with a valid reverse-proxy certificate and forward the original HTTPS protocol so MeterFlo recognizes the secure request. Never send tokens over plain HTTP. Use the project token from Credentials as an environment variable; never paste a real token into a URL, printed instructions, or shared examples.</div>
  </div>;
}

function SettingsPanel({ context, projectId, onSaved }: { context: HttpsContext; projectId: number; onSaved: () => Promise<void> }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(context.settings.enabled);
  const [location, setLocation] = useState(context.settings.location);
  const [retentionDays, setRetentionDays] = useState(String(context.settings.retentionDays));
  useEffect(() => { setEnabled(context.settings.enabled); setLocation(context.settings.location); setRetentionDays(String(context.settings.retentionDays)); }, [context.settings.enabled, context.settings.location, context.settings.retentionDays]);
  const save = useMutation({
    mutationFn: () => jsonRequest<HttpsContext>("PUT", `${apiBase(projectId)}/settings`, { enabled, location: location.trim(), retentionDays: Number(retentionDays) }),
    onSuccess: async result => { await onSaved(); toast({ title: result.settings.enabled ? "HTTPS Exchange enabled" : "HTTPS Exchange settings saved", description: result.storage.message }); },
    onError: error => toast({ title: "Could not save HTTPS Exchange settings", description: messageOf(error), variant: "destructive" }),
  });
  const providerName = context.settings.provider === "app_storage" ? "Replit App Storage" : "Local server storage";
  const locationLabel = context.settings.provider === "app_storage" ? "Private bucket ID" : "Private absolute server path";
  return <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr]">
    <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><Settings2 className="h-4 w-4 text-primary" />HTTPS Exchange settings</CardTitle><CardDescription>Storage and retention for this project’s customer files.</CardDescription></CardHeader><CardContent className="space-y-4">
      <div className={`rounded-md border p-3 text-sm ${context.storage.available ? "border-emerald-700/20 bg-emerald-50/60 text-emerald-900" : "border-amber-700/20 bg-amber-50/70 text-amber-950"}`}><span className="font-medium">{context.storage.available ? "Storage available" : "Storage needs setup"}</span><p className="mt-1 text-xs">{context.storage.message}</p></div>
      <div className="space-y-1.5"><Label>Storage provider</Label><div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{providerName} <span className="ml-1 text-xs text-muted-foreground">(selected by this installation)</span></div><p className="text-xs leading-relaxed text-muted-foreground">{context.settings.provider === "app_storage" ? "Replit uses private App Storage. Keep the existing/default bucket or enter a bucket ID supplied by your administrator. Access is not confirmed until the storage check succeeds." : "Standalone Windows/Linux uses a private local directory. Leave the location blank to use this installation’s default directory."}</p></div>
      <div className="space-y-1.5"><Label htmlFor="https-location">{locationLabel}</Label><Input id="https-location" value={location} onChange={event => setLocation(event.target.value)} maxLength={500} placeholder={context.settings.provider === "app_storage" ? "Blank uses the platform default bucket" : "Blank uses the platform default directory"} /><p className="text-xs text-muted-foreground">Optional. Keep this storage private; paths and buckets are configured server-side, not in a customer browser.</p></div>
      <div className="space-y-1.5"><Label htmlFor="https-retention">Retention period (days)</Label><Input id="https-retention" type="number" min={1} max={3650} value={retentionDays} onChange={event => setRetentionDays(event.target.value)} /></div>
      <label className="flex items-center justify-between gap-3 rounded-md border p-3"><span><span className="block text-sm font-medium">Enable HTTPS Exchange</span><span className="text-xs text-muted-foreground">Saving enabled tests storage before turning customer access on.</span></span><Switch checked={enabled} onCheckedChange={setEnabled} aria-label="Enable HTTPS Exchange" /></label>
      <div className="flex justify-end"><Button onClick={() => save.mutate()} disabled={save.isPending || !context.canManage || !Number.isInteger(Number(retentionDays)) || Number(retentionDays) < 1 || Number(retentionDays) > 3650}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save and test storage</Button></div>
    </CardContent></Card>
    <Card className="h-fit"><CardHeader className="pb-2"><CardTitle className="text-base">Retention behavior</CardTitle></CardHeader><CardContent className="space-y-2 text-sm text-muted-foreground"><p>Processed inbox files and acknowledged outbox files automatically expire after {context.settings.retentionDays} days.</p><p>Pending, failed, and unacknowledged files are retained until they are resolved or removed.</p><p>Storage configuration is independent per installation: Replit uses private App Storage; standalone Windows/Linux uses a private local directory.</p></CardContent></Card>
  </div>;
}

function CredentialManager({ context, projectId, onChanged }: { context: HttpsContext; projectId: number; onChanged: () => Promise<void> }) {
  const { toast } = useToast();
  const [name, setName] = useState(""); const [canUpload, setCanUpload] = useState(true); const [canDownload, setCanDownload] = useState(false); const [expiresInDays, setExpiresInDays] = useState("90");
  const [tokenDialog, setTokenDialog] = useState<{ token: string; title: string } | null>(null);
  const [tokenCopied, setTokenCopied] = useState(false);
  const create = useMutation({
    mutationFn: () => jsonRequest<{ credential: HttpsCredential; token: string }>("POST", `${apiBase(projectId)}/credentials`, { name: name.trim(), canUpload, canDownload, expiresInDays: Number(expiresInDays) }),
    onSuccess: async result => { setName(""); setCanUpload(true); setCanDownload(false); setExpiresInDays("90"); setTokenCopied(false); setTokenDialog({ token: result.token, title: "Credential created — save this token now" }); await onChanged(); },
    onError: error => toast({ title: "Could not create credential", description: messageOf(error), variant: "destructive" }),
  });
  const rotate = useMutation({
    mutationFn: (id: string) => jsonRequest<{ credential: HttpsCredential; token: string }>("POST", `${apiBase(projectId)}/credentials/${encodeURIComponent(id)}/rotate`, { expiresInDays: 90 }),
    onSuccess: async result => { setTokenCopied(false); setTokenDialog({ token: result.token, title: "Credential rotated — save the new token now" }); await onChanged(); },
    onError: error => toast({ title: "Could not rotate credential", description: messageOf(error), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => jsonRequest<void>("POST", `${apiBase(projectId)}/credentials/${encodeURIComponent(id)}/revoke`, {}),
    onSuccess: async () => { await onChanged(); toast({ title: "Credential revoked" }); },
    onError: error => toast({ title: "Could not revoke credential", description: messageOf(error), variant: "destructive" }),
  });
  const copyToken = async () => {
    if (!tokenDialog) return;
    try { await navigator.clipboard.writeText(tokenDialog.token); setTokenCopied(true); toast({ title: "Token copied" }); }
    catch { toast({ title: "Copy failed", description: "Clipboard access is unavailable. Select and copy the token manually.", variant: "destructive" }); }
  };
  const closeToken = (open: boolean) => { if (!open) { setTokenDialog(null); setTokenCopied(false); } };
  const sorted = [...context.credentials].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return <div className="space-y-4">
    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><UserRoundPlus className="h-4 w-4 text-primary" />Create project credential</CardTitle><CardDescription>Project-scoped bearer token for customer API access. The token is displayed once; only its prefix is retained in this list.</CardDescription></CardHeader><CardContent><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_8rem_auto] lg:items-end">
      <div className="space-y-1"><Label htmlFor="https-credential-name">Credential name</Label><Input id="https-credential-name" value={name} onChange={event => setName(event.target.value)} maxLength={120} placeholder="Customer integration" /></div>
      <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={canUpload} onChange={event => setCanUpload(event.target.checked)} className="accent-primary" />Upload</label>
      <label className="flex h-10 items-center gap-2 rounded-md border px-3 text-sm"><input type="checkbox" checked={canDownload} onChange={event => setCanDownload(event.target.checked)} className="accent-primary" />Download</label>
      <div className="space-y-1"><Label htmlFor="https-credential-expiry">Expires in days</Label><Input id="https-credential-expiry" type="number" min={1} max={365} value={expiresInDays} onChange={event => setExpiresInDays(event.target.value)} /></div>
      <Button onClick={() => create.mutate()} disabled={!context.canManage || !name.trim() || (!canUpload && !canDownload) || create.isPending || Number(expiresInDays) < 1 || Number(expiresInDays) > 365}>{create.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <UserRoundPlus className="mr-2 h-4 w-4" />}Create token</Button>
    </div></CardContent></Card>
    {sorted.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Credential</TableHead><TableHead>Access</TableHead><TableHead>Status / expiry</TableHead><TableHead>Last used</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{sorted.map(credential => {
      const expired = Date.parse(credential.expiresAt) <= Date.now();
      const revoked = Boolean(credential.revokedAt);
      return <TableRow key={credential.id}><TableCell><div className="font-medium">{credential.name}</div><div className="font-mono text-xs text-muted-foreground">{credential.tokenPrefix}••••</div></TableCell><TableCell className="text-xs">{[credential.canUpload && "Upload", credential.canDownload && "Download"].filter(Boolean).join(" · ")}</TableCell><TableCell><StatusPill status={revoked ? "revoked" : expired ? "expired" : "active"} /><div className="mt-1 text-xs text-muted-foreground">Expires {formatDateTimeInTimezone(credential.expiresAt, context.timezone)}</div></TableCell><TableCell className="text-xs">{credential.lastUsedAt ? formatDateTimeInTimezone(credential.lastUsedAt, context.timezone) : "Never"}</TableCell><TableCell><div className="flex justify-end gap-1">{!revoked && !expired && <Button variant="outline" size="sm" onClick={() => { if (window.confirm(`Rotate “${credential.name}”? The current token will stop working immediately.`)) rotate.mutate(credential.id); }} disabled={rotate.isPending}><RotateCw className="mr-1 h-3.5 w-3.5" />Rotate</Button>}{!revoked && <Button variant="ghost" size="icon" aria-label={`Revoke ${credential.name}`} onClick={() => { if (window.confirm(`Revoke “${credential.name}”? Customer API access will stop immediately.`)) revoke.mutate(credential.id); }} disabled={revoke.isPending}><X className="h-4 w-4" /></Button>}</div></TableCell></TableRow>;
    })}</TableBody></Table></div> : <div className="rounded-md border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">No customer credentials yet. Create a project-scoped token to start a customer integration.</div>}
    <Dialog open={!!tokenDialog} onOpenChange={closeToken}><DialogContent className="print:hidden sm:max-w-lg"><DialogHeader><DialogTitle>{tokenDialog?.title}</DialogTitle><DialogDescription>This secret is shown only now. Copy it to your customer’s secure secret store; it will not appear in MeterFlo again, and is never included in instructions, exports, or print views.</DialogDescription></DialogHeader><div className="rounded-md border bg-muted/50 p-3"><code className="block max-h-28 overflow-auto break-all text-sm">{tokenDialog?.token}</code></div><DialogFooter><Button variant="outline" onClick={() => closeToken(false)}>Close and clear</Button><Button onClick={copyToken}><Clipboard className="mr-2 h-4 w-4" />{tokenCopied ? "Copied" : "Copy token"}</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

export function HttpsExchangeWorkspace({ projectId }: { projectId: number }) {
  const { toast } = useToast(); const isMobile = useIsMobile();
  const [view, setView] = useState<View>("files");
  const [direction, setDirection] = useState<FileDirection>("all"); const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [offset, setOffset] = useState(0);
  const contextKey = `${apiBase(projectId)}`;
  const contextQuery = useQuery<HttpsContext>({ queryKey: [contextKey], queryFn: () => jsonRequest("GET", contextKey), refetchInterval: view === "files" || view === "activity" ? 15_000 : false });
  const context = contextQuery.data;
  const filters = useMemo(() => buildFilters(direction, status, search, from, to, offset), [direction, status, search, from, to, offset]);
  const filesQuery = useQuery<HttpsFilePage>({ queryKey: [contextKey, "files", filters], queryFn: () => jsonRequest("GET", `${contextKey}/files?${filters}`), enabled: view === "files" });
  const eventFilters = useMemo(() => { const p = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) }); if (search.trim()) p.set("search", search.trim()); if (from) p.set("from", from); if (to) p.set("to", to); return p.toString(); }, [search, from, to, offset]);
  const eventsQuery = useQuery<QueryResult>({ queryKey: [contextKey, "events", eventFilters], queryFn: () => jsonRequest("GET", `${contextKey}/events?${eventFilters}`), enabled: view === "activity", refetchInterval: view === "activity" ? 15_000 : false });
  useEffect(() => { setOffset(0); }, [direction, status, search, from, to]);
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: [contextKey] }), queryClient.invalidateQueries({ queryKey: [contextKey, "files"] }), queryClient.invalidateQueries({ queryKey: [contextKey, "events"] })]); };
  const retry = useMutation({ mutationFn: (id: string) => jsonRequest<void>("POST", `${contextKey}/files/${encodeURIComponent(id)}/retry`, {}), onSuccess: async () => { await invalidate(); toast({ title: "Incoming file marked received", description: "The next matching manual or scheduled HTTPS import will pick it up; this does not force an immediate import." }); }, onError: error => toast({ title: "Could not retry file", description: messageOf(error), variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: string) => jsonRequest<void>("DELETE", `${contextKey}/files/${encodeURIComponent(id)}`), onSuccess: async () => { await invalidate(); toast({ title: "File removed" }); }, onError: error => toast({ title: "Could not remove file", description: messageOf(error), variant: "destructive" }) });
  const refresh = async () => { await Promise.all([contextQuery.refetch(), filesQuery.refetch(), eventsQuery.refetch()]); };
  const openAuthenticatedPrint = async (path: string, errorTitle: string) => {
    const win = window.open("", "_blank");
    if (!win) { toast({ title: "Could not open print view", description: "Allow pop-ups for this app and try again.", variant: "destructive" }); return; }
    try {
      const response = await apiRequest("GET", path);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Print view unavailable.");
      win.document.open(); win.document.write(await response.text()); win.document.close(); win.focus(); win.print();
    } catch (error) { win.close(); toast({ title: errorTitle, description: messageOf(error), variant: "destructive" }); }
  };
  const downloadCsv = async (path: string, filename: string, title: string) => {
    try {
      const response = await apiRequest("GET", path);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Export unavailable.");
      saveBlob(await response.blob(), filename);
    } catch (error) { toast({ title, description: messageOf(error), variant: "destructive" }); }
  };
  const filePage = filesQuery.data;
  if (contextQuery.isLoading) return <div className="space-y-3 p-4"><Skeleton className="h-14 w-full" /><Skeleton className="h-10 w-2/3" /><Skeleton className="h-48 w-full" /></div>;
  if (contextQuery.isError || !context) return <Card className="border-destructive/40"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">HTTPS Exchange could not load</p><p className="text-sm text-muted-foreground">{messageOf(contextQuery.error)}</p></div><Button variant="outline" onClick={() => contextQuery.refetch()}>Try again</Button></CardContent></Card>;
  const canManage = context.canManage;
  const views: { key: View; label: string }[] = [
    { key: "files", label: "Files" }, { key: "instructions", label: "Customer instructions" },
    ...(context.canImport || context.canExport ? [{ key: "activity" as View, label: "Activity" }] : []),
    ...(canManage ? [{ key: "settings" as View, label: "Settings" }, { key: "credentials" as View, label: "Credentials" }] : []),
  ];
  const timestamp = (date: string | null) => date ? formatDateTimeInTimezone(date, context.timezone) : "—";
  const allFileFilters = allMatchingFilters(filters);
  const allEventFilters = allMatchingFilters(eventFilters);
  const pagesTotal = Math.max(1, Math.ceil(((view === "files" ? filePage?.total : eventsQuery.data?.total) || 0) / PAGE_SIZE));
  const currentTotal = (view === "files" ? filePage?.total : eventsQuery.data?.total) || 0;
  return <section className="space-y-4" data-testid="https-exchange-workspace" data-screen-mode={isMobile ? "compact" : "full"}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" data-testid="https-exchange-subheader"><div><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><ShieldCheck className="h-4 w-4" />Customer file delivery</div><h2 className="text-xl font-semibold tracking-tight">HTTPS Exchange</h2><p className="mt-1 text-sm text-muted-foreground">Project-scoped customer uploads and secure outbound files.</p></div><InventoryMobileTools tab="https-exchange"><Button size="sm" variant="outline" onClick={refresh} disabled={contextQuery.isFetching || filesQuery.isFetching || eventsQuery.isFetching}><RefreshCw className={`mr-1.5 h-4 w-4 ${contextQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button></InventoryMobileTools></header>
    {isMobile ? <select aria-label="HTTPS Exchange section" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={view} onChange={event => setView(event.target.value as View)}>{views.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : <nav role="tablist" aria-label="HTTPS Exchange sections" className="flex max-w-full gap-1 overflow-x-auto border-b">{views.map(item => <button type="button" role="tab" aria-selected={view === item.key} key={item.key} onClick={() => setView(item.key)} className={`shrink-0 border-b-2 px-3 py-2.5 text-sm font-medium ${view === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}>{item.label}</button>)}</nav>}
    {view === "files" && <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Exchange files</h3><p className="text-xs text-muted-foreground">{context.settings.enabled ? "Service enabled" : "Service disabled"} · {context.settings.provider === "app_storage" ? "Replit App Storage" : "Local server storage"} · {context.settings.retentionDays}-day retention</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => downloadCsv(`${contextKey}/files/export.csv?${allFileFilters}`, `https-exchange-files-${new Date().toISOString().slice(0, 10)}.csv`, "File export failed")}><FileDown className="mr-1.5 h-4 w-4" />CSV</Button><Button size="sm" variant="outline" onClick={() => downloadCsv(`${contextKey}/files/export.xlsx?${allFileFilters}`, `https-exchange-files-${new Date().toISOString().slice(0, 10)}.xlsx`, "Excel export failed")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button><Button size="sm" variant="outline" onClick={() => openAuthenticatedPrint(`${contextKey}/files/print?${allFileFilters}`, "Could not open file print view")}><Printer className="mr-1.5 h-4 w-4" />Print</Button></div></div>
      <InventoryMobileTools tab="https-file-filters"><div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-2 lg:grid-cols-6"><div className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search files" type="search" autoComplete="off" placeholder="Search filename, credential, message" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div><select aria-label="Filter file direction" className="h-10 rounded-md border bg-background px-3 text-sm" value={direction} onChange={event => setDirection(event.target.value as FileDirection)}><option value="all">Inbox and outbox</option><option value="inbox">Incoming · inbox</option><option value="outbox">Outgoing · outbox</option></select><select aria-label="Filter file status" className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={event => setStatus(event.target.value)}><option value="">All statuses</option>{["pending", "processing", "processed", "received", "partial", "failed", "available", "acknowledged", "expired"].map(value => <option key={value}>{value}</option>)}</select><Input aria-label="Files created from" type="date" value={from} onChange={event => setFrom(event.target.value)} /><Input aria-label="Files created to" type="date" value={to} onChange={event => setTo(event.target.value)} /></div></InventoryMobileTools>
      {filesQuery.isLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : filesQuery.isError ? <Card className="border-destructive/40"><CardContent className="flex items-center justify-between gap-3 p-4"><p className="text-sm text-destructive">{messageOf(filesQuery.error)}</p><Button variant="outline" onClick={() => filesQuery.refetch()}>Retry</Button></CardContent></Card> : !filePage?.rows.length ? <div className="rounded-md border border-dashed px-4 py-10 text-center"><Activity className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">No matching exchange files</p><p className="mt-1 text-sm text-muted-foreground">Customer uploads and generated exports will appear here.</p></div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>File</TableHead><TableHead>Direction</TableHead><TableHead>Status</TableHead><TableHead>Size</TableHead><TableHead>Received / created</TableHead><TableHead>Updated</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{filePage.rows.map((file: HttpsFile) => <TableRow key={file.id}><TableCell className="max-w-56"><div className="truncate font-medium" title={file.fileName}>{file.fileName}</div><div className="truncate text-xs text-muted-foreground">{file.credentialName || file.message || file.sha256.slice(0, 12)}</div></TableCell><TableCell><Badge variant="secondary" className="capitalize">{file.direction === "inbox" ? "Incoming" : "Outgoing"}</Badge></TableCell><TableCell><StatusPill status={file.status} />{file.message && <p className="mt-1 max-w-56 truncate text-xs text-muted-foreground" title={file.message}>{file.message}</p>}</TableCell><TableCell className="whitespace-nowrap text-xs">{formatBytes(file.size)}</TableCell><TableCell className="whitespace-nowrap text-xs">{timestamp(file.createdAt)}</TableCell><TableCell className="whitespace-nowrap text-xs">{timestamp(file.processedAt || file.acknowledgedAt)}</TableCell><TableCell><div className="flex justify-end gap-1">{file.direction === "outbox" && context.canExport && !["expired", "deleted"].includes(file.status) && <Button size="icon" variant="outline" aria-label={`Download ${file.fileName}`} onClick={async () => { try { const response = await apiRequest("GET", `${contextKey}/files/${encodeURIComponent(file.id)}/download`); if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Download failed."); saveBlob(await response.blob(), file.fileName); } catch (error) { toast({ title: "Download failed", description: messageOf(error), variant: "destructive" }); } }}><Download className="h-4 w-4" /></Button>}{file.direction === "inbox" && ["failed", "partial"].includes(file.status) && context.canImport && <Button size="sm" variant="outline" onClick={() => retry.mutate(file.id)} disabled={retry.isPending}><RotateCw className="mr-1 h-3.5 w-3.5" />Retry</Button>}{context.canManage && <Button size="icon" variant="ghost" aria-label={`Remove ${file.fileName}`} onClick={() => { const pending = ["pending", "processing", "available", "uploaded"].includes(file.status); const prompt = pending ? `Remove “${file.fileName}”? This pending or unacknowledged file will be deleted from storage and cannot be restored.` : `Remove “${file.fileName}” from this project? The file bytes will be deleted.`; if (window.confirm(prompt)) remove.mutate(file.id); }} disabled={remove.isPending}><Trash2 className="h-4 w-4" /></Button>}</div></TableCell></TableRow>)}</TableBody></Table></div>}
      <Pagination offset={offset} total={currentTotal} pageSize={PAGE_SIZE} pagesTotal={pagesTotal} onOffset={setOffset} />
    </div>}
    {view === "instructions" && <CustomerInstructions context={context} origin={window.location.origin} />}
    {view === "activity" && <div className="space-y-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-semibold">Exchange activity</h3><p className="text-xs text-muted-foreground">Project-timezone audit events.</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => downloadCsv(`${contextKey}/events/export.csv?${allEventFilters}`, `https-exchange-events-${new Date().toISOString().slice(0, 10)}.csv`, "Activity export failed")}><FileDown className="mr-1.5 h-4 w-4" />CSV</Button><Button size="sm" variant="outline" onClick={() => downloadCsv(`${contextKey}/events/export.xlsx?${allEventFilters}`, `https-exchange-events-${new Date().toISOString().slice(0, 10)}.xlsx`, "Activity Excel export failed")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />Excel</Button><Button size="sm" variant="outline" onClick={() => openAuthenticatedPrint(`${contextKey}/events/print?${allEventFilters}`, "Could not open activity print view")}><Printer className="mr-1.5 h-4 w-4" />Print</Button></div></div>
      <InventoryMobileTools tab="https-event-filters"><div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-3"><div className="relative sm:col-span-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search activity" type="search" placeholder="Search files, credentials, event" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div><Input aria-label="Activity from" type="date" value={from} onChange={event => setFrom(event.target.value)} /><Input aria-label="Activity to" type="date" value={to} onChange={event => setTo(event.target.value)} /></div></InventoryMobileTools>
      {eventsQuery.isLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : eventsQuery.isError ? <Card className="border-destructive/40"><CardContent className="flex items-center justify-between gap-3 p-4"><p className="text-sm text-destructive">{messageOf(eventsQuery.error)}</p><Button variant="outline" onClick={() => eventsQuery.refetch()}>Retry</Button></CardContent></Card> : !eventsQuery.data?.rows.length ? <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">No matching exchange events.</div> : <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Action</TableHead><TableHead>File</TableHead><TableHead>Credential</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{eventsQuery.data.rows.map((event: HttpsEvent) => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs">{formatDateTimeInTimezone(event.createdAt, eventsQuery.data?.timezone || context.timezone)}</TableCell><TableCell className="font-medium">{event.action}</TableCell><TableCell className="max-w-48 truncate">{event.fileName || "—"}</TableCell><TableCell>{event.credentialName || "—"}</TableCell><TableCell className="max-w-72 text-xs text-muted-foreground">{event.message}</TableCell></TableRow>)}</TableBody></Table></div>}
      <Pagination offset={offset} total={currentTotal} pageSize={PAGE_SIZE} pagesTotal={pagesTotal} onOffset={setOffset} />
    </div>}
    {view === "settings" && canManage && <SettingsPanel context={context} projectId={projectId} onSaved={invalidate} />}
    {view === "credentials" && canManage && <CredentialManager context={context} projectId={projectId} onChanged={invalidate} />}
  </section>;
}

function Pagination({ offset, total, pageSize, pagesTotal, onOffset }: { offset: number; total: number; pageSize: number; pagesTotal: number; onOffset: (offset: number) => void }) {
  return <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{total} records · Page {Math.floor(offset / pageSize) + 1} of {pagesTotal}</span><div className="flex gap-2"><Button size="sm" variant="outline" disabled={!offset} onClick={() => onOffset(Math.max(0, offset - pageSize))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button size="sm" variant="outline" disabled={offset + pageSize >= total} onClick={() => onOffset(offset + pageSize)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>;
}
