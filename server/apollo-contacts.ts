// ─────────────────────────────────────────────────────────────────────────
// Apollo contact discovery for a brand/company.
//
// Uses Apollo's /mixed_people/api_search endpoint to find key people (C-suite,
// Founders, Property/Real Estate heads, Marketing leads) associated with a
// crm_companies row, then upserts them into crm_contacts.
//
// Exposed as:
//   POST /api/brand/:companyId/apollo/discover  → returns preview
//   POST /api/brand/:companyId/apollo/import    → upserts into crm_contacts
//
// Cascade: domain → name → parent group (if < 3 results)
// ─────────────────────────────────────────────────────────────────────────
import { Router, type Request, type Response } from "express";
import { requireAuth } from "./auth";
import { pool } from "./db";

const router = Router();

// Tight filter — only C-suite and property/acquisitions decision makers.
// Anything else (marketing, retail ops, country GMs) bloats the import list.
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
  "vp real estate", "vice president real estate", "vp property",
  "director of real estate", "director of property",
];

// Belt-and-braces post-filter — Apollo's title query is fuzzy and can leak
// adjacent roles (head of marketing, retail manager). Drop anything whose
// title doesn't actually look C-suite or property.
function isRelevantTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  const t = title.toLowerCase();
  const cSuite = /\b(founder|ceo|chief executive|coo|chief operating|cfo|chief financial|cmo|chief marketing|managing director|md)\b/.test(t);
  const property = /(property|real estate|acquisition|expansion|portfolio|site|estates)/.test(t);
  return cSuite || property;
}

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

interface DiscoveredPerson {
  apollo_id: string;
  name: string;
  role: string | null;
  email: string | null;
  linkedin_url: string | null;
  avatar_url: string | null;
  location: string | null;
  source: "direct" | "name_search" | "parent_group";
  source_company_name?: string;
}

async function searchApollo(opts: {
  domains?: string[];
  organizationName?: string;
  locations?: string[];
  apolloKey: string;
}): Promise<ApolloPerson[]> {
  const body: Record<string, any> = {
    page: 1,
    per_page: 25,
    person_titles: ROLE_TITLES,
  };
  if (opts.domains && opts.domains.length > 0) body.q_organization_domains_list = opts.domains;
  else if (opts.organizationName) body.organization_names = [opts.organizationName];
  if (opts.locations && opts.locations.length > 0) body.person_locations = opts.locations;

  const res = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
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

function cleanDomain(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const cleaned = String(raw)
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/^www\./, "")
    .toLowerCase()
    .trim();
  return cleaned || undefined;
}

function extractDomain(company: any): string | undefined {
  return cleanDomain(company?.domain || company?.domain_url);
}

// Build the full candidate-domains list for an Apollo search. Apollo's
// `q_organization_domains_list` accepts multiple values, so a single call
// can match the brand's global TLD AND any UK localisation. Without this,
// brands like Supreme (single-domain on .com but UK staff) miss entirely
// because Apollo's UK contacts are tagged to a different domain than the
// .com that we have stored.
function candidateDomainsFor(company: any): string[] {
  const seen = new Set<string>();
  const add = (d: string | null | undefined) => {
    const cleaned = cleanDomain(d);
    if (cleaned) seen.add(cleaned);
  };
  add(company?.domain);
  add(company?.domain_url);

  const primary = cleanDomain(company?.domain || company?.domain_url);
  if (primary) {
    // Strip the TLD and add common UK-localised variants.
    const parts = primary.split(".");
    if (parts.length >= 2) {
      const sld = parts.slice(0, -1).join(".");
      const tld = parts[parts.length - 1];
      const baseSecondLevel = parts.length === 2 ? parts[0] : parts.slice(0, -2).join(".");
      if (tld === "com") {
        add(`${baseSecondLevel}.co.uk`);
        add(`${baseSecondLevel}.uk`);
      }
      if (tld !== "uk" && tld !== "co.uk" && parts.length === 2) {
        add(`${parts[0]}.co.uk`);
      }
      // SLD-prefixed UK variant (e.g. supremenewyork.com → supremenewyorkuk.com)
      // is too specific to be worth guessing — leave it.
      // Subdomain-based UK split (uk.brand.com / brand.com/uk) — Apollo
      // doesn't see these as separate domains, so don't bother.
      // Keep stripping a leading "shop." or "store." common on retail SPAs.
      if (sld.startsWith("shop.") || sld.startsWith("store.")) {
        const stripped = sld.replace(/^(shop|store)\./, "");
        add(`${stripped}.${tld}`);
      }
    }
  }
  return Array.from(seen);
}

