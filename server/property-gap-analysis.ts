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

// Major UK shopping centres / retail destinations used as the peer set for
// the "at other schemes, not here" comparison (Woody, 2026-08-04: "can we
// look at other shopping centres for the brand gap analysis"). Approximate
// centre points; presence = any brand store within PEER_PRESENCE_KM.
const PEER_PRESENCE_KM = 0.7;
const PEER_SCHEMES: Array<{ name: string; lat: number; lng: number }> = [
  { name: "Bluewater", lat: 51.4389, lng: 0.2705 },
  { name: "Lakeside", lat: 51.489, lng: 0.2848 },
  { name: "Westfield London", lat: 51.5074, lng: -0.221 },
  { name: "Westfield Stratford", lat: 51.5439, lng: -0.0079 },
  { name: "Brent Cross", lat: 51.5766, lng: -0.2237 },
  { name: "Canary Wharf", lat: 51.5054, lng: -0.0192 },
  { name: "Battersea Power Station", lat: 51.4818, lng: -0.1445 },
  { name: "The Glades Bromley", lat: 51.4029, lng: 0.0159 },
  { name: "Trafford Centre", lat: 53.4669, lng: -2.3486 },
  { name: "Manchester Arndale", lat: 53.4831, lng: -2.2416 },
  { name: "Meadowhall", lat: 53.4139, lng: -1.4119 },
  { name: "Metrocentre", lat: 54.9575, lng: -1.665 },
  { name: "Eldon Square", lat: 54.9744, lng: -1.6153 },
  { name: "Merry Hill", lat: 52.4818, lng: -2.1207 },
  { name: "Bullring", lat: 52.4778, lng: -1.8942 },
  { name: "Touchwood Solihull", lat: 52.4123, lng: -1.7767 },
  { name: "centre:mk", lat: 52.0416, lng: -0.7558 },
  { name: "Rushden Lakes", lat: 52.2926, lng: -0.5813 },
  { name: "Liverpool ONE", lat: 53.4043, lng: -2.9865 },
  { name: "Trinity Leeds", lat: 53.7969, lng: -1.5437 },
  { name: "White Rose Leeds", lat: 53.758, lng: -1.5738 },
  { name: "St David's Cardiff", lat: 51.4796, lng: -3.1748 },
  { name: "Cabot Circus", lat: 51.4586, lng: -2.5852 },
  { name: "Cribbs Causeway", lat: 51.5252, lng: -2.5983 },
  { name: "Highcross Leicester", lat: 52.636, lng: -1.1359 },
  { name: "Victoria Centre Nottingham", lat: 52.957, lng: -1.1482 },
  { name: "The Oracle Reading", lat: 51.4525, lng: -0.9689 },
  { name: "Festival Place", lat: 51.267, lng: -1.087 },
  { name: "WestQuay", lat: 50.9034, lng: -1.4059 },
  { name: "Gunwharf Quays", lat: 50.7953, lng: -1.1077 },
  { name: "Churchill Square Brighton", lat: 50.8225, lng: -0.1445 },
  { name: "The Lexicon Bracknell", lat: 51.416, lng: -0.753 },
  { name: "Westgate Oxford", lat: 51.75, lng: -1.2607 },
  { name: "Braintree Village", lat: 51.864, lng: 0.5457 },
  { name: "Braehead", lat: 55.8768, lng: -4.3651 },
  { name: "Silverburn", lat: 55.8214, lng: -4.3441 },
  { name: "St James Quarter", lat: 55.954, lng: -3.1852 },
  { name: "Buchanan Galleries", lat: 55.8631, lng: -4.252 },
];

type LocResolveResult =
  | { ok: true; lat: number; lng: number; postcode: string | null; name: string }
  | { ok: false; reason: "no_property" | "no_coords_no_postcode" | "geocode_failed" | "no_google_key"; name?: string; postcode?: string | null };

