// Map layer pins endpoint — returns geocoded markers for Deals, Comps, and
// Lease Events so the Intelligence Map can render them as toggleable layers.
//
// Fast path: resolves coords from crm_properties JOIN (zero extra API cost).
// Slow path: geocodes postcode/address via Google — but only returns CACHED
// geocodes in the response. Un-cached items are geocoded in the background
// so they appear on the next request. Never blocks the HTTP response.

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { cached, getCachedOnly } from "./utils/intel-cache";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

function geocodeKey(text: string) {
  return `geocode:${text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}`;
}

async function geocodeText(text: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY || !text.trim()) return null;
  return cached(geocodeKey(text), async () => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${GOOGLE_API_KEY}&region=uk&components=country:GB`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const loc = data.results?.[0]?.geometry?.location;
    if (loc?.lat && loc?.lng) return { lat: loc.lat as number, lng: loc.lng as number };
    return null;
  }, 24 * 30);
}

// Check cache only — never fires Google API. Returns null on miss.
async function getCachedGeocode(text: string): Promise<{ lat: number; lng: number } | null> {
  if (!text.trim()) return null;
  return getCachedOnly<{ lat: number; lng: number }>(geocodeKey(text));
}

function addrFromJsonb(a: any): string {
  if (!a) return "";
  if (typeof a === "string") return a;
  return (
    a.formatted ||
    a.line1 ||
    a.street ||
    [a.buildingNumber, a.streetName, a.town, a.postcode].filter(Boolean).join(", ") ||
    ""
  );
}

// Fire-and-forget background geocoding so next request returns more pins.
function backgroundGeocode(items: string[]) {
  if (!GOOGLE_API_KEY) return;
  setImmediate(async () => {
    for (const text of items) {
      try { await geocodeText(text); } catch {}
    }
  });
}

export function registerMapLayerRoutes(app: Express) {
  app.get("/api/map/pins", requireAuth, async (_req: Request, res: Response) => {
    try {
      // ── 1. Deals ─────────────────────────────────────────────────────────
      // Primary: property JOIN. Fallback: geocode deal name (often an address).
      const dealsRes = await pool.query(`
        SELECT
          d.id, d.name, d.status, d.deal_type, d.pricing, d.total_area_sqft,
          d.property_id,
          p.latitude  AS p_lat,
          p.longitude AS p_lng,
          p.address   AS p_address,
          p.postcode  AS p_postcode
        FROM crm_deals d
        LEFT JOIN crm_properties p ON p.id = d.property_id
        ORDER BY d.created_at DESC
        LIMIT 500
      `);

      const deals: any[] = [];
      const dealsNeedGeocode: string[] = [];

      for (const r of dealsRes.rows) {
        let lat: number | null = null;
        let lng: number | null = null;

        if (r.p_lat && r.p_lng) {
          lat = parseFloat(r.p_lat);
          lng = parseFloat(r.p_lng);
        } else if (r.name) {
          const geo = await getCachedGeocode(r.name + ", UK");
          if (geo) { lat = geo.lat; lng = geo.lng; }
          else dealsNeedGeocode.push(r.name + ", UK");
        }

        if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
          deals.push({
            id: r.id,
            type: "deal",
            lat, lng,
            label: r.name,
            status: r.status,
            dealType: r.deal_type,
            pricing: r.pricing,
            areaSqft: r.total_area_sqft,
            addressLabel: addrFromJsonb(r.p_address) || r.p_postcode || r.name,
            propertyId: r.property_id,
          });
        }
      }
      backgroundGeocode(dealsNeedGeocode.slice(0, 50));

      // ── 2. Comps ──────────────────────────────────────────────────────────
      const compsRes = await pool.query(`
        SELECT
          c.id, c.name, c.deal_type, c.comp_type, c.address, c.postcode,
          c.tenant, c.headline_rent, c.area_sqft, c.completion_date,
          c.property_id,
          p.latitude  AS p_lat,
          p.longitude AS p_lng
        FROM crm_comps c
        LEFT JOIN crm_properties p ON p.id = c.property_id
        ORDER BY c.created_at DESC
        LIMIT 500
      `);

      const comps: any[] = [];
      const compsNeedGeocode: string[] = [];

      for (const r of compsRes.rows) {
        let lat: number | null = null;
        let lng: number | null = null;

        if (r.p_lat && r.p_lng) {
          lat = parseFloat(r.p_lat);
          lng = parseFloat(r.p_lng);
        } else if (r.postcode) {
          const geo = await getCachedGeocode(r.postcode + ", UK");
          if (geo) { lat = geo.lat; lng = geo.lng; }
          else compsNeedGeocode.push(r.postcode + ", UK");
        }

        if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
          const addrObj = r.address as any;
          comps.push({
            id: r.id,
            type: "comp",
            lat, lng,
            label: addrFromJsonb(addrObj) || r.postcode || r.name || "",
            tenant: r.tenant,
            dealType: r.deal_type,
            compType: r.comp_type,
            headlineRent: r.headline_rent,
            areaSqft: r.area_sqft,
            completionDate: r.completion_date,
            postcode: r.postcode,
          });
        }
      }
      backgroundGeocode(compsNeedGeocode.slice(0, 50));

      // ── 3. Lease Events ───────────────────────────────────────────────────
      const leaseRes = await pool.query(`
        SELECT
          le.id, le.address, le.tenant, le.event_type, le.event_date,
          le.current_rent, le.sqft, le.status, le.assigned_to,
          le.property_id,
          p.latitude  AS p_lat,
          p.longitude AS p_lng
        FROM lease_events le
        LEFT JOIN crm_properties p ON p.id = le.property_id
        ORDER BY le.event_date ASC NULLS LAST
        LIMIT 500
      `);

      const leaseEvents: any[] = [];
      const leaseNeedGeocode: string[] = [];

      for (const r of leaseRes.rows) {
        let lat: number | null = null;
        let lng: number | null = null;

        if (r.p_lat && r.p_lng) {
          lat = parseFloat(r.p_lat);
          lng = parseFloat(r.p_lng);
        } else if (r.address) {
          const geo = await getCachedGeocode(r.address);
          if (geo) { lat = geo.lat; lng = geo.lng; }
          else leaseNeedGeocode.push(r.address);
        }

        if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
          leaseEvents.push({
            id: r.id,
            type: "lease_event",
            lat, lng,
            label: r.address || "",
            tenant: r.tenant,
            eventType: r.event_type,
            eventDate: r.event_date,
            currentRent: r.current_rent,
            sqft: r.sqft,
            status: r.status,
            assignedTo: r.assigned_to,
          });
        }
      }
      backgroundGeocode(leaseNeedGeocode.slice(0, 50));

      res.json({ deals, comps, leaseEvents });
    } catch (err: any) {
      console.error("[map-layers] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load map pins" });
    }
  });

  console.log("[map-layers] routes registered");
}
