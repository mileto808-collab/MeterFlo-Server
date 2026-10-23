import { useInventoryHistory } from "@/hooks/use-inventory-history";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { VehicleStockDirectory, VehicleStockLocation, VehicleStockResponse, VehicleStockSerials } from "@shared/inventory-vehicle-stock";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useInventoryEvents } from "@/hooks/useInventoryEvents";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertTriangle, Boxes, ChevronDown, ChevronUp, Printer, RefreshCw, Search, Truck } from "lucide-react";

const directoryKey = ["/api/inventory/vehicles", "vehicle-stock"];
const accessStatuses = [401, 403, 404, 423];
const errorStatus = (error: unknown) => Number((error instanceof Error ? error.message : "").match(/^\s*(\d{3}):/)?.[1] ?? 0);
const stockPrefix = (projectId: number) => `/api/projects/${projectId}/inventory/vehicle-stock`;
const vehicleIdentity = (vehicle: VehicleStockLocation) => `${vehicle.projectId}:${vehicle.id}`;
const vehicleKey = (userId: string, projectId: number, vehicle: string, q: string, offset: number) =>
  [stockPrefix(projectId), userId, vehicle, q, offset, 25] as const;
const serialKey = (userId: string, projectId: number, vehicle: string, item: string, q: string, offset: number) =>
  [`${stockPrefix(projectId)}/serials`, userId, vehicle, item, q, offset, 50] as const;

function printHref(path: string, params: Record<string, string>) {
  const query = new URLSearchParams(params);
  return `${path}?${query.toString()}`;
}

function clearVehicleStockCache(projectId: number, userId: string) {
  const prefix = stockPrefix(projectId);
  const predicate = (query: { queryKey: readonly unknown[] }) => typeof query.queryKey[0] === "string" &&
      (query.queryKey[0] === prefix || query.queryKey[0].startsWith(`${prefix}/`)) &&
      query.queryKey[1] === userId;
  // Erasing an actively fetching query prevents its error from settling and
  // leaves Refresh disabled. Empty sensitive results first; remove idle queries.
  queryClient.setQueriesData({ predicate }, (data: unknown) =>
    data && typeof data === "object" ? { ...data, rows: [], serials: [], total: 0, filtered: 0, quantity: 0, reserved: 0 } : data);
  queryClient.removeQueries({ predicate: query => predicate(query) && query.getObserversCount() === 0 });
}

function timestamp(value: string | undefined, timezone: string) {
  if (!value) return "Not refreshed";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not refreshed";
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(date);
  } catch {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(date);
  }
}

function useVehicleDirectory(userId: string, projectId: number | undefined, enabled: boolean) {
  return useQuery<VehicleStockDirectory>({
    queryKey: [...directoryKey, userId, projectId ?? "all"],
    queryFn: async () => {
      const params = projectId ? `?projectId=${projectId}` : "";
      try {
        return await (await apiRequest("GET", `/api/inventory/vehicles${params}`)).json() as VehicleStockDirectory;
      } catch (error) {
        if (accessStatuses.includes(errorStatus(error))) {
          queryClient.setQueryData([...directoryKey, userId, projectId ?? "all"], { vehicles: [], generatedAt: "" });
        }
        throw error;
      }
    },
    staleTime: 0,
    enabled,
    refetchOnWindowFocus: "always",
    refetchInterval: 60_000,
    retry: false,
  });
}

