import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { usePermissions } from "@/hooks/usePermissions";
import type { InventoryPickupNotice, InventoryPickupResponse } from "@shared/inventory-pickups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { Boxes, MapPin, Truck, AlertTriangle, RotateCcw } from "lucide-react";
import { useMemo } from "react";

type PickupNotice = InventoryPickupNotice;

export const pickupQueryKey = ["/api/inventory/pickups"];
const emptyPickupResponse: InventoryPickupResponse = { pickups: [], unreadCount: 0 };

function clearPickupCache() {
  queryClient.setQueryData<InventoryPickupResponse>(pickupQueryKey, emptyPickupResponse);
}

function isAccessError(status: number) {
  return [401, 403, 404, 423].includes(status);
}

function usePickupFeed(enabled = true) {
  return useQuery<InventoryPickupResponse>({
    queryKey: pickupQueryKey,
    queryFn: async () => {
      try { return await (await apiRequest("GET", "/api/inventory/pickups")).json(); }
      catch (error) {
        const status = Number((error instanceof Error ? error.message : "").match(/^\s*(\d{3}):/)?.[1] ?? 0);
        if (isAccessError(status)) clearPickupCache();
        throw error;
      }
    },
    enabled,
    staleTime: 0,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    refetchInterval: 60_000,
    retry: false,
  });
}

let eventSource: EventSource | null = null;
let subscribers = 0;
let closeTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function connectPickupEvents(client: ReturnType<typeof useQueryClient>) {
  if (!subscribers || eventSource) return;
  const stream = new EventSource("/api/inventory/pickups/events", { withCredentials: true });
  eventSource = stream;
  stream.onmessage = event => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "access_lost") {
        clearPickupCache();
        void client.invalidateQueries({ queryKey: pickupQueryKey });
      } else if (data.type === "resync") void client.invalidateQueries({ queryKey: pickupQueryKey });
    } catch { /* Ignore malformed event metadata. */ }
  };
  stream.onopen = () => { void client.invalidateQueries({ queryKey: pickupQueryKey }); };
  stream.onerror = () => {
    stream.close();
    if (eventSource === stream) eventSource = null;
    void fetch("/api/inventory/pickups", { credentials: "include" }).then(response => {
      if (isAccessError(response.status)) {
        clearPickupCache();
        void client.invalidateQueries({ queryKey: pickupQueryKey });
        return;
      }
      if (response.ok) void client.invalidateQueries({ queryKey: pickupQueryKey });
      if (subscribers && !reconnectTimer) reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectPickupEvents(client);
      }, 4000);
    }).catch(() => {
      if (subscribers && !reconnectTimer) reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectPickupEvents(client);
      }, 4000);
    });
  };
}
function usePickupEvents(enabled = true) {
  const client = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    subscribers++;
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = null;
    connectPickupEvents(client);
    return () => {
      subscribers--;
      if (subscribers <= 0) closeTimer = setTimeout(() => {
        if (subscribers > 0) return;
        eventSource?.close();
        eventSource = null;
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }, 0);
    };
  }, [client, enabled]);
}

function formatTimestamp(date: string, timezone: string) {
  const parsed = new Date(date);
  if (!Number.isFinite(parsed.getTime())) return date;
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed);
  }
}

function pickupHref(notice: InventoryPickupNotice) {
  return `/projects/${notice.projectId}/work-orders?pickup=${encodeURIComponent(notice.batchId)}`;
}

