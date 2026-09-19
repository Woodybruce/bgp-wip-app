/**
 * PropertyData market-tone adapters.
 *
 * PropertyData doesn't expose individual commercial lease/sale transactions,
 * so these endpoints return *aggregate* tone figures (avg quoting rent /sqft,
 * avg sold price /sqft, sample size) rather than per-deal comps. We surface
 * them as a market-tone card alongside our internal CRM letting comps.
 *
 * Endpoints used:
 *   GET /rents-commercial?type={retail|offices|industrial|restaurants|pubs}
 *   GET /valuation-commercial-rent?type=...
 *   GET /valuation-commercial-sale?type=...
 *   GET /rents                (residential asking rents)
 *   GET /sold-prices-per-sqf  (residential sold £/sqft)
 *
 * All endpoints accept postcode (full / district / sector). We normalise the
 * postcode to the narrowest form that actually returns data — some districts
 * have too few samples at the full-postcode level (N1 8DQ), so we fall back
 * to sector (N1 8) then district (N1) automatically.
 */

const PROPERTY_DATA_BASE = "https://api.propertydata.co.uk";

export type CommercialType = "retail" | "offices" | "industrial" | "restaurants" | "pubs";

export interface CommercialRentsTone {
  type: CommercialType;
  postcodeUsed: string;          // the postcode scope that actually returned data
  pointsAnalysed?: number;
  unitType?: "GIA" | "NIA" | string;
  avgQuotingRentPerSqft?: number;
  avgQuotingRent?: number;
  avgSize?: number;
  sourceUrl: string;             // PropertyData page for the human to cross-check
}

export interface CommercialValuationTone {
  type: CommercialType;
  postcodeUsed: string;
  rentEstimate?: { low?: number; mid?: number; high?: number; perSqft?: number };
  saleEstimate?: { low?: number; mid?: number; high?: number; perSqft?: number };
}

export interface ResidentialRentsTone {
  postcodeUsed: string;
  pointsAnalysed?: number;
  avgRent?: number;                // £/month
  avgRentPerSqft?: number;         // £/sqft/year
  avgSize?: number;
}

export interface ResidentialSoldTone {
  postcodeUsed: string;
  pointsAnalysed?: number;
  avgPricePerSqft?: number;
  avgPrice?: number;
  avgSize?: number;
}

/**
 * Only the full postcode is used. District-level (e.g. W1F) and even
 * sector-level (e.g. W1F8) averages mix wildly different micro-markets
 * (Mayfair vs Soho vs Marylebone all sit inside W1) so the resulting
 * "tone" misleads more than it informs. If PropertyData has no data at
 * the precise postcode, we'd rather show nothing.
 */
function widenPostcode(raw: string): string[] {
  const pc = (raw || "").toUpperCase().replace(/\s+/g, "");
  if (!pc) return [];
  const m = pc.match(/^([A-Z]{1,2}\d[A-Z\d]?)(\d[A-Z]{2})$/);
  if (!m) return [pc];
  return [`${m[1]} ${m[2]}`];
}

async function pdFetch(endpoint: string, params: Record<string, string>): Promise<any | null> {
  const apiKey = process.env.PROPERTYDATA_API_KEY;
  if (!apiKey) return null;
  const qs = new URLSearchParams({ key: apiKey, ...params });
  const url = `${PROPERTY_DATA_BASE}/${endpoint}?${qs}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.warn(`[propertydata-market] ${endpoint} HTTP ${res.status} for ${params.postcode || ""}`);
      return null;
    }
    return await res.json();
  } catch (err: any) {
    console.warn(`[propertydata-market] ${endpoint} fetch failed: ${err?.message}`);
    return null;
  }
}

function isEmptyShape(d: any): boolean {
  if (!d) return true;
  if (d.status === "error") return true;
  // PropertyData returns 200 with {message: "No data"} or empty data blocks
  if (d.message && /no\s*data|insufficient/i.test(String(d.message))) return true;
  if (d.data && Object.keys(d.data).length === 0) return true;
  return false;
}

export async function fetchCommercialRentsTone(
  rawPostcode: string,
  type: CommercialType,
): Promise<CommercialRentsTone | null> {
  const variants = widenPostcode(rawPostcode);
  for (const pc of variants) {
    const json = await pdFetch("rents-commercial", { postcode: pc, type });
    if (isEmptyShape(json)) continue;
    // Response fields documented: points_analysed, unit_type,
    // avg_quoting_rent_per_sqft, avg_size, avg_quoting_rent
    const d = json.data || json;
    if (d.points_analysed == null && d.avg_quoting_rent_per_sqft == null) continue;
    return {
      type,
      postcodeUsed: pc,
      pointsAnalysed: toNum(d.points_analysed),
      unitType: d.unit_type,
      avgQuotingRentPerSqft: toNum(d.avg_quoting_rent_per_sqft),
      avgQuotingRent: toNum(d.avg_quoting_rent),
      avgSize: toNum(d.avg_size),
      sourceUrl: `https://propertydata.co.uk/rents-commercial?postcode=${encodeURIComponent(pc)}&type=${type}`,
    };
  }
  return null;
}

