import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CustomerApiLog } from "@shared/schema";
import { CustomerApiDeliveries, readablePayload } from "@/components/customer-api-deliveries";
import { formatDateTimeInTimezone } from "@/lib/timezone";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, ChevronDown, ChevronRight, RefreshCw, XCircle } from "lucide-react";

export function ProjectCustomerApiLogs({ projectId, timezone, isAdmin }: {
  projectId: number; timezone: string; isAdmin: boolean;
}) {
  const [status, setStatus] = useState("all");
  const [expanded, setExpanded] = useState<number | null>(null);
  const history = useQuery<CustomerApiLog[]>({
    queryKey: ["/api/customer-api-logs", projectId, status],
    queryFn: async () => {
      const params = new URLSearchParams({ projectId: String(projectId), limit: "100" });
      if (status !== "all") params.set("success", String(status === "success"));
      const response = await fetch(`/api/customer-api-logs?${params}`, { credentials: "include" });
      if (!response.ok) throw new Error(`Unable to load API attempt history (${response.status}).`);
      return response.json();
    },
    enabled: Number.isInteger(projectId) && projectId > 0,
    refetchInterval: 5000,
  });

  return <Card className="min-w-0" data-testid="project-customer-api-logs">
    <CardHeader>
      <CardTitle>Customer API Logs</CardTitle>
      <CardDescription>Track this project's deliveries, retry failures, and inspect completion and trouble-report attempts. Times use {timezone}.</CardDescription>
    </CardHeader>
    <CardContent className="min-w-0 space-y-4">
      <CustomerApiDeliveries isAdmin={isAdmin} projects={[]} fixedProjectId={projectId} timezone={timezone} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold">Attempt history</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => history.refetch()} disabled={history.isFetching}
          data-testid="button-refresh-api-logs"><RefreshCw className="mr-2 h-4 w-4" />Refresh history</Button>
      </div>
      <Select value={status} onValueChange={value => { setStatus(value); setExpanded(null); }}>
        <SelectTrigger className="w-full sm:w-44" aria-label="API attempt status" data-testid="select-api-log-status-filter"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="success">Success</SelectItem>
          <SelectItem value="failed">Failed</SelectItem>
        </SelectContent>
      </Select>
      {history.isLoading && <p className="text-sm text-muted-foreground">Loading attempt history…</p>}
      {history.isError && <p role="alert" className="text-sm text-destructive">{history.error.message}</p>}
      {history.data?.length === 0 && <p className="text-sm text-muted-foreground">No API attempts match these filters. New attempts appear after a queued delivery runs.</p>}
      <div className="space-y-2">
        {history.data?.map(log => <Collapsible key={log.id} open={expanded === log.id} onOpenChange={open => setExpanded(open ? log.id : null)}
          className="min-w-0 rounded-md border">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex w-full min-w-0 items-center gap-3 rounded-md p-3 text-left hover:bg-muted/50"
              data-testid={`row-api-log-${log.id}`}>
              {expanded === log.id ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />}
              {log.success ? <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  <span>WO #{log.workOrderId}</span>
                  {log.responseStatus != null && <Badge variant={log.success ? "outline" : "destructive"}>HTTP {log.responseStatus}</Badge>}
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">{formatDateTimeInTimezone(log.createdAt, timezone)}</span>
              </span>
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="min-w-0 space-y-3 border-t bg-muted/30 p-3">
              {log.errorMessage && <div><h4 className="text-xs font-medium">Error message</h4><p className="mt-1 break-words text-sm text-destructive">{log.errorMessage}</p></div>}
              <div><h4 className="text-xs font-medium">Request URL</h4><p className="mt-1 break-all font-mono text-xs">{log.requestUrl || "Not configured"}</p></div>
              <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
                <div className="min-w-0"><h4 className="text-xs font-medium">Request payload</h4>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{log.requestPayload ? readablePayload(log.requestPayload) : "No request payload"}</pre></div>
                <div className="min-w-0"><h4 className="text-xs font-medium">Response body</h4>
                  <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-2 font-mono text-xs">{log.responseBody ? readablePayload(log.responseBody) : "No response body"}</pre></div>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>)}
      </div>
    </CardContent>
  </Card>;
}
