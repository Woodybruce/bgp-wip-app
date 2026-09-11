import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { cached } from "./utils/intel-cache";

function getOsKey(): string {
  // OS_PLACES_API_KEY is what Woody set on Railway for the Places product;
  // keep OS_API_KEY as a fallback for the original WFS key if it ever differs.
  return (process.env.OS_PLACES_API_KEY || process.env.OS_API_KEY || "").trim();
}

export function isOsConfigured(): boolean {
  return getOsKey().length > 0;
}

const WFS_BASE = "https://api.os.uk/features/v1/wfs";
const NGD_BASE = "https://api.os.uk/features/ngd/ofa/v1";
const PLACES_BASE = "https://api.os.uk/search/places/v1";

// Simple in-memory cache: key -> { data, expires }
const cache = new Map<string, { data: any; expires: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function getCacheKey(prefix: string, bbox: string): string {
  // Round bbox to 3 decimal places for cache normalisation
  const parts = bbox.split(",").map((v) => parseFloat(v).toFixed(3));
  return `${prefix}:${parts.join(",")}`;
}

function getFromCache(key: string): any | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

function setCache(key: string, data: any): void {
  cache.set(key, { data, expires: Date.now() + CACHE_TTL });
  // Evict old entries if cache gets too large
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now > v.expires) cache.delete(k);
    }
  }
}

async function fetchWFS(
  typeName: string,
  bbox: string,
  maxFeatures = 500
): Promise<any> {
  const params = new URLSearchParams({
    service: "WFS",
    version: "2.0.0",
    request: "GetFeature",
    typeNames: typeName.includes(":") ? typeName : `osfeatures:${typeName}`,
    outputFormat: "GeoJSON",
    srsName: "urn:ogc:def:crs:EPSG::4326",
    bbox: `${bbox},urn:ogc:def:crs:EPSG::4326`,
    count: String(maxFeatures),
    key: getOsKey(),
  });

  const url = `${WFS_BASE}?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { Accept: "application/json" },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OS WFS ${typeName} error ${resp.status}: ${text.slice(0, 200)}`);
  }

  return resp.json();
}

// ─── Exported helpers for other server modules ─────────────────────────────
// Property forms, KYC orchestrator and CRM enrichment all benefit from being
// able to resolve an address → UPRN server-side without going through HTTP.

export type OsPlacesResult = {
  uprn?: string;
  address: string;
  postcode?: string;
  latitude?: number;
  longitude?: number;
  classification?: string;
  raw?: any;
};

function normaliseDpa(r: any): OsPlacesResult {
  const d = r?.DPA || r?.LPI || r || {};
  return {
    uprn: d.UPRN ? String(d.UPRN) : undefined,
    address: d.ADDRESS || d.FORMATTED_ADDRESS || "",
    postcode: d.POSTCODE || d.POSTCODE_LOCATOR || undefined,
    latitude: typeof d.LAT === "number" ? d.LAT : undefined,
    longitude: typeof d.LNG === "number" ? d.LNG : undefined,
    classification: d.CLASSIFICATION_CODE_DESCRIPTION || d.CLASSIFICATION_CODE || undefined,
    raw: d,
  };
}

// ─── Free fallback providers ────────────────────────────────────────────────
// OS Places is a paid product and the account doesn't carry it (403 Forbidden;
// Woody 2026-08-05: too expensive to keep). Address search falls back to
// Nominatim (OpenStreetMap) and postcode lookup to postcodes.io — both free.
// If the key ever regains Places access the primary path starts working again
// on its own; a 403 trips a 12-hour breaker so every lookup doesn't pay a
// doomed round-trip first. Free rows carry no UPRN.

let placesForbiddenUntil = 0;

function placesAvailable(): boolean {
  return isOsConfigured() && Date.now() > placesForbiddenUntil;
}

function tripPlacesBreaker(status: number): void {
  if (status === 403) placesForbiddenUntil = Date.now() + 12 * 60 * 60 * 1000;
}

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org";
const NOMINATIM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "BGP-Dashboard/1.0 (internal property tooling; woody@brucegillinghampollard.com)",
};