export function VehicleStockReview({ projectId }: { projectId?: number }) {
  const { user } = useAuth();
  const { hasPermission, isLoading } = usePermissions();
  const userId = String(user?.id ?? "pending");
  const allowed = !isLoading && !!user?.id && hasPermission("inventory.view");
  const directory = useVehicleDirectory(userId, projectId, allowed);
  const vehicles = useMemo(() => directory.data?.vehicles ?? [], [directory.data?.vehicles]);
  const memoryKey = `meterflo:vehicle-stock:${encodeURIComponent(userId)}:${projectId ?? "all"}`;
  const [selectedVehicleKey, setSelectedVehicleKey] = useState("");
  const [memoryReady, setMemoryReady] = useState(false);
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedItem, setExpandedItem] = useState("");
  const [serialSearch, setSerialSearch] = useState("");
  const [serialOffset, setSerialOffset] = useState(0);
  const scanSequence = useRef({ at: 0, count: 0 });
  const previousDirectoryVehicles = useRef<VehicleStockLocation[]>([]);
  const selectedVehicle = vehicles.find(vehicle => vehicleIdentity(vehicle) === selectedVehicleKey);
  const selectedIdentity = selectedVehicle ? vehicleIdentity(selectedVehicle) : "";
  const live = useInventoryEvents(allowed && selectedVehicle ? selectedVehicle.projectId : null);

  useEffect(() => {
    setMemoryReady(false);
    setSelectedVehicleKey("");
    setSearch("");
    setOffset(0);
    setExpandedItem("");
    try { setSelectedVehicleKey(window.localStorage.getItem(memoryKey) ?? ""); } catch { /* Storage is optional. */ }
    setMemoryReady(true);
  }, [memoryKey]);

  useEffect(() => {
    if (directory.data && selectedVehicleKey && !vehicles.some(vehicle => vehicleIdentity(vehicle) === selectedVehicleKey)) {
      const revoked = previousDirectoryVehicles.current.find(vehicle => vehicleIdentity(vehicle) === selectedVehicleKey);
      if (revoked) clearVehicleStockCache(revoked.projectId, userId);
      setSelectedVehicleKey("");
      setExpandedItem("");
      setSerialSearch("");
      setSerialOffset(0);
    }
    previousDirectoryVehicles.current = vehicles;
  }, [directory.data, selectedVehicleKey, userId, vehicles]);

  useEffect(() => {
    if (!memoryReady || !directory.data) return;
    const defaultVehicle = vehicles.find(vehicle => vehicle.projectId === projectId) ?? vehicles[0];
    const safeChoice = vehicles.some(vehicle => vehicleIdentity(vehicle) === selectedVehicleKey)
      ? selectedVehicleKey
      : defaultVehicle ? vehicleIdentity(defaultVehicle) : "";
    if (safeChoice !== selectedVehicleKey) setSelectedVehicleKey(safeChoice);
    try {
      if (safeChoice) window.localStorage.setItem(memoryKey, safeChoice);
      else window.localStorage.removeItem(memoryKey);
    } catch { /* Storage is optional. */ }
  }, [directory.data, memoryReady, memoryKey, projectId, selectedVehicleKey, vehicles]);

  const selectedProjectId = selectedVehicle?.projectId ?? 0;
  const accessLost = () => {
    queryClient.setQueryData<VehicleStockDirectory>([...directoryKey, userId, projectId ?? "all"],
      current => current && { ...current, vehicles: current.vehicles.filter(vehicle =>
        vehicle.projectId !== selectedProjectId || vehicle.id !== selectedVehicle?.id) });
    clearVehicleStockCache(selectedProjectId, userId);
    void directory.refetch();
  };
  const normalizedSearch = search.trim();
  const stock = useQuery<VehicleStockResponse>({
    queryKey: selectedVehicle ? vehicleKey(userId, selectedProjectId, selectedVehicle.id, normalizedSearch, offset) : ["vehicle-stock", "disabled"],
    enabled: allowed && !!selectedVehicle && !directory.isError,
    queryFn: async () => {
      const params = new URLSearchParams({ vehicle: selectedVehicle!.id, q: normalizedSearch, offset: String(offset), limit: "25" });
      try { return await (await apiRequest("GET", `${stockPrefix(selectedProjectId)}?${params}`)).json() as VehicleStockResponse; }
      catch (error) {
        if (accessStatuses.includes(errorStatus(error))) accessLost();
        throw error;
      }
    },
    staleTime: 0, retry: false,
    refetchInterval: query => live.status === "live" && !query.state.error ? false : 30_000,
  });
  const serial = useQuery<VehicleStockSerials>({
    queryKey: expandedItem && selectedVehicle ? serialKey(userId, selectedProjectId, selectedVehicle.id, expandedItem, serialSearch.trim(), serialOffset) : ["vehicle-stock-serials", "disabled"],
    enabled: allowed && !!expandedItem && !!selectedVehicle && !directory.isError && !stock.isError,
    queryFn: async () => {
      const params = new URLSearchParams({ vehicle: selectedVehicle!.id, item: expandedItem, q: serialSearch.trim(), offset: String(serialOffset), limit: "50" });
      try { return await (await apiRequest("GET", `${stockPrefix(selectedProjectId)}/serials?${params}`)).json() as VehicleStockSerials; }
      catch (error) {
        if (accessStatuses.includes(errorStatus(error))) accessLost();
        throw error;
      }
    },
    staleTime: 0, retry: false,
  });

  useEffect(() => {
    setOffset(0);
    setExpandedItem("");
  }, [selectedVehicleKey, normalizedSearch]);
  useEffect(() => setSerialOffset(0), [serialSearch, expandedItem]);

  if (!allowed) return null;
  const currentResponse = !selectedVehicle || stock.isError || stock.data?.vehicle.id !== selectedVehicle.id ||
    stock.data.vehicle.projectId !== selectedProjectId ? undefined : stock.data;
  const printSelected = () => {
    if (!selectedVehicle) return;
    window.open(printHref(`${stockPrefix(selectedProjectId)}/print`, { vehicle: selectedVehicle.id, q: normalizedSearch }), "_blank", "noopener,noreferrer");
  };
  const printAll = () => {
    const params: Record<string, string> = projectId ? { projectId: String(projectId) } : {};
    if (normalizedSearch) params.q = normalizedSearch;
    window.open(printHref("/api/inventory/vehicles/print", params), "_blank", "noopener,noreferrer");
  };
  const resetSearch = () => { setSearch(""); setOffset(0); };

  return <section className="mx-auto min-w-0 w-full max-w-5xl shrink-0" data-testid="vehicle-stock-review">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b pb-4 sm:mb-6 sm:pb-6">
      <div className="min-w-0">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.15em] text-primary">Read-only · system expected</p>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl"><Truck className="h-6 w-6 text-primary" />Vehicle Stock</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Expected inventory onboard each accessible vehicle. This is not a physical count; staged pickup stock is not onboard until warehouse handoff.</p>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => { void directory.refetch(); if (!directory.isError && selectedVehicle) void stock.refetch(); }} disabled={directory.isFetching || stock.isFetching} aria-label="Refresh vehicle stock" data-testid="vehicle-stock-refresh">
          <RefreshCw className={`mr-1.5 h-4 w-4 ${directory.isFetching ? "animate-spin" : ""}`} />Refresh
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={printAll} disabled={directory.isError || !vehicles.length} data-testid="vehicle-stock-print-all"><Printer className="mr-1.5 h-4 w-4" />Print all</Button>
      </div>
    </div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium" data-testid="vehicle-stock-live-state">
        <span className={`h-2 w-2 rounded-full ${live.status === "live" ? "bg-emerald-600" : live.status === "reconnecting" ? "bg-amber-500" : "bg-muted-foreground"}`} />
        {directory.isError ? "Vehicle access stale" : stock.isError ? "Stock stale · refresh failed" : !selectedVehicle ? "Choose a vehicle" :
          live.status === "live" ? "Live updates" : live.status === "reconnecting" ? "Stock may be stale · reconnecting" :
            live.status === "unavailable" ? "Stock may be stale · live updates unavailable" : "Connecting"}
      </span>
      {selectedVehicle && <p className="text-xs text-muted-foreground">Refreshed {timestamp(currentResponse?.generatedAt, selectedVehicle.timezone)} · {selectedVehicle.timezone}</p>}
    </div>
    {directory.isLoading && <div className="space-y-3"><Skeleton className="h-12 w-full" /><Skeleton className="h-24 w-full" /><Skeleton className="h-48 w-full" /></div>}
    {directory.isError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Vehicle access could not be refreshed</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Vehicle access is required to show stock. No cached vehicle stock is presented as current.</span><Button type="button" size="sm" variant="outline" onClick={() => void directory.refetch()}>Retry</Button></AlertDescription></Alert>}
    {!directory.isLoading && !directory.isError && vehicles.length === 0 && <div className="rounded-xl border border-dashed px-5 py-12 text-center"><Boxes className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">No accessible vehicles</p><p className="mt-1 text-sm text-muted-foreground">Vehicles appear here when project and location access is assigned.</p></div>}
    {!directory.isLoading && !directory.isError && vehicles.length > 0 && <>
      <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(15rem,2fr)]">
        <div className="space-y-1.5"><label htmlFor="vehicle-stock-picker" className="text-sm font-medium">Vehicle</label>
          <Select value={selectedVehicleKey} onValueChange={value => { setSelectedVehicleKey(value); setOffset(0); }}>
          <SelectTrigger id="vehicle-stock-picker" aria-label="Choose vehicle" data-testid="vehicle-stock-picker"><SelectValue placeholder="Choose a vehicle" /></SelectTrigger>
            <SelectContent>{vehicles.map(vehicle => <SelectItem key={vehicleIdentity(vehicle)} value={vehicleIdentity(vehicle)}>{vehicle.code} · {vehicle.name} — {vehicle.projectName}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5"><label htmlFor="vehicle-stock-search" className="text-sm font-medium">Search items or scan a barcode</label>
          <div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input id="vehicle-stock-search" data-testid="vehicle-stock-search" value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} onKeyDown={event => {
              const now = event.timeStamp;
              if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
                scanSequence.current = now - scanSequence.current.at < 45
                  ? { at: now, count: scanSequence.current.count + 1 }
                  : { at: now, count: 1 };
              } else if (event.key === "Tab" && scanSequence.current.count >= 4 && now - scanSequence.current.at < 120) {
                event.preventDefault();
                scanSequence.current = { at: 0, count: 0 };
              } else if (event.key === "Enter" || event.key === "Tab") {
                scanSequence.current = { at: 0, count: 0 };
                setOffset(0);
              }
            }} className="pl-9 pr-20" placeholder="Item name, SKU, or barcode" autoComplete="off" />
            {search && <Button type="button" variant="ghost" size="sm" className="absolute right-1 top-1/2 h-8 -translate-y-1/2 px-2" onClick={resetSearch}>Clear</Button>}
          </div>
          <p className="text-xs text-muted-foreground">Scanner input is accepted in this field. Enter or Tab applies the search.</p>
        </div>
      </div>
      {stock.isError && <Alert variant="destructive"><AlertTitle>Stock could not be refreshed</AlertTitle><AlertDescription className="flex flex-wrap items-center justify-between gap-3"><span>Current vehicle stock is unavailable. Previously cached values are hidden until access and connection recover.</span><Button type="button" size="sm" variant="outline" onClick={() => void stock.refetch()}>Retry</Button></AlertDescription></Alert>}
      {stock.isLoading && <div className="space-y-3"><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /><Skeleton className="h-16 w-full" /></div>}
      {currentResponse && <Card className="min-w-0 overflow-hidden">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0 border-b bg-muted/20 p-4 sm:p-5">
          <div><CardTitle className="text-lg">{selectedVehicle?.name} <span className="font-mono text-sm font-normal text-muted-foreground">{selectedVehicle?.code}</span></CardTitle><CardDescription>{selectedVehicle?.projectName} · {currentResponse.filtered} matching stock lines</CardDescription></div>
          <Button type="button" size="sm" variant="outline" onClick={printSelected} data-testid="vehicle-stock-print"><Printer className="mr-1.5 h-4 w-4" />Print vehicle</Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid grid-cols-3 border-b bg-muted/20 text-center text-xs sm:text-sm">
            <div className="p-3"><p className="text-muted-foreground">Onboard</p><p className="font-mono text-base font-semibold">{currentResponse.quantity}</p></div>
            <div className="border-x p-3"><p className="text-muted-foreground">Reserved</p><p className="font-mono text-base font-semibold">{currentResponse.reserved}</p></div>
            <div className="p-3"><p className="text-muted-foreground">Available</p><p className="font-mono text-base font-semibold">{currentResponse.quantity - currentResponse.reserved}</p></div>
          </div>
          {!currentResponse.rows.length ? <div className="px-5 py-10 text-center"><Boxes className="mx-auto mb-2 h-7 w-7 text-muted-foreground" /><p className="font-medium">No matching onboard stock</p><p className="text-sm text-muted-foreground">{normalizedSearch ? "Try another item or serial search." : "This vehicle has no expected stock lines."}</p></div> :
            <div className="divide-y">{currentResponse.rows.map(row => <article key={`${selectedIdentity}:${row.itemId}`} data-testid={`vehicle-stock-item-${row.itemId}`} className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <button type="button" className="min-w-0 w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:w-auto sm:flex-1" onClick={() => {
                  setExpandedItem(expandedItem === row.itemId ? "" : row.itemId);
                  setSerialSearch(""); setSerialOffset(0);
                }} aria-expanded={expandedItem === row.itemId} aria-label={`${expandedItem === row.itemId ? "Hide" : "Show"} serials for ${row.item.name}`}>
                  <span className="flex min-w-0 items-center gap-2 font-medium">{expandedItem === row.itemId ? <ChevronUp className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}<span className="truncate">{row.item.name}</span></span>
                  <span className="mt-1 block break-all pl-6 font-mono text-xs text-muted-foreground">{row.item.sku} · {row.item.category || "Uncategorised"}</span>
                </button>
                <div className="flex min-w-0 w-full items-center justify-between gap-4 text-right sm:min-w-[12rem] sm:w-auto sm:justify-end">
                  <span className="text-xs text-muted-foreground">Onboard<br /><b className="font-mono text-sm text-foreground">{row.quantity} {row.item.unit}</b></span>
                  <span className="text-xs text-muted-foreground">Reserved<br /><b className="font-mono text-sm text-foreground">{row.reserved}</b></span>
                  <span className="text-xs text-muted-foreground">Available<br /><b className="font-mono text-sm text-primary">{row.available}</b></span>
                </div>
                {row.serialCount > 0 && <Badge variant="secondary" className="w-full justify-center sm:w-auto">{row.serialCount} serial{row.serialCount === 1 ? "" : "s"}</Badge>}
              </div>
              {expandedItem === row.itemId && row.serialCount > 0 && <div className="border-t bg-muted/15 px-4 py-3 sm:px-5 sm:pl-12">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><p className="text-sm font-medium">Onboard serials <span className="font-normal text-muted-foreground">· loaded on request</span></p>
                  <div className="flex w-full gap-2 sm:w-auto"><Input aria-label="Search serials" placeholder="Filter serials" value={serialSearch} onChange={event => setSerialSearch(event.target.value)} className="h-9 sm:w-56" />{serialSearch && <Button type="button" variant="outline" size="sm" onClick={() => setSerialSearch("")}>Clear</Button>}</div>
                </div>
                {serial.isError && <p role="alert" className="mb-2 text-sm text-destructive">Serials could not be refreshed. Retry to view current serials.</p>}
                {serial.isLoading ? <div className="space-y-2"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-2/3" /></div> :
                  !serial.isError && <><div className="flex flex-wrap gap-2">{serial.data?.serials.map((value, index) => <code key={`${selectedIdentity}:${expandedItem}:${value}:${index}`} className="max-w-full break-all rounded-md border bg-background px-2 py-1 text-xs">{value}</code>)}</div>
                    {!serial.data?.serials.length && <p className="text-sm text-muted-foreground">No matching serials.</p>}
                    <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground"><span>{serial.data?.filtered ?? 0} matching</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" disabled={serialOffset === 0} onClick={() => setSerialOffset(value => Math.max(0, value - 50))}>Previous</Button><Button type="button" variant="outline" size="sm" disabled={!serial.data || serialOffset + 50 >= serial.data.filtered} onClick={() => setSerialOffset(value => value + 50)}>Next</Button></div></div></>}
              </div>}
            </article>)}</div>}
          <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
            <span className="text-muted-foreground">Showing {currentResponse.rows.length ? offset + 1 : 0}–{offset + currentResponse.rows.length} of {currentResponse.filtered}</span>
            <div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 25))}>Previous</Button><Button type="button" size="sm" variant="outline" disabled={offset + 25 >= currentResponse.filtered} onClick={() => setOffset(value => value + 25)}>Next</Button></div>
          </div>
        </CardContent>
      </Card>}
    </>}
    <p className="mt-4 text-xs leading-5 text-muted-foreground">Vehicle stock is the system-expected balance, not a physical verification. Ready-for-pickup items remain at staging until handoff is recorded; they are not counted as onboard stock.</p>
  </section>;
}

