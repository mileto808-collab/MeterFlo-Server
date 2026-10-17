export type RoutingProvider = "google" | "geoapify";
const routingReference = /^(?:(?:METERFLO_ROUTING|GOOGLE_MAPS|GEOAPIFY)_[A-Z0-9_]+)?$/;
export const isRoutingServerReference = (value:string) => value.length<=100 && routingReference.test(value) &&
  !/(?:^|_)BROWSER(?:_|$)/.test(value);
export const isRoutingBrowserReference = (value:string) => value==="" || (value.length<=100 && routingReference.test(value) &&
  /(?:^|_)BROWSER(?:_|$)/.test(value) && !/(?:^|_)(?:SERVER|SECRET|PRIVATE)(?:_|$)/.test(value));
export interface RoutingConfiguration {
  mode: "inherit" | "override" | "disabled";
  provider: RoutingProvider;
  serverKeyEnv: string;
  browserKeyEnv: string;
  maxStops: number;
  dailyPlans: number;
}
export interface RoutingReadiness {
  configuration: RoutingConfiguration;
  effective: { provider: RoutingProvider; source: "site" | "project"; maxStops: number; dailyPlans: number };
  ready: boolean;
  mapReady: boolean;
  disabled: boolean;
  canManage: boolean;
  revision: string;
  message: string;
}
export interface RoutePoint { lat: number; lng: number }
export interface RoutingStop {
  id: number;
  label: string;
  address: string;
  point: RoutePoint;
  scheduledAt: string | null;
  priority: number | null;
  subStatus: string | null;
  arrivalAt: string;
  serviceAt: string;
  departureAt: string;
  lateMinutes: number;
  travelSeconds: number;
  travelMeters: number;
}
export interface RoutingResult {
  projectId: number;
  provider: RoutingProvider;
  configurationRevision: string;
  fingerprint: string;
  createdAt: string;
  expiresAt: string;
  departureAt: string;
  origin: RoutePoint;
  stops: RoutingStop[];
  excluded: { id: number; label: string; reason: string }[];
  warnings: string[];
  geometry: RoutePoint[];
  totalTravelSeconds: number;
  totalTravelMeters: number;
  serviceMinutes: number;
  toleranceMinutes: number;
}
export const defaultRoutingConfiguration: RoutingConfiguration = {
  mode: "disabled", provider: "geoapify", serverKeyEnv: "",
  browserKeyEnv: "", maxStops: 20, dailyPlans: 50,
};
export function navigationLinks(point: RoutePoint) {
  const destination = encodeURIComponent(`${point.lat},${point.lng}`);
  return {
    apple: `https://maps.apple.com/?daddr=${destination}&dirflg=d`,
    google: `https://www.google.com/maps/dir/?api=1&destination=${destination}&travelmode=driving&dir_action=navigate`,
  };
}
