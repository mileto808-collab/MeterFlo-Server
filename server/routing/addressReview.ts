import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { AddressMatchSummary, AddressReview, GeocodedPoint } from "../../shared/workOrderRouting";
import { RoutingError } from "./providers";

const words: Record<string, string> = {
  st: "street", rd: "road", ave: "avenue", av: "avenue", blvd: "boulevard",
  dr: "drive", ln: "lane", ct: "court", cir: "circle", pl: "place", pkwy: "parkway",
  hwy: "highway", ter: "terrace", trl: "trail", rte: "route", cr: "county road",
  n: "north", s: "south", e: "east", w: "west", ne: "northeast", nw: "northwest",
  se: "southeast", sw: "southwest",
};
const normalize = (value = "") => value.normalize("NFKD").replace(/\p{M}/gu, "")
  .toLowerCase().replace(/(\d)\.(?=\d)/g, "$1decimal")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).map(word => words[word] ?? word).join(" ");
const postal = (value = "") => /^\d{5}(?:[-\s]\d{4})?$/.test(value.trim())
  ? value.trim().slice(0, 5) : value.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
const stateNames = "AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming";
const states = new Map<string, string>(stateNames.split("|").flatMap(pair => {
  const [code, name] = pair.split(":");
  return [[normalize(code), code.toLowerCase()], [normalize(name), code.toLowerCase()]] as [string, string][];
}));
const state = (value = "") => states.get(normalize(value.replace(/^US-/i, ""))) ?? normalize(value);
type Submitted = { address: string; city?: string | null; state?: string | null; zip?: string | null };

export function addressMatchReasons(expected: Submitted, result: GeocodedPoint): string[] {
  const actual = result.addressMatch;
  if (!actual?.formatted || !actual.street) return ["The provider did not return enough address details to verify this location."];
  const streetLine = expected.address.split(",")[0].trim().replace(/\s+(?:apt\.?|suite|ste\.?|unit|#)\s*[\w-]+\s*$/i, "");
  const house = streetLine.match(/^(\d+(?:[./-]\d+)*[a-z]?)\s+(.+)$/i);
  const reasons: string[] = [];
  if (house && normalize(house[1]) !== normalize(actual.houseNumber))
    reasons.push("House number differs or was not verified.");
  if (normalize(house?.[2] ?? streetLine) !== normalize(actual.street))
    reasons.push("Street name or road number differs.");
  if (expected.city?.trim() && normalize(expected.city) !== normalize(actual.city))
    reasons.push("City differs or was not verified.");
  if (expected.state?.trim() && ![actual.state, actual.stateCode].some(value => value && state(value) === state(expected.state!)))
    reasons.push("State or region differs or was not verified.");
  if (expected.zip?.trim() && postal(expected.zip) !== postal(actual.postcode))
    reasons.push("Postal code differs or was not verified.");
  return reasons;
}

export function manualAddressFields(address: string): Submitted {
  const parts = address.split(",").map(part => part.trim());
  if (/^(?:us|usa|united states(?: of america)?)$/i.test(parts.at(-1) ?? "")) parts.pop();
  const [street, city, ...region] = parts;
  const stateZip = region.join(" ").match(/^(.+?)\s+(\d{5}(?:-\d{4})?)$/);
  return { address: street, city, state: stateZip?.[1] ?? region.join(" "), zip: stateZip?.[2] };
}

export const reviewHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
type Claim = { scope: string; match: string; expires: number };
function signingKey(secret?: string) {
  const key = secret ?? process.env.SESSION_SECRET;
  if (!key) throw new RoutingError(503, "Address review signing is unavailable. Check the server session configuration.");
  return key;
}
export function readAddressConfirmation(token: string, scope: string, now = Date.now(), secret?: string): Claim | null {
  if (typeof token !== "string" || token.length > 1024) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !/^[A-Za-z0-9_-]+$/.test(signature)) return null;
  const expected = createHmac("sha256", signingKey(secret)).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const claim = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claim.scope === scope && typeof claim.match === "string" &&
      Number.isFinite(claim.expires) && claim.expires > now ? claim : null;
  } catch { return null; }
}

export function createAddressReview(
  summary: Omit<AddressMatchSummary, "reasons" | "resolvedAddress">,
  expected: Submitted, geocoded: GeocodedPoint, scope: string,
  confirmations: readonly string[], now = Date.now(), secret?: string,
): { pending?: AddressReview; confirmed?: AddressMatchSummary } {
  const reasons = addressMatchReasons(expected, geocoded);
  if (!reasons.length) return {};
  const match: AddressMatchSummary = {
    ...summary, resolvedAddress: geocoded.addressMatch?.formatted || "Address details unavailable",
    reasons,
  };
  const digest = reviewHash([match, geocoded.addressMatch]);
  if (confirmations.some(token => readAddressConfirmation(token, scope, now, secret)?.match === digest))
    return { confirmed: match };
  const payload = Buffer.from(JSON.stringify({ scope, match: digest, expires: now + 10 * 60_000 })).toString("base64url");
  const signature = createHmac("sha256", signingKey(secret)).update(payload).digest("base64url");
  return { pending: { ...match, token: `${payload}.${signature}` } };
}
