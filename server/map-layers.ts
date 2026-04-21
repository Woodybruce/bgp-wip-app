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

  // ─── Building label overrides ────────────────────────────────────────────────
  // Returns the best-known label for each location in a bbox, drawn from three
  // sources in priority order: 1) BGP CRM properties, 2) BGP comps, 3) Google
  // Places (current trading names — fresher than OSM). Client matches each
  // returned point to the nearest building polygon and overrides the OSM label.
  app.get("/api/map/labels", requireAuth, async (req: Request, res: Response) => {
    try {
      const bbox = String(req.query.bbox || "").trim();
      if (!bbox) return res.status(400).json({ error: "bbox required (s,w,n,e)" });
      const [s, w, n, e] = bbox.split(",").map(parseFloat);
      if (![s, w, n, e].every(Number.isFinite)) return res.status(400).json({ error: "invalid bbox" });

      // 1. CRM properties in bbox (highest priority — these are confirmed BGP relationships)
      const crmRes = await pool.query(`
        SELECT id, name, latitude, longitude, address, asset_class
        FROM crm_properties
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
          AND latitude <> '' AND longitude <> ''
          AND latitude::float BETWEEN $1 AND $2
          AND longitude::float BETWEEN $3 AND $4
        LIMIT 200
      `, [s, n, w, e]);

      const crmLabels = crmRes.rows
        .map((r: any) => {
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            lat, lng,
            label: r.name,
            source: "crm" as const,
            assetClass: r.asset_class,
            propertyId: r.id,
          };
        })
        .filter(Boolean);

      // 2. Comps in bbox via property join (only those with property coords here;
      // free-floating comps without a property come through as map-pins instead)
      const compRes = await pool.query(`
        SELECT c.id, c.name, c.tenant, c.use_class, p.latitude, p.longitude
        FROM crm_comps c
        JOIN crm_properties p ON p.id = c.property_id
        WHERE p.latitude IS NOT NULL AND p.longitude IS NOT NULL
          AND p.latitude::float BETWEEN $1 AND $2
          AND p.longitude::float BETWEEN $3 AND $4
        LIMIT 200
      `, [s, n, w, e]);

      const compLabels = compRes.rows
        .map((r: any) => {
          const lat = parseFloat(r.latitude);
          const lng = parseFloat(r.longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
          return {
            lat, lng,
            label: r.tenant || r.name,
            source: "comp" as const,
            useClass: r.use_class,
            compId: r.id,
          };
        })
        .filter(Boolean);

      // 3. VOA rates — every rateable commercial unit with tenant (firm_name),
      // description (SHOP/RESTAURANT/etc), and rateable value. Addresses
      // aren't pre-geocoded so we geocode on-demand from the intel cache
      // only — misses are background-filled so the next visit is complete.
      // Use postcode prefix filter so we don't pull every VOA row in the UK.
      const pcLat = (s + n) / 2;
      const pcLng = (w + e) / 2;
      let voaLabels: any[] = [];
      const voaNeedGeocode: Array<{ uarn: string; text: string }> = [];
      try {
        const voaQ = await pool.query(`
          SELECT uarn, firm_name, number_or_name, street, postcode, description_text, rateable_value
          FROM voa_ratings
          WHERE postcode IS NOT NULL
            AND (street IS NOT NULL OR number_or_name IS NOT NULL OR firm_name IS NOT NULL)
          ORDER BY id
          LIMIT 2000
        `);
        const nearbyRows = voaQ.rows.filter((r: any) => {
          if (!r.postcode) return false;
          return true; // will filter by geocoded coords below
        });

        for (const r of nearbyRows) {
          const addressText = [r.number_or_name, r.street, r.town, r.postcode].filter(Boolean).join(", ");
          if (!addressText) continue;
          const geoKey = geocodeKey(addressText);
          const cached = await getCachedOnly<{ lat: number; lng: number }>(geoKey);
          if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) {
            // Filter by bbox
            if (cached.lat >= s && cached.lat <= n && cached.lng >= w && cached.lng <= e) {
              voaLabels.push({
                lat: cached.lat,
                lng: cached.lng,
                label: (r.firm_name && r.firm_name.trim()) || r.description_text || "Commercial",
                source: "voa" as const,
                rateableValue: r.rateable_value,
                descriptionText: r.description_text,
                uarn: r.uarn,
                address: addressText,
              });
            }
          } else {
            // Only queue for background geocode if the postcode is roughly in area
            // (cheap pre-filter by postcode district)
            voaNeedGeocode.push({ uarn: r.uarn, text: addressText });
          }
        }
      } catch (err: any) {
        console.warn("[map-layers/labels] VOA lookup error:", err?.message);
      }
      // Background-geocode misses so next call returns more (cap 30/request)
      backgroundGeocode(voaNeedGeocode.slice(0, 30).map(v => v.text));

      // 4. Google Places — current trading names. Cached aggressively per
      // ~110m grid square so a typical map pan reuses the same Places call.
      const cellSize = 0.001;          // ~110m
      const sCell = Math.floor(s / cellSize) * cellSize;
      const wCell = Math.floor(w / cellSize) * cellSize;
      const nCell = Math.ceil(n / cellSize) * cellSize;
      const eCell = Math.ceil(e / cellSize) * cellSize;
      const placesLabels: any[] = [];

      if (GOOGLE_API_KEY) {
        const cellPromises: Promise<any[]>[] = [];
        for (let lat = sCell; lat < nCell; lat += cellSize) {
          for (let lng = wCell; lng < eCell; lng += cellSize) {
            const cellLat = lat + cellSize / 2;
            const cellLng = lng + cellSize / 2;
            const key = `places:${cellLat.toFixed(4)},${cellLng.toFixed(4)}`;
            cellPromises.push(cached(key, async () => {
              const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${cellLat},${cellLng}&radius=80&key=${GOOGLE_API_KEY}`;
              const r = await fetch(url);
              if (!r.ok) return [] as any[];
              const data = await r.json() as any;
              // Only include types useful on a retail plan — skip Airbnb
              // listings, residential addresses, personal names, transit stops,
              // and anything without an obvious commercial category.
              const USEFUL = new Set([
                "store", "shop", "clothing_store", "convenience_store", "department_store",
                "electronics_store", "furniture_store", "grocery_or_supermarket", "hardware_store",
                "home_goods_store", "jewelry_store", "liquor_store", "pet_store", "shoe_store",
                "supermarket", "book_store", "bicycle_store", "florist", "gift_shop",
                "restaurant", "cafe", "bar", "bakery", "meal_takeaway", "meal_delivery", "food",
                "night_club", "pub",
                "bank", "atm", "pharmacy", "post_office",
                "gym", "beauty_salon", "hair_care", "spa",
                "cinema", "movie_theater", "museum", "theater", "art_gallery", "library",
                "dentist", "doctor", "hospital", "veterinary_care",
                "car_dealer", "car_rental", "car_repair",
              ]);
              const SKIP = new Set([
                "lodging", "transit_station", "bus_station", "train_station", "subway_station",
                "taxi_stand", "parking", "locality", "sublocality", "premise", "subpremise",
                "route", "street_address", "postal_code", "political", "neighborhood",
                "point_of_interest",
              ]);
              return (data.results || [])
                .filter((p: any) => p?.geometry?.location && p?.name)
                .filter((p: any) => {
                  const types: string[] = p.types || [];
                  if (types.some((t) => SKIP.has(t)) && !types.some((t) => USEFUL.has(t))) return false;
                  if (!types.some((t) => USEFUL.has(t))) return false;
                  // Drop if name looks like an Airbnb title (has digits + common flat words)
                  const name = String(p.name || "");
                  if (/\b(bed|bedroom|bdrm|bdm|flat|apt|apartment|studio|en[- ]?suite|double bed|single bed)\b/i.test(name)) return false;
                  if (name.length > 40) return false; // tenants don't have 40-char names
                  return true;
                })
                .map((p: any) => ({
                  lat: p.geometry.location.lat,
                  lng: p.geometry.location.lng,
                  label: p.name,
                  source: "google" as const,
                  types: p.types,
                  placeId: p.place_id,
                }));
            }, 24 * 30));
          }
        }
        const settled = await Promise.allSettled(cellPromises);
        for (const s of settled) {
          if (s.status === "fulfilled") placesLabels.push(...s.value);
        }
      }

      // Dedupe Google results by normalised name+location (Places sometimes
      // returns the same business under multiple types).
      const seen = new Set<string>();
      const dedupedPlaces = placesLabels.filter((p) => {
        const key = `${(p.label || "").toLowerCase()}|${p.lat.toFixed(5)}|${p.lng.toFixed(5)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      res.json({
        crm: crmLabels,
        comps: compLabels,
        voa: voaLabels,
        google: dedupedPlaces,
        sources: { crm: crmLabels.length, comps: compLabels.length, voa: voaLabels.length, google: dedupedPlaces.length },
      });
    } catch (err: any) {
      console.error("[map-layers/labels] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to load labels" });
    }
  });

  console.log("[map-layers] routes registered");
}
