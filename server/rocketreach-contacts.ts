// ─────────────────────────────────────────────────────────────────────────
// RocketReach contact discovery for a brand/company.
//
// Mirrors server/apollo-contacts.ts — same discover-then-import flow,
// different provider. RocketReach is typically better than Apollo for
// UK retail/hospitality property & real-estate contacts.
//
// Endpoints:
//   POST /api/brand/:companyId/rocketreach/discover  → preview
//   POST /api/brand/:companyId/rocketreach/import    → upsert into crm_contacts
//
// Uses the /v2/api/search endpoint (bulk, 10 credits-ish per search).
// Optionally calls /v2/api/lookupProfile for email/phone reveal.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

const ROLE_TITLES = [
  "founder", "co-founder", "ceo", "chief executive",
  "coo", "chief operating", "cfo", "chief financial",
  "chief property", "head of property", "head of real estate",
  "property director", "real estate director",
  "retail director", "head of retail", "head of stores",
  "head of expansion", "head of acquisitions",
  "head of marketing", "cmo", "chief marketing",
  "managing director", "country manager", "uk director",
  "vp real estate", "vp property",
  "director of real estate", "director of property",
];

interface RocketReachPerson {
  id?: number | string;
  name?: string;
  first_name?: string;
  last_name?: string;
  current_title?: string;
  current_employer?: string;
  linkedin_url?: string;
  emails?: Array<{ email?: string; smtp_valid?: string; type?: string }>;
  phones?: Array<{ number?: string; type?: string }>;
  location?: string;
  profile_pic?: string;
  city?: string;
  region?: string;
  country?: string;
}

interface DiscoveredPerson {
  rocketreach_id: string;
  name: string;
  role: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  location: string | null;
  source: "direct" | "name_search" | "parent_group";
  source_company_name?: string;
}

function rrAuthHeader(): Record<string, string> | null {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return null;
  return { "Api-Key": key };
}

export function isRocketReachConfigured(): boolean {
  return !!process.env.ROCKETREACH_API_KEY;
}

async function searchRocketReach(opts: {
  companyName?: string;
  domain?: string;
}): Promise<RocketReachPerson[]> {
  const auth = rrAuthHeader();
  if (!auth) throw new Error("ROCKETREACH_API_KEY not configured");

  const body: Record<string, any> = {
    query: {
      current_title: ROLE_TITLES,
    },
    page_size: 25,
    start: 1,
  };
  if (opts.domain) body.query.current_employer_domain = [opts.domain];
  else if (opts.companyName) body.query.current_employer = [opts.companyName];

  const res = await fetch("https://api.rocketreach.co/v2/api/search", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`RocketReach ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  return (data?.profiles || data?.people || []) as RocketReachPerson[];
}

// Reveal full contact details (email + phone) for a single profile.
// Costs extra credits — caller must opt in.
async function revealProfile(profileId: string | number): Promise<RocketReachPerson | null> {
  const auth = rrAuthHeader();
  if (!auth) return null;
  try {
    const res = await fetch(`https://api.rocketreach.co/v2/api/lookupProfile?id=${encodeURIComponent(String(profileId))}`, {
      headers: auth,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as RocketReachPerson;
  } catch {
    return null;
  }
}

function extractDomain(company: any): string | undefined {
  const d = company?.domain || company?.domain_url;
  if (!d) return undefined;
  return String(d).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

function pickEmail(p: RocketReachPerson): string | null {
  const valid = (p.emails || []).find((e) => e.smtp_valid === "valid" && e.email);
  if (valid?.email) return valid.email;
  const anyEmail = (p.emails || []).find((e) => e.email);
  return anyEmail?.email || null;
}

function pickPhone(p: RocketReachPerson): string | null {
  const any = (p.phones || []).find((ph) => ph.number);
  return any?.number || null;
}

function mapPerson(p: RocketReachPerson, source: DiscoveredPerson["source"], sourceCompanyName?: string): DiscoveredPerson {
  const fullName = p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
  return {
    rocketreach_id: String(p.id || ""),
    name: fullName,
    role: p.current_title || null,
    email: pickEmail(p),
    phone: pickPhone(p),
    linkedin_url: p.linkedin_url || null,
    avatar_url: p.profile_pic || null,
    location: p.location || [p.city, p.region, p.country].filter(Boolean).join(", ") || null,
    source,
    source_company_name: sourceCompanyName,
  };
}

async function fetchCompany(companyId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url, brand_group_id, parent_company_id FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  return rows[0] || null;
}

async function fetchParentCompany(company: any) {
  const parentId = company.brand_group_id || company.parent_company_id;
  if (!parentId) return null;
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [parentId],
  );
  return rows[0] || null;
}

