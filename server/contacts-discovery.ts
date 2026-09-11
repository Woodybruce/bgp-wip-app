// ─────────────────────────────────────────────────────────────────────────
// Contact-discovery diagnostics + BGP email archaeology.
//
// Two endpoints, one purpose: help the team decide where each brand's
// contact list should come from.
//
//   POST /api/admin/contacts-discovery-compare/:companyId
//     Runs Apollo and RocketReach against the same company side-by-side
//     so we can decide which provider gives better coverage. Apollo was
//     deprecated for retail tenants (too noisy) but landlords are a
//     different shape — this lets us re-test on a per-landlord basis
//     without committing to bringing Apollo back across the board.
//
//   GET  /api/brand/:companyId/bgp-known-contacts
//     Mines crm_interactions.participants — every recipient on every
//     indexed BGP outbound email — for any email address at the brand's
//     domain over the last 2 years. Surfaces:
//       — people we've emailed at this brand who ARE already in CRM
//         (so the team sees the touch history)
//       — people we've emailed at this brand who AREN'T in CRM yet
//         (candidates to add — the "they have a relationship, we
//         just never logged the contact" gap).
//     The latter is the demo "wow" — a brand profile suddenly shows
//     "Charlotte has emailed 8 people at Landsec we don't have on
//     file" — names + roles inferred from email patterns.
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";
import { enrichSignaturesForDomain, getCachedSignatures, type EmailSignature } from "./email-signature-enrich";

const router = Router();

