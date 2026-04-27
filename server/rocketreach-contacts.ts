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

// Tight filter — only C-suite and property/acquisitions decision makers.
// Without this the result set explodes with marketing/retail-ops people
// who aren't relevant to a property pitch.
const ROLE_TITLES = [
  // C-suite
  "founder", "co-founder", "ceo", "chief executive",
  "coo", "chief operating", "cfo", "chief financial",
  "cmo", "chief marketing",
  "managing director",
  // Property + acquisitions
  "chief property", "head of property", "head of real estate",
  "property director", "real estate director",
  "head of expansion", "head of acquisitions",
  "vp real estate", "vp property",
  "director of real estate", "director of property",
];

// Belt-and-braces post-filter: even with the title query, RocketReach can
// surface fuzzy matches (e.g. "head of marketing" leaks through). Drop
// anything whose title doesn't actually look C-suite or property.
function isRelevantTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  const cSuite = /\b(founder|ceo|chief executive|coo|chief operating|cfo|chief financial|cmo|chief marketing|managing director|md)\b/.test(t);
  const property = /(property|real estate|acquisition|expansion|portfolio|site|estates)/.test(t);
  return cSuite || property;
}

interface RocketReachPerson {
  id?: number | string;
  name?: string;
  first_name?: string;
  last_name?: string;
  current_title?: string;
  current_employer?: string;
  current_employer_domain?: string;
  current_employer_website?: string;
  linkedin_url?: string;
  twitter_url?: string;
  facebook_url?: string;
  // Email lists — RocketReach returns several variants depending on credits.
  emails?: Array<{ email?: string; smtp_valid?: string; type?: string }>;
  recommended_email?: string;
  recommended_personal_email?: string;
  recommended_professional_email?: string;
  current_work_email?: string;
  current_personal_email?: string;
  // Phone lists — number + is_premium + type (mobile/work/etc).
  phones?: Array<{ number?: string; type?: string; is_premium?: boolean }>;
  location?: string;
  profile_pic?: string;
  city?: string;
  region?: string;
  country?: string;
  // Career + education history (returned on lookupProfile, sometimes on search).
  job_history?: Array<{ company_name?: string; title?: string; start_date?: string; end_date?: string; description?: string }>;
  education?: Array<{ school?: string; degree?: string; major?: string; start?: string; end?: string }>;
  skills?: string[];
  // Bio + summary fields when present.
  bio?: string;
  birth_year?: number;
}

interface PreviousEmployer {
  company: string;
  title: string | null;
  end_date: string | null;
}

