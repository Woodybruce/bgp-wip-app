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

// ─── Verification cache ──────────────────────────────────────────────────
// The website→entity chain is deterministic per domain, so cache verdicts:
// the first click on any Pret unit scrapes pret.co.uk once, every other
// Pret unit (and every re-open) answers instantly and for free. Enables
// the client to auto-verify on panel open without burning ScraperAPI/CH
// quota on repeats.
let verifyCacheEnsured = false;
async function ensureVerifyCache(): Promise<void> {
  if (verifyCacheEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS goad_tenant_verifications (
      domain       TEXT PRIMARY KEY,
      website      TEXT,
      fascia       TEXT,
      result       JSONB NOT NULL,
      verified_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  verifyCacheEnsured = true;
}

function domainOf(website: string): string {
  return website.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(/^www\./i, "").toLowerCase();
}

// ─── POST /api/goad/tenant-verify ────────────────────────────────────────
// Takes the website discovered via Google Places, runs the website-footer
// scrape, verifies any extracted CH number against the live CH API, returns
// a structured candidate. Cached per domain (pass force:true to re-scrape).
// No CRM write — that stays behind the explicit Add to CRM step.
router.post("/api/goad/tenant-verify", requireAuth, async (req: Request, res: Response) => {
  const website = String(req.body?.website || "").trim();
  const fascia = String(req.body?.fascia || "").trim();
  const force = req.body?.force === true;
  if (!website) return res.status(400).json({ error: "website required" });

  try {
    await ensureVerifyCache().catch(() => {});
    const domain = domainOf(website);
    if (!force && domain) {
      try {
        const { rows } = await pool.query(
          `SELECT result FROM goad_tenant_verifications WHERE domain = $1 AND verified_at > now() - interval '90 days'`,
          [domain],
        );
        if (rows[0]?.result) return res.json({ ...rows[0].result, cached: true });
      } catch { /* cache miss path below */ }
    }

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
        // (not cached: a transient CH outage shouldn't stick for 90 days).
        return res.json({
          ok: true,
          scraped,
          chProfile: null,
          verifyError: `CH could not verify ${scraped.chNumber}: ${e?.message}`,
        });
      }
    }

    const payload = { ok: true, scraped, chProfile };
    // Cache only verdicts worth reusing — a CH-verified profile or at least
    // an extracted entity name. Empty scrapes retry next time.
    if (domain && (chProfile || scraped.entityName)) {
      pool.query(
        `INSERT INTO goad_tenant_verifications (domain, website, fascia, result, verified_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (domain) DO UPDATE SET result = $4, fascia = $3, verified_at = now()`,
        [domain, website, fascia || null, JSON.stringify(payload)],
      ).catch(() => {});
    }
    res.json(payload);
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

// ─── Ownership narratives — auto "who they really are" ──────────────────
// When a clicked unit resolves a likely freeholder, the client calls this
// unprompted. First call per proprietor kicks a background ChatBGP
// investigation (CH PSC chain + Perplexity + BGP CRM) and returns
// "generating"; the client polls, and once written the narrative is cached
// so every later click on any of that proprietor's buildings is instant.
let narrativeCacheEnsured = false;
async function ensureNarrativeCache(): Promise<void> {
  if (narrativeCacheEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ownership_narratives (
      key           TEXT PRIMARY KEY,
      proprietor    TEXT NOT NULL,
      company_no    TEXT,
      narrative     TEXT,
      status        TEXT NOT NULL DEFAULT 'generating',
      generated_at  TIMESTAMPTZ,
      requested_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  narrativeCacheEnsured = true;
}

const narrativeInFlight = new Set<string>();

router.post("/api/goad/ownership-narrative", requireAuth, async (req: Request, res: Response) => {
  const proprietorName = String(req.body?.proprietorName || "").trim();
  const companyRegistrationNo = String(req.body?.companyRegistrationNo || "").trim() || null;
  const role = String(req.body?.role || "freeholder").trim();
  const address = String(req.body?.address || "").trim();
  if (!proprietorName) return res.status(400).json({ error: "proprietorName required" });

  try {
    await ensureNarrativeCache();
    const key = (companyRegistrationNo || proprietorName.toLowerCase()).slice(0, 200);

    const { rows } = await pool.query(
      `SELECT narrative, status, generated_at FROM ownership_narratives WHERE key = $1`,
      [key],
    );
    const row = rows[0];
    if (row?.status === "ready" && row.narrative) {
      return res.json({ status: "ready", narrative: row.narrative, generatedAt: row.generated_at, cached: true });
    }
    // A run marked generating for over 10 minutes is presumed dead — retry.
    if (row?.status === "generating" && !narrativeInFlight.has(key)) {
      const { rows: staleCheck } = await pool.query(
        `SELECT 1 FROM ownership_narratives WHERE key = $1 AND requested_at > now() - interval '10 minutes'`,
        [key],
      );
      if (staleCheck[0]) return res.json({ status: "generating" });
    } else if (narrativeInFlight.has(key)) {
      return res.json({ status: "generating" });
    }

    await pool.query(
      `INSERT INTO ownership_narratives (key, proprietor, company_no, status, requested_at)
       VALUES ($1, $2, $3, 'generating', now())
       ON CONFLICT (key) DO UPDATE SET status = 'generating', requested_at = now()`,
      [key, proprietorName, companyRegistrationNo],
    );
    narrativeInFlight.add(key);

    const question =
      `Who really controls "${proprietorName}"` +
      (companyRegistrationNo ? ` (Companies House #${companyRegistrationNo})` : "") +
      `, the likely ${role}${address ? ` of ${address}` : ""}?\n\n` +
      `Walk the Companies House PSC / parent-company chain, check the BGP CRM for any relationship history, and search news if needed. ` +
      `Reply in UNDER 130 words, plain text with these four lines:\n` +
      `Controller: <the fund / family office / individual that ultimately controls it, 1-2 sentences>\n` +
      `BGP link: <deals, properties or contacts we have with them, or "none found">\n` +
      `Other holdings: <notable UK property they hold, or "none found">\n` +
      `Flags: <risk flags, or "none">`;

    (async () => {
      try {
        const { askChatBgp } = await import("./chatbgp-internal");
        const answer = await askChatBgp(question, req, { timeoutMs: 4 * 60 * 1000 });
        if (answer?.trim()) {
          await pool.query(
            `UPDATE ownership_narratives SET narrative = $2, status = 'ready', generated_at = now() WHERE key = $1`,
            [key, answer.trim().slice(0, 4000)],
          );
        } else {
          await pool.query(`UPDATE ownership_narratives SET status = 'failed' WHERE key = $1`, [key]);
        }
      } catch (e: any) {
        console.warn(`[ownership-narrative] ${proprietorName} failed:`, e?.message);
        await pool.query(`UPDATE ownership_narratives SET status = 'failed' WHERE key = $1`, [key]).catch(() => {});
      } finally {
        narrativeInFlight.delete(key);
      }
    })();

    res.json({ status: "generating" });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Narrative lookup failed" });
  }
});

export default router;