async function resolvePropertyLocation(propertyId: string): Promise<LocResolveResult> {
  // Resolve postcode from BOTH the top-level column AND the address
  // JSONB — historically populated inconsistently across properties.
  // Same fallback for lat/lng if anyone's storing them inside the
  // address blob.
  const { rows } = await pool.query(
    `SELECT latitude, longitude, postcode,
            address->>'postcode' AS address_postcode,
            address->>'lat'      AS address_lat,
            address->>'lng'      AS address_lng,
            name
       FROM crm_properties WHERE id = $1`,
    [propertyId]
  );
  if (!rows[0]) return { ok: false, reason: "no_property" };
  const row = rows[0];
  const postcode = (row.postcode || row.address_postcode || "").trim() || null;

  // Stored coordinates win — fast path. Accept either top-level or
  // address-blob lat/lng.
  const lat = parseFloat(row.latitude || row.address_lat);
  const lng = parseFloat(row.longitude || row.address_lng);
  if (!isNaN(lat) && !isNaN(lng)) {
    return { ok: true, lat, lng, postcode, name: row.name };
  }

  // No coords, no postcode → user needs to fill one in.
  if (!postcode) {
    return { ok: false, reason: "no_coords_no_postcode", name: row.name, postcode: null };
  }

  // Postcode present but no Google key configured → can't geocode.
  if (!process.env.GOOGLE_API_KEY) {
    return { ok: false, reason: "no_google_key", name: row.name, postcode };
  }

  // Geocode via Google + persist the resolved lat/lng back so we don't
  // re-hit the API every render. Also backfill the top-level postcode
  // column if it was missing (it was likely only on address.postcode).
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(postcode)}&region=uk&components=country:GB&key=${process.env.GOOGLE_API_KEY}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (r.ok) {
      const j: any = await r.json();
      const loc = j.results?.[0]?.geometry?.location;
      if (loc?.lat && loc?.lng) {
        await pool.query(
          `UPDATE crm_properties
              SET latitude = COALESCE(NULLIF(latitude, ''), $1),
                  longitude = COALESCE(NULLIF(longitude, ''), $2),
                  postcode = COALESCE(NULLIF(postcode, ''), $3)
            WHERE id = $4`,
          [String(loc.lat), String(loc.lng), postcode, propertyId]
        ).catch(() => { /* best-effort persist; ignore lock contention */ });
        return { ok: true, lat: loc.lat, lng: loc.lng, postcode, name: row.name };
      }
    }
  } catch {
    /* swallow — fall through to geocode_failed below */
  }
  return { ok: false, reason: "geocode_failed", name: row.name, postcode };
}

