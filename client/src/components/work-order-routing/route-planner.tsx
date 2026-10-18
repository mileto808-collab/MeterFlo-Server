import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, Check, ChevronRight, Loader2, Map, MapPin, Navigation, Route, Settings2 } from "lucide-react";
import type { ProjectWorkOrder } from "../../../../server/projectDb";
import type { AddressReview, DispatchedRouteSummary, RoutePoint, RoutingReadiness, RoutingResult } from "@shared/workOrderRouting";
import { navigationLinks } from "@shared/workOrderRouting";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useToast } from "@/hooks/use-toast";
import { usePageHeader } from "@/contexts/page-header-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { RoutingSettings } from "./routing-settings";
import { AddressMatchReviewPanel } from "./address-match-review";
import { routeSessionStorage as sessionStorage } from "./session-storage";
import { writeRoutePrintDocument } from "./route-print";

type DisplayMode = "list" | "map" | "both";
type OriginChoice = RoutePoint | { address: string };
type OriginWarehouse = { id: string; name: string; address: string };
type PlanningRequest = { ids: number[]; origin: OriginChoice; departureAt: string; serviceMinutes: number; toleranceMinutes: number };
type Props = {
  projectId: number;
  projectName: string;
  timezone: string;
  defaultServiceMinutes?: number | null;
  defaultAppointmentToleranceMinutes?: number | null;
  workOrders: ProjectWorkOrder[];
  selectedIds: number[];
  onOpenWorkOrder: (workOrder: ProjectWorkOrder) => void;
  onBack: () => void;
};
type MapConfig = { provider: "google" | "geoapify"; browserKey: string };
type PlanningStop = RoutingResult["stops"][number] & {
  serviceDurationMinutes: number;
  durationSource: "work-order" | "project" | "route" | "legacy";
  appointmentWindowStart: string | null;
  appointmentWindowEnd: string | null;
  appointmentSource: "window" | "scheduled" | "none";
  waitingMinutes: number;
};
type PlanningResult = Omit<RoutingResult, "stops"> & { stops: PlanningStop[] };
const hasRoutePlanningMetadata = (route: RoutingResult): route is PlanningResult =>
  route.addressReviewVersion === 1 && Array.isArray(route.stops) && route.stops.every(stop => {
    const value = stop as PlanningStop;
    return Number.isInteger(value.serviceDurationMinutes) && value.serviceDurationMinutes >= 1 && value.serviceDurationMinutes <= 480 &&
      ["work-order", "project", "route", "legacy"].includes(value.durationSource) &&
      ["window", "scheduled", "none"].includes(value.appointmentSource) &&
      Number.isFinite(value.waitingMinutes) && value.waitingMinutes >= 0 &&
      (value.appointmentWindowStart === null || typeof value.appointmentWindowStart === "string") &&
      (value.appointmentWindowEnd === null || typeof value.appointmentWindowEnd === "string");
  });
const hasPlanningMetadata = (bundle: RoutingResult): boolean =>
  bundle.assignmentRoutingVersion === 1 &&
  bundle.addressReviewVersion === 1 &&
  Array.isArray(bundle.scopeIds) &&
  bundle.scopeIds.length > 0 &&
  bundle.scopeIds.every(id => Number.isInteger(id) && id > 0) &&
  new Set(bundle.scopeIds).size === bundle.scopeIds.length &&
  Array.isArray(bundle.routes) &&
  bundle.routes.length > 0 &&
  new Set(bundle.routes.map(route => route.assigneeId)).size === bundle.routes.length &&
  bundle.routes.every(route =>
    typeof route.assigneeId === "string" && !!route.assigneeId.trim() &&
    typeof route.assigneeName === "string" && !!route.assigneeName.trim() &&
    route.projectId === bundle.projectId &&
    Number.isFinite(route.origin?.lat) && Number.isFinite(route.origin?.lng) &&
    Array.isArray(route.geometry) &&
    route.geometry.every(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)) &&
    Array.isArray(route.warnings) &&
    Array.isArray(route.excluded) &&
    route.stops.every(stop => bundle.scopeIds!.includes(stop.id)) &&
    hasRoutePlanningMetadata(route) &&
    (!route.stops.length || route.geometry.length > 0)
  ) &&
  Array.isArray(bundle.excluded) &&
  bundle.excluded.every(item => bundle.scopeIds!.includes(item.id));

const errorMessage = async (response: Response) => {
  try { const payload = await response.json(); return payload.message || payload.error || "Route request failed"; }
  catch { return `Route request failed (${response.status})`; }
};
const routeRequestIds = (route: RoutingResult) => route.scopeIds ?? [];
const routeExpired = (route: RoutingResult) => {
  const expiresAt = Date.parse(route.expiresAt);
  return !Number.isFinite(expiresAt) || Date.now() >= expiresAt;
};
const localInputForTimezone = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
};
import { isoFromZonedInput } from "@/lib/project-scheduling-time";

