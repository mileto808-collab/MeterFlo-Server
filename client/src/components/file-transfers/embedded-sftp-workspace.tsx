import { useEffect, useMemo, useState } from "react";
import { fromZonedTime } from "date-fns-tz";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, ArrowDownToLine, ArrowUpFromLine, Cable, ChevronLeft, ChevronRight, Clipboard, Download, FileClock, Loader2, Printer, RefreshCw, RotateCw, Search, ShieldCheck, UserRoundPlus, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatDateTimeInTimezone } from "@/lib/timezone";
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

type SftpAccount = { id: string; username: string; label: string; authType: "publicKey" | "password"; canUpload: boolean; canDownload: boolean; expiresAt: string; revokedAt: string | null; createdAt: string };
type ServerConfig = { enabled: boolean; host: string; port: number; publicHost: string; running: boolean; fingerprint: string | null; error: string | null };
type SftpContext = { supported: boolean; isAdmin: boolean; server: ServerConfig; accounts: SftpAccount[]; timezone: string;
  restoreReview?: { requiresReview: boolean; mode: string; retained: number; blocked: { username: string; reason: string }[]; message: string;
    accounts?: { username: string; projectId: number; projectName: string; projectActive: boolean; canUpload: boolean; canDownload: boolean; expiresAt: string; revokedAt: string | null; timezone: string }[] } | null };
type DeletePreview = { before: string; expectedCount: number; timezone: string; filters: { search: string; from: string; to: string; includeShared: boolean } };
type SftpEvent = { id: string; username: string; action: string; status: string; fileName: string | null; bytes: number | null; message: string | null; createdAt: string };
type EventsResponse = { rows: SftpEvent[]; total: number; timezone: string };
type View = "accounts" | "activity" | "instructions" | "settings";
const PAGE_SIZE = 25;
const apiBase = (projectId: number) => `/api/projects/${projectId}/file-transfers/sftp-server`;
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong. Try again.";

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const response = await apiRequest(method, url, body);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csvCell(value: unknown) {
  const text = String(value ?? "");
  return `"${(/^[\s]*[=+\-@]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
}
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] || char);
}
function stateOf(account: SftpAccount) {
  return account.revokedAt ? "revoked" : Date.parse(account.expiresAt) <= Date.now() ? "expired" : "active";
}

function AccountInstructions({ context, account, onCopy }: { context: SftpContext; account: SftpAccount; onCopy: (text: string) => void }) {
  const server = context.server;
  const hostname = server.publicHost.trim() || "PUBLIC_HOST_REQUIRED";
  const hostKey = server.fingerprint || "Fingerprint is not available until the server is running.";
  const instructionText = [
    `MeterFlo SFTP connection — ${account.label || account.username}`,
    `Host: ${hostname}`,
    `Port: ${server.port}`,
    `Username: ${account.username}`,
    `Authentication: ${account.authType === "publicKey" ? "Public key — use your private key; never upload or send it to MeterFlo." : "Password — obtain it separately through a secure channel."}`,
    `Permissions: ${account.canUpload ? "Upload enabled" : ""}${account.canUpload && account.canDownload ? " · " : ""}${account.canDownload ? "Download enabled" : ""}`,
    `Host key fingerprint (verify independently): ${hostKey}`,
    `Upload directory: ${account.canUpload ? "/incoming" : "Upload unavailable"}`,
    `Download directory: ${account.canDownload ? "/outgoing" : "Download unavailable"}`,
    `Expires (${context.timezone}): ${formatDateTimeInTimezone(account.expiresAt, context.timezone)}`,
  ].join("\n");
  const print = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.open();
    win.document.write(`<!doctype html><html><head><title>SFTP connection instructions</title><style>body{font:15px/1.55 system-ui,sans-serif;max-width:760px;margin:36px auto;padding:0 24px;color:#263e48}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f1f5f4;padding:16px;border:1px solid #dce5e2;border-radius:6px}.note{border-left:3px solid #a06b2e;padding:8px 12px;background:#fbf5e9}@media print{body{margin:0}}</style></head><body><h1>MeterFlo SFTP connection</h1><p>${escapeHtml(account.label || account.username)}</p><pre>${escapeHtml(instructionText)}</pre><p class="note">Verify the SHA256 fingerprint with your MeterFlo administrator using an independent channel. These instructions never include a password or private key.</p><p>Uploads must be CSV, XLS, XLSX, or JSON (maximum 25 MB) in /incoming. Final filenames or .filepart, .part and .tmp followed by final rename are supported, as are upload timestamps. Resume, overwrite, ownership and permission changes are not supported. Completed uploads appear in the real Project FTP Files/incoming folder; a matching LOCAL import processes them separately. The SFTP inbox is upload-only. /outgoing is read-only and exposes local exports and supported files deliberately published by an administrator in the real outgoing folder.</p></body></html>`);
    win.document.close(); win.focus(); win.print();
  };
  return <div className="flex flex-wrap gap-1">
    <Button size="sm" variant="outline" onClick={() => onCopy(instructionText)}><Clipboard className="mr-1.5 h-3.5 w-3.5" />Copy instructions</Button>
    <Button size="sm" variant="outline" onClick={print}><Printer className="mr-1.5 h-3.5 w-3.5" />Print</Button>
  </div>;
}