export function VehicleStockButton() {
  const { hasPermission, isLoading } = usePermissions();
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<number | undefined>();
  const canView = !isLoading && hasPermission("inventory.view");
  useInventoryHistory("vehicle-stock-dialog", open, setOpen, { enabled: canView });
  useEffect(() => {
    const openReview = () => {
      const match = window.location.pathname.match(/^\/projects\/(\d+)\/inventory/);
      setScope(match ? Number(match[1]) : undefined);
      setOpen(true);
    };
    window.addEventListener("meterflo:open-vehicle-stock", openReview);
    return () => window.removeEventListener("meterflo:open-vehicle-stock", openReview);
  }, []);
  if (!canView) return null;
  return <>
    <Button type="button" variant="outline" size="sm" className="gap-2" aria-label="Open Vehicle Stock" data-testid="button-vehicle-stock"
      onClick={() => { const match = window.location.pathname.match(/^\/projects\/(\d+)\/inventory/); setScope(match ? Number(match[1]) : undefined); setOpen(true); }}>
      <Truck className="h-4 w-4" /><span className="hidden sm:inline">Vehicle Stock</span>
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="flex min-w-0 max-h-[min(94dvh,58rem)] w-[calc(100vw_-_1rem)] max-w-5xl flex-col overflow-hidden p-3 sm:p-6">
        <DialogHeader className="shrink-0"><DialogTitle className="sr-only">Vehicle Stock</DialogTitle><DialogDescription className="sr-only">Read-only system-expected vehicle inventory.</DialogDescription></DialogHeader>
        {open && <div className="min-h-0 min-w-0 flex-1 overflow-y-auto"><VehicleStockReview key={scope ?? "all"} projectId={scope} /></div>}
      </DialogContent>
    </Dialog>
  </>;
}

