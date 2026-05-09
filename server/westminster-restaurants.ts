/**
 * Westminster Restaurants — BD prospecting page.
 *
 * Pulls FHRS-registered restaurant + takeaway premises in the City of
 * Westminster from the FSA's free API, cross-references each with
 * crm_properties (via postcode-first then address fuzzy match), and
 * surfaces the gap — restaurants we don't yet track — as prospects.
 *
 * Click a row to resolve it through the Property Resolver and add a
 * canonical CRM property for it. The same approach generalises to any
 * borough — Westminster is the v1 demo.
 *
 * Data source: https://api.ratings.food.gov.uk/help (no auth required).
 *   - Local authority ID for City of Westminster: 197
 *   - Business types we treat as "restaurants":
 *       1 = Restaurant/Cafe/Canteen
 *       7846 = Takeaway/sandwich shop
 *       7843 = Pub/bar/nightclub (kept as adjacent — many do food)
 */

import type { Express, Request, Response } from "express";
import { requireAuth } from "./auth";
import { db } from "./db";
import { crmProperties, brandStores, crmCompanies } from "@shared/schema";
import { sql } from "drizzle-orm";

// London local authority IDs on the FSA API — the commercial boroughs
// BGP works in. Westminster (197) is the default.
const LONDON_BOROUGHS: Array<{ id: number; name: string }> = [
  { id: 197, name: "City of Westminster" },
  { id: 195, name: "City of London" },
  { id: 188, name: "Camden" },
  { id: 192, name: "Hackney" },
  { id: 194, name: "Kensington & Chelsea" },
  { id: 191, name: "Islington" },
  { id: 196, name: "Tower Hamlets" },
  { id: 189, name: "Hammersmith & Fulham" },
  { id: 198, name: "Wandsworth" },
  { id: 200, name: "Lambeth" },
  { id: 199, name: "Southwark" },
];
const DEFAULT_LA_ID = 197;
// FHRS business types we care about
const RESTAURANT_TYPES = new Set([1, 7846, 7843]);

interface FhrsEstablishment {
  FHRSID: number;
  BusinessName: string;
  BusinessType: string;
  BusinessTypeID: number;
  AddressLine1?: string;
  AddressLine2?: string;
  AddressLine3?: string;
  AddressLine4?: string;
  PostCode?: string;
  RatingValue?: string;
  RatingDate?: string;
  RatingKey?: string;
  Geocode?: { longitude: string; latitude: string };
  RightToReply?: string;
  scores?: { Hygiene?: number; Structural?: number; ConfidenceInManagement?: number };
}

interface RestaurantRow {
  fhrsid: number;
  name: string;
  address: string;
  postcode: string | null;
  businessType: string;
  fhrsRating: string | null;
  fhrsRatingDate: string | null;
  hygieneScore: number | null;
  lat: number | null;
  lng: number | null;
  // CRM cross-ref — multiple sources, any of which means this restaurant
  // is already known to BGP and shouldn't be flagged as a fresh prospect
  crmPropertyId: string | null;
  crmPropertyName: string | null;
  brandStoreId: string | null;             // brand_stores match (e.g. Pret has many stores)
  brandCompanyId: string | null;           // crm_companies brand row (covenant exists)
  brandCompanyName: string | null;
  inCrm: boolean;                          // true if any of the three above match
}

// Cache per local-authority-id so switching boroughs doesn't trash the cache
const fhrsCache = new Map<number, { rows: RestaurantRow[]; expires: number }>();
const FHRS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchFhrsForBorough(laId: number): Promise<FhrsEstablishment[]> {
  // FSA API caps each request at 5000 results — most London boroughs have
  // 3000-5000 food establishments so one page is enough. Filter to
  // restaurant types server-side after fetch.
  const url = `https://api.ratings.food.gov.uk/Establishments?localAuthorityId=${laId}&pageSize=5000`;
  const resp = await fetch(url, {
    headers: { "x-api-version": "2", Accept: "application/json" },
  });
  if (!resp.ok) {
    throw new Error(`FSA FHRS error ${resp.status}`);
  }
  const data = await resp.json();
  const all = (data?.establishments || []) as FhrsEstablishment[];
  return all.filter((e) => RESTAURANT_TYPES.has(e.BusinessTypeID));
}

function joinAddress(e: FhrsEstablishment): string {
  return [e.AddressLine1, e.AddressLine2, e.AddressLine3, e.AddressLine4]
    .filter((v) => v && v.trim())
    .join(", ");
}