export function PickupNoticeDetails({ notice: rawNotice, onViewed }: { notice: PickupNotice; onViewed?: () => void }) {
  const notice = rawNotice;
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canReportProblem = user?.role === "technician" ||
    (hasPermission("workOrders.view") && !hasPermission("inventory.view"));
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackError, setAckError] = useState("");
  const autoViewed = useRef("");
  const [reportOpen, setReportOpen] = useState(false);
  const [reportItem, setReportItem] = useState("");
  const [reportCategory, setReportCategory] = useState<"wrong_serial" | "wrong_item" | "quantity" | "missing" | "other">("other");
  const [reportDescription, setReportDescription] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportError, setReportError] = useState("");
  const [ticketQr, setTicketQr] = useState("");
  const [ticketQrError, setTicketQrError] = useState(false);
  const reportKey = useMemo(() => user?.id ? `meterflo:pickup-issue:${encodeURIComponent(String(user.id))}:${notice.projectId}:${encodeURIComponent(notice.batchId)}` : null,
    [user?.id, notice.projectId, notice.batchId]);
  const [pendingReport, setPendingReport] = useState<{ operationId: string; revision: number; itemId: string; category: string; description: string } | null>(null);
  useEffect(() => {
    let current = true;
    setTicketQr("");
    setTicketQrError(false);
    import("qrcode").then(({ default: QRCode }) => QRCode.toDataURL(
      `${window.location.origin}${pickupHref(notice)}`,
      { errorCorrectionLevel: "M", margin: 2, width: 320, color: { dark: "#172522", light: "#ffffff" } },
    )).then(value => { if (current) setTicketQr(value); })
      .catch(() => { if (current) setTicketQrError(true); });
    return () => { current = false; };
  }, [notice.projectId, notice.batchId]);
  useEffect(() => {
    if (!reportKey) return;
    try {
      const stored = window.localStorage.getItem(reportKey);
      setPendingReport(stored ? JSON.parse(stored) : null);
    } catch { setReportError("Saved report retry data is unavailable. No report was sent."); }
  }, [reportKey]);
  const acknowledge = async () => {
    if (acknowledging) return;
    setAcknowledging(true);
    setAckError("");
    try {
      await apiRequest("POST", `/api/inventory/pickups/${notice.projectId}/${encodeURIComponent(notice.batchId)}/view`, { revision: notice.revision });
      await queryClient.invalidateQueries({ queryKey: pickupQueryKey });
      onViewed?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      const status = Number(message.match(/^\s*(\d{3}):/)?.[1] ?? 0);
      if (isAccessError(status)) clearPickupCache();
      setAckError(status === 404 ? "This pickup is no longer available to your account." : "Could not acknowledge this notice. Retry when connected.");
    } finally { setAcknowledging(false); }
  };
  const sendReport = async (retry = false) => {
    if (!reportKey || reportBusy || !canReportProblem) return;
    const pending = retry ? pendingReport : reportItem && reportDescription.trim().length >= 10 ? {
      operationId: crypto.randomUUID(), revision: notice.revision, itemId: reportItem,
      category: reportCategory, description: reportDescription.trim(),
    } : null;
    if (!pending) return;
    try {
      if (!retry) window.localStorage.setItem(reportKey, JSON.stringify(pending));
      setPendingReport(pending); setReportBusy(true); setReportError("");
      await apiRequest("POST", `/api/inventory/pickups/${notice.projectId}/${encodeURIComponent(notice.batchId)}/problem`, pending);
      window.localStorage.removeItem(reportKey);
      setPendingReport(null); setReportOpen(false); setReportDescription(""); setReportItem("");
      await queryClient.invalidateQueries({ queryKey: pickupQueryKey });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      const status = Number(message.match(/^\s*(\d{3}):/)?.[1] ?? 0);
      if (isAccessError(status)) clearPickupCache();
      setReportError(status >= 400 && status < 500 && status !== 403
        ? `${message} Correct the report and submit again.`
        : "The outcome is unknown. Your exact report identity is saved; retry the same report before creating another.");
      if (status >= 400 && status < 500 && status !== 403) {
        window.localStorage.removeItem(reportKey);
        setPendingReport(null);
      }
    } finally { setReportBusy(false); }
  };
  useEffect(() => {
    const identity = `${notice.projectId}:${notice.batchId}:${notice.revision}`;
    if (notice.unread && autoViewed.current !== identity) {
      autoViewed.current = identity;
      void acknowledge();
    }
  }, [notice.projectId, notice.batchId, notice.revision, notice.unread]);
  return <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
       <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{notice.batchName}</h3><Badge variant={notice.status === "review" ? "destructive" : notice.status === "partial" ? "outline" : "secondary"}>{notice.status === "review" ? "Pickup needs review" : notice.status === "partial" ? "Partial pickup" : "Ready"}</Badge></div>
        <p className="mt-1 text-sm text-muted-foreground">{notice.projectName} · {notice.ticketNumber}</p></div>
    </div>
    <section data-testid="pickup-ticket-qr" aria-label="Pick ticket QR code"
      className="flex flex-col items-center gap-4 rounded-xl border bg-card p-4 text-center sm:flex-row sm:items-center sm:text-left">
      <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
        {ticketQr ? <img src={ticketQr} alt={`Pick ticket QR for ${notice.ticketNumber}, vehicle ${notice.vehicleName}`} className="h-full w-full object-contain" />
          : ticketQrError ? <p role="status" className="px-3 text-xs text-muted-foreground">QR is unavailable. Open the project ticket using the link above.</p>
            : <div className="h-36 w-36 animate-pulse rounded bg-muted" aria-label="Preparing pick ticket QR" />}
      </div>
      <div className="min-w-0 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Show at staging</p>
        <h4 className="text-lg font-semibold">Pick ticket · {notice.ticketNumber}</h4>
        <p className="text-sm text-muted-foreground">Have the warehouse worker scan this code to open the saved batch. Scanning only opens the ticket; it does not move stock.</p>
        <p className="text-sm"><span className="text-muted-foreground">Vehicle:</span> <span className="font-semibold">{notice.vehicleName}</span></p>
      </div>
    </section>
    <div className="grid gap-2 rounded-lg bg-muted/45 p-3 text-sm sm:grid-cols-2">
      <p className="flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />{notice.vehicleName}</p>
      <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{notice.stagingName}{notice.stagingLocation ? ` · ${notice.stagingLocation}` : ""}</p>
      <p className="text-muted-foreground">Ready {formatTimestamp(notice.readyAt, notice.timezone)} ({notice.timezone})</p>
      <p className="text-muted-foreground">Created {formatTimestamp(notice.createdAt, notice.timezone)}</p>
    </div>
    {notice.notes && <p className="whitespace-pre-wrap rounded-lg border px-3 py-2 text-sm">{notice.notes}</p>}
    <div className="overflow-hidden rounded-lg border">
      <div className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] gap-3 border-b bg-muted/30 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"><span>Item / SKU</span><span>Planned</span><span>Staged</span><span>Ready</span></div>
      <div className="divide-y">{notice.items.map((item, index) => <div key={`${item.itemId}:${index}`} className="grid grid-cols-[minmax(0,1fr)_repeat(3,auto)] items-start gap-3 px-3 py-3 text-sm">
        <div className="min-w-0"><p className="font-medium">{item.name}</p><p className="break-all font-mono text-xs text-muted-foreground">{item.sku}</p>
          <p className="mt-1 text-xs text-muted-foreground">Delivered {item.deliveredQuantity} · Missing {item.remainingToStage}</p>
          {item.serials.length > 0 && <p className="mt-1 break-all text-xs text-muted-foreground">Captured serials: <span className="font-mono">{item.serials.join(", ")}</span></p>}
        </div><span className="font-mono">{item.plannedQuantity} {item.unit}</span><span className="font-mono">{item.stagedQuantity}</span><span className="font-mono font-semibold text-primary">{item.readyQuantity}</span>
      </div>)}</div>
    </div>
    {notice.issues?.filter(issue => issue.status !== "resolved").map(issue => <Alert key={issue.id} className="border-amber-500/40 bg-amber-500/5"><AlertTriangle className="h-4 w-4" /><AlertTitle>Pickup needs review · {issue.category.replace("_", " ")}</AlertTitle><AlertDescription>{notice.items.find(item => item.itemId === issue.itemId)?.name ?? "Catalog item unavailable"}: {issue.description}{issue.quantity ? ` · ${issue.quantity} units` : ""}</AlertDescription></Alert>)}
    <Alert className="border-amber-500/40 bg-amber-500/5">
      <AlertTriangle className="h-4 w-4" /><AlertTitle>Acknowledging is not pickup</AlertTitle>
      <AlertDescription>Viewing this notice only marks it seen. Stock remains at staging until warehouse staff record the physical vehicle handoff.</AlertDescription>
    </Alert>
    {ackError && <p role="alert" className="text-sm text-destructive">{ackError}</p>}
    {canReportProblem && <div className="space-y-2">
      {reportError && <Alert variant="destructive"><AlertTitle>Problem report not confirmed</AlertTitle><AlertDescription>{reportError}</AlertDescription></Alert>}
      {pendingReport ? <Button type="button" size="sm" variant="outline" data-testid="pickup-report-retry" onClick={() => void sendReport(true)} disabled={reportBusy}><RotateCcw className="mr-2 h-4 w-4" />{reportBusy ? "Retrying…" : "Retry saved pickup problem"}</Button> :
        <Button type="button" size="sm" variant="outline" data-testid="pickup-report-problem" onClick={() => setReportOpen(true)}>Report pickup problem</Button>}
    </div>}
    {notice.unread && <Button type="button" size="sm" variant="outline" disabled={acknowledging} onClick={() => void acknowledge()}>{acknowledging ? "Acknowledging…" : "Acknowledge / View"}</Button>}
    <Dialog open={reportOpen} onOpenChange={value => { if (!reportBusy) setReportOpen(value); }}>
      <DialogContent className="w-[calc(100vw-2rem)] max-w-lg">
        <DialogHeader><DialogTitle>Report pickup problem</DialogTitle><DialogDescription>Report stock still waiting at staging. This does not change inventory or require warehouse access.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div><Label htmlFor="pickup-issue-item">Pickup item</Label><Select value={reportItem} onValueChange={setReportItem}><SelectTrigger id="pickup-issue-item" data-testid="pickup-report-item"><SelectValue placeholder="Choose the item" /></SelectTrigger><SelectContent>{notice.items.map(item => <SelectItem key={item.itemId} value={item.itemId}>{item.name} · {item.sku}</SelectItem>)}</SelectContent></Select></div>
          <div><Label htmlFor="pickup-issue-category">Problem type</Label><Select value={reportCategory} onValueChange={value => setReportCategory(value as typeof reportCategory)}><SelectTrigger id="pickup-issue-category" data-testid="pickup-issue-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wrong_serial">Wrong serial</SelectItem><SelectItem value="wrong_item">Wrong item</SelectItem><SelectItem value="quantity">Quantity mismatch</SelectItem><SelectItem value="missing">Missing</SelectItem><SelectItem value="other">Other</SelectItem></SelectContent></Select></div>
          <div><Label htmlFor="pickup-issue-description">Description · at least 10 characters</Label><Textarea id="pickup-issue-description" value={reportDescription} onChange={event => setReportDescription(event.target.value)} placeholder="Describe what does not match the pickup." /></div>
          {reportError && <p role="alert" className="text-sm text-destructive">{reportError}</p>}
        </div>
        <DialogFooter><Button type="button" variant="outline" onClick={() => setReportOpen(false)} disabled={reportBusy}>Cancel</Button><Button type="button" data-testid="pickup-issue-submit" onClick={() => void sendReport()} disabled={!reportItem || reportDescription.trim().length < 10 || reportBusy}>{reportBusy ? "Sending…" : "Send report"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </div>;
}

