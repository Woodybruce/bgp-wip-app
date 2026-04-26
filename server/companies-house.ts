import { Router } from "express";
import { requireAuth } from "./auth";

const router = Router();

const CH_API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const CH_BASE = "https://api.company-information.service.gov.uk";

export async function chFetch(path: string) {
  if (!CH_API_KEY) {
    throw new Error("Companies House API key not configured");
  }
  const res = await fetch(`${CH_BASE}${path}`, {
    headers: {
      Authorization: `Basic ${Buffer.from(CH_API_KEY + ":").toString("base64")}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Companies House API error ${res.status}: ${text}`);
  }
  return res.json();
}

type ChainPsc = {
  name: string;
  nationality?: string;
  controls?: string[];
  kind?: string;
};

export type ChainLink = {
  name: string;
  number: string;
  individualPscs: ChainPsc[];
  corporatePscs: ChainPsc[];
};

export type UboFinding = {
  name: string;
  nationality?: string;
  controls?: string[];
  foundAt: string;          // company name where this individual PSC sits
  foundAtNumber: string;    // its CH number
  depth: number;            // 0 = subject, 1 = direct parent, etc.
};

/**
 * Walk the corporate ownership chain and surface ALL individual Persons with
 * Significant Control encountered at every level — not just the chain of
 * companies. This is the fix for the "couldn't work out UBO" bug:
 * BGP Ltd → Thames Commercial Properties Ltd → (Thames's individual PSCs are
 * the joint UBOs of BGP Ltd). The previous walker returned `chain: [Thames]`
 * and stopped, hiding the actual humans.
 *
 * For each level we record both corporate AND individual PSCs, so the caller
 * (and downstream AI prompt) gets the full picture without needing a separate
 * fetch per chain entity.
 */
export async function discoverUltimateParent(companyNumber: string, maxDepth = 5): Promise<{
  chain: ChainLink[];
  ultimateParent: { name: string; number: string; } | null;
  ubos: UboFinding[];
}> {
  const chain: ChainLink[] = [];
  const ubos: UboFinding[] = [];
  const visited = new Set<string>();
  const seenUboNames = new Set<string>();
  let currentNumber = companyNumber;
  let currentName = "(subject)";

  // Walk one extra step beyond the corporate chain so we always inspect the
  // ultimate parent's PSCs even if no further corporate PSC exists above it.
  for (let depth = 0; depth <= maxDepth; depth++) {
    try {
      const paddedNum = currentNumber.padStart(8, "0");
      if (visited.has(paddedNum)) break;
      visited.add(paddedNum);

      const pscData = await chFetch(`/company/${paddedNum}/persons-with-significant-control`);
      const items = (pscData.items || []).filter((p: any) => !p.ceased_on && !p.ceased);
      const individualPscs: ChainPsc[] = items
        .filter((p: any) => p.kind === "individual-person-with-significant-control" || (p.kind && !p.kind.includes("corporate") && !p.kind.includes("legal-person")))
        .map((p: any) => ({ name: p.name, nationality: p.nationality, controls: p.natures_of_control, kind: p.kind }));
      const corporatePscs: ChainPsc[] = items
        .filter((p: any) => p.kind === "corporate-entity-person-with-significant-control")
        .map((p: any) => ({ name: p.name, controls: p.natures_of_control, kind: p.kind }));

      // Record individual PSCs found at this level as UBOs (skip the subject
      // itself at depth 0 — those are reported separately by the caller).
      if (depth > 0) {
        chain.push({ name: currentName, number: currentNumber, individualPscs, corporatePscs });
      }
      for (const ip of individualPscs) {
        if (!ip.name || seenUboNames.has(ip.name)) continue;
        seenUboNames.add(ip.name);
        ubos.push({
          name: ip.name,
          nationality: ip.nationality,
          controls: ip.controls,
          foundAt: depth === 0 ? "(subject)" : currentName,
          foundAtNumber: currentNumber,
          depth,
        });
      }

      if (corporatePscs.length === 0) break;

      // Continue up the chain via the largest-stake corporate PSC.
      const majorityOwner = items
        .filter((p: any) => p.kind === "corporate-entity-person-with-significant-control")
        .sort((a: any, b: any) => {
          const getWeight = (controls: string[]) => {
            if (!controls) return 0;
            if (controls.some((c: string) => c.includes("75-to-100"))) return 3;
            if (controls.some((c: string) => c.includes("50-to-75"))) return 2;
            if (controls.some((c: string) => c.includes("25-to-50"))) return 1;
            return 0;
          };
          return getWeight(b.natures_of_control) - getWeight(a.natures_of_control);
        })[0];

      const parentNumber = majorityOwner?.identification?.registration_number;
      const parentName = majorityOwner?.name;
      if (!parentNumber || !parentName) break;

      const paddedParent = parentNumber.padStart(8, "0");
      if (visited.has(paddedParent)) break;

      currentNumber = parentNumber;
      currentName = parentName;
    } catch {
      break;
    }
  }

  return {
    chain,
    ultimateParent: chain.length > 0 ? { name: chain[chain.length - 1].name, number: chain[chain.length - 1].number } : null,
    ubos,
  };
}

export async function identifyBrandParent(
  spvName: string,
  chain: Array<{ name: string; number: string }>,
  officers: any[]
): Promise<{ name: string; number: string } | null> {
  if (chain.length === 0 && officers.length === 0) return null;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });

    const chainStr = chain.map((c, i) => `${i + 1}. ${c.name} (${c.number})`).join("\n");
    const officerStr = officers
      .filter((o: any) => !o.resigned_on)
      .map((o: any) => `${o.name} (${o.officer_role})`)
      .join("\n");

    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 512,
      system: `You are a UK commercial property expert. Given an SPV (special purpose vehicle) company and its corporate ownership chain, identify the recognisable parent company or real estate brand that ultimately owns/controls this entity.

Common examples:
- "LS TOTTENHAM COURT ROAD LIMITED" → Landsec (Land Securities PLC)
- "BL HOLDINGS 1234 LIMITED" → British Land
- "GP HOLDINGS LIMITED" → Great Portland Estates
- "DL PROPERTY LIMITED" → Derwent London

Look at the PSC ownership chain first (most reliable). If no chain, look at officer names for clues (e.g. "LAND SECURITIES MANAGEMENT SERVICES LIMITED" as a director).

Respond ONLY with JSON: { "parentName": "<recognisable brand name>", "parentCompanyNumber": "<Companies House number>", "confidence": "high"|"medium"|"low", "reason": "<brief explanation>" }
If you cannot determine the parent, respond: { "parentName": null, "parentCompanyNumber": null, "confidence": "none", "reason": "<why>" }`,
      messages: [{
        role: "user",
        content: `SPV: ${spvName}\n\nOwnership chain (PSCs, from SPV upward):\n${chainStr || "None found"}\n\nActive officers:\n${officerStr || "None found"}`,
      }],
    });

    const text = res.content[0].type === "text" ? res.content[0].text : "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.parentName && parsed.confidence !== "none") {
        return { name: parsed.parentName, number: parsed.parentCompanyNumber || "" };
      }
    }
  } catch (err: any) {
    console.log(`[parent-discovery] AI identification error: ${err.message}`);
  }
  return null;
}