async function resolveCrmCrossRef(rows: RestaurantRow[]): Promise<RestaurantRow[]> {
  // Three sources to cross-reference, all in one pass:
  //   1. crm_properties — the canonical building (resolver-anchored)
  //   2. brand_stores — known operator stores (Pret, Itsu, Soho House etc.)
  //      where a brand is already in our intelligence
  //   3. crm_companies — the brand entity itself (covenant data)
  // Any match → the restaurant is "known to BGP" and shouldn't appear as
  // a fresh prospect.
  const postcodes = Array.from(
    new Set(rows.map((r) => (r.postcode || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean)),
  );
  if (postcodes.length === 0) return rows;

  // 1. CRM properties by postcode
  const props = await db
    .select({
      id: crmProperties.id,
      name: crmProperties.name,
      address: crmProperties.address,
      postcode: crmProperties.postcode,
    })
    .from(crmProperties)
    .where(sql`UPPER(REPLACE(COALESCE(${crmProperties.postcode}, ''), ' ', '')) = ANY(${postcodes})`);

  // 2. brand_stores by postcode (extracted from the address tail)
  const stores = await db
    .select({
      id: brandStores.id,
      name: brandStores.name,
      brandCompanyId: brandStores.brandCompanyId,
      address: brandStores.address,
    })
    .from(brandStores)
    .where(sql`UPPER(REPLACE(COALESCE(SPLIT_PART(${brandStores.address}, ',', -1), ''), ' ', '')) = ANY(${postcodes})`);

  // 3. crm_companies — pull all companies once, match by name. Cheap-ish
  //    given it's a one-time per-page scan, and brand names are short.
  const lowerNames = Array.from(new Set(rows.map((r) => r.name.toLowerCase().trim()).filter(Boolean)));
  const companies = lowerNames.length > 0
    ? await db
        .select({ id: crmCompanies.id, name: crmCompanies.name })
        .from(crmCompanies)
        .where(sql`LOWER(${crmCompanies.name}) = ANY(${lowerNames}) OR LOWER(${crmCompanies.name}) LIKE ANY(${lowerNames.map((n) => `%${n}%`)})`)
        .limit(500)
        .catch(() => [])
    : [];

  // Index lookups
  const propByPostcode = new Map<string, Array<{ id: string; name: string; address: any }>>();
  for (const p of props) {
    const pc = (p.postcode || "").replace(/\s+/g, "").toUpperCase();
    if (!pc) continue;
    if (!propByPostcode.has(pc)) propByPostcode.set(pc, []);
    propByPostcode.get(pc)!.push({ id: p.id, name: p.name, address: p.address });
  }
  const storeByPostcode = new Map<string, Array<{ id: string; name: string; brandCompanyId: string; address: string | null }>>();
  for (const s of stores) {
    const pcMatch = (s.address || "").match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?\s*\d[A-Z]{2})\b/i);
    const pc = pcMatch?.[1]?.replace(/\s+/g, "").toUpperCase() || "";
    if (!pc) continue;
    if (!storeByPostcode.has(pc)) storeByPostcode.set(pc, []);
    storeByPostcode.get(pc)!.push({ id: s.id, name: s.name, brandCompanyId: s.brandCompanyId, address: s.address });
  }
  const companyByName = new Map<string, { id: string; name: string }>();
  for (const c of companies) {
    companyByName.set(c.name.toLowerCase(), c);
  }

  return rows.map((r) => {
    const pc = (r.postcode || "").replace(/\s+/g, "").toUpperCase();
    const lowName = r.name.toLowerCase().trim();
    let crmPropertyId: string | null = null;
    let crmPropertyName: string | null = null;
    let brandStoreId: string | null = null;
    let brandCompanyId: string | null = null;
    let brandCompanyName: string | null = null;

    // 1. CRM property match
    const propCandidates = propByPostcode.get(pc) || [];
    let propMatch = propCandidates.find((c) => c.name.toLowerCase() === lowName)
      || propCandidates.find((c) => c.name.toLowerCase().includes(lowName) || lowName.includes(c.name.toLowerCase()));
    if (!propMatch) {
      const addrLow = r.address.toLowerCase();
      propMatch = propCandidates.find((c) => {
        const propAddr = typeof c.address === "string"
          ? c.address.toLowerCase()
          : (c.address?.formatted || c.address?.line1 || "").toLowerCase();
        return propAddr && (addrLow.includes(propAddr) || propAddr.includes(addrLow.split(",")[0] || ""));
      });
    }
    if (propMatch) {
      crmPropertyId = propMatch.id;
      crmPropertyName = propMatch.name;
    }

    // 2. brand_stores match — same postcode
    const storeCandidates = storeByPostcode.get(pc) || [];
    const storeMatch = storeCandidates.find((s) => {
      const sn = s.name.toLowerCase();
      return sn === lowName || sn.includes(lowName) || lowName.includes(sn);
    });
    if (storeMatch) {
      brandStoreId = storeMatch.id;
      brandCompanyId = storeMatch.brandCompanyId;
    }

    // 3. crm_companies match — by name (the brand entity)
    const companyMatch = companyByName.get(lowName)
      || Array.from(companyByName.values()).find((c) => {
        const cn = c.name.toLowerCase();
        return cn.includes(lowName) || lowName.includes(cn);
      });
    if (companyMatch && !brandCompanyId) {
      brandCompanyId = companyMatch.id;
      brandCompanyName = companyMatch.name;
    } else if (brandCompanyId && !brandCompanyName) {
      // Look up the company name from the brand_store match
      const co = Array.from(companyByName.values()).find((c) => c.id === brandCompanyId);
      brandCompanyName = co?.name || null;
    }

    const inCrm = !!(crmPropertyId || brandStoreId || brandCompanyId);
    return {
      ...r,
      crmPropertyId,
      crmPropertyName,
      brandStoreId,
      brandCompanyId,
      brandCompanyName,
      inCrm,
    };
  });
}

