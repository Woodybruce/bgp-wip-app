// ─────────────────────────────────────────────────────────────────────────
// Property gap analysis — for a leasing pitch, identifies peer brands that
// operate in similar locations but are missing from the immediate area.
//
// Strategy:
//   1. Resolve subject property lat/lng.
//   2. Find brands whose nearest store is within 500m of the subject ("on-scheme").
//   3. Find brands whose nearest store is within 2km ("wider area").
//   4. Find brands with UK stores but none within 2km ("gap" candidates).
//   5. Rank gap candidates by: store count (bigger = stronger covenant)
//      and how close their nearest store is to the subject's wider region.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// Haversine distance in km between two lat/lng pairs
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function resolvePropertyLocation(propertyId: string): Promise<{ lat: number; lng: number; postcode: string | null; name: string } | null> {
  const { rows } = await pool.query(
    `SELECT latitude, longitude, postcode, name, address FROM crm_properties WHERE id = $1`,
    [propertyId]
  );
  if (!rows[0]) return null;
  const row = rows[0];

  // Try stored coordinates first
  const lat = parseFloat(row.latitude);
  const lng = parseFloat(row.longitude);
  if (!isNaN(lat) && !isNaN(lng)) {
    return { lat, lng, postcode: row.postcode, name: row.name };
  }

  // Fallback: geocode the postcode via Google
  if (row.postcode && process.env.GOOGLE_API_KEY) {
    try {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(row.postcode)}&region=uk&components=country:GB&key=${process.env.GOOGLE_API_KEY}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
      if (r.ok) {
        const j: any = await r.json();
        const loc = j.results?.[0]?.geometry?.location;
        if (loc?.lat && loc?.lng) {
          return { lat: loc.lat, lng: loc.lng, postcode: row.postcode, name: row.name };
        }
      }
    } catch {
      // ignore
    }
  }
  return null;
}

// GET /api/property/:propertyId/brand-gaps
// Returns three buckets: onScheme, wider, and gap (peer brands missing from area)
router.get("/api/property/:propertyId/brand-gaps", requireAuth, async (req: Request, res: Response) => {
  try {
    const { propertyId } = req.params;
    const onSchemeRadiusKm = Number(req.query.onSchemeKm) || 0.5;
    const widerRadiusKm = Number(req.query.widerKm) || 2.0;
    const limit = Number(req.query.limit) || 30;

    const location = await resolvePropertyLocation(propertyId);
    if (!location) {
      return res.status(400).json({ error: "Property has no geocoded location or postcode" });
    }

    // Pull all brand stores with geocoded locations
    const { rows: stores } = await pool.query(
      `SELECT s.brand_company_id, s.name AS store_name, s.address, s.lat, s.lng, s.status,
              c.name AS brand_name, c.domain, c.rollout_status, c.company_type,
              c.is_tracked_brand, c.store_count, c.brand_group_id
         FROM brand_stores s
         JOIN crm_companies c ON c.id = s.brand_company_id
        WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
          AND c.merged_into_id IS NULL
          AND (s.status IS NULL OR s.status = 'open')`
    );

    // Group by brand — calculate nearest store distance per brand
    const brandMap = new Map<string, {
      brand_company_id: string;
      brand_name: string;
      domain: string | null;
      rollout_status: string | null;
      company_type: string | null;
      is_tracked_brand: boolean;
      total_stores: number;
      nearest_distance_km: number;
      nearest_store: { name: string; address: string | null; lat: number; lng: number };
      brand_group_id: string | null;
    }>();

    for (const s of stores) {
      const dist = haversineKm(location.lat, location.lng, s.lat, s.lng);
      const existing = brandMap.get(s.brand_company_id);
      if (!existing) {
        brandMap.set(s.brand_company_id, {
          brand_company_id: s.brand_company_id,
          brand_name: s.brand_name,
          domain: s.domain,
          rollout_status: s.rollout_status,
          company_type: s.company_type,
          is_tracked_brand: s.is_tracked_brand,
          total_stores: 1,
          nearest_distance_km: dist,
          nearest_store: { name: s.store_name, address: s.address, lat: s.lat, lng: s.lng },
          brand_group_id: s.brand_group_id,
        });
      } else {
        existing.total_stores++;
        if (dist < existing.nearest_distance_km) {
          existing.nearest_distance_km = dist;
          existing.nearest_store = { name: s.store_name, address: s.address, lat: s.lat, lng: s.lng };
        }
      }
    }

    const allBrands = Array.from(brandMap.values());

    const onScheme = allBrands
      .filter(b => b.nearest_distance_km <= onSchemeRadiusKm)
      .sort((a, b) => a.nearest_distance_km - b.nearest_distance_km);

    const wider = allBrands
      .filter(b => b.nearest_distance_km > onSchemeRadiusKm && b.nearest_distance_km <= widerRadiusKm)
      .sort((a, b) => a.nearest_distance_km - b.nearest_distance_km);

    // Gap: peer brands with >= 3 stores but nearest is > widerRadiusKm from subject.
    // These are brands that have chosen similar UK locations but not this one.
    const gap = allBrands
      .filter(b => b.nearest_distance_km > widerRadiusKm && b.total_stores >= 3)
      // Prioritise scaling brands + those with reasonable proximity somewhere (active in the region)
      .map(b => ({
        ...b,
        gap_score:
          (b.rollout_status === "scaling" || b.rollout_status === "entering_uk" ? 30 : 0) +
          Math.min(b.total_stores, 50) +
          Math.max(0, 30 - b.nearest_distance_km),
      }))
      .sort((a, b) => b.gap_score - a.gap_score)
      .slice(0, limit);

    // Build category signature from on-scheme brands so gaps are contextually aware
    const categorySignature = onScheme
      .map(b => b.company_type || "Tenant")
      .reduce((acc: Record<string, number>, ct) => {
        acc[ct] = (acc[ct] || 0) + 1;
        return acc;
      }, {});

    res.json({
      property: { id: propertyId, name: location.name, postcode: location.postcode, lat: location.lat, lng: location.lng },
      onScheme: onScheme.map(b => ({ ...b, nearest_distance_km: Number(b.nearest_distance_km.toFixed(2)) })),
      wider: wider.map(b => ({ ...b, nearest_distance_km: Number(b.nearest_distance_km.toFixed(2)) })),
      gap: gap.map(b => ({ ...b, nearest_distance_km: Number(b.nearest_distance_km.toFixed(2)) })),
      categorySignature,
      radii: { onScheme: onSchemeRadiusKm, wider: widerRadiusKm },
      stats: {
        totalBrands: allBrands.length,
        brandsWithStores: stores.length,
      },
    });
  } catch (err: any) {
    console.error("[brand-gaps]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