function mapPerson(p: ApolloPerson, source: DiscoveredPerson["source"], sourceCompanyName?: string): DiscoveredPerson {
  return {
    apollo_id: p.id,
    name: p.name || `${p.first_name || ""} ${p.last_name || ""}`.trim(),
    role: p.title || null,
    email: p.email || null,
    linkedin_url: p.linkedin_url || null,
    avatar_url: p.photo_url || null,
    location: [p.city, p.country].filter(Boolean).join(", ") || null,
    source,
    source_company_name: sourceCompanyName,
  };
}

async function fetchCompany(companyId: string) {
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url, brand_group_id, parent_company_id, backers, uk_entity_name FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  return rows[0] || null;
}

async function fetchParentCompany(company: any) {
  // Try brand_group_id first, then parent_company_id
  const parentId = company.brand_group_id || company.parent_company_id;
  if (!parentId) return null;
  const { rows } = await pool.query(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [parentId]
  );
  return rows[0] || null;
}

router.post("/api/brand/:companyId/apollo/discover", requireAuth, async (req: Request, res: Response) => {
  try {
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) return res.status(400).json({ error: "APOLLO_API_KEY not configured" });
    const company = await fetchCompany(String(req.params.companyId));
    if (!company) return res.status(404).json({ error: "Company not found" });

    const seenIds = new Set<string>();
    const people: DiscoveredPerson[] = [];
    const diagnostics: { step: string; matched: number; details?: string }[] = [];

    // 1. Primary: every plausible brand domain, UK contacts only.
    // The UK filter stops US/international staff leaking in when a brand uses
    // a .com domain shared with its American operation.
    const brandDomains = candidateDomainsFor(company);
    if (brandDomains.length > 0) {
      try {
        const byDomain = await searchApollo({ domains: brandDomains, locations: ["United Kingdom"], apolloKey });
        for (const p of byDomain) {
          if (!seenIds.has(p.id) && isRelevantTitle(p.title)) {
            seenIds.add(p.id);
            people.push(mapPerson(p, "direct"));
          }
        }
        diagnostics.push({ step: "brand_domains_uk", matched: byDomain.length, details: brandDomains.join(", ") });
      } catch (err: any) {
        diagnostics.push({ step: "brand_domains_uk", matched: 0, details: `error: ${err.message}` });
      }
    }

    // 2. If < 3 results, search Apollo by organisation name with a UK
    // location filter. This catches brands whose UK staff are tagged on a
    // domain Apollo holds but we don't know about (e.g. franchise operator
    // domain). Country filter avoids picking up unrelated "Supreme Pizza"
    // employees.
    if (people.length < 3) {
      try {
        const byName = await searchApollo({
          organizationName: company.name,
          locations: ["United Kingdom"],
          apolloKey,
        });
        for (const p of byName) {
          if (!seenIds.has(p.id) && isRelevantTitle(p.title)) {
            seenIds.add(p.id);
            people.push(mapPerson(p, "name_search"));
          }
        }
        diagnostics.push({ step: "name_uk", matched: byName.length, details: `name="${company.name}" location=United Kingdom` });
      } catch (err: any) {
        diagnostics.push({ step: "name_uk", matched: 0, details: `error: ${err.message}` });
      }
    }

    // 3. If still < 3, broaden to organisation name without location filter.
    if (people.length < 3) {
      try {
        const byName = await searchApollo({ organizationName: company.name, apolloKey });
        for (const p of byName) {
          if (!seenIds.has(p.id) && isRelevantTitle(p.title)) {
            seenIds.add(p.id);
            people.push(mapPerson(p, "name_search"));
          }
        }
        diagnostics.push({ step: "name_global", matched: byName.length });
      } catch (err: any) {
        diagnostics.push({ step: "name_global", matched: 0, details: `error: ${err.message}` });
      }
    }

    // 4. Always cascade to parent group when one exists — for sub-brands
    // (& Other Stories, COS, Arket, Monki, Weekday under H&M Group; Cos by
    // Inditex; etc.) the lease/property/store-dev decisions are made at the
    // group level. Brand-level Apollo hits tend to be store managers and
    // junior staff; the parent has the people who actually sign leases.
    // Tagged "via [parent]" in the source field so users see the route.
    let parentCompany: any = null;
    if (company.brand_group_id || company.parent_company_id) {
      parentCompany = await fetchParentCompany(company);
      if (parentCompany) {
        try {
          const parentDomains = candidateDomainsFor(parentCompany);
          const byParent = await searchApollo({
            domains: parentDomains.length > 0 ? parentDomains : undefined,
            organizationName: parentDomains.length > 0 ? undefined : parentCompany.name,
            locations: ["United Kingdom"],
            apolloKey,
          });
          for (const p of byParent) {
            if (!seenIds.has(p.id) && isRelevantTitle(p.title)) {
              seenIds.add(p.id);
              people.push(mapPerson(p, "parent_group", parentCompany.name));
            }
          }
          diagnostics.push({ step: "parent_group", matched: byParent.length, details: parentDomains.join(", ") || parentCompany.name });
        } catch (err: any) {
          diagnostics.push({ step: "parent_group", matched: 0, details: `error: ${err.message}` });
        }
      }
    }

    // 5. If still < 3 and no linked parent company, cascade through parent-name
    // variants. Apollo can be picky about how a parent group is registered
    // (e.g. H&M staff might appear under "H&M", "H & M", "Hennes & Mauritz",
    // or "H&M Group"). We try the most likely variants until one returns hits.
    if (people.length < 3 && !parentCompany) {
      const variants = new Set<string>();
      const add = (v: string | null | undefined) => {
        if (!v) return;
        const trimmed = v.trim();
        if (trimmed && trimmed.toLowerCase() !== company.name.toLowerCase()) variants.add(trimmed);
      };

      // Primary: explicit backers text
      add(company.backers);
      // Backers can be a comma-list — try each
      if (company.backers) {
        for (const part of company.backers.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)) add(part);
      }
      // Derive from uk_entity_name first 1-2 tokens (e.g. "H&M Hennes & Mauritz UK Ltd" → "H&M" + "H&M Hennes")
      if (company.uk_entity_name) {
        const tokens = company.uk_entity_name.replace(/\b(UK|Ltd|Limited|PLC|LLP|Holdings|Group)\b/gi, "").trim().split(/\s+/);
        if (tokens.length >= 1) add(tokens[0]);
        if (tokens.length >= 2) add(tokens.slice(0, 2).join(" "));
        if (tokens.length >= 3) add(tokens.slice(0, 3).join(" "));
      }

      // For each variant, also try common ampersand spellings
      const expanded = new Set<string>();
      for (const v of variants) {
        expanded.add(v);
        if (v.includes("&")) {
          expanded.add(v.replace(/&/g, " & "));   // "H&M" → "H & M"
          expanded.add(v.replace(/&/g, "and"));    // "H&M" → "Hand M" (rare but harmless)
        }
        // Drop the trailing " Group" if present, and add a "Group" variant if not
        if (/\bGroup\b/i.test(v)) expanded.add(v.replace(/\s*Group\s*$/i, "").trim());
        else expanded.add(`${v} Group`);
      }

      let totalMatched = 0;
      const tried: string[] = [];
      for (const variant of expanded) {
        if (people.length >= 5) break;  // enough hits
        if (tried.includes(variant.toLowerCase())) continue;
        tried.push(variant.toLowerCase());
        try {
          const byVariant = await searchApollo({ organizationName: variant, locations: ["United Kingdom"], apolloKey });
          let added = 0;
          for (const p of byVariant) {
            if (!seenIds.has(p.id) && isRelevantTitle(p.title)) {
              seenIds.add(p.id);
              people.push(mapPerson(p, "parent_group", variant));
              added++;
            }
          }
          totalMatched += added;
          if (added > 0) {
            diagnostics.push({ step: "backers_fallback", matched: added, details: `variant="${variant}" location=UK` });
          }
        } catch (err: any) {
          diagnostics.push({ step: "backers_fallback", matched: 0, details: `variant="${variant}" error: ${err.message}` });
        }
      }
      if (totalMatched === 0 && tried.length > 0) {
        diagnostics.push({ step: "backers_fallback_summary", matched: 0, details: `tried ${tried.length} variants: ${tried.slice(0, 5).join(", ")}` });
      }
    }

    // Filter out people already stored under this company (by email or LinkedIn)
    const existing = await pool.query(
      `SELECT email, linkedin_url FROM crm_contacts WHERE company_id = $1`,
      [company.id]
    );
    const existingEmails = new Set(existing.rows.map((r: any) => (r.email || "").toLowerCase()).filter(Boolean));
    const existingLinkedIn = new Set(existing.rows.map((r: any) => (r.linkedin_url || "").toLowerCase()).filter(Boolean));

    const fresh = people
      .filter(p => p.name)
      .filter(p => !(p.email && existingEmails.has(p.email.toLowerCase())))
      .filter(p => !(p.linkedin_url && existingLinkedIn.has(p.linkedin_url.toLowerCase())));

    res.json({
      company: { id: company.id, name: company.name, domain: extractDomain(company), triedDomains: brandDomains },
      parentCompany: parentCompany ? { id: parentCompany.id, name: parentCompany.name } : null,
      people: fresh,
      diagnostics,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Per-officer Apollo enrichment ──────────────────────────────────────
// Look up a single CH officer by name within the brand's organisation and
// return any Apollo match (email, LinkedIn, current title, photo).
//
// Manual button per officer in the UK & Covenant tab → 1 Apollo credit per click.
router.post("/api/brand/:companyId/apollo/find-officer", requireAuth, async (req: Request, res: Response) => {
  try {
    const apolloKey = process.env.APOLLO_API_KEY;
    if (!apolloKey) return res.status(503).json({ error: "Apollo not configured" });

    const companyId = String(req.params.companyId);
    const personName: string = String(req.body?.name || "").trim();
    if (!personName) return res.status(400).json({ error: "name required" });

    const company = await fetchCompany(companyId);
    if (!company) return res.status(404).json({ error: "Company not found" });

    const parts = personName.split(/\s+/).filter(Boolean);
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";

    // Prefer domain match for accuracy; fall back to organisation name
    const cleanedDomain = cleanDomain(company.domain || company.domain_url);

    const body: Record<string, any> = {
      page: 1,
      per_page: 5,
    };
    if (firstName) body.q_keywords = personName;
    if (cleanedDomain) body.q_organization_domains_list = [cleanedDomain];
    else body.organization_names = [company.name];

    const res2 = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloKey },
      body: JSON.stringify(body),
    });
    if (!res2.ok) {
      const t = await res2.text().catch(() => "");
      return res.status(502).json({ error: `Apollo ${res2.status}: ${t.slice(0, 200)}` });
    }
    const data = (await res2.json()) as any;
    const people = (data.people || data.contacts || []) as ApolloPerson[];

    // Score: name match against first+last
    const scored = people.map(p => {
      const fullName = (p.name || `${p.first_name || ""} ${p.last_name || ""}`).toLowerCase().trim();
      const target = personName.toLowerCase();
      let score = 0;
      if (fullName === target) score = 100;
      else if (firstName && lastName && fullName.includes(firstName.toLowerCase()) && fullName.includes(lastName.toLowerCase())) score = 80;
      else if (firstName && fullName.includes(firstName.toLowerCase())) score = 30;
      return { p, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);

    const best = scored[0]?.p;
    if (!best) return res.json({ match: null });

    res.json({
      match: {
        apollo_id: best.id,
        name: best.name || `${best.first_name || ""} ${best.last_name || ""}`.trim(),
        title: best.title || null,
        email: best.email || null,
        linkedin_url: best.linkedin_url || null,
        avatar_url: best.photo_url || null,
        location: [best.city, best.country].filter(Boolean).join(", ") || null,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/brand/:companyId/apollo/import", requireAuth, async (req: Request, res: Response) => {
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
      // Tag role with source note if from parent group
      const roleNote = p.source === "parent_group" && p.source_company_name
        ? `${p.role || "Contact"} [via ${p.source_company_name}]`
        : (p.role || null);
      await pool.query(
        `INSERT INTO crm_contacts (name, role, email, linkedin_url, avatar_url, company_id, company_name, enrichment_source, last_enriched_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'apollo-search', now())`,
        [p.name, roleNote, p.email || null, p.linkedin_url || null, p.avatar_url || null, companyId, company.name]
      );
      inserted++;
    }

    res.json({ inserted, requested: people.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
