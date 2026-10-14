import { useQuery } from "@tanstack/react-query";
import { Link, useRoute } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export type ExtensionNavigation = {id:string;name:string;version:string;screens:{id:string;title:string;report:string}[]};
export function useCustomerExtensions() {
  return useQuery<ExtensionNavigation[]>({queryKey:["/api/customer-extensions"]});
}
export default function CustomerExtension() {
  const [,params]=useRoute("/extensions/:extensionId/:screenId");
  const catalog=useCustomerExtensions();
  const extension=catalog.data?.find(x=>x.id===params?.extensionId);
  const screen=extension?.screens.find(s=>s.id===params?.screenId);
  const report=useQuery<{title:string;columns:string[];rows:(string|number|boolean|null)[][]}>({
    queryKey:[`/api/customer-extensions/${encodeURIComponent(extension?.id ?? "")}/reports/${encodeURIComponent(screen?.report ?? "")}`],
    enabled:!!screen,
  });
  return <main className="p-6 space-y-5">
    <Link href="/" className="text-sm text-primary">Back to Dashboard</Link>
    {catalog.isLoading || report.isLoading && !!screen ? <Skeleton className="h-40 w-full" /> :
      !screen ? <p role="alert">This customer screen is unavailable or you do not have permission to view it.</p> :
      report.isError ? <p role="alert">The customer report could not be loaded. Contact its maintainer.</p> :
      <Card><CardHeader><CardTitle>{report.data?.title ?? screen.title}</CardTitle>
        <p className="text-sm text-muted-foreground">Customer extension · {extension?.name} · {extension?.version}</p>
      </CardHeader><CardContent>
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr>{report.data?.columns.map((c,i)=><th key={i} className="text-left p-3 border-b">{c}</th>)}</tr></thead>
          <tbody>{report.data?.rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} className="p-3 border-b">{c === null ? "" : String(c)}</td>)}</tr>)}</tbody>
        </table></div>
        {report.data?.rows.length===0 && <p className="py-4 text-muted-foreground">No records are available in your authorized scope.</p>}
      </CardContent></Card>}
  </main>;
}
