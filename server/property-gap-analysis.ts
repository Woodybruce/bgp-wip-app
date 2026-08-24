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
import { isClientCrmCategory } from "../shared/tenant-categories";

const router = Router();

// ── Hospitality sector taxonomy ──────────────────────────────────────────
// The gap analysis speaks Landsec's language: hospitality / F&B / wellness /
// cafés / leisure only — "they didn't want to see normal retail" (Woody,
// 2026-08-04). Sectors power the missing-sector board ("no Mexican, no fine
// dining"). Heuristic keyword classification gives instant answers; a
// background Haiku sweep writes the definitive label to
// crm_companies.fnb_sector so it hardens over time.
const FNB_SECTORS: Array<{ key: string; label: string; rx: RegExp }> = [
  { key: "mexican", label: "Mexican", rx: /mexic|taco\b|burrito|tortilla|wahaca|chipotle|cantina/i },
  { key: "fine_dining", label: "Fine dining", rx: /fine dining|hawksmoor|the ivy|ivy asia|gaucho|sexy fish|zuma\b|roka\b|sushisamba|caprice|michelin/i },
  { key: "steak_grill", label: "Steak & grill", rx: /steak|flat iron|blacklock|miller & carter|grill house/i },
  { key: "burgers", label: "Burgers", rx: /burger|five guys|shake shack|byron\b|smashburger/i },
  { key: "chicken", label: "Chicken", rx: /chicken|nando|wingstop|popeyes|kfc\b|chick\b/i },
  { key: "pizza_italian", label: "Pizza & Italian", rx: /pizza|italian|zizzi|prezzo|franco manca|vapiano|pasta|carluccio/i },
  { key: "asian", label: "Asian & sushi", rx: /sushi|japan|ramen|wagamama|itsu\b|noodle|thai\b|viet|pho\b|korean|chinese|dim sum|bao\b|poke\b|katsu|asian/i },
  { key: "indian", label: "Indian", rx: /indian|curry|dishoom|mowgli|bundobust|tandoor/i },
  { key: "middle_eastern", label: "Mediterranean & Middle Eastern", rx: /greek|lebanese|turkish|shawarma|kebab|comptoir|falafel|mediterran/i },
  { key: "bakery_dessert", label: "Bakery & dessert", rx: /bakery|bake\b|doughnut|donut|cookie|dessert|gelato|ice cream|creams\b|cinnabon|wenzel|gail'?s|patisserie|crepe|waffle|pretzel/i },
  { key: "coffee_cafe", label: "Coffee & café", rx: /coffee|caf[eé]|costa\b|starbucks|nero\b|espresso|roastery/i },
  { key: "grab_go", label: "Grab & go", rx: /grab|sandwich|greggs|pret\b|leon\b|subway|salad|deli\b|wrap\b|juice|smoothie/i },
  { key: "pubs_bars", label: "Pubs & bars", rx: /\bpub\b|\bbar\b|tavern|brewdog|\binn\b|brewery|cocktail|taproom/i },
  { key: "competitive_social", label: "Competitive socialising", rx: /golf|darts|bowling|escape room|karaoke|boom battle|puttshack|flight club|arcade|gravity|trampoline|climb|activity centre|social gaming/i },
  { key: "gyms_fitness", label: "Gyms & fitness", rx: /\bgym\b|fitness|pilates|yoga|cycle\b|barry'?s|f45|1rebel|puregym|nuffield/i },
  { key: "wellness_beauty", label: "Wellness & beauty", rx: /\bspa\b|wellness|beauty|nail|barber|hair salon|salon\b|massage|therapy/i },
  // NB: no bare "leisure" — every hospitality brand's industry string says
  // "Leisure & Hospitality", which mis-bucketed restaurants here.
  { key: "leisure_entertainment", label: "Leisure & entertainment", rx: /cinema|entertainment|bingo|casino|soft play/i },
  { key: "casual_dining", label: "Casual dining", rx: /restaurant|dining|kitchen\b|eatery|bistro|brasserie|food hall/i },
];
const SECTOR_LABELS: Record<string, string> = Object.fromEntries(FNB_SECTORS.map(s => [s.key, s.label]));

function heuristicSector(name: string, industry: string | null, companyType: string | null): string | null {
  const hay = `${name} ${industry || ""} ${companyType || ""}`;
  for (const s of FNB_SECTORS) if (s.rx.test(hay)) return s.key;
  return null;
}

// Definitive sector label written by the Haiku sweep; commentary cache on
// the property row. Boot-DDL, same pattern as brand_signals.ai_relevant.
let gapColumnsEnsured = false;
async function ensureGapColumns() {
  if (gapColumnsEnsured) return;
  await pool.query(`ALTER TABLE crm_companies ADD COLUMN IF NOT EXISTS fnb_sector TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_commentary TEXT`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_commentary_at TIMESTAMPTZ`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_live_intel JSONB`).catch(() => {});
  await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_live_intel_at TIMESTAMPTZ`).catch(() => {});
  gapColumnsEnsured = true;
}

// Background sector classification — one batch per sweep, in-process
// cooldown so a busy property page doesn't stampede Haiku.
let lastSectorSweepAt = 0;
async function sweepSectorClassification() {
  if (Date.now() - lastSectorSweepAt < 30 * 60 * 1000) return;
  lastSectorSweepAt = Date.now();
  try {
    const { rows } = await pool.query(
      `SELECT id, name, industry, company_type, description FROM crm_companies
        WHERE fnb_sector IS NULL AND merged_into_id IS NULL AND company_type ILIKE 'tenant%'
        LIMIT 50`
    );
    const candidates = rows.filter((r: any) => isClientCrmCategory(r.company_type));
    if (!candidates.length) return;
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const keys = FNB_SECTORS.map(s => s.key).join(", ");
    const list = candidates.map((r: any) => `${r.id} | ${r.name} | ${r.industry || ""} | ${(r.description || "").slice(0, 120)}`).join("\n");
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2000,
      messages: [{ role: "user", content: `Classify each UK hospitality/leisure brand into exactly one sector key from: ${keys}.\n\nBrands (id | name | industry | description):\n${list}\n\nReply with one line per brand: id|sector_key. Nothing else.` }],
    });
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    const valid = new Set(FNB_SECTORS.map(s => s.key));
    for (const line of text.split("\n")) {
      const [id, key] = line.split("|").map(s => s?.trim());
      if (id && key && valid.has(key) && candidates.some((c: any) => c.id === id)) {
        await pool.query(`UPDATE crm_companies SET fnb_sector = $1 WHERE id = $2`, [key, id]).catch(() => {});
      }
    }
    console.log(`[gap-sectors] classified batch of ${candidates.length}`);
  } catch (e: any) {
    console.warn("[gap-sectors] sweep failed:", e?.message);
  }
}

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

    await ensureGapColumns();
    // Fire-and-forget: harden heuristic sector labels with Haiku over time.
    sweepSectorClassification();

    // Pull all brand stores with geocoded locations. brand_stores is
    // created lazily by brand-profile when that module loads — if it
    // hasn't yet on this prod instance, degrade to "no stores yet"
    // rather than 500'ing the panel.
    const stores: any[] = await pool.query(
      `SELECT s.brand_company_id, s.name AS store_name, s.address, s.lat, s.lng, s.status,
              c.name AS brand_name, c.domain, c.rollout_status, c.company_type,
              c.store_count, c.brand_group_id, c.industry, c.fnb_sector
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
      total_stores: number;
      nearest_distance_km: number;
      nearest_store: { name: string; address: string | null; lat: number; lng: number };
      brand_group_id: string | null;
      peer_scheme_set: Set<string>;
      sector: string | null;
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
          total_stores: 1,
          nearest_distance_km: dist,
          nearest_store: { name: s.store_name, address: s.address, lat: s.lat, lng: s.lng },
          brand_group_id: s.brand_group_id,
          peer_scheme_set: new Set<string>(),
          sector: (s.fnb_sector as string | null) || heuristicSector(s.brand_name, s.industry, s.company_type),
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
    // The whole board speaks hospitality/F&B/wellness/café/leisure only —
    // "they didn't want to see normal retail; hide those, work in the
    // background" (Woody, 2026-08-04). Retail stays in brand_stores for
    // other consumers; it just never renders here.
    const hospitality = allBrands.filter(b => isClientCrmCategory(b.company_type));

    // The tenancy schedule is the on-scheme truth — store geocodes cluster
    // outside the 500m centroid ring on big out-of-town schemes, which had
    // "Chicken — missing" showing on a centre with Nando's in occupation.
    // A tenancy FK or tenant-name prefix match beats the geocode.
    const occ = await pool.query(
      `SELECT DISTINCT tenant_company_id::text AS id,
              lower(replace(coalesce(tenant_name, ''), '''', '')) AS name
         FROM leasing_schedule_units
        WHERE property_id = $1 AND (tenant_company_id IS NOT NULL OR tenant_name IS NOT NULL)`,
      [propertyId]
    ).then(r => r.rows).catch(() => [] as any[]);
    const occIds = new Set(occ.map((r: any) => r.id).filter(Boolean));
    const occNames = occ.map((r: any) => r.name).filter(Boolean);
    for (const b of hospitality) {
      if (b.nearest_distance_km <= onSchemeRadiusKm) continue;
      const bn = b.brand_name.toLowerCase().replace(/'/g, "");
      const inOccupation = occIds.has(String(b.brand_company_id))
        || occNames.some((n: string) => n === bn || n.startsWith(bn + " "));
      if (inOccupation) b.nearest_distance_km = 0.01;
    }

    const onScheme = hospitality
      .filter(b => b.nearest_distance_km <= onSchemeRadiusKm)
      .sort((a, b) => a.nearest_distance_km - b.nearest_distance_km);

    const wider = hospitality
      .filter(b => b.nearest_distance_km > onSchemeRadiusKm && b.nearest_distance_km <= widerRadiusKm)
      .sort((a, b) => a.nearest_distance_km - b.nearest_distance_km);

    // Gap: peer brands with >= 3 stores but nearest is > widerRadiusKm from subject.
    // These are brands that have chosen similar UK locations but not this one.
    const gap = hospitality
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
    const peerGaps = hospitality
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

    // ── Competing centres — the peer schemes within striking distance
    //    (Bluewater → Lakeside). Presence there but not here is the
    //    sharpest pitch evidence Landsec asked for (Woody, 2026-08-04).
    const competingCentres = peerSchemes
      .map(ps => ({ name: ps.name, distance_km: Number(haversineKm(location.lat, location.lng, ps.lat, ps.lng).toFixed(1)) }))
      .filter(ps => ps.distance_km <= 60)
      .sort((a, b) => a.distance_km - b.distance_km)
      .slice(0, 4);
    const competingNames = new Set(competingCentres.map(c => c.name));
    const competitorGaps = hospitality
      .filter(b => b.nearest_distance_km > onSchemeRadiusKm && Array.from(b.peer_scheme_set).some(n => competingNames.has(n)))
      .map(b => ({
        ...b,
        peer_schemes: Array.from(b.peer_scheme_set).sort(),
        competing_at: Array.from(b.peer_scheme_set).filter(n => competingNames.has(n)).sort(),
        has_live_requirement: reqCompanyIds.has(String(b.brand_company_id)),
      }))
      .sort((a, b) => (b.has_live_requirement ? 1 : 0) - (a.has_live_requirement ? 1 : 0) || b.peer_scheme_set.size - a.peer_scheme_set.size)
      .slice(0, limit);

    // ── Local market — trading in the surrounding town/city (0.5–5km)
    //    but not on scheme: the in-town operators a scheme could poach.
    const localMarket = hospitality
      .filter(b => b.nearest_distance_km > onSchemeRadiusKm && b.nearest_distance_km <= 5)
      .map(b => ({ ...b, peer_schemes: Array.from(b.peer_scheme_set).sort(), has_live_requirement: reqCompanyIds.has(String(b.brand_company_id)) }))
      .sort((a, b) => a.nearest_distance_km - b.nearest_distance_km)
      .slice(0, limit);

    // ── Sector coverage — which hospitality sectors the scheme has vs the
    //    peer set, surfacing whole missing cuisines ("no Mexican, no fine
    //    dining" — Landsec, 2026-08-04).
    const sectors = FNB_SECTORS.map(def => {
      const inSector = hospitality.filter(b => b.sector === def.key);
      const here = inSector.filter(b => b.nearest_distance_km <= onSchemeRadiusKm);
      const atCompeting = inSector.filter(b => Array.from(b.peer_scheme_set).some(n => competingNames.has(n)));
      const atPeers = inSector.filter(b => b.peer_scheme_set.size > 0);
      const examples = inSector
        .filter(b => b.nearest_distance_km > onSchemeRadiusKm && b.peer_scheme_set.size > 0)
        .sort((a, b) => b.peer_scheme_set.size - a.peer_scheme_set.size)
        .slice(0, 4)
        .map(b => ({ id: b.brand_company_id, name: b.brand_name, peers: b.peer_scheme_set.size, live_req: reqCompanyIds.has(String(b.brand_company_id)) }));
      return {
        key: def.key,
        label: def.label,
        on_scheme: here.length,
        on_scheme_names: here.slice(0, 6).map(b => b.brand_name),
        at_competing: atCompeting.length,
        at_peers: atPeers.length,
        examples,
        missing: here.length === 0 && atPeers.length >= 2,
      };
    }).filter(s => s.on_scheme > 0 || s.at_peers > 0);
    const missingSectors = sectors.filter(s => s.missing).sort((a, b) => b.at_peers - a.at_peers);

    // Clients get the gap analysis focused on THEIR brand slice (hospitality/
    // leisure/fitness + self-adds — the standing Landsec decision), not the
    // full brand universe (Woody, 2026-08-03).
    let sliceFilter: ((id: string) => boolean) | null = null;
    if (gapScope) {
      const { clientBrandSliceSql, isClientRequestUser } = await import("./company-scope");
      if (await isClientRequestUser(req as any)) {
        const candidateIds = [...new Set([...onScheme, ...wider, ...gap, ...peerGaps, ...competitorGaps, ...localMarket].map(b => String(b.brand_company_id)))];
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

    // Cached Perplexity expansion intel (the live-intel route below) rides
    // along keyed by lowercased brand name so every lens can badge
    // "actively expanding" without a second round-trip.
    const intelRow = await pool.query(
      `SELECT gap_live_intel, gap_live_intel_at FROM crm_properties WHERE id = $1`, [propertyId]
    ).then(r => r.rows[0]).catch(() => null);
    const liveIntel = intelRow?.gap_live_intel?.brands
      ? {
          byBrand: Object.fromEntries(
            (intelRow.gap_live_intel.brands as any[]).map((b: any) => [String(b.name || "").toLowerCase(), b])
          ),
          generatedAt: intelRow.gap_live_intel_at,
        }
      : null;

    // Sets don't survive JSON — strip the working field from every bucket.
    const publish = (b: any) => {
      const { peer_scheme_set, ...rest } = b;
      return { ...rest, nearest_distance_km: Number(b.nearest_distance_km.toFixed(2)) };
    };
    res.json({
      liveIntel,
      property: { id: propertyId, name: location.name, postcode: location.postcode, lat: location.lat, lng: location.lng },
      onScheme: sliced(onScheme).map(publish),
      wider: sliced(wider).map(publish),
      gap: sliced(gap).map(publish),
      peerGaps: sliced(peerGaps).map(publish),
      competingCentres,
      competitorGaps: sliced(competitorGaps).map(publish),
      localMarket: sliced(localMarket).map(publish),
      sectors,
      missingSectors,
      sectorLabels: SECTOR_LABELS,
      peerSchemesConsidered: peerSchemes.length,
      matchingRequirements: slicedReqs,
      categorySignature,
      radii: { onScheme: onSchemeRadiusKm, wider: widerRadiusKm, peerPresence: PEER_PRESENCE_KM },
      stats: {
        totalBrands: allBrands.length,
        hospitalityBrands: hospitality.length,
        brandsWithStores: stores.length,
      },
    });
  } catch (err: any) {
    console.error("[brand-gaps]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── AI gap read — cached commentary over the whole picture (Woody,
//    2026-08-04: "more AI commentary to consider"). GET returns the cache;
//    ?refresh=1 regenerates. Clients may read AND refresh on their own
//    properties (parity rule); the prompt carries no BGP fees.
router.get("/api/property/:propertyId/brand-gaps/commentary", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureGapColumns();
    const propertyId = String(req.params.propertyId);
    const { resolveCompanyScope, isPropertyInScope, isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req as any)) {
      const scope = await resolveCompanyScope(req as any);
      if (!scope || !(await isPropertyInScope(scope, propertyId))) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const force = req.query.refresh === "1";
    const cached = await pool.query(
      `SELECT name, gap_commentary, gap_commentary_at, gap_live_intel FROM crm_properties WHERE id = $1`, [propertyId]
    );
    if (!cached.rows[0]) return res.status(404).json({ error: "Property not found" });
    const row = cached.rows[0];
    const ageMs = row.gap_commentary_at ? Date.now() - new Date(row.gap_commentary_at).getTime() : null;
    if (row.gap_commentary && !force && ageMs !== null && ageMs < 7 * 24 * 60 * 60 * 1000) {
      return res.json({ text: row.gap_commentary, generatedAt: row.gap_commentary_at, cached: true });
    }

    // Re-hit our own gap route with the requester's auth so the commentary
    // is generated from exactly what they see (same pattern as
    // bgp-commentary/regenerate).
    const baseUrl = `http://127.0.0.1:${process.env.PORT || "5000"}`;
    const cookie = (req.headers?.cookie as string) || "";
    const auth = (req.headers?.authorization as string) || "";
    const gapsRes = await fetch(`${baseUrl}/api/property/${propertyId}/brand-gaps`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: auth } : {}) },
    });
    if (!gapsRes.ok) {
      if (row.gap_commentary) return res.json({ text: row.gap_commentary, generatedAt: row.gap_commentary_at, cached: true });
      return res.status(gapsRes.status).json({ error: "Couldn't load gap analysis" });
    }
    const g: any = await gapsRes.json();

    const fmtList = (arr: any[], n = 8) => arr.slice(0, n).map((b: any) =>
      `${b.brand_name}${b.has_live_requirement ? " (LIVE REQUIREMENT)" : ""}${b.competing_at?.length ? ` — at ${b.competing_at.join(", ")}` : b.peer_schemes?.length ? ` — at ${b.peer_schemes.slice(0, 3).join(", ")}` : ""}`
    ).join("\n") || "(none)";
    const sectorLines = (g.sectors || []).map((s: any) =>
      `${s.label}: ${s.on_scheme} on scheme${s.on_scheme ? ` (${s.on_scheme_names.slice(0, 3).join(", ")})` : ""}, at ${s.at_peers} peer schemes${s.missing ? " — MISSING HERE" : ""}${s.examples?.length ? ` [targets: ${s.examples.map((e: any) => e.name).join(", ")}]` : ""}`
    ).join("\n");

    const prompt = `You are a BGP leasing analyst writing the hospitality & leisure gap read for ${row.name}, for the asset owner (Landsec-grade client). British English, no hype, no fees. Data:

Competing centres nearby: ${(g.competingCentres || []).map((c: any) => `${c.name} (${c.distance_km}km)`).join(", ") || "none within range"}

Brands at competing centres but NOT here:
${fmtList(g.competitorGaps || [])}

Brands trading in the local market (within 5km) but not on scheme:
${fmtList(g.localMarket || [], 6)}

Strongest national peer-scheme gaps:
${fmtList(g.peerGaps || [], 6)}

Sector coverage (hospitality/F&B/wellness/leisure):
${sectorLines}

Live brand requirements matching an available unit: ${(g.matchingRequirements || []).map((r: any) => r.company_name || r.name).filter(Boolean).slice(0, 10).join(", ") || "none"}
${(() => {
  // Cached Perplexity expansion sweep (live-intel route) — fold confirmed
  // expanders into the read so "actionable now" reflects live market intent,
  // not just CRM state.
  const li = row.gap_live_intel;
  if (!li?.brands?.length) return "";
  const expanding = (li.brands as any[]).filter((b: any) => b.expanding).slice(0, 10);
  if (!expanding.length) return "";
  return `\nLive web intel — brands with cited evidence of ACTIVE EXPANSION in the last year:\n${expanding.map((b: any) => `${b.name}: ${b.note}`).join("\n")}\n`;
})()}
Write FOUR SHORT paragraphs separated by blank lines, each opening with a bold lead-in exactly like: **Competitive gaps.** / **Missing sectors.** / **Actionable now.** / **Mix strategy.** — covering (1) the sharpest competitive gaps, naming brands and which competing centre they trade at; (2) whole sectors missing versus the peer set with the obvious target brands; (3) what's actionable NOW because a live requirement fits an available unit; (4) one forward-looking line on mix strategy. Keep each paragraph to 1-3 sentences; bold key brand names with **double asterisks**. No headings beyond the lead-ins, no lists, no preamble.`;

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let msg;
    try {
      msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (aiErr: any) {
      if (row.gap_commentary) return res.json({ text: row.gap_commentary, generatedAt: row.gap_commentary_at, cached: true });
      if (/api ?key|authentication|authToken/i.test(aiErr?.message || "")) {
        return res.status(503).json({ error: "AI commentary unavailable — AI service is not configured" });
      }
      return res.status(502).json({ error: "Couldn't generate commentary" });
    }
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    if (!text) {
      if (row.gap_commentary) return res.json({ text: row.gap_commentary, generatedAt: row.gap_commentary_at, cached: true });
      return res.status(502).json({ error: "Empty commentary" });
    }
    await pool.query(
      `UPDATE crm_properties SET gap_commentary = $1, gap_commentary_at = NOW() WHERE id = $2`,
      [text, propertyId]
    ).catch(() => {});
    res.json({ text, generatedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    console.error("[gap-commentary]", err?.message);
    res.status(500).json({ error: err?.message || "failed" });
  }
});

// ── International watchlist — for larger schemes: overseas concepts not
//    yet (or barely) in the UK, by hospitality/leisure sector (Woody,
//    2026-08-04: "international gap analysis — AREA15 for leisure as an
//    example"). AI-researched, cached, clearly labelled as research.
router.get("/api/property/:propertyId/brand-gaps/international", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureGapColumns();
    await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_intl JSONB`).catch(() => {});
    await pool.query(`ALTER TABLE crm_properties ADD COLUMN IF NOT EXISTS gap_intl_at TIMESTAMPTZ`).catch(() => {});
    const propertyId = String(req.params.propertyId);
    const { resolveCompanyScope, isPropertyInScope, isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req as any)) {
      const scope = await resolveCompanyScope(req as any);
      if (!scope || !(await isPropertyInScope(scope, propertyId))) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const force = req.query.refresh === "1";
    const { rows } = await pool.query(`SELECT name, gap_intl, gap_intl_at FROM crm_properties WHERE id = $1`, [propertyId]);
    if (!rows[0]) return res.status(404).json({ error: "Property not found" });
    const row = rows[0];
    const ageMs = row.gap_intl_at ? Date.now() - new Date(row.gap_intl_at).getTime() : null;
    if (row.gap_intl && !force && ageMs !== null && ageMs < 30 * 24 * 60 * 60 * 1000) {
      return res.json({ items: row.gap_intl, generatedAt: row.gap_intl_at, cached: true });
    }

    const prompt = `You are a BGP international retail & leisure analyst. For ${row.name}, a major UK shopping destination, list 10 INTERNATIONAL hospitality/F&B/leisure/experiential concepts that are NOT yet established in the UK (or have at most 1-2 UK sites) and would suit a top-four UK shopping centre. Think AREA15/Meow Wolf-style experiential leisure, international F&B groups expanding into Europe, competitive-socialising formats, wellness concepts. As of your knowledge, be factual about where they currently trade; do not invent brands.

Reply as strict JSON array only: [{"name": "...", "sector": "...", "origin": "...", "trades_in": "...", "uk_status": "none|entering|1-2 sites", "why": "one sentence on the fit"}]`;

    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let msg;
    try {
      msg = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1400,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (aiErr: any) {
      if (row.gap_intl) return res.json({ items: row.gap_intl, generatedAt: row.gap_intl_at, cached: true });
      if (/api ?key|authentication|authToken/i.test(aiErr?.message || "")) {
        return res.status(503).json({ error: "International watchlist unavailable — AI service is not configured" });
      }
      return res.status(502).json({ error: "Couldn't generate watchlist" });
    }
    const text = msg.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("").trim();
    let items: any[] = [];
    try { items = JSON.parse(text.replace(/^```(json)?/m, "").replace(/```$/m, "").trim()); } catch {}
    if (!Array.isArray(items) || !items.length) {
      if (row.gap_intl) return res.json({ items: row.gap_intl, generatedAt: row.gap_intl_at, cached: true });
      return res.status(502).json({ error: "No watchlist generated" });
    }
    await pool.query(`UPDATE crm_properties SET gap_intl = $1, gap_intl_at = NOW() WHERE id = $2`, [JSON.stringify(items), propertyId]).catch(() => {});
    res.json({ items, generatedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    console.error("[gap-international]", err?.message);
    res.status(500).json({ error: err?.message || "failed" });
  }
});

// ── Live expansion intel — Perplexity layer over the gap board (Woody,
//    2026-08-15). The DB lenses say WHERE brands already trade; this asks
//    the live web whether the top gap candidates are actively taking sites
//    right now — openings, announced pipeline, stated requirements, rollout
//    funding — with citations. Cached a week on the property; ?refresh=1
//    re-sweeps. Degrades to house copy when no Perplexity key is set.
router.get("/api/property/:propertyId/brand-gaps/live-intel", requireAuth, async (req: Request, res: Response) => {
  try {
    await ensureGapColumns();
    const propertyId = String(req.params.propertyId);
    const { resolveCompanyScope, isPropertyInScope, isClientRequestUser } = await import("./company-scope");
    if (await isClientRequestUser(req as any)) {
      const scope = await resolveCompanyScope(req as any);
      if (!scope || !(await isPropertyInScope(scope, propertyId))) {
        return res.status(403).json({ error: "Access denied" });
      }
    }
    const force = req.query.refresh === "1";
    const { rows } = await pool.query(
      `SELECT name, postcode, gap_live_intel, gap_live_intel_at FROM crm_properties WHERE id = $1`, [propertyId]
    );
    if (!rows[0]) return res.status(404).json({ error: "Property not found" });
    const row = rows[0];
    const serveCache = () =>
      res.json({ ...row.gap_live_intel, generatedAt: row.gap_live_intel_at, cached: true });
    const ageMs = row.gap_live_intel_at ? Date.now() - new Date(row.gap_live_intel_at).getTime() : null;
    if (row.gap_live_intel && !force && ageMs !== null && ageMs < 7 * 24 * 60 * 60 * 1000) {
      return serveCache();
    }

    const { isPerplexityConfigured, askPerplexity } = await import("./perplexity");
    if (!isPerplexityConfigured()) {
      if (row.gap_live_intel) return serveCache();
      return res.status(503).json({ error: "Live intel unavailable — research service is not configured" });
    }

    // Same self-fetch pattern as the commentary route: candidates come from
    // exactly what the requester sees (client slice included).
    const baseUrl = `http://127.0.0.1:${process.env.PORT || "5000"}`;
    const cookie = (req.headers?.cookie as string) || "";
    const auth = (req.headers?.authorization as string) || "";
    const gapsRes = await fetch(`${baseUrl}/api/property/${propertyId}/brand-gaps`, {
      headers: { ...(cookie ? { Cookie: cookie } : {}), ...(auth ? { Authorization: auth } : {}) },
    });
    if (!gapsRes.ok) {
      if (row.gap_live_intel) return serveCache();
      return res.status(gapsRes.status).json({ error: "Couldn't load gap analysis" });
    }
    const g: any = await gapsRes.json();
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const b of [...(g.competitorGaps || []), ...(g.peerGaps || []), ...(g.gap || []), ...(g.localMarket || [])]) {
      const name = String(b.brand_name || "").trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      candidates.push(name);
      if (candidates.length >= 15) break;
    }
    if (!candidates.length) {
      return res.json({ brands: [], market_notes: "No gap candidates to research yet.", citations: [], generatedAt: new Date().toISOString(), cached: false });
    }

    const region = [row.name, row.postcode, ...(g.competingCentres || []).map((c: any) => c.name)]
      .filter(Boolean).join(", ");
    let px;
    try {
      px = await askPerplexity(
        `These UK hospitality/F&B/leisure brands trade elsewhere but NOT at ${row.name}${row.postcode ? ` (${row.postcode})` : ""}. For EACH brand, is there evidence from roughly the last 12 months that it is ACTIVELY EXPANDING — new site openings, announced pipeline, publicly stated site requirements, or funding raised for rollout? Prefer evidence relevant to this area: ${region}. Be factual; where there is no evidence, return expanding=false with a short note. Also give 2-3 sentences of market_notes on hospitality leasing momentum relevant to schemes like this. Brands:\n${candidates.map((n, i) => `${i + 1}. ${n}`).join("\n")}`,
        {
          searchRecency: "year",
          maxTokens: 2200,
          jsonSchema: {
            name: "gap_live_intel",
            schema: {
              type: "object",
              properties: {
                brands: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      expanding: { type: "boolean" },
                      confidence: { type: "string", enum: ["high", "medium", "low"] },
                      note: { type: "string" },
                      source_url: { type: "string" },
                    },
                    required: ["name", "expanding", "note"],
                  },
                },
                market_notes: { type: "string" },
              },
              required: ["brands"],
            },
          },
        }
      );
    } catch (pxErr: any) {
      if (row.gap_live_intel) return serveCache();
      return res.status(502).json({ error: `Live intel failed: ${pxErr?.message || "research error"}` });
    }
    let parsed: any = null;
    try { parsed = JSON.parse(px.answer.replace(/^```(json)?/m, "").replace(/```$/m, "").trim()); } catch {}
    if (!Array.isArray(parsed?.brands) || !parsed.brands.length) {
      if (row.gap_live_intel) return serveCache();
      return res.status(502).json({ error: "No live intel returned" });
    }
    const payload = {
      brands: parsed.brands,
      market_notes: parsed.market_notes || "",
      citations: px.citations || [],
      model: px.model,
    };
    await pool.query(
      `UPDATE crm_properties SET gap_live_intel = $1, gap_live_intel_at = NOW() WHERE id = $2`,
      [JSON.stringify(payload), propertyId]
    ).catch(() => {});
    res.json({ ...payload, generatedAt: new Date().toISOString(), cached: false });
  } catch (err: any) {
    console.error("[gap-live-intel]", err?.message);
    res.status(500).json({ error: err?.message || "failed" });
  }
});

