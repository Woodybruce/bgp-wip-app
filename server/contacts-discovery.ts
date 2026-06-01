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

const router = Router();

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
      name: p.name || [p.first_name, p.last_name].filter(Boolean).join(" "),
      title: p.current_title || null,
      seniority: null,
      email: p.recommended_professional_email || (p.emails?.[0]?.email) || null,
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
  // CRM data is messy — some rows have "hammerson.com - https:" or
  // "https://www.foo.co.uk/contact/" in the domain field. Strip
  // protocol, paths, www., trailing junk after a space, hyphen-suffixes.
  const cleanDomain = (raw: string | null | undefined): string | null => {
    if (!raw) return null;
    const stripped = String(raw)
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .split(/[\s/?#]/)[0]
      .replace(/[^a-z0-9.\-]+$/, "");
    return stripped || null;
  };
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

async function handleBgpKnownContactsForCompanyId(companyId: string, monthsBack: number, res: Response) {

  const { rows: companyRows } = await pool.query(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [companyId],
  );
  const company = companyRows[0];
  if (!company) return res.status(404).json({ error: "Company not found" });

  const domain = (company.domain || company.domain_url || "")
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase();
  if (!domain) {
    return res.json({ company: { id: companyId, name: company.name }, contacts: [], note: "Company has no domain — set one to enable BGP email archaeology." });
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
    return res.json({ company: { id: companyId, name: company.name, domain }, contacts: [], lookbackMonths: monthsBack });
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

  const contacts = Array.from(byEmail.values())
    .sort((a, b) => b.threadCount - a.threadCount || (b.lastEmailed > a.lastEmailed ? 1 : -1))
    .map((agg) => {
      const existing = inCrmByEmail.get(agg.email);
      return {
        email: agg.email,
        name: existing?.name || guessNameFromEmail(agg.email),
        role: existing?.role || null,
        lastEmailed: agg.lastEmailed,
        threadCount: agg.threadCount,
        bgpSenders: Array.from(agg.bgpSenders),
        lastSubject: agg.lastSubject,
        inCrm: !!existing,
        crmContactId: existing?.id || null,
        crmContactCompanyId: existing?.company_id || null,
      };
    });

  return res.json({
    company: { id: companyId, name: company.name, domain },
    lookbackMonths: monthsBack,
    contacts,
    summary: {
      total: contacts.length,
      inCrm: contacts.filter((c) => c.inCrm).length,
      notInCrm: contacts.filter((c) => !c.inCrm).length,
    },
  });
}

router.get("/api/brand/:companyId/bgp-known-contacts", requireAuth, async (req: Request, res: Response) => {
  const monthsBack = Math.max(1, Math.min(60, parseInt(String(req.query.months || "24"), 10) || 24));
  await handleBgpKnownContactsForCompanyId(String(req.params.companyId), monthsBack, res);
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
  await handleBgpKnownContactsForCompanyId(id, monthsBack, res);
});

export default router;