export function PickupInboxButton() {
  const { hasPermission, isLoading, user } = usePermissions();
  const canSeePickups = !isLoading && user?.role !== "customer" &&
    (hasPermission("workOrders.view") || hasPermission("inventory.view"));
  usePickupEvents(canSeePickups);
  const query = usePickupFeed(canSeePickups);
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const notice = query.data?.pickups.find(entry => entry.batchId === selected) as PickupNotice | undefined;
  if (!canSeePickups) return null;
  return <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setSelected(null); }}>
    <PopoverTrigger asChild><Button variant="outline" size="sm" className="relative gap-2" aria-label={`Vehicle pickup notices${query.data?.unreadCount ? `, ${query.data.unreadCount} unread` : ""}`} data-testid="button-pickup-notices"><Truck className="h-4 w-4" /><span className="hidden sm:inline">Pickups</span>{!!query.data?.unreadCount && <Badge className="h-5 min-w-5 justify-center px-1 text-[10px]" variant="destructive">{query.data.unreadCount}</Badge>}</Button></PopoverTrigger>
    <PopoverContent align="end" className="w-[min(92vw,34rem)] max-h-[min(80dvh,44rem)] overflow-y-auto p-0">
      <div className="border-b px-4 py-3"><p className="font-semibold">Ready for your vehicle</p><p className="text-xs text-muted-foreground">Assigned-vehicle pickup notices</p></div>
      <div className="space-y-3 p-4">
        {query.isLoading && <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {query.isError && <Alert variant="destructive"><AlertTitle>Pickups unavailable</AlertTitle><AlertDescription className="flex items-center justify-between gap-2"><span>Notices could not be loaded.</span><Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></AlertDescription></Alert>}
        {!query.isLoading && !query.isError && !query.data?.pickups.length && <div className="py-8 text-center"><Boxes className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No ready pickups</p><p className="text-sm text-muted-foreground">New notices for your assigned vehicle appear here.</p></div>}
         {notice && <div><Button type="button" variant="ghost" size="sm" className="mb-2 px-0" onClick={() => setSelected(null)}>← All notices</Button><PickupNoticeDetails notice={notice} onViewed={() => setSelected(notice.batchId)} /></div>}
        {!notice && query.data?.pickups.map(entry => <button type="button" key={`${entry.projectId}:${entry.batchId}`} onClick={() => setSelected(entry.batchId)} className="w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/50">
          <div className="flex items-center justify-between gap-2"><span className="font-semibold">{entry.batchName}</span><span className="flex items-center gap-2">{entry.unread && <span className="h-2 w-2 rounded-full bg-primary" aria-label="Unread" />}<Badge variant={(entry as PickupNotice).status === "review" ? "destructive" : entry.status === "partial" ? "outline" : "secondary"}>{(entry as PickupNotice).status === "review" ? "Pickup needs review" : entry.status}</Badge></span></div>
          <p className="mt-1 text-sm text-muted-foreground">{entry.projectName} · {entry.ticketNumber}</p><p className="mt-1 text-xs text-muted-foreground">{entry.vehicleName} · {entry.readyAt ? formatTimestamp(entry.readyAt, entry.timezone) : ""}</p>
        </button>)}
      </div>
    </PopoverContent>
  </Popover>;
}