function CreateAccountDialog({ open, onOpenChange, onCreate, saving, timezone }: { open: boolean; onOpenChange: (open: boolean) => void; onCreate: (input: { username: string; label: string; authType: "publicKey" | "password"; publicKey?: string; password?: string; canUpload: boolean; canDownload: boolean; expiresAt: string }) => void; saving: boolean; timezone: string }) {
  const [username, setUsername] = useState("");
  const [label, setLabel] = useState("");
  const [authType, setAuthType] = useState<"publicKey" | "password">("publicKey");
  const [publicKey, setPublicKey] = useState("");
  const [password, setPassword] = useState("");
  const [canUpload, setCanUpload] = useState(true);
  const [canDownload, setCanDownload] = useState(false);
  const [expiryDate, setExpiryDate] = useState("");
  const [formError, setFormError] = useState("");
  useEffect(() => {
    if (open) {
      setUsername(""); setLabel(""); setAuthType("publicKey"); setPublicKey(""); setPassword("");
      setCanUpload(true); setCanDownload(false); setExpiryDate(""); setFormError("");
    }
  }, [open]);
  const submit = () => {
    if (!/^[a-zA-Z0-9_-]{3,64}$/.test(username)) return setFormError("Use 3–64 letters, numbers, underscores, or hyphens.");
    if (!canUpload && !canDownload) return setFormError("Choose upload access, download access, or both.");
    if (!expiryDate) return setFormError("Choose an expiry date.");
    const expiration = fromZonedTime(`${expiryDate}T23:59:59`, timezone);
    const days = (expiration.getTime() - Date.now()) / 86400000;
    if (!Number.isFinite(days) || days <= 0 || days > 365) return setFormError("Expiry must be in the future and within 365 days.");
    if (authType === "publicKey" && !/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/]+={0,3}(?:\s+.*)?$/.test(publicKey.trim())) return setFormError("Enter an Ed25519, RSA, or ECDSA OpenSSH public key.");
    if (authType === "password" && (password.length < 16 || password.length > 256)) return setFormError("Password must be 16–256 characters.");
    setFormError("");
    onCreate({ username: username.trim(), label: label.trim(), authType, ...(authType === "publicKey" ? { publicKey: publicKey.trim() } : { password }), canUpload, canDownload, expiresAt: expiration.toISOString() });
  };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>Create SFTP account</DialogTitle><DialogDescription>Credentials are write-only. Passwords and keys are never returned or shown again.</DialogDescription></DialogHeader>
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="sftp-username">Username</Label><Input id="sftp-username" autoComplete="off" value={username} onChange={event => setUsername(event.target.value)} maxLength={64} placeholder="partner_feed" /><p className="text-xs text-muted-foreground">3–64 letters, numbers, underscore, or hyphen; globally unique.</p></div><div className="space-y-1.5"><Label htmlFor="sftp-label">Label</Label><Input id="sftp-label" value={label} onChange={event => setLabel(event.target.value)} maxLength={120} placeholder="North depot feed" /></div></div>
      <div className="space-y-1.5"><Label>Authentication method</Label><select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={authType} onChange={event => { setAuthType(event.target.value as typeof authType); setPublicKey(""); setPassword(""); }}><option value="publicKey">OpenSSH public key</option><option value="password">Password</option></select></div>
      {authType === "publicKey" ? <div className="space-y-1.5"><Label htmlFor="sftp-public-key">Public key</Label><textarea id="sftp-public-key" autoComplete="off" spellCheck={false} className="min-h-24 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs" value={publicKey} onChange={event => setPublicKey(event.target.value)} placeholder="ssh-ed25519 AAAA… partner" /><p className="text-xs text-muted-foreground">Paste the customer’s public key only. Never enter a private key.</p></div> : <div className="space-y-1.5"><Label htmlFor="sftp-password">Password</Label><Input id="sftp-password" type="password" autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} minLength={16} maxLength={256} /><p className="text-xs text-muted-foreground">16–256 characters. It cannot be retrieved after creation.</p></div>}
      <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label>Folder permissions</Label><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={canUpload} onChange={event => setCanUpload(event.target.checked)} />Upload to /incoming</label><label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-primary" checked={canDownload} onChange={event => setCanDownload(event.target.checked)} />Download from /outgoing</label></div><div className="space-y-1.5"><Label htmlFor="sftp-expiry">Expires on</Label><Input id="sftp-expiry" type="date" min={new Date(Date.now() + 86400000).toISOString().slice(0, 10)} max={new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10)} value={expiryDate} onChange={event => setExpiryDate(event.target.value)} /><p className="text-xs text-muted-foreground">Required; maximum 365 days.</p></div></div>
      {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
    </div>
    <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create account</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ServerInstructions({ context, onUseHttps }: { context: SftpContext; onUseHttps: () => void }) {
  const { toast } = useToast();
  const server = context.server;
  const copy = async (value: string) => {
    try { await navigator.clipboard.writeText(value); toast({ title: "Fingerprint copied" }); }
    catch { toast({ title: "Copy failed", description: "Clipboard access is unavailable.", variant: "destructive" }); }
  };
  return <div className="space-y-4">
    {!context.supported && <Card className="border-amber-700/25 bg-amber-50/50"><CardContent className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-semibold text-amber-950">Built-in SFTP is unavailable on this platform</p><p className="mt-1 text-sm text-amber-900">The SSH listener runs only in standalone Windows/Linux deployments. Use HTTPS Exchange for this installation.</p></div><Button variant="outline" onClick={onUseHttps}><ShieldCheck className="mr-2 h-4 w-4" />Open HTTPS Exchange</Button></CardContent></Card>}
    <div className="grid gap-3 lg:grid-cols-[1.1fr_.9fr]">
      <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Cable className="h-4 w-4 text-primary" />Connection details</CardTitle><CardDescription>Account-specific instructions can be copied or printed from the Accounts list.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">
        <div className="grid gap-2 sm:grid-cols-2"><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Host</p><p className="mt-1 break-all font-mono">{server.publicHost || "Public host not configured"}</p></div><div className="rounded-md border bg-muted/30 p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Port</p><p className="mt-1 font-mono">{server.port}</p></div></div>
        <div className="rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">SSH host key · SHA256</p><div className="mt-1 flex flex-wrap items-start justify-between gap-2"><code className="break-all text-xs">{server.fingerprint || "Fingerprint appears when the listener is running."}</code>{server.fingerprint && <Button size="sm" variant="outline" onClick={() => copy(server.fingerprint!)}><Clipboard className="mr-1 h-3.5 w-3.5" />Copy</Button>}</div></div>
        <p className="text-xs leading-relaxed text-muted-foreground">Use the configured public host and port in FileZilla with protocol SFTP. Leave the default remote directory blank or use /, not a Windows path. Normal current-directory navigation stays inside the project’s virtual folders. Verify the SHA256 fingerprint independently with your administrator before connecting.</p>
      </CardContent></Card>
      <Card><CardHeader className="pb-2"><CardTitle className="text-base">Folder behavior</CardTitle><CardDescription>No shell or general-purpose file access is provided.</CardDescription></CardHeader><CardContent className="space-y-3 text-sm">
        <div className="rounded-md border border-emerald-700/20 bg-emerald-50/50 p-3"><p className="font-semibold text-emerald-950"><ArrowDownToLine className="mr-1.5 inline h-4 w-4" />/incoming · upload only</p><p className="mt-1 text-xs leading-relaxed text-emerald-950">CSV, XLS, XLSX, or JSON up to 25 MB. Final filenames or .filepart, .part and .tmp followed by rename are supported, including upload timestamps. Disable resume and permission/ownership changes. Existing files are never overwritten. Completed uploads enter the real Project FTP Files/incoming folder; a LOCAL import with a matching filename pattern processes them separately. Explorer and the web FTP Files page see the same files. The SFTP inbox intentionally lists no files.</p></div>
        <div className="rounded-md border border-sky-700/20 bg-sky-50/50 p-3"><p className="font-semibold text-sky-950"><ArrowUpFromLine className="mr-1.5 inline h-4 w-4" />/outgoing · read only</p><p className="mt-1 text-xs leading-relaxed text-sky-950">Maps to the real Project FTP Files/outgoing folder. New LOCAL exports are written here. Administrators may also publish supported files through Explorer or the web page's outgoing upload option. Existing generated LOCAL exports at the root remain available. Imports never scan outgoing; remote SFTP and HTTPS exports at the root are not exposed.</p></div>
      </CardContent></Card>
    </div>
    <div className="rounded-md border border-amber-700/20 bg-amber-50/60 p-3 text-xs leading-relaxed text-amber-950"><ShieldCheck className="mr-1 inline h-4 w-4" />Administrators must allow inbound traffic through the host firewall and protect web administration with TLS. On Windows, the MeterFlo service identity needs write access to its local incoming directory. HTTPS Exchange remains available as the cross-platform alternative.</div>
  </div>;
}

export function EmbeddedSftpWorkspace({ projectId, onUseHttps }: { projectId: number; onUseHttps: () => void }) {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [view, setView] = useState<View>("accounts");
  const [accountDialog, setAccountDialog] = useState(false);
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [offset, setOffset] = useState(0);
  const [enabled, setEnabled] = useState(false);
  const [host, setHost] = useState("0.0.0.0");
  const [port, setPort] = useState("2222");
  const [publicHost, setPublicHost] = useState("");
  const [restoreConfirmed, setRestoreConfirmed] = useState(false);
  const [deletePreview, setDeletePreview] = useState<DeletePreview | null>(null);
  const [includeShared, setIncludeShared] = useState(false);
  const key = apiBase(projectId);
  const contextQuery = useQuery<SftpContext>({ queryKey: [key], queryFn: () => request("GET", key), refetchInterval: view === "activity" ? 12000 : false });
  const context = contextQuery.data;
  const eventParams = useMemo(() => {
    const params = new URLSearchParams({ offset: String(offset), limit: String(PAGE_SIZE) });
    if (search.trim()) params.set("search", search.trim());
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    return params.toString();
  }, [offset, search, from, to]);
  const eventsQuery = useQuery<EventsResponse>({ queryKey: [key, "events", eventParams], queryFn: () => request("GET", `${key}/events?${eventParams}`), enabled: view === "activity", refetchInterval: view === "activity" ? 12000 : false });
  useEffect(() => { setOffset(0); }, [search, from, to]);
  useEffect(() => {
    if (!context) return;
    setEnabled(context.server.enabled); setHost(context.server.host || "0.0.0.0");
    setPort(String(context.server.port || 2222)); setPublicHost(context.server.publicHost || "");
  }, [context?.server.enabled, context?.server.host, context?.server.port, context?.server.publicHost]);
  const invalidate = async () => {
    await Promise.all([queryClient.invalidateQueries({ queryKey: [key] }), queryClient.invalidateQueries({ queryKey: [key, "events"] })]);
  };
  const saveServer = useMutation({
    mutationFn: () => request<SftpContext>("PUT", `${key}/server`, { enabled, host: host.trim() || "0.0.0.0", port: Number(port), publicHost: publicHost.trim(), confirmRestoreReview: restoreConfirmed }),
    onSuccess: async () => { await invalidate(); toast({ title: enabled ? "SFTP server configuration saved" : "SFTP server stopped" }); },
    onError: error => toast({ title: "Could not save SFTP server settings", description: errorMessage(error), variant: "destructive" }),
  });
  const restart = useMutation({
    mutationFn: () => request<void>("POST", `${key}/restart`, {}),
    onSuccess: async () => { await invalidate(); toast({ title: "SFTP server restart requested" }); },
    onError: error => toast({ title: "Could not restart SFTP server", description: errorMessage(error), variant: "destructive" }),
  });
  const createAccount = useMutation({
    mutationFn: (input: { username: string; label: string; authType: "publicKey" | "password"; publicKey?: string; password?: string; canUpload: boolean; canDownload: boolean; expiresAt: string }) => request<SftpAccount>("POST", `${key}/accounts`, input),
    onSuccess: async () => { setAccountDialog(false); await invalidate(); toast({ title: "SFTP account created", description: "Save any customer-provided credentials securely; MeterFlo will not display them again." }); },
    onError: error => toast({ title: "Could not create SFTP account", description: errorMessage(error), variant: "destructive" }),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => request<void>("DELETE", `${key}/accounts/${encodeURIComponent(id)}`),
    onSuccess: async () => { await invalidate(); toast({ title: "SFTP account revoked", description: "The account is disconnected immediately." }); },
    onError: error => toast({ title: "Could not revoke SFTP account", description: errorMessage(error), variant: "destructive" }),
  });
  const refresh = async () => { await Promise.all([contextQuery.refetch(), eventsQuery.refetch()]); };
  const previewDeletion = useMutation({
    mutationFn: () => request<DeletePreview>("GET", `${key}/events/delete-preview?${new URLSearchParams({ search: search.trim(), from, to, includeShared: String(includeShared) })}`),
    onSuccess: setDeletePreview,
    onError: error => toast({ title: "Could not preview log deletion", description: errorMessage(error), variant: "destructive" }),
  });
  const deleteLogs = useMutation({
    mutationFn: () => request<{ deleted: number }>("DELETE", `${key}/events`, { ...deletePreview, confirmed: true }),
    onSuccess: async result => { setDeletePreview(null); setOffset(0); await invalidate(); toast({ title: `${result.deleted} SFTP log entries deleted` }); },
    onError: error => { setDeletePreview(null); toast({ title: "Logs were not deleted", description: errorMessage(error), variant: "destructive" }); },
  });
  const copyText = async (text: string) => {
    try { await navigator.clipboard.writeText(text); toast({ title: "Instructions copied" }); }
    catch { toast({ title: "Copy failed", description: "Clipboard access is unavailable. Select and copy the instructions instead.", variant: "destructive" }); }
  };
  const exportReport = async (format: "csv" | "xls" | "pdf") => {
    try {
      const params = new URLSearchParams();
      params.set("report", "1");
      if (search.trim()) params.set("search", search.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const report = await request<EventsResponse>( "GET", `${key}/events?${params}`);
      const columns = ["username", "action", "status", "fileName", "bytes", "message", "createdAt"];
      const records = (report.rows || []).map(row => ({
        ...row, createdAt: formatDateTimeInTimezone(row.createdAt, report.timezone || context!.timezone),
      }));
      const date = new Date().toISOString().slice(0, 10);
      if (format === "csv") {
        saveBlob(new Blob([[columns.join(","), ...records.map(row => columns.map(column => csvCell(row[column as keyof SftpEvent])).join(","))].join("\r\n")], { type: "text/csv;charset=utf-8" }), `sftp-activity-${date}.csv`);
      } else if (format === "xls") {
        const XLSX = await import("xlsx");
        const sheet = XLSX.utils.json_to_sheet(records.map(row => Object.fromEntries(columns.map(column => [column, row[column as keyof SftpEvent]]))));
        const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, "SFTP activity");
        saveBlob(new Blob([XLSX.write(book, { type: "array", bookType: "xlsx" })], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }), `sftp-activity-${date}.xlsx`);
      } else {
        const win = window.open("", "_blank");
        if (!win) throw new Error("Allow pop-ups for this app to print the report.");
        win.document.open();
        win.document.write(`<html><head><title>SFTP activity</title><style>body{font:12px system-ui;margin:24px;color:#263e48}h1{font-size:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ccd7d5;padding:6px;text-align:left;overflow-wrap:anywhere}th{background:#edf3f1}@media print{body{margin:8mm}}</style></head><body><h1>MeterFlo SFTP activity</h1><p>Filtered report · ${records.length} events · ${escapeHtml(report.timezone)}</p><table><thead><tr>${columns.map(column => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${records.map(row => `<tr>${columns.map(column => `<td>${escapeHtml(row[column as keyof SftpEvent])}</td>`).join("")}</tr>`).join("")}</tbody></table></body></html>`);
        win.document.close(); win.focus(); win.print();
      }
      toast({ title: `${format.toUpperCase()} report ready`, description: `${records.length} filtered events included.` });
    } catch (error) { toast({ title: "Activity export failed", description: errorMessage(error), variant: "destructive" }); }
  };
  if (contextQuery.isLoading) return <div className="space-y-3 p-2"><Skeleton className="h-14 w-full" /><Skeleton className="h-10 w-2/3" /><Skeleton className="h-48 w-full" /></div>;
  if (contextQuery.isError || !context) return <Card className="border-destructive/40"><CardContent className="flex flex-wrap items-center justify-between gap-3 p-4"><div><p className="font-medium">SFTP Server could not load</p><p className="text-sm text-muted-foreground">{errorMessage(contextQuery.error)}</p></div><Button variant="outline" onClick={() => contextQuery.refetch()}>Try again</Button></CardContent></Card>;
  const views: { key: View; label: string; icon: typeof Cable }[] = [
    { key: "accounts", label: "Accounts", icon: UserRoundPlus },
    { key: "activity", label: "Activity", icon: Activity },
    { key: "instructions", label: "Instructions", icon: FileClock },
    ...(context.isAdmin ? [{ key: "settings" as View, label: "Server settings", icon: ShieldCheck }] : []),
  ];
  const accountsEnabled = context.supported && context.server.enabled && context.server.running;
  const events = eventsQuery.data?.rows || [];
  const total = eventsQuery.data?.total || 0;
  const canManageAccounts = context.supported && context.server.enabled && context.server.running;
  return <section className="space-y-4" data-testid="embedded-sftp-workspace" data-screen-mode={isMobile ? "compact" : "full"}>
    <header className="flex flex-wrap items-center justify-between gap-3 border-b pb-3" data-testid="embedded-sftp-subheader"><div className="min-w-0"><div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground"><Cable className="h-4 w-4" />Optional built-in service</div><h2 className="text-xl font-semibold tracking-tight">SFTP Server</h2><p className="mt-1 text-sm text-muted-foreground">Customer file access on your MeterFlo host · {context.timezone}</p></div><InventoryMobileTools tab="embedded-sftp"><div className="flex flex-wrap gap-2"><Button type="button" variant="outline" size="sm" onClick={refresh} disabled={contextQuery.isFetching || eventsQuery.isFetching}><RefreshCw className={`mr-1.5 h-4 w-4 ${contextQuery.isFetching || eventsQuery.isFetching ? "animate-spin" : ""}`} />Refresh</Button>{view === "accounts" && <Button type="button" size="sm" onClick={() => setAccountDialog(true)} disabled={!canManageAccounts}><UserRoundPlus className="mr-1.5 h-4 w-4" />New account</Button>}{view === "activity" && <><Button size="sm" variant="outline" onClick={() => exportReport("csv")}><Download className="mr-1 h-4 w-4" />CSV</Button><Button size="sm" variant="outline" onClick={() => exportReport("xls")}>Excel</Button><Button size="sm" variant="outline" onClick={() => exportReport("pdf")}><Printer className="mr-1 h-4 w-4" />Print / PDF</Button></>}</div></InventoryMobileTools></header>
    {isMobile ? <select aria-label="SFTP Server section" className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={view} onChange={event => setView(event.target.value as View)}>{views.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select> : <nav role="tablist" aria-label="SFTP Server sections" className="flex max-w-full gap-1 overflow-x-auto border-b">{views.map(item => { const Icon = item.icon; return <button key={item.key} type="button" role="tab" aria-selected={view === item.key} onClick={() => setView(item.key)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium ${view === item.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</nav>}
    {!context.supported && <div className="rounded-md border border-amber-700/20 bg-amber-50/60 px-3 py-2 text-sm text-amber-950">Built-in SFTP is unavailable here. Its settings and account controls are disabled; HTTPS Exchange works across platforms.</div>}
    {context.supported && !context.server.enabled && <div className="rounded-md border border-muted bg-muted/40 px-3 py-2 text-sm text-muted-foreground">The built-in listener is stopped. Account controls are unavailable until an administrator enables the server.</div>}
    {context.server.error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{context.server.error}</div>}
    {view === "accounts" && <section role="tabpanel" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2"><div><h3 className="text-base font-semibold">Customer accounts</h3><p className="text-sm text-muted-foreground">Upload and download rights are independent. Revoking disconnects active sessions immediately.</p></div>{!context.isAdmin && <Badge variant={accountsEnabled ? "outline" : "secondary"}>{accountsEnabled ? "Project access" : "Listener unavailable"}</Badge>}</div>
      {context.accounts.length ? <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>Account</TableHead><TableHead>Access</TableHead><TableHead>Status / expiry</TableHead><TableHead>Created</TableHead><TableHead className="text-right">Instructions / actions</TableHead></TableRow></TableHeader><TableBody>{[...context.accounts].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(account => {
        const state = stateOf(account);
        return <TableRow key={account.id}><TableCell><div className="font-medium">{account.label || account.username}</div><code className="text-xs text-muted-foreground">{account.username}</code></TableCell><TableCell className="text-xs">{[account.canUpload && "Upload · /incoming", account.canDownload && "Download · /outgoing"].filter(Boolean).join(" · ") || "No folder access"}</TableCell><TableCell><Badge variant={state === "revoked" ? "destructive" : state === "active" ? "outline" : "secondary"} className={state === "active" ? "border-emerald-700/20 bg-emerald-50 text-emerald-800" : ""}>{state}</Badge><div className="mt-1 text-xs text-muted-foreground">Expires {formatDateTimeInTimezone(account.expiresAt, context.timezone)}</div></TableCell><TableCell className="whitespace-nowrap text-xs">{formatDateTimeInTimezone(account.createdAt, context.timezone)}</TableCell><TableCell><div className="flex flex-wrap justify-end gap-1"><AccountInstructions context={context} account={account} onCopy={copyText} />{!account.revokedAt && <Button size="icon" variant="ghost" aria-label={`Revoke ${account.username}`} title={`Revoke ${account.username}`} disabled={!canManageAccounts || revoke.isPending} onClick={() => { if (window.confirm(`Revoke SFTP account “${account.username}”? Its sessions will be disconnected immediately.`)) revoke.mutate(account.id); }}><X className="h-4 w-4" /></Button>}</div></TableCell></TableRow>;
      })}</TableBody></Table></div> : <div className="rounded-md border border-dashed px-4 py-12 text-center"><UserRoundPlus className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No SFTP accounts yet</p><p className="mt-1 text-sm text-muted-foreground">Create a scoped account after the server is running. No keys or passwords are retained in this view.</p><Button className="mt-4" size="sm" onClick={() => setAccountDialog(true)} disabled={!canManageAccounts}><UserRoundPlus className="mr-1 h-4 w-4" />Create first account</Button></div>}
    </section>}
    {view === "activity" && <section role="tabpanel" className="space-y-3">
      {context.isAdmin && <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={includeShared} onChange={event => setIncludeShared(event.target.checked)} />Include shared server logs in deletion (site administrators only)</label>}
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-muted-foreground">Times and inclusive date filters use {context.timezone}. Export logs before deleting if you need a copy.</p><Button variant="outline" size="sm" disabled={previewDeletion.isPending} onClick={() => previewDeletion.mutate()}>Delete matching project logs</Button></div>
      <div><h3 className="text-base font-semibold">SFTP activity</h3><p className="text-sm text-muted-foreground">Auditable uploads, downloads, authentication and server outcomes · {context.timezone}</p></div>
      <InventoryMobileTools tab="embedded-sftp-activity"><div className="grid gap-2 rounded-md border bg-card p-2 sm:grid-cols-2 lg:grid-cols-[minmax(14rem,2fr)_1fr_1fr]"><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search SFTP activity" type="search" placeholder="Search username, file, action, message" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div><Input aria-label="Activity from date" type="date" value={from} onChange={event => setFrom(event.target.value)} /><Input aria-label="Activity to date" type="date" value={to} onChange={event => setTo(event.target.value)} /></div></InventoryMobileTools>
      {eventsQuery.isLoading ? <div className="space-y-2"><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /><Skeleton className="h-12 w-full" /></div> : eventsQuery.isError ? <Card className="border-destructive/40"><CardContent className="flex items-center justify-between gap-3 p-4"><p className="text-sm text-destructive">{errorMessage(eventsQuery.error)}</p><Button variant="outline" onClick={() => eventsQuery.refetch()}>Retry</Button></CardContent></Card> : events.length ? <>
        <div className="overflow-x-auto rounded-md border"><Table><TableHeader><TableRow><TableHead>When</TableHead><TableHead>Account</TableHead><TableHead>Action</TableHead><TableHead>Status</TableHead><TableHead>File / bytes</TableHead><TableHead>Details</TableHead></TableRow></TableHeader><TableBody>{events.map(event => <TableRow key={event.id}><TableCell className="whitespace-nowrap text-xs">{formatDateTimeInTimezone(event.createdAt, eventsQuery.data?.timezone || context.timezone)}</TableCell><TableCell className="font-mono text-xs">{event.username || "—"}</TableCell><TableCell className="text-sm">{event.action}</TableCell><TableCell><Badge variant={["failed", "rejected", "error"].includes(event.status.toLowerCase()) ? "destructive" : "outline"}>{event.status}</Badge></TableCell><TableCell><div className="max-w-48 truncate text-xs" title={event.fileName || ""}>{event.fileName || "—"}</div><div className="text-xs text-muted-foreground">{event.bytes == null ? "—" : `${(event.bytes / 1024).toFixed(1)} KB`}</div></TableCell><TableCell className="max-w-64 truncate text-xs text-muted-foreground" title={event.message || ""}>{event.message || "—"}</TableCell></TableRow>)}</TableBody></Table></div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">{total.toLocaleString()} events · Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.max(1, Math.ceil(total / PAGE_SIZE))}</span><div className="flex gap-2"><Button variant="outline" size="sm" disabled={!offset} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><ChevronLeft className="mr-1 h-4 w-4" />Previous</Button><Button variant="outline" size="sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>Next<ChevronRight className="ml-1 h-4 w-4" /></Button></div></div>
      </> : <div className="rounded-md border border-dashed px-4 py-10 text-center"><Activity className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No matching activity</p><p className="mt-1 text-sm text-muted-foreground">Connection events and file transfers will appear here.</p></div>}
    </section>}
    {view === "instructions" && <section role="tabpanel"><ServerInstructions context={context} onUseHttps={onUseHttps} /></section>}
    {view === "settings" && context.isAdmin && <section role="tabpanel" className="grid gap-4 lg:grid-cols-[1fr_.8fr]">
      {context.restoreReview?.requiresReview && <Card className="lg:col-span-2 border-amber-500/40">
        <CardHeader><CardTitle className="text-base">Review SFTP after restore</CardTitle><CardDescription>{context.restoreReview.message}</CardDescription></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>Mode: {context.restoreReview.mode} · Local accounts retained: {context.restoreReview.retained} · Blocked: {context.restoreReview.blocked.length}</p>
          {context.restoreReview.blocked.map(account => <p key={account.username}>{account.username}: {account.reason}</p>)}
          <details className="rounded border p-3"><summary className="cursor-pointer font-medium">Review all project transfer accounts ({context.restoreReview.accounts?.length || 0})</summary>
            <ul className="mt-2 space-y-2">{context.restoreReview.accounts?.map(account => <li key={account.username} className="rounded bg-muted/40 p-2">
              <span className="font-medium">{account.username}</span> · {account.projectName} (#{account.projectId}) · {account.canUpload ? "Upload" : "No upload"} / {account.canDownload ? "Download" : "No download"}
              <span className="block text-xs text-muted-foreground">Expires {formatDateTimeInTimezone(account.expiresAt, account.timezone)} ({account.timezone}) · {account.revokedAt ? "Revoked" : new Date(account.expiresAt).getTime() <= Date.now() ? "Expired" : "Not revoked"}{!account.projectActive ? " · Project inactive (blocked)" : ""}</span>
            </li>)}</ul>
          </details>
          <label className="flex items-start gap-2"><input type="checkbox" checked={restoreConfirmed} onChange={event => setRestoreConfirmed(event.target.checked)} /><span>I have reviewed the accounts and their projects, permissions, expiry, access locks, host/port and local SHA256 host fingerprint before enabling customer access.</span></label>
        </CardContent>
      </Card>}
      <Card><CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4 text-primary" />Built-in SFTP listener</CardTitle><CardDescription>Global server settings for this project. Saving enabled starts or restarts the listener; disabling stops it.</CardDescription></CardHeader><CardContent className="space-y-4">
        <div className={`flex items-center gap-2 rounded-md border p-3 text-sm ${context.server.running ? "border-emerald-700/20 bg-emerald-50/60 text-emerald-900" : "border-muted bg-muted/30 text-muted-foreground"}`}><span className={`h-2.5 w-2.5 rounded-full ${context.server.running ? "bg-emerald-600" : "bg-muted-foreground/50"}`} /><span className="font-medium">{context.server.running ? "Listener running" : "Listener stopped"}</span><span className="ml-auto text-xs">{context.server.enabled ? "Enabled" : "Disabled"}</span></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="sftp-bind-host">Bind host</Label><Input id="sftp-bind-host" value={host} onChange={event => setHost(event.target.value)} disabled={!context.supported} placeholder="0.0.0.0" /><p className="text-xs text-muted-foreground">Defaults to 0.0.0.0.</p></div><div className="space-y-1.5"><Label htmlFor="sftp-port">SSH port</Label><Input id="sftp-port" type="number" min={1} max={65535} value={port} onChange={event => setPort(event.target.value)} disabled={!context.supported} /><p className="text-xs text-muted-foreground">Configurable; default is 2222.</p></div></div>
        <div className="space-y-1.5"><Label htmlFor="sftp-public-host">Public hostname</Label><Input id="sftp-public-host" value={publicHost} onChange={event => setPublicHost(event.target.value)} disabled={!context.supported} maxLength={253} placeholder="files.example.com" /><p className="text-xs text-muted-foreground">Required before sharing a customer hostname. This is the externally reachable host, not the bind address.</p></div>
        <label className="flex items-center justify-between gap-3 rounded-md border p-3"><span><span className="block text-sm font-medium">Enable SFTP Server</span><span className="text-xs text-muted-foreground">The listener is not available on Replit.</span></span><Switch checked={enabled} onCheckedChange={setEnabled} disabled={!context.supported} aria-label="Enable SFTP Server" /></label>
        <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => restart.mutate()} disabled={!context.supported || !context.server.enabled || restart.isPending}>{restart.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RotateCw className="mr-2 h-4 w-4" />}Restart server</Button><Button onClick={() => saveServer.mutate()} disabled={!context.supported || saveServer.isPending || !Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535}>{saveServer.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save settings</Button></div>
      </CardContent></Card>
      <Card className="h-fit"><CardHeader className="pb-2"><CardTitle className="text-base">Host readiness</CardTitle><CardDescription>Before allowing customers to connect</CardDescription></CardHeader><CardContent className="space-y-3 text-sm text-muted-foreground"><p>Open the configured SSH port in the host firewall and confirm it is reachable from the customer network.</p><p>Use TLS for the MeterFlo web administration interface. SSH and HTTPS administration protect different surfaces.</p><p>On Windows, grant the MeterFlo Windows service identity write access to the incoming folder. Keep generated export storage read-only for SFTP accounts.</p><p>Saving server settings applies them immediately; a running listener may restart briefly.</p>{context.server.fingerprint && <div className="rounded border bg-muted/30 p-3"><p className="text-xs font-medium text-foreground">Current SHA256 fingerprint</p><code className="mt-1 block break-all text-xs">{context.server.fingerprint}</code></div>}</CardContent></Card>
    </section>}
    <Dialog open={!!deletePreview} onOpenChange={open => { if (!open && !deleteLogs.isPending) setDeletePreview(null); }}><DialogContent><DialogHeader><DialogTitle>Delete matching SFTP logs?</DialogTitle><DialogDescription>This permanently deletes {deletePreview?.expectedCount.toLocaleString()} matching activity entries for this project through {deletePreview && formatDateTimeInTimezone(deletePreview.before, deletePreview.timezone)} ({deletePreview?.timezone}). Shared server logs are {deletePreview?.filters.includeShared ? "included" : "not included"}. Other projects, files, accounts and the separate security audit trail are not deleted. Newer events are preserved. This cannot be undone.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" disabled={deleteLogs.isPending} onClick={() => setDeletePreview(null)}>Cancel</Button><Button variant="destructive" disabled={deleteLogs.isPending || !deletePreview?.expectedCount} onClick={() => deleteLogs.mutate()}>{deleteLogs.isPending ? "Deleting…" : "Permanently delete logs"}</Button></DialogFooter></DialogContent></Dialog>
    <CreateAccountDialog open={accountDialog} onOpenChange={setAccountDialog} onCreate={input => createAccount.mutate(input)} saving={createAccount.isPending} timezone={context.timezone} />
  </section>;
}
