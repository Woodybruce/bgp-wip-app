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
import { crmProperties } from "@shared/schema";
import { sql } from "drizzle-orm";

// City of Westminster local authority id on the FSA API
const WESTMINSTER_LA_ID = 197;
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
  // CRM cross-ref
  crmPropertyId: string | null;
  crmPropertyName: string | null;
  inCrm: boolean;
}

let fhrsCache: { rows: RestaurantRow[]; expires: number } | null = null;
const FHRS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

async function fetchFhrsWestminster(): Promise<FhrsEstablishment[]> {
  // FSA API caps each request at 5000 results — Westminster has ~3500
  // food establishments so one page is enough. Filter to restaurant types
  // server-side after fetch (the API filter is per-businessTypeId only).
  const url = `https://api.ratings.food.gov.uk/Establishments?localAuthorityId=${WESTMINSTER_LA_ID}&pageSize=5000`;
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
  // Pull every property in the postcodes we touch — single query rather
  // than one-per-row. Westminster postcodes start with W1, SW1, WC1, WC2,
  // NW1 — we'll just match by exact postcode.
  const postcodes = Array.from(
    new Set(rows.map((r) => (r.postcode || "").replace(/\s+/g, "").toUpperCase()).filter(Boolean)),
  );
  if (postcodes.length === 0) return rows;

  const props = await db
    .select({
      id: crmProperties.id,
      name: crmProperties.name,
      address: crmProperties.address,
      postcode: crmProperties.postcode,
    })
    .from(crmProperties)
    .where(sql`UPPER(REPLACE(COALESCE(${crmProperties.postcode}, ''), ' ', '')) = ANY(${postcodes})`);

  // Group by postcode for quick lookup
  const byPostcode = new Map<string, Array<{ id: string; name: string; address: any }>>();
  for (const p of props) {
    const pc = (p.postcode || "").replace(/\s+/g, "").toUpperCase();
    if (!pc) continue;
    if (!byPostcode.has(pc)) byPostcode.set(pc, []);
    byPostcode.get(pc)!.push({ id: p.id, name: p.name, address: p.address });
  }

  return rows.map((r) => {
    const pc = (r.postcode || "").replace(/\s+/g, "").toUpperCase();
    const candidates = byPostcode.get(pc) || [];
    if (candidates.length === 0) return r;
    // Try a name match first — restaurant names tend to be distinctive
    const lowName = r.name.toLowerCase();
    let match = candidates.find((c) => c.name.toLowerCase() === lowName);
    if (!match) {
      // Try substring match (BGP CRM names often include parent + brand)
      match = candidates.find((c) => {
        const cn = c.name.toLowerCase();
        return cn.includes(lowName) || lowName.includes(cn);
      });
    }
    if (!match) {
      // Fall back to street-line match
      const addrLow = r.address.toLowerCase();
      match = candidates.find((c) => {
        const propAddr = typeof c.address === "string"
          ? c.address.toLowerCase()
          : (c.address?.formatted || c.address?.line1 || "").toLowerCase();
        return propAddr && (addrLow.includes(propAddr) || propAddr.includes(addrLow.split(",")[0] || ""));
      });
    }
    if (match) {
      return { ...r, crmPropertyId: match.id, crmPropertyName: match.name, inCrm: true };
    }
    return r;
  });
}

export function registerWestminsterRestaurantsRoutes(app: Express): void {
  app.get("/api/westminster/restaurants", requireAuth, async (req: Request, res: Response) => {
    try {
      const force = req.query.refresh === "1";
      if (!force && fhrsCache && fhrsCache.expires > Date.now()) {
        return res.json({ rows: fhrsCache.rows, cached: true, fetchedAt: fhrsCache.expires - FHRS_TTL_MS });
      }
      const establishments = await fetchFhrsWestminster();
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
      fhrsCache = { rows: enriched, expires: Date.now() + FHRS_TTL_MS };
      return res.json({ rows: enriched, cached: false, fetchedAt: Date.now() });
    } catch (err: any) {
      console.error("[westminster-restaurants] error:", err);
      return res.status(500).json({ error: err?.message || "fetch failed" });
    }
  });

  app.get("/api/westminster/restaurants/stats", requireAuth, async (_req: Request, res: Response) => {
    try {
      if (!fhrsCache || fhrsCache.expires < Date.now()) {
        return res.json({ ready: false });
      }
      const rows = fhrsCache.rows;
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
        fetchedAt: fhrsCache.expires - FHRS_TTL_MS,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err?.message || "stats failed" });
    }
  });
}