export function DashboardPickupSection() {
  const { hasPermission, isLoading, user } = usePermissions();
  const canSeePickups = !isLoading && user?.role !== "customer" &&
    (hasPermission("workOrders.view") || hasPermission("inventory.view"));
  const query = usePickupFeed(canSeePickups);
  const [selected, setSelected] = useState<string | null>(null);
  const notice = query.data?.pickups.find(entry => entry.batchId === selected) as PickupNotice | undefined;
  if (!canSeePickups) return null;
  if (query.isLoading) return <Card className="mb-6"><CardHeader><CardTitle>Vehicle pickups</CardTitle></CardHeader><CardContent className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></CardContent></Card>;
  if (query.isError) return <Alert className="mb-6" variant="destructive"><AlertTitle>Pickup notices could not load</AlertTitle><AlertDescription className="flex items-center justify-between gap-3">Retry to refresh your assigned-vehicle notices.<Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></AlertDescription></Alert>;
  return <Card className="mb-6 border-primary/20" data-testid="section-ready-pickups">
    <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" />Vehicle pickups{!!query.data?.unreadCount && <Badge variant="destructive">{query.data.unreadCount} new</Badge>}</CardTitle><CardDescription>Pickup readiness and review notices for vehicles assigned to you. Opening a notice does not move stock.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
       {notice ? <><Button variant="ghost" size="sm" className="px-0" onClick={() => setSelected(null)}>← All pickups</Button><PickupNoticeDetails notice={notice} /></> :
        query.data?.pickups.length ? query.data.pickups.map(entry => <div key={`${entry.projectId}:${entry.batchId}`} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-medium">{entry.batchName}<Badge variant={(entry as PickupNotice).status === "review" ? "destructive" : entry.status === "partial" ? "outline" : "secondary"}>{(entry as PickupNotice).status === "review" ? "Pickup needs review" : entry.status}</Badge>{entry.unread && <Badge variant="destructive">New</Badge>}</div>
            <p className="mt-1 text-sm text-muted-foreground">{entry.projectName} · {entry.vehicleName} · {entry.ticketNumber}</p><p className="text-xs text-muted-foreground">Ready {formatTimestamp(entry.readyAt, entry.timezone)}</p></div>
          <Button variant="outline" size="sm" onClick={() => setSelected(entry.batchId)}>View notice</Button>
        </div>) : <div className="rounded-lg border border-dashed px-4 py-6 text-center"><Boxes className="mx-auto mb-2 h-6 w-6 text-muted-foreground" /><p className="font-medium">Nothing staged for your vehicle</p><p className="text-sm text-muted-foreground">Ready and partial pickups will be listed here.</p></div>}
      <p className="text-xs text-muted-foreground">Warehouse staff must record the physical vehicle handoff before stock leaves staging.</p>
    </CardContent>
  </Card>;
}