// Nominatim usage policy caps us at 1 request/second — serialise calls
// through a promise chain with spacing; cached() keeps repeats local.
let nominatimChain: Promise<unknown> = Promise.resolve();
function nominatimFetch(url: string): Promise<any | null> {
  const run = async () => {
    const resp = await fetch(url, { headers: NOMINATIM_HEADERS });
    if (!resp.ok) return null;
    return resp.json();
  };
  const result = nominatimChain.then(run, run);
  nominatimChain = result.catch(() => null).then(() => new Promise((r) => setTimeout(r, 1100)));
  return result;
}

function normaliseNominatim(r: any): OsPlacesResult {
  return {
    address: String(r?.display_name || "").replace(/, United Kingdom$/, ""),
    postcode: r?.address?.postcode || undefined,
    latitude: r?.lat != null ? parseFloat(r.lat) : undefined,
    longitude: r?.lon != null ? parseFloat(r.lon) : undefined,
    classification: [r?.class, r?.type].filter(Boolean).join("/") || undefined,
    raw: r,
  };
}

// ─── EPC-register UPRN stitch ───────────────────────────────────────────────
// The gov.uk EPC registers are free (email registration for a key) and carry
// address + UPRN for every certificated building — which is most commercial
// stock. When EPC_AUTH is set ("email:api-key" from
// epc.opendatacommunities.org, or the ready-made base64 token), free lookups
// get their UPRN back by matching against that postcode's certificates.
// Without the env var this is a no-op.

function epcAuthHeader(): string | null {
  const raw = (process.env.EPC_AUTH || "").trim();
  if (!raw) return null;
  return `Basic ${raw.includes(":") ? Buffer.from(raw).toString("base64") : raw}`;
}

async function epcCertificatesForPostcode(postcode: string): Promise<Array<{ address: string; uprn: string }>> {
  const auth = epcAuthHeader();
  if (!auth) return [];
  const clean = postcode.trim().toUpperCase();
  return cached(`epc-pc:${clean.replace(/\s+/g, "")}`, async () => {
    const rows: Array<{ address: string; uprn: string }> = [];
    for (const reg of ["non-domestic", "domestic"]) {
      try {
        const resp = await fetch(
          `https://epc.opendatacommunities.org/api/v1/${reg}/search?postcode=${encodeURIComponent(clean)}&size=200`,
          { headers: { Accept: "application/json", Authorization: auth } }
        );
        if (!resp.ok) continue;
        const data: any = await resp.json().catch(() => null);
        for (const r of data?.rows || []) {
          if (r.uprn) rows.push({ address: [r.address, r.address1, r.address2].filter(Boolean).join(", "), uprn: String(r.uprn) });
        }
      } catch {
        // register unreachable — the lookup still works, just without UPRNs
      }
    }
    return rows;
  }, 24 * 30);
}

function epcNormalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

async function attachUprnsFromEpc(results: OsPlacesResult[]): Promise<OsPlacesResult[]> {
  if (!epcAuthHeader()) return results;
  const wanting = results.filter((r) => !r.uprn && r.postcode);
  const postcodes = Array.from(new Set(wanting.map((r) => r.postcode as string))).slice(0, 3);
  if (!postcodes.length) return results;
  const byPc = new Map<string, Array<{ address: string; uprn: string }>>();
  for (const pc of postcodes) byPc.set(pc, await epcCertificatesForPostcode(pc));
  for (const r of wanting) {
    const certs = byPc.get(r.postcode as string) || [];
    if (!certs.length) continue;
    const target = epcNormalise(r.address);
    const num = (target.match(/\b\d+[a-z]?\b/) || [])[0];
    const matches = certs.filter((c) => {
      const ca = epcNormalise(c.address);
      if (num && !ca.includes(num)) return false;
      const tokens = target.split(" ").filter((t) => t.length > 3 && t !== num);
      return tokens.some((t) => ca.includes(t));
    });
    const uprns = Array.from(new Set(matches.map((m) => m.uprn)));
    // Only attach when the match is unambiguous — a wrong UPRN is worse
    // than no UPRN.
    if (uprns.length === 1) r.uprn = uprns[0];
  }
  return results;
}