// GET /api/property/:propertyId/brand-gaps
// Returns three buckets: onScheme, wider, and gap (peer brands missing from area)
router.get("/api/property/:propertyId/brand-gaps", requireAuth, async (req: Request, res: Response) => {
  try {
    const { resolveCompanyScope, isPropertyInScope } = await import("./company-scope");
    const gapScope = await resolveCompanyScope(req as any);
    if (gapScope && !(await isPropertyInScope(gapScope, req.params.propertyId as string))) {
      return res.status(403).json({ error: "Access denied" });
    }
    const propertyId = req.params.propertyId as string;
    const onSchemeRadiusKm = Number(req.query.onSchemeKm) || 0.5;
    const widerRadiusKm = Number(req.query.widerKm) || 2.0;
    const limit = Number(req.query.limit) || 30;

    const location = await resolvePropertyLocation(propertyId);
    if (!location.ok) {
      const reasons: Record<string, string> = {
        no_property: "Property not found.",
        no_coords_no_postcode: "Property has no postcode. Add a postcode on the property page and Brand Gap will geocode it automatically.",
        no_google_key: "GOOGLE_API_KEY isn't configured on the server — can't geocode the postcode.",
        geocode_failed: `Google couldn't geocode the postcode (${location.postcode}). Check the postcode is correct.`,
      };
      return res.status(400).json({ error: reasons[location.reason] || "Couldn't resolve property location", reason: location.reason });
    }

    // Pull all brand stores with geocoded locations. brand_stores is
    // created lazily by brand-profile when that module loads — if it
    // hasn't yet on this prod instance, degrade to "no stores yet"
    // rather than 500'ing the panel.
    const stores: any[] = await pool.query(
      `SELECT s.brand_company_id, s.name AS store_name, s.address, s.lat, s.lng, s.status,
              c.name AS brand_name, c.domain, c.rollout_status, c.company_type,
              c.is_tracked_brand, c.store_count, c.brand_group_id
         FROM brand_stores s
         JOIN crm_companies c ON c.id = s.brand_company_id
        WHERE s.lat IS NOT NULL AND s.lng IS NOT NULL
          AND c.merged_into_id IS NULL
          AND (s.status IS NULL OR s.status = 'open')`
    )
      .then(r => r.rows)
      .catch((e: any) => {
        if (e?.code === "42P01" || /relation .* does not exist/i.test(e?.message || "")) {
          console.warn("[brand-gaps] brand_stores table not yet present; returning empty:", e.message);
          return [];
        }
        throw e;
      });

    // Peer schemes for the "at other shopping centres, not here" comparison —
    // drop any that ARE this property (or share its site) so the subject
    // never counts as its own peer.
    const peerSchemes = PEER_SCHEMES.filter(
      ps => haversineKm(location.lat, location.lng, ps.lat, ps.lng) > 1.5
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
      peer_scheme_set: Set<string>;
    }>();

    for (const s of stores) {
      const dist = haversineKm(location.lat, location.lng, s.lat, s.lng);
      let entry = brandMap.get(s.brand_company_id);
      if (!entry) {
        entry = {
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
          peer_scheme_set: new Set<string>(),
        };
        brandMap.set(s.brand_company_id, entry);
      } else {
        entry.total_stores++;
        if (dist < entry.nearest_distance_km) {
          entry.nearest_distance_km = dist;
          entry.nearest_store = { name: s.store_name, address: s.address, lat: s.lat, lng: s.lng };
        }
      }
      // Which peer scheme (if any) is this store at? A store sits at one
      // scheme at most, so stop at the first hit.
      for (const ps of peerSchemes) {
        if (haversineKm(ps.lat, ps.lng, s.lat, s.lng) <= PEER_PRESENCE_KM) {
          entry.peer_scheme_set.add(ps.name);
          break;
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

    // Matching brand-side requirements — pulled in from the old
    // Property 360 panel (since merged in). Surfaces brands that
    // have an active leasing requirement compatible with this
    // property's available units (use class match).
    const matchingRequirements = await pool.query(
      `SELECT r.id, r.name, r.use, r.size, r.requirement_locations,
              r.company_id, c.name AS company_name, c.domain
         FROM crm_requirements_leasing r
         LEFT JOIN crm_companies c ON c.id = r.company_id
        WHERE r.status = 'Active'
          AND EXISTS (
            SELECT 1 FROM available_units au
             WHERE au.property_id = $1
               AND (au.use_class = ANY(r.use) OR r.use IS NULL OR array_length(r.use, 1) IS NULL)
          )
        ORDER BY r.created_at DESC
        LIMIT 30`,
      [propertyId]
    ).then(r => r.rows).catch(() => [] as any[]);

    // "At other shopping centres, not here" — the peer-scheme comparison
    // (Woody, 2026-08-04). A brand qualifies when it trades at one or more
    // peer schemes but has no store on/near THIS scheme. Ranked by breadth
    // of peer presence, live requirement, rollout momentum, then estate size.
    const reqCompanyIds = new Set(
      matchingRequirements.map((r: any) => String(r.company_id || "")).filter(Boolean)
    );
    const peerGaps = allBrands
      .filter(b => b.peer_scheme_set.size > 0 && b.nearest_distance_km > onSchemeRadiusKm)
      .map(b => ({
        ...b,
        peer_schemes: Array.from(b.peer_scheme_set).sort(),
        has_live_requirement: reqCompanyIds.has(String(b.brand_company_id)),
        peer_gap_score:
          b.peer_scheme_set.size * 10 +
          (reqCompanyIds.has(String(b.brand_company_id)) ? 25 : 0) +
          (b.rollout_status === "scaling" || b.rollout_status === "entering_uk" ? 15 : 0) +
          Math.min(b.total_stores, 30) / 3,
      }))
      .sort((a, b) => b.peer_gap_score - a.peer_gap_score)
      .slice(0, limit);

    // Clients get the gap analysis focused on THEIR brand slice (hospitality/
    // leisure/fitness + self-adds — the standing Landsec decision), not the
    // full brand universe (Woody, 2026-08-03).
    let sliceFilter: ((id: string) => boolean) | null = null;
    if (gapScope) {
      const { clientBrandSliceSql, isClientRequestUser } = await import("./company-scope");
      if (await isClientRequestUser(req as any)) {
        const candidateIds = [...new Set([...onScheme, ...wider, ...gap, ...peerGaps].map(b => String(b.brand_company_id)))];
        if (candidateIds.length) {
          const sliceSql = await clientBrandSliceSql(gapScope);
          const visible = await pool.query(
            `SELECT id FROM crm_companies WHERE id = ANY($1::text[]) AND ${sliceSql}`,
            [candidateIds]
          );
          const visibleSet = new Set(visible.rows.map((r: any) => String(r.id)));
          sliceFilter = (id: string) => visibleSet.has(id);
        } else {
          sliceFilter = () => false;
        }
      }
    }
    const sliced = <T extends { brand_company_id: string }>(arr: T[]) =>
      sliceFilter ? arr.filter(b => sliceFilter!(String(b.brand_company_id))) : arr;
    const slicedReqs = sliceFilter
      ? matchingRequirements.filter((r: any) => !r.company_id || sliceFilter!(String(r.company_id)))
      : matchingRequirements;

    // Sets don't survive JSON — strip the working field from every bucket.
    const publish = (b: any) => {
      const { peer_scheme_set, ...rest } = b;
      return { ...rest, nearest_distance_km: Number(b.nearest_distance_km.toFixed(2)) };
    };
    res.json({
      property: { id: propertyId, name: location.name, postcode: location.postcode, lat: location.lat, lng: location.lng },
      onScheme: sliced(onScheme).map(publish),
      wider: sliced(wider).map(publish),
      gap: sliced(gap).map(publish),
      peerGaps: sliced(peerGaps).map(publish),
      peerSchemesConsidered: peerSchemes.length,
      matchingRequirements: slicedReqs,
      categorySignature,
      radii: { onScheme: onSchemeRadiusKm, wider: widerRadiusKm, peerPresence: PEER_PRESENCE_KM },
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