interface DiscoveredPerson {
  rocketreach_id: string;
  name: string;
  role: string | null;
  email: string | null;        // best email — work preferred over personal
  work_email: string | null;
  personal_email: string | null;
  phone: string | null;        // best phone — mobile preferred over work
  mobile_phone: string | null;
  work_phone: string | null;
  linkedin_url: string | null;
  twitter_url: string | null;
  avatar_url: string | null;
  location: string | null;
  current_employer: string | null;
  previous_employers: PreviousEmployer[];
  education: string | null;     // top school name
  bio: string | null;
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
  country?: string[];
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
  if (opts.country && opts.country.length > 0) body.query.location_country = opts.country;

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

function pickEmails(p: RocketReachPerson): { work: string | null; personal: string | null; best: string | null } {
  const list = p.emails || [];
  const isPersonal = (e: { type?: string; email?: string }) => /personal/i.test(e.type || "") || /gmail|yahoo|hotmail|outlook|icloud|live\.com|me\.com/i.test(e.email || "");
  const validWork = list.find((e) => e.email && e.smtp_valid === "valid" && !isPersonal(e));
  const anyWork = list.find((e) => e.email && !isPersonal(e));
  const validPersonal = list.find((e) => e.email && e.smtp_valid === "valid" && isPersonal(e));
  const anyPersonal = list.find((e) => e.email && isPersonal(e));
  const work = p.current_work_email || p.recommended_professional_email || validWork?.email || anyWork?.email || null;
  const personal = p.current_personal_email || p.recommended_personal_email || validPersonal?.email || anyPersonal?.email || null;
  const best = work || personal || p.recommended_email || (list.find((e) => e.email)?.email ?? null);
  return { work, personal, best };
}

function pickPhones(p: RocketReachPerson): { mobile: string | null; work: string | null; best: string | null } {
  const list = p.phones || [];
  const isMobile = (ph: { type?: string }) => /mobile|cell/i.test(ph.type || "");
  const isWork = (ph: { type?: string }) => /work|office|direct/i.test(ph.type || "");
  const mobile = list.find((ph) => ph.number && isMobile(ph))?.number || null;
  const work = list.find((ph) => ph.number && isWork(ph))?.number || null;
  const best = mobile || work || (list.find((ph) => ph.number)?.number ?? null);
  return { mobile, work, best };
}

function pickPreviousEmployers(p: RocketReachPerson): PreviousEmployer[] {
  const history = p.job_history || [];
  const current = (p.current_employer || "").toLowerCase();
  return history
    .filter((j) => j.company_name && j.company_name.toLowerCase() !== current)
    .slice(0, 3)
    .map((j) => ({
      company: j.company_name as string,
      title: j.title || null,
      end_date: j.end_date || null,
    }));
}

function mapPerson(p: RocketReachPerson, source: DiscoveredPerson["source"], sourceCompanyName?: string): DiscoveredPerson {
  const fullName = p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim();
  const emails = pickEmails(p);
  const phones = pickPhones(p);
  const topSchool = (p.education || []).find((e) => e.school)?.school || null;
  return {
    rocketreach_id: String(p.id || ""),
    name: fullName,
    role: p.current_title || null,
    email: emails.best,
    work_email: emails.work,
    personal_email: emails.personal,
    phone: phones.best,
    mobile_phone: phones.mobile,
    work_phone: phones.work,
    linkedin_url: p.linkedin_url || null,
    twitter_url: p.twitter_url || null,
    avatar_url: p.profile_pic || null,
    location: p.location || [p.city, p.region, p.country].filter(Boolean).join(", ") || null,
    current_employer: p.current_employer || null,
    previous_employers: pickPreviousEmployers(p),
    education: topSchool || null,
    bio: p.bio || null,
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

    const addIfRelevant = (p: RocketReachPerson, src: DiscoveredPerson["source"], parentName?: string) => {
      const key = String(p.id || p.linkedin_url || p.name || "");
      if (!key || seenIds.has(key)) return;
      if (!isRelevantTitle(p.current_title)) return;
      seenIds.add(key);
      people.push(mapPerson(p, src, parentName));
    };

    const ukOnly = ["United Kingdom"];

    if (domain) {
      try {
        const byDomain = await searchRocketReach({ domain, country: ukOnly });
        for (const p of byDomain) addIfRelevant(p, "direct");
      } catch (err: any) {
        console.warn(`[rocketreach] domain search failed: ${err?.message}`);
      }
    }

    if (people.length < 3) {
      try {
        const byName = await searchRocketReach({ companyName: company.name, country: ukOnly });
        for (const p of byName) addIfRelevant(p, "name_search");
      } catch {
        // non-fatal
      }
    }

    // Last-resort: drop country filter — some legit UK contacts have location
    // set to their passport country rather than work country.
    if (people.length < 2 && domain) {
      try {
        const byDomainGlobal = await searchRocketReach({ domain });
        for (const p of byDomainGlobal) addIfRelevant(p, "direct");
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
            country: ukOnly,
          });
          for (const p of byParent) addIfRelevant(p, "parent_group", parentCompany.name);
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
    const peopleIn: Array<DiscoveredPerson> = req.body?.people || [];
    // Default to true: spend the credits to get the rich profile (revealed
    // emails/phones, job history, education). Without this most of the
    // RocketReach detail surfaced on the website doesn't make it back.
    const enrich: boolean = req.body?.enrich !== false;
    if (!Array.isArray(peopleIn) || peopleIn.length === 0) return res.status(400).json({ error: "people[] required" });

    const company = await fetchCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    // Reveal each profile in parallel (capped concurrency) so we get the full
    // RocketReach detail rather than the search-time preview.
    const revealOne = async (p: DiscoveredPerson): Promise<DiscoveredPerson> => {
      if (!enrich || !p.rocketreach_id) return p;
      const full = await revealProfile(p.rocketreach_id);
      if (!full) return p;
      return mapPerson(full, p.source, p.source_company_name);
    };
    const limit = 5;
    const people: DiscoveredPerson[] = [];
    for (let i = 0; i < peopleIn.length; i += limit) {
      const slice = peopleIn.slice(i, i + limit);
      const enriched = await Promise.all(slice.map(revealOne));
      people.push(...enriched);
    }

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

      // Build a notes blob with the extra context RocketReach gives us so it
      // doesn't get lost — past employers, education, bio, secondary emails.
      const notesParts: string[] = [];
      if (p.previous_employers && p.previous_employers.length) {
        const prev = p.previous_employers
          .map((j) => `${j.title ? j.title + " @ " : ""}${j.company}${j.end_date ? ` (until ${j.end_date.slice(0, 7)})` : ""}`)
          .join("; ");
        notesParts.push(`Past: ${prev}`);
      }
      if (p.education) notesParts.push(`Education: ${p.education}`);
      if (p.work_email && p.personal_email && p.work_email.toLowerCase() !== p.personal_email.toLowerCase()) {
        notesParts.push(`Personal email: ${p.personal_email}`);
      }
      if (p.work_phone && p.mobile_phone && p.work_phone !== p.mobile_phone) {
        notesParts.push(`Work phone: ${p.work_phone}`);
      }
      if (p.location) notesParts.push(`Based in ${p.location}`);
      if (p.bio) notesParts.push(p.bio);
      const notes = notesParts.length ? notesParts.join(" · ") : null;

      const phoneMobile = p.mobile_phone || null;
      const phonePrimary = p.work_phone || p.mobile_phone || p.phone || null;

      await pool.query(
        `INSERT INTO crm_contacts (name, role, email, phone, phone_mobile, linkedin_url, avatar_url, notes, company_id, company_name, enrichment_source, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'rocketreach-search', now())`,
        [p.name, roleNote, p.email || null, phonePrimary, phoneMobile, p.linkedin_url || null, p.avatar_url || null, notes, companyId, company.name],
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