function pickLaId(req: Request): number {
  const raw = req.query.laId ?? req.query.localAuthorityId;
  if (typeof raw === "string") {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_LA_ID;
}

export function registerWestminsterRestaurantsRoutes(app: Express): void {
  /** List the boroughs the page can switch between. */
  app.get("/api/westminster/boroughs", requireAuth, (_req: Request, res: Response) => {
    return res.json(LONDON_BOROUGHS);
  });

  app.get("/api/westminster/restaurants", requireAuth, async (req: Request, res: Response) => {
    try {
      const laId = pickLaId(req);
      const force = req.query.refresh === "1";
      const cached = fhrsCache.get(laId);
      if (!force && cached && cached.expires > Date.now()) {
        return res.json({ rows: cached.rows, cached: true, fetchedAt: cached.expires - FHRS_TTL_MS, laId });
      }
      const establishments = await fetchFhrsForBorough(laId);
      const rows: RestaurantRow[] = establishments.map((e) => ({
        fhrsid: e.FHRSID,
        name: e.BusinessName,
        address: joinAddress(e),
        postcode: e.PostCode || null,
        businessType: e.BusinessType,
        fhrsRating: e.RatingValue || null,
        fhrsRatingDate: e.RatingDate || null,
        hygieneScore: e.scores?.Hygiene ?? null,
        lat: e.Geocode?.latitude ? Number(e.Geocode.latitude) : null,
        lng: e.Geocode?.longitude ? Number(e.Geocode.longitude) : null,
        crmPropertyId: null,
        crmPropertyName: null,
        inCrm: false,
      }));
      const enriched = await resolveCrmCrossRef(rows);
      fhrsCache.set(laId, { rows: enriched, expires: Date.now() + FHRS_TTL_MS });
      return res.json({ rows: enriched, cached: false, fetchedAt: Date.now(), laId });
    } catch (err: any) {
      console.error("[westminster-restaurants] error:", err);
      return res.status(500).json({ error: err?.message || "fetch failed" });
    }
  });

  app.get("/api/westminster/restaurants/stats", requireAuth, async (req: Request, res: Response) => {
    try {
      const laId = pickLaId(req);
      const cached = fhrsCache.get(laId);
      if (!cached || cached.expires < Date.now()) {
        return res.json({ ready: false });
      }
      const rows = cached.rows;
      const total = rows.length;
      const inCrm = rows.filter((r) => r.inCrm).length;
      const prospects = total - inCrm;
      const ratings: Record<string, number> = {};
      for (const r of rows) {
        const key = r.fhrsRating || "Unknown";
        ratings[key] = (ratings[key] || 0) + 1;
      }
      return res.json({
        ready: true,
        total,
        inCrm,
        prospects,
        ratings,
        fetchedAt: cached.expires - FHRS_TTL_MS,
        laId,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "stats failed" });
    }
  });
}
