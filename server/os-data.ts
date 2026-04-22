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

/**
 * Free-text search — postal address, business name, whatever the user typed.
 * Returns up to `maxresults` normalised rows. Empty if OS isn't configured.
 */
export async function osPlacesFind(query: string, maxresults = 10): Promise<OsPlacesResult[]> {
  if (!isOsConfigured() || !query) return [];
  const key = `os-find:${query.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}:${maxresults}`;
  return cached(key, async () => {
    const url = `${PLACES_BASE}/find?query=${encodeURIComponent(query)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 401) return [] as OsPlacesResult[];
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OS Places find error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
  }, 24 * 7);
}

/**
 * Postcode → all addresses in that postcode. Useful for dropdown pickers on
 * property forms (user types the postcode, picks the exact address).
 */
export async function osPlacesByPostcode(postcode: string, maxresults = 100): Promise<OsPlacesResult[]> {
  if (!isOsConfigured() || !postcode) return [];
  const clean = postcode.trim().toUpperCase().replace(/\s+/g, "");
  return cached(`os-pc:${clean}:${maxresults}`, async () => {
    const url = `${PLACES_BASE}/postcode?postcode=${encodeURIComponent(clean)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 401) return [] as OsPlacesResult[];
    if (resp.status === 404) return [] as OsPlacesResult[];
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OS Places postcode error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
  }, 24 * 30);
}

/**
 * Lat/lng → closest DPA address(es). OS accepts a point as "lng,lat" in EPSG:4326
 * and returns ranked matches within a radius. Perfect for resolving a map click
 * to an authoritative UPRN without faffing with Google reverse-geocoded business
 * names.
 */
export async function osPlacesNearest(lat: number, lng: number, radiusMeters = 25): Promise<OsPlacesResult[]> {
  if (!isOsConfigured()) return [];
  if (!isFinite(lat) || !isFinite(lng)) return [];
  // Round to ~11m precision to maximise cache hits for nearby clicks
  const key = `os-nearest:${lat.toFixed(4)},${lng.toFixed(4)},${radiusMeters}`;
  return cached(key, async () => {
    const params = new URLSearchParams({
      point: `${lng},${lat}`,
      key: getOsKey(),
      radius: String(radiusMeters),
      srs: "WGS84",
      dataset: "DPA",
    });
    const url = `${PLACES_BASE}/nearest?${params.toString()}`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 401 || resp.status === 404) return [] as OsPlacesResult[];
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OS Places nearest error ${resp.status}: ${text.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data?.results || []).map(normaliseDpa) as OsPlacesResult[];
  }, 24 * 30);
}

/**
 * UPRN → canonical DPA address. Returns null if not found / not configured.
 */
export async function osPlacesByUprn(uprn: string): Promise<OsPlacesResult | null> {
  if (!isOsConfigured() || !uprn) return null;
  return cached(`os-uprn:${uprn}`, async () => {
    const url = `${PLACES_BASE}/uprn?uprn=${encodeURIComponent(uprn)}&key=${getOsKey()}&dataset=DPA`;
    const resp = await fetch(url, { headers: { Accept: "application/json" } });
    if (resp.status === 401 || resp.status === 404) return null;
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`OS Places UPRN error ${resp.status}: ${text.slice(0, 200)}`);
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

    const attempts: Array<{ label: string; url: string }> = [
      {
        label: "ngd:bld-fts-buildingpart-1",
        url: `${NGD_BASE}/collections/bld-fts-buildingpart-1/items?bbox=${ngdBbox}&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326&crs=http://www.opengis.net/def/crs/EPSG/0/4326&limit=100&key=${encodeURIComponent(key)}`,
      },
      {
        label: "ngd:bld-fts-building-1",
        url: `${NGD_BASE}/collections/bld-fts-building-1/items?bbox=${ngdBbox}&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/4326&crs=http://www.opengis.net/def/crs/EPSG/0/4326&limit=100&key=${encodeURIComponent(key)}`,
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

  // ─── OS Places free-text search (address autocomplete) ────────
  app.get("/api/os/places/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query, maxresults } = req.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query parameter required" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });
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
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });
      }
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
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_PLACES_API_KEY not configured" });
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
