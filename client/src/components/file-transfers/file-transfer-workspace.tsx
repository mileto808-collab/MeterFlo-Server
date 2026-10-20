import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cable, Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Download, FileClock, FileOutput, Loader2, Pencil, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTimezone } from "@/hooks/use-timezone";
import { formatDateTimeInTimezone } from "@/lib/timezone";
import { useIsMobile } from "@/hooks/use-mobile";
import { InventoryMobileTools } from "@/components/inventory-mobile-tools";
import { SftpConnectionHelp } from "@/components/file-transfers/sftp-connection-help";
import { HttpsExchangeWorkspace } from "@/components/file-transfers/https-exchange-workspace";
import { ProjectColumnGuide } from "@/components/file-transfers/project-column-guide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ExportConfig, ExportConfigInput, ExportSelection, SftpPublic, TransferContext, TransferHistory } from "@shared/file-transfers";
import type { ReactNode } from "react";

type Tab = "imports" | "exports" | "connection" | "https" | "history";
type HistoryResponse = { rows: TransferHistory[]; total: number; timezone: string };
const PAGE_SIZE = 25;
const base = (projectId: number) => `/api/projects/${projectId}/file-transfers`;
const defaultColumns = ["customerWoId", "status", "customerName", "address", "oldSystemId", "newSystemId", "updatedAt"];
const frequencies = ["manual", "every_15_minutes", "every_30_minutes", "hourly", "every_2_hours", "every_6_hours", "every_12_hours", "daily", "weekly", "monthly", "custom"];
const frequencyNames: Record<string, string> = { manual: "Manual only", every_15_minutes: "Every 15 minutes", every_30_minutes: "Every 30 minutes", hourly: "Hourly", every_2_hours: "Every 2 hours", every_6_hours: "Every 6 hours", every_12_hours: "Every 12 hours", daily: "Daily", weekly: "Weekly", monthly: "Monthly", custom: "Custom cron" };

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function err(error: unknown) { return error instanceof Error ? error.message : "Something went wrong. Try again."; }
function StatusBadge({ status }: { status: string }) {
  const cls = status === "success" ? "border-emerald-700/20 bg-emerald-50 text-emerald-800" : ["failed", "interrupted"].includes(status) ? "" : ["queued", "running"].includes(status) ? "border-amber-700/20 bg-amber-50 text-amber-900" : "";
  return <Badge variant={["failed", "interrupted"].includes(status) ? "destructive" : "outline"} className={cls}>{status}</Badge>;
}
function SectionHeading({ icon: Icon, title, description, action }: { icon: typeof Upload; title: string; description: string; action?: ReactNode }) {
  return <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-base font-semibold"><Icon className="h-4 w-4 text-primary" />{title}</h2><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{action}</div>;
}

type ConfigDraft = {
  name: string; format: "csv" | "xlsx" | "json"; filenameTemplate: string; columns: string[];
  destination: "local" | "sftp" | "https"; remoteDirectory: string; scheduleFrequency: ExportConfigInput["scheduleFrequency"]; customCronExpression: string;
  isEnabled: boolean; mode: "full" | "changed"; allStatuses: boolean; statusIds: number[]; subStatusIds: string[];
};
const blankDraft = (): ConfigDraft => ({ name: "", format: "csv", filenameTemplate: "work_orders_{YYYY}{MM}{DD}_{HH}{mm}{ss}_{runId}", columns: [], destination: "local", remoteDirectory: "", scheduleFrequency: "manual", customCronExpression: "", isEnabled: false, mode: "full", allStatuses: true, statusIds: [], subStatusIds: [] });
function fromConfig(config: ExportConfig): ConfigDraft {
  return { name: config.name, format: config.format, filenameTemplate: config.filenameTemplate, columns: config.columns, destination: config.destination, remoteDirectory: config.remoteDirectory, scheduleFrequency: config.scheduleFrequency, customCronExpression: config.customCronExpression || "", isEnabled: config.isEnabled, mode: config.mode, allStatuses: config.allStatuses, statusIds: config.statusIds, subStatusIds: config.subStatusIds };
}
function configInput(draft: ConfigDraft): ExportConfigInput {
  return { ...draft, customCronExpression: draft.scheduleFrequency === "custom" ? draft.customCronExpression.trim() || null : null };
}

