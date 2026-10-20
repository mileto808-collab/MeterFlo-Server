import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw } from "lucide-react";
import { formatDateTimeInTimezone } from "@/lib/timezone";

interface Delivery {
  id: string; projectName: string; workOrderId: number; customerWoId: string | null;
  status: string; attemptCount: number; nextAttemptAt: string;
  lastError: string | null; lastResponseStatus: number | null; createdAt: string;
}
interface Attempt {
  id: number; attemptNumber: number; success: boolean; createdAt: string;
  requestUrl: string; responseStatus: number | null; errorMessage: string | null;
  triggeredBy: string; requestPayload: string | null; responseBody: string | null;
}
async function readJson(url: string) {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) throw new Error(`Unable to load delivery information (${response.status})`);
  return response.json();
}
export function readablePayload(value: string | null) {
  if (!value) return "No request was sent (see the error above).";
  try {
    return JSON.stringify(JSON.parse(value), (key, item) =>
      ["data", "signature", "beforePhoto", "afterPhoto"].includes(key) && typeof item === "string"
        ? `[base64 data: ${item.length} characters]` : item, 2);
  } catch { return value; }
}

export function CustomerApiDeliveries({ isAdmin, projects, fixedProjectId, timezone }: { isAdmin: boolean; projects: { id: number; name: string }[]; fixedProjectId?: number; timezone?: string }) {
  const date = (value: string) => timezone ? formatDateTimeInTimezone(value, timezone) : new Date(value).toLocaleString();
  const [project, setProject] = useState(fixedProjectId == null ? "all" : String(fixedProjectId));
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Delivery | null>(null);
  const { toast } = useToast();
  const cache = useQueryClient();
  useEffect(() => {
    setProject(fixedProjectId == null ? "all" : String(fixedProjectId));
    setPage(0);
    setSelected(null);
  }, [fixedProjectId]);
  const list = useQuery<{ deliveries: Delivery[]; total: number }>({
    queryKey: ["/api/customer-api-deliveries", fixedProjectId ?? project, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "25", offset: String(page * 25) });
      if (fixedProjectId != null) params.set("projectId", String(fixedProjectId));
      else if (project !== "all") params.set("projectId", project);
      if (status !== "all") params.set("status", status);
      return readJson(`/api/customer-api-deliveries?${params}`);
    },
    refetchInterval: 5000,
  });
  const attempts = useQuery<Attempt[]>({
    queryKey: ["/api/customer-api-deliveries", selected?.id, "attempts"],
    queryFn: () => readJson(`/api/customer-api-deliveries/${selected!.id}/attempts`),
    enabled: !!selected, refetchInterval: selected ? 5000 : false,
  });
  const retry = useMutation({
    mutationFn: async (id: string) => { await apiRequest("POST", `/api/customer-api-deliveries/${id}/retry`, {}); },
    onSuccess: () => {
      toast({ title: "Delivery queued for retry" });
      cache.invalidateQueries({ queryKey: ["/api/customer-api-deliveries"] });
      cache.invalidateQueries({ queryKey: ["/api/customer-api-logs"] });
    },
    onError: (error: Error) => toast({ title: "Retry could not be queued", description: error.message, variant: "destructive" }),
  });
  return <section className="space-y-4 border-b pb-6 mb-6" aria-label="Customer API delivery queue">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="font-semibold">Delivery queue</h3>
        <p className="text-sm text-muted-foreground">Five attempts per retry cycle. Updates refresh automatically.</p></div>
      <Button variant="outline" size="sm" onClick={() => list.refetch()} disabled={list.isFetching}>
        <RefreshCw className="mr-2 h-4 w-4" />Refresh deliveries
      </Button>
    </div>
    <div className="flex flex-wrap gap-3">
      {fixedProjectId == null && <Select value={project} onValueChange={value => { setProject(value); setPage(0); }}>
        <SelectTrigger className="w-[220px]" aria-label="Delivery project"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All projects</SelectItem>
          {projects.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}</SelectContent>
      </Select>}
      <Select value={status} onValueChange={value => { setStatus(value); setPage(0); }}>
        <SelectTrigger className="w-[180px]" aria-label="Delivery status"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All delivery states</SelectItem>
          {["pending","processing","retrying","delivered","failed","paused"].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {list.isLoading && <p className="text-sm text-muted-foreground">Loading deliveries…</p>}
    {list.isError && <p className="text-sm text-destructive" role="alert">{list.error.message}</p>}
    {list.data?.deliveries.length === 0 && <p className="text-sm text-muted-foreground">No deliveries match these filters. Earlier API calls are available in the attempt history below.</p>}
    <div className="space-y-3">{list.data?.deliveries.map(delivery => <div key={delivery.id} className="rounded-md border p-3 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2"><Badge variant={delivery.status === "failed" ? "destructive" : "outline"}>{delivery.status}</Badge>
          <span className="font-medium">{delivery.projectName} · WO {delivery.customerWoId || delivery.workOrderId}</span></div>
        <span className="text-xs text-muted-foreground">{date(delivery.createdAt)}</span>
      </div>
      <p className="text-sm text-muted-foreground">{delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}
        {delivery.lastResponseStatus != null && ` · HTTP ${delivery.lastResponseStatus}`}
        {["pending","retrying","paused"].includes(delivery.status) && ` · Next check: ${date(delivery.nextAttemptAt)}`}</p>
      {delivery.lastError && <p className="text-sm text-destructive break-words">{delivery.lastError}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => setSelected(delivery)}>View attempts</Button>
        {isAdmin && ["failed","retrying","paused"].includes(delivery.status) && <Button size="sm" disabled={retry.isPending}
          onClick={() => retry.mutate(delivery.id)} data-testid={`button-retry-delivery-${delivery.id}`}>Retry delivery</Button>}
      </div>
    </div>)}</div>
    {list.data && list.data.total > 25 && <div className="flex items-center gap-3 text-sm">
      <Button size="sm" variant="outline" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
      <span>Page {page + 1} of {Math.ceil(list.data.total / 25)}</span>
      <Button size="sm" variant="outline" disabled={(page + 1) * 25 >= list.data.total} onClick={() => setPage(p => p + 1)}>Next</Button>
    </div>}
    <Dialog open={!!selected} onOpenChange={open => { if (!open) setSelected(null); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Delivery attempts · WO {selected?.customerWoId || selected?.workOrderId}</DialogTitle></DialogHeader>
        <p className="text-xs text-muted-foreground break-all">Delivery ID: {selected?.id}</p>
        {attempts.isLoading && <p>Loading attempts…</p>}
        {attempts.isError && <p className="text-destructive" role="alert">{attempts.error.message}</p>}
        {attempts.data?.length === 0 && <p className="text-muted-foreground">No attempts yet. The delivery is queued or paused.</p>}
        {attempts.data?.map(attempt => <div className="border rounded-md p-3 space-y-2" key={attempt.id}>
          <p className="font-medium">Attempt {attempt.attemptNumber} · {attempt.success ? "Success" : "Failed"} · {attempt.responseStatus == null ? "No HTTP response" : `HTTP ${attempt.responseStatus}`}</p>
          <p className="text-xs text-muted-foreground">{date(attempt.createdAt)} · {attempt.triggeredBy?.startsWith("manual:") ? "Admin retry" : "Automatic"}</p>
          <p className="text-sm break-all">{attempt.requestUrl}</p>
          {attempt.errorMessage && <p className="text-sm text-destructive break-words">{attempt.errorMessage}</p>}
          <details><summary className="cursor-pointer text-sm">Request payload (image data summarized)</summary>
            <pre className="mt-2 p-2 rounded bg-muted text-xs whitespace-pre-wrap break-all">{readablePayload(attempt.requestPayload)}</pre></details>
          <details><summary className="cursor-pointer text-sm">Response body</summary>
            <pre className="mt-2 p-2 rounded bg-muted text-xs whitespace-pre-wrap break-all">{attempt.responseBody || "No response body"}</pre></details>
        </div>)}
      </DialogContent>
    </Dialog>
  </section>;
}