router.get("/api/companies-house/search", requireAuth, async (req, res) => {
  try {
    const q = req.query.q as string;
    if (!q || q.length < 2) {
      return res.json({ items: [] });
    }
    const data = await chFetch(`/search/companies?q=${encodeURIComponent(q)}&items_per_page=10`);
    const items = (data.items || []).map((item: any) => ({
      companyNumber: item.company_number,
      title: item.title,
      companyStatus: item.company_status,
      companyType: item.company_type,
      dateOfCreation: item.date_of_creation,
      addressSnippet: item.address_snippet,
      address: item.registered_office_address,
    }));
    res.json({ items });
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Companies House API key not configured. Add COMPANIES_HOUSE_API_KEY to your environment secrets." });
    }
    console.error("[companies-house] search error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/companies-house/company/:number", requireAuth, async (req, res) => {
  try {
    const data = await chFetch(`/company/${encodeURIComponent(req.params.number)}`);
    const profile = {
      companyNumber: data.company_number,
      companyName: data.company_name,
      companyStatus: data.company_status,
      companyType: data.type,
      dateOfCreation: data.date_of_creation,
      registeredOfficeAddress: data.registered_office_address,
      sicCodes: data.sic_codes,
      hasCharges: data.has_charges,
      hasInsolvencyHistory: data.has_insolvency_history,
      canFile: data.can_file,
      jurisdiction: data.jurisdiction,
      accountsOverdue: data.accounts?.overdue,
      confirmationStatementOverdue: data.confirmation_statement?.overdue,
      lastAccountsMadeUpTo: data.accounts?.last_accounts?.made_up_to,
    };
    res.json(profile);
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Companies House API key not configured." });
    }
    console.error("[companies-house] company error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/companies-house/officers/:number", requireAuth, async (req, res) => {
  try {
    const data = await chFetch(`/company/${encodeURIComponent(req.params.number)}/officers`);
    const officers = (data.items || []).map((o: any) => ({
      name: o.name,
      officerRole: o.officer_role,
      appointedOn: o.appointed_on,
      resignedOn: o.resigned_on,
      nationality: o.nationality,
      occupation: o.occupation,
    }));
    res.json({ officers });
  } catch (err: any) {
    console.error("[companies-house] officers error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/companies-house/pscs/:number", requireAuth, async (req, res) => {
  try {
    const data = await chFetch(`/company/${encodeURIComponent(req.params.number)}/persons-with-significant-control`);
    const pscs = (data.items || []).map((p: any) => ({
      name: p.name || (p.name_elements ? [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") : "Unknown"),
      kind: p.kind,
      naturesOfControl: p.natures_of_control || [],
      nationality: p.nationality,
      countryOfResidence: p.country_of_residence,
      notifiedOn: p.notified_on,
      ceasedOn: p.ceased_on,
      address: p.address,
      dateOfBirth: p.date_of_birth ? `${p.date_of_birth.month}/${p.date_of_birth.year}` : null,
    }));
    res.json({ pscs });
  } catch (err: any) {
    console.error("[companies-house] PSC error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/companies-house/filing-history/:number", requireAuth, async (req, res) => {
  try {
    const items = Math.min(Number(req.query.items) || 25, 100);
    const data = await chFetch(`/company/${encodeURIComponent(req.params.number)}/filing-history?items_per_page=${items}`);
    const filings = (data.items || []).map((f: any) => ({
      date: f.date,
      category: f.category,
      type: f.type,
      description: f.description,
      descriptionValues: f.description_values,
      // Pull the document_metadata id (last path segment) so the client can
      // stream the PDF via our proxy route below. CH returns a full URL like
      // https://frontend-doc-api.../document/zABCdef123 — we only need "zABCdef123".
      documentId: (() => {
        const m = f.links?.document_metadata;
        if (!m) return null;
        const parts = String(m).split("/").filter(Boolean);
        return parts[parts.length - 1] || null;
      })(),
    }));
    res.json({ filings, totalCount: data.total_count || 0 });
  } catch (err: any) {
    console.error("[companies-house] filing-history error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Proxy route: stream a filing document PDF from Companies House.
// Free API — just requires the CH key + document metadata ID (pulled from
// filing-history above). We first GET /document/{id} to resolve the actual
// PDF URL, then stream that back to the client. Adds 24h cache headers since
// filed documents are immutable once accepted.
router.get("/api/companies-house/document/:id", requireAuth, async (req, res) => {
  try {
    if (!CH_API_KEY) return res.status(503).json({ error: "Companies House API key not configured" });
    const id = req.params.id;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: "Invalid document id" });

    const auth = `Basic ${Buffer.from(CH_API_KEY + ":").toString("base64")}`;
    // CH document API lives on a different subdomain from the main API.
    const docRes = await fetch(`https://document-api.company-information.service.gov.uk/document/${encodeURIComponent(id)}/content`, {
      headers: { Authorization: auth, Accept: "application/pdf" },
      redirect: "follow",
    });
    if (!docRes.ok) {
      const text = await docRes.text().catch(() => "");
      return res.status(docRes.status).json({ error: `Companies House document fetch failed: ${docRes.status}`, details: text.slice(0, 200) });
    }
    const filename = req.query.filename ? String(req.query.filename).replace(/[^A-Za-z0-9._-]/g, "_") : `${id}.pdf`;
    res.setHeader("Content-Type", docRes.headers.get("content-type") || "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "private, max-age=86400");
    const buf = Buffer.from(await docRes.arrayBuffer());
    res.end(buf);
  } catch (err: any) {
    console.error("[companies-house] document proxy error:", err?.message || err);
    res.status(500).json({ error: err?.message || "Document fetch failed" });
  }
});

// ─── Core KYC logic — shared between the single-company route and batch runner ──
//
// `forceFromWebsite` (re-resolve button): ignore any stored CH number and
// re-derive it from the brand's website. Without this flag we still re-scrape
// when the website is present but only OVERWRITE an existing number when the
// website yields a different one — protects against single-page scraper hits
// while letting us correct historical wrong matches.
async function performAutoKyc(companyId: string, opts: { forceFromWebsite?: boolean } = {}): Promise<{
  success: boolean;
  kycStatus: string;
  profile?: any;
  officers?: any[];
  pscs?: any[];
  filings?: any[];
  filingsTotal?: number;
  companyNumber?: string | null;
  message?: string;
  resolvedFrom?: "stored" | "website" | "ai_picker" | "name_match";
}> {
  const { db } = await import("./db");
  const { crmCompanies } = await import("@shared/schema");
  const { eq } = await import("drizzle-orm");

  const [company] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, companyId)).limit(1);
  if (!company) throw new Error("Company not found");

  let chNumber = opts.forceFromWebsite ? null : company.companiesHouseNumber;
  let resolvedFrom: "stored" | "website" | "ai_picker" | "name_match" = "stored";

  const existingChData = company.companiesHouseData as any;
  const existingStatus = existingChData?.profile?.companyStatus;
  const isExistingDissolved = existingStatus && existingStatus !== "active";
  const domain = (company as any).domainUrl as string | null || (company as any).domain as string | null;

  // Always run the website-entity check when we have a domain. Even if a CH
  // number is already stored, we use the website as the source of truth — too
  // many wrong matches got cemented because the original lookup was a blind
  // CH name search. We still skip if there's no domain at all.
  if (!chNumber || isExistingDissolved || (opts.forceFromWebsite && domain)) {
    const storedEntityName = (company as any).ukEntityName as string | null;
    let searchName = storedEntityName || company.name;
    let websiteContext = "";

    if (domain) {
      try {
        const scraped = await scrapeUkEntityFromWebsite(domain);
        if (scraped.entityName) {
          searchName = scraped.entityName;
          if (!storedEntityName) {
            await db.update(crmCompanies).set({ ukEntityName: scraped.entityName } as any).where(eq(crmCompanies.id, company.id)).catch(() => {});
          }
          console.log(`[auto-kyc] Scraped UK entity from website: "${scraped.entityName}"`);
          websiteContext = `Website-derived legal entity name: ${scraped.entityName}`;
        }
        if (scraped.chNumber) {
          chNumber = scraped.chNumber;
          resolvedFrom = "website";
          console.log(`[auto-kyc] Website yielded CH number ${scraped.chNumber} for "${company.name}"`);
        }
        if (scraped.sourceUrl) {
          websiteContext += `\nSource: ${scraped.sourceUrl}`;
        }
      } catch { /* non-fatal */ }
    }

    if (!chNumber) {
      const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(searchName)}&items_per_page=10`);
      const items = searchData.items || [];
      if (items.length === 0) {
        return { success: false, kycStatus: "not_found", message: `No Companies House match found for "${searchName}".` };
      }
      const nameLower = searchName.toLowerCase().trim();
      const activeItems = items.filter((i: any) => i.company_status === "active");
      const candidatePool = activeItems.length > 0 ? activeItems : items;

      // Try Claude-based picker when there's a website to ground the choice
      // and there are multiple plausible candidates (more than one active
      // result, or no exact-name match). Falls back to the old nearest-name
      // heuristic if the AI call fails or isn't applicable.
      const exactNameHit = candidatePool.find((i: any) => i.title?.toLowerCase().trim() === nameLower);
      const needsAiPicker = !exactNameHit && candidatePool.length > 1 && (domain || websiteContext);
      let aiPicked: string | null = null;
      if (needsAiPicker) {
        try {
          aiPicked = await pickChCandidateWithAi({
            brandName: company.name,
            domain,
            websiteContext,
            candidates: candidatePool.slice(0, 8),
          });
        } catch (err: any) {
          console.warn(`[auto-kyc] AI picker failed for "${company.name}":`, err?.message);
        }
      }
      if (aiPicked) {
        chNumber = aiPicked;
        resolvedFrom = "ai_picker";
      } else {
        const bestMatch = exactNameHit
          || candidatePool.find((i: any) => i.title?.toLowerCase().includes(nameLower) || nameLower.includes(i.title?.toLowerCase()))
          || candidatePool[0];
        chNumber = bestMatch.company_number;
        resolvedFrom = "name_match";
      }
    }
  }

  const profileData = await chFetch(`/company/${encodeURIComponent(chNumber!)}`);
  const profile = {
    companyNumber: profileData.company_number,
    companyName: profileData.company_name,
    companyStatus: profileData.company_status,
    companyType: profileData.type,
    dateOfCreation: profileData.date_of_creation,
    registeredOfficeAddress: profileData.registered_office_address,
    sicCodes: profileData.sic_codes,
    hasCharges: profileData.has_charges,
    hasInsolvencyHistory: profileData.has_insolvency_history,
    canFile: profileData.can_file,
    jurisdiction: profileData.jurisdiction,
    accountsOverdue: profileData.accounts?.overdue,
    confirmationStatementOverdue: profileData.confirmation_statement?.overdue,
    lastAccountsMadeUpTo: profileData.accounts?.last_accounts?.made_up_to,
  };

  let officers: any[] = [];
  let pscs: any[] = [];
  let filings: any[] = [];
  let filingsTotal = 0;

  const [officerResult, pscResult, filingResult] = await Promise.allSettled([
    chFetch(`/company/${encodeURIComponent(chNumber!)}/officers`),
    chFetch(`/company/${encodeURIComponent(chNumber!)}/persons-with-significant-control`),
    chFetch(`/company/${encodeURIComponent(chNumber!)}/filing-history?items_per_page=10`),
  ]);

  if (officerResult.status === "fulfilled") {
    officers = (officerResult.value.items || []).map((o: any) => ({
      name: o.name,
      officerRole: o.officer_role,
      appointedOn: o.appointed_on,
      resignedOn: o.resigned_on,
      nationality: o.nationality,
      occupation: o.occupation,
      address: o.address,
      dateOfBirth: o.date_of_birth ? `${o.date_of_birth.month}/${o.date_of_birth.year}` : null,
    }));
  }

  if (pscResult.status === "fulfilled") {
    pscs = (pscResult.value.items || []).map((p: any) => ({
      name: p.name || (p.name_elements ? [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") : "Unknown"),
      kind: p.kind,
      naturesOfControl: p.natures_of_control || [],
      nationality: p.nationality,
      countryOfResidence: p.country_of_residence,
      notifiedOn: p.notified_on,
      ceasedOn: p.ceased_on,
      address: p.address,
      dateOfBirth: p.date_of_birth ? `${p.date_of_birth.month}/${p.date_of_birth.year}` : null,
    }));
  }

  if (filingResult.status === "fulfilled") {
    filings = (filingResult.value.items || []).map((f: any) => ({
      date: f.date,
      category: f.category,
      type: f.type,
      description: f.description,
    }));
    filingsTotal = filingResult.value.total_count || 0;
  }

  const kycStatus = profile.hasInsolvencyHistory
    ? "fail"
    : profile.companyStatus === "active" && !profile.accountsOverdue
      ? "pass"
      : "warning";

  const kycReport = {
    profile,
    officers,
    pscs,
    filings,
    filingsTotal,
    fetchStatus: {
      officers: officerResult.status === "fulfilled" ? "ok" : "failed",
      pscs: pscResult.status === "fulfilled" ? "ok" : "failed",
      filings: filingResult.status === "fulfilled" ? "ok" : "failed",
    },
    checkedAt: new Date().toISOString(),
  };

  await db.update(crmCompanies).set({
    companiesHouseNumber: chNumber,
    companiesHouseData: kycReport,
    companiesHouseOfficers: officers,
    kycStatus,
    kycCheckedAt: new Date(),
  }).where(eq(crmCompanies.id, company.id));

  console.log(`[companies-house] Auto-KYC for "${company.name}" → ${kycStatus} (CH: ${chNumber}, resolvedFrom: ${resolvedFrom})`);

  return {
    success: true,
    kycStatus,
    profile,
    officers: officers.filter(o => !o.resignedOn),
    pscs: pscs.filter(p => !p.ceasedOn),
    filings,
    filingsTotal,
    companyNumber: chNumber,
    resolvedFrom,
  };
}

// ─── Claude-based CH candidate picker ───────────────────────────────────
//
// Given a brand and a list of CH search hits, ask Claude which is most
// likely the operating UK entity for the brand. The website-scraping pass
// failed to extract a CH number directly (often the case for SPA-only sites
// like AllSaints), so we lean on the brand name + domain + any scraped
// boilerplate plus the candidate metadata (status, type, incorporation date,
// registered office) to pick.
//
// Returns the picked company_number as a string, or null if Claude refuses
// to pick (e.g. none look like a real match) or the call fails.
async function pickChCandidateWithAi(input: {
  brandName: string;
  domain: string | null;
  websiteContext: string;
  candidates: Array<{
    company_number: string;
    title: string;
    company_status?: string;
    date_of_creation?: string;
    address_snippet?: string;
    company_type?: string;
  }>;
}): Promise<string | null> {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({ apiKey });

  const candidatesBlock = input.candidates.map((c, i) =>
    `${i + 1}. ${c.title} (CH ${c.company_number})\n   Status: ${c.company_status || "?"}, Type: ${c.company_type || "?"}, Incorporated: ${c.date_of_creation || "?"}\n   Office: ${c.address_snippet || "?"}`
  ).join("\n\n");

  const prompt = `You are matching a UK retail brand to its operating Companies House entity.

Brand: ${input.brandName}
Brand website: ${input.domain || "(none)"}
${input.websiteContext ? input.websiteContext + "\n" : ""}
Candidates from Companies House:
${candidatesBlock}

Pick the candidate most likely to be the brand's UK trading/operating entity (or its UK holding company). Use these signals in order:
1. Exact match on the website-derived legal entity name (if given).
2. An "active" status, registered office in a real commercial location, incorporation old enough to plausibly run a multi-store retailer.
3. Reject candidates that look like dormant single-director Ltds at a residential address — those almost never run real high-street brands.

If none of the candidates plausibly match the brand, output null.

Reply with ONLY a JSON object on a single line, no prose, no code fence:
{"pick": "<company_number>" or null, "reason": "<one short sentence>"}`;

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{ role: "user", content: prompt }],
    });
    const txt = msg.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
    const match = txt.match(/\{[\s\S]*?\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const pick = parsed?.pick;
    if (!pick || typeof pick !== "string") return null;
    if (!input.candidates.some(c => c.company_number === pick)) return null;
    console.log(`[auto-kyc] AI picked CH ${pick} for "${input.brandName}" — ${parsed?.reason || "no reason given"}`);
    return pick;
  } catch (err: any) {
    console.warn(`[auto-kyc] Claude CH picker failed:`, err?.message);
    return null;
  }
}

// ─── Batch re-KYC — finds stale/dissolved companies and re-runs KYC on them ──
export async function runBatchReKyc({ limit = 40, forceAll = false }: { limit?: number; forceAll?: boolean } = {}) {
  const { db } = await import("./db");
  const { sql } = await import("drizzle-orm");

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const result = await db.execute(sql`
    SELECT id, name FROM crm_companies
    WHERE ${forceAll ? sql`TRUE` : sql`(
      kyc_checked_at IS NULL
      OR kyc_checked_at < ${thirtyDaysAgo.toISOString()}
      OR kyc_status IS NULL
      OR kyc_status != 'pass'
      OR (companies_house_data IS NOT NULL
          AND companies_house_data->'profile'->>'companyStatus' IS NOT NULL
          AND companies_house_data->'profile'->>'companyStatus' != 'active')
    )`}
    ORDER BY kyc_checked_at ASC NULLS FIRST
    LIMIT ${limit}
  `);

  const rows: any[] = (result as any).rows ?? result;
  console.log(`[batch-rekyc] Queued ${rows.length} companies for KYC refresh`);

  let success = 0, failed = 0;
  for (const row of rows) {
    try {
      await performAutoKyc(row.id);
      success++;
    } catch (err: any) {
      console.error(`[batch-rekyc] "${row.name}": ${err.message}`);
      failed++;
    }
    // Respect CH API rate limits (~600 req/min, we use ~3 req per company)
    await new Promise(r => setTimeout(r, 700));
  }

  console.log(`[batch-rekyc] Done: ${success} updated, ${failed} failed`);
  return { success, failed, total: rows.length };
}

router.post("/api/companies-house/auto-kyc/:companyId", requireAuth, async (req, res) => {
  try {
    // ?force=1 (or { forceFromWebsite: true }) clears any cached CH number and
    // re-derives from the website. Used by the "Re-resolve from website"
    // button on the brand panel when an existing match is wrong.
    const forceFromWebsite = req.query.force === "1" || req.body?.forceFromWebsite === true;
    const result = await performAutoKyc(req.params.companyId, { forceFromWebsite });
    if (!result.success && result.kycStatus === "not_found") {
      return res.json(result);
    }
    res.json(result);
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Companies House API key not configured. Add COMPANIES_HOUSE_API_KEY to your environment secrets." });
    }
    if (err.message === "Company not found") return res.status(404).json({ error: err.message });
    console.error("[companies-house] auto-kyc error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/companies-house/batch-rekyc", requireAuth, async (req, res) => {
  const { limit = 40, forceAll = false } = req.body || {};
  // Kick off in background and return immediately
  runBatchReKyc({ limit, forceAll }).catch(err =>
    console.error("[batch-rekyc] background run failed:", err.message)
  );
  res.json({ success: true, message: `Batch re-KYC started (limit: ${limit}, forceAll: ${forceAll})` });
});

router.post("/api/companies-house/property-kyc/:propertyId", requireAuth, async (req, res) => {
  try {
    const { db } = await import("./db");
    const { crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, req.params.propertyId)).limit(1);
    if (!property) {
      return res.status(404).json({ error: "Property not found" });
    }

    const proprietorName = req.body.proprietorName || property.proprietorName;
    const proprietorType = req.body.proprietorType || property.proprietorType || "company";
    const proprietorCompanyNumber = req.body.proprietorCompanyNumber || property.proprietorCompanyNumber;

    if (!proprietorName) {
      return res.status(400).json({ error: "No proprietor name set. Enter the registered proprietor from the Land Registry title first." });
    }

    let kycData: any = { checkedAt: new Date().toISOString(), proprietorName, proprietorType };
    let kycStatus = "not_found";

    if (proprietorType === "company") {
      let chNumber = proprietorCompanyNumber;

      if (!chNumber) {
        const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(proprietorName)}&items_per_page=5`);
        const items = searchData.items || [];
        if (items.length === 0) {
          await db.update(crmProperties).set({
            proprietorKycStatus: "not_found",
            proprietorKycData: { ...kycData, message: `No Companies House match found for "${proprietorName}".` },
          }).where(eq(crmProperties.id, property.id));

          return res.json({
            success: false,
            kycStatus: "not_found",
            message: `No Companies House match found for "${proprietorName}". Try entering the company number manually.`,
          });
        }
        const nameLower = proprietorName.toLowerCase().trim();
        const bestMatch = items.find((i: any) => i.title?.toLowerCase().trim() === nameLower)
          || items.find((i: any) => i.title?.toLowerCase().includes(nameLower) || nameLower.includes(i.title?.toLowerCase()))
          || items[0];
        chNumber = bestMatch.company_number;
      }

      const profileData = await chFetch(`/company/${encodeURIComponent(chNumber)}`);
      const profile = {
        companyNumber: profileData.company_number,
        companyName: profileData.company_name,
        companyStatus: profileData.company_status,
        companyType: profileData.type,
        dateOfCreation: profileData.date_of_creation,
        registeredOfficeAddress: profileData.registered_office_address,
        sicCodes: profileData.sic_codes,
        hasCharges: profileData.has_charges,
        hasInsolvencyHistory: profileData.has_insolvency_history,
        canFile: profileData.can_file,
        jurisdiction: profileData.jurisdiction,
        accountsOverdue: profileData.accounts?.overdue,
        confirmationStatementOverdue: profileData.confirmation_statement?.overdue,
        lastAccountsMadeUpTo: profileData.accounts?.last_accounts?.made_up_to,
      };

      let officers: any[] = [];
      let pscs: any[] = [];
      let filings: any[] = [];
      let filingsTotal = 0;

      const [officerResult, pscResult, filingResult] = await Promise.allSettled([
        chFetch(`/company/${encodeURIComponent(chNumber)}/officers`),
        chFetch(`/company/${encodeURIComponent(chNumber)}/persons-with-significant-control`),
        chFetch(`/company/${encodeURIComponent(chNumber)}/filing-history?items_per_page=10`),
      ]);

      if (officerResult.status === "fulfilled") {
        officers = (officerResult.value.items || []).map((o: any) => ({
          name: o.name, officerRole: o.officer_role, appointedOn: o.appointed_on,
          resignedOn: o.resigned_on, nationality: o.nationality, occupation: o.occupation,
          address: o.address, dateOfBirth: o.date_of_birth ? `${o.date_of_birth.month}/${o.date_of_birth.year}` : null,
        }));
      }

      if (pscResult.status === "fulfilled") {
        pscs = (pscResult.value.items || []).map((p: any) => ({
          name: p.name || (p.name_elements ? [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") : "Unknown"),
          kind: p.kind, naturesOfControl: p.natures_of_control || [],
          nationality: p.nationality, countryOfResidence: p.country_of_residence,
          notifiedOn: p.notified_on, ceasedOn: p.ceased_on, address: p.address,
          dateOfBirth: p.date_of_birth ? `${p.date_of_birth.month}/${p.date_of_birth.year}` : null,
        }));
      }

      if (filingResult.status === "fulfilled") {
        filings = (filingResult.value.items || []).map((f: any) => ({
          date: f.date, category: f.category, type: f.type, description: f.description,
        }));
        filingsTotal = filingResult.value.total_count || 0;
      }

      kycStatus = profile.hasInsolvencyHistory
        ? "fail"
        : profile.companyStatus === "active" && !profile.accountsOverdue
          ? "pass"
          : "warning";

      const fetchStatus = {
        officers: officerResult.status === "fulfilled" ? "ok" : "failed",
        pscs: pscResult.status === "fulfilled" ? "ok" : "failed",
        filings: filingResult.status === "fulfilled" ? "ok" : "failed",
      };

      kycData = { ...kycData, profile, officers, pscs, filings, filingsTotal, fetchStatus, companyNumber: chNumber };

      await db.update(crmProperties).set({
        proprietorCompanyNumber: chNumber,
        proprietorKycStatus: kycStatus,
        proprietorKycData: kycData,
      }).where(eq(crmProperties.id, property.id));

      console.log(`[companies-house] Property KYC for "${property.name}" proprietor "${proprietorName}" → ${kycStatus} (CH: ${chNumber})`);

      res.json({
        success: true,
        kycStatus,
        profile,
        officers: officers.filter(o => !o.resignedOn),
        pscs: pscs.filter(p => !p.ceasedOn),
        filings,
        filingsTotal,
        companyNumber: chNumber,
      });
    } else {
      kycData = { ...kycData, message: "Individual proprietor — sanctions screening only" };
      kycStatus = "individual";

      await db.update(crmProperties).set({
        proprietorKycStatus: kycStatus,
        proprietorKycData: kycData,
      }).where(eq(crmProperties.id, property.id));

      res.json({
        success: true,
        kycStatus,
        message: "Individual proprietor recorded. Sanctions screening can be run separately.",
      });
    }
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Companies House API key not configured." });
    }
    console.error("[companies-house] property-kyc error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PD_API_KEY = process.env.PROPERTYDATA_API_KEY;

async function pdFetch(endpoint: string, params: Record<string, string>) {
  if (!PD_API_KEY) throw new Error("PropertyData API key not configured");
  const qs = new URLSearchParams({ key: PD_API_KEY, ...params }).toString();
  const url = `https://api.propertydata.co.uk/${endpoint}?${qs}`;
  console.log(`[pdFetch] ${endpoint} params:`, Object.keys(params).join(", "));
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PropertyData API error ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.status === "error") {
    throw new Error(`PropertyData: ${json.message || "Unknown error"} (code: ${json.code})`);
  }
  return json;
}

router.get("/api/title-search/freeholds", requireAuth, async (req, res) => {
  try {
    const postcode = (req.query.postcode as string || "").trim();
    if (!postcode) return res.status(400).json({ error: "Postcode required" });

    const data = await pdFetch("freeholds", { postcode: postcode.replace(/\s+/g, "") });
    console.log(`[title-search] Freeholds for ${postcode}: ${data.data?.length || 0} titles found`);
    res.json(data);
  } catch (err: any) {
    console.error("[title-search] freeholds error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/title-search/title", requireAuth, async (req, res) => {
  try {
    const title = (req.query.title as string || "").trim();
    if (!title) return res.status(400).json({ error: "Title number required" });

    const data = await pdFetch("title", { title });
    console.log(`[title-search] Title ${title}: ownership_type=${data.data?.ownership_type || "unknown"}`);
    res.json(data);
  } catch (err: any) {
    console.error("[title-search] title error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/title-search/proprietor", requireAuth, async (req, res) => {
  try {
    const titleNumber = (req.body.title as string || "").trim();
    if (!titleNumber) return res.status(400).json({ error: "Title number required" });

    const titleInfo = await pdFetch("title", { title: titleNumber });
    const ownership = titleInfo.data?.ownership;
    const ownerDetails = ownership?.details;

    console.log(`[title-search] Proprietor lookup for ${titleNumber}:`, JSON.stringify(ownership || {}).substring(0, 200));

    if (ownerDetails?.owner) {
      res.json({
        success: true,
        titleNumber,
        proprietorData: {
          proprietor_name: ownerDetails.owner,
          company_name: ownerDetails.company_reg ? ownerDetails.owner : null,
          company_registration_number: ownerDetails.company_reg || null,
          proprietor_address_1: ownerDetails.owner_address || null,
          proprietor_category: ownerDetails.owner_type || null,
        },
        titleData: {
          ownershipType: ownership?.type,
          titleClass: titleInfo.data?.class,
        },
      });
    } else {
      res.json({
        success: false,
        titleNumber,
        proprietorData: null,
        titleData: {
          ownershipType: ownership?.type,
          titleClass: titleInfo.data?.class,
        },
      });
    }
  } catch (err: any) {
    console.error("[title-search] proprietor error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/title-search/auto-fill/:propertyId", requireAuth, async (req, res) => {
  try {
    const { db } = await import("./db");
    const { crmProperties } = await import("@shared/schema");
    const { eq } = await import("drizzle-orm");

    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, req.params.propertyId)).limit(1);
    if (!property) return res.status(404).json({ error: "Property not found" });

    const titleNumber = (req.body.title as string || "").trim();
    if (!titleNumber) return res.status(400).json({ error: "Title number required" });

    let titleInfo: any = null;
    try {
      titleInfo = await pdFetch("title", { title: titleNumber });
      console.log(`[title-search] Title info for ${titleNumber}: ownership=${JSON.stringify(titleInfo.data?.ownership || {}).substring(0, 200)}, uprns=${titleInfo.data?.uprns?.length || 0}`);
    } catch (titleErr: any) {
      console.log(`[title-search] Title lookup failed for ${titleNumber}:`, titleErr.message);
    }

    const ownership = titleInfo?.data?.ownership;
    const ownerDetails = ownership?.details;

    if (ownerDetails?.owner) {
      const ownerType = ownership?.type || "";
      const isCompany = ownerType.toLowerCase().includes("corporate") ||
        (ownerDetails.owner_type || "").toLowerCase().includes("company") ||
        !!ownerDetails.company_reg;
      const propName = ownerDetails.owner || "";
      const propAddress = ownerDetails.owner_address || "";
      const companyNumber = ownerDetails.company_reg || null;

      const updateData: any = {
        titleNumber,
        proprietorName: propName,
        proprietorType: isCompany ? "company" : "individual",
        proprietorAddress: propAddress || null,
        proprietorCompanyNumber: companyNumber,
        titleSearchDate: new Date(),
      };

      let landlordCompanyId: string | null = null;
      if (isCompany && propName) {
        try {
          const { crmCompanies } = await import("@shared/schema");
          const { ilike } = await import("drizzle-orm");
          let existingCompany = null;
          if (companyNumber) {
            const [byNumber] = await db.select().from(crmCompanies)
              .where(eq(crmCompanies.companiesHouseNumber, companyNumber)).limit(1);
            existingCompany = byNumber;
          }
          if (!existingCompany) {
            const [byName] = await db.select().from(crmCompanies)
              .where(ilike(crmCompanies.name, propName)).limit(1);
            existingCompany = byName;
          }
          if (existingCompany) {
            landlordCompanyId = existingCompany.id;
            if (companyNumber && !existingCompany.companiesHouseNumber) {
              await db.update(crmCompanies).set({ companiesHouseNumber: companyNumber }).where(eq(crmCompanies.id, existingCompany.id));
            }
          } else {
            const [newCompany] = await db.insert(crmCompanies).values({
              name: propName,
              companiesHouseNumber: companyNumber || null,
              companyType: "Landlord",
              headOfficeAddress: propAddress ? { address: propAddress } : null,
            }).returning();
            landlordCompanyId = newCompany.id;
          }
          if (landlordCompanyId) {
            updateData.landlordId = landlordCompanyId;
          }
        } catch (compErr: any) {
          console.log(`[title-search] Company linking failed: ${compErr.message}`);
        }
      }

      await db.update(crmProperties).set(updateData).where(eq(crmProperties.id, property.id));

      console.log(`[title-search] Auto-filled property "${property.name}" with proprietor "${propName}" (${isCompany ? "company" : "individual"}) from title ${titleNumber}${landlordCompanyId ? ` — linked landlord ${landlordCompanyId}` : ""}`);

      return res.json({
        success: true,
        titleNumber,
        proprietorName: propName,
        proprietorType: isCompany ? "company" : "individual",
        proprietorAddress: propAddress,
        proprietorCompanyNumber: companyNumber,
        ownershipType: ownerType,
        landlordCompanyId,
      });
    }

    await db.update(crmProperties).set({
      titleNumber,
      titleSearchDate: new Date(),
    }).where(eq(crmProperties.id, property.id));

    return res.json({
      success: false,
      titleNumber,
      ownershipType: ownership?.type || null,
      message: "Title saved but proprietor data could not be fetched automatically. You can enter the proprietor details manually in the KYC panel.",
    });
  } catch (err: any) {
    console.error("[title-search] auto-fill error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/title-search/auto-fill-from-postcode/:propertyId", requireAuth, async (req, res) => {
  try {
    const { db } = await import("./db");
    const { crmProperties, crmCompanies } = await import("@shared/schema");
    const { eq, ilike } = await import("drizzle-orm");

    const [property] = await db.select().from(crmProperties).where(eq(crmProperties.id, req.params.propertyId)).limit(1);
    if (!property) return res.status(404).json({ success: false, error: "Property not found" });

    let postcode = ((req.body?.postcode as string) || "").trim().replace(/\s+/g, "");
    let fullAddress = "";
    let resolvedStreet = "";
    let resolvedBuildingName = "";
    let resolvedBuildingNumber = "";

    const addr = property.address as any;
    if (addr) {
      if (typeof addr === "object") {
        if (addr.postcode && !postcode) postcode = addr.postcode.replace(/\s+/g, "");
        fullAddress = addr.formatted || addr.address || [addr.line1, addr.line2, addr.city, addr.postcode].filter(Boolean).join(", ");
      } else if (typeof addr === "string") {
        fullAddress = addr;
        const m = addr.match(/[A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2}/i);
        if (m && !postcode) postcode = m[0].replace(/\s+/g, "");
      }
    }

    const propertyName = property.name || "";
    const searchAddress = fullAddress || propertyName;

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (googleApiKey && searchAddress) {
      try {
        const googleQuery = searchAddress.toLowerCase().includes("london") || searchAddress.toLowerCase().includes("uk") ? searchAddress : `${searchAddress}, London, UK`;
        const gUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(googleQuery)}&key=${googleApiKey}&region=uk&components=country:GB`;
        const gResp = await fetch(gUrl, { signal: AbortSignal.timeout(8000) });
        if (gResp.ok) {
          const gData = await gResp.json() as any;
          const place = gData.results?.[0];
          if (place) {
            if (!fullAddress) fullAddress = place.formatted_address?.replace(/, UK$/i, "").replace(/, United Kingdom$/i, "").trim() || "";
            for (const comp of place.address_components || []) {
              if (comp.types.includes("postal_code") && !postcode) postcode = comp.long_name.replace(/\s+/g, "");
              if (comp.types.includes("route")) resolvedStreet = comp.long_name;
              if (comp.types.includes("street_number")) resolvedBuildingNumber = comp.long_name;
              if (comp.types.includes("premise") || comp.types.includes("establishment")) resolvedBuildingName = comp.long_name;
            }

            if (!resolvedBuildingName) {
              try {
                const fpUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(googleQuery)}&inputtype=textquery&fields=name,formatted_address,geometry&locationbias=circle:50000@51.5074,-0.1278&key=${googleApiKey}`;
                const fpResp = await fetch(fpUrl, { signal: AbortSignal.timeout(5000) });
                if (fpResp.ok) {
                  const fpData = await fpResp.json() as any;
                  const candidate = fpData.candidates?.[0];
                  if (candidate?.name && candidate.name !== resolvedStreet) {
                    resolvedBuildingName = candidate.name;
                  }
                }
              } catch {}
            }

            console.log(`[auto-fill-postcode] Google resolved: postcode=${postcode}, street=${resolvedStreet}, building=${resolvedBuildingName || resolvedBuildingNumber}`);
          }
        }
      } catch (err: any) {
        console.log(`[auto-fill-postcode] Google geocode error: ${err.message}`);
      }
    }

    if (!postcode) return res.json({ success: false, error: "No postcode available — provide a full address with postcode" });

    let freeholds: any[] = [];
    try {
      const fhData = await pdFetch("freeholds", { postcode });
      freeholds = fhData.data || [];
    } catch (err: any) {
      return res.json({ success: false, step: "freeholds", error: err.message });
    }

    if (freeholds.length === 0) {
      return res.json({ success: false, step: "freeholds", error: "No freehold titles found" });
    }

    const addressTerms = [resolvedBuildingName, resolvedBuildingNumber, resolvedStreet, propertyName.split(",")[0]]
      .filter(Boolean)
      .map(t => t.toLowerCase().trim());

    const scoredFreeholds = freeholds.map((f: any) => {
      const titleAddr = (f.address || f.property_address || "").toLowerCase();
      const propName = (f.proprietor_name_1 || "").toLowerCase();
      let score = 0;
      for (const term of addressTerms) {
        if (term && (titleAddr.includes(term) || propName.includes(term))) score += 10;
      }
      if (resolvedBuildingName && titleAddr.includes(resolvedBuildingName.toLowerCase())) score += 20;
      if (resolvedBuildingNumber && titleAddr.includes(resolvedBuildingNumber)) score += 15;
      return { ...f, matchScore: score };
    });
    scoredFreeholds.sort((a: any, b: any) => b.matchScore - a.matchScore);

    const topScore = scoredFreeholds[0]?.matchScore || 0;
    const hasBuildingInfo = resolvedBuildingName || resolvedBuildingNumber;
    const preFiltered = (topScore >= 15 || (hasBuildingInfo && topScore >= 10))
      ? scoredFreeholds.filter((f: any) => f.matchScore >= topScore * 0.5).slice(0, 5)
      : scoredFreeholds.slice(0, 5);

    console.log(`[auto-fill-postcode] ${freeholds.length} freeholds at ${postcode}, top score: ${topScore}, pre-filtered to ${preFiltered.length}`);

    const propertyAddress = fullAddress || propertyName;
    let matchedTitle: string | null = null;
    let matchConfidence = "none";

    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const enriched: any[] = [];
      for (const f of preFiltered) {
        const tn = String(f.title_number || f.title || "");
        if (!tn || f.address || f.property_address || !PD_API_KEY) {
          enriched.push({ ...f, title_number: tn });
          continue;
        }
        try {
          if (enriched.length > 0) await new Promise(r => setTimeout(r, 1000));
          const r = await fetch(`https://api.propertydata.co.uk/title?key=${PD_API_KEY}&title=${encodeURIComponent(tn)}`, { signal: AbortSignal.timeout(10000) });
          if (!r.ok) { enriched.push({ ...f, title_number: tn }); continue; }
          const d = await r.json();
          if (d.status === "error") { enriched.push({ ...f, title_number: tn }); continue; }
          const uprns: number[] = d.data?.uprns || [];
          const addresses: string[] = [];
          for (const uprn of uprns.slice(0, 2)) {
            try {
              await new Promise(r => setTimeout(r, 1000));
              const ur = await fetch(`https://api.propertydata.co.uk/uprn?key=${PD_API_KEY}&uprn=${uprn}`, { signal: AbortSignal.timeout(10000) });
              if (ur.ok) { const ud = await ur.json(); if (ud.status === "success" && ud.data?.address) addresses.push(ud.data.address); }
            } catch {}
          }
          enriched.push({ ...f, title_number: tn, address: addresses[0] || null, uprn_addresses: addresses, uprn_count: uprns.length });
        } catch { enriched.push({ ...f, title_number: tn }); }
      }

      const summary = enriched.map((f: any, i: number) => [
        `[${i}] Title: ${f.title_number || "?"}`,
        f.address ? `Address: ${f.address}` : null,
        f.proprietor_name_1 ? `Owner: ${String(f.proprietor_name_1).slice(0, 100)}` : null,
      ].filter(Boolean).join(", ")).join("\n");

      const resolvedInfo = [
        resolvedBuildingName ? `Building name: ${resolvedBuildingName}` : null,
        resolvedBuildingNumber ? `Building number: ${resolvedBuildingNumber}` : null,
        resolvedStreet ? `Street: ${resolvedStreet}` : null,
        fullAddress ? `Full address: ${fullAddress}` : null,
      ].filter(Boolean).join("\n");

      const aiRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 512,
        system: `You are a UK property address matching expert. Match a property to the best freehold title. You must be confident the title covers THIS specific property, not just a nearby one on the same street. If none of the titles clearly match, set confidence to "none". Respond ONLY with JSON: { "matchIndex": <number or null>, "titleNumber": "<string or null>", "confidence": "high"|"medium"|"low"|"none", "reason": "<brief>" }`,
        messages: [{ role: "user", content: `Property: ${propertyAddress}\n${resolvedInfo}\n\nFreeholds:\n${summary}` }],
      });

      const text = aiRes.content[0].type === "text" ? aiRes.content[0].text : "";
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        matchConfidence = parsed.confidence || "none";
        if (parsed.titleNumber && matchConfidence !== "none") {
          matchedTitle = parsed.titleNumber;
        }
      }
    } catch (aiErr: any) {
      console.log(`[auto-fill-postcode] AI match error: ${aiErr.message}`);
    }

    if (!matchedTitle) {
      return res.json({ success: false, step: "ai-match", error: "Could not match a title", freeholdsFound: freeholds.length });
    }

    let proprietorName = "";
    let proprietorType = "company";
    let proprietorAddress = "";
    let proprietorCompanyNumber = "";

    try {
      await new Promise(r => setTimeout(r, 1000));
      const titleInfo = await pdFetch("title", { title: matchedTitle });
      const ownerDetails = titleInfo.data?.ownership?.details;
      if (ownerDetails?.owner) {
        const ownerType = titleInfo.data?.ownership?.type || "";
        const isCompany = ownerType.toLowerCase().includes("corporate") ||
          (ownerDetails.owner_type || "").toLowerCase().includes("company") ||
          !!ownerDetails.company_reg;
        proprietorName = ownerDetails.owner;
        proprietorType = isCompany ? "company" : "individual";
        proprietorAddress = ownerDetails.owner_address || "";
        proprietorCompanyNumber = ownerDetails.company_reg || "";
      } else {
        await db.update(crmProperties).set({ titleNumber: matchedTitle, titleSearchDate: new Date() }).where(eq(crmProperties.id, property.id));
        return res.json({ success: false, step: "proprietor", titleNumber: matchedTitle, error: "No owner data available" });
      }
    } catch (err: any) {
      return res.json({ success: false, step: "proprietor", titleNumber: matchedTitle, error: err.message });
    }

    const updateData: any = {
      titleNumber: matchedTitle,
      proprietorName,
      proprietorType,
      proprietorAddress: proprietorAddress || null,
      proprietorCompanyNumber: proprietorCompanyNumber || null,
      titleSearchDate: new Date(),
    };

    let landlordCompanyId: string | null = null;
    if (proprietorType === "company" && proprietorName) {
      try {
        let existing = null;
        if (proprietorCompanyNumber) {
          const [byNum] = await db.select().from(crmCompanies).where(eq(crmCompanies.companiesHouseNumber, proprietorCompanyNumber)).limit(1);
          existing = byNum;
        }
        if (!existing) {
          const [byName] = await db.select().from(crmCompanies).where(ilike(crmCompanies.name, proprietorName)).limit(1);
          existing = byName;
        }
        if (existing) {
          landlordCompanyId = existing.id;
          if (proprietorCompanyNumber && !existing.companiesHouseNumber) {
            await db.update(crmCompanies).set({ companiesHouseNumber: proprietorCompanyNumber }).where(eq(crmCompanies.id, existing.id));
          }
        } else {
          const [newCo] = await db.insert(crmCompanies).values({
            name: proprietorName,
            companiesHouseNumber: proprietorCompanyNumber || null,
            companyType: "Landlord",
            headOfficeAddress: proprietorAddress ? { address: proprietorAddress } : null,
          }).returning();
          landlordCompanyId = newCo.id;
        }
        if (landlordCompanyId) updateData.landlordId = landlordCompanyId;
      } catch (compErr: any) {
        console.log(`[auto-fill-postcode] Company linking failed: ${compErr.message}`);
      }
    }

    await db.update(crmProperties).set(updateData).where(eq(crmProperties.id, property.id));

    let parentCompanyResult: { name: string; number: string; id?: string } | null = null;
    if (proprietorType === "company" && proprietorCompanyNumber && landlordCompanyId) {
      try {
        console.log(`[auto-fill-postcode] Discovering parent company for ${proprietorName} (${proprietorCompanyNumber})...`);

        const { chain } = await discoverUltimateParent(proprietorCompanyNumber);
        let officers: any[] = [];
        try {
          const officerData = await chFetch(`/company/${proprietorCompanyNumber.padStart(8, "0")}/officers`);
          officers = officerData.items || [];
        } catch {}

        const brand = await identifyBrandParent(proprietorName, chain, officers);
        if (brand) {
          console.log(`[auto-fill-postcode] Identified parent: ${brand.name} (${brand.number})`);

          let parentCompanyId: string | null = null;
          if (brand.number) {
            const paddedBrandNum = brand.number.padStart(8, "0");
            const [byNum] = await db.select().from(crmCompanies)
              .where(eq(crmCompanies.companiesHouseNumber, paddedBrandNum)).limit(1);
            if (!byNum) {
              const [byNumUnpadded] = await db.select().from(crmCompanies)
                .where(eq(crmCompanies.companiesHouseNumber, brand.number)).limit(1);
              if (byNumUnpadded) parentCompanyId = byNumUnpadded.id;
            } else {
              parentCompanyId = byNum.id;
            }
          }
          if (!parentCompanyId) {
            const [byName] = await db.select().from(crmCompanies)
              .where(ilike(crmCompanies.name, brand.name)).limit(1);
            if (byName) parentCompanyId = byName.id;
          }

          if (!parentCompanyId) {
            let parentProfile: any = null;
            if (brand.number) {
              try {
                parentProfile = await chFetch(`/company/${brand.number.padStart(8, "0")}`);
              } catch {}
            }
            const addr = parentProfile?.registered_office_address;
            const addrStr = addr ? [addr.premises, addr.address_line_1, addr.locality, addr.postal_code].filter(Boolean).join(", ") : "";

            const [newParent] = await db.insert(crmCompanies).values({
              name: brand.name,
              companiesHouseNumber: brand.number || null,
              companyType: "Client",
              isPortfolioAccount: true,
              headOfficeAddress: addrStr ? { address: addrStr } : null,
            }).returning();
            parentCompanyId = newParent.id;
            console.log(`[auto-fill-postcode] Created parent company: ${brand.name} (${parentCompanyId})`);
          }

          if (parentCompanyId && landlordCompanyId) {
            await db.update(crmCompanies)
              .set({ parentCompanyId })
              .where(eq(crmCompanies.id, landlordCompanyId));
            console.log(`[auto-fill-postcode] Linked SPV ${proprietorName} → parent ${brand.name}`);
          }

          parentCompanyResult = { name: brand.name, number: brand.number, id: parentCompanyId || undefined };
        } else {
          console.log(`[auto-fill-postcode] No recognisable parent identified for ${proprietorName}`);
        }
      } catch (parentErr: any) {
        console.log(`[auto-fill-postcode] Parent discovery failed: ${parentErr.message}`);
      }
    }

    console.log(`[auto-fill-postcode] ${property.name}: title=${matchedTitle}, owner=${proprietorName}, landlord=${landlordCompanyId || "none"}, parent=${parentCompanyResult?.name || "none"}`);

    return res.json({
      success: true,
      titleNumber: matchedTitle,
      matchConfidence,
      proprietorName,
      proprietorType,
      proprietorCompanyNumber,
      landlordCompanyId,
      parentCompany: parentCompanyResult,
    });
  } catch (err: any) {
    console.error("[auto-fill-postcode] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/companies-house/discover-parent/:companyId", requireAuth, async (req, res) => {
  try {
    const { db } = await import("./db");
    const { crmCompanies } = await import("@shared/schema");
    const { eq, ilike } = await import("drizzle-orm");

    const [company] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, req.params.companyId)).limit(1);
    if (!company) return res.status(404).json({ success: false, error: "Company not found" });

    const chNumber = company.companiesHouseNumber;
    if (!chNumber) return res.json({ success: false, error: "No Companies House number" });

    const { chain } = await discoverUltimateParent(chNumber);
    let officers: any[] = [];
    try {
      const officerData = await chFetch(`/company/${chNumber.padStart(8, "0")}/officers`);
      officers = officerData.items || [];
    } catch {}

    const brand = await identifyBrandParent(company.name, chain, officers);
    if (!brand) {
      return res.json({ success: true, parentFound: false, chain });
    }

    let parentCompanyId: string | null = null;
    if (brand.number) {
      const paddedNum = brand.number.padStart(8, "0");
      const [byNum] = await db.select().from(crmCompanies)
        .where(eq(crmCompanies.companiesHouseNumber, paddedNum)).limit(1);
      if (!byNum) {
        const [byNumUnpadded] = await db.select().from(crmCompanies)
          .where(eq(crmCompanies.companiesHouseNumber, brand.number)).limit(1);
        if (byNumUnpadded) parentCompanyId = byNumUnpadded.id;
      } else {
        parentCompanyId = byNum.id;
      }
    }
    if (!parentCompanyId) {
      const [byName] = await db.select().from(crmCompanies)
        .where(ilike(crmCompanies.name, brand.name)).limit(1);
      if (byName) parentCompanyId = byName.id;
    }

    if (!parentCompanyId) {
      let parentProfile: any = null;
      if (brand.number) {
        try { parentProfile = await chFetch(`/company/${brand.number.padStart(8, "0")}`); } catch {}
      }
      const addr = parentProfile?.registered_office_address;
      const addrStr = addr ? [addr.premises, addr.address_line_1, addr.locality, addr.postal_code].filter(Boolean).join(", ") : "";

      const [newParent] = await db.insert(crmCompanies).values({
        name: brand.name,
        companiesHouseNumber: brand.number || null,
        companyType: "Client",
        isPortfolioAccount: true,
        headOfficeAddress: addrStr ? { address: addrStr } : null,
      }).returning();
      parentCompanyId = newParent.id;
    }

    if (parentCompanyId) {
      await db.update(crmCompanies)
        .set({ parentCompanyId })
        .where(eq(crmCompanies.id, company.id));
    }

    res.json({
      success: true,
      parentFound: true,
      parentCompany: { name: brand.name, number: brand.number, id: parentCompanyId },
      chain,
    });
  } catch (err: any) {
    console.error("[discover-parent] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post("/api/title-search/download-document", requireAuth, async (req, res) => {
  try {
    const titleNumber = (req.body.title as string || "").trim();
    const docType = (req.body.document as string || "register").trim();
    if (!titleNumber) return res.status(400).json({ error: "Title number required" });

    const validDocs = ["register", "plan"];
    if (!validDocs.includes(docType)) {
      return res.status(400).json({ error: `Invalid document type. Use: ${validDocs.join(", ")}` });
    }

    if (!PD_API_KEY) return res.status(500).json({ error: "PropertyData API key not configured" });

    const qs = new URLSearchParams({ key: PD_API_KEY, title: titleNumber, documents: docType }).toString();
    const apiRes = await fetch(`https://api.propertydata.co.uk/land-registry-documents?${qs}`, {
      signal: AbortSignal.timeout(30000),
    });
    const data = await apiRes.json();

    console.log(`[title-search] Document order for ${titleNumber} (${docType}):`, JSON.stringify(data).substring(0, 500));

    if (data.status === "error") {
      if (data.code === "2906" && data.document_url) {
        return res.json({
          success: true,
          titleNumber,
          documentType: docType,
          documentStatus: "previously_purchased",
          documentUrl: data.document_url,
          price: null,
        });
      }
      const friendlyMessages: Record<string, string> = {
        "2908": "This title has pending applications at Land Registry, so documents can't be purchased right now. Try again later.",
        "801": "Title not found at Land Registry.",
        "2904": `${docType === "plan" ? "Title Plan" : "Title Register"} is not available for this title.`,
      };
      const msg = friendlyMessages[data.code] || data.message || "Document not available";
      return res.status(400).json({ error: msg });
    }

    const docData = data.data;
    res.json({
      success: true,
      titleNumber,
      documentType: docType,
      documentStatus: docData?.document_status,
      documentUrl: docData?.document_url,
      price: docData?.pending_payment_price,
    });
  } catch (err: any) {
    console.error("[title-search] download-document error:", err.message);
    res.status(500).json({ error: "Failed to order document. Please try again." });
  }
});

router.get("/api/title-search/leaseholds/:titleNumber", requireAuth, async (req, res) => {
  try {
    const titleNumber = req.params.titleNumber.trim();
    if (!titleNumber) return res.status(400).json({ error: "Title number required" });

    const data = await pdFetch("title", { title: titleNumber });
    const leaseholds = data.data?.leaseholds || [];
    const ownership = data.data?.ownership;

    console.log(`[title-search] Leaseholds for ${titleNumber}: ${leaseholds.length} found`);

    res.json({
      success: true,
      titleNumber,
      freeholdOwnership: ownership,
      leaseholdCount: leaseholds.length,
      leaseholds,
    });
  } catch (err: any) {
    console.error("[title-search] leaseholds error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/title-search/leasehold-details", requireAuth, async (req, res) => {
  try {
    const titles = req.body.titles as string[];
    if (!titles || !Array.isArray(titles) || titles.length === 0) {
      return res.status(400).json({ error: "Array of title numbers required" });
    }
    const maxBatch = 10;
    const batch = titles.slice(0, maxBatch);

    const results: any[] = [];
    for (let i = 0; i < batch.length; i++) {
      try {
        const data = await pdFetch("title", { title: batch[i] });
        const d = data.data;
        results.push({
          titleNumber: batch[i],
          class: d?.class || null,
          ownership: d?.ownership || null,
          plotSize: d?.plot_size || null,
          polygon: d?.polygons?.[0]?.approx_centre || null,
        });
      } catch {
        results.push({ titleNumber: batch[i], error: true });
      }
      if (i < batch.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    console.log(`[title-search] Leasehold details batch: ${results.length}/${titles.length} fetched`);
    res.json({ success: true, results, total: titles.length, fetched: results.length });
  } catch (err: any) {
    console.error("[title-search] leasehold-details error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/ownership-intelligence", requireAuth, async (req, res) => {
  try {
    const { titles, address, postcode } = req.body;
    if (!titles || !Array.isArray(titles) || titles.length === 0) {
      return res.status(400).json({ error: "titles array required" });
    }

    const companyTitles = titles.filter((t: any) => t.company_reg).slice(0, 8);
    const individualTitles = titles.filter((t: any) => !t.company_reg);

    const companyResults: any[] = [];

    for (const title of companyTitles) {
      const companyNum = String(title.company_reg).padStart(8, "0");
      try {
        const [profileRes, officerRes, pscRes] = await Promise.allSettled([
          chFetch(`/company/${companyNum}`),
          chFetch(`/company/${companyNum}/officers`),
          chFetch(`/company/${companyNum}/persons-with-significant-control`),
        ]);

        const profile = profileRes.status === "fulfilled" ? profileRes.value : null;
        const officers = officerRes.status === "fulfilled"
          ? (officerRes.value.items || []).filter((o: any) => !o.resigned_on).map((o: any) => ({
              name: o.name,
              role: o.officer_role,
              appointedOn: o.appointed_on,
              nationality: o.nationality,
              occupation: o.occupation,
            }))
          : [];
        const pscs = pscRes.status === "fulfilled"
          ? (pscRes.value.items || []).filter((p: any) => !p.ceased_on).map((p: any) => ({
              name: p.name || [p.name_elements?.title, p.name_elements?.forename, p.name_elements?.surname].filter(Boolean).join(" ") || "Unknown",
              kind: p.kind,
              naturesOfControl: p.natures_of_control || [],
              nationality: p.nationality,
              countryOfResidence: p.country_of_residence,
              registrationNumber: p.identification?.registration_number,
            }))
          : [];

        let ownershipChain: any = null;
        let brandParent: any = null;
        try {
          ownershipChain = await discoverUltimateParent(companyNum);
          if (ownershipChain.chain.length > 0 || officers.length > 0) {
            brandParent = await identifyBrandParent(
              profile?.company_name || title.proprietor_name_1 || companyNum,
              ownershipChain.chain,
              officerRes.status === "fulfilled" ? (officerRes.value.items || []) : []
            );
          }
        } catch {}

        companyResults.push({
          titleNumber: title.title_number,
          tenure: title._tenure,
          propertyAddress: title.address || title.property_address,
          companyNumber: companyNum,
          companyName: profile?.company_name || title.proprietor_name_1,
          companyStatus: profile?.company_status,
          companyType: profile?.type,
          dateOfCreation: profile?.date_of_creation,
          registeredAddress: profile?.registered_office_address,
          sicCodes: profile?.sic_codes,
          hasCharges: profile?.has_charges,
          hasInsolvencyHistory: profile?.has_insolvency_history,
          officers,
          pscs,
          ownershipChain: ownershipChain?.chain || [],
          ultimateParent: ownershipChain?.ultimateParent || null,
          brandParent,
        });
      } catch (err: any) {
        companyResults.push({
          titleNumber: title.title_number,
          tenure: title._tenure,
          propertyAddress: title.address || title.property_address,
          companyNumber: companyNum,
          companyName: title.proprietor_name_1 || "Unknown",
          error: err.message,
        });
      }

      await new Promise(r => setTimeout(r, 250));
    }

    let aiAnalysis: any = null;
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const titlesStr = titles.slice(0, 15).map((t: any, i: number) => {
        const parts = [
          `${i + 1}. ${t._tenure || "Unknown"}: ${t.proprietor_name_1 || t.proprietor || "Unknown owner"}`,
          t.address || t.property_address ? `   Address: ${t.address || t.property_address}` : "",
          t.company_reg ? `   Company Reg: ${t.company_reg}` : "",
          t.proprietor_category ? `   Category: ${t.proprietor_category}` : "",
          t.date_proprietor_added ? `   Owner since: ${t.date_proprietor_added}` : "",
          t.price_paid ? `   Price paid: £${Number(t.price_paid).toLocaleString()}` : "",
        ].filter(Boolean);
        return parts.join("\n");
      }).join("\n\n");

      const chStr = companyResults.map((c: any) => {
        if (c.error) return `Company ${c.companyNumber} (${c.companyName}): lookup failed`;
        const parts = [
          `Company: ${c.companyName} (${c.companyNumber})`,
          `  Status: ${c.companyStatus || "unknown"} | Type: ${c.companyType || "unknown"} | Created: ${c.dateOfCreation || "unknown"}`,
          c.sicCodes?.length > 0 ? `  SIC: ${c.sicCodes.join(", ")}` : "",
          c.hasCharges ? "  Has charges registered" : "",
          c.hasInsolvencyHistory ? "  Has insolvency history" : "",
          c.officers.length > 0 ? `  Active officers: ${c.officers.map((o: any) => `${o.name} (${o.role})`).join(", ")}` : "",
          c.pscs.length > 0 ? `  PSCs: ${c.pscs.map((p: any) => `${p.name} [${p.kind}] controls: ${p.naturesOfControl.join(", ")}`).join("; ")}` : "",
          c.ownershipChain.length > 0 ? `  Ownership chain: ${c.ownershipChain.map((ch: any) => `${ch.name} (${ch.number})`).join(" → ")}` : "",
          c.ultimateParent ? `  Ultimate parent: ${c.ultimateParent.name} (${c.ultimateParent.number})` : "",
          c.brandParent ? `  Identified brand: ${c.brandParent.name}` : "",
        ].filter(Boolean);
        return parts.join("\n");
      }).join("\n\n");

      const individualStr = individualTitles.length > 0
        ? "\n\nIndividual owners:\n" + individualTitles.slice(0, 5).map((t: any) => `- ${t.proprietor_name_1 || "Unknown"} (${t._tenure || "Unknown"}): ${t.address || "N/A"}`).join("\n")
        : "";

      const aiRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1500,
        system: `You are a UK commercial property intelligence analyst working for Bruce Gillingham Pollard, a London commercial property agency. Analyse the ownership data for a property/postcode and produce a clear, actionable intelligence report.

Your report should identify:
1. **Beneficial Owner** — who actually owns the building (the real person or recognisable company behind any SPVs)
2. **Building Manager / Managing Agent** — who manages the building day-to-day (look for management companies in leasehold titles, officer names of management companies, or property management SIC codes)
3. **KYC Risk Assessment** — flag any concerns (dissolved companies, insolvency history, overseas ownership, missing data)
4. **Key Contacts** — who should BGP approach to discuss the property (officers of freeholder, managing agents, etc.)

Format your response as JSON:
{
  "beneficialOwner": { "name": "...", "companyNumber": "...", "confidence": "high|medium|low", "explanation": "..." },
  "buildingManager": { "name": "...", "companyNumber": "...", "confidence": "high|medium|low", "explanation": "..." },
  "kycRisk": "low|medium|high",
  "kycFlags": ["list of concerns"],
  "keyContacts": [{ "name": "...", "role": "...", "company": "..." }],
  "summary": "2-3 sentence plain English summary of who owns and manages this property",
  "ownershipStructure": "Brief description of the ownership structure (e.g. 'SPV owned by REIT via holding company')"
}`,
        messages: [{
          role: "user",
          content: `Property: ${address || "Unknown"}\nPostcode: ${postcode || "Unknown"}\n\n## Registered Titles\n${titlesStr}\n\n## Companies House Data\n${chStr}${individualStr}`,
        }],
      });

      const aiText = aiRes.content[0].type === "text" ? aiRes.content[0].text : "";
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        aiAnalysis = {
          beneficialOwner: parsed.beneficialOwner || { name: null, companyNumber: null, confidence: "none", explanation: "Could not determine" },
          buildingManager: parsed.buildingManager || { name: null, companyNumber: null, confidence: "none", explanation: "Could not determine" },
          kycRisk: parsed.kycRisk || "unknown",
          kycFlags: Array.isArray(parsed.kycFlags) ? parsed.kycFlags : [],
          keyContacts: Array.isArray(parsed.keyContacts) ? parsed.keyContacts : [],
          summary: parsed.summary || "Analysis completed but no clear summary could be generated.",
          ownershipStructure: parsed.ownershipStructure || null,
        };
      }
    } catch (err: any) {
      console.error("[ownership-intelligence] AI analysis error:", err.message);
    }

    console.log(`[ownership-intelligence] ${address || postcode}: ${companyResults.length} companies analysed, AI: ${aiAnalysis ? "yes" : "no"}`);

    res.json({
      success: true,
      address,
      postcode,
      companies: companyResults,
      individualOwners: individualTitles.slice(0, 10).map((t: any) => ({
        name: t.proprietor_name_1 || t.proprietor || "Unknown",
        tenure: t._tenure,
        address: t.address || t.property_address,
        titleNumber: t.title_number,
      })),
      aiAnalysis,
      analyzedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    if (err.message?.includes("not configured")) {
      return res.status(503).json({ error: "Companies House API key not configured." });
    }
    console.error("[ownership-intelligence] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Scrape UK legal entity from brand website ────────────────────────────
// UK law (Companies Act 2006) requires all businesses to display their
// registered company name on their website — usually footer, terms, or
// legal pages. We try those pages in order and extract the entity name
// and/or Companies House number using pattern matching.
async function scrapeUkEntityFromWebsite(domain: string): Promise<{
  entityName: string | null;
  chNumber: string | null;
  sourceUrl: string | null;
}> {
  const base = domain.startsWith("http") ? domain.replace(/\/$/, "") : `https://${domain}`;

  // Pages most likely to contain legal boilerplate, in priority order
  const pages = [
    "",                                    // homepage footer
    "/terms",
    "/terms-and-conditions",
    "/terms-of-use",
    "/terms-of-service",
    "/policies/terms-of-service",          // Shopify
    "/policies/privacy-policy",            // Shopify
    "/legal",
    "/legal-notices",
    "/legal-information",
    "/privacy",
    "/privacy-policy",
    "/contact",
    "/contact-us",
    "/about",
    "/about-us",
    "/help",
    "/sitemap",
    "/cookies",
    "/cookie-policy",
    "/impressum",                          // EU/German legal page
  ];

  // Patterns that match "XXX Limited/Ltd/plc/LLP registered in England/Wales"
  const ENTITY_PATTERNS: RegExp[] = [
    /refers\s+to\s+([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP|LP))/i,
    /([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP|LP))\s+(?:is\s+)?(?:a\s+company\s+)?registered\s+in\s+England/i,
    /contracting\s+party:?\s*([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP))/i,
    /([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP))\s+\((?:company\s+)?(?:registered\s+)?(?:number|no\.?)/i,
    /registered\s+company(?:\s+name)?:?\s*([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP))/i,
    /©\s*(?:\d{4}[-–]\d{2,4}|\d{4})\s+([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP))/i,
    /trading\s+(?:as|name):?\s*([A-Z][A-Za-z0-9\s&',.()-]{2,60}(?:Limited|Ltd\.?|plc|PLC|LLP))/i,
  ];

  const CH_PATTERNS: RegExp[] = [
    /company\s+(?:registration\s+)?(?:number|no\.?|#):?\s*(0?\d{7,8})/i,
    /registered\s+(?:company\s+)?(?:number|no\.?):?\s*(0?\d{7,8})/i,
    /\((?:company\s+)?(?:number|no\.?)\s*(0?\d{7,8})\)/i,
    /(?:CRN|CRN:)\s*(0?\d{7,8})/i,
  ];

  // ── Helper: extract entity/CH from a block of plain text ─────────────────
  function extractFromText(text: string, sourceUrl: string): { entityName: string | null; chNumber: string | null; sourceUrl: string } | null {
    let entityName: string | null = null;
    let chNumber: string | null = null;
    for (const pat of ENTITY_PATTERNS) {
      const m = text.match(pat);
      if (m?.[1]) {
        const candidate = m[1].trim().replace(/\s+/g, " ");
        if (candidate.length <= 80 && !/[\[\]<>{}|]/.test(candidate)) {
          entityName = candidate;
          break;
        }
      }
    }
    for (const pat of CH_PATTERNS) {
      const m = text.match(pat);
      if (m?.[1]) { chNumber = m[1].trim().padStart(8, "0"); break; }
    }
    if (entityName || chNumber) return { entityName, chNumber, sourceUrl };
    return null;
  }

  // ── Step 1: Shopify JSON API (works without JS) ───────────────────────────
  // Shopify stores expose policy pages as plain JSON — bypasses SPA rendering.
  const shopifyPolicies = [
    "/policies/terms-of-service.json",
    "/policies/privacy-policy.json",
    "/policies/refund-policy.json",
  ];
  for (const path of shopifyPolicies) {
    try {
      const resp = await fetch(`${base}${path}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
        signal: AbortSignal.timeout(6000),
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("json")) continue;
      const json = await resp.json() as any;
      const body: string = json?.policy?.body || json?.body || "";
      if (!body) continue;
      // Strip HTML tags from Shopify body
      const text = body.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      const hit = extractFromText(text, `${base}${path}`);
      if (hit) {
        console.log(`[find-uk-entity] Shopify JSON ${path}: "${hit.entityName}" / ${hit.chNumber}`);
        return hit;
      }
    } catch { /* non-fatal */ }
  }

  // ── Step 2: WordPress REST API ────────────────────────────────────────────
  const wpSlugs = ["terms-and-conditions", "terms-of-service", "terms", "privacy-policy", "legal"];
  for (const slug of wpSlugs) {
    try {
      const resp = await fetch(`${base}/wp-json/wp/v2/pages?slug=${slug}&_fields=content`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0)" },
        signal: AbortSignal.timeout(5000),
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const json = await resp.json() as any[];
      const body: string = json?.[0]?.content?.rendered || "";
      if (!body) continue;
      const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
      const hit = extractFromText(text, `${base}/wp-json/wp/v2/pages?slug=${slug}`);
      if (hit) {
        console.log(`[find-uk-entity] WP REST ${slug}: "${hit.entityName}" / ${hit.chNumber}`);
        return hit;
      }
    } catch { /* non-fatal */ }
  }

  // ── Step 3: Regular HTML pages (static sites / SSR) ──────────────────────
  for (const page of pages) {
    const url = `${base}${page}`;
    try {
      const resp = await fetch(url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; BGP-Dashboard/1.0; legal-entity-lookup)" },
        signal: AbortSignal.timeout(6000),
        redirect: "follow",
      });
      if (!resp.ok) continue;
      const ct = resp.headers.get("content-type") || "";
      if (!ct.includes("html") && !ct.includes("text")) continue;

      const html = await resp.text();

      // Also check __NEXT_DATA__ / Next.js SSR JSON blobs embedded in the page
      const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(\{[\s\S]*?\})<\/script>/);
      if (nextDataMatch) {
        try {
          const nd = JSON.parse(nextDataMatch[1]);
          const ndText = JSON.stringify(nd);
          const hit = extractFromText(ndText, url + "#next-data");
          if (hit) { console.log(`[find-uk-entity] Next.js JSON blob at ${url}`); return hit; }
        } catch { /* non-fatal */ }
      }

      // Strip scripts/styles, decode HTML entities
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/&copy;/g, "©")
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&[a-z]+;/g, " ")
        .replace(/\s+/g, " ");

      const hit = extractFromText(text, url);
      if (hit) {
        console.log(`[find-uk-entity] scraped from ${url}: "${hit.entityName}" / ${hit.chNumber}`);
        return hit;
      }
    } catch (err: any) {
      console.log(`[find-uk-entity] scrape failed ${url}: ${err.message}`);
    }
  }

  return { entityName: null, chNumber: null, sourceUrl: null };
}

// ─── Find active UK operating entity for a brand ───────────────────────────
router.post("/api/companies-house/find-uk-entity/:companyId", requireAuth, async (req, res) => {
  try {
    const { db } = await import("./db");
    const { crmCompanies } = await import("../shared/schema");
    const { eq } = await import("drizzle-orm");
    const [company] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, req.params.companyId)).limit(1);
    if (!company) return res.status(404).json({ error: "Company not found" });

    // Step 1: Scrape the brand's website for UK legal entity name
    let ukEntityName = (company as any).ukEntityName as string | null;
    let scraped: { entityName: string | null; chNumber: string | null; sourceUrl: string | null } = { entityName: null, chNumber: null, sourceUrl: null };

    const domain = (company as any).domainUrl as string | null || (company as any).domain as string | null;
    if (domain) {
      scraped = await scrapeUkEntityFromWebsite(domain);
      // Auto-save scraped entity name if we don't already have one stored
      if (scraped.entityName && !ukEntityName) {
        ukEntityName = scraped.entityName;
        await db.update(crmCompanies)
          .set({ ukEntityName } as any)
          .where(eq(crmCompanies.id, company.id))
          .catch(() => {});
      }
    }

    // Companies House search — use scraped/saved uk_entity_name first, then brand name
    const chSearchTerms = ukEntityName && ukEntityName !== company.name
      ? [ukEntityName, company.name]
      : [company.name];

    const chSuggestions: any[] = [];
    for (const term of chSearchTerms) {
      if (!term) continue;
      try {
        const chSearch = await chFetch(`/search/companies?q=${encodeURIComponent(term)}&items_per_page=10`);
        const matches = (chSearch.items || [])
          .filter((i: any) => i.company_status === "active")
          .slice(0, 5)
          .map((i: any) => ({
            companyNumber: i.company_number,
            name: i.title,
            status: i.company_status,
            type: i.company_type,
            address: i.address_snippet,
            dateOfCreation: i.date_of_creation,
            searchedAs: term,
          }));
        chSuggestions.push(...matches.filter((m: any) =>
          !chSuggestions.some((e: any) => e.companyNumber === m.companyNumber)
        ));
      } catch {
        // CH search failure is non-fatal
      }
    }

    // Google Places Text Search for UK stores (only if GOOGLE_API_KEY set)
    const googleKey = process.env.GOOGLE_API_KEY;
    let stores: any[] = [];
    if (googleKey) {
      const query = `${ukEntityName || company.name} store UK`;
      const placesUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&region=uk&key=${googleKey}`;
      const placesRes = await fetch(placesUrl, { signal: AbortSignal.timeout(10_000) });
      if (placesRes.ok) {
        const placesData: any = await placesRes.json();
        stores = (placesData.results || []).slice(0, 10).map((p: any) => ({
          name: p.name,
          address: p.formatted_address,
          lat: p.geometry?.location?.lat,
          lng: p.geometry?.location?.lng,
          placeId: p.place_id,
          businessStatus: p.business_status || "OPERATIONAL",
          types: p.types || [],
        }));
      }
    }

    const londonStores = stores.filter((s: any) => s.address?.includes("London"));

    const chData = company.companiesHouseData as any;
    res.json({
      brand: { id: company.id, name: company.name, ukEntityName },
      scraped,
      currentChNumber: company.companiesHouseNumber,
      currentChStatus: chData?.profile?.companyStatus || null,
      ukStores: stores,
      londonStoreCount: londonStores.length,
      activeChCandidates: chSuggestions,
    });
  } catch (err: any) {
    console.error("[find-uk-entity]", err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
