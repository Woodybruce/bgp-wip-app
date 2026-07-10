// ─────────────────────────────────────────────────────────────────────────
// Goad tenant resolver — website-first identity chain for a clicked polygon.
//
// When the user clicks a unit on the Goad map and there's no CRM tenant
// match for the fascia, we want to help them turn the fascia into a real
// brand with verified Companies House + Experian + RocketReach contacts —
// without any guessing on the name. The website is the anchor.
//
//   Goad fascia + lat/lng
//     │
//     ▼ Google Places Nearby Search + Place Details
//   { name, website, phone, place_id, address }
//     │
//     ▼ POST /api/goad/tenant-verify   (button #1)
//   ScraperAPI fetch of website → Anthropic Haiku extracts UK entity name
//   + CH number from the footer (legally required by Companies Act 2006).
//   CH API verifies the number; returns profile (name, status, accounts).
//   No DB write. User reviews the candidate.
//     │
//     ▼ POST /api/goad/tenant-create   (button #2)
//   Create crm_companies row with companyType derived from Goad category.
//   Fire performAutoKyc (CH + Experian + Perplexity) and the RocketReach
//   property-people import. Returns the new company id.
//
// Why this is reliable: name-only CH searches return ambiguous matches
// for common names ("Pinna" → dozens of unrelated Pinnas). The website
// footer is the single most reliable bridge from a trading name to a
// CH number, because the disclosure is legally required.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { chFetch, scrapeUkEntityFromWebsite } from "./companies-house";

const router = Router();

export interface TenantPlace {
  name: string;
  website: string | null;
  phone: string | null;
  placeId: string;
  address: string | null;
  businessStatus: string | null;
}

/**
 * Find the Google Places business at a coord, then look up its website
 * via Places Details. Two API calls per lookup (~$0.04). Returns null
 * when the API key is missing or nothing's at the coord.
 *
 * Used inline by /api/goad/polygon-context so the drawer can show
 * "Website: pinnamayfair.com" without an extra round-trip.
 */