export async function fetchCommercialValuationTone(
  rawPostcode: string,
  type: CommercialType,
): Promise<CommercialValuationTone | null> {
  const variants = widenPostcode(rawPostcode);
  for (const pc of variants) {
    const [rentJson, saleJson] = await Promise.all([
      pdFetch("valuation-commercial-rent", { postcode: pc, type }),
      pdFetch("valuation-commercial-sale", { postcode: pc, type }),
    ]);
    const hasRent = !isEmptyShape(rentJson) && (rentJson.data || rentJson);
    const hasSale = !isEmptyShape(saleJson) && (saleJson.data || saleJson);
    if (!hasRent && !hasSale) continue;
    const r = (rentJson?.data || rentJson || {}) as any;
    const s = (saleJson?.data || saleJson || {}) as any;
    return {
      type,
      postcodeUsed: pc,
      rentEstimate: hasRent
        ? {
            low: toNum(r.low ?? r.rent_low),
            mid: toNum(r.mid ?? r.rent_mid ?? r.estimate),
            high: toNum(r.high ?? r.rent_high),
            perSqft: toNum(r.per_sqft ?? r.rent_per_sqft),
          }
        : undefined,
      saleEstimate: hasSale
        ? {
            low: toNum(s.low ?? s.sale_low),
            mid: toNum(s.mid ?? s.sale_mid ?? s.estimate),
            high: toNum(s.high ?? s.sale_high),
            perSqft: toNum(s.per_sqft ?? s.sale_per_sqft),
          }
        : undefined,
    };
  }
  return null;
}

export async function fetchResidentialRentsTone(rawPostcode: string): Promise<ResidentialRentsTone | null> {
  const variants = widenPostcode(rawPostcode);
  for (const pc of variants) {
    const json = await pdFetch("rents", { postcode: pc });
    if (isEmptyShape(json)) continue;
    const d = json.data || json;
    if (d.points_analysed == null && d.average == null && d["70pc"] == null) continue;
    return {
      postcodeUsed: pc,
      pointsAnalysed: toNum(d.points_analysed),
      avgRent: toNum(d.average ?? d.avg_rent),
      avgRentPerSqft: toNum(d.average_per_sqft ?? d.avg_rent_per_sqft),
      avgSize: toNum(d.average_size),
    };
  }
  return null;
}

export async function fetchResidentialSoldTone(rawPostcode: string): Promise<ResidentialSoldTone | null> {
  const variants = widenPostcode(rawPostcode);
  for (const pc of variants) {
    const json = await pdFetch("sold-prices-per-sqf", { postcode: pc });
    if (isEmptyShape(json)) continue;
    const d = json.data || json;
    if (d.points_analysed == null && d.average == null) continue;
    return {
      postcodeUsed: pc,
      pointsAnalysed: toNum(d.points_analysed),
      avgPricePerSqft: toNum(d.average ?? d.avg_price_per_sqft),
      avgPrice: toNum(d.average_price),
      avgSize: toNum(d.average_size),
    };
  }
  return null;
}

function toNum(v: any): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export interface PropertyDataMarketTone {
  commercial: {
    retail?: CommercialRentsTone | null;
    offices?: CommercialRentsTone | null;
    restaurants?: CommercialRentsTone | null;
    retailValuation?: CommercialValuationTone | null;
    officesValuation?: CommercialValuationTone | null;
  };
  residential: {
    rents?: ResidentialRentsTone | null;
    sold?: ResidentialSoldTone | null;
  };
  generatedAt: string;
}

/**
 * Convenience batch — pulls the full market-tone set in parallel. Returns
 * `null` if PROPERTYDATA_API_KEY isn't configured (caller should skip the
 * card entirely). Individual sub-calls failing just leave those fields
 * undefined — the card still renders for the parts that worked.
 */
export async function fetchPropertyDataMarketTone(postcode: string): Promise<PropertyDataMarketTone | null> {
  if (!process.env.PROPERTYDATA_API_KEY) return null;
  if (!postcode) return null;
  const [retail, offices, restaurants, retailVal, officesVal, resiRents, resiSold] = await Promise.all([
    fetchCommercialRentsTone(postcode, "retail"),
    fetchCommercialRentsTone(postcode, "offices"),
    fetchCommercialRentsTone(postcode, "restaurants"),
    fetchCommercialValuationTone(postcode, "retail"),
    fetchCommercialValuationTone(postcode, "offices"),
    fetchResidentialRentsTone(postcode),
    fetchResidentialSoldTone(postcode),
  ]);
  return {
    commercial: {
      retail,
      offices,
      restaurants,
      retailValuation: retailVal,
      officesValuation: officesVal,
    },
    residential: {
      rents: resiRents,
      sold: resiSold,
    },
    generatedAt: new Date().toISOString(),
  };
}
