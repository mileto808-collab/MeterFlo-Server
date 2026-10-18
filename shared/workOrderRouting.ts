export type RoutingProvider = "google" | "geoapify";
// Sub-statuses retain the core parent status on the work order. Check the
// complete filtered grid scope, not the selected rows or current page.
export function hasScheduledRouteScope<T extends { status?: string | null }>(orders: readonly T[]): boolean {
  return orders.some(order => order.status === "Scheduled");
}
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
export interface GeocodedAddress {
  formatted: string;
  houseNumber?: string;
  street?: string;
  city?: string;
  state?: string;
  stateCode?: string;
  postcode?: string;
}
export interface GeocodedPoint extends RoutePoint { addressMatch?: GeocodedAddress }
export interface AddressMatchSummary {
  id: string;
  kind: "origin" | "stop";
  workOrderId?: number;
  label: string;
  submittedAddress: string;
  resolvedAddress: string;
  point: RoutePoint;
  reasons: string[];
}
export interface AddressReview extends AddressMatchSummary { token: string }
export interface RoutingStop {
  id: number;
  label: string;
  address: string;
  point: RoutePoint;
  scheduledAt: string | null;
  appointmentWindowStart: string | null;
  appointmentWindowEnd: string | null;
  serviceDurationMinutes: number;
  durationSource: "work-order" | "project" | "route" | "legacy";
  appointmentSource: "window" | "scheduled" | "none";
  waitingMinutes: number;
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
  dispatchPlanId?: string;
  receivedDispatchId?: string;
  assignmentRoutingVersion?: 1;
  assigneeId?: string;
  assigneeName?: string;
  originAddress?: string;
  scopeIds?: number[];
  routes?: RoutingResult[];
  addressReviewVersion?: 1;
  confirmedAddressMatches?: AddressMatchSummary[];
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
export interface DispatchedRouteSummary {
  id: string;
  departureAt: string;
  expiresAt: string;
  stopCount: number;
  originAddress: string;
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