export function ProjectPickupBanner({ projectId }: { projectId: number }) {
  const { hasPermission, isLoading, user } = usePermissions();
  const canSeePickups = !isLoading && user?.role !== "customer" &&
    (hasPermission("workOrders.view") || hasPermission("inventory.view"));
  const query = usePickupFeed(canSeePickups);
  const [location, navigate] = useLocation();
  const [selected, setSelected] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const requested = params.get("pickup");
  const projectNotices = query.data?.pickups.filter(entry => entry.projectId === projectId) ?? [];
  usePickupEvents(canSeePickups);

  useEffect(() => {
    if (!requested) return;
    if (!canSeePickups || query.isLoading || query.isFetching || query.isError) return;
    const match = projectNotices.find(entry => entry.batchId === requested);
    if (match) { setSelected(match.batchId); setUnavailable(false); }
    else { setSelected(null); setUnavailable(true); }
    params.delete("pickup");
    const suffix = params.toString();
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`);
    navigate(`${window.location.pathname}${suffix ? `?${suffix}` : ""}${window.location.hash}`, { replace: true });
  // location changes when other page query parameters change; requested is the exact deep link.
  }, [requested, query.isLoading, query.isFetching, query.isError, query.data, projectId, location, navigate, canSeePickups]);

  const notice = projectNotices.find(entry => entry.batchId === selected) as PickupNotice | undefined;
  if (!canSeePickups) return null;
  if (!projectNotices.length && !requested && !unavailable && !query.isLoading && !query.isError) return null;
  return <div className="mb-3">
    {unavailable && <Alert variant="destructive" className="mb-3"><AlertTriangle className="h-4 w-4" /><AlertTitle>Pickup is unavailable</AlertTitle><AlertDescription>This pickup is no longer available to your account. Current ready notices are shown below.</AlertDescription></Alert>}
    {query.isError && <Alert variant="destructive"><AlertTitle>Pickup details unavailable</AlertTitle><AlertDescription className="flex items-center justify-between gap-2">Could not load assigned-vehicle pickup details.<Button size="sm" variant="outline" onClick={() => void query.refetch()}>Retry</Button></AlertDescription></Alert>}
     {notice ? <Card><CardHeader className="pb-2"><CardTitle className="text-base">Pickup detail</CardTitle></CardHeader><CardContent><PickupNoticeDetails notice={notice} onViewed={() => void query.refetch()} /></CardContent></Card> :
      projectNotices.length > 0 && <Alert className="border-primary/20 bg-primary/5"><Truck className="h-4 w-4" /><AlertTitle>{projectNotices.some(entry => entry.status === "review") ? "Pickup needs review" : "Stock ready for your vehicle"}</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>{projectNotices.length} pickup notice{projectNotices.length === 1 ? "" : "s"}. Opening details does not move stock.</span><div className="flex flex-wrap gap-2">{projectNotices.map(entry => <Button key={entry.batchId} variant={entry.status === "review" ? "destructive" : "outline"} size="sm" onClick={() => setSelected(entry.batchId)}>{entry.status === "review" ? "Needs review" : entry.ticketNumber}</Button>)}</div></AlertDescription></Alert>}
  </div>;
}
