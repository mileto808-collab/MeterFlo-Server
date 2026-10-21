import { useEffect, useState } from "react";
import { AlertTriangle, ArchiveRestore, CloudOff, Loader2, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { clearAllLocalChangeoutDraftsForWorkOrder, decodeDraftCapture, getLocalChangeoutDraft, listLocalChangeoutDrafts } from "@/hooks/use-changeout-draft";

interface RecoveryItem {
  workOrderId: number;
  revision: number;
  step: string;
  submissionId?: string;
  updatedAt: string;
  customerWoId?: string | null;
  canResume?: boolean;
  reason?: string | null;
  local?: boolean;
  assignmentVersion?: number;
}

export function ChangeoutDraftRecovery({ projectId, onResume }: { projectId: number; onResume: (workOrderId: number) => void }) {
  const { user } = useAuth();
  const [items, setItems] = useState<RecoveryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [readOnlyItem, setReadOnlyItem] = useState<RecoveryItem | null>(null);
  const [readOnlyCapture, setReadOnlyCapture] = useState<any>(null);
  const [readOnlyReason, setReadOnlyReason] = useState("");
  const [readOnlySource, setReadOnlySource] = useState<"server" | "device" | "unavailable">("unavailable");
  const [readOnlyCompleted, setReadOnlyCompleted] = useState(false);
  const [readOnlyLoading, setReadOnlyLoading] = useState(false);
  useEffect(() => {
    if (!user?.id || !projectId) return;
    let active = true;
    setLoading(true);
    Promise.all([
      fetch(`/api/projects/${projectId}/changeout-drafts`, { credentials: "include" })
        .then(async response => {
          if (!response.ok) throw new Error("Server recovery list is unavailable.");
          return (await response.json()).drafts as RecoveryItem[];
        }),
      listLocalChangeoutDrafts(user.id, projectId).catch(() => []),
    ]).then(([remote, local]) => {
      return Promise.all(local.map(async item => {
        try {
          const response = await fetch(`/api/projects/${projectId}/work-orders/${item.workOrderId}/changeout-draft`, { credentials: "include" });
          const body = response.ok ? await response.json() : null;
          if (body?.completed) {
            await clearAllLocalChangeoutDraftsForWorkOrder(projectId, item.workOrderId, body.assignmentVersion);
            return null;
          }
          if (body && Number.isFinite(body.assignmentVersion) && Number.isFinite(item.assignmentVersion) &&
            item.assignmentVersion !== body.assignmentVersion)
            return { ...item, canResume: false, reason: "Assignment version changed. This captured attempt is read-only." };
        } catch { /* Preserve device backups when the server cannot confirm completion. */ }
        return item;
      })).then(filteredLocal => [remote, filteredLocal.filter(Boolean) as typeof local] as const);
    }).then(([remote, local]) => {
      const draftKey = (item: RecoveryItem) => `${item.workOrderId}:${item.submissionId ?? "legacy"}`;
      const indexed = new Map(remote.map(item => [draftKey(item), item]));
      local.forEach(item => {
        const existing = indexed.get(draftKey(item));
        if (!existing || new Date(item.updatedAt).getTime() > new Date(existing.updatedAt).getTime())
          indexed.set(draftKey(item), { ...item, local: true, canResume: existing?.canResume ?? true, reason: existing?.reason });
      });
      if (active) { setItems([...indexed.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setError(""); }
    }).catch((reason: Error) => {
      if (!active) return;
      listLocalChangeoutDrafts(user.id, projectId).then(local => {
        if (active) setItems(local.map(item => ({ ...item, local: true, canResume: true })));
      });
      setError(reason.message);
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [projectId, user?.id, refresh]);
  useEffect(() => () => {
    const capture = readOnlyCapture;
    for (const field of ["troublePhotos", "beforePhotos", "afterPhotos"]) {
      for (const photo of capture?.data?.[field] ?? []) {
        if (photo.preview) URL.revokeObjectURL(photo.preview);
      }
    }
  }, [readOnlyCapture]);
  const showCapturedData = async (item: RecoveryItem) => {
    setReadOnlyItem(item);
    setReadOnlyCapture(null);
    setReadOnlyReason(item.reason || "The assignment changed. This capture is available for review only.");
    setReadOnlySource("unavailable");
    setReadOnlyCompleted(false);
    setReadOnlyLoading(true);
    try {
      const query = item.submissionId ? `?submissionId=${encodeURIComponent(item.submissionId)}` : "";
      const response = await fetch(`/api/projects/${projectId}/work-orders/${item.workOrderId}/changeout-draft${query}`, {
        credentials: "include",
      });
      const body = response.ok ? await response.json() : null;
      if (body?.completed) {
        await clearAllLocalChangeoutDraftsForWorkOrder(projectId, item.workOrderId, body.assignmentVersion);
        setReadOnlyCompleted(true);
        setReadOnlyReason(body.reason || "This work order is completed. Older captures have been cleared.");
        return;
      }
      const serverDraft = item.submissionId && body?.draft && body.draft.submissionId === item.submissionId
        ? body.draft : null;
      let source: "server" | "device" = "server";
      let selected = serverDraft;
      if (!selected && user?.id != null && item.submissionId) {
        selected = await getLocalChangeoutDraft(user.id, projectId, item.workOrderId, item.submissionId).catch(() => null);
        if (selected) source = "device";
      }
      if (selected) {
        let decoded = selected.capture;
        try { decoded = decodeDraftCapture(selected.capture); } catch { /* Show captured text even if a photo cannot be decoded. */ }
        setReadOnlyCapture(decoded);
        setReadOnlySource(source);
        setReadOnlyReason(body?.reason || item.reason ||
          (source === "device" ? "Server copy is unavailable. Showing the preserved device backup." : "Assignment changed. This capture is read-only."));
      } else {
        setReadOnlyReason(body?.reason || item.reason ||
          "The captured record is not available on this device or from the server.");
      }
    } catch {
      const local = user?.id != null && item.submissionId
        ? await getLocalChangeoutDraft(user.id, projectId, item.workOrderId, item.submissionId).catch(() => null)
        : null;
      if (local) {
        let decoded = local.capture;
        try { decoded = decodeDraftCapture(local.capture); } catch { /* Text fields remain reviewable. */ }
        setReadOnlyCapture(decoded);
        setReadOnlySource("device");
        setReadOnlyReason(item.reason || "Server is unavailable. Showing the preserved device backup.");
      } else {
        setReadOnlyReason(item.reason || "Server is unavailable and no matching device backup was found.");
      }
    } finally {
      setReadOnlyLoading(false);
    }
  };
  const capturedData = readOnlyCapture?.data ?? {};
  const capturedPhotos = ["troublePhotos", "beforePhotos", "afterPhotos"].flatMap(field =>
    (capturedData[field] ?? []).map((photo: any) => ({ ...photo, group: field.replace("Photos", "") })));
  const capturedSignature = capturedData.signatureData;
  const signatureSrc = capturedSignature
    ? (String(capturedSignature).startsWith("data:") ? String(capturedSignature) : `data:image/png;base64,${capturedSignature}`)
    : "";
  const displayValue = (value: unknown) => value == null || value === "" ? "—" : String(value);
  useEffect(() => {
    const check = () => { if (document.visibilityState === "visible") setRefresh(value => value + 1); };
    const handleWorkOrderEvent = (event: Event) => {
      const detail = (event as CustomEvent<{ type?: string; projectId?: number | string; workOrderId?: number | string }>).detail;
      if (Number(detail?.projectId) === projectId)
        setRefresh(value => value + 1);
    };
    window.addEventListener("online", check);
    window.addEventListener("meterflo:work-order-event", handleWorkOrderEvent);
    document.addEventListener("visibilitychange", check);
    return () => {
      window.removeEventListener("online", check);
      window.removeEventListener("meterflo:work-order-event", handleWorkOrderEvent);
      document.removeEventListener("visibilitychange", check);
    };
  }, [projectId]);
  if (loading) return <div className="mb-4 flex items-center gap-2 rounded-md border border-border/70 bg-card/70 px-3 py-2 text-sm text-muted-foreground" data-testid="changeout-draft-recovery-loading"><Loader2 className="h-4 w-4 animate-spin" /> Checking saved field drafts</div>;
  if (!items.length && !error) return null;
  return <Card className="mb-4 border-teal-800/20 bg-teal-50/60 dark:bg-teal-950/20" data-testid="changeout-draft-recovery">
    <CardHeader className="flex-row items-start justify-between space-y-0 p-3 pb-2">
      <div><CardTitle className="flex items-center gap-2 text-sm"><ArchiveRestore className="h-4 w-4 text-teal-800" /> Work in progress</CardTitle>
        <CardDescription className="mt-1 text-xs">Local and server backups stay available until completion is confirmed.</CardDescription></div>
      {error && <Button variant="ghost" size="sm" onClick={() => setRefresh(value => value + 1)} data-testid="button-retry-draft-recovery">Retry</Button>}
    </CardHeader>
    <CardContent className="space-y-2 p-3 pt-1">
      {error && <div className="flex items-center gap-2 text-xs text-amber-800"><CloudOff className="h-4 w-4" /> {error} Showing available local backups.</div>}
      {items.map(item => <div key={`${item.workOrderId}:${item.submissionId ?? "legacy"}`} className="flex flex-col gap-2 rounded-md border border-teal-900/10 bg-background/80 p-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{item.customerWoId || `Work order ${item.workOrderId}`}</div>
          <div className="text-xs text-muted-foreground">Step: {item.step} · Saved {new Date(item.updatedAt).toLocaleString()}{item.local ? " · device backup" : ""}</div>
          {!item.canResume && <div className="mt-1 flex items-center gap-1 text-xs text-amber-800"><AlertTriangle className="h-3.5 w-3.5" /> Read-only recovery: {item.reason || "Assignment or status changed."} Captured data remains preserved.</div>}
        </div>
        <Button size="sm" variant={item.canResume ? "default" : "outline"}
          onClick={() => item.canResume ? onResume(item.workOrderId) : void showCapturedData(item)}
          data-testid={`button-resume-changeout-${item.workOrderId}`}
          data-submission-id={item.submissionId}>
          {item.canResume ? "Resume draft" : "Review captured data"}
        </Button>
      </div>)}
    </CardContent>
    <Dialog open={!!readOnlyItem} onOpenChange={open => {
      if (!open) { setReadOnlyItem(null); setReadOnlyCapture(null); }
    }}>
      <DialogContent className="max-h-[88dvh] max-w-2xl overflow-y-auto" data-testid="changeout-captured-review">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><LockKeyhole className="h-4 w-4" /> Captured changeout · read-only</DialogTitle>
          <DialogDescription>
            {readOnlyItem?.customerWoId || `Work order ${readOnlyItem?.workOrderId}`}
            {readOnlyItem?.submissionId ? ` · token ${readOnlyItem.submissionId.slice(0, 8)}` : ""}
          </DialogDescription>
        </DialogHeader>
        {readOnlyLoading ? <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Retrieving the exact captured attempt…</div>
          : readOnlyCompleted ? <div className="rounded-md border border-emerald-700/20 bg-emerald-50 p-3 text-sm text-emerald-950" role="status">{readOnlyReason}</div>
          : <>
            <div className="rounded-md border border-amber-700/20 bg-amber-50/70 p-3 text-sm text-amber-950">
              <p className="font-semibold">Submission is disabled</p>
              <p className="mt-1">{readOnlyReason}</p>
              <p className="mt-1 text-xs">Source: {readOnlySource === "device" ? "local device backup" : readOnlySource === "server" ? "server capture" : "unavailable"} · This data will not be transferred to a new assignment.</p>
            </div>
            {!readOnlyCapture ? <p className="rounded-md border p-3 text-sm text-muted-foreground">No matching capture is available to display.</p> : <>
              <section className="space-y-2 rounded-md border p-3">
                <h3 className="text-sm font-semibold">Work performed</h3>
                <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                  <p><span className="text-muted-foreground">Workflow:</span> {displayValue(capturedData.isReadingOnly ? "Reading only" : "Changeout")}</p>
                  <p><span className="text-muted-foreground">Trouble code:</span> {displayValue(capturedData.troubleCodeLabel ?? capturedData.troubleCode)}</p>
                  <p><span className="text-muted-foreground">Old system ID:</span> {displayValue(readOnlyCapture.context?.oldSystemId ?? capturedData.oldSystemId)}</p>
                  <p><span className="text-muted-foreground">New system ID:</span> {displayValue(capturedData.newSystemId)}</p>
                  <p><span className="text-muted-foreground">Old system reading:</span> {displayValue(capturedData.oldSystemReading)}</p>
                  <p><span className="text-muted-foreground">New system reading:</span> {displayValue(capturedData.newSystemReading)}</p>
                  <p><span className="text-muted-foreground">Old module ID:</span> {displayValue(readOnlyCapture.context?.oldModuleId ?? capturedData.oldModuleId)}</p>
                  <p><span className="text-muted-foreground">New module ID:</span> {displayValue(capturedData.newModuleId)}</p>
                  <p><span className="text-muted-foreground">Old module reading:</span> {displayValue(capturedData.oldModuleRead ?? capturedData.oldModuleReading)}</p>
                  <p><span className="text-muted-foreground">New module reading:</span> {displayValue(capturedData.newModuleRead ?? capturedData.newModuleReading)}</p>
                  <p><span className="text-muted-foreground">Captured at:</span> {displayValue(readOnlyCapture.sessionStartTime ?? readOnlyCapture.updatedAt ?? readOnlyItem?.updatedAt)}</p>
                  <p><span className="text-muted-foreground">GPS:</span> {displayValue(capturedData.gpsCoordinates)}</p>
                </div>
                <div><h4 className="text-xs font-semibold text-muted-foreground">Trouble / notes</h4><p className="whitespace-pre-wrap text-sm">{displayValue(capturedData.troubleNote || capturedData.trouble || capturedData.completionNotes || capturedData.notes)}</p></div>
                {(capturedData.troubleNote || capturedData.trouble) && (capturedData.completionNotes || capturedData.notes) &&
                  <p className="whitespace-pre-wrap text-sm">{capturedData.completionNotes || capturedData.notes}</p>}
              </section>
              <section className="space-y-2 rounded-md border p-3">
                <h3 className="text-sm font-semibold">Technician sign-off</h3>
                <p className="text-sm">{displayValue(capturedData.signatureName)}{capturedData.signatureType ? ` · ${capturedData.signatureType}` : ""}</p>
                {signatureSrc && <img src={signatureSrc} alt="Captured technician signature" className="max-h-32 max-w-full rounded border bg-white object-contain p-2" />}
              </section>
              {capturedPhotos.length > 0 && <section className="space-y-2 rounded-md border p-3">
                <h3 className="text-sm font-semibold">Captured photos</h3>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {capturedPhotos.map((photo: any, index: number) => <figure key={`${photo.group}-${index}`} className="overflow-hidden rounded border">
                    {photo.preview && <img src={photo.preview} alt={`${photo.group} photo ${index + 1}`} className="aspect-square w-full object-cover" />}
                    <figcaption className="truncate px-2 py-1 text-xs text-muted-foreground">{photo.group} · {photo.file?.name || `Photo ${index + 1}`}</figcaption>
                  </figure>)}
                </div>
              </section>}
            </>}
          </>}
      </DialogContent>
    </Dialog>
  </Card>;
}
