import { z } from "zod";
import type { GeocodedPoint, RoutePoint } from "../../shared/workOrderRouting";
import { RoutingError, type RoutingService } from "./providers";

// Included in route fingerprints so plans made with GPS-first resolution expire.
export const destinationPolicy = "street-address-review-v2";

const point = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
});

export function parseGps(value: unknown): RoutePoint | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
  if (!match) return null;
  const parsed = point.safeParse({ lat: Number(match[1]), lng: Number(match[2]) });
  return parsed.success ? parsed.data : null;
}

type DestinationFields = {
  address?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;
  newGps?: string | null;
  oldGps?: string | null;
};

export function destinationAddress(order: DestinationFields): string {
  return [order.address, order.city, order.state, order.zip]
    .map(value => value?.trim()).filter(Boolean).join(", ");
}

export async function resolveDestination(
  order: DestinationFields,
  provider: Pick<RoutingService, "geocode">,
  review?: (geocoded: GeocodedPoint) => void,
): Promise<RoutePoint> {
  // Equipment GPS can be historical or imported sample data. It must not
  // silently override the address shown to the technician, including when
  // geocoding fails or rejects an ambiguous address.
  if (order.address?.trim()) {
    const geocoded = await provider.geocode(destinationAddress(order));
    review?.(geocoded);
    return { lat: geocoded.lat, lng: geocoded.lng };
  }
  const gps = parseGps(order.newGps) || parseGps(order.oldGps);
  if (gps) return gps;
  throw new RoutingError(422, "Missing street address and valid GPS coordinates.");
}