router.post("/api/brand/:companyId/rocketreach/discover", requireAuth, async (req: Request, res: Response) => {
  try {
    if (!isRocketReachConfigured()) return res.status(400).json({ error: "ROCKETREACH_API_KEY not configured" });
    const company = await fetchCompany(String(req.params.companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const domain = extractDomain(company);
    const seenIds = new Set<string>();
    const people: DiscoveredPerson[] = [];

    if (domain) {
      try {
        const byDomain = await searchRocketReach({ domain });
        for (const p of byDomain) {
          const key = String(p.id || p.linkedin_url || p.name || "");
          if (!key || seenIds.has(key)) continue;
          seenIds.add(key);
          people.push(mapPerson(p, "direct"));
        }
      } catch (err: any) {
        console.warn(`[rocketreach] domain search failed: ${err?.message}`);
      }
    }

    if (people.length < 3) {
      try {
        const byName = await searchRocketReach({ companyName: company.name });
        for (const p of byName) {
          const key = String(p.id || p.linkedin_url || p.name || "");
          if (!key || seenIds.has(key)) continue;
          seenIds.add(key);
          people.push(mapPerson(p, "name_search"));
        }
      } catch {
        // non-fatal
      }
    }

    let parentCompany: any = null;
    if (people.length < 3) {
      parentCompany = await fetchParentCompany(company);
      if (parentCompany) {
        try {
          const parentDomain = extractDomain(parentCompany);
          const byParent = await searchRocketReach({
            domain: parentDomain,
            companyName: parentDomain ? undefined : parentCompany.name,
          });
          for (const p of byParent) {
            const key = String(p.id || p.linkedin_url || p.name || "");
            if (!key || seenIds.has(key)) continue;
            seenIds.add(key);
            people.push(mapPerson(p, "parent_group", parentCompany.name));
          }
        } catch {
          // non-fatal
        }
      }
    }

    // Filter out people already stored under this company
    const existing = await pool.query(
      `SELECT email, linkedin_url FROM crm_contacts WHERE company_id = $1`,
      [company.id],
    );
    const existingEmails = new Set(existing.rows.map((r: any) => (r.email || "").toLowerCase()).filter(Boolean));
    const existingLinkedIn = new Set(existing.rows.map((r: any) => (r.linkedin_url || "").toLowerCase()).filter(Boolean));

    const fresh = people
      .filter((p) => p.name)
      .filter((p) => !(p.email && existingEmails.has(p.email.toLowerCase())))
      .filter((p) => !(p.linkedin_url && existingLinkedIn.has(p.linkedin_url.toLowerCase())));

    res.json({
      company: { id: company.id, name: company.name, domain },
      parentCompany: parentCompany ? { id: parentCompany.id, name: parentCompany.name } : null,
      people: fresh,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/rocketreach/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const people: Array<DiscoveredPerson> = req.body?.people || [];
    if (!Array.isArray(people) || people.length === 0) return res.status(400).json({ error: "people[] required" });

    const company = await fetchCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    let inserted = 0;
    for (const p of people) {
      if (!p.name) continue;
      if (p.email) {
        const dup = await pool.query(`SELECT 1 FROM crm_contacts WHERE company_id = $1 AND lower(email) = lower($2)`, [companyId, p.email]);
        if (dup.rowCount) continue;
      }
      if (p.linkedin_url) {
        const dup = await pool.query(`SELECT 1 FROM crm_contacts WHERE company_id = $1 AND lower(linkedin_url) = lower($2)`, [companyId, p.linkedin_url]);
        if (dup.rowCount) continue;
      }
      const roleNote = p.source === "parent_group" && p.source_company_name
        ? `${p.role || "Contact"} [via ${p.source_company_name}]`
        : (p.role || null);
      await pool.query(
        `INSERT INTO crm_contacts (name, role, email, phone, linkedin_url, avatar_url, company_id, company_name, enrichment_source, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'rocketreach-search', now())`,
        [p.name, roleNote, p.email || null, p.phone || null, p.linkedin_url || null, p.avatar_url || null, companyId, company.name],
      );
      inserted++;
    }

    res.json({ inserted, requested: people.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Lightweight health check — mirrors rssappHealth()
export async function rocketreachHealth(): Promise<{ ok: boolean; error?: string }> {
  if (!isRocketReachConfigured()) return { ok: false, error: "ROCKETREACH_API_KEY not set" };
  try {
    const res = await fetch("https://api.rocketreach.co/v2/api/account", {
      headers: rrAuthHeader()!,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 || res.status === 403) return { ok: false, error: `RocketReach rejected the key (${res.status})` };
    if (!res.ok) return { ok: false, error: `RocketReach returned ${res.status}` };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || "unknown error" };
  }
}

export default router;