async function freeFind(query: string, maxresults: number): Promise<OsPlacesResult[]> {
  const url = `${NOMINATIM_BASE}/search?q=${encodeURIComponent(query)}&format=jsonv2&addressdetails=1&countrycodes=gb&limit=${Math.min(maxresults, 40)}`;
  const data = await nominatimFetch(url);
  return attachUprnsFromEpc(Array.isArray(data) ? data.map(normaliseNominatim) : []);
}

async function freeNearest(lat: number, lng: number): Promise<OsPlacesResult[]> {
  const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lng}&format=jsonv2&addressdetails=1&zoom=18`;
  const data = await nominatimFetch(url);
  return attachUprnsFromEpc(data && !data.error ? [normaliseNominatim(data)] : []);
}

async function freePostcode(postcode: string, maxresults: number): Promise<OsPlacesResult[]> {
  const clean = postcode.trim().toUpperCase().replace(/\s+/g, "");
  const rows: OsPlacesResult[] = [];
  try {
    const resp = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`, { headers: { Accept: "application/json" } });
    if (resp.ok) {
      const d = (await resp.json())?.result;
      if (d) {
        rows.push({
          address: [d.postcode, d.admin_ward, d.admin_district].filter(Boolean).join(", "),
          postcode: d.postcode,
          latitude: d.latitude ?? undefined,
          longitude: d.longitude ?? undefined,
          classification: "postcode",
          raw: d,
        });
      }
    }
  } catch {
    // postcodes.io down — Nominatim below still gives us something
  }
  const nom = await freeFind(postcode, Math.min(maxresults, 20));
  return attachUprnsFromEpc(rows.concat(nom.filter((r) => r.address)).slice(0, maxresults));
}

/**
 * Free-text search — postal address, business name, whatever the user typed.
 * OS Places when available, Nominatim otherwise.
 */
