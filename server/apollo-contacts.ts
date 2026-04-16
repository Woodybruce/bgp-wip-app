// ─────────────────────────────────────────────────────────────────────────
// Apollo contact discovery for a brand/company.
//
// Uses Apollo's /mixed_people/search endpoint to find key people (C-suite,
// Founders, Property/Real Estate heads, Marketing leads) associated with a
// crm_companies row, then upserts them into crm_contacts.
//
// Exposed as:
//   POST /api/brand/:companyId/apollo/discover  → returns preview
//   POST /api/brand/:companyId/apollo/import    → upserts into crm_contacts
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
  "retail director", "head of retail",
  "head of stores", "head of expansion", "head of acquisitions",
  "head of marketing", "cmo", "chief marketing",
];

interface ApolloPerson {
  id: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  linkedin_url?: string;
  email?: string | null;
  photo_url?: string | null;
  organization?: { id?: string; name?: string; website_url?: string };
  city?: string;
  country?: string;
}

async function searchApollo(opts: { domain?: string; organizationName?: string; apolloKey: string }): Promise<ApolloPerson[]> {
  const body: Record<string, any> = {
    page: 1,
    per_page: 25,
    person_titles: ROLE_TITLES,
  };
  if (opts.domain) body.q_organization_domains_list = [opts.domain];
  else if (opts.organizationName) body.organization_names = [opts.organizationName];

  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "X-Api-Key": opts.apolloKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Apollo ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as any;
  return (data.people || data.contacts || []) as ApolloPerson[];
}

async function fetchCompany(companyId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  return rows[0] || null;
}

function extractDomain(company: any): string | undefined {
  const d = company?.domain || company?.domain_url;
  if (!d) return undefined;
  return String(d).replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "").toLowerCase();
}

router.post("/api/brand/:companyId/apollo/discover", requireAuth, async (req: Request, res: Response) => {
  try {
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) return res.status(400).json({ error: "APOLLO_API_KEY not configured" });
    const company = await fetchCompany(String(req.params.companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const domain = extractDomain(company);
    const people = await searchApollo({ domain, organizationName: domain ? undefined : company.name, apolloKey });

    // Filter out people already stored under this company (by email or LinkedIn)
    const existing = await pool.query(
      `SELECT email, linkedin_url FROM crm_contacts WHERE company_id = $1`,
      [company.id]
    );
    const existingEmails = new Set(existing.rows.map((r: any) => (r.email || "").toLowerCase()).filter(Boolean));
    const existingLinkedIn = new Set(existing.rows.map((r: any) => (r.linkedin_url || "").toLowerCase()).filter(Boolean));

    const fresh = people
      .filter(p => p.name || (p.first_name && p.last_name))
      .filter(p => !(p.email && existingEmails.has(p.email.toLowerCase())))
      .filter(p => !(p.linkedin_url && existingLinkedIn.has(p.linkedin_url.toLowerCase())))
      .map(p => ({
        apollo_id: p.id,
        name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
        role: p.title || null,
        email: p.email || null,
        linkedin_url: p.linkedin_url || null,
        avatar_url: p.photo_url || null,
        location: [p.city, p.country].filter(Boolean).join(", ") || null,
      }));

    res.json({ company: { id: company.id, name: company.name, domain }, people: fresh });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/apollo/import", requireAuth, async (req: Request, res: Response) => {
  try {
    const companyId = String(req.params.companyId);
    const people: Array<{ name: string; role?: string | null; email?: string | null; linkedin_url?: string | null; avatar_url?: string | null }> = req.body?.people || [];
    if (!Array.isArray(people) || people.length === 0) return res.status(400).json({ error: "people[] required" });

    const company = await fetchCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    let inserted = 0;
    for (const p of people) {
      if (!p.name) continue;
      // Idempotency check — skip if email or linkedin already exists for this company
      if (p.email) {
        const dup = await pool.query(`SELECT 1 FROM crm_contacts WHERE company_id = $1 AND lower(email) = lower($2)`, [companyId, p.email]);
        if (dup.rowCount) continue;
      }
      if (p.linkedin_url) {
        const dup = await pool.query(`SELECT 1 FROM crm_contacts WHERE company_id = $1 AND lower(linkedin_url) = lower($2)`, [companyId, p.linkedin_url]);
        if (dup.rowCount) continue;
      }
      await pool.query(
        `INSERT INTO crm_contacts (name, role, email, linkedin_url, avatar_url, company_id, company_name, enrichment_source, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'apollo-search', now())`,
        [p.name, p.role || null, p.email || null, p.linkedin_url || null, p.avatar_url || null, companyId, company.name]
      );
      inserted++;
    }

    res.json({ inserted, requested: people.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