// ── Nightly live-intel pre-warm (Woody, 2026-08-18: "we need it automated,
//    no button"). Sweeps the Perplexity expansion intel for every property
//    whose gap board is actually in use (has a tenancy schedule or a cached
//    gap read) once the cache is >6 days old, so the panel is always
//    populated and nobody waits on the ~30s first-load research call.
//    Self-fetches the route with a short-lived internal auth token so auth,
//    slicing and caching behave exactly like a staff visit.
export async function runNightlyGapLiveIntelSweep(): Promise<{ swept: number; errors: number }> {
  const out = { swept: 0, errors: 0 };
  const { isPerplexityConfigured } = await import("./perplexity");
  if (!isPerplexityConfigured()) return out;
  await ensureGapColumns();
  const props = await pool.query(
    `SELECT p.id FROM crm_properties p
      WHERE (EXISTS (SELECT 1 FROM leasing_schedule_units l WHERE l.property_id = p.id)
             OR p.gap_commentary IS NOT NULL)
        AND (p.gap_live_intel_at IS NULL OR p.gap_live_intel_at < NOW() - INTERVAL '6 days')
      ORDER BY p.gap_live_intel_at ASC NULLS FIRST
      LIMIT 10`
  );
  if (!props.rows.length) return out;
  const staff = await pool.query(
    `SELECT id FROM users
      WHERE is_active IS NOT FALSE AND COALESCE(role, '') <> 'Client'
      ORDER BY is_admin DESC NULLS LAST LIMIT 1`
  );
  const userId = staff.rows[0]?.id;
  if (!userId) return out;
  const { randomBytes } = await import("crypto");
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO auth_tokens (token, user_id, expires_at) VALUES ($1, $2, NOW() + INTERVAL '30 minutes')`,
    [token, userId]
  );
  const baseUrl = `http://127.0.0.1:${process.env.PORT || "5000"}`;
  try {
    for (const r of props.rows) {
      try {
        const res = await fetch(`${baseUrl}/api/property/${r.id}/brand-gaps/live-intel?refresh=1`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) out.swept++; else out.errors++;
      } catch {
        out.errors++;
      }
      // Soft pacing between Perplexity sweeps, same spirit as the monthly
      // brand refresh.
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  } finally {
    await pool.query(`DELETE FROM auth_tokens WHERE token = $1`, [token]).catch(() => {});
  }
  return out;
}

export default router;
