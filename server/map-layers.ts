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
  // Shopping-centre directory research — fills the Goad gap where OSM + VOA
  // can't subdivide the interior of a shopping centre into individual shop
  // units. Takes a centre name, asks Perplexity (via askPerplexity wrapper)
  // to scrape the centre's own plan-your-visit page, returns a tenant list.
  // Cached 30 days — centre directories change slowly.
  app.get("/api/map/centre-directory", requireAuth, async (req: Request, res: Response) => {
    const name = typeof req.query.name === "string" ? req.query.name.trim() : "";
    const address = typeof req.query.address === "string" ? req.query.address.trim() : "";
    if (!name) return res.status(400).json({ error: "name query parameter required" });
    try {
      const key = `centre-directory:${name.toLowerCase().slice(0, 120)}`;
      // Known-centre directory URLs we can scrape directly — much more
      // reliable than asking an LLM to find them. Add more as they're
      // verified. Format is { name → [urls to try in order] }.
      // Note: Cardinal Place + Nova Victoria share the Landsec-run
      // atvictorialondon.com directory — same URL for both.
      const CENTRE_URLS: Record<string, string[]> = {
        "Cardinal Place, London": ["https://www.atvictorialondon.com/en/plan-your-visit/centre-map", "https://www.atvictorialondon.com/en/stores"],
        "Nova Victoria, London": ["https://www.atvictorialondon.com/en/plan-your-visit/centre-map", "https://www.atvictorialondon.com/en/stores"],
        "Westfield London, Shepherds Bush": ["https://uk.westfield.com/london/info/centre-map", "https://uk.westfield.com/london/stores"],
        "Westfield Stratford City": ["https://uk.westfield.com/stratfordcity/info/centre-map", "https://uk.westfield.com/stratfordcity/stores"],
        "Brent Cross Shopping Centre": ["https://www.brentcross.co.uk/stores"],
        "Canary Wharf Shopping": ["https://canarywharf.com/shops-restaurants/"],
        "One New Change, London": ["https://www.onenewchange.com/stores"],
      };

      const result = await cached(key, async () => {
        const prompt = `List every tenant at the "${name}" shopping centre${address ? ` (${address})` : ""} in London. For each tenant give: name, unit number if known, category (retail/food/service), and floor level. Prefer the centre's own plan-your-visit or store-directory page. Return strict JSON like:
{"centre":"${name}","tenants":[{"name":"","unit":"","category":"","floor":""}]}
If you cannot find a tenant list, return {"centre":"${name}","tenants":[]}. Return ONLY the JSON.`;

        // Primary: ScraperAPI to fetch the centre's own website, then pass
        // the HTML to Claude to parse tenants out. This is dramatically
        // more reliable than Perplexity/web_search because it hits the
        // authoritative source directly.
        const scraperKey = process.env.SCRAPERAPI_KEY;
        const urls = CENTRE_URLS[name];
        const anthropicKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
        if (scraperKey && urls && urls.length > 0 && anthropicKey) {
          for (const url of urls) {
            try {
              const proxied = `https://api.scraperapi.com/?api_key=${encodeURIComponent(scraperKey)}&url=${encodeURIComponent(url)}&country_code=uk&render=true`;
              const r = await fetch(proxied, { signal: AbortSignal.timeout(60000) });
              if (!r.ok) continue;
              const html = await r.text();
              // Strip scripts / styles / excessive whitespace to keep the
              // Claude prompt small.
              const cleanText = html
                .replace(/<script[\s\S]*?<\/script>/gi, "")
                .replace(/<style[\s\S]*?<\/style>/gi, "")
                .replace(/<!--[\s\S]*?-->/g, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .slice(0, 40000);
              const Anthropic = (await import("@anthropic-ai/sdk")).default;
              const client = new Anthropic({ apiKey: anthropicKey });
              const resp = await client.messages.create({
                model: "claude-haiku-4-5-20251001",
                max_tokens: 4096,
                system: "Extract the full tenant directory from the supplied shopping centre webpage text. Return ONLY JSON matching: {\"centre\":\"<name>\",\"tenants\":[{\"name\":\"\",\"unit\":\"\",\"category\":\"retail|food|service\",\"floor\":\"\"}]}. If no tenants found return {\"centre\":\"<name>\",\"tenants\":[]}.",
                messages: [{ role: "user", content: `Centre: "${name}"\nSource URL: ${url}\n\nPage text:\n${cleanText}` }],
              });
              const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
              const clean = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
              const firstBrace = clean.indexOf("{");
              const lastBrace = clean.lastIndexOf("}");
              if (firstBrace >= 0 && lastBrace > firstBrace) {
                const parsed = JSON.parse(clean.slice(firstBrace, lastBrace + 1));
                if (parsed.tenants?.length > 0) return { ...parsed, source: `scraperapi:${url}` };
              }
            } catch (err: any) {
              console.warn(`[map/centre-directory] ScraperAPI+Claude failed for ${url}:`, err?.message);
            }
          }
        }

        // Primary: Anthropic web_search server tool (no extra API key needed
        // beyond the one already configured for ChatBGP). Fallback:
        // Perplexity if configured. Empty result if neither works.
        const parseJsonFromText = (raw: string) => {
          const clean = (raw || "").replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
          const firstBrace = clean.indexOf("{");
          const lastBrace = clean.lastIndexOf("}");
          if (firstBrace < 0 || lastBrace <= firstBrace) return null;
          try { return JSON.parse(clean.slice(firstBrace, lastBrace + 1)); } catch { return null; }
        };

        if (anthropicKey) {
          try {
            const Anthropic = (await import("@anthropic-ai/sdk")).default;
            const client = new Anthropic({
              apiKey: anthropicKey,
              ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
                ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL } : {}),
            });
            const resp = await client.messages.create({
              model: "claude-sonnet-4-6",
              max_tokens: 4096,
              tools: [{ type: "web_search_20250305" as any, name: "web_search", max_uses: 4 } as any],
              messages: [{ role: "user", content: prompt }],
            });
            const textBlocks = (resp.content || []).filter((b: any) => b.type === "text");
            const fullText = textBlocks.map((b: any) => b.text).join("\n");
            const parsed = parseJsonFromText(fullText);
            if (parsed) return { ...parsed, source: "claude-web-search" };
          } catch (err: any) {
            console.warn(`[map/centre-directory] Claude web search failed for "${name}":`, err?.message);
          }
        }

        // Perplexity fallback
        if (process.env.PERPLEXITY_API_KEY || process.env.PERPLEXITY_API || process.env["PERPLEXITY API"] || process.env.PERPLEXITY) {
          try {
            const { askPerplexity } = await import("./perplexity");
            const resp = await askPerplexity(prompt, { maxTokens: 2048 });
            const parsed = parseJsonFromText(resp.answer || "");
            if (parsed) return { ...parsed, citations: resp.citations || [], source: "perplexity" };
          } catch (err: any) {
            console.warn(`[map/centre-directory] Perplexity failed for "${name}":`, err?.message);
          }
        }

        return { centre: name, tenants: [], source: "none", error: "no web search provider configured" };
      }, 24 * 30);
      res.json(result);
    } catch (err: any) {
      console.error("[map/centre-directory] error:", err?.message);
      res.status(500).json({ error: err?.message || "Centre directory lookup failed" });
    }
  });

  // Client-scoped pins (UX #21): a client map shows ONLY their own portfolio
  // properties (landlord_id or explicit crm_company_properties link) — never
  // the whole BGP book, which stays behind the staff-only /api/map/pins.
  app.get("/api/client/map/pins", requireAuth, async (req: Request, res: Response) => {
    try {
      const { resolveCompanyScope } = await import("./company-scope");
      const scope = await resolveCompanyScope(req);
      if (!scope) return res.status(403).json({ message: "Client accounts only" });
      const q = await pool.query(
        `SELECT id, name, address, postcode, status, asset_class,
                latitude AS lat, longitude AS lng
           FROM crm_properties
          WHERE (landlord_id = $1
             OR id IN (SELECT property_id FROM crm_company_properties WHERE company_id = $1))
            AND latitude IS NOT NULL AND longitude IS NOT NULL
          ORDER BY name`,
        [scope]
      );
      res.json({
        deals: [],
        comps: [],
        properties: q.rows.map((r: any) => ({
          id: r.id,
          type: "property",
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lng),
          label: r.name,
          status: r.status,
          assetClass: r.asset_class,
          addressLabel: addrFromJsonb(r.address) || r.postcode || r.name,
          propertyId: r.id,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Failed to load pins" });
    }
  });

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

      // ── 4. Pathway runs ────────────────────────────────────────────────────
      // Active investigations — pin every pathway run that has a linked
      // property (or a known address via cached geocode). Lets the user
      // see all in-flight work on the map.
      // r.tenant was removed when property_pathway_runs lost its tenant
      // column — pulling it back was throwing "column r.tenant does not
      // exist" and 500'ing the whole map. Tenant info is no longer
      // surfaced on pathway pins; if it needs to come back, source it
      // via crm_properties.tenant_name or the linked tenancy spine.
      const pathwayRes = await pool.query(`
        SELECT
          r.id, r.address, r.postcode, r.property_id,
          r.updated_at,
          r.stage_results,
          p.latitude  AS p_lat,
          p.longitude AS p_lng
        FROM property_pathway_runs r
        LEFT JOIN crm_properties p ON p.id = r.property_id
        ORDER BY r.updated_at DESC
        LIMIT 500
      `);

      const pathway: any[] = [];
      const pathwayNeedGeocode: string[] = [];
      for (const r of pathwayRes.rows) {
        let lat: number | null = null;
        let lng: number | null = null;
        if (r.p_lat && r.p_lng) {
          lat = parseFloat(r.p_lat); lng = parseFloat(r.p_lng);
        } else if (r.address) {
          const geo = await getCachedGeocode(`${r.address} ${r.postcode || ""}, UK`);
          if (geo) { lat = geo.lat; lng = geo.lng; }
          else pathwayNeedGeocode.push(`${r.address} ${r.postcode || ""}, UK`);
        }
        if (lat !== null && lng !== null && isFinite(lat) && isFinite(lng)) {
          // Highest-numbered stage with a result is "current stage"
          let currentStage = 0;
          const sr = r.stage_results || {};
          for (let i = 1; i <= 9; i++) if (sr[`stage${i}`]) currentStage = i;
          pathway.push({
            id: r.id,
            type: "pathway",
            lat, lng,
            label: r.address,
            postcode: r.postcode,
            currentStage,
            propertyId: r.property_id,
            updatedAt: r.updated_at,
          });
        }
      }
      backgroundGeocode(pathwayNeedGeocode.slice(0, 50));

      res.json({ deals, comps, leaseEvents, pathway });
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
      // description (SHOP/RESTAURANT/etc), and rateable value. Filtered to
      // postcodes in the visible bbox via reverse-geocode of the centre.
      // Addresses geocoded on-demand from the intel cache only; misses
      // background-filled so next visit is more complete.
      let voaLabels: any[] = [];
      const voaNeedGeocode: string[] = [];
      try {
        // Reverse-geocode bbox centre → postcode district for prefix filtering
        const centreLat = (s + n) / 2;
        const centreLng = (w + e) / 2;
        const rgCacheKey = `rgpc:${centreLat.toFixed(3)},${centreLng.toFixed(3)}`;
        const postcodeDistrict = await cached(rgCacheKey, async () => {
          if (!GOOGLE_API_KEY) return null;
          const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${centreLat},${centreLng}&key=${GOOGLE_API_KEY}&result_type=postal_code`;
          const r = await fetch(url);
          if (!r.ok) return null;
          const d = await r.json() as any;
          const pc = d.results?.[0]?.address_components?.find((c: any) => c.types?.includes("postal_code"))?.long_name;
          if (!pc) return null;
          // Extract outward code (everything before the last 3 chars) then sector
          const clean = pc.replace(/\s+/g, "").toUpperCase();
          return clean.slice(0, -3); // e.g. "SW1Y"
        }, 24 * 30);

        if (postcodeDistrict) {
          // Query all VOA rows in this postcode outward code
          const voaQ = await pool.query(`
            SELECT uarn, firm_name, number_or_name, street, town, postcode, description_text, rateable_value
            FROM voa_ratings
            WHERE REPLACE(UPPER(postcode), ' ', '') LIKE $1
              AND (firm_name IS NOT NULL OR description_text IS NOT NULL)
            LIMIT 3000
          `, [`${postcodeDistrict}%`]);

          for (const r of voaQ.rows) {
            const addressText = [r.number_or_name, r.street, r.town, r.postcode].filter(Boolean).join(", ");
            if (!addressText) continue;
            const geoKey = geocodeKey(addressText);
            const hit = await getCachedOnly<{ lat: number; lng: number }>(geoKey);
            if (hit && Number.isFinite(hit.lat) && Number.isFinite(hit.lng)) {
              if (hit.lat >= s && hit.lat <= n && hit.lng >= w && hit.lng <= e) {
                voaLabels.push({
                  lat: hit.lat,
                  lng: hit.lng,
                  label: (r.firm_name && r.firm_name.trim()) || r.description_text || "Commercial",
                  source: "voa" as const,
                  rateableValue: r.rateable_value,
                  descriptionText: r.description_text,
                  uarn: r.uarn,
                  address: addressText,
                });
              }
            } else {
              voaNeedGeocode.push(addressText);
            }
          }
        }
      } catch (err: any) {
        console.warn("[map-layers/labels] VOA lookup error:", err?.message);
      }
      // Background-geocode misses — higher cap since VOA is the big coverage win
      backgroundGeocode(voaNeedGeocode.slice(0, 100));

      // 4. Google Places — current trading names. Cached aggressively per
      // ~110m grid square so a typical map pan reuses the same Places call.
      const cellSize = 0.001;          // ~110m
      const sCell = Math.floor(s / cellSize) * cellSize;
      const wCell = Math.floor(w / cellSize) * cellSize;
      const nCell = Math.ceil(n / cellSize) * cellSize;
      const eCell = Math.ceil(e / cellSize) * cellSize;
      const placesLabels: any[] = [];

      // Cost guard: each cell fires a paid Places Nearby Search and nothing
      // bounded the grid, so a city-scale bbox meant tens of thousands of
      // calls per map load. Only run the grid at street zoom (~<=120 cells).
      const placesCellCount =
        Math.max(0, Math.round((nCell - sCell) / cellSize)) *
        Math.max(0, Math.round((eCell - wCell) / cellSize));
      const MAX_PLACES_CELLS = 120;

      if (GOOGLE_API_KEY && placesCellCount <= MAX_PLACES_CELLS) {
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

  // ─── Land Registry title boundaries — always-on red-line layer ───────────
  // Returns freehold + leasehold title polygons for the postcode district
  // containing the bbox centre. These are the "red lines" Goad users expect
  // to see on every plan. PropertyData /freeholds returns a polygons field
  // (GeoJSON MultiPolygon) for each title. Cached 30 days per postcode.
  app.get("/api/map/title-boundaries", requireAuth, async (req: Request, res: Response) => {
    try {
      const bbox = String(req.query.bbox || "").trim();
      if (!bbox) return res.status(400).json({ error: "bbox required" });
      const [s, w, n, e] = bbox.split(",").map(parseFloat);
      if (![s, w, n, e].every(Number.isFinite)) return res.status(400).json({ error: "invalid bbox" });

      const PD_KEY = process.env.PROPERTYDATA_API_KEY;
      if (!PD_KEY) return res.json({ freeholds: [], leaseholds: [], postcode: null });

      // Reverse-geocode bbox centre to postcode
      const centreLat = (s + n) / 2;
      const centreLng = (w + e) / 2;
      const rgKey = `rgfull:${centreLat.toFixed(3)},${centreLng.toFixed(3)}`;
      const postcode = await cached(rgKey, async () => {
        if (!GOOGLE_API_KEY) return null;
        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${centreLat},${centreLng}&key=${GOOGLE_API_KEY}&result_type=postal_code`;
        const r = await fetch(url);
        if (!r.ok) return null;
        const d = await r.json() as any;
        const pc = d.results?.[0]?.address_components?.find((c: any) => c.types?.includes("postal_code"))?.long_name;
        return pc ? pc.replace(/\s+/g, "").toUpperCase() : null;
      }, 24 * 30);

      if (!postcode) return res.json({ freeholds: [], leaseholds: [], postcode: null });

      // Fetch freeholds for this postcode — cached 30 days. PropertyData has
      // no /leaseholds?postcode endpoint (returns X01 "Invalid API endpoint"),
      // and per-UPRN lookups across a whole bbox would be far too expensive
      // for a map view. Map shows freehold polygons only.
      const freeholds = await cached(`pd-fh:${postcode}`, async () => {
        const url = `https://api.propertydata.co.uk/freeholds?key=${PD_KEY}&postcode=${encodeURIComponent(postcode)}`;
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) return null;
        return await r.json();
      }, 24 * 30);
      const leaseholds = null;

      const extract = (payload: any): any[] => {
        const rows = payload?.data || payload?.freeholds?.data || payload?.leaseholds?.data || [];
        return (Array.isArray(rows) ? rows : [])
          .filter((r: any) => r.polygons || r.polygon || r.geometry)
          .map((r: any) => ({
            titleNumber: r.title_number || r.title,
            proprietor: r.proprietor_name_1 || null,
            proprietorCategory: r.proprietor_category || null,
            pricePaid: r.price_paid || null,
            dateOfPurchase: r.date_proprietor_added || null,
            property: r.property || null,
            polygons: r.polygons || r.polygon || r.geometry,
          }));
      };

      res.json({
        postcode,
        freeholds: extract(freeholds),
        leaseholds: extract(leaseholds),
      });
    } catch (err: any) {
      console.error("[map-layers/title-boundaries] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── Occupier plan — Goad/Edozo unit polygons with names ─────────────────
  // Serves goad_units (from Edozo or an Experian import) as GeoJSON for the
  // viewport. Names live on the polygons, so this replaces the OSM/NGD name-
  // guessing entirely for any area we have coverage for. If the viewport is
  // uncovered and Edozo is configured, we pull it live, cache to goad_units,
  // then serve — so coverage warms as users pan.
  app.get("/api/map/occupier-plan", requireAuth, async (req: Request, res: Response) => {
    try {
      const bbox = String(req.query.bbox || "").trim();
      if (!bbox) return res.status(400).json({ error: "bbox required" });
      const [s, w, n, e] = bbox.split(",").map(parseFloat);
      if (![s, w, n, e].every(Number.isFinite)) return res.status(400).json({ error: "invalid bbox" });
      const box = { south: s, west: w, north: n, east: e };

      const { queryGoadUnitsByBbox, countGoadUnitsInBbox, upsertGoadUnits } = await import("./goad-units");
      const { fetchEdozoOccupiers, isEdozoConfigured } = await import("./edozo-occupiers");

      let count = await countGoadUnitsInBbox(box);
      let source = "cache";
      // Refresh from Edozo when the viewport looks uncovered. Guard on a small
      // area so we never fan a huge bbox out to the WFS.
      const areaOk = n - s < 0.02 && e - w < 0.03;
      if (count < 5 && areaOk && isEdozoConfigured()) {
        const { units, total } = await fetchEdozoOccupiers(box);
        if (units.length) {
          await upsertGoadUnits(units);
          count = await countGoadUnitsInBbox(box);
          source = `edozo:${total}`;
        }
      }

      const units = await queryGoadUnitsByBbox(box);
      const features = units.map((u) => ({
        type: "Feature" as const,
        geometry: u.geometry,
        properties: {
          toid: u.toid,
          name: u.occupierName,
          classification: u.classification,
          category: u.categoryGroup,
          streetNum: u.streetNum,
          labelRotation: u.labelRotation,
          source: u.source,
        },
      }));
      res.json({ type: "FeatureCollection", features, meta: { count, source } });
    } catch (err: any) {
      console.error("[map-layers/occupier-plan] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── Retail units for the map's Retail Context layer, from goad_units ─────
  // Serves the harvested/imported occupier units (all licensed areas) in the
  // exact GeoJSON shape the client's Retail Context renderer expects, so the
  // one good layer covers everywhere instead of the old static West-End file.
  // MultiPolygons are flattened to their largest outer ring (the renderer and
  // its label code assume geometry.coordinates[0] is a single ring).
  app.get("/api/map/retail-units", requireAuth, async (req: Request, res: Response) => {
    try {
      const bbox = String(req.query.bbox || "").trim();
      if (!bbox) return res.status(400).json({ type: "FeatureCollection", features: [] });
      const [s, w, n, e] = bbox.split(",").map(parseFloat);
      if (![s, w, n, e].every(Number.isFinite)) return res.status(400).json({ error: "invalid bbox" });

      const { queryGoadUnitsByBbox } = await import("./goad-units");
      const units = await queryGoadUnitsByBbox({ south: s, west: w, north: n, east: e });

      const ringArea = (ring: number[][]): number => {
        // Shoelace in m² using an equirectangular approximation at the ring's latitude.
        if (!ring || ring.length < 3) return 0;
        const latAvg = ring.reduce((a, c) => a + c[1], 0) / ring.length;
        const mPerLng = 111320 * Math.cos((latAvg * Math.PI) / 180);
        const mPerLat = 111320;
        let area = 0;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          area += (ring[j][0] * mPerLng) * (ring[i][1] * mPerLat) - (ring[i][0] * mPerLng) * (ring[j][1] * mPerLat);
        }
        return Math.abs(area / 2);
      };
      const largestOuterRing = (geom: any): number[][] | null => {
        if (!geom) return null;
        if (geom.type === "Polygon") return geom.coordinates?.[0] || null;
        if (geom.type === "MultiPolygon") {
          let best: number[][] | null = null, bestA = -1;
          for (const poly of geom.coordinates || []) {
            const r = poly?.[0];
            if (!r) continue;
            const a = ringArea(r);
            if (a > bestA) { bestA = a; best = r; }
          }
          return best;
        }
        return null;
      };

      const features: any[] = [];
      for (const u of units) {
        const ring = largestOuterRing(u.geometry);
        if (!ring || ring.length < 3) continue;
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
        const name = u.occupierName || "";
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [ring] },
          properties: {
            Fascia: name,
            FasciaMas: name,
            Activity: name,
            PrimaryAc: name,
            Category: u.categoryGroup || "other",
            _group: u.categoryGroup || "other",
            StreetNum: u.streetNum || "",
            Area_ft2: Math.round(ringArea(ring) * 10.7639),
            Subclass: "Retailgf",
            Centroid_X: (minLng + maxLng) / 2,
            Centroid_Y: (minLat + maxLat) / 2,
            GoadNumber: u.toid || "",
            _classification: u.classification || "",
            _source: u.source,
          },
        });
      }
      res.setHeader("Cache-Control", "private, max-age=300");
      res.json({ type: "FeatureCollection", features });
    } catch (err: any) {
      console.error("[map-layers/retail-units] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── Admin: bulk-load occupier units into goad_units ─────────────────────
  // One-off ingest for a harvested/imported occupier snapshot. Gated by a
  // shared secret (ADMIN_LOAD_SECRET) rather than a user session so it can be
  // driven server-to-server. Accepts raw harvest records and maps them to the
  // normalised goad_units shape. Idempotent (upsert on external_key).
  app.post("/api/admin/load-goad-units", async (req: Request, res: Response) => {
    try {
      const secret = process.env.ADMIN_LOAD_SECRET;
      if (!secret || req.get("x-admin-secret") !== secret) return res.status(403).json({ error: "forbidden" });
      const records: any[] = Array.isArray(req.body?.units) ? req.body.units : [];
      if (records.length === 0) return res.json({ upserted: 0 });

      const { upsertGoadUnits, normaliseCategory, bboxOfGeometry } = await import("./goad-units");
      const units = records
        .filter((r) => r?.geometry)
        .map((r) => {
          const bb = bboxOfGeometry(r.geometry);
          const key = r.toid
            ? `edozo:GF:${r.toid}`
            : `edozo:GF:${bb ? `${bb.centroidLat.toFixed(6)},${bb.centroidLng.toFixed(6)}` : Math.random()}`;
          return {
            externalKey: key,
            source: "edozo" as const,
            toid: r.toid ?? null,
            floorLevel: "GF",
            occupierName: r.occupierName ?? null,
            classification: r.classification ?? null,
            category: r.category ?? null,
            categoryGroup: normaliseCategory({ occupierName: r.occupierName, rawCategory: r.category, classification: r.classification }),
            geometry: r.geometry,
            labelRotation: typeof r.labelRotation === "number" ? r.labelRotation : null,
            rawProps: r.uprn ? { uprn: r.uprn, geofence: r.geofence } : (r.geofence ? { geofence: r.geofence } : null),
          };
        });
      const upserted = await upsertGoadUnits(units);
      res.json({ upserted, received: records.length });
    } catch (err: any) {
      console.error("[map-layers/load-goad-units] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  console.log("[map-layers] routes registered");
}