export async function osPlacesFind(query: string, maxresults = 10): Promise<OsPlacesResult[]> {
  if (!query) return [];
  const key = `os-find:${query.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}:${maxresults}`;
  return cached(key, async () => {
    if (placesAvailable()) {
      const url = `${PLACES_BASE}/find?query=${encodeURIComponent(query)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (resp.ok) {
        const data = await resp.json();
        return (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
      }
      tripPlacesBreaker(resp.status);
    }
    return freeFind(query, maxresults);
  }, 24 * 7);
}

/**
 * Postcode → addresses/centroid for that postcode. OS Places gives the full
 * letterbox-level list; the free path returns the postcodes.io centroid plus
 * whatever addresses Nominatim knows.
 */
export async function osPlacesByPostcode(postcode: string, maxresults = 100): Promise<OsPlacesResult[]> {
  if (!postcode) return [];
  const clean = postcode.trim().toUpperCase().replace(/\s+/g, "");
  return cached(`os-pc:${clean}:${maxresults}`, async () => {
    if (placesAvailable()) {
      const url = `${PLACES_BASE}/postcode?postcode=${encodeURIComponent(clean)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (resp.ok) {
        const data = await resp.json();
        return (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
      }
      if (resp.status === 404) return [] as OsPlacesResult[];
      tripPlacesBreaker(resp.status);
    }
    return freePostcode(postcode, maxresults);
  }, 24 * 30);
}

/**
 * WGS84 lat/lng → British National Grid eastings/northings.
 *
 * OS Places API does NOT honour `srs` for input coordinates — the
 * `point` parameter is always parsed as BNG, no matter what srs we
 * send. Tried "WGS84" and "EPSG:4326"; both rejected with "Area of
 * data coverage is in BNG and is a minimum of 0,0 to maximum of
 * 700000,1300000". So we convert client-side.
 *
 * Pipeline: WGS84 lat/lng → Cartesian ECEF → Helmert 7-parameter shift
 * → OSGB36 lat/lng → transverse Mercator projection → BNG E/N. The
 * parameter values come from OS technical paper "A Guide to
 * Coordinate Systems in Great Britain". Accurate to ~5m across the
 * UK, well inside our 25m address-radius needs.
 */
function wgs84ToBng(lat: number, lng: number): { easting: number; northing: number } {
  // Step 1: WGS84 lat/lng → ECEF Cartesian on WGS84 ellipsoid
  const aW = 6378137.0;
  const bW = 6356752.314245;
  const e2W = 1 - (bW * bW) / (aW * aW);
  const phiW = (lat * Math.PI) / 180;
  const lamW = (lng * Math.PI) / 180;
  const nuW = aW / Math.sqrt(1 - e2W * Math.sin(phiW) ** 2);
  const xW = nuW * Math.cos(phiW) * Math.cos(lamW);
  const yW = nuW * Math.cos(phiW) * Math.sin(lamW);
  const zW = ((1 - e2W) * nuW) * Math.sin(phiW);

  // Step 2: Helmert 7-parameter shift WGS84 → OSGB36
  const tx = -446.448, ty = 125.157, tz = -542.060;
  const s = 20.4894e-6;
  const rx = (-0.1502 / 3600) * (Math.PI / 180);
  const ry = (-0.2470 / 3600) * (Math.PI / 180);
  const rz = (-0.8421 / 3600) * (Math.PI / 180);
  const xO = tx + (1 + s) * xW + -rz * yW + ry * zW;
  const yO = ty + rz * xW + (1 + s) * yW + -rx * zW;
  const zO = tz + -ry * xW + rx * yW + (1 + s) * zW;

  // Step 3: ECEF → OSGB36 lat/lng (Airy 1830 ellipsoid)
  const aA = 6377563.396;
  const bA = 6356256.909;
  const e2A = 1 - (bA * bA) / (aA * aA);
  const p = Math.sqrt(xO * xO + yO * yO);
  let phiA = Math.atan2(zO, p * (1 - e2A));
  for (let i = 0; i < 8; i++) {
    const nuA = aA / Math.sqrt(1 - e2A * Math.sin(phiA) ** 2);
    phiA = Math.atan2(zO + e2A * nuA * Math.sin(phiA), p);
  }
  const lamA = Math.atan2(yO, xO);

  // Step 4: OSGB36 lat/lng → BNG eastings/northings (transverse Mercator)
  const F0 = 0.9996012717;
  const phi0 = (49 * Math.PI) / 180;
  const lam0 = (-2 * Math.PI) / 180;
  const N0 = -100000;
  const E0 = 400000;
  const n = (aA - bA) / (aA + bA);
  const sinPhi = Math.sin(phiA);
  const cosPhi = Math.cos(phiA);
  const nu = (aA * F0) / Math.sqrt(1 - e2A * sinPhi * sinPhi);
  const rho = (aA * F0 * (1 - e2A)) / Math.pow(1 - e2A * sinPhi * sinPhi, 1.5);
  const eta2 = nu / rho - 1;
  const Ma = (1 + n + (5 / 4) * n * n + (5 / 4) * n * n * n) * (phiA - phi0);
  const Mb = (3 * n + 3 * n * n + (21 / 8) * n * n * n) * Math.sin(phiA - phi0) * Math.cos(phiA + phi0);
  const Mc = ((15 / 8) * n * n + (15 / 8) * n * n * n) * Math.sin(2 * (phiA - phi0)) * Math.cos(2 * (phiA + phi0));
  const Md = (35 / 24) * n * n * n * Math.sin(3 * (phiA - phi0)) * Math.cos(3 * (phiA + phi0));
  const M = bA * F0 * (Ma - Mb + Mc - Md);
  const tanPhi = Math.tan(phiA);
  const tan2 = tanPhi * tanPhi;
  const tan4 = tan2 * tan2;
  const I = M + N0;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * Math.pow(cosPhi, 3) * (5 - tan2 + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * Math.pow(cosPhi, 5) * (61 - 58 * tan2 + tan4);
  const IV = nu * cosPhi;
  const V = (nu / 6) * Math.pow(cosPhi, 3) * (nu / rho - tan2);
  const VI = (nu / 120) * Math.pow(cosPhi, 5) * (5 - 18 * tan2 + tan4 + 14 * eta2 - 58 * eta2 * tan2);
  const dLam = lamA - lam0;
  const N = I + II * dLam * dLam + III * Math.pow(dLam, 4) + IIIA * Math.pow(dLam, 6);
  const E = E0 + IV * dLam + V * Math.pow(dLam, 3) + VI * Math.pow(dLam, 5);
  return { easting: Math.round(E), northing: Math.round(N) };
}

/**
 * Lat/lng → closest DPA address(es). Uses OS Places `/radius` with the
 * input coordinates converted to BNG eastings/northings client-side —
 * OS Hub's API ignores the `srs` parameter for input and always parses
 * `point` as BNG. Results are sorted by haversine distance from the
 * input WGS84 point so the first row is still the true nearest.
 */
export async function osPlacesNearest(lat: number, lng: number, radiusMeters = 25): Promise<OsPlacesResult[]> {
  if (!isFinite(lat) || !isFinite(lng)) return [];
  // Round to ~11m precision to maximise cache hits for nearby clicks
  const key = `os-nearest:${lat.toFixed(4)},${lng.toFixed(4)},${radiusMeters}`;
  return cached(key, async () => {
    if (!placesAvailable()) return freeNearest(lat, lng);
    const bng = wgs84ToBng(lat, lng);
    const params = new URLSearchParams({
      point: `${bng.easting},${bng.northing}`,
      key: getOsKey(),
      radius: String(radiusMeters),
      dataset: "DPA",
    });
    const url = `${PLACES_BASE}/radius?${params.toString()}`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 404) return [] as OsPlacesResult[];
    if (!resp.ok) {
      tripPlacesBreaker(resp.status);
      return freeNearest(lat, lng);
    }
    const data = await resp.json();
    const results = (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
    // /radius returns results unordered relative to the input point.
    // Sort by haversine distance so the first item is the true nearest,
    // matching the old /nearest contract callers expect.
    const toRad = (v: number) => (v * Math.PI) / 180;
    const hav = (aLat: number, aLng: number, bLat: number, bLng: number): number => {
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
      return 2 * 6371000 * Math.asin(Math.sqrt(a));
    };
    results.sort((a: OsPlacesResult, b: OsPlacesResult) => {
      const aLat = Number(a.latitude); const aLng = Number(a.longitude);
      const bLat = Number(b.latitude); const bLng = Number(b.longitude);
      if (!isFinite(aLat) || !isFinite(aLng)) return 1;
      if (!isFinite(bLat) || !isFinite(bLng)) return -1;
      return hav(lat, lng, aLat, aLng) - hav(lat, lng, bLat, bLng);
    });
    return results;
  }, 24 * 30);
}

/**
 * UPRN → canonical DPA address. Returns null if not found / not configured.
 */
export async function osPlacesByUprn(uprn: string): Promise<OsPlacesResult | null> {
  // No free UPRN → address service exists; without Places this quietly
  // returns null and callers fall back to whatever address text they hold.
  if (!placesAvailable() || !uprn) return null;
  return cached(`os-uprn:${uprn}`, async () => {
    const url = `${PLACES_BASE}/uprn?uprn=${encodeURIComponent(uprn)}&key=${getOsKey()}&dataset=DPA`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 404) return null;
    if (!resp.ok) {
      tripPlacesBreaker(resp.status);
      return null;
    }
    const data = await resp.json();
    const first = (data?.results || [])[0];
    return first ? normaliseDpa(first) as OsPlacesResult : null;
  }, 24 * 30);
}

/**
 * Convenience: take any free-text address (e.g. from an unstructured lead row)
 * and try to resolve it to a single best-guess UPRN+canonical address.
 */
export async function resolveToUprn(freeText: string): Promise<OsPlacesResult | null> {
  const results = await osPlacesFind(freeText, 1);
  return results[0] || null;
}

export function registerOSDataRoutes(app: Express): void {
  // ─── NGD status check ────────────────────────────────────────────
  // One-click verification that the current OS_PLACES_API_KEY tier
  // supports NGD building polygons. Hits Trafalgar Square (known to have
  // building polygons) and reports status. Use this to know whether the
  // key needs upgrading to Premium / Partner.
  app.get("/api/os/ngd-status", requireAuth, async (_req: Request, res: Response) => {
    const key = getOsKey();
    if (!key) {
      return res.json({
        configured: false,
        recommendation: "Set OS_PLACES_API_KEY in env. Get a free Startup-tier key from os.uk/business-government/products/os-data-hub.",
      });
    }
    const bbox = "-0.130,51.506,-0.124,51.510"; // Trafalgar Square
    const ngdCrs = "filter-crs=http://www.opengis.net/def/crs/EPSG/0/4326";
    const ngdUrl = `${NGD_BASE}/collections/bld-fts-buildingpart-1/items?${ngdCrs}&bbox=${bbox}&limit=10&key=${encodeURIComponent(key)}`;
    try {
      const resp = await fetch(ngdUrl, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
      if (resp.ok) {
        const data = await resp.json();
        const count = data?.features?.length ?? 0;
        return res.json({
          configured: true,
          ngd: "ok",
          featureCount: count,
          message: count > 0
            ? `NGD building polygons working — ${count} features at the Trafalgar Square test bbox.`
            : "NGD endpoint accessible but returned no features at the test bbox (unexpected).",
        });
      }
      const body = await resp.text().catch(() => "");
      const wfsUrl = `${WFS_BASE}?service=WFS&version=2.0.0&request=GetFeature&typeNames=Topography_TopographicArea&outputFormat=GeoJSON&srsName=urn:ogc:def:crs:EPSG::4326&bbox=${bbox},urn:ogc:def:crs:EPSG::4326&count=10&key=${encodeURIComponent(key)}`;
      let wfsStatus: string | undefined;
      try {
        const wfsResp = await fetch(wfsUrl, { signal: AbortSignal.timeout(8000) });
        wfsStatus = wfsResp.ok ? "ok" : `${wfsResp.status}`;
      } catch {
        wfsStatus = "error";
      }
      return res.json({
        configured: true,
        ngd: "denied",
        ngdStatus: resp.status,
        ngdBody: body.slice(0, 200),
        wfsStatus,
        recommendation: resp.status === 401 || resp.status === 403
          ? "Current OS API key tier doesn't include NGD building polygons. Upgrade to Premium or Partner access at os.uk/business-government/products/os-data-hub. Legacy WFS Topography_TopographicArea " + (wfsStatus === "ok" ? "still works as a fallback." : "isn't available either.")
          : "Unexpected response from NGD. Check OS Data Hub status page.",
      });
    } catch (err: any) {
      return res.json({
        configured: true,
        ngd: "error",
        error: err?.message || "request failed",
      });
    }
  });

  // ─── Building footprints ───────────────────────────────────────
  app.get("/api/os/buildings", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bbox } = req.query;
      if (!bbox || typeof bbox !== "string") {
        return res.status(400).json({ error: "bbox query parameter required (swLat,swLng,neLat,neLng)" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_API_KEY not configured" });
      }

      const cacheKey = getCacheKey("buildings", bbox);
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWFS("Zoomstack_LocalBuildings", bbox, 2000);
      setCache(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] buildings error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch buildings" });
    }
  });

  // ─── MasterMap Buildings (Premium / NGD) ───────────────────────
  // Tries the modern OS NGD Features API first (bld-fts-buildingpart-1 gives
  // subdivided building parts, which is what we need to render Goad-style
  // shop-by-shop footprints). Falls back to legacy OS Features WFS if NGD
  // access isn't enabled on this key. Returns GeoJSON FeatureCollection or
  // a detailed error so we can tell if the plan needs upgrading.
  app.get("/api/os/mastermap-buildings", requireAuth, async (req: Request, res: Response) => {
    const bbox = typeof req.query.bbox === "string" ? req.query.bbox : "";
    if (!bbox) return res.status(400).json({ error: "bbox query parameter required (minLng,minLat,maxLng,maxLat)" });
    const key = getOsKey();
    if (!key) return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });

    const cacheKey = getCacheKey("mm-buildings", bbox);
    const hit = getFromCache(cacheKey);
    if (hit) return res.json(hit);

    // NGD expects bbox as minLng,minLat,maxLng,maxLat. Our map sends
    // swLat,swLng,neLat,neLng — normalise.
    const parts = bbox.split(",").map(parseFloat);
    if (parts.length !== 4 || parts.some(isNaN)) {
      return res.status(400).json({ error: "bbox must be 4 comma-separated numbers" });
    }
    const [swLat, swLng, neLat, neLng] = parts;
    const ngdBbox = `${swLng},${swLat},${neLng},${neLat}`;

    // NGD requires `filter-crs` (NOT bbox-crs) to interpret a WGS84 bbox.
    const ngdCrs = "filter-crs=http://www.opengis.net/def/crs/EPSG/0/4326";
    const attempts: Array<{ label: string; url: string }> = [
      {
        label: "ngd:bld-fts-buildingpart-1",
        url: `${NGD_BASE}/collections/bld-fts-buildingpart-1/items?${ngdCrs}&bbox=${ngdBbox}&limit=100&key=${encodeURIComponent(key)}`,
      },
      {
        label: "ngd:bld-fts-building-1",
        url: `${NGD_BASE}/collections/bld-fts-building-1/items?${ngdCrs}&bbox=${ngdBbox}&limit=100&key=${encodeURIComponent(key)}`,
      },
      {
        label: "wfs:Topography_TopographicArea",
        url: `${WFS_BASE}?${new URLSearchParams({
          service: "WFS",
          version: "2.0.0",
          request: "GetFeature",
          typeNames: "Topography_TopographicArea",
          outputFormat: "GeoJSON",
          srsName: "urn:ogc:def:crs:EPSG::4326",
          bbox: `${bbox},urn:ogc:def:crs:EPSG::4326`,
          count: "500",
          key,
        }).toString()}`,
      },
    ];

    const errors: Array<{ source: string; status: number; body: string }> = [];
    for (const attempt of attempts) {
      try {
        const resp = await fetch(attempt.url, { headers: { Accept: "application/json" } });
        if (resp.ok) {
          const data = await resp.json();
          const result = { source: attempt.label, featureCount: data?.features?.length ?? 0, data };
          setCache(cacheKey, result);
          return res.json(result);
        }
        const body = await resp.text().catch(() => "");
        errors.push({ source: attempt.label, status: resp.status, body: body.slice(0, 300) });
        console.warn(`[os-mastermap] ${attempt.label} failed ${resp.status}: ${body.slice(0, 200)}`);
        // 401/403 on first attempt → try next, but 500s/404s mean broken — keep trying
      } catch (err: any) {
        errors.push({ source: attempt.label, status: 0, body: err?.message || "network error" });
      }
    }

    res.status(502).json({
      error: "No OS MasterMap / NGD endpoint succeeded with this key — Premium plan or Partner access likely required",
      attempts: errors,
    });
  });

  // ─── UPRNs ─────────────────────────────────────────────────────
  app.get("/api/os/uprns", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bbox } = req.query;
      if (!bbox || typeof bbox !== "string") {
        return res.status(400).json({ error: "bbox query parameter required" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_API_KEY not configured" });
      }

      const cacheKey = getCacheKey("uprns", bbox);
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWFS("OpenUPRN_Address", bbox, 2000);
      setCache(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] uprns error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch UPRNs" });
    }
  });

  // ─── Functional Sites ─────────────────────────────────────────
  app.get("/api/os/sites", requireAuth, async (req: Request, res: Response) => {
    try {
      const { bbox } = req.query;
      if (!bbox || typeof bbox !== "string") {
        return res.status(400).json({ error: "bbox query parameter required" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_API_KEY not configured" });
      }

      const cacheKey = getCacheKey("sites", bbox);
      const cached = getFromCache(cacheKey);
      if (cached) return res.json(cached);

      const data = await fetchWFS("Sites_FunctionalSite", bbox, 500);
      setCache(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] sites error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch sites" });
    }
  });

  // ─── Linked Identifiers (UPRN ↔ TOID ↔ title number) ──────────
  // Any of uprn / toid / blpu can be passed as the identifier type. Returns
  // the OS Linked Identifiers payload which lists every related identifier
  // across the National Geographic Database. This is how we bridge a UPRN
  // from OS Places to a TOID on an NGD building polygon, or a TOID to its
  // Land Registry title number.
  app.get("/api/os/linked/:idType/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const idType = String(req.params.idType || "");
      const id = String(req.params.id || "");
      if (!id || !idType) return res.status(400).json({ error: "idType and id required" });
      const key = getOsKey();
      if (!key) return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });

      const cacheKey = `os-linked:${idType}:${id}`;
      const hit = getFromCache(cacheKey);
      if (hit) return res.json(hit);

      const url = `https://api.os.uk/search/links/v1/identifiers/${encodeURIComponent(id)}?key=${encodeURIComponent(key)}`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return res.status(resp.status).json({ error: `Linked Identifiers ${resp.status}: ${body.slice(0, 200)}` });
      }
      const data = await resp.json();
      setCache(cacheKey, data);
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] linked identifiers error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch linked identifiers" });
    }
  });

  // ─── OS Places free-text search (address autocomplete) ────────
  app.get("/api/os/places/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query, maxresults } = req.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query parameter required" });
      }
      const max = maxresults ? Math.min(parseInt(String(maxresults), 10) || 20, 100) : 20;
      const results = await osPlacesFind(query, max);
      res.json({ results });
    } catch (err: any) {
      console.error("[os-data] places search error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to search places" });
    }
  });

  // ─── OS Places postcode lookup (all addresses in a postcode) ─
  app.get("/api/os/places/postcode/:postcode", requireAuth, async (req: Request, res: Response) => {
    try {
      const postcode = String(req.params.postcode || "").trim();
      if (!postcode) return res.status(400).json({ error: "postcode parameter required" });
      const results = await osPlacesByPostcode(postcode);
      res.json({ results });
    } catch (err: any) {
      console.error("[os-data] places postcode error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to lookup postcode" });
    }
  });

  // ─── OS Places UPRN lookup ────────────────────────────────────
  app.get("/api/os/places/uprn/:uprn", requireAuth, async (req: Request, res: Response) => {
    try {
      const uprn = String(req.params.uprn || "");
      if (!uprn) return res.status(400).json({ error: "UPRN parameter required" });
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });
      }
      const result = await osPlacesByUprn(uprn);
      if (!result) return res.status(404).json({ error: "UPRN not found" });
      res.json(result);
    } catch (err: any) {
      console.error("[os-data] places uprn error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to lookup UPRN" });
    }
  });

  // ─── Resolve free-text → best-guess UPRN (convenience for forms) ─
  app.get("/api/os/places/resolve", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query } = req.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query parameter required" });
      }
      const result = await resolveToUprn(query);
      if (!result) return res.status(404).json({ error: "No match" });
      res.json(result);
    } catch (err: any) {
      console.error("[os-data] places resolve error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to resolve address" });
    }
  });

  // ─── OS API Key for client (map tiles — server can't render maps) ─
  app.get("/api/config/os-key", requireAuth, (_req: Request, res: Response) => {
    res.json({ key: getOsKey() });
  });

  console.log("[os-data] Ordnance Survey routes registered");
}
