// Map layer pins endpoint — returns geocoded markers for Deals, Comps, and
// Lease Events so the Intelligence Map can render them as toggleable layers.
//
// Coords are resolved via crm_properties JOIN first (fast, free), then
// Google Geocoding API for comps without a linked property (cached 30 days).

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { cached } from "./utils/intel-cache";

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;

async function geocodeText(text: string): Promise<{ lat: number; lng: number } | null> {
  if (!GOOGLE_API_KEY || !text.trim()) return null;
  const key = `geocode:${text.toLowerCase().trim().replace(/\s+/g, " ").slice(0, 120)}`;
  return cached(key, async () => {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(text)}&key=${GOOGLE_API_KEY}&region=uk&components=country:GB`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const loc = data.results?.[0]?.geometry?.location;
    if (loc?.lat && loc?.lng) return { lat: loc.lat as number, lng: loc.lng as number };
    return null;
  }, 24 * 30);
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

export function registerMapLayerRoutes(app: Express) {
  app.get("/api/map/pins", requireAuth, async (_req: Request, res: Response) => {
    try {
      // ── 1. Deals ─────────────────────────────────────────────────────────
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
        WHERE p.latitude  IS NOT NULL
          AND p.longitude IS NOT NULL
          AND p.latitude  <> ''
          AND p.longitude <> ''
        ORDER BY d.created_at DESC
        LIMIT 500
      `);

      const deals = dealsRes.rows
        .map((r: any) => {
          const lat = parseFloat(r.p_lat);
          const lng = parseFloat(r.p_lng);
          if (!isFinite(lat) || !isFinite(lng)) return null;
          return {
            id: r.id,
            type: "deal" as const,
            lat,
            lng,
            label: r.name,
            status: r.status,
            dealType: r.deal_type,
            pricing: r.pricing,
            areaSqft: r.total_area_sqft,
            addressLabel: addrFromJsonb(r.p_address) || r.p_postcode || r.name,
            propertyId: r.property_id,
          };
        })
        .filter(Boolean);

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
        WHERE c.postcode IS NOT NULL OR p.latitude IS NOT NULL
        ORDER BY c.created_at DESC
        LIMIT 500
      `);

      const compsSettled = await Promise.allSettled(
        compsRes.rows.map(async (r: any) => {
          let lat: number | null = null;
          let lng: number | null = null;

          if (r.p_lat && r.p_lng) {
            lat = parseFloat(r.p_lat);
            lng = parseFloat(r.p_lng);
          } else if (r.postcode) {
            const geo = await geocodeText(r.postcode + ", UK");
            if (geo) { lat = geo.lat; lng = geo.lng; }
          }

          if (lat === null || lng === null || !isFinite(lat) || !isFinite(lng)) return null;

          const addrObj = r.address as any;
          const addrStr = addrFromJsonb(addrObj) || r.postcode || r.name || "";
          return {
            id: r.id,
            type: "comp" as const,
            lat,
            lng,
            label: addrStr,
            tenant: r.tenant,
            dealType: r.deal_type,
            compType: r.comp_type,
            headlineRent: r.headline_rent,
            areaSqft: r.area_sqft,
            completionDate: r.completion_date,
            postcode: r.postcode,
          };
        })
      );
      const comps = compsSettled
        .filter((s) => s.status === "fulfilled" && s.value !== null)
        .map((s) => (s as PromiseFulfilledResult<any>).value);

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

      const leaseSettled = await Promise.allSettled(
        leaseRes.rows.map(async (r: any) => {
          let lat: number | null = null;
          let lng: number | null = null;

          if (r.p_lat && r.p_lng) {
            lat = parseFloat(r.p_lat);
            lng = parseFloat(r.p_lng);
          } else if (r.address) {
            const geo = await geocodeText(r.address);
            if (geo) { lat = geo.lat; lng = geo.lng; }
          }

          if (lat === null || lng === null || !isFinite(lat) || !isFinite(lng)) return null;

          return {
            id: r.id,
            type: "lease_event" as const,
            lat,
            lng,
            label: r.address || "",
            tenant: r.tenant,
            eventType: r.event_type,
            eventDate: r.event_date,
            currentRent: r.current_rent,
            sqft: r.sqft,
            status: r.status,
            assignedTo: r.assigned_to,
          };
        })
      );
      const leaseEvents = leaseSettled
        .filter((s) => s.status === "fulfilled" && s.value !== null)
        .map((s) => (s as PromiseFulfilledResult<any>).value);

      res.json({ deals, comps, leaseEvents });
    } catch (err: any) {
      console.error("[map-layers] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load map pins" });
    }
  });

  console.log("[map-layers] routes registered");
}