function MapView({ projectId, result, config, retryKey, configError }: { projectId: number; result: RoutingResult; config: MapConfig | undefined; retryKey: number; configError?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    if (!host.current || !config || !result.geometry.length || config.provider === "google" || config.provider !== result.provider) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    setFailure("");
    const loadScript = (src: string, id: string) => new Promise<void>((resolve, reject) => {
      const existing = document.getElementById(id) as HTMLScriptElement | null;
      if (existing?.dataset.loaded === "true") { resolve(); return; }
      if (existing) {
        existing.remove();
      }
      const script = document.createElement("script");
      script.id = id; script.src = src; script.async = true;
      const timeout = window.setTimeout(() => { script.remove(); reject(new Error("Map library loading timed out. Check your network and try again.")); }, 12000);
      script.onload = () => { window.clearTimeout(timeout); script.dataset.loaded = "true"; resolve(); };
      script.onerror = () => { window.clearTimeout(timeout); script.remove(); reject(new Error("Map library failed to load. Check your network and try again.")); };
      document.head.appendChild(script);
    });
    const loadCss = (href: string, id: string) => {
      if (!document.getElementById(id)) { const link = document.createElement("link"); link.id = id; link.rel = "stylesheet"; link.href = href; document.head.appendChild(link); }
    };
    const render = async () => {
      try {
        if (!config.browserKey?.trim()) throw new Error("A public, restricted browser map key is not configured for this provider.");
        loadCss("https://unpkg.com/leaflet@1.9.4/dist/leaflet.css", "meterflo-leaflet-css");
        await loadScript("https://unpkg.com/leaflet@1.9.4/dist/leaflet.js", "meterflo-leaflet-js");
        if (cancelled) return;
        const L = (window as any).L;
        if (!L || !host.current) throw new Error("Geoapify map could not initialize. Check browser key restrictions.");
        const map = L.map(host.current, { scrollWheelZoom: false, zoomControl: true }).setView([result.origin.lat, result.origin.lng], 10);
        const tiles = L.tileLayer(`https://maps.geoapify.com/v1/tile/osm-carto/{z}/{x}/{y}.png?apiKey=${encodeURIComponent(config.browserKey)}`, { attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://www.geoapify.com/">Geoapify</a>', maxZoom: 20 });
        tiles.on("tileerror", () => { if (!cancelled) setFailure("Geoapify map tiles could not load. Check the public browser key, domain restrictions and tile quota."); });
        tiles.addTo(map);
        const latlngs = result.geometry.map(point => [point.lat, point.lng]);
        L.polyline(latlngs, { color: "#b54b2c", weight: 5, opacity: 0.94 }).addTo(map);
        result.stops.forEach((stop, index) => {
          const tooltip = document.createElement("span");
          tooltip.textContent = `${index + 1}. ${stop.label}`;
          L.marker([stop.point.lat, stop.point.lng], { icon: L.divIcon({ className: "meterflo-route-marker", html: `<span>${index + 1}</span>`, iconSize: [30, 30], iconAnchor: [15, 15] }) }).bindTooltip(tooltip).addTo(map);
        });
        map.fitBounds(L.latLngBounds(latlngs), { padding: [24, 24] });
        cleanup = () => map.remove();
      } catch (error) { if (!cancelled) setFailure(error instanceof Error ? error.message : "Map could not be loaded."); }
    };
    void render();
    return () => { cancelled = true; cleanup?.(); };
  }, [projectId, result, config, retryKey]);
  const googleMapHtml = useMemo(() => {
    if (config?.provider !== "google" || config.provider !== result.provider || !config.browserKey || !result.geometry.length) return "";
    const geometry = JSON.stringify(result.geometry).replace(/</g, "\\u003c");
    const stops = JSON.stringify(result.stops.map(stop => stop.point)).replace(/</g, "\\u003c");
    const callback = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#map{height:100%;margin:0;background:#f1ede6}.gm-error{font:14px system-ui;padding:22px;color:#55372d}</style></head><body><div id="map"></div><script>const geometry=${geometry};const stops=${stops};let loaded=false;function fail(){document.body.innerHTML='<p class="gm-error">Google Maps could not load. Check the restricted browser key, enabled Maps JavaScript API and network access.</p>'}window.gm_authFailure=fail;setTimeout(()=>{if(!loaded)fail()},15000);function initMap(){loaded=true;try{const map=new google.maps.Map(document.getElementById("map"),{center:geometry[0],zoom:10,mapTypeControl:false,streetViewControl:false,fullscreenControl:false});const bounds=new google.maps.LatLngBounds();const path=geometry.map(p=>{const v=new google.maps.LatLng(p.lat,p.lng);bounds.extend(v);return v});new google.maps.Polyline({path,geodesic:true,strokeColor:"#b54b2c",strokeOpacity:.94,strokeWeight:5,map});stops.forEach((p,i)=>{const v=new google.maps.LatLng(p.lat,p.lng);bounds.extend(v);new google.maps.Marker({position:v,map,label:String(i+1)});});map.fitBounds(bounds,36)}catch(e){fail()}}const script=document.createElement("script");script.src="https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.browserKey)}&callback=initMap";script.async=true;script.onerror=fail;document.head.appendChild(script);</script></body></html>`;
    return callback;
  }, [config, result]);
  if (config && config.provider !== result.provider) {
    return <div className="flex min-h-64 items-center justify-center rounded-xl border border-amber-300 bg-amber-50 p-6 text-center text-sm text-amber-950">The route’s provider configuration changed. Review the stale-route warning and re-plan before loading this map.</div>;
  }
  if (config?.provider === "google") {
    return <iframe key={retryKey} title="Google Maps road route" sandbox="allow-scripts allow-same-origin" referrerPolicy="strict-origin-when-cross-origin" srcDoc={googleMapHtml} className="h-[360px] w-full rounded-xl border bg-muted/30 sm:h-[480px]" data-testid="routing-map" />;
  }
  if (!config) return <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">{configError || "Map display is not configured."} The ordered route remains available in the stop list.</div>;
  return <div className="relative"><style>{`.meterflo-route-marker{background:transparent;border:0}.meterflo-route-marker span{display:flex;width:30px;height:30px;align-items:center;justify-content:center;border:2px solid #f7f0e7;border-radius:9999px;background:#b54b2c;color:#fff;font:700 13px/1 system-ui,sans-serif;box-shadow:0 2px 8px rgba(25,38,42,.28)}`}</style><div ref={host} className="h-[360px] w-full rounded-xl border bg-muted/30 sm:h-[480px]" data-testid="routing-map" />{failure && <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 rounded-xl bg-background/95 p-6 text-center"><AlertTriangle className="h-6 w-6 text-amber-700" /><p className="max-w-md text-sm">{failure}</p><p className="text-xs text-muted-foreground">The route geometry is still available as a list; no map is being represented as successfully loaded.</p></div>}</div>;
}

export function RoutePlanner({ projectId, projectName, timezone, defaultServiceMinutes, defaultAppointmentToleranceMinutes, workOrders, selectedIds, onOpenWorkOrder, onBack }: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const { toast } = useToast();
  const { setHeaderContent } = usePageHeader();
  const readinessUrl = `/api/projects/${projectId}/routing/settings`;
  const originsUrl = `/api/projects/${projectId}/routing/origins`;
  const { data: readiness, isLoading: readinessLoading, isError: readinessError, refetch } = useQuery<RoutingReadiness>({
    queryKey: [readinessUrl],
    queryFn: async () => { const response = await fetch(readinessUrl, { credentials: "include" }); if (!response.ok) throw new Error(await errorMessage(response)); return response.json(); },
  });
  const [setupOpen, setSetupOpen] = useState(true);
  const [mode, setMode] = useState<DisplayMode>("both");
  const [scope, setScope] = useState<"filtered" | "selected">("filtered");
  const [departure, setDeparture] = useState(() => localInputForTimezone(new Date(Date.now() + 15 * 60000), timezone));
  const [serviceMinutes, setServiceMinutes] = useState(String(defaultServiceMinutes ?? 45));
  const [toleranceMinutes, setToleranceMinutes] = useState(String(defaultAppointmentToleranceMinutes ?? 10));
  const [originMode, setOriginMode] = useState<"device" | "manual">(() => user?.subroleKey === "field_technician" ? "device" : "manual");
  const [manualAddress, setManualAddress] = useState("");
  const [originSource, setOriginSource] = useState<{ projectId: number; value: string }>({ projectId, value: "manual" });
  const [locationMessage, setLocationMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlanningResult | null>(null);
  const [staleMessage, setStaleMessage] = useState("");
  const [routeAccessValid, setRouteAccessValid] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeRouteId, setActiveRouteId] = useState("");
  const [endedRouteIds, setEndedRouteIds] = useState<string[]>([]);
  const [mapRetry, setMapRetry] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [validationMessage, setValidationMessage] = useState("");
  const [pendingReview, setPendingReview] = useState<{
    reviews: AddressReview[]; tokensById: Record<string, string>;
  } & ({ request: PlanningRequest; dispatchId?: never } | { dispatchId: string; request?: never }) | null>(null);
  const [dispatchMessage, setDispatchMessage] = useState("");
  const receivedUrl = `/api/projects/${projectId}/routing/dispatched`;
  const { data: origins, isLoading: originsLoading, isFetching: originsFetching, isError: originsError, error: originsQueryError, refetch: refetchOrigins } = useQuery<{ warehouses: OriginWarehouse[] }>({
    queryKey: ["/api/projects", projectId, "routing", "origins"],
    queryFn: async () => {
      const response = await fetch(originsUrl, { credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      const payload = await response.json() as { warehouses?: unknown };
      if (!Array.isArray(payload.warehouses) || !payload.warehouses.every((warehouse: any) =>
        warehouse && typeof warehouse.id === "string" && typeof warehouse.name === "string" && typeof warehouse.address === "string"))
        throw new Error("Warehouse starting points could not be read.");
      return { warehouses: payload.warehouses as OriginWarehouse[] };
    },
    enabled: originMode === "manual",
    staleTime: 0,
    retry: false,
    refetchOnMount: "always",
  });
  const selectedOriginSource = originSource.projectId === projectId && !originsError ? originSource.value : "manual";
  const selectedWarehouse = selectedOriginSource !== "manual"
    ? origins?.warehouses.find(warehouse => warehouse.id === selectedOriginSource)
    : undefined;
  useEffect(() => {
    setOriginSource({ projectId, value: "manual" });
    setManualAddress("");
  }, [projectId]);
  useEffect(() => {
    if (originsError && originSource.projectId === projectId && originSource.value !== "manual")
      setOriginSource({ projectId, value: "manual" });
  }, [originsError, originSource.projectId, originSource.value, projectId]);
  const { data: receivedRoutes = [], refetch: refreshReceived, isError: receivedError } = useQuery<DispatchedRouteSummary[]>({
    queryKey: [receivedUrl, user?.id],
    queryFn: async () => {
      const response = await fetch(receivedUrl, { credentials: "include" });
      if (!response.ok) throw new Error(await errorMessage(response));
      return response.json();
    },
    enabled: !!user && hasPermission("workOrders.optimizeRoute"),
    gcTime: 0,
    retry: false,
  });
  useEffect(() => { setPendingReview(null); }, [user?.id, projectId]);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const resultOwnerRef = useRef<string | null>(null);
  const activeKey = `meterflo:active-route:${user?.id ?? "unknown"}:${projectId}`;
  useEffect(() => {
    if (user?.subroleKey === "field_technician") setOriginMode("device");
  }, [user?.subroleKey]);
  useEffect(() => {
    setHeaderContent(
      <div className="flex min-w-0 items-center gap-3">
        <Button type="button" size="icon" variant="ghost" onClick={onBack} aria-label="Back to work orders" data-testid="routing-header-back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold">{projectName}</span>
          <span className="block text-xs text-muted-foreground">Scheduled route</span>
        </div>
      </div>,
    );
    return () => setHeaderContent(null);
  }, [onBack, projectName, setHeaderContent]);
  useEffect(() => {
    const prefix = "meterflo:active-route:";
    if (user === undefined) return;
    const allowed = user ? `${prefix}${user.id}:` : "";
    for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix) && (!allowed || !key.startsWith(allowed))) sessionStorage.removeItem(key);
    }
  }, [user?.id, user === null]);
  const scopedOrders = useMemo(() =>
    scope === "selected" && selectedIds.length ? workOrders.filter(order => selectedIds.includes(order.id)) : workOrders,
  [scope, selectedIds, workOrders]);
  const candidates = useMemo(() => scopedOrders.filter(order => order.status?.toLowerCase() === "scheduled"), [scopedOrders]);
  const nonScheduled = useMemo(() => {
    return scopedOrders.length - candidates.length;
  }, [scopedOrders, candidates]);
  const unassignedScheduled = useMemo(() => user?.subroleKey === "field_technician" ? 0 :
    candidates.filter(order => !order.assignedUserId).length, [candidates, user?.subroleKey]);
  const fetchMapConfig = useCallback(async (): Promise<MapConfig> => {
    const response = await fetch(`/api/projects/${projectId}/routing/map-config`, { credentials: "include" });
    if (!response.ok) throw new Error(await errorMessage(response));
    return response.json() as Promise<MapConfig>;
  }, [projectId]);
  const { data: mapConfig, isError: mapConfigFailed, error: mapConfigQueryError } = useQuery<MapConfig>({
    queryKey: ["/api/projects", projectId, "routing", "map-config", result?.configurationRevision],
    queryFn: fetchMapConfig,
    enabled: !!result && (mode === "map" || mode === "both"),
    retry: false,
  });
  const mapConfigError = mapConfigFailed ? (mapConfigQueryError instanceof Error ? mapConfigQueryError.message : "Public map configuration could not be loaded.") : undefined;

  const validateResult = useCallback(async (route: RoutingResult, signalStale = true) => {
    if (!hasPlanningMetadata(route) || route.routes?.some(child => routeExpired(child)) || routeExpired(route)) {
      setRouteAccessValid(false);
      sessionStorage.removeItem(activeKey);
      resultOwnerRef.current = null;
      setResult(null);
      setSetupOpen(true);
      setStaleMessage("");
      setValidationMessage("This route has expired. Review the current work orders and plan again.");
      return true;
    }
    try {
      setRouteAccessValid(false);
      const response = await fetch(`/api/projects/${projectId}/routing/validate`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: routeRequestIds(route), fingerprint: route.fingerprint, configurationRevision: route.configurationRevision, receivedDispatchId: route.receivedDispatchId }),
      });
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          setRouteAccessValid(false);
          sessionStorage.removeItem(activeKey);
          resultOwnerRef.current = null;
          setResult(null);
          setStaleMessage("");
          setValidationMessage("Route access was revoked or has expired. The saved route has been cleared.");
          onBack();
          return true;
        }
        throw new Error(await errorMessage(response));
      }
      const state = await response.json() as { stale: boolean };
      setRouteAccessValid(!state.stale);
      if (state.stale && signalStale) setStaleMessage("Appointments, order details, priorities or routing settings changed. This sequence is preserved but needs review.");
      if (!state.stale && signalStale) setStaleMessage("");
      return state.stale;
    } catch (error) {
      setRouteAccessValid(false);
      setValidationMessage(error instanceof Error ? error.message : "Route access could not be verified.");
      return true;
    }
  }, [projectId, activeKey, onBack]);

  useEffect(() => {
    let cancelled = false;
    resultOwnerRef.current = null;
    setResult(null);
    setRouteAccessValid(false);
    setRestoreChecked(false);
    const restore = async () => {
      try {
        const stored = sessionStorage.getItem(activeKey);
        if (!stored) { setRestoreChecked(true); return; }
        const parsed = JSON.parse(stored) as { expiresAt: string; result: RoutingResult; mode: DisplayMode; activeIndex: number; activeRouteId?: string; endedRouteIds?: string[] };
        if (new Date(parsed.expiresAt).getTime() <= Date.now() || routeExpired(parsed.result) || parsed.result.routes?.some(route => routeExpired(route)) || parsed.result.projectId !== projectId || !hasPlanningMetadata(parsed.result)) { sessionStorage.removeItem(activeKey); setValidationMessage("Saved route used an older planning format and was cleared. Re-plan to see current appointment estimates."); setRestoreChecked(true); return; }
        const response = await fetch(`/api/projects/${projectId}/routing/validate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: routeRequestIds(parsed.result), fingerprint: parsed.result.fingerprint, configurationRevision: parsed.result.configurationRevision, receivedDispatchId: parsed.result.receivedDispatchId }) });
        if (!response.ok) {
          sessionStorage.removeItem(activeKey);
          if (response.status === 401 || response.status === 403) { setValidationMessage("Saved route was removed because route access is no longer available."); onBack(); }
          else setValidationMessage("Saved route was removed because access could not be verified.");
          setRestoreChecked(true);
          return;
        }
        const validity = await response.json() as { stale: boolean };
        if (cancelled) return;
        if (validity.stale) { sessionStorage.removeItem(activeKey); setRouteAccessValid(false); setValidationMessage("Saved route is out of date and was not restored. Re-plan from current scheduled work."); }
        else {
          setRouteAccessValid(true);
          resultOwnerRef.current = user?.id ?? null;
          setResult(parsed.result as PlanningResult);
          setMode(parsed.mode);
          setActiveRouteId(parsed.result.routes?.some(route => route.assigneeId === parsed.activeRouteId) ? parsed.activeRouteId! : parsed.result.routes![0].assigneeId!);
          const restoredRoute = parsed.result.routes!.find(route => route.assigneeId === parsed.activeRouteId) ?? parsed.result.routes![0];
          setActiveIndex(Math.min(Math.max(parsed.activeIndex || 0, 0), Math.max(restoredRoute.stops.length - 1, 0)));
          setEndedRouteIds(Array.isArray(parsed.endedRouteIds) ? parsed.endedRouteIds.filter(id => parsed.result.routes!.some(route => route.assigneeId === id)) : []);
          setSetupOpen(false);
        }
      } catch { sessionStorage.removeItem(activeKey); }
      if (!cancelled) setRestoreChecked(true);
    };
    void restore();
    return () => { cancelled = true; };
  }, [activeKey, projectId, user?.id, onBack]);
  useEffect(() => {
    if (!restoreChecked || !result || resultOwnerRef.current !== user?.id) return;
    if (!sessionStorage.setItem(activeKey, JSON.stringify({ expiresAt: result.expiresAt, result, mode, activeIndex, activeRouteId, endedRouteIds })))
      setValidationMessage("Browser storage is unavailable. This route works here, but cannot be recovered after refresh.");
  }, [activeKey, result, mode, activeIndex, activeRouteId, endedRouteIds, restoreChecked, user?.id]);
  useEffect(() => {
    const check = () => { if (result) void validateResult(result); };
    check();
    const interval = window.setInterval(check, 20000);
    window.addEventListener("focus", check);
    return () => { window.clearInterval(interval); window.removeEventListener("focus", check); };
  }, [result, validateResult]);
  useEffect(() => {
    if (result) {
      void validateResult(result);
    }
    // React Query work-order refreshes may change cache references; route result remains stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workOrders]);

  const getDeviceOrigin = () => new Promise<RoutePoint>((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error("Device location is unavailable in this browser. Enter a starting address instead.")); return; }
    navigator.geolocation.getCurrentPosition(position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }), error => {
      const reasons: Record<number, string> = { 1: "Location permission was denied. Enter a starting address to continue.", 2: "Device location could not be determined. Enter a starting address to continue.", 3: "Location request timed out. Enter a starting address to continue." };
      reject(new Error(reasons[error.code] || "Device location failed. Enter a starting address to continue."));
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
  const plan = async (confirmation?: { request: PlanningRequest; tokensById: Record<string, string> }) => {
    const requestedIds = confirmation?.request.ids ?? candidates.map(order => order.id);
    if (!requestedIds.length) { setValidationMessage("No scheduled work orders match this scope. Adjust the grid filters or select scheduled orders."); return; }
    if (readiness?.ready !== true) { setValidationMessage("Routing is not ready. Configure the provider before planning."); return; }
    if (requestedIds.length > 50) { setValidationMessage(`This request contains ${requestedIds.length} Scheduled work orders; route planning accepts at most 50 total Scheduled orders. Narrow the filters or selection, then plan again.`); return; }
    const serviceValue = confirmation?.request.serviceMinutes ?? Number(serviceMinutes);
    const toleranceValue = confirmation?.request.toleranceMinutes ?? Number(toleranceMinutes);
    if (!Number.isInteger(serviceValue) || serviceValue < 1 || serviceValue > 480) { setValidationMessage("On-site service must be a whole number from 1 to 480 minutes."); return; }
    if (!Number.isInteger(toleranceValue) || toleranceValue < 0 || toleranceValue > 240) { setValidationMessage("Appointment tolerance must be a whole number from 0 to 240 minutes."); return; }
    setBusy(true); setValidationMessage(""); setLocationMessage("");
    try {
      let origin: OriginChoice;
      if (confirmation) origin = confirmation.request.origin;
      else if (originMode === "device") {
        try { origin = await getDeviceOrigin(); }
        catch (error) { setLocationMessage(error instanceof Error ? error.message : "Device location unavailable."); setOriginMode("manual"); setBusy(false); return; }
      } else {
        if (selectedOriginSource !== "manual") {
          if (originsError) {
            setValidationMessage("Warehouse availability could not be checked. Retry the lookup or choose manual entry before planning.");
            setBusy(false);
            return;
          }
          if (originsFetching) {
            setValidationMessage("Checking the selected warehouse for this project. Wait for the lookup to finish or choose manual entry.");
            setBusy(false);
            return;
          }
          if (!selectedWarehouse) {
            setValidationMessage("The selected warehouse is no longer available for this project. Choose a current warehouse or enter a starting address.");
            setBusy(false);
            return;
          }
          origin = { address: selectedWarehouse.address.trim() };
        } else {
          if (!manualAddress.trim()) { setValidationMessage("Enter the starting address."); setBusy(false); return; }
          origin = { address: manualAddress.trim() };
        }
      }
      const request = confirmation?.request ?? { ids: requestedIds, origin, departureAt: isoFromZonedInput(departure, timezone), serviceMinutes: serviceValue, toleranceMinutes: toleranceValue };
      const response = await fetch(`/api/projects/${projectId}/routing/plan`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...request, addressConfirmations: confirmation ? Object.values(confirmation.tokensById) : undefined }) });
      if (response.status === 409) {
        const data = await response.json();
        if (data.code !== "ADDRESS_REVIEW_REQUIRED" || !Array.isArray(data.addressReviews) || !data.addressReviews.length)
          throw new Error(data.message || "Address review could not be loaded. Re-plan the route.");
        setResult(null);
        setRouteAccessValid(false);
        sessionStorage.removeItem(activeKey);
        setPendingReview({ request, reviews: data.addressReviews, tokensById: confirmation?.tokensById ?? {} });
        return;
      }
      if (!response.ok) {
        if (response.status === 401 || response.status === 403) setPendingReview(null);
        throw new Error(await errorMessage(response));
      }
      const planned = await response.json() as RoutingResult;
      if (!hasPlanningMetadata(planned) || !hasRoutePlanningMetadata(planned)) throw new Error("The route response is missing the current assignment and appointment-planning format. No route was activated.");
      if (planned.routes!.every(route => !route.stops.length) && !planned.excluded?.length) throw new Error("Provider returned no stops or exclusion details. No route was activated.");
      if (planned.routes!.some(route => route.stops.length > 0 && !route.geometry?.length)) throw new Error("Provider returned an assigned route without road geometry. No route was activated.");
      if (planned.routes!.some(route => route.stops.length > readiness.effective.maxStops))
        throw new Error(`A technician route exceeds the configured limit of ${readiness.effective.maxStops} stops per route. No route was activated.`);
      // Address review resumes the frozen request, not the mixed-status grid
      // (which also contains orders intentionally excluded from this request).
      if (planned.scopeIds!.length !== request.ids.length || request.ids.some(id => !planned.scopeIds!.includes(id)))
        throw new Error("Provider returned a route for a different work-order scope. No route was activated.");
      const providerExpiry = Date.parse(planned.expiresAt);
      const shortCacheExpiry = Date.parse(planned.createdAt) + 4 * 60 * 60 * 1000;
      if (!Number.isFinite(providerExpiry) || !Number.isFinite(shortCacheExpiry)) throw new Error("Route provider returned an invalid expiry; no route was activated.");
      const clientExpiry = Math.min(providerExpiry, shortCacheExpiry);
      if (clientExpiry <= Date.now()) throw new Error("The provider returned an already-expired route. Plan again.");
      const normalizedExpiry = new Date(clientExpiry).toISOString();
      const safelyExpiringResult = {
        ...planned,
        expiresAt: normalizedExpiry,
        routes: planned.routes!.map(route => ({ ...route, expiresAt: normalizedExpiry })) as RoutingResult[],
      };
      resultOwnerRef.current = user?.id ?? null;
      setPendingReview(null);
      setResult(safelyExpiringResult as PlanningResult); setStaleMessage(""); setActiveIndex(0);
      setActiveRouteId(planned.routes![0].assigneeId!); setEndedRouteIds([]); setRouteAccessValid(true); setSetupOpen(false);
      await queryClient.invalidateQueries({ queryKey: [readinessUrl] });
    } catch (error) { setValidationMessage(error instanceof Error ? error.message : "Route could not be planned."); }
    finally { setBusy(false); }
  };
  const activeRoute = useMemo(() => result?.routes?.find(route => route.assigneeId === activeRouteId) ?? result?.routes?.[0], [result, activeRouteId]);
  const currentRoute = activeRoute as PlanningResult | undefined;
  const visibleWarnings = [...new Set([...(result?.warnings ?? []), ...(currentRoute?.warnings ?? [])])];
  const activeRouteEnded = !!activeRoute?.assigneeId && endedRouteIds.includes(activeRoute.assigneeId);
  const activeBundleExpired = !!result && (routeExpired(result) || result.routes?.some(route => routeExpired(route)));
  const selectedStop = currentRoute?.stops[activeIndex];
  const openDispatchedRoute = async (id: string, tokensById: Record<string,string> = {}) => {
    setBusy(true); setValidationMessage("");
    try {
      const response = await fetch(`${receivedUrl}/${id}/open`, { method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ addressConfirmations: Object.values(tokensById) }) });
      if (response.status === 409) {
        const data = await response.json();
        if (data.code !== "ADDRESS_REVIEW_REQUIRED" || !Array.isArray(data.addressReviews) || !data.addressReviews.length)
          throw new Error(data.message || "Dispatched route is out of date. Ask dispatch to plan again.");
        setResult(null); setRouteAccessValid(false); sessionStorage.removeItem(activeKey);
        setPendingReview({ dispatchId: id, reviews: data.addressReviews, tokensById });
        return;
      }
      if (response.status === 401 || response.status === 403) setPendingReview(null);
      if (!response.ok) throw new Error(await errorMessage(response));
      const route = await response.json() as RoutingResult;
      if (!hasPlanningMetadata(route) || !hasRoutePlanningMetadata(route) || routeExpired(route) ||
        route.assigneeId !== user?.id || route.routes!.length !== 1 || route.projectId !== projectId ||
        route.receivedDispatchId !== id) throw new Error("This dispatched route could not be verified.");
      resultOwnerRef.current = user?.id ?? null;
      setResult(route as PlanningResult); setRouteAccessValid(true); setSetupOpen(false);
      setPendingReview(null); setStaleMessage(""); setActiveIndex(0);
      setActiveRouteId(route.assigneeId!); setEndedRouteIds([]); setDispatchMessage("");
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : "Dispatched route could not be opened.");
      void refreshReceived();
    } finally { setBusy(false); }
  };
  const dispatchCurrentRoute = async () => {
    if (!currentRoute?.dispatchPlanId || !result) return;
    setBusy(true); setDispatchMessage("");
    try {
      if (await validateResult(result)) throw new Error("Review and re-plan before dispatching.");
      const response = await fetch(`/api/projects/${projectId}/routing/dispatch`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: currentRoute.dispatchPlanId }),
      });
      if (!response.ok) throw new Error(await errorMessage(response));
      setDispatchMessage(`Sent to ${currentRoute.assigneeName}. They can open it under Routes from dispatch in this project's route planner until expiry, including after a server restart. Refreshed address matches may require review.`);
      void refreshReceived();
    } catch (error) {
      setDispatchMessage(error instanceof Error ? error.message : "Route could not be dispatched.");
    } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!activeRoute) return;
    setActiveIndex(index => Math.min(Math.max(index, 0), Math.max(activeRoute.stops.length - 1, 0)));
  }, [activeRoute]);
  const selectRoute = (assigneeId: string) => {
    setActiveRouteId(assigneeId);
    setActiveIndex(0);
  };
  const printRoutes = async (printAll: boolean) => {
    if (!result || !activeRoute || pendingReview || staleMessage || !routeAccessValid || !hasPlanningMetadata(result) ||
        routeExpired(result) || result.routes?.some(route => routeExpired(route))) {
      setValidationMessage("This route cannot be printed until it is current, verified, and address review is complete.");
      return;
    }
    const popup = window.open("", "_blank", "width=900,height=700");
    if (!popup) {
      setValidationMessage("The print window was blocked. Allow pop-ups for MeterFlo and try again.");
      return;
    }
    popup.document.write("<!doctype html><title>Verifying route</title><p style='font:16px system-ui;padding:24px'>Verifying route access before printing…</p>");
    const stale = await validateResult(result, false);
    if (stale || routeExpired(result) || result.routes?.some(route => routeExpired(route))) {
      popup.close();
      setValidationMessage("Printing stopped because route access could not be verified or the route is stale or expired. Re-plan before printing.");
      return;
    }
    const routes = printAll ? result.routes! : [activeRoute];
    try {
      writeRoutePrintDocument(popup, routes, result.warnings, result.excluded, timezone, projectName);
      popup.focus();
      window.setTimeout(() => {
        try {
          if (!popup.closed) popup.print();
        } catch {
          setValidationMessage("The print dialog could not be opened. Use your browser’s print command from the route document.");
        }
      }, 200);
    } catch {
      popup.close();
      setValidationMessage("The printable route could not be prepared. Check pop-up permissions and try again.");
    }
  };
  const startReplan = () => {
    sessionStorage.removeItem(activeKey);
    setResult(null);
    setRouteAccessValid(false);
    setSetupOpen(true);
    setStaleMessage("");
  };
  const navigateWithMaps = async (provider: "apple" | "google") => {
    if (pendingReview || !result || !activeRoute || activeRouteEnded || !routeAccessValid || !hasPlanningMetadata(result) || staleMessage) {
      setValidationMessage("Review and re-plan the route before starting navigation.");
      toast({ title: "Route needs review", description: "Review and re-plan the route before starting navigation.", variant: "destructive" });
      return;
    }
    if (result && (routeExpired(result) || result.routes?.some(route => routeExpired(route)))) {
      setRouteAccessValid(false);
      sessionStorage.removeItem(activeKey);
      resultOwnerRef.current = null;
      setResult(null);
      setSetupOpen(true);
      setValidationMessage("This route has expired. Review the current work orders and plan again.");
      return;
    }
    if (!selectedStop) return;
    // Recheck at the actual handoff, not only on the background polling timer.
    if (await validateResult(result) || routeExpired(result)) {
      setValidationMessage("Navigation stopped because the route is no longer current or access could not be verified.");
      return;
    }
    const links = navigationLinks(selectedStop.point);
    // Same-window HTTPS handoff avoids asynchronous popup blockers.
    window.location.assign(links[provider]);
  };
  const preferredMapsProvider = /iPad|iPhone|iPod/.test(navigator.userAgent) ? "apple" : "google";
  const alternateMapsProvider = preferredMapsProvider === "apple" ? "google" : "apple";
  const toggleActiveRouteEnded = () => {
    if (!activeRoute?.assigneeId) return;
    setEndedRouteIds(ids => ids.includes(activeRoute.assigneeId!)
      ? ids.filter(id => id !== activeRoute.assigneeId)
      : [...ids, activeRoute.assigneeId!]);
  };

  if (!restoreChecked || readinessLoading || (result !== null && resultOwnerRef.current !== (user?.id ?? null))) return <main className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6" data-testid="routing-loading"><div className="h-8 w-44 animate-pulse rounded bg-muted" /><div className="h-48 animate-pulse rounded-xl bg-muted" /></main>;
  return (
    <main className="mx-auto min-h-[70dvh] max-w-7xl space-y-5 p-3 pb-24 sm:p-6" data-testid="route-planner">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Field route · {projectName}</p><h1 className="text-2xl font-semibold tracking-tight">Scheduled stops</h1></div>
        <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setSettingsOpen(true)} data-testid="project-routing-settings-open"><Settings2 className="mr-2 h-4 w-4" />Project settings</Button>{result && <Button variant="outline" onClick={startReplan} data-testid="route-replan"><Route className="mr-2 h-4 w-4" />Re-plan</Button>}</div>
      </div>
      {result && <Button variant="outline" onClick={() => { void refreshReceived(); setSetupOpen(true); }} data-testid="show-dispatched-routes">Routes from dispatch</Button>}
      {readinessError && <div className="rounded-lg border border-destructive/30 p-4 text-sm"><span>Could not check routing access or readiness. </span><Button variant="ghost" onClick={() => refetch()}>Try again</Button></div>}
      {validationMessage && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"><AlertTriangle className="h-4 w-4 shrink-0" />{validationMessage}</div>}
      {result && <>
        {!!result.confirmedAddressMatches?.length && <details className="rounded-xl border border-amber-300 bg-amber-50/60 p-3 text-sm" data-testid="confirmed-address-matches">
          <summary className="cursor-pointer font-semibold">{result.confirmedAddressMatches.length} address matches manually confirmed</summary>
          <div className="mt-3 space-y-3">{result.confirmedAddressMatches.map(match => <div key={match.id} className="space-y-1 break-words">
            <p className="font-medium">{match.label}</p>
            <p>Submitted: {match.submittedAddress}</p>
            <p>Confirmed map address: {match.resolvedAddress}</p>
            <p className="text-xs text-muted-foreground">This confirmation applies only to this plan; the work order was not changed.</p>
          </div>)}</div>
        </details>}
        {!!currentRoute && currentRoute.stops.length === 0 && <div role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">This technician has no navigable stops. Review the exclusions below and correct locations or scheduling before trying again.</div>}
        {(staleMessage || activeBundleExpired) && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between" data-testid="route-stale-banner"><div className="flex gap-2 text-sm"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span>{staleMessage || "This route has expired. Navigation and printing are unavailable; plan again to continue."}</span></div><Button size="sm" onClick={startReplan}>Re-plan route</Button></div>}
        <section className="rounded-xl border bg-card p-4 sm:flex sm:items-end sm:justify-between sm:gap-5">
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="routing-technician-select">Technician route</Label>
            <select id="routing-technician-select" value={currentRoute?.assigneeId ?? ""} onChange={event => selectRoute(event.target.value)} className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" data-testid="routing-technician-select">
              {result.routes!.map(route => <option key={route.assigneeId} value={route.assigneeId}>{route.assigneeName} · {route.stops.length} stops</option>)}
            </select>
            <p className="text-xs text-muted-foreground">Each route is planned and sequenced independently for its assigned technician. Starting point: {currentRoute?.originAddress?.trim() || `${currentRoute?.origin.lat}, ${currentRoute?.origin.lng}`} · departure {currentRoute ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(currentRoute.departureAt)) : "—"}.</p>
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:mt-0 sm:flex-row">
            {!result.receivedDispatchId && user?.subroleKey !== "field_technician" && <Button type="button" onClick={() => void dispatchCurrentRoute()} disabled={busy || !currentRoute?.dispatchPlanId || !currentRoute?.originAddress || !routeAccessValid || !!staleMessage || activeBundleExpired} data-testid="dispatch-current-route">Send to {currentRoute?.assigneeName}</Button>}
            <Button type="button" variant="outline" onClick={() => void printRoutes(false)} disabled={!!staleMessage || !!pendingReview || !routeAccessValid || activeBundleExpired} data-testid="route-print-current">Print this route</Button>
            <Button type="button" variant="outline" onClick={() => void printRoutes(true)} disabled={!!staleMessage || !!pendingReview || !routeAccessValid || activeBundleExpired} data-testid="route-print-all">Print all technician routes</Button>
          </div>
        </section>
        {!result.receivedDispatchId && user?.subroleKey !== "field_technician" && <p className="text-xs text-muted-foreground">Dispatch sends only this technician's route and requires an entered starting address. Device-location origins cannot be shared. Shared routes expire with the plan and are cleared on server restart.</p>}
        {result.receivedDispatchId && <p role="status" className="rounded-lg border p-3 text-sm">Route from dispatch · only your assigned stops are included. Address confirmations and scheduling assumptions apply only to this plan.</p>}
        {dispatchMessage && <p role="status" className="rounded-lg border p-3 text-sm" data-testid="dispatch-message">{dispatchMessage}</p>}
        <div className="grid gap-3 sm:grid-cols-3"><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Ordered stops · {currentRoute?.assigneeName}</p><p className="mt-1 text-2xl font-semibold">{currentRoute?.stops.length ?? 0}</p><p className="text-xs text-muted-foreground">{result.excluded.length} excluded across this plan</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Road travel estimate</p><p className="mt-1 text-2xl font-semibold">{Math.round((currentRoute?.totalTravelMeters ?? 0) / 1609.34 * 10) / 10} mi</p><p className="text-xs text-muted-foreground">About {Math.round((currentRoute?.totalTravelSeconds ?? 0) / 60)} min · provider estimate, no live traffic claim</p></CardContent></Card><Card><CardContent className="p-4"><p className="text-xs uppercase tracking-wide text-muted-foreground">Planning assumptions</p><p className="mt-1 font-medium">{currentRoute?.serviceMinutes} min route default · {currentRoute?.toleranceMinutes} min tolerance</p><p className="text-xs text-muted-foreground">Project timezone: {timezone}</p></CardContent></Card></div>
        {visibleWarnings.length > 0 && <div className="space-y-1 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm">{visibleWarnings.map((warning, index) => <p key={index} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />{warning}</p>)}</div>}
        <div className="flex flex-wrap items-center justify-between gap-3"><div className="inline-flex rounded-lg border bg-muted/40 p-1" role="group" aria-label="Route display"><Button size="sm" variant={mode === "list" ? "default" : "ghost"} onClick={() => setMode("list")} data-testid="route-mode-list"><Route className="mr-1.5 h-4 w-4" />List</Button><Button size="sm" variant={mode === "map" ? "default" : "ghost"} onClick={() => setMode("map")} data-testid="route-mode-map"><Map className="mr-1.5 h-4 w-4" />Map</Button><Button size="sm" variant={mode === "both" ? "default" : "ghost"} onClick={() => setMode("both")} data-testid="route-mode-both">Both</Button></div><Button variant="ghost" size="sm" onClick={toggleActiveRouteEnded} disabled={!activeRoute}>{activeRouteEnded ? "Resume this route" : "End this route"}</Button></div>
        {activeRouteEnded && <div role="status" className="rounded-lg border border-slate-300 bg-muted/40 p-3 text-sm">This route is ended for {activeRoute?.assigneeName}. Navigation and stop progression are paused; other technicians’ routes remain available.</div>}
        <div className={`grid gap-5 ${mode === "both" ? "lg:grid-cols-[minmax(300px,0.85fr)_minmax(0,1.15fr)]" : "grid-cols-1"}`}>
          {(mode === "list" || mode === "both") && <section className="space-y-3" aria-label="Ordered route stops"><h2 className="font-semibold">Sequence · {currentRoute?.stops.length ?? 0} stops</h2>{!currentRoute?.stops.length && <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">No stops could be placed on this technician’s route.</p>}{currentRoute?.stops.map((stop, index) => {
            const order = workOrders.find(item => item.id === stop.id);
            return <button key={stop.id} type="button" onClick={() => { setActiveIndex(index); if (order) onOpenWorkOrder(order); }} className={`w-full rounded-xl border p-4 text-left transition-colors ${index === activeIndex ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`} data-testid={`route-stop-${stop.id}`}>
              <div className="flex items-start gap-3"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold ${index === activeIndex ? "bg-primary text-primary-foreground" : "bg-muted"}`}>{index + 1}</span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2 font-semibold">{stop.label}{stop.priority !== null && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-900">Priority {stop.priority}</span>}<ChevronRight className="h-4 w-4 text-muted-foreground" /></span><span className="mt-1 block text-sm text-muted-foreground">{stop.address}</span><span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs"><span>Scheduled {stop.scheduledAt ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(stop.scheduledAt)) : "Unscheduled"}</span><span>Arrive {new Intl.DateTimeFormat(undefined, { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(new Date(stop.arrivalAt))}</span><span>Service {stop.serviceDurationMinutes} min · {stop.durationSource}</span><span>Waiting {stop.waitingMinutes} min</span><span>Appointment source: {stop.appointmentSource}</span>{stop.subStatus && <span>{stop.subStatus}</span>}</span>{stop.appointmentSource === "window" && <span className="mt-2 block text-xs">Service-start window: {stop.appointmentWindowStart ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(stop.appointmentWindowStart)) : "—"} – {stop.appointmentWindowEnd ? new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(stop.appointmentWindowEnd)) : "—"} ({timezone})</span>}<span className={`mt-2 block text-xs font-medium ${stop.lateMinutes > 0 ? "text-amber-800" : "text-muted-foreground"}`}>{stop.lateMinutes > 0 ? `Estimated ${stop.lateMinutes} min late` : "Estimated on time"}</span></span></div>
            </button>;
          })}</section>}
          {(mode === "map" || mode === "both") && <section className="min-w-0 space-y-3"><h2 className="font-semibold">Road route <span className="font-normal text-muted-foreground">· {result.provider === "geoapify" ? "Geoapify" : "Google Maps"}</span></h2>{currentRoute?.stops.length ? <MapView key={currentRoute.assigneeId} projectId={projectId} result={currentRoute} config={mapConfig} retryKey={mapRetry} configError={mapConfigError} /> : <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed bg-muted/20 p-6 text-center text-sm text-muted-foreground">No route geometry is available because no stops were resolved for this technician.</div>}{mapConfig && !!currentRoute?.stops.length && <Button variant="outline" size="sm" onClick={() => setMapRetry(value => value + 1)}>Reload map</Button>}</section>}
        </div>
        {selectedStop && currentRoute && <div className="sticky bottom-2 z-20 flex flex-col gap-3 rounded-2xl border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between"><div className="flex min-w-0 items-center gap-2"><MapPin className="h-5 w-5 shrink-0 text-primary" /><span className="truncate text-sm"><strong>{activeRouteEnded ? "Route ended" : activeIndex === 0 ? "Next stop" : `Stop ${activeIndex + 1} of ${currentRoute.stops.length}`}</strong> · {selectedStop.label}</span></div><div className="flex flex-wrap gap-2"><Button className="flex-1 sm:flex-none" onClick={() => navigateWithMaps(preferredMapsProvider)} disabled={activeRouteEnded || !routeAccessValid || !!staleMessage || activeBundleExpired} data-testid="navigate-next-stop"><Navigation className="mr-2 h-4 w-4" />Navigate · {preferredMapsProvider === "apple" ? "Apple Maps" : "Google Maps"}</Button><Button variant="outline" onClick={() => navigateWithMaps(alternateMapsProvider)} disabled={activeRouteEnded || !routeAccessValid || !!staleMessage || activeBundleExpired} data-testid={`navigate-alternate-${alternateMapsProvider}`}>{alternateMapsProvider === "google" ? "Google Maps / web" : "Apple Maps"}</Button><Button variant="outline" onClick={() => setActiveIndex(index => Math.min(index + 1, currentRoute.stops.length - 1))} disabled={activeRouteEnded || !routeAccessValid || !!staleMessage || activeBundleExpired || activeIndex >= currentRoute.stops.length - 1} data-testid="route-next-stop"><Check className="mr-2 h-4 w-4" />Next</Button></div><span className="text-xs text-muted-foreground sm:w-full sm:text-right">HTTPS navigation opens the selected app when available, otherwise its web maps page. Navigation does not mark work complete.</span></div>}
        {result.excluded.length > 0 && <section className="rounded-xl border p-4" data-testid="route-exclusions"><h2 className="font-semibold">Not routed · {result.excluded.length}</h2><p className="mb-3 mt-1 text-sm text-muted-foreground">These exclusions apply to the full request. Assign unassigned orders or correct scheduling and locations before replanning.</p><div className="divide-y">{result.excluded.map(item => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{item.label}</span><span className="text-muted-foreground">{item.reason}</span></div>)}</div></section>}
      </>}
      <Dialog open={setupOpen} onOpenChange={open => { if (!open && !result) onBack(); else setSetupOpen(open); }}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl" data-testid="route-setup-dialog"><DialogHeader><DialogTitle>Plan technician routes</DialogTitle><DialogDescription>MeterFlo creates a distinct ordered route for each assigned technician. Orders without an assignee cannot be routed; assign them before planning. Location is sent to the configured provider to estimate road travel. Per-actor/project recovery lasts no more than four hours or the provider’s shorter expiry.</DialogDescription></DialogHeader>
        <section className="space-y-2 rounded-lg border p-3" aria-label="Routes from dispatch" data-testid="dispatched-routes">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">Routes from dispatch</h2><Button size="sm" variant="ghost" onClick={() => void refreshReceived()}>Refresh</Button></div>
          <p className="text-xs text-muted-foreground">Only routes sent to you for this project appear here. Opening rechecks assignments, appointments, address review and access. Expired plans and server restarts require dispatch to send a new plan.</p>
          {receivedError ? <p role="alert" className="text-sm">Could not check routes from dispatch. Try Refresh.</p> : !receivedRoutes.length ? <p className="text-sm text-muted-foreground">No current routes have been sent to you.</p> : receivedRoutes.map(route => <div key={route.id} className="space-y-2 rounded border p-2 text-sm">
            <p>{route.stopCount} stops · {new Intl.DateTimeFormat(undefined, { timeZone: timezone, dateStyle: "short", timeStyle: "short" }).format(new Date(route.departureAt))}</p>
            <p className="break-words text-xs text-muted-foreground">Start: {route.originAddress}</p>
            <Button size="sm" disabled={busy} onClick={() => void openDispatchedRoute(route.id)} data-testid={`open-dispatched-${route.id}`}>Open my route</Button>
          </div>)}
        </section>
        {pendingReview ? <>
          <AddressMatchReviewPanel
            reviews={pendingReview.reviews}
            busy={busy}
            onCancel={() => { setPendingReview(null); setValidationMessage(""); }}
            onConfirm={tokens => {
              const tokensById = { ...pendingReview.tokensById, ...Object.fromEntries(pendingReview.reviews.map((review, index) => [review.id, tokens[index]])) };
              if (pendingReview.dispatchId) void openDispatchedRoute(pendingReview.dispatchId, tokensById);
              else if (pendingReview.request) void plan({ request: pendingReview.request, tokensById });
            }}
            onCorrectWorkOrder={hasPermission("workOrders.edit") ? id => {
              const order = workOrders.find(order => order.id === id);
              if (order) { setPendingReview(null); setSetupOpen(false); onOpenWorkOrder(order); }
            } : undefined}
          />
          {validationMessage && <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{validationMessage}</div>}
        </> : <>
        {readiness && <div className="rounded-lg border bg-muted/30 p-3 text-sm"><div className="flex items-center justify-between gap-3"><span className="font-medium">{readiness.ready ? "Provider ready" : readiness.message}</span><Button size="sm" variant="ghost" onClick={() => setSettingsOpen(true)}><Settings2 className="mr-1 h-4 w-4" />Settings</Button></div><p className="mt-1 text-xs text-muted-foreground">{readiness.effective.provider === "geoapify" ? "Geoapify" : "Google Maps"} · {readiness.effective.source === "site" ? "site default" : "project-specific"} · up to {readiness.effective.maxStops} stops per technician route · 50 orders per request</p></div>}
        <div className="space-y-4 py-1">
          <div className="space-y-2"><Label>Work-order scope</Label><RadioGroup value={scope} onValueChange={value => setScope(value as "filtered" | "selected")} className="grid gap-2"><label className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"><RadioGroupItem value="filtered" className="mt-0.5" /><span><strong className="text-sm">Orders in current filters</strong><span className="block text-xs text-muted-foreground">{candidates.length} Scheduled candidates across all grid pages · {nonScheduled} non-Scheduled orders are excluded from routing</span></span></label><label className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${!selectedIds.length ? "opacity-50" : ""}`}><RadioGroupItem value="selected" disabled={!selectedIds.length} className="mt-0.5" /><span><strong className="text-sm">Selected orders</strong><span className="block text-xs text-muted-foreground">{selectedIds.length} selected · only Scheduled orders will be routed</span></span></label></RadioGroup>
            {unassignedScheduled > 0 && <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">{unassignedScheduled} Scheduled {unassignedScheduled === 1 ? "order has" : "orders have"} no technician assignment. Assign {unassignedScheduled === 1 ? "it" : "them"} before planning a route.</p>}
            {candidates.length > 50 && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">The request has {candidates.length} Scheduled orders. Narrow the filter or selection to 50 or fewer Scheduled orders.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="route-departure">Departure time ({timezone})</Label><Input id="route-departure" type="datetime-local" value={departure} onChange={event => setDeparture(event.target.value)} data-testid="route-departure" /></div><div className="space-y-2"><Label htmlFor="route-service-minutes">On-site service (minutes)</Label><Input id="route-service-minutes" type="number" min="1" max="480" value={serviceMinutes} onChange={event => setServiceMinutes(event.target.value)} data-testid="route-service-minutes" /><p className="text-xs text-muted-foreground">Route-wide default; work-order and project estimates can override it.</p></div><div className="space-y-2 sm:col-span-2"><Label htmlFor="route-tolerance">Appointment tolerance (minutes)</Label><Input id="route-tolerance" type="number" min="0" max="240" value={toleranceMinutes} onChange={event => setToleranceMinutes(event.target.value)} data-testid="route-tolerance" /><p className="text-xs text-muted-foreground">Planning assumption only. Appointment windows constrain service start and do not modify scheduled appointments.</p></div></div>
          <div className="space-y-2"><Label>Result view</Label><RadioGroup value={mode} onValueChange={value => setMode(value as DisplayMode)} className="grid grid-cols-3 gap-2">{(["list", "map", "both"] as const).map(value => <label key={value} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 capitalize"><RadioGroupItem value={value} />{value}</label>)}</RadioGroup></div>
           <div className="space-y-2">
             <Label>Starting point</Label>
             <RadioGroup value={originMode} onValueChange={value => setOriginMode(value as "device" | "manual")} className="grid grid-cols-2 gap-2">
               <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"><RadioGroupItem value="device" />Device location</label>
               <label className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 text-sm"><RadioGroupItem value="manual" />Warehouse / starting address</label>
             </RadioGroup>
             {originMode === "manual" && <>
               {origins?.warehouses.length ? <>
                 <Label htmlFor="route-origin-warehouse">Warehouse or manual entry</Label>
                 <select
                   id="route-origin-warehouse"
                   value={selectedWarehouse ? selectedOriginSource : "manual"}
                   onChange={event => setOriginSource({ projectId, value: event.target.value })}
                   className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                   data-testid="route-origin-warehouse"
                 >
                   <option value="manual">Enter an address manually</option>
                   {origins.warehouses.map(warehouse => <option key={warehouse.id} value={warehouse.id}>{warehouse.name} · {warehouse.address}</option>)}
                 </select>
               </> : null}
               {originsLoading && <p role="status" className="text-xs text-muted-foreground">Checking available warehouse starting points… Manual entry remains available.</p>}
               {originsError && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-950">
                 <AlertTriangle className="h-4 w-4 shrink-0" />
                 <span>{originsQueryError instanceof Error ? originsQueryError.message : "Warehouse lookup failed."} Enter an address manually or retry.</span>
                 <Button type="button" size="sm" variant="outline" onClick={() => void refetchOrigins()}>Retry lookup</Button>
               </div>}
               {selectedWarehouse && !originsError && <p className="rounded-md border bg-muted/30 p-2 text-sm" role="status">
                 <span className="block text-xs font-medium text-muted-foreground">Starting address to be submitted</span>
                 <span className="break-words">{selectedWarehouse.name} · {selectedWarehouse.address}</span>
               </p>}
               {selectedOriginSource !== "manual" && !selectedWarehouse && !originsError && !originsLoading && <p role="alert" className="text-sm text-amber-800">That warehouse is no longer available. Choose another warehouse or enter an address manually.</p>}
               {(selectedOriginSource === "manual" || (!!selectedOriginSource && selectedOriginSource !== "manual" && !selectedWarehouse)) && <div className="space-y-1">
                 <Label htmlFor="route-manual-origin">Starting address</Label>
                 <Input id="route-manual-origin" value={manualAddress} onChange={event => { setManualAddress(event.target.value); setOriginSource({ projectId, value: "manual" }); }} placeholder="Street, city, region" aria-describedby="route-manual-origin-help" data-testid="route-manual-origin" />
                 <p id="route-manual-origin-help" className="text-xs text-muted-foreground">Review the address before planning. It is sent to the configured routing provider.</p>
               </div>}
             </>}
             {locationMessage && <p className="text-sm text-amber-800" role="status">{locationMessage}</p>}
           </div>
          {validationMessage && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{validationMessage}</div>}
        </div>
        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row"><Button variant="outline" onClick={onBack}>Back to work orders</Button><Button onClick={() => void plan()} disabled={busy || !readiness?.ready || candidates.length === 0} data-testid="create-route-plan">{busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Resolving route…</> : <><Route className="mr-2 h-4 w-4" />Optimize {candidates.length} scheduled</>}</Button></DialogFooter>
        </>}
      </DialogContent></Dialog>
      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Project routing settings</DialogTitle><DialogDescription>Use the site default or configure isolated project credentials.</DialogDescription></DialogHeader><RoutingSettings projectId={projectId} compact /></DialogContent></Dialog>
    </main>
  );
}