function ExportEditor({ open, onOpenChange, initial, context, saving, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; initial: ExportConfig | null; context: TransferContext; saving: boolean; onSave: (input: ExportConfigInput) => void }) {
  const [draft, setDraft] = useState<ConfigDraft>(blankDraft);
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (!open) return;
    const next = initial ? fromConfig(initial) : blankDraft();
    next.columns = initial ? initial.columns : defaultColumns.filter(field => context.fields.includes(field));
    setDraft(next); setFormError("");
  }, [open, initial?.id]);
  const toggle = (field: string) => setDraft(old => ({ ...old, columns: old.columns.includes(field) ? old.columns.filter(item => item !== field) : [...old.columns, field] }));
  const submit = () => {
    if (!draft.name.trim()) return setFormError("Enter a configuration name.");
    if (!draft.columns.length) return setFormError("Choose at least one output column.");
    if (draft.destination === "sftp" && !draft.remoteDirectory.trim()) return setFormError("Enter the remote directory.");
    if (!draft.allStatuses && !draft.statusIds.length && !draft.subStatusIds.length) return setFormError("Choose at least one work-order status or sub-status, or select All.");
    if (draft.scheduleFrequency === "custom" && !draft.customCronExpression.trim()) return setFormError("Enter a custom cron expression.");
    setFormError(""); onSave(configInput(draft));
  };
  const selectParent = (id: number) => setDraft(old => ({ ...old, statusIds: old.statusIds.includes(id) ? old.statusIds.filter(x => x !== id) : [...old.statusIds, id], allStatuses: false }));
  const selectChild = (id: string) => setDraft(old => ({ ...old, subStatusIds: old.subStatusIds.includes(id) ? old.subStatusIds.filter(x => x !== id) : [...old.subStatusIds, id], allStatuses: false }));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{initial ? "Edit export configuration" : "New export configuration"}</DialogTitle><DialogDescription>Define the file, destination and default status selection. Project timezone: {context.timezone}.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Configuration name</Label><Input maxLength={150} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} /></div><div className="space-y-1.5"><Label>File format</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.format} onChange={e => setDraft({ ...draft, format: e.target.value as ConfigDraft["format"] })}><option value="csv">CSV</option><option value="xlsx">Excel workbook (XLSX)</option><option value="json">JSON</option></select></div></div>
      <div className="space-y-1.5"><Label>Filename template</Label><Input maxLength={180} value={draft.filenameTemplate} onChange={e => setDraft({ ...draft, filenameTemplate: e.target.value })} /><p className="text-xs text-muted-foreground">Date tokens: {"{YYYY} {MM} {DD} {HH} {mm} {ss} {runId}"}; the extension is added automatically. A run ID is appended if missing to prevent overwrites.</p></div>
      <div className="space-y-2"><Label>Output columns</Label><div className="grid gap-x-3 gap-y-1 rounded-md border p-3 sm:grid-cols-2">{context.fields.map(field => <label key={field} className="flex items-center gap-2 py-1 text-sm"><input type="checkbox" className="accent-primary" checked={draft.columns.includes(field)} onChange={() => toggle(field)} />{field}</label>)}</div></div>
      <ProjectColumnGuide mode="export" guide={context.columnGuide} />
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Destination</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.destination} onChange={e => setDraft({ ...draft, destination: e.target.value as ConfigDraft["destination"] })}><option value="local">Server local folder</option><option value="sftp" disabled={!context.connection}>SFTP {context.connection ? `— ${context.connection.name}` : "— configure connection first"}</option><option value="https">HTTPS outbox</option></select>{draft.destination === "https" && <p className="text-xs text-muted-foreground">Enable HTTPS Exchange in this project before running the export.</p>}</div>{draft.destination === "sftp" && <div className="space-y-1.5"><Label>Remote directory</Label><Input value={draft.remoteDirectory} maxLength={500} placeholder="/outbound/work-orders" onChange={e => setDraft({ ...draft, remoteDirectory: e.target.value })} /></div>}</div>
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label>Schedule frequency</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={draft.scheduleFrequency} onChange={e => setDraft({ ...draft, scheduleFrequency: e.target.value as ExportConfigInput["scheduleFrequency"] })}>{frequencies.map(value => <option key={value} value={value}>{frequencyNames[value]}</option>)}</select></div>{draft.scheduleFrequency === "custom" && <div className="space-y-1.5"><Label>Custom cron</Label><Input value={draft.customCronExpression} placeholder="0 3 * * 1-5" onChange={e => setDraft({ ...draft, customCronExpression: e.target.value })} /></div>}</div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border px-3 py-2"><div><p className="text-sm font-medium">Scheduled execution</p><p className="text-xs text-muted-foreground">Manual-frequency configs can still be run on demand.</p></div><Switch checked={draft.isEnabled} onCheckedChange={value => setDraft({ ...draft, isEnabled: value })} aria-label="Enable scheduled execution" /></div>
      <SelectionEditor context={context} value={draft} onChange={setDraft} selectParent={selectParent} selectChild={selectChild} heading="Saved default work-order selection" />
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{initial ? "Save changes" : "Create configuration"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function SelectionEditor({ context, value, onChange, selectParent, selectChild, heading = "Work-order selection" }: { context: TransferContext; value: Pick<ConfigDraft, "mode" | "allStatuses" | "statusIds" | "subStatusIds">; onChange: (next: any) => void; selectParent: (id: number) => void; selectChild: (id: string) => void; heading?: string }) {
  return <section className="space-y-2 rounded-md border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">{heading}</p><p className="text-xs text-muted-foreground">Parent and sub-status choices are combined (any selected).</p></div><div className="flex gap-1 rounded-md bg-muted p-1"><button type="button" onClick={() => onChange((old: any) => ({ ...old, mode: "full" }))} className={`rounded px-2 py-1 text-xs ${value.mode === "full" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Full export</button><button type="button" onClick={() => onChange((old: any) => ({ ...old, mode: "changed" }))} className={`rounded px-2 py-1 text-xs ${value.mode === "changed" ? "bg-background shadow-sm" : "text-muted-foreground"}`}>Changed since last</button></div></div>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={value.allStatuses} onChange={e => onChange((old: any) => ({ ...old, allStatuses: e.target.checked, statusIds: e.target.checked ? [] : old.statusIds, subStatusIds: e.target.checked ? [] : old.subStatusIds }))} />All statuses</label>
    {!value.allStatuses && <div className="grid gap-2 sm:grid-cols-2">{context.statuses.map(status => <div key={status.id} className="rounded border p-2"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="accent-primary" checked={value.statusIds.includes(status.id)} onChange={() => selectParent(status.id)} />{status.label}</label>{context.subStatuses.filter(child => child.parentStatusId === status.id).map(child => <label key={child.id} className="ml-5 mt-1 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" className="accent-primary" checked={value.subStatusIds.includes(child.id)} onChange={() => selectChild(child.id)} />{child.label}</label>)}</div>)}</div>}
  </section>;
}

function ConnectionSettings({ context, projectId, invalidate }: { context: TransferContext; projectId: number; invalidate: () => Promise<void> }) {
  const { toast } = useToast();
  const saved = context.connection;
  const [name, setName] = useState(""); const [host, setHost] = useState(""); const [port, setPort] = useState("22"); const [username, setUsername] = useState(""); const [fingerprint, setFingerprint] = useState(""); const [authType, setAuthType] = useState<"password" | "privateKey">("password");
  const [password, setPassword] = useState(""); const [privateKey, setPrivateKey] = useState(""); const [passphrase, setPassphrase] = useState("");
  const identityChanged = Boolean(saved && (host !== saved.host || Number(port) !== saved.port || username !== saved.username || fingerprint !== saved.hostFingerprint));
  useEffect(() => { setName(saved?.name || ""); setHost(saved?.host || ""); setPort(String(saved?.port || 22)); setUsername(saved?.username || ""); setFingerprint(saved?.hostFingerprint || ""); setAuthType(saved?.authType || "password"); setPassword(""); setPrivateKey(""); setPassphrase(""); }, [saved]);
  const save = useMutation({ mutationFn: (body: Record<string, unknown>) => request<SftpPublic>("PUT", `${base(projectId)}/connection`, body), onSuccess: async () => { await invalidate(); toast({ title: "SFTP connection saved" }); setPassword(""); setPrivateKey(""); setPassphrase(""); }, onError: e => toast({ title: "Could not save connection", description: err(e), variant: "destructive" }) });
  const test = useMutation({ mutationFn: () => request<{ success: boolean; message: string }>("POST", `${base(projectId)}/connection/test`), onSuccess: result => toast({ title: result.success ? "Connection verified" : "Connection failed", description: result.message, variant: result.success ? "default" : "destructive" }), onError: e => toast({ title: "Connection test failed", description: err(e), variant: "destructive" }) });
  const remove = useMutation({ mutationFn: () => request<void>("DELETE", `${base(projectId)}/connection`), onSuccess: async () => { await invalidate(); toast({ title: "SFTP connection removed" }); }, onError: e => toast({ title: "Could not remove connection", description: err(e), variant: "destructive" }) });
  const submit = () => {
    const body: Record<string, unknown> = { name, host, port: Number(port), username, hostFingerprint: fingerprint, authType };
    if (password.trim()) body.password = password;
    if (privateKey.trim()) body.privateKey = privateKey;
    if (passphrase.trim()) body.passphrase = passphrase;
    if ((!saved || saved.authType !== authType || identityChanged) && (authType === "password" ? !password.trim() : !privateKey.trim())) return toast({ title: "Credentials required", description: "Enter credentials for the selected authentication type.", variant: "destructive" });
    save.mutate(body);
  };
  return <div className="space-y-3">
    <SftpConnectionHelp />
    <div className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
    <Card><CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Cable className="h-4 w-4 text-primary" />Remote SFTP connection</CardTitle><CardDescription>MeterFlo connects to this remote server. Saved credentials are encrypted and never displayed again.</CardDescription></CardHeader><CardContent className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1"><Label>Connection name</Label><Input value={name} onChange={e => setName(e.target.value)} maxLength={150} /></div><div className="space-y-1"><Label>Remote host</Label><Input value={host} onChange={e => setHost(e.target.value)} placeholder="Enter the SFTP host supplied by your administrator" /></div><div className="space-y-1"><Label>Remote SSH port</Label><Input type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} /></div><div className="space-y-1"><Label>Project SFTP username</Label><Input value={username} onChange={e => setUsername(e.target.value)} /></div></div>
      <div className="space-y-1"><Label>SHA256 host fingerprint</Label><Input value={fingerprint} onChange={e => setFingerprint(e.target.value)} placeholder="SHA256:..." /><p className="text-xs text-muted-foreground">Required for secure host verification. Confirm it with your SFTP administrator.</p>{saved && <p className="text-xs text-amber-800">Changing host, port, username, or fingerprint requires re-entering credentials.</p>}</div>
      <div className="space-y-1"><Label>Authentication</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={authType} onChange={e => { setAuthType(e.target.value as typeof authType); setPassword(""); setPrivateKey(""); setPassphrase(""); }}><option value="password">Password</option><option value="privateKey">Private key</option></select></div>
      {authType === "password" ? <div className="space-y-1"><Label>Password {saved?.hasCredentials && <span className="text-muted-foreground">({identityChanged ? "required after connection identity change" : "blank keeps saved password"})</span>}</Label><Input type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} placeholder={saved?.hasCredentials && !identityChanged ? "Saved securely — enter only to change" : "Enter password"} /></div> : <><div className="space-y-1"><Label>Private key {saved?.hasCredentials && <span className="text-muted-foreground">({identityChanged ? "required after connection identity change" : "blank keeps saved key"})</span>}</Label><textarea className="min-h-28 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={privateKey} onChange={e => setPrivateKey(e.target.value)} placeholder={saved?.hasCredentials && !identityChanged ? "Saved securely — enter only to change" : "Paste private key"} /></div><div className="space-y-1"><Label>Key passphrase <span className="text-muted-foreground">(optional; blank keeps saved value unless credentials must be refreshed)</span></Label><Input type="password" autoComplete="new-password" value={passphrase} onChange={e => setPassphrase(e.target.value)} /></div></>}
      <div className="rounded-md border border-emerald-800/15 bg-emerald-50/60 p-3 text-xs text-emerald-950"><ShieldCheck className="mr-1 inline h-4 w-4" />Passwords, private keys and passphrases are stored encrypted. Secret fields are write-only; changing authentication type requires new credentials.</div>
      <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => test.mutate()} disabled={!saved || test.isPending}>{test.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}Test saved connection</Button>{saved && <Button variant="outline" onClick={() => { if (window.confirm("Remove the saved SFTP connection? Enabled SFTP schedules prevent removal.")) remove.mutate(); }} disabled={remove.isPending}><Trash2 className="mr-2 h-4 w-4" />Remove</Button>}<Button onClick={submit} disabled={save.isPending || !context.permissions.canManageConnection}>{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save connection</Button></div>
    </CardContent></Card>
    <Card className="h-fit"><CardHeader className="pb-2"><CardTitle className="text-base">Remote connection status</CardTitle></CardHeader><CardContent>{saved ? <div className="space-y-2 text-sm"><div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-600" />Configuration saved</div><p className="text-muted-foreground">{saved.name} · {saved.username}@{saved.host}:{saved.port}</p><p className="break-all font-mono text-xs text-muted-foreground">{saved.hostFingerprint}</p><p className="text-xs text-muted-foreground">{saved.hasCredentials ? "Credentials are present; values are hidden." : "No credentials saved yet."}</p></div> : <div className="rounded-md border border-dashed p-5 text-center"><Cable className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">No connection configured</p><p className="mt-1 text-xs text-muted-foreground">Save a verified remote host to enable SFTP imports and exports.</p></div>}</CardContent></Card>
    </div>
  </div>;
}

export function FileTransferWorkspace({ projectId, renderImports }: { projectId: number; renderImports: () => ReactNode }) {
  const { toast } = useToast(); const { formatDateTime } = useTimezone(); const isMobile = useIsMobile();
  const [tab, setTab] = useState<Tab>("imports"); const [editorOpen, setEditorOpen] = useState(false); const [editing, setEditing] = useState<ExportConfig | null>(null);
  const [runTarget, setRunTarget] = useState<ExportConfig | null>(null); const [runSelection, setRunSelection] = useState<ExportSelection>({ mode: "full", allStatuses: true, statusIds: [], subStatusIds: [] });
  const [direction, setDirection] = useState("all"); const [status, setStatus] = useState(""); const [search, setSearch] = useState(""); const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [offset, setOffset] = useState(0);
  const [expandedAttempts, setExpandedAttempts] = useState<Set<string>>(() => new Set());
  const prefix = base(projectId);
  const contextQuery = useQuery<TransferContext>({ queryKey: [prefix], queryFn: () => request("GET", prefix), refetchInterval: tab === "history" ? 12_000 : false });
  const context = contextQuery.data;
  const active = tab === "history";
  const params = useMemo(() => { const p = new URLSearchParams({ direction, offset: String(offset), limit: String(PAGE_SIZE) }); if (status) p.set("status", status); if (search.trim()) p.set("search", search.trim()); if (from) p.set("from", from); if (to) p.set("to", to); return p.toString(); }, [direction, offset, status, search, from, to]);
  const historyQuery = useQuery<HistoryResponse>({ queryKey: [prefix, "history", params], queryFn: () => request("GET", `${prefix}/history?${params}`), enabled: active, refetchInterval: active ? 12_000 : false });
  useEffect(() => setOffset(0), [direction, status, search, from, to]);
  const invalidate = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: [prefix] }), queryClient.invalidateQueries({ queryKey: [prefix, "history"] })]); };
  const create = useMutation({ mutationFn: (input: ExportConfigInput) => request<ExportConfig>("POST", `${prefix}/exports`, input), onSuccess: async () => { setEditorOpen(false); await invalidate(); toast({ title: "Export configuration created" }); }, onError: e => toast({ title: "Could not create export", description: err(e), variant: "destructive" }) });
  const update = useMutation({ mutationFn: ({ id, input }: { id: string; input: ExportConfigInput }) => request<ExportConfig>("PATCH", `${prefix}/exports/${encodeURIComponent(id)}`, input), onSuccess: async () => { setEditorOpen(false); setEditing(null); await invalidate(); toast({ title: "Export configuration updated" }); }, onError: e => toast({ title: "Could not update export", description: err(e), variant: "destructive" }) });
  const remove = useMutation({ mutationFn: (id: string) => request<void>("DELETE", `${prefix}/exports/${encodeURIComponent(id)}`), onSuccess: async () => { await invalidate(); toast({ title: "Export disabled", description: "Run history is retained." }); }, onError: e => toast({ title: "Could not disable export", description: err(e), variant: "destructive" }) });
  const run = useMutation({ mutationFn: ({ id, selection }: { id: string; selection: ExportSelection }) => request<{ id: string; status: string }>("POST", `${prefix}/exports/${encodeURIComponent(id)}/run`, selection), onSuccess: async () => { setRunTarget(null); setTab("history"); await invalidate(); toast({ title: "Export queued", description: "The immutable file snapshot is being prepared." }); }, onError: e => toast({ title: "Could not queue export", description: err(e), variant: "destructive" }) });
  const action = useMutation({ mutationFn: ({ runId, type }: { runId: string; type: "retry" | "cancel" }) => request<void>("POST", `${prefix}/runs/${encodeURIComponent(runId)}/${type}`), onSuccess: async (_, vars) => { await invalidate(); toast({ title: vars.type === "retry" ? "Run queued for retry" : "Run cancelled" }); }, onError: e => toast({ title: "Run action failed", description: err(e), variant: "destructive" }) });
  const saveConfig = (input: ExportConfigInput) => editing ? update.mutate({ id: editing.id, input }) : create.mutate(input);
  const openRun = (config: ExportConfig) => { setRunTarget(config); setRunSelection({ mode: config.mode, allStatuses: config.allStatuses, statusIds: config.statusIds, subStatusIds: config.subStatusIds }); };
  const downloadRun = async (runId: string) => {
    try {
      const response = await apiRequest("GET", `${prefix}/runs/${encodeURIComponent(runId)}/download`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not download this export.");
      const blob = await response.blob(); const disp = response.headers.get("content-disposition") || ""; const file = disp.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i)?.[1]?.replaceAll('"', "") || `export-${runId}`;
      const url = URL.createObjectURL(blob); const anchor = document.createElement("a"); anchor.href = url; anchor.download = decodeURIComponent(file); anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast({ title: "Download failed", description: err(e), variant: "destructive" }); }
  };
  const exportHistory = async () => {
    try {
      const query = new URLSearchParams(params); query.delete("offset"); query.delete("limit");
      const response = await apiRequest("GET", `${prefix}/history/export?${query.toString()}`);
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).message || "Could not export history.");
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `file-transfer-history-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { toast({ title: "History export failed", description: err(e), variant: "destructive" }); }
  };
  const available: { key: Tab; label: string; icon: typeof Upload; enabled: boolean }[] = [
    { key: "imports", label: "Imports", icon: ArrowDownToLine, enabled: !!context?.permissions.canImport },
    { key: "exports", label: "Exports", icon: ArrowUpFromLine, enabled: !!context?.permissions.canExport },
    { key: "connection", label: "SFTP Connections", icon: Cable, enabled: !!context?.permissions.canManageConnection },
    { key: "https", label: "HTTPS Exchange", icon: ShieldCheck, enabled: !!(context?.permissions.canImport || context?.permissions.canExport || context?.permissions.canManageHttps) },
    { key: "history", label: "History", icon: FileClock, enabled: !!(context?.permissions.canImport || context?.permissions.canExport) },
  ];
  useEffect(() => { if (context && !available.some(item => item.key === tab && item.enabled)) setTab(available.find(item => item.enabled)?.key || "imports"); }, [context]);
  const refresh = async () => { await Promise.all([contextQuery.refetch(), historyQuery.refetch()]); };
  const rows = historyQuery.data?.rows || [];
  if (contextQuery.isLoading) return <div className="space-y-4 p-4"><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-3/4" /><Skeleton className="h-64 w-full" /></div>;
  if (contextQuery.isError || !context) return <Card className="m-4 border-destructive/40"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><div><p className="font-medium">File transfer workspace could not load</p><p className="text-sm text-muted-foreground">{err(contextQuery.error)}</p></div><Button variant="outline" onClick={() => contextQuery.refetch()}>Try again</Button></CardContent></Card>;
  return <main className="space-y-4 p-3 sm:p-5" data-testid="file-transfer-workspace" data-screen-mode={isMobile ? "compact" : "full"}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" data-testid="file-transfer-subheader"><div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><FileOutput className="h-4 w-4" />Project operations</div><h1 className="text-xl font-semibold tracking-tight sm:text-2xl">File Import/Export</h1><p className="mt-1 text-sm text-muted-foreground">Work-order delivery and processing evidence · {context.timezone}</p></div><InventoryMobileTools tab="file-transfers"><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={refresh} disabled={contextQuery.isFetching || historyQuery.isFetching}><RefreshCw className={`mr-1.5 h-4 w-4 ${contextQuery.isFetching || historyQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button>{tab === "history" && <Button type="button" variant="outline" size="sm" onClick={exportHistory}><Download className="mr-1.5 h-4 w-4" />Export CSV</Button>}</div></InventoryMobileTools></header>
    {isMobile ? <select aria-label="File transfer section" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={tab} onChange={e => setTab(e.target.value as Tab)}>{available.filter(x => x.enabled).map(x => <option key={x.key} value={x.key}>{x.label}</option>)}</select> : <nav role="tablist" aria-label="File transfer sections" className="flex max-w-full gap-1 overflow-x-auto border-b">{available.filter(x => x.enabled).map(item => { const Icon = item.icon; return <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} onClick={() => setTab(item.key)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${tab === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>}
    {tab === "imports" && context.permissions.canImport && <section role="tabpanel">{renderImports()}</section>}
    {tab === "exports" && context.permissions.canExport && <section role="tabpanel" className="space-y-3"><SectionHeading icon={ArrowUpFromLine} title="Export configurations" description="Create repeatable, auditable work-order deliveries." action={<Button size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="mr-1.5 h-4 w-4" />New export</Button>} />
      <div className="grid gap-3">{context.exports.length ? context.exports.map(config => <Card key={config.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{config.name}</h3><Badge variant={config.isEnabled ? "default" : "outline"}>{config.isEnabled ? "Scheduled on" : "Paused"}</Badge><Badge variant="secondary">{config.format.toUpperCase()}</Badge></div><p className="mt-1 truncate text-sm text-muted-foreground">{config.destination === "sftp" ? `SFTP · ${config.remoteDirectory}` : config.destination === "https" ? "HTTPS outbox" : "Server folder"} · {frequencyNames[config.scheduleFrequency] || config.scheduleFrequency} · {config.columns.length} columns</p><p className="mt-1 text-xs text-muted-foreground">Last run: {config.lastRunAt ? formatDateTime(config.lastRunAt) : "Never"}{config.lastRunStatus ? ` · ${config.lastRunStatus}` : ""}{config.lastRunMessage ? ` · ${config.lastRunMessage}` : ""}</p></div><div className="flex flex-wrap gap-2"><Button size="sm" onClick={() => openRun(config)}><Play className="mr-1.5 h-4 w-4" />Run now</Button><Button size="sm" variant="outline" onClick={() => { setEditing(config); setEditorOpen(true); }}><Pencil className="mr-1.5 h-4 w-4" />Edit</Button><Button size="icon" variant="outline" aria-label={`Disable ${config.name}`} onClick={() => { if (window.confirm(`Disable export configuration “${config.name}”? Run history will be retained.`)) remove.mutate(config.id); }} disabled={remove.isPending}><Trash2 className="h-4 w-4" /></Button></div></CardContent></Card>) : <div className="rounded-md border border-dashed px-4 py-12 text-center"><FileOutput className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No exports configured</p><p className="mt-1 text-sm text-muted-foreground">Create an export to deliver work-order files to a local folder, SFTP, or HTTPS outbox.</p><Button className="mt-4" size="sm" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus className="mr-1 h-4 w-4" />Create first export</Button></div>}</div>
      {context.exports.some(x => x.lastRunStatus === "failed") && <p className="text-xs text-muted-foreground">A failed pending run must be retried or cancelled before another run can be created for that configuration.</p>}
    </section>}
    {tab === "connection" && context.permissions.canManageConnection && <ConnectionSettings context={context} projectId={projectId} invalidate={invalidate} />}
    {tab === "https" && <HttpsExchangeWorkspace projectId={projectId} />}
    {tab === "history" && <section role="tabpanel" className="space-y-3"><SectionHeading icon={FileClock} title="Transfer history" description="A delivery record for each import and export, including failures." />
      <InventoryMobileTools tab="transfer-history"><div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-2 lg:grid-cols-6"><div className="relative lg:col-span-2"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search transfer history" type="search" placeholder="Search file, configuration, message" value={search} onChange={e => setSearch(e.target.value)} className="pl-9" /></div><select aria-label="Filter direction" className="h-10 rounded-md border bg-background px-3 text-sm" value={direction} onChange={e => setDirection(e.target.value)}><option value="all">All transfers</option><option value="import">Imports</option><option value="export">Exports</option></select><select aria-label="Filter transfer status" className="h-10 rounded-md border bg-background px-3 text-sm" value={status} onChange={e => setStatus(e.target.value)}><option value="">All statuses</option>{["queued", "running", "success", "failed", "skipped", "interrupted", "cancelled"].map(s => <option key={s}>{s}</option>)}</select><Input aria-label="Created from" type="date" value={from} onChange={e => setFrom(e.target.value)} /><Input aria-label="Created to" type="date" value={to} onChange={e => setTo(e.target.value)} /></div></InventoryMobileTools>
      {historyQuery.isLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : historyQuery.isError ? <Card className="border-destructive/40"><CardContent className="flex items-center justify-between gap-3 p-4"><p className="text-sm text-destructive">{err(historyQuery.error)}</p><Button variant="outline" onClick={() => historyQuery.refetch()}>Retry</Button></CardContent></Card> : rows.length === 0 ? <div className="rounded-md border border-dashed px-4 py-12 text-center"><Clock3 className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No matching transfer records</p><p className="mt-1 text-sm text-muted-foreground">Completed and attempted deliveries will appear here.</p></div> : <>
        <div className="overflow-x-auto rounded-md border"><Table>
          <TableHeader><TableRow><TableHead>Transfer</TableHead><TableHead>File</TableHead><TableHead>Status</TableHead><TableHead>Records</TableHead><TableHead>Destination</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
          <TableBody>{rows.map(row => {
            const hasAttempts = row.direction === "export" && Boolean(row.attemptLog?.length);
            const expanded = expandedAttempts.has(row.id);
            return <Fragment key={row.id}>
              <TableRow>
                <TableCell><div className="font-medium">{row.configName}</div><div className="text-xs capitalize text-muted-foreground">{row.direction}{row.attempts > 1 ? ` · ${row.attempts} attempts` : ""}</div>{hasAttempts && <button type="button" aria-expanded={expanded} onClick={() => setExpandedAttempts(old => { const next = new Set(old); if (next.has(row.id)) next.delete(row.id); else next.add(row.id); return next; })} className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline">{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}Attempt log ({row.attemptLog!.length})</button>}</TableCell>
                <TableCell className="max-w-52"><div className="truncate">{row.fileName || "—"}</div>{row.message && <p className="max-w-64 truncate text-xs text-muted-foreground" title={row.message}>{row.message}</p>}</TableCell>
                <TableCell><StatusBadge status={row.status} /></TableCell>
                <TableCell>{row.recordCount}{row.recordsFailed ? <span className="text-xs text-destructive"> · {row.recordsFailed} failed</span> : null}</TableCell>
                <TableCell className="max-w-48 truncate text-xs">{row.destination || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">{formatDateTime(row.createdAt)}</TableCell>
                <TableCell><div className="flex justify-end gap-1">{row.direction === "export" && row.exportRunId && row.status === "success" && <Button size="icon" variant="outline" aria-label="Download generated file" onClick={() => downloadRun(row.exportRunId!)}><Download className="h-4 w-4" /></Button>}{row.direction === "export" && row.exportRunId && ["failed", "interrupted"].includes(row.status) && <Button size="sm" variant="outline" onClick={() => action.mutate({ runId: row.exportRunId!, type: "retry" })} disabled={action.isPending}><RefreshCw className="mr-1 h-3.5 w-3.5" />Retry</Button>}{row.direction === "export" && row.exportRunId && ["queued", "failed", "interrupted"].includes(row.status) && <Button size="icon" variant="ghost" aria-label="Cancel run" onClick={() => action.mutate({ runId: row.exportRunId!, type: "cancel" })} disabled={action.isPending}><X className="h-4 w-4" /></Button>}</div></TableCell>
              </TableRow>
              {hasAttempts && expanded && <TableRow><TableCell colSpan={7} className="bg-muted/30 px-4 py-3">
                <div className="space-y-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Export attempts · project time ({context.timezone})</p>
                  {row.attemptLog!.map((attempt, index) => <div key={`${row.id}-attempt-${index}`} className="grid gap-1 rounded border bg-background p-2 text-xs sm:grid-cols-[auto_1fr_1fr] sm:items-start">
                    <div className="flex items-center gap-2"><span className="font-medium">Attempt {index + 1}</span><StatusBadge status={attempt.status} /></div>
                    <div className="text-muted-foreground">Started {attempt.startedAt ? formatDateTimeInTimezone(attempt.startedAt, context.timezone) : "—"}{attempt.completedAt ? ` · Finished ${formatDateTimeInTimezone(attempt.completedAt, context.timezone)}` : ""}</div>
                    <p className="break-words text-muted-foreground">{attempt.message || "No additional detail."}</p>
                  </div>)}
                </div>
              </TableCell></TableRow>}
            </Fragment>;
          })}</TableBody>
        </Table></div>
        <div className="flex items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{historyQuery.data?.total || 0} records · Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil((historyQuery.data?.total || 0) / PAGE_SIZE))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= (historyQuery.data?.total || 0)} onClick={() => setOffset(offset + PAGE_SIZE)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
      </>}
    </section>}
    <ExportEditor open={editorOpen} onOpenChange={setEditorOpen} initial={editing} context={context} saving={create.isPending || update.isPending} onSave={saveConfig} />
    <Dialog open={!!runTarget} onOpenChange={open => !open && setRunTarget(null)}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>Run export · {runTarget?.name}</DialogTitle><DialogDescription>Choose the snapshot scope and work-order statuses for this delivery. This selection applies to this run only.</DialogDescription></DialogHeader><div className="space-y-3"><SelectionEditor context={context} value={runSelection} onChange={setRunSelection} selectParent={id => setRunSelection(old => ({ ...old, allStatuses: false, statusIds: old.statusIds.includes(id) ? old.statusIds.filter(x => x !== id) : [...old.statusIds, id] }))} selectChild={id => setRunSelection(old => ({ ...old, allStatuses: false, subStatusIds: old.subStatusIds.includes(id) ? old.subStatusIds.filter(x => x !== id) : [...old.subStatusIds, id] }))} />{!runSelection.allStatuses && !runSelection.statusIds.length && !runSelection.subStatusIds.length && <p role="alert" className="text-sm text-destructive">Choose at least one status or explicitly select All statuses.</p>}</div><DialogFooter><Button variant="outline" onClick={() => setRunTarget(null)}>Cancel</Button><Button disabled={run.isPending || (!runSelection.allStatuses && !runSelection.statusIds.length && !runSelection.subStatusIds.length)} onClick={() => runTarget && run.mutate({ id: runTarget.id, selection: runSelection })}>{run.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Queue export</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}