// CRM data is messy — some rows have "hammerson.com - https:" or
// "https://www.foo.co.uk/contact/" in the domain field. Strip protocol,
// paths, www., trailing junk after a space, hyphen-suffixes.
function cleanDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const stripped = String(raw)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split(/[\s/?#]/)[0]
    .replace(/[^a-z0-9.\-]+$/, "");
  return stripped || null;
}

// Distribution lists and role mailboxes are noise — drop them from the
// archaeology output. Pattern is: no dot before @ (most personal emails
// have firstname.lastname), or a role-word in the local part.
const DIST_LIST_PATTERNS = /^(info|admin|hello|contact|sales|marketing|press|enquir|enquiries|enquiry|leasing|investor|investors|reception|team|office|support|noreply|no-reply|finance|accounts|outlet|outlets|shoppingcentres|shopping-centres|regional|hr|jobs|careers|legal|compliance|aml|kyc|customer|service|properties|estates)(@|[-_\.])/i;
function isDistributionList(email: string): boolean {
  const local = email.split("@")[0] || "";
  if (!local.includes(".")) return true;
  if (DIST_LIST_PATTERNS.test(local + "@")) return true;
  return false;
}

// ─── Apollo ↔ RocketReach side-by-side ──────────────────────────────────
// Returns counts + a sample of the first 10 from each so the team can
// eyeball quality. Doesn't write anything to the DB — pure diagnostic.

async function runApolloSearch(domain: string | null, companyName: string): Promise<{ ok: boolean; total: number; sample: Array<{ name: string; title: string | null; seniority: string | null; email: string | null }>; error?: string }> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return { ok: false, total: 0, sample: [], error: "APOLLO_API_KEY not set" };

  // Apollo deprecated /mixed_people/search in 2025 — use api_search.
  // Body shape: organization_names + person_locations + paging. Domain
  // filtering goes through the company by name; api_search resolves the
  // organization lookup internally so we don't pass domain directly.
  const body: Record<string, any> = {
    page: 1,
    per_page: 50,
    person_locations: ["United Kingdom"],
    organization_names: [companyName],
  };

  try {
    const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, total: 0, sample: [], error: `Apollo ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json() as any;
    const people = (data.people || data.contacts || []) as any[];
    const total = data.pagination?.total_entries ?? people.length;
    const sample = people.slice(0, 10).map((p: any) => ({
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
      title: p.title || null,
      seniority: p.seniority || null,
      email: p.email || null,
    }));
    return { ok: true, total, sample };
  } catch (e: any) {
    return { ok: false, total: 0, sample: [], error: e?.message || "Apollo request failed" };
  }
}

// Apollo people/match — the precise (credit-consuming) endpoint. Given a
// name+company (or better, an email), returns the full person record:
// verified email + status, LinkedIn, seniority, departments, employment
// history AND the organisation's firmographics (employees, revenue,
// funding, founded) — data RocketReach doesn't carry. Used by the
// cascade as an enrichment pass over the top candidates, never as a
// primary search (api_search returns obfuscated teasers).
async function apolloMatchPerson(args: { name?: string | null; email?: string | null; companyName: string }): Promise<any | null> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) return null;
  const body: Record<string, any> = { reveal_personal_emails: false };
  if (args.email) body.email = args.email;
  if (args.name) {
    const parts = args.name.trim().split(/\s+/);
    body.first_name = parts[0];
    if (parts.length > 1) body.last_name = parts.slice(1).join(" ");
  }
  body.organization_name = args.companyName;
  try {
    const res = await fetch("https://api.apollo.io/api/v1/people/match", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Api-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data?.person || null;
  } catch {
    return null;
  }
}

async function runRocketReachSearch(domain: string | null, companyName: string, scope: "tenant" | "landlord"): Promise<{ ok: boolean; total: number; sample: Array<{ name: string; title: string | null; seniority: string | null; email: string | null }>; error?: string }> {
  const key = process.env.ROCKETREACH_API_KEY;
  if (!key) return { ok: false, total: 0, sample: [], error: "ROCKETREACH_API_KEY not set" };

  // RocketReach renamed current_employer_website → invalid in late 2025.
  // Falling back to current_employer (company name match) which is the
  // long-standing stable field. Less precise than domain match but
  // doesn't 400.
  const body: Record<string, any> = {
    query: scope === "landlord" ? {} : {
      current_title: [
        "founder", "ceo", "coo", "cfo", "managing director",
        "chief property", "head of property", "head of real estate",
        "property director", "real estate director",
        "head of expansion", "head of acquisitions",
      ],
    },
    page_size: 50,
    start: 1,
  };
  body.query.current_employer = [companyName];
  body.query.country = ["United Kingdom"];

  try {
    const res = await fetch("https://api.rocketreach.co/v2/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Api-Key": key },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { ok: false, total: 0, sample: [], error: `RocketReach ${res.status}: ${text.slice(0, 200)}` };
    }
    const data = await res.json() as any;
    const people = (data.profiles || []) as any[];
    const total = data.pagination?.total ?? people.length;
    const sample = people.slice(0, 10).map((p: any) => ({
      id: p.id || null,
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
      title: p.current_title || null,
      seniority: null,
      email: p.recommended_professional_email || (p.emails?.[0]?.email) || null,
      linkedin: p.linkedin_url || null,
    }));
    return { ok: true, total, sample };
  } catch (e: any) {
    return { ok: false, total: 0, sample: [], error: e?.message || "RocketReach request failed" };
  }
}

async function handleCompareForCompanyId(companyId: string, res: Response) {
  const { rows } = await pool.query(
    `SELECT name, domain, domain_url, company_type FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const company = rows[0];
  if (!company) return res.status(404).json({ error: "Company not found" });
  const domain = cleanDomain(company.domain || company.domain_url);
  const ct = (company.company_type || "").toLowerCase();
  const scope: "tenant" | "landlord" = /landlord|freeholder|investor|developer|reit|fund|estate/.test(ct) ? "landlord" : "tenant";

  const [apollo, rocketreach] = await Promise.all([
    runApolloSearch(domain, company.name),
    runRocketReachSearch(domain, company.name, scope),
  ]);

  return res.json({
    company: { id: companyId, name: company.name, domain, companyType: company.company_type, scope },
    apollo,
    rocketreach,
    summary: {
      apolloOk: apollo.ok,
      rocketreachOk: rocketreach.ok,
      apolloCount: apollo.total,
      rocketreachCount: rocketreach.total,
      winner: !apollo.ok ? "rocketreach" : !rocketreach.ok ? "apollo" : apollo.total > rocketreach.total * 1.5 ? "apollo" : rocketreach.total > apollo.total * 1.5 ? "rocketreach" : "tie",
    },
  });
}

router.post("/api/admin/contacts-discovery-compare/:companyId", requireAuth, async (req: Request, res: Response) => {
  await handleCompareForCompanyId(String(req.params.companyId), res);
});

// GET alias for the same compare endpoint — convenience for testing from
// a browser address bar (POST requires DevTools/curl, GET doesn't).
router.get("/api/admin/contacts-discovery-compare/:companyId", requireAuth, async (req: Request, res: Response) => {
  await handleCompareForCompanyId(String(req.params.companyId), res);
});

// ─── BGP email archaeology ──────────────────────────────────────────────
// Mines crm_interactions.participants — a JSONB array of every email
// address on every BGP outbound email (and inbound matched to a contact)
// over the indexed window. Returns recipients at the company's domain
// that the team has actually emailed, with last-touch + sender stats.
//
// Already-in-CRM rows carry the existing contact_id; not-yet-in-CRM
// rows carry email + a best-effort "name from email" guess so the
// brand profile UI can offer one-click "Add as contact" alongside
// the RocketReach import.

// Compute form of the archaeology — used by the GET endpoint below AND by
// the find-contacts engine, which merges these results with the paid
// providers before the AI judge pass.
async function computeBgpKnownContacts(companyId: string, monthsBack: number): Promise<{ status: number; body: any }> {

  const { rows: companyRows } = await pool.query(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const company = companyRows[0];
  if (!company) return { status: 404, body: { error: "Company not found" } };

  const domain = cleanDomain(company.domain || company.domain_url);
  if (!domain) {
    return { status: 200, body: { company: { id: companyId, name: company.name }, contacts: [], note: "Company has no domain — set one to enable BGP email archaeology." } };
  }

  // Pull every interaction whose participants array contains at least one
  // email at the brand domain, within the lookback window. Unnest in JS
  // so we can de-dupe + aggregate per recipient.
  const since = new Date();
  since.setMonth(since.getMonth() - monthsBack);

  const { rows: ints } = await pool.query<{
    id: string;
    participants: string[];
    interaction_date: string;
    bgp_user: string | null;
    subject: string | null;
    direction: string | null;
  }>(
    `SELECT id, participants, to_char(interaction_date, 'YYYY-MM-DD') AS interaction_date,
            bgp_user, subject, direction
       FROM crm_interactions
      WHERE interaction_date >= $1
        AND participants IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(participants) AS p(addr)
          WHERE lower(addr) LIKE $2
        )
      ORDER BY interaction_date DESC
      LIMIT 1000`,
    [since, `%@${domain}`],
  );

  // Aggregate per recipient email at the brand's domain.
  type Agg = {
    email: string;
    lastEmailed: string;
    threadCount: number;
    bgpSenders: Set<string>;
    lastSubject: string | null;
  };
  const byEmail = new Map<string, Agg>();
  for (const i of ints) {
    if (!Array.isArray(i.participants)) continue;
    for (const raw of i.participants) {
      const addr = String(raw || "").toLowerCase().trim();
      if (!addr.endsWith(`@${domain}`)) continue;
      // Drop info@/leasing@/regionalshoppingcentres@ etc. — distribution
      // lists and role mailboxes that aren't actual people.
      if (isDistributionList(addr)) continue;
      const existing = byEmail.get(addr);
      if (existing) {
        existing.threadCount += 1;
        if (i.bgp_user) existing.bgpSenders.add(i.bgp_user);
        if (i.interaction_date > existing.lastEmailed) {
          existing.lastEmailed = i.interaction_date;
          existing.lastSubject = i.subject;
        }
      } else {
        byEmail.set(addr, {
          email: addr,
          lastEmailed: i.interaction_date,
          threadCount: 1,
          bgpSenders: new Set(i.bgp_user ? [i.bgp_user] : []),
          lastSubject: i.subject,
        });
      }
    }
  }

  if (byEmail.size === 0) {
    return { status: 200, body: { company: { id: companyId, name: company.name, domain }, contacts: [], lookbackMonths: monthsBack } };
  }

  // Cross-reference against existing CRM contacts so the UI can split into
  // "already on file" (show history badge on the existing contact) and
  // "not in CRM" (offer one-click add).
  const emails = Array.from(byEmail.keys());
  const { rows: existingContacts } = await pool.query<{ id: string; email: string; name: string; company_id: string | null; role: string | null }>(
    `SELECT id, lower(email) AS email, name, company_id, role
       FROM crm_contacts
      WHERE lower(email) = ANY($1::text[])`,
    [emails],
  );
  const inCrmByEmail = new Map<string, typeof existingContacts[number]>();
  for (const c of existingContacts) inCrmByEmail.set(c.email, c);

  // Best-effort name guess from the email local-part for emails that
  // aren't on file. "nick.smith@landsec.com" → "Nick Smith". Imperfect
  // but enough for the UI; the real name comes after the user clicks
  // Add (where we then enrich via RocketReach lookupProfile).
  const guessNameFromEmail = (email: string): string => {
    const local = email.split("@")[0] || "";
    const cleaned = local.replace(/\d+/g, "").replace(/[._-]+/g, " ").trim();
    if (!cleaned) return email;
    return cleaned.split(/\s+/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(" ");
  };

  // Pull cached email signatures for this domain — populated by the
  // background enrichment job below. When we have a signature it
  // overrides the email-local-part name guess and adds role / phone /
  // mobile / linkedin so the contact card is actually useful.
  const sigCache = await getCachedSignatures(Array.from(byEmail.keys()));

  const contacts = Array.from(byEmail.values())
    .sort((a, b) => b.threadCount - a.threadCount || (b.lastEmailed > a.lastEmailed ? 1 : -1))
    .map((agg) => {
      const existing = inCrmByEmail.get(agg.email);
      const sig = sigCache.get(agg.email);
      return {
        email: agg.email,
        // Priority: CRM display name → signature-parsed name → email-local guess.
        name: existing?.name || sig?.fullName || guessNameFromEmail(agg.email),
        // Role: CRM > signature.
        role: existing?.role || sig?.title || null,
        // New signature-sourced fields. Empty when not yet enriched.
        phone: sig?.phone || null,
        mobile: sig?.mobile || null,
        linkedin: sig?.linkedin || null,
        signatureAddress: sig?.address || null,
        signatureLastSeenAt: sig?.lastSeenAt || null,
        lastEmailed: agg.lastEmailed,
        threadCount: agg.threadCount,
        bgpSenders: Array.from(agg.bgpSenders),
        lastSubject: agg.lastSubject,
        inCrm: !!existing,
        crmContactId: existing?.id || null,
        crmContactCompanyId: existing?.company_id || null,
        enriched: !!sig,
      };
    });

  // Cross-contamination guard: a direct/mobile number that shows up on
  // more than one person is either a switchboard or a mis-attributed
  // quoted-thread signature (seen live: two Landsec contacts sharing one
  // mobile). We can't know whose it is, so blank it everywhere — a
  // missing number is better than the wrong person's.
  const numberOwners = new Map<string, number>();
  const normNum = (v: string | null) => (v || "").replace(/[^\d]/g, "").replace(/^44/, "0");
  for (const c of contacts) {
    for (const v of [c.phone, c.mobile]) {
      const n = normNum(v);
      if (n.length >= 10) numberOwners.set(n, (numberOwners.get(n) || 0) + 1);
    }
  }
  for (const c of contacts) {
    if (c.phone && (numberOwners.get(normNum(c.phone)) || 0) > 1) c.phone = null;
    if (c.mobile && (numberOwners.get(normNum(c.mobile)) || 0) > 1) c.mobile = null;
  }

  // Fire-and-forget enrichment for any unenriched contacts. First call
  // for a brand returns the basic data fast; subsequent calls (within
  // ~minutes, on the same brand) hit the cache and surface signatures.
  // Capped at 20 per request to keep Graph quota in check.
  const toEnrich = contacts.filter((c) => !c.enriched).slice(0, 20).map((c) => c.email);
  if (toEnrich.length > 0) {
    enrichSignaturesForDomain(domain, toEnrich).catch((e: any) =>
      console.warn(`[archaeology] signature enrichment failed for ${domain}:`, e?.message),
    );
  }

  return { status: 200, body: {
    company: { id: companyId, name: company.name, domain },
    lookbackMonths: monthsBack,
    contacts,
    summary: {
      total: contacts.length,
      inCrm: contacts.filter((c) => c.inCrm).length,
      notInCrm: contacts.filter((c) => !c.inCrm).length,
      enriched: contacts.filter((c) => c.enriched).length,
      enrichmentQueued: toEnrich.length,
    },
  } };
}

router.get("/api/brand/:companyId/bgp-known-contacts", requireAuth, async (req: Request, res: Response) => {
  const monthsBack = Math.max(1, Math.min(60, parseInt(String(req.query.months || "24"), 10) || 24));
  const r = await computeBgpKnownContacts(String(req.params.companyId), monthsBack);
  res.status(r.status).json(r.body);
});

// ─── Name-based shortcuts ───────────────────────────────────────────────
// Both diagnostic endpoints are also addressable by company name (case-
// insensitive) so you don't have to grab UUIDs to run a quick test.
// Resolves the first exact match, then the first ILIKE match. Returns
// 404 only if nothing matched.

async function resolveCompanyIdByName(name: string): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { rows } = await pool.query<{ id: string }>(
    `SELECT id FROM crm_companies
      WHERE lower(name) = lower($1)
      LIMIT 1`,
    [trimmed],
  );
  if (rows[0]?.id) return rows[0].id;
  const { rows: fuzzy } = await pool.query<{ id: string }>(
    `SELECT id FROM crm_companies
      WHERE lower(name) LIKE lower($1)
      ORDER BY length(name) ASC
      LIMIT 1`,
    [`%${trimmed}%`],
  );
  return fuzzy[0]?.id || null;
}

// All three name-based shortcuts accept GET so you can paste the URL
// straight into a browser address bar — no curl or DevTools needed.
router.get("/api/admin/contacts-discovery-compare-by-name/:name", requireAuth, async (req: Request, res: Response) => {
  const id = await resolveCompanyIdByName(String(req.params.name || ""));
  if (!id) return res.status(404).json({ error: `No CRM company matched "${req.params.name}"` });
  await handleCompareForCompanyId(id, res);
});

router.post("/api/admin/contacts-discovery-compare-by-name/:name", requireAuth, async (req: Request, res: Response) => {
  const id = await resolveCompanyIdByName(String(req.params.name || ""));
  if (!id) return res.status(404).json({ error: `No CRM company matched "${req.params.name}"` });
  await handleCompareForCompanyId(id, res);
});

router.get("/api/brand/by-name/:name/bgp-known-contacts", requireAuth, async (req: Request, res: Response) => {
  const id = await resolveCompanyIdByName(String(req.params.name || ""));
  if (!id) return res.status(404).json({ error: `No CRM company matched "${req.params.name}"` });
  const monthsBack = Math.max(1, Math.min(60, parseInt(String(req.query.months || "24"), 10) || 24));
  const r = await computeBgpKnownContacts(id, monthsBack);
  res.status(r.status).json(r.body);
});

// ─── Cascade endpoint ───────────────────────────────────────────────────
// One call, unified contact list. Order of priority:
//   1. BGP email archaeology (real relationships we have on file)
//   2. RocketReach (covers the people we haven't emailed yet)
//   3. Apollo (fallback for landlords where RR is thin)
//
// Returns a merged, de-duplicated list with provenance per row so the
// UI shows "via BGP emails · 249 threads · Lucy" or "via RocketReach".
// Brand profile fires this on every load — completely automatic, no
// buttons. Apollo is only consulted for landlord-scope companies; for
// tenant brands the team turned it off (too noisy).

async function handleContactsCascade(companyId: string, res: Response, opts: { lookups: boolean; ai: boolean } = { lookups: true, ai: true }) {
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url, company_type FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const company = rows[0];
  if (!company) return res.status(404).json({ error: "Company not found" });

  const domain = cleanDomain(company.domain || company.domain_url);
  const ct = (company.company_type || "").toLowerCase();
  const scope: "tenant" | "landlord" = /landlord|freeholder|investor|developer|reit|fund|estate/.test(ct) ? "landlord" : "tenant";

  // Run BGP archaeology + RocketReach in parallel (Apollo only fires
  // when RR is thin AND we're in landlord scope).
  const [bgpRes, rrRes] = await Promise.all([
    (async () => {
      const r = await computeBgpKnownContacts(companyId, 24);
      return r.body?.contacts || [];
    })(),
    runRocketReachSearch(domain, company.name, scope).catch((e) => ({ ok: false, total: 0, sample: [], error: e?.message })),
  ]);

  // Build the unified contact list keyed by email (lowercased), with
  // BGP-sourced entries taking precedence (they carry signature data +
  // touch history). RR fills the gaps for people we haven't emailed.
  type Merged = {
    email: string | null;
    name: string;
    title: string | null;
    phone: string | null;
    mobile: string | null;
    linkedin: string | null;
    sources: string[];
    bgp?: {
      threadCount: number;
      lastEmailed: string;
      bgpSenders: string[];
      inCrm: boolean;
      crmContactId: string | null;
    };
    rocketreach?: { sample: boolean; id?: number | null; lookedUp?: boolean };
    emailValidity?: string | null;
    ai?: { confidence: number; verdict: string; reason: string } | null;
  };
  const byKey = new Map<string, Merged>();

  for (const c of bgpRes) {
    const key = (c.email || "").toLowerCase();
    if (!key) continue;
    byKey.set(key, {
      email: c.email,
      name: c.name,
      title: c.role || null,
      phone: c.phone || null,
      mobile: c.mobile || null,
      linkedin: c.linkedin || null,
      sources: ["bgp_email"],
      bgp: {
        threadCount: c.threadCount,
        lastEmailed: c.lastEmailed,
        bgpSenders: c.bgpSenders,
        inCrm: c.inCrm,
        crmContactId: c.crmContactId,
      },
    });
  }

  if (rrRes.ok) {
    for (const p of rrRes.sample) {
      // RR search responses often withhold emails (you pay per lookupProfile
      // to reveal them). Key by email when we have it, else fall back to
      // a normalised name so the row still merges/dedupes against BGP.
      const key = (p.email || "").toLowerCase() || `name:${(p.name || "").toLowerCase().trim()}`;
      if (key === "name:") continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.sources.push("rocketreach");
        existing.title = existing.title || p.title;
        existing.linkedin = existing.linkedin || (p as any).linkedin || null;
        existing.rocketreach = { sample: true, id: (p as any).id || null };
      } else {
        byKey.set(key, {
          email: p.email,
          name: p.name,
          title: p.title,
          phone: null,
          mobile: null,
          linkedin: (p as any).linkedin || null,
          sources: ["rocketreach"],
          rocketreach: { sample: true, id: (p as any).id || null },
        });
      }
    }
  }

  // Apollo fallback — only for landlords where BGP+RR didn't cover.
  let apolloRes: any = null;
  if (scope === "landlord" && byKey.size < 15) {
    apolloRes = await runApolloSearch(domain, company.name).catch((e) => ({ ok: false, total: 0, sample: [], error: e?.message }));
    if (apolloRes.ok) {
      for (const p of apolloRes.sample) {
        const key = (p.email || "").toLowerCase() || `name:${(p.name || "").toLowerCase().trim()}`;
        if (key === "name:") continue;
        const existing = byKey.get(key);
        if (existing) {
          existing.sources.push("apollo");
        } else {
          byKey.set(key, {
            email: p.email,
            name: p.name,
            title: p.title,
            phone: null,
            mobile: null,
            linkedin: null,
            sources: ["apollo"],
          });
        }
      }
    }
  }

  // Rank: BGP-touched first (sorted by threadCount), then RR/Apollo-only.
  const merged = Array.from(byKey.values()).sort((a, b) => {
    const aBgp = a.bgp?.threadCount ?? -1;
    const bBgp = b.bgp?.threadCount ?? -1;
    return bBgp - aBgp;
  });

  // ── RocketReach premium lookups — reveal real emails/phones for the top
  // provider-only candidates (BGP-touched rows already carry them). The
  // plan has unlimited premium lookups, so the only cost is latency:
  // capped at 5 per call.
  const rrKey = process.env.ROCKETREACH_API_KEY;
  if (rrKey && opts.lookups) {
    const targets = merged.filter((m) => !m.bgp && !m.email && m.rocketreach?.id).slice(0, 5);
    for (const t of targets) {
      try {
        const r = await fetch(`https://api.rocketreach.co/api/v2/person/lookup?id=${t.rocketreach!.id}`, {
          headers: { "Api-Key": rrKey }, signal: AbortSignal.timeout(20_000),
        });
        if (!r.ok) continue;
        const d: any = await r.json();
        const emails = Array.isArray(d.emails) ? d.emails : [];
        const pro = emails.find((e: any) => e.type === "professional" && e.smtp_valid === "valid")
          || emails.find((e: any) => e.smtp_valid === "valid");
        t.email = d.current_work_email || pro?.email || d.recommended_email || emails[0]?.email || null;
        t.emailValidity = pro?.smtp_valid || emails[0]?.smtp_valid || null;
        t.phone = t.phone || (Array.isArray(d.phones) ? d.phones[0]?.number : null) || null;
        t.linkedin = t.linkedin || d.linkedin_url || null;
        t.title = t.title || d.current_title || null;
        t.rocketreach!.lookedUp = true;
      } catch { /* lookup is best-effort */ }
    }
  }

  // ── Apollo match enrichment — for the top candidates, confirm + enrich
  // via people/match (verified email/status, LinkedIn, seniority) and
  // capture the organisation's firmographics once (employees, revenue,
  // funding — Apollo-only data). Credit-consuming: capped at 5 per scan.
  let organizationIntel: any = null;
  if (process.env.APOLLO_API_KEY && opts.ai !== undefined) {
    const enrichTargets = merged.filter((m) => m.name && !m.name.includes("@")).slice(0, 5);
    for (const t of enrichTargets) {
      const person = await apolloMatchPerson({ name: t.name, email: t.email, companyName: company.name });
      if (!person) continue;
      t.email = t.email || person.email || null;
      t.linkedin = t.linkedin || person.linkedin_url || null;
      t.title = t.title || person.title || null;
      (t as any).seniority = person.seniority || null;
      (t as any).emailStatus = person.email_status || null;
      if (!t.sources.includes("apollo")) t.sources.push("apollo");
      if (!organizationIntel && person.organization) {
        const o = person.organization;
        organizationIntel = {
          name: o.name, employees: o.estimated_num_employees ?? null,
          revenue: o.annual_revenue_printed ?? null, industry: o.industry ?? null,
          founded: o.founded_year ?? null, funding: o.total_funding_printed ?? null,
          linkedin: o.linkedin_url ?? null,
        };
      }
    }
  }

  // ── AI judge — Fable reviews every candidate against the company:
  // right company (email domain vs brand domain), plausible current
  // title, useful to a leasing/property team, provider noise filtered.
  if (opts.ai && merged.length) {
    try {
      const { callClaude } = await import("./chatbgp");
      const judgeInput = merged.slice(0, 25).map((m, i) => ({
        i, name: m.name, title: m.title, email: m.email,
        sources: m.sources, bgpThreads: m.bgp?.threadCount || 0,
      }));
      const completion = await callClaude({
        model: "claude-fable-5",
        max_completion_tokens: 1800,
        messages: [
          {
            role: "system",
            content:
              "You judge CRM contact candidates for a UK commercial property agency. For each candidate decide: is this " +
              "plausibly a real, current person at the given company, and how useful are they to a leasing/acquisitions " +
              "conversation? Rules: an email at the company's own domain is strong evidence; bgpThreads > 0 means the agency " +
              "has genuinely corresponded with them (very strong — never drop). Free-mail or mismatched-domain emails without " +
              "bgpThreads are weak. Operational roles (chef, barista, store staff) are real but low-value for leasing: keep, " +
              "confidence <= 40. Senior property/expansion/finance/founder roles are high-value. Output STRICT JSON only: an " +
              "array [{\"i\":number,\"confidence\":0-100,\"verdict\":\"keep\"|\"drop\"|\"unsure\",\"reason\":\"one short sentence\"}]. No prose.",
          },
          {
            role: "user",
            content: `Company: ${company.name} (domain: ${domain || "unknown"}, type: ${company.company_type || "?"})\nCandidates:\n${JSON.stringify(judgeInput)}`,
          },
        ],
      });
      const text = completion.choices?.[0]?.message?.content || "";
      const js = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
      const verdicts = JSON.parse(js) as Array<{ i: number; confidence: number; verdict: string; reason: string }>;
      for (const v of verdicts) {
        if (merged[v.i]) merged[v.i].ai = { confidence: v.confidence, verdict: v.verdict, reason: v.reason };
      }
      // Re-rank: BGP relationships first (by touch volume), then AI confidence.
      merged.sort((a, b) => {
        const aBgp = a.bgp?.threadCount ?? -1;
        const bBgp = b.bgp?.threadCount ?? -1;
        if (aBgp !== bBgp) return bBgp - aBgp;
        return (b.ai?.confidence ?? 0) - (a.ai?.confidence ?? 0);
      });
    } catch (e: any) {
      console.warn("[cascade] AI judge failed:", e?.message);
    }
  }

  return res.json({
    company: { id: companyId, name: company.name, domain, companyType: company.company_type, scope },
    contacts: merged,
    organizationIntel,
    sources: {
      bgp_email: { total: bgpRes.length },
      rocketreach: rrRes.ok ? { total: rrRes.total, sampleCount: rrRes.sample.length } : { ok: false, error: rrRes.error },
      apollo: apolloRes ? (apolloRes.ok ? { total: apolloRes.total, sampleCount: apolloRes.sample.length } : { ok: false, error: apolloRes.error }) : { skipped: true, reason: scope === "landlord" ? "BGP+RR coverage sufficient" : "apollo disabled for tenant scope" },
    },
    summary: {
      total: merged.length,
      bgpTouched: merged.filter((m) => !!m.bgp).length,
      rocketreachOnly: merged.filter((m) => m.sources.includes("rocketreach") && !m.bgp).length,
      apolloOnly: merged.filter((m) => m.sources.includes("apollo") && !m.bgp).length,
      revealed: merged.filter((m) => m.rocketreach?.lookedUp).length,
      apolloEnriched: merged.filter((m) => (m as any).seniority || (m as any).emailStatus).length,
      aiJudged: merged.filter((m) => !!m.ai).length,
    },
  });
}

router.get("/api/brand/:companyId/contacts-cascade", requireAuth, async (req: Request, res: Response) => {
  await handleContactsCascade(String(req.params.companyId), res, {
    lookups: req.query.lookups !== "0",
    ai: req.query.ai !== "0",
  });
});

router.get("/api/brand/by-name/:name/contacts-cascade", requireAuth, async (req: Request, res: Response) => {
  const id = await resolveCompanyIdByName(String(req.params.name || ""));
  if (!id) return res.status(404).json({ error: `No CRM company matched "${req.params.name}"` });
  await handleContactsCascade(id, res);
});

// Diagnostic — show how many signatures are cached for a domain, plus
// the most recent 10 raw rows. Lets us see whether the enrichment job
// is actually firing (look for the console.log lines in Railway too).
router.get("/api/admin/email-signatures/by-domain/:domain", requireAuth, async (req: Request, res: Response) => {
  const dom = cleanDomain(String(req.params.domain || ""));
  if (!dom) return res.status(400).json({ error: "domain required" });
  const { rows } = await pool.query(
    `SELECT email, full_name, title, phone, mobile, linkedin,
            to_char(last_seen_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS last_seen_at,
            to_char(enriched_at,  'YYYY-MM-DD"T"HH24:MI:SS') AS enriched_at
       FROM email_signatures
      WHERE lower(email) LIKE $1
      ORDER BY enriched_at DESC
      LIMIT 50`,
    [`%@${dom}`],
  );
  res.json({ domain: dom, count: rows.length, signatures: rows });
});

// Single-email synchronous test. Runs the full pipeline (find BGP user
// who corresponds with this address → Graph fetch → signature isolation
// → Haiku extract → cache write) and returns the entire trace so we can
// see exactly where it fails for a given contact.
router.get("/api/admin/email-signatures/debug/:email", requireAuth, async (req: Request, res: Response) => {
  const email = String(req.params.email || "").trim().toLowerCase();
  if (!email || !email.includes("@")) return res.status(400).json({ error: "valid email required" });
  // Build marker so we can verify in the response that the latest deploy
  // is live. Bump this string when shipping new debug-endpoint logic.
  const trace: any = { email, build: "2026-06-01.signature-isolation.v3", steps: [] };

  try {
    // Step 1: which BGP users have corresponded with this address?
    const { rows: bgpUsers } = await pool.query<{ bgp_user: string; n: string }>(
      `SELECT bgp_user, COUNT(*)::text AS n
         FROM crm_interactions
        WHERE bgp_user IS NOT NULL
          AND participants IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(participants) AS p(addr)
            WHERE lower(addr) = $1
          )
        GROUP BY bgp_user
        ORDER BY COUNT(*) DESC
        LIMIT 4`,
      [email],
    );
    trace.steps.push({ step: "bgp_user_lookup", candidates: bgpUsers });

    // Step 2: Graph fetch — try each candidate mailbox.
    const { graphRequest } = await import("./shared-mailbox");
    let foundMsg: any = null;
    let foundMailbox: string | null = null;
    const calendarRe = /^(accepted|declined|tentative|cancelled|updated|fw:\s*(accepted|declined)|re:\s*(accepted|declined)):/i;
    const teamsBodyRe = /microsoft teams meeting|join the meeting|dial in by phone|phone conference id|find a local number/i;

    for (const u of bgpUsers) {
      try {
        // $search="from:<addr>" instead of $filter+$orderby — Graph
        // rejects the latter combination as InefficientFilter.
        // Pull 25 so we can skip meeting invites + auto-replies.
        const url = `/users/${encodeURIComponent(u.bgp_user)}/messages?$top=25&$search="from:${encodeURIComponent(email)}"&$select=id,body,receivedDateTime,subject,from`;
        const data = await graphRequest(url);
        const msgs = (data?.value || []) as any[];
        const personal = msgs
          .filter((m: any) => (m.from?.emailAddress?.address || "").toLowerCase() === email.toLowerCase())
          .filter((m: any) => !calendarRe.test(m.subject || ""))
          .filter((m: any) => !teamsBodyRe.test(String(m.body?.content || "").slice(0, 2000)))
          .filter((m: any) => String(m.body?.content || "").length > 300)
          .sort((a: any, b: any) => Date.parse(b.receivedDateTime || 0) - Date.parse(a.receivedDateTime || 0));
        const msg = personal[0];
        trace.steps.push({
          step: "graph_fetch",
          mailbox: u.bgp_user,
          found: !!msg,
          subject: msg?.subject || null,
          totalReturned: msgs.length,
          afterFilter: personal.length,
        });
        if (msg) { foundMsg = msg; foundMailbox = u.bgp_user; break; }
      } catch (e: any) {
        trace.steps.push({ step: "graph_fetch", mailbox: u.bgp_user, error: e?.message });
      }
    }
    if (!foundMsg) {
      trace.outcome = "no_inbound_found";
      return res.json(trace);
    }

    // Step 3: isolate signature block — uses the same heuristic as the
    // production enrichSignaturesForDomain so debug results mirror prod.
    const { isolateSignatureText } = await import("./email-signature-enrich");
    const sigText = isolateSignatureText(foundMsg.body?.content || "");
    trace.steps.push({ step: "isolate_signature", sigLen: sigText.length, sample: sigText.slice(0, 400) });

    // Step 4: Haiku extract.
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      trace.outcome = "no_anthropic_key";
      return res.json(trace);
    }
    const client = new Anthropic({ apiKey: key });
    const resp = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      temperature: 0,
      system:
        `You extract contact details from email signature blocks. Output ONLY a JSON object with these keys: ` +
        `fullName (string or null), title (string or null), phone (string or null), mobile (string or null), ` +
        `address (string or null), linkedin (URL or null). No prose, no markdown.`,
      messages: [{ role: "user", content: `Email: ${email}\n\nSignature:\n${sigText}` }],
    });
    const text = resp.content?.[0]?.type === "text" ? resp.content[0].text : "";
    trace.steps.push({ step: "haiku_extract", rawResponse: text });

    const js = text.indexOf("{");
    const je = text.lastIndexOf("}");
    if (js < 0 || je <= js) {
      trace.outcome = "haiku_response_not_json";
      return res.json(trace);
    }
    const parsed = JSON.parse(text.slice(js, je + 1));
    trace.parsed = parsed;

    // Step 5: write to cache.
    await pool.query(
      `INSERT INTO email_signatures (email, full_name, title, phone, mobile, address, linkedin, last_seen_at, enriched_at, raw_signature, source_message_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now(), $9, $10)
       ON CONFLICT (email) DO UPDATE
         SET full_name = EXCLUDED.full_name, title = EXCLUDED.title,
             phone = EXCLUDED.phone, mobile = EXCLUDED.mobile,
             address = EXCLUDED.address, linkedin = EXCLUDED.linkedin,
             last_seen_at = EXCLUDED.last_seen_at, enriched_at = now(),
             raw_signature = EXCLUDED.raw_signature, source_message_id = EXCLUDED.source_message_id`,
      [email, parsed.fullName || null, parsed.title || null, parsed.phone || null, parsed.mobile || null, parsed.address || null, parsed.linkedin || null, foundMsg.receivedDateTime, sigText, foundMsg.id],
    );
    trace.outcome = "cached";
    return res.json(trace);
  } catch (e: any) {
    trace.outcome = "error";
    trace.error = e?.message || String(e);
    trace.stack = e?.stack;
    return res.status(500).json(trace);
  }
});

export default router;
