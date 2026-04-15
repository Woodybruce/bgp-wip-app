import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";

function getOsKey(): string {
  // OS_PLACES_API_KEY is what Woody set on Railway for the Places product;
  // keep OS_API_KEY as a fallback for the original WFS key if it ever differs.
  return (process.env.OS_PLACES_API_KEY || process.env.OS_API_KEY || "").trim();
}
const WFS_BASE = "https://api.os.uk/features/v1/wfs";

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

  // ─── OS Places search ─────────────────────────────────────────
  app.get("/api/os/places/search", requireAuth, async (req: Request, res: Response) => {
    try {
      const { query } = req.query;
      if (!query || typeof query !== "string") {
        return res.status(400).json({ error: "query parameter required" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_API_KEY not configured" });
      }

      const url = `https://api.os.uk/search/places/v1/find?query=${encodeURIComponent(query)}&key=${getOsKey()}&maxresults=20&dataset=DPA`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });

      if (resp.status === 401) {
        // OS Places not yet enabled on this key — return empty gracefully
        return res.json({ results: [], message: "OS Places API not enabled for this key" });
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OS Places search error ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] places search error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to search places" });
    }
  });

  // ─── OS Places UPRN lookup ────────────────────────────────────
  app.get("/api/os/places/uprn/:uprn", requireAuth, async (req: Request, res: Response) => {
    try {
      const { uprn } = req.params;
      if (!uprn) {
        return res.status(400).json({ error: "UPRN parameter required" });
      }
      if (!getOsKey()) {
        return res.status(503).json({ error: "OS_API_KEY not configured" });
      }

      const url = `https://api.os.uk/search/places/v1/uprn?uprn=${encodeURIComponent(uprn)}&key=${getOsKey()}&dataset=DPA`;
      const resp = await fetch(url, { headers: { Accept: "application/json" } });

      if (resp.status === 401) {
        return res.json({ results: [], message: "OS Places API not enabled for this key" });
      }
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`OS Places UPRN error ${resp.status}: ${text.slice(0, 200)}`);
      }

      const data = await resp.json();
      res.json(data);
    } catch (err: any) {
      console.error("[os-data] places uprn error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to lookup UPRN" });
    }
  });

  // ─── OS API Key for client ────────────────────────────────────
  app.get("/api/config/os-key", requireAuth, (_req: Request, res: Response) => {
    res.json({ key: getOsKey() });
  });

  console.log("[os-data] Ordnance Survey routes registered");
}