export async function findPlaceWebsiteAtCoord(
  lat: number,
  lng: number,
  fasciaHint?: string,
): Promise<TenantPlace | null> {
  const key = process.env.GOOGLE_API_KEY;
  if (!key) return null;

  // 1) Nearby search — tight radius, biased by fascia name when provided.
  // The fascia "PINNA" + coord pair should resolve to exactly one place.
  const nearbyUrl = fasciaHint
    ? `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=40&keyword=${encodeURIComponent(fasciaHint)}&key=${key}`
    : `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${lat},${lng}&radius=25&key=${key}`;

  let placeId: string | null = null;
  let name: string | null = null;
  let businessStatus: string | null = null;
  try {
    const r = await fetch(nearbyUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const j: any = await r.json();
    const best = (j.results || [])[0];
    if (!best?.place_id) return null;
    placeId = best.place_id;
    name = best.name || null;
    businessStatus = best.business_status || null;
  } catch { return null; }

  // 2) Place Details — fetch the website + phone fields. Cheap.
  const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_phone_number,formatted_address,name,business_status&key=${key}`;
  try {
    const r = await fetch(detailsUrl, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return { name: name || fasciaHint || "Unknown", website: null, phone: null, placeId: placeId!, address: null, businessStatus };
    const j: any = await r.json();
    const res = j.result || {};
    return {
      name: res.name || name || fasciaHint || "Unknown",
      website: res.website || null,
      phone: res.formatted_phone_number || null,
      placeId: placeId!,
      address: res.formatted_address || null,
      businessStatus: res.business_status || businessStatus,
    };
  } catch {
    return { name: name || fasciaHint || "Unknown", website: null, phone: null, placeId: placeId!, address: null, businessStatus };
  }
}

// ─── Goad category → BGP companyType ────────────────────────────────────
// Goad's coarse category (e.g. "RESTAURANTS", "FASHION CLOTHING") maps to
// the canonical "Tenant - X" labels from crm-options.ts. Used to pre-fill
// the brand row on create. Default to "Tenant - Other" when unknown.
function goadCategoryToCompanyType(category: string | null | undefined): string {
  if (!category) return "Tenant - Other";
  const c = category.toLowerCase();
  if (/restaurant|food.service|cafe|café/.test(c)) return "Tenant - Restaurant";
  if (/coffee|tea/.test(c)) return "Tenant - Café";
  if (/bar|pub|wine/.test(c)) return "Tenant - Bar";
  if (/fast food|quick service/.test(c)) return "Tenant - Quick Service";
  if (/bakery|patisserie/.test(c)) return "Tenant - Bakery";
  if (/fashion|clothing|apparel/.test(c)) return "Tenant - Fashion";
  if (/footwear|shoe/.test(c)) return "Tenant - Footwear";
  if (/jewell?ery|watch/.test(c)) return "Tenant - Jewellery & Watches";
  if (/luxury/.test(c)) return "Tenant - Luxury";
  if (/cosmetic|beauty|fragrance/.test(c)) return "Tenant - Beauty";
  if (/home|furniture|interior/.test(c)) return "Tenant - Homewares";
  if (/electronic/.test(c)) return "Tenant - Electronics";
  if (/gym|fitness/.test(c)) return "Tenant - Gym & Fitness";
  if (/spa|wellness|salon/.test(c)) return "Tenant - Wellness";
  if (/cinema/.test(c)) return "Tenant - Cinema";
  if (/bank|financial|insurance/.test(c)) return "Tenant - Financial Services";
  if (/grocery|supermarket/.test(c)) return "Tenant - Grocery";
  return "Tenant - Other";
}

// ─── POST /api/goad/tenant-verify ────────────────────────────────────────
// Button #1: takes the website discovered via Google Places, runs the
// existing website-footer scrape, verifies any extracted CH number against
// the live CH API, returns a structured candidate. No DB write.
router.post("/api/goad/tenant-verify", requireAuth, async (req: Request, res: Response) => {
  const website = String(req.body?.website || "").trim();
  const fascia = String(req.body?.fascia || "").trim();
  if (!website) return res.status(400).json({ error: "website required" });

  try {
    const scraped = await scrapeUkEntityFromWebsite(website, fascia ? { name: fascia } : undefined);

    // If we got a CH number, verify it against the live API and return the
    // canonical profile (name, status, accounts) so the user sees real data
    // before clicking Add to CRM. Number-resolved = 100% match.
    let chProfile: any = null;
    if (scraped.chNumber) {
      try {
        const padded = scraped.chNumber.padStart(8, "0");
        chProfile = await chFetch(`/company/${padded}`);
      } catch (e: any) {
        // CH rejected the number — return the scrape but mark unverified
        return res.json({
          ok: true,
          scraped,
          chProfile: null,
          verifyError: `CH could not verify ${scraped.chNumber}: ${e?.message}`,
        });
      }
    }

    res.json({ ok: true, scraped, chProfile });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Verify failed" });
  }
});

// ─── POST /api/goad/tenant-create ────────────────────────────────────────
// Button #2: creates the crm_companies row pre-populated with whatever
// the verify step turned up (fascia, website, CH number, address), then
// fires the existing performAutoKyc + RocketReach property-people import
// off-thread. Returns the new company id immediately so the drawer can
// link to the profile while the enrichment runs.
router.post("/api/goad/tenant-create", requireAuth, async (req: Request, res: Response) => {
  const fascia = String(req.body?.fascia || "").trim();
  const website = String(req.body?.website || "").trim();
  const chNumber = String(req.body?.chNumber || "").trim() || null;
  const entityName = String(req.body?.entityName || "").trim() || null;
  const goadCategory = String(req.body?.goadCategory || "").trim() || null;
  const headOfficeAddress = String(req.body?.headOfficeAddress || "").trim() || null;
  const phone = String(req.body?.phone || "").trim() || null;
  const userId = (req as any).session?.userId || (req as any).tokenUserId || null;

  if (!fascia) return res.status(400).json({ error: "fascia required" });

  try {
    const companyType = goadCategoryToCompanyType(goadCategory);
    const domain = website
      ? website.replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "")
      : null;

    const ins = await pool.query<{ id: string }>(
      `INSERT INTO crm_companies (name, company_type, domain, domain_url, head_office_address,
                                  uk_entity_name, companies_house_number, phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [fascia, companyType, domain, website || null, headOfficeAddress, entityName, chNumber, phone],
    );
    const companyId = ins.rows[0].id;

    // Audit + enrichment fire-and-forget so the response is snappy.
    // performAutoKyc handles CH + Experian + Perplexity; the RocketReach
    // import handles property/C-suite contacts (its own filter is already
    // narrowed in rocketreach-contacts.ts).
    (async () => {
      try {
        const { performAutoKyc } = (await import("./companies-house")) as any;
        if (typeof performAutoKyc === "function") {
          await performAutoKyc(companyId, { userId });
        }
      } catch (e: any) {
        console.warn(`[goad-tenant-create] auto-KYC failed for ${companyId}:`, e?.message);
      }
      try {
        // RocketReach contacts import — uses the existing tight filter
        // (C-suite + property/acquisitions) so we don't pull marketing
        // or ops staff. Skips silently when no domain is set.
        if (domain) {
          const url = `${req.protocol}://${req.get("host")}/api/brand/${companyId}/rocketreach/import`;
          await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", cookie: req.headers.cookie || "" },
            body: JSON.stringify({ domain }),
          }).catch((e) => console.warn(`[goad-tenant-create] RR import failed for ${companyId}:`, e?.message));
        }
      } catch (e: any) {
        console.warn(`[goad-tenant-create] RR import error for ${companyId}:`, e?.message);
      }
    })();

    res.json({ ok: true, companyId, companyType });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Create failed" });
  }
});

export default router;
