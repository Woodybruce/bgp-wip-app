import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";

function getOsKey(): string {
  // OS_PLACES_API_KEY is what Woody set on Railway for the Places product;
  // keep OS_API_KEY as a fallback for the original WFS key if it ever differs.
  return (process.env.OS_PLACES_API_KEY || process.env.OS_API_KEY || "").trim();
}

export function isOsConfigured(): boolean {
  return getOsKey().length > 0;
}

const WFS_BASE = "https://api.os.uk/features/v1/wfs";
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
  const url = `${PLACES_BASE}/find?query=${encodeURIComponent(query)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 401) return [];
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OS Places find error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.results || []).map(normaliseDpa);
}

/**
 * Postcode → all addresses in that postcode. Useful for dropdown pickers on
 * property forms (user types the postcode, picks the exact address).
 */
export async function osPlacesByPostcode(postcode: string, maxresults = 100): Promise<OsPlacesResult[]> {
  if (!isOsConfigured() || !postcode) return [];
  const clean = postcode.trim().toUpperCase();
  const url = `${PLACES_BASE}/postcode?postcode=${encodeURIComponent(clean)}&key=${getOsKey()}&maxresults=${maxresults}&dataset=DPA`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 401) return [];
  if (resp.status === 404) return []; // OS returns 404 for no-match postcode
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OS Places postcode error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  return (data?.results || []).map(normaliseDpa);
}

/**
 * UPRN → canonical DPA address. Returns null if not found / not configured.
 */
export async function osPlacesByUprn(uprn: string): Promise<OsPlacesResult | null> {
  if (!isOsConfigured() || !uprn) return null;
  const url = `${PLACES_BASE}/uprn?uprn=${encodeURIComponent(uprn)}&key=${getOsKey()}&dataset=DPA`;
  const resp = await fetch(url, { headers: { Accept: "application/json" } });
  if (resp.status === 401 || resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`OS Places UPRN error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const data = await resp.json();
  const first = (data?.results || [])[0];
  return first ? normaliseDpa(first) : null;
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
