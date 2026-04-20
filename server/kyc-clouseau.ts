import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { chFetch, discoverUltimateParent } from "./companies-house";
import { pool } from "./db";
import pLimit from "p-limit";

const router = Router();

function sanitizeErrorMessage(rawMessage: string, fallback: string): string {
  if (!rawMessage) return fallback;

  const sensitivePatterns = [
    /api[_-]?key/i,
    /bearer\s+\S+/i,
    /authorization/i,
    /token[=:]\S+/i,
    /password/i,
    /secret/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /getaddrinfo/i,
  ];

  for (const pattern of sensitivePatterns) {
    if (pattern.test(rawMessage)) {
      if (/ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(rawMessage)) {
        return `${fallback}: Unable to connect to external service. Please try again later.`;
      }
      return `${fallback}: An internal error occurred. Please try again later.`;
    }
  }

  if (/timeout|timed?\s*out/i.test(rawMessage)) {
    return `${fallback}: The request timed out. Please try again.`;
  }

  if (/429|rate.?limit/i.test(rawMessage)) {
    return `${fallback}: Too many requests. Please wait a moment and try again.`;
  }

  if (/404|not found/i.test(rawMessage)) {
    return `${fallback}: The requested resource was not found.`;
  }

  if (/401|403|unauthorized|forbidden/i.test(rawMessage)) {
    return `${fallback}: Authentication error with external service. Please contact support.`;
  }

  if (rawMessage.length > 200) {
    return `${fallback}: An unexpected error occurred. Please try again.`;
  }

  return `${fallback}: ${rawMessage}`;
}

interface InvestigationResult {
  subject: {
    name: string;
    companyNumber?: string;
    type: "company" | "individual";
  };
  companyProfile?: any;
  officers?: any[];
  pscs?: any[];
  ownershipChain?: any;
  filingHistory?: any[];
  insolvencyHistory?: any[];
  sanctionsScreening?: any;
  aiAnalysis?: string;
  accountsAnalysis?: {
    filingDate: string;
    description: string;
    documentId: string;
    summary: string;
  } | null;
  riskScore?: number;
  riskLevel?: "low" | "medium" | "high" | "critical";
  flags?: string[];
  charges?: any[];
  propertyContext?: any;
  propertiesOwned?: any;
  timestamp: string;
}

export async function getCompanyData(companyNumber: string) {
  const padded = companyNumber.padStart(8, "0");
  const [profile, officersData, pscsData, filingData, chargesData] = await Promise.allSettled([
    chFetch(`/company/${padded}`),
    chFetch(`/company/${padded}/officers?items_per_page=100`),
    chFetch(`/company/${padded}/persons-with-significant-control`),
    chFetch(`/company/${padded}/filing-history?items_per_page=20`),
    chFetch(`/company/${padded}/charges`),
  ]);

  let insolvencyData = null;
  const profileResult = profile.status === "fulfilled" ? profile.value : null;
  if (profileResult?.has_insolvency_history) {
    try {
      insolvencyData = await chFetch(`/company/${padded}/insolvency`);
    } catch {}
  }

  return {
    profile: profileResult,
    officers: officersData.status === "fulfilled" ? (officersData.value.items || []) : [],
    pscs: pscsData.status === "fulfilled" ? (pscsData.value.items || []) : [],
    filings: filingData.status === "fulfilled" ? (filingData.value.items || []) : [],
    insolvency: insolvencyData?.items || [],
    charges: chargesData.status === "fulfilled" ? (chargesData.value.items || []) : [],
  };
}

export async function screenSanctions(names: string[]) {
  try {
    const { screenName, loadSanctionsList } = await import("./sanctions-screening");
    const { screenNames: caScreen, isComplyAdvantageConfigured } = await import("./comply-advantage");
    await loadSanctionsList();

    // Run free lists (OFSI/OFAC) and ComplyAdvantage (sanctions + PEP +
    // adverse media) in parallel. CA gives us the signals the free lists
    // don't carry — PEPs and adverse media — which is where most of the
    // real risk sits for West End trophy-asset proprietors.
    const caConfigured = isComplyAdvantageConfigured();
    const [freeByName, caResults] = await Promise.all([
      Promise.resolve(names.map(n => ({ name: n, matches: screenName(n, 0.6) }))),
      caConfigured ? caScreen(names.map(n => ({ name: n }))).catch((err: any) => {
        console.warn("[kyc-clouseau] ComplyAdvantage screen failed, falling back to free lists only:", err?.message);
        return [] as any[];
      }) : Promise.resolve([] as any[]),
    ]);

    const caByName = new Map<string, any>();
    for (const r of caResults) caByName.set(r.name, r);

    const results: any[] = [];
    for (const { name, matches: freeMatches } of freeByName) {
      const ca = caByName.get(name);
      const merged: any[] = [];

      for (const m of freeMatches) {
        merged.push({
          matchType: "sanctions",
          source: "free-list",
          sanctionedName: m.entry.name,
          score: m.score,
          regime: m.entry.regime,
          designation: m.entry.designationType,
        });
      }
      for (const m of (ca?.matches || [])) {
        merged.push({
          matchType: m.matchType,
          source: "complyadvantage",
          sanctionedName: m.name,
          listName: m.listName,
          score: m.score,
          details: m.details,
        });
      }

      if (merged.length === 0) {
        results.push({ name, status: "clear", matches: [] });
        continue;
      }
      const topScore = Math.max(...merged.map(m => m.score || 0));
      const hasSanctions = merged.some(m => m.matchType === "sanctions" || m.matchType === "warning");
      const hasPep = merged.some(m => m.matchType === "pep");
      const hasAdverse = merged.some(m => m.matchType === "adverse_media" || m.matchType === "adverse-media");
      const status: "strong_match" | "potential_match" =
        (hasSanctions && topScore >= 0.9) ? "strong_match" :
        (hasPep && topScore >= 0.9) ? "strong_match" :
        "potential_match";

      results.push({
        name,
        status,
        hasSanctions,
        hasPep,
        hasAdverse,
        matches: merged.slice(0, 5),
      });
    }
    return results;
  } catch (err: any) {
    console.warn("[kyc-clouseau] Sanctions screening error:", err.message);
    return null;
  }
}

export function assessRisk(data: any, sanctionsResult: any): { score: number; level: string; flags: string[] } {
  const flags: string[] = [];
  let score = 0;

  if (data.profile) {
    if (data.profile.company_status !== "active") {
      flags.push(`Company status: ${data.profile.company_status}`);
      score += 25;
    }
    if (data.profile.has_insolvency_history) {
      flags.push("Insolvency history present");
      score += 20;
    }
    if (data.profile.has_charges) {
      flags.push("Outstanding charges registered");
      score += 5;
    }
    const accounts = data.profile.accounts;
    if (accounts?.overdue) {
      flags.push("Accounts overdue");
      score += 15;
    }
    const confStmt = data.profile.confirmation_statement;
    if (confStmt?.overdue) {
      flags.push("Confirmation statement overdue");
      score += 10;
    }
    const jurisdiction = data.profile.foreign_company_details?.originating_registry?.country;
    const highRiskJurisdictions = ["British Virgin Islands", "Cayman Islands", "Panama", "Jersey", "Guernsey", "Isle of Man", "Bermuda"];
    if (jurisdiction && highRiskJurisdictions.some(j => jurisdiction.toLowerCase().includes(j.toLowerCase()))) {
      flags.push(`High-risk jurisdiction: ${jurisdiction}`);
      score += 15;
    }
    if (data.profile.registered_office_address?.country && 
        !data.profile.registered_office_address.country.toLowerCase().includes("united kingdom") &&
        !data.profile.registered_office_address.country.toLowerCase().includes("england") &&
        !data.profile.registered_office_address.country.toLowerCase().includes("wales") &&
        !data.profile.registered_office_address.country.toLowerCase().includes("scotland")) {
      flags.push(`Overseas registered address: ${data.profile.registered_office_address.country}`);
      score += 10;
    }

    const incorporationDate = data.profile.date_of_creation;
    if (incorporationDate) {
      const ageYears = (Date.now() - new Date(incorporationDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
      if (ageYears < 1) {
        flags.push(`Recently incorporated (${Math.round(ageYears * 12)} months ago)`);
        score += 10;
      }
    }
  }

  const activePscs = (data.pscs || []).filter((p: any) => !p.ceased_on);
  if (activePscs.length === 0 && data.profile?.type !== "registered-overseas-entity") {
    flags.push("No active PSCs identified");
    score += 10;
  }

  const activeOfficers = (data.officers || []).filter((o: any) => !o.resigned_on);
  if (activeOfficers.length === 0) {
    flags.push("No active officers");
    score += 15;
  }

  const corporateDirectors = activeOfficers.filter((o: any) => o.officer_role === "corporate-director");
  if (corporateDirectors.length > 0) {
    flags.push(`${corporateDirectors.length} corporate director(s) — reduced transparency`);
    score += 10;
  }

  if (sanctionsResult) {
    const hits = sanctionsResult.filter((s: any) => s.status === "strong_match" || s.status === "potential_match");
    if (hits.length > 0) {
      const sanctionsHits = hits.filter((h: any) => h.hasSanctions);
      const pepHits = hits.filter((h: any) => h.hasPep);
      const adverseHits = hits.filter((h: any) => h.hasAdverse);

      if (sanctionsHits.length > 0) {
        const strong = sanctionsHits.filter((h: any) => h.status === "strong_match");
        if (strong.length > 0) {
          flags.push(`🚨 SANCTIONS MATCH: ${strong.length} strong match(es)`);
          score += 50;
        } else {
          flags.push(`⚠️ Potential sanctions match: ${sanctionsHits.length} name(s) flagged`);
          score += 25;
        }
      }
      if (pepHits.length > 0) {
        const strongPep = pepHits.filter((h: any) => h.status === "strong_match");
        if (strongPep.length > 0) {
          flags.push(`🏛️ PEP MATCH: ${strongPep.length} politically-exposed person(s) (ComplyAdvantage)`);
          score += 30;
        } else {
          flags.push(`⚠️ Potential PEP match: ${pepHits.length} name(s) (ComplyAdvantage)`);
          score += 15;
        }
      }
      if (adverseHits.length > 0) {
        flags.push(`📰 Adverse media: ${adverseHits.length} name(s) flagged (ComplyAdvantage)`);
        score += 15;
      }
    }
  }

  let level = "low";
  if (score >= 60) level = "critical";
  else if (score >= 40) level = "high";
  else if (score >= 20) level = "medium";

  return { score: Math.min(score, 100), level, flags };
}

/**
 * Find the most recent "accounts" filing that has a downloadable document,
 * fetch the PDF via the CH document-api, extract text, and return a digest
 * for AI summarisation. Returns null if no accounts doc is available
 * (e.g. scanned-only PDF with no text layer, or filing has no document_metadata).
 */
async function fetchLatestAccountsText(filings: any[]): Promise<{
  date: string;
  description: string;
  documentId: string;
  text: string;
} | null> {
  const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
  if (!apiKey) return null;

  const accountsFilings = (filings || [])
    .filter((f: any) => f.category === "accounts" && f.links?.document_metadata)
    .sort((a: any, b: any) => (b.date || "").localeCompare(a.date || ""));

  for (const f of accountsFilings.slice(0, 3)) {
    try {
      const metaUrl: string = f.links.document_metadata;
      const documentId = metaUrl.split("/").filter(Boolean).pop();
      if (!documentId) continue;
      const auth = `Basic ${Buffer.from(apiKey + ":").toString("base64")}`;
      const docRes = await fetch(
        `https://document-api.company-information.service.gov.uk/document/${encodeURIComponent(documentId)}/content`,
        { headers: { Authorization: auth, Accept: "application/pdf" }, redirect: "follow" },
      );
      if (!docRes.ok) continue;
      const buf = Buffer.from(await docRes.arrayBuffer());
      const pdfModule: any = await import("pdf-parse");
      const PDFParse = pdfModule.PDFParse || pdfModule.default || pdfModule;
      let text = "";
      try {
        const parser = new PDFParse(new Uint8Array(buf));
        const data = await parser.getText();
        text = typeof data === "string" ? data : (data as any)?.text || "";
        try { parser.destroy?.(); } catch {}
      } catch {
        const parsed = await (pdfModule.default || pdfModule)(buf);
        text = parsed?.text || "";
      }
      if (text && text.trim().length > 200) {
        return {
          date: f.date,
          description: f.description || f.type || "Accounts",
          documentId,
          text: text.slice(0, 40000),
        };
      }
    } catch (err: any) {
      console.warn(`[kyc-clouseau] accounts fetch failed for filing ${f.date}:`, err?.message);
    }
  }
  return null;
}

async function summariseAccounts(companyName: string, accounts: { date: string; description: string; text: string }): Promise<string> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });
    const prompt = `You are a financial analyst reviewing UK Companies House statutory accounts for ${companyName}. The document below was filed on ${accounts.date} (${accounts.description}). Extract the key financial indicators and assess covenant strength as a tenant or counterparty.

Return a concise markdown section with these parts — use actual figures wherever present, and say "not disclosed" rather than guessing:

**Period covered:** e.g. year ended 31 Dec 2024
**Size regime:** micro-entity / small / medium / full
**P&L highlights:** turnover, operating profit/(loss), profit before tax, comparison with prior year
**Balance sheet:** net assets / (liabilities), cash, debtors, creditors falling due within 1y, long-term creditors
**Liquidity:** current ratio if computable; working capital position
**Going concern:** any going-concern notes, qualifications, or auditor concerns
**Trend:** one sentence on direction of travel vs prior year
**Covenant verdict:** a single-sentence judgement — e.g. "Strong covenant — well-capitalised with growing profitability", or "Weak covenant — loss-making and running down reserves"

Keep it under 250 words. Do not invent numbers. If the accounts are micro-entity with minimal disclosure, say so explicitly.

ACCOUNTS TEXT:
${accounts.text}`;

    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content[0].type === "text" ? res.content[0].text : "";
  } catch (err: any) {
    console.error("[kyc-clouseau] accounts summarise error:", err?.message);
    return "";
  }
}

async function runAiAnalysis(data: any, riskFlags: string[], ownershipChain: any, propertyContext?: any, accountsSummary?: string): Promise<string> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });

    const profile = data.profile || {};
    const activeOfficers = (data.officers || []).filter((o: any) => !o.resigned_on);
    const activePscs = (data.pscs || []).filter((p: any) => !p.ceased_on);

    const officerSummary = activeOfficers.map((o: any) => {
      const appointments = o.links?.officer?.appointments ? "multiple appointments" : "";
      return `- ${o.name} (${o.officer_role}${o.nationality ? `, ${o.nationality}` : ""}${o.date_of_birth ? `, DOB: ${o.date_of_birth.month}/${o.date_of_birth.year}` : ""}${appointments ? `, ${appointments}` : ""})`;
    }).join("\n");

    const pscSummary = activePscs.map((p: any) => {
      const controls = (p.natures_of_control || []).join(", ");
      return `- ${p.name} (${p.kind || "individual"}, controls: ${controls}${p.nationality ? `, nationality: ${p.nationality}` : ""})`;
    }).join("\n");

    const chainSummary = ownershipChain?.chain?.length > 0
      ? ownershipChain.chain.map((c: any, i: number) => {
          const ind = (c.individualPscs || []).map((p: any) => `      • ${p.name}${p.nationality ? ` (${p.nationality})` : ""}${p.controls?.length ? ` — ${p.controls.join(", ")}` : ""}`).join("\n");
          const corp = (c.corporatePscs || []).map((p: any) => `      ▸ ${p.name}${p.controls?.length ? ` — ${p.controls.join(", ")}` : ""}`).join("\n");
          return `  ${i + 1}. ${c.name} (${c.number})${ind ? `\n    Individual PSCs:\n${ind}` : ""}${corp ? `\n    Corporate PSCs:\n${corp}` : ""}`;
        }).join("\n")
      : "No corporate ownership chain discovered";

    const uboSummary = ownershipChain?.ubos?.length > 0
      ? ownershipChain.ubos.map((u: any) => `  • ${u.name}${u.nationality ? ` (${u.nationality})` : ""} — found at ${u.foundAt} (depth ${u.depth})${u.controls?.length ? ` — ${u.controls.join(", ")}` : ""}`).join("\n")
      : "No individual UBOs identified beyond the subject's direct PSCs";

    const prompt = `You are KYC Clouseau — an expert KYC/AML compliance investigator for a London commercial property agency. Produce a comprehensive intelligence report on this entity.

COMPANY PROFILE:
- Name: ${profile.company_name || "Unknown"}
- Number: ${profile.company_number || "Unknown"}
- Status: ${profile.company_status || "Unknown"}
- Type: ${profile.type || "Unknown"}
- Incorporated: ${profile.date_of_creation || "Unknown"}
- SIC codes: ${(profile.sic_codes || []).join(", ") || "None"}
- Registered address: ${profile.registered_office_address ? `${profile.registered_office_address.address_line_1 || ""}, ${profile.registered_office_address.locality || ""}, ${profile.registered_office_address.postal_code || ""}` : "Unknown"}
- Has charges: ${profile.has_charges || false}
- Has insolvency history: ${profile.has_insolvency_history || false}
- Accounts overdue: ${profile.accounts?.overdue || false}

ACTIVE OFFICERS (${activeOfficers.length}):
${officerSummary || "None"}

PERSONS WITH SIGNIFICANT CONTROL (${activePscs.length}):
${pscSummary || "None"}

OWNERSHIP CHAIN (PSC corporate trace, with individual UBOs at each level):
${chainSummary}

ULTIMATE BENEFICIAL OWNERS (individual people identified across the entire chain):
${uboSummary}

CHARGES/MORTGAGES (${(data.charges || []).length}):
${(data.charges || []).map((c: any) => `- ${c.status || "unknown"}: ${c.classification?.description || c.particulars?.description || "Charge"} — ${(c.persons_entitled || []).map((p: any) => p.name).join(", ") || "Unknown lender"}${c.created_on ? ` (created ${c.created_on})` : ""}${c.satisfied_on ? ` (satisfied ${c.satisfied_on})` : ""}`).join("\n") || "None"}

INSOLVENCY RECORDS: ${data.insolvency?.length || 0} case(s)
${data.insolvency?.map((i: any) => `- ${i.status}: ${i.case_type || "Unknown type"}`).join("\n") || "None"}

AUTOMATED RISK FLAGS:
${riskFlags.map(f => `- ${f}`).join("\n") || "None identified"}

RECENT FILINGS (last 10):
${(data.filings || []).slice(0, 10).map((f: any) => `- ${f.date}: ${f.description || f.type}`).join("\n") || "None"}
${accountsSummary ? `
LATEST STATUTORY ACCOUNTS (parsed from the filed PDF — use these actual figures in the FINANCIAL HEALTH INDICATORS section, don't just infer from filing status):
${accountsSummary}
` : ""}${propertyContext ? `
PROPERTY ACQUISITION CONTEXT:
This investigation originates from a Land Registry search. The user is exploring whether to acquire a property and needs to identify the best person to contact about purchasing it.
- Property address: ${propertyContext.propertyAddress || "Unknown"}
- Registered owner: ${propertyContext.ownerName || "Unknown"}
- Last price paid: ${propertyContext.pricePaid && !isNaN(Number(propertyContext.pricePaid)) ? `£${Number(propertyContext.pricePaid).toLocaleString()}` : propertyContext.pricePaid || "Unknown"}
- Mortgage lender: ${propertyContext.mortgageLender || "None/Unknown"}
` : ""}
Please provide:

1. **EXECUTIVE SUMMARY** — 2-3 sentence overview of this entity and its risk profile
2. **CONTROLLING INDIVIDUALS / UBOs** — Who really controls this entity? The "ULTIMATE BENEFICIAL OWNERS" section above lists every individual PSC found across the corporate chain — these ARE the answer. List each by name, where in the chain they sit, and their nationality. If the chain ended without surfacing individuals, say "no individual UBO disclosed up to depth N — recommend manual Companies House check on [last entity in chain]" rather than saying you can't determine the UBO.
${propertyContext ? `3. **ACQUISITION CONTACT STRATEGY** — Based on the ownership structure, officers, and corporate hierarchy, who is the BEST person to approach about purchasing the property? Consider:
   - Who is the actual decision-maker (not just the registered owner — follow the chain to the person with authority)?
   - If this is an SPV or holding company, who at the parent entity handles disposals?
   - Rank the contacts from most to least likely to have disposal authority
   - Suggest the best approach channel (direct, via agent, solicitor, etc.)
   - Note any debt/charge holders who may also need to be involved
4. **TENANT & OCCUPIER INTELLIGENCE** — Based on the property type and any available signals, what can be inferred about tenants or occupiers? Any known lease obligations that would affect an acquisition?
5. **DEBT & CHARGES ANALYSIS** — Who holds charges over the company's assets? What does this mean for a potential acquisition? Is the mortgage lender likely to be involved in any disposal?` :
`3. **ASSOCIATE NETWORK** — Based on officer overlaps, PSC connections, and corporate structures, who are the key associates and connected parties? Flag any concerning patterns.`}
${propertyContext ? `6` : `4`}. **FINANCIAL HEALTH INDICATORS** — Based on filing patterns, account status, charges, and any available signals.${propertyContext ? " Is the entity likely motivated to sell?" : ""}
${propertyContext ? `7` : `5`}. **JURISDICTION & STRUCTURE ANALYSIS** — Is this an SPV? Offshore structure? Multiple layers of corporate ownership? How transparent is the structure?
${propertyContext ? `8` : `6`}. **RED FLAGS & CONCERNS** — Any PEP (Politically Exposed Person) indicators, sanctions proximity, adverse media signals, or structural concerns.
${propertyContext ? `9` : `7`}. **COMPLIANCE RECOMMENDATION** — Clear recommendation: APPROVE / ENHANCED DUE DILIGENCE REQUIRED / REFER TO MLRO / REJECT
${propertyContext ? `10` : `8`}. **SUGGESTED NEXT STEPS** — What additional checks should be performed?

Format with clear headers and be specific. Reference actual names and data points. This is a professional compliance document.`;

    const res = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });

    return res.content[0].type === "text" ? res.content[0].text : "Analysis unavailable";
  } catch (err: any) {
    console.error("[kyc-clouseau] AI analysis error:", err.message);
    return `AI analysis failed: ${err.message}`;
  }
}

/**
 * Shared helper used by the /investigate route AND by Property Pathway's
 * Stage 4 — runs a full company KYC, persists it to kyc_investigations so
 * the same record appears in Clouseau's Investigation History regardless
 * of where the investigation was kicked off from.
 *
 * Returns `{ result, investigationId }`. `investigationId` is the primary
 * key in kyc_investigations (null if DB insert failed).
 */
export async function runCompanyInvestigation(opts: {
  companyNumber?: string;
  companyName?: string;
  propertyContext?: any;
  crmCompanyId?: string | null;
  userId?: string | null;
  skipAi?: boolean;
}): Promise<{ result: InvestigationResult; investigationId: number | null }> {
  const { companyNumber, companyName, propertyContext, crmCompanyId, userId = null, skipAi = false } = opts;

  if (!companyNumber && !companyName) {
    throw new Error("Provide companyNumber or companyName");
  }

  let targetNumber = companyNumber;
  if (!targetNumber && companyName) {
    const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=1`);
    if (searchData.items?.length > 0) {
      targetNumber = searchData.items[0].company_number;
    } else {
      throw new Error(`No company found matching "${companyName}"`);
    }
  }

  console.log(`[kyc-clouseau] Starting investigation: ${targetNumber}`);

  const companyData = await getCompanyData(targetNumber!);

  let ownershipChain = null;
  try {
    ownershipChain = await discoverUltimateParent(targetNumber!);
  } catch {}

  const namesToScreen: string[] = [];
  if (companyData.profile?.company_name) namesToScreen.push(companyData.profile.company_name);
  const activeOfficers = (companyData.officers || []).filter((o: any) => !o.resigned_on);
  activeOfficers.forEach((o: any) => { if (o.name) namesToScreen.push(o.name); });
  const activePscs = (companyData.pscs || []).filter((p: any) => !p.ceased_on);
  activePscs.forEach((p: any) => { if (p.name) namesToScreen.push(p.name); });

  const sanctionsResult = await screenSanctions(namesToScreen);
  const risk = assessRisk(companyData, sanctionsResult);

  // Download & summarise the latest statutory accounts PDF in parallel with AI analysis.
  // Scanned-only accounts (no text layer) return null and we degrade gracefully.
  let accountsAnalysis: InvestigationResult["accountsAnalysis"] = null;
  const accountsPromise = (async () => {
    try {
      const accounts = await fetchLatestAccountsText(companyData.filings || []);
      if (!accounts) return null;
      const subjectName = companyData.profile?.company_name || companyName || targetNumber!;
      const summary = await summariseAccounts(subjectName, accounts);
      if (!summary) return null;
      console.log(`[kyc-clouseau] accounts summarised for ${targetNumber} (${accounts.date})`);
      return {
        filingDate: accounts.date,
        description: accounts.description,
        documentId: accounts.documentId,
        summary,
      };
    } catch (err: any) {
      console.warn(`[kyc-clouseau] accounts pipeline failed for ${targetNumber}:`, err?.message);
      return null;
    }
  })();

  let aiAnalysis = "";
  if (!skipAi) {
    try {
      // Wait for accounts first (capped) so the main analysis can fold in real figures.
      const accountsTimeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 45000));
      accountsAnalysis = await Promise.race([accountsPromise, accountsTimeout]);
      const aiPromise = runAiAnalysis(companyData, risk.flags, ownershipChain, propertyContext, accountsAnalysis?.summary);
      // Complex UBO walks (multi-level ownership chains + accounts summary) can run
      // close to or past 90s on Anthropic's side. 180s matches the background-AI
      // pathway at runPropertyIntelligenceAi().
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("AI analysis timed out after 180s")), 180000));
      aiAnalysis = await Promise.race([aiPromise, timeoutPromise]);
    } catch (aiErr: any) {
      aiAnalysis = `AI analysis unavailable (${aiErr.message}). Structured data and risk scoring are shown below.`;
    }
  } else {
    // Still resolve accounts even when skipping AI narrative so the summary is persisted.
    accountsAnalysis = await Promise.race([
      accountsPromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30000)),
    ]);
  }

  const result: InvestigationResult = {
    subject: {
      name: companyData.profile?.company_name || companyName || targetNumber!,
      companyNumber: targetNumber,
      type: "company",
    },
    companyProfile: companyData.profile,
    officers: activeOfficers,
    pscs: activePscs,
    ownershipChain,
    filingHistory: (companyData.filings || []).slice(0, 20),
    insolvencyHistory: companyData.insolvency,
    sanctionsScreening: sanctionsResult,
    aiAnalysis,
    accountsAnalysis,
    riskScore: risk.score,
    riskLevel: risk.level as any,
    flags: risk.flags,
    charges: companyData.charges || [],
    propertyContext: propertyContext || null,
    timestamp: new Date().toISOString(),
  };

  if (targetNumber && process.env.PROPERTYDATA_API_KEY) {
    try {
      const pdRes = await fetch(
        `https://api.propertydata.co.uk/freeholds?company_number=${encodeURIComponent(targetNumber)}&key=${process.env.PROPERTYDATA_API_KEY}`
      );
      if (pdRes.ok) {
        const pdData = await pdRes.json();
        (result as any).propertiesOwned = pdData;
      }
    } catch (pdErr: any) {
      console.warn("[kyc-clouseau] PropertyData fetch failed:", pdErr.message);
    }
  }

  const hasSanctionsMatch = sanctionsResult
    ? sanctionsResult.some((s: any) => s.status === "strong_match" || s.status === "potential_match")
    : false;

  let investigationId: number | null = null;
  try {
    const insertResult = await pool.query(
      `INSERT INTO kyc_investigations (subject_type, subject_name, company_number, crm_company_id, risk_level, risk_score, sanctions_match, result, conducted_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        "company",
        result.subject.name,
        targetNumber,
        crmCompanyId || null,
        risk.level,
        risk.score,
        hasSanctionsMatch,
        JSON.stringify(result),
        userId,
      ]
    );
    investigationId = insertResult.rows[0]?.id ?? null;
    if (investigationId) {
      await logKycAudit(investigationId, "created", userId, `Company investigation: ${result.subject.name}`);
    }
  } catch (dbErr: any) {
    console.warn("[kyc-clouseau] Failed to save investigation:", dbErr.message);
  }

  console.log(`[kyc-clouseau] Investigation complete: ${result.subject.name} — risk: ${risk.level} (${risk.score})`);
  return { result, investigationId };
}

router.post("/api/kyc-clouseau/investigate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNumber, companyName, propertyContext } = req.body;
    const userId = (req as any).user?.id || null;
    const { result, investigationId } = await runCompanyInvestigation({
      companyNumber,
      companyName,
      propertyContext,
      crmCompanyId: req.body.crmCompanyId || null,
      userId,
    });
    res.json({ ...result, investigationId });
  } catch (err: any) {
    console.error("[kyc-clouseau] Investigation error:", err.message);
    if (/No company found matching/i.test(err.message)) {
      return res.status(404).json({ error: err.message });
    }
    if (/^Provide/i.test(err.message)) {
      return res.status(400).json({ error: err.message });
    }
    const userMessage = sanitizeErrorMessage(err.message, "Investigation failed");
    res.status(500).json({ error: userMessage });
  }
});

router.get("/api/kyc-clouseau/search", requireAuth, async (req: Request, res: Response) => {
  try {
    const q = req.query.q as string;
    if (!q || q.length < 2) return res.json({ items: [] });

    const [chResults, crmResults] = await Promise.allSettled([
      chFetch(`/search/companies?q=${encodeURIComponent(q)}&items_per_page=8`),
      pool.query(
        `SELECT id, name, companies_house_number as "companiesHouseNumber", kyc_status as "kycStatus" 
         FROM crm_companies 
         WHERE name ILIKE $1 
         LIMIT 5`,
        [`%${q}%`]
      ),
    ]);

    const items: any[] = [];

    if (chResults.status === "fulfilled") {
      (chResults.value.items || []).forEach((item: any) => {
        items.push({
          source: "companies-house",
          companyNumber: item.company_number,
          name: item.title,
          status: item.company_status,
          incorporatedDate: item.date_of_creation,
          address: item.address_snippet,
        });
      });
    }

    if (crmResults.status === "fulfilled") {
      crmResults.value.rows.forEach((row: any) => {
        items.push({
          source: "crm",
          companyNumber: row.companiesHouseNumber,
          name: row.name,
          crmId: row.id,
          kycStatus: row.kycStatus,
        });
      });
    }

    res.json({ items });
  } catch (err: any) {
    console.error("[kyc-clouseau] Search error:", err.message);
    const userMessage = sanitizeErrorMessage(err.message, "Search failed");
    res.status(500).json({ error: userMessage });
  }
});

router.post("/api/kyc-clouseau/officer-deep-dive", requireAuth, async (req: Request, res: Response) => {
  try {
    const { officerId, officerName } = req.body;
    if (!officerId) return res.status(400).json({ error: "officerId required" });

    const appointments = await chFetch(`/officers/${officerId}/appointments?items_per_page=50`);
    const items = appointments.items || [];

    const activeAppointments = items.filter((a: any) => !a.resigned_on);
    const resignedAppointments = items.filter((a: any) => a.resigned_on);

    const sanctionsResult = officerName ? await screenSanctions([officerName]) : null;

    let aiInsight = "";
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const appointmentList = activeAppointments.map((a: any) =>
        `- ${a.appointed_to?.company_name || "Unknown"} (${a.appointed_to?.company_number || "?"}) as ${a.officer_role} since ${a.appointed_on || "?"}`
      ).join("\n");

      const resignedList = resignedAppointments.slice(0, 15).map((a: any) =>
        `- ${a.appointed_to?.company_name || "Unknown"} (${a.appointed_to?.company_number || "?"}) as ${a.officer_role}, ${a.appointed_on || "?"} – ${a.resigned_on || "?"}`
      ).join("\n");

      const res2 = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [{
          role: "user",
          content: `You are KYC Clouseau. Analyse this individual's corporate footprint for KYC/AML purposes.

OFFICER: ${officerName || "Unknown"}
TOTAL APPOINTMENTS: ${items.length} (${activeAppointments.length} active, ${resignedAppointments.length} resigned)

ACTIVE APPOINTMENTS:
${appointmentList || "None"}

RECENT RESIGNED APPOINTMENTS (up to 15):
${resignedList || "None"}

SANCTIONS: ${sanctionsResult ? JSON.stringify(sanctionsResult.slice(0, 3)) : "Not screened"}

Provide:
1. **PROFILE SUMMARY** — Who is this person based on their corporate footprint?
2. **NETWORK ANALYSIS** — What sectors/industries? Any patterns in company types (SPVs, holding companies, property vehicles)?
3. **RED FLAGS** — Frequent directorships? Dissolved companies? Unusual patterns?
4. **RISK ASSESSMENT** — Low/Medium/High with reasoning`,
        }],
      });

      aiInsight = res2.content[0].type === "text" ? res2.content[0].text : "";
    } catch (err: any) {
      aiInsight = `AI analysis unavailable: ${err.message}`;
    }

    res.json({
      officerName,
      totalAppointments: items.length,
      activeAppointments,
      resignedAppointments: resignedAppointments.slice(0, 20),
      sanctionsScreening: sanctionsResult,
      aiInsight,
    });
  } catch (err: any) {
    console.error("[kyc-clouseau] Officer deep-dive error:", err.message);
    const userMessage = sanitizeErrorMessage(err.message, "Officer deep-dive failed");
    res.status(500).json({ error: userMessage });
  }
});

// History endpoints
router.get("/api/kyc-clouseau/history/:companyNumber", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNumber } = req.params;
    const result = await pool.query(
      `SELECT id, subject_type, subject_name, company_number, risk_level, risk_score, sanctions_match, conducted_by, conducted_at, notes
       FROM kyc_investigations
       WHERE company_number = $1
       ORDER BY conducted_at DESC
       LIMIT 10`,
      [companyNumber]
    );
    res.json({ investigations: result.rows });
  } catch (err: any) {
    console.error("[kyc-clouseau] History error:", err.message);
    res.status(500).json({ error: "Failed to fetch investigation history" });
  }
});

router.get("/api/kyc-clouseau/history/crm/:companyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyId } = req.params;
    const result = await pool.query(
      `SELECT id, subject_type, subject_name, company_number, risk_level, risk_score, sanctions_match, conducted_by, conducted_at, notes
       FROM kyc_investigations
       WHERE crm_company_id = $1
       ORDER BY conducted_at DESC
       LIMIT 10`,
      [companyId]
    );
    res.json({ investigations: result.rows });
  } catch (err: any) {
    console.error("[kyc-clouseau] CRM history error:", err.message);
    res.status(500).json({ error: "Failed to fetch investigation history" });
  }
});

router.get("/api/kyc-clouseau/investigation/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT * FROM kyc_investigations WHERE id = $1`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Investigation not found" });
    }
    res.json(result.rows[0]);
  } catch (err: any) {
    console.error("[kyc-clouseau] Investigation fetch error:", err.message);
    res.status(500).json({ error: "Failed to fetch investigation" });
  }
});

// Re-runs just the AI narrative for a saved company investigation. Used when the
// original synchronous AI call timed out (complex UBO walks can run long) — the
// structured data and risk score stay intact; we only regenerate aiAnalysis.
router.post("/api/kyc-clouseau/investigation/:id/regenerate-ai", requireAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const row = await pool.query(
      `SELECT * FROM kyc_investigations WHERE id = $1`,
      [id]
    );
    if (row.rows.length === 0) return res.status(404).json({ error: "Investigation not found" });

    const inv = row.rows[0];
    if (inv.subject_type !== "company") {
      return res.status(400).json({ error: "Regenerate is only supported for company investigations" });
    }
    const existing = inv.result || {};
    const companyNumber = inv.company_number || existing?.subject?.companyNumber;
    if (!companyNumber) return res.status(400).json({ error: "No company number on this investigation" });

    // Mark pending so the client UI can show a spinner while the rerun runs.
    await pool.query(
      `UPDATE kyc_investigations SET result = jsonb_set(COALESCE(result, '{}'::jsonb), '{aiStatus}', '"pending"'::jsonb) WHERE id = $1`,
      [id]
    );
    res.json({ ok: true, investigationId: Number(id), aiStatus: "pending" });

    // Fire-and-forget re-run. Pulls fresh CH data (so the rerun also catches
    // officer/PSC changes) and replaces aiAnalysis on the stored row.
    (async () => {
      try {
        const companyData = await getCompanyData(companyNumber);
        let ownershipChain: any = null;
        try { ownershipChain = await discoverUltimateParent(companyNumber); } catch {}
        const risk = assessRisk(companyData, existing?.sanctionsScreening || { matches: [], screened: [] });
        const accountsSummary = existing?.accountsAnalysis?.summary;
        const propertyContext = existing?.propertyContext || null;
        const aiPromise = runAiAnalysis(companyData, risk.flags, ownershipChain, propertyContext, accountsSummary);
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("AI analysis timed out after 180s")), 180000)
        );
        let aiAnalysis = "";
        let aiStatus: "complete" | "failed" = "complete";
        try {
          aiAnalysis = await Promise.race([aiPromise, timeoutPromise]);
        } catch (aiErr: any) {
          aiAnalysis = `AI analysis unavailable (${aiErr?.message || "unknown error"}). Structured data and risk scoring are shown below.`;
          aiStatus = "failed";
        }
        const merged = { ...existing, aiAnalysis, aiStatus };
        await pool.query(
          `UPDATE kyc_investigations SET result = $1 WHERE id = $2`,
          [JSON.stringify(merged), id]
        );
        console.log(`[kyc-clouseau] Regenerate AI ${aiStatus} for investigation ${id}`);
      } catch (err: any) {
        console.warn(`[kyc-clouseau] Regenerate AI crashed for ${id}:`, err?.message);
        try {
          const failed = { ...existing, aiAnalysis: `AI analysis unavailable (${err?.message || "unknown error"}). Structured data and risk scoring are shown below.`, aiStatus: "failed" };
          await pool.query(`UPDATE kyc_investigations SET result = $1 WHERE id = $2`, [JSON.stringify(failed), id]);
        } catch {}
      }
    })();
  } catch (err: any) {
    console.error("[kyc-clouseau] Regenerate AI error:", err.message);
    res.status(500).json({ error: "Failed to queue AI regeneration" });
  }
});

// Global recent searches — powers the "Recent searches" panel at the top of
// the Clouseau page so the team can see (and reopen) everything that's been
// run across company / individual / property intelligence modes.
router.get("/api/kyc-clouseau/recent", requireAuth, async (req: Request, res: Response) => {
  try {
    const limit = Math.min(parseInt(String(req.query.limit || "200"), 10) || 200, 1000);
    const typeFilter = String(req.query.type || "").trim();
    const mineOnly = String(req.query.mine || "").toLowerCase() === "true";
    const search = String(req.query.q || "").trim();

    const conditions: string[] = [];
    const values: any[] = [];

    if (typeFilter && ["company", "individual", "property_intelligence"].includes(typeFilter)) {
      values.push(typeFilter);
      conditions.push(`subject_type = $${values.length}`);
    }
    if (mineOnly) {
      const userId = (req as any).user?.id || null;
      if (userId) {
        values.push(userId);
        conditions.push(`conducted_by = $${values.length}`);
      }
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(subject_name ILIKE $${values.length} OR company_number ILIKE $${values.length})`);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    values.push(limit);
    // sources[] is derived from the stored result JSON so the Clouseau UI can
    // show which external data providers actually ran for each investigation
    // (Companies House, OFSI/OFAC sanctions, Perplexity adverse media, Land
    // Registry, AI analysis). Cheap enough for LIMIT N rows.
    const sql = `
      SELECT id, subject_type, subject_name, company_number, risk_level, risk_score,
             sanctions_match, conducted_by, conducted_at, notes,
             ARRAY_REMOVE(ARRAY[
               CASE WHEN (result -> 'companyProfile') ->> 'company_number' IS NOT NULL
                      OR jsonb_typeof(result -> 'officers') = 'array'
                      OR jsonb_typeof(result -> 'pscs') = 'array'
                    THEN 'companies_house' END,
               CASE WHEN jsonb_typeof(result -> 'sanctionsScreening') = 'array'
                    THEN 'sanctions' END,
               CASE WHEN result ? 'adverseMedia'
                      OR jsonb_typeof(result -> 'perplexityResults') = 'array'
                      OR jsonb_typeof(result -> 'adverseMediaFindings') = 'array'
                    THEN 'perplexity' END,
               CASE WHEN result ? 'propertiesOwned'
                      OR result ? 'propertyContext'
                      OR result ? 'landRegistry'
                      OR result ? 'matched'
                    THEN 'land_registry' END,
               CASE WHEN length(coalesce(result ->> 'aiAnalysis', '')) > 10
                      OR (result ->> 'aiStatus') = 'complete'
                    THEN 'ai' END
             ], NULL) AS sources
      FROM kyc_investigations
      ${where}
      ORDER BY conducted_at DESC
      LIMIT $${values.length}
    `;
    const result = await pool.query(sql, values);
    res.json({ investigations: result.rows });
  } catch (err: any) {
    console.error("[kyc-clouseau] Recent error:", err.message);
    res.status(500).json({ error: "Failed to fetch recent investigations" });
  }
});

// Individual person investigation
router.post("/api/kyc-clouseau/investigate-individual", requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, dateOfBirth, companyNumbers } = req.body;
    if (!name) {
      return res.status(400).json({ error: "Name is required" });
    }

    console.log(`[kyc-clouseau] Starting individual investigation: ${name}`);

    // Search for officers matching this name
    const officerSearchData = await chFetch(`/search/officers?q=${encodeURIComponent(name)}&items_per_page=10`);
    const officerItems = officerSearchData.items || [];

    // Fetch appointments for each matching officer
    const officerDetails: any[] = [];
    for (const officer of officerItems.slice(0, 5)) {
      const officerLink = officer.links?.self || "";
      const officerId = officerLink.replace("/officers/", "");
      if (!officerId) continue;

      try {
        const appointments = await chFetch(`/officers/${officerId}/appointments?items_per_page=50`);
        officerDetails.push({
          ...officer,
          officerId,
          appointments: appointments.items || [],
          totalAppointments: appointments.total_results || 0,
        });
      } catch (err: any) {
        console.warn(`[kyc-clouseau] Failed to fetch appointments for officer ${officerId}:`, err.message);
        officerDetails.push({ ...officer, officerId, appointments: [], totalAppointments: 0 });
      }
    }

    // Collect all company numbers this person is associated with
    const associatedCompanies = new Set<string>();
    for (const officer of officerDetails) {
      for (const appt of officer.appointments) {
        if (appt.appointed_to?.company_number) {
          associatedCompanies.add(appt.appointed_to.company_number);
        }
      }
    }
    // Add any explicitly provided company numbers
    if (companyNumbers && Array.isArray(companyNumbers)) {
      companyNumbers.forEach((cn: string) => { if (cn.trim()) associatedCompanies.add(cn.trim()); });
    }

    // Fetch charges for associated companies (limit to first 10)
    const companyCharges: Record<string, any[]> = {};
    const companyProfiles: Record<string, any> = {};
    const companyNumbersArr = Array.from(associatedCompanies).slice(0, 10);
    for (const cn of companyNumbersArr) {
      try {
        const padded = cn.padStart(8, "0");
        const [profileRes, chargesRes] = await Promise.allSettled([
          chFetch(`/company/${padded}`),
          chFetch(`/company/${padded}/charges`),
        ]);
        if (profileRes.status === "fulfilled") companyProfiles[cn] = profileRes.value;
        if (chargesRes.status === "fulfilled") companyCharges[cn] = chargesRes.value.items || [];
      } catch {}
    }

    // Run sanctions check on the individual
    const sanctionsResult = await screenSanctions([name]);

    // Build risk assessment for individual
    const flags: string[] = [];
    let riskScore = 0;

    if (officerDetails.length === 0) {
      flags.push("No matching officer records found at Companies House");
      riskScore += 5;
    }

    const totalActiveAppointments = officerDetails.reduce((sum, o) =>
      sum + (o.appointments || []).filter((a: any) => !a.resigned_on).length, 0);
    const totalResignedAppointments = officerDetails.reduce((sum, o) =>
      sum + (o.appointments || []).filter((a: any) => a.resigned_on).length, 0);

    if (totalActiveAppointments > 10) {
      flags.push(`High number of active directorships: ${totalActiveAppointments}`);
      riskScore += 15;
    }
    if (totalResignedAppointments > 20) {
      flags.push(`Extensive resignation history: ${totalResignedAppointments} resigned appointments`);
      riskScore += 10;
    }

    // Check for dissolved companies
    const dissolvedCount = Object.values(companyProfiles).filter((p: any) => p.company_status === "dissolved").length;
    if (dissolvedCount > 3) {
      flags.push(`Associated with ${dissolvedCount} dissolved companies`);
      riskScore += 15;
    }

    // Sanctions
    const hasSanctionsMatch = sanctionsResult
      ? sanctionsResult.some((s: any) => s.status === "strong_match" || s.status === "potential_match")
      : false;
    if (sanctionsResult) {
      const strongMatches = sanctionsResult.filter((s: any) => s.status === "strong_match");
      const potentialMatches = sanctionsResult.filter((s: any) => s.status === "potential_match");
      if (strongMatches.length > 0) {
        flags.push(`SANCTIONS MATCH: ${strongMatches.length} strong match(es)`);
        riskScore += 50;
      } else if (potentialMatches.length > 0) {
        flags.push(`Potential sanctions match: ${potentialMatches.length} name(s) flagged`);
        riskScore += 25;
      }
    }

    // Outstanding charges
    const totalOutstandingCharges = Object.values(companyCharges).reduce((sum, charges) =>
      sum + charges.filter((c: any) => c.status === "outstanding").length, 0);
    if (totalOutstandingCharges > 0) {
      flags.push(`${totalOutstandingCharges} outstanding charges across associated companies`);
      riskScore += 10;
    }

    riskScore = Math.min(riskScore, 100);
    let riskLevel = "low";
    if (riskScore >= 60) riskLevel = "critical";
    else if (riskScore >= 40) riskLevel = "high";
    else if (riskScore >= 20) riskLevel = "medium";

    // AI analysis for individual
    let aiAnalysis = "";
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
        ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
          ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
          : {}),
      });

      const activeAppointmentsList = officerDetails.flatMap(o =>
        (o.appointments || []).filter((a: any) => !a.resigned_on).map((a: any) =>
          `- ${a.appointed_to?.company_name || "Unknown"} (${a.appointed_to?.company_number || "?"}) as ${a.officer_role} since ${a.appointed_on || "?"}`
        )
      ).join("\n");

      const resignedAppointmentsList = officerDetails.flatMap(o =>
        (o.appointments || []).filter((a: any) => a.resigned_on).map((a: any) =>
          `- ${a.appointed_to?.company_name || "Unknown"} (${a.appointed_to?.company_number || "?"}) as ${a.officer_role}, ${a.appointed_on || "?"} – ${a.resigned_on || "?"}`
        )
      ).slice(0, 20).join("\n");

      const chargesSummary = Object.entries(companyCharges).map(([cn, charges]) => {
        const profile = companyProfiles[cn];
        return `${profile?.company_name || cn} (${cn}): ${charges.length} charge(s) — ${charges.map((c: any) =>
          `${c.status || "unknown"}: ${(c.persons_entitled || []).map((p: any) => p.name).join(", ") || "Unknown lender"}`
        ).join("; ")}`;
      }).join("\n");

      const prompt = `You are KYC Clouseau — an expert KYC/AML compliance investigator for a London commercial property agency. Produce a comprehensive intelligence report on this INDIVIDUAL.

INDIVIDUAL: ${name}
${dateOfBirth ? `DATE OF BIRTH: ${dateOfBirth}` : ""}

OFFICER SEARCH MATCHES: ${officerDetails.length} match(es) found at Companies House
TOTAL ACTIVE APPOINTMENTS: ${totalActiveAppointments}
TOTAL RESIGNED APPOINTMENTS: ${totalResignedAppointments}

ACTIVE APPOINTMENTS:
${activeAppointmentsList || "None"}

RECENT RESIGNED APPOINTMENTS (up to 20):
${resignedAppointmentsList || "None"}

CHARGES/MORTGAGES ON ASSOCIATED COMPANIES:
${chargesSummary || "None"}

SANCTIONS SCREENING: ${sanctionsResult ? JSON.stringify(sanctionsResult.slice(0, 5)) : "Not available"}

AUTOMATED RISK FLAGS:
${flags.map(f => `- ${f}`).join("\n") || "None identified"}

Please provide:
1. **IDENTITY SUMMARY** — Who is this person? What is their corporate footprint? Summarise all known identities and officer records.
2. **COMPANIES CONTROLLED/DIRECTED** — List every company they control or direct, with current status, incorporation date, and their role.
3. **OWNERSHIP CHAIN ANALYSIS** — For each company, describe the ownership structure. Are these SPVs? Holding companies? Part of a group?
4. **FINANCIAL EXPOSURE** — What charges/mortgages exist across their companies? Who are the lenders? What is the total debt exposure signal?
5. **SANCTIONS STATUS** — Clear summary of sanctions screening results.
6. **NETWORK ANALYSIS** — What sectors/industries? Any patterns in company types? Connections to other individuals?
7. **RED FLAGS & CONCERNS** — Frequent directorships? Dissolved companies? Unusual patterns? PEP indicators?
8. **RISK ASSESSMENT** — Overall risk level with detailed reasoning.
9. **COMPLIANCE RECOMMENDATION** — APPROVE / ENHANCED DUE DILIGENCE REQUIRED / REFER TO MLRO / REJECT
10. **SUGGESTED NEXT STEPS** — What additional checks should be performed?

Format with clear headers and be specific. This is a professional compliance document.`;

      const aiRes = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4000,
        messages: [{ role: "user", content: prompt }],
      });

      aiAnalysis = aiRes.content[0].type === "text" ? aiRes.content[0].text : "Analysis unavailable";
    } catch (aiErr: any) {
      aiAnalysis = `AI analysis unavailable (${aiErr.message}). Structured data is shown below.`;
    }

    const result = {
      subject: {
        name,
        type: "individual" as const,
        dateOfBirth: dateOfBirth || null,
      },
      officerMatches: officerDetails,
      associatedCompanies: companyNumbersArr.map(cn => ({
        companyNumber: cn,
        profile: companyProfiles[cn] || null,
        charges: companyCharges[cn] || [],
      })),
      sanctionsScreening: sanctionsResult,
      aiAnalysis,
      riskScore,
      riskLevel,
      flags,
      timestamp: new Date().toISOString(),
    };

    // Save to kyc_investigations
    const userId = (req as any).user?.id || null;
    try {
      const insertResult = await pool.query(
        `INSERT INTO kyc_investigations (subject_type, subject_name, officer_name, risk_level, risk_score, sanctions_match, result, conducted_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          "individual",
          name,
          name,
          riskLevel,
          riskScore,
          hasSanctionsMatch,
          JSON.stringify(result),
          userId,
        ]
      );
      const investigationId = insertResult.rows[0]?.id;
      if (investigationId) {
        await logKycAudit(investigationId, "created", userId, `Individual investigation: ${name}`);
      }
    } catch (dbErr: any) {
      console.warn("[kyc-clouseau] Failed to save individual investigation:", dbErr.message);
    }

    console.log(`[kyc-clouseau] Individual investigation complete: ${name} — risk: ${riskLevel} (${riskScore})`);
    res.json(result);
  } catch (err: any) {
    console.error("[kyc-clouseau] Individual investigation error:", err.message);
    const userMessage = sanitizeErrorMessage(err.message, "Individual investigation failed");
    res.status(500).json({ error: userMessage });
  }
});

// --- Enhanced Property Intelligence Investigation ---
// Traces full UBO chain, deep-dives decision makers, finds managing/leasing agents,
// checks building availability, maps associate network
router.post("/api/kyc-clouseau/property-intelligence", requireAuth, async (req: Request, res: Response) => {
  // Hard request ceiling — the old route could hang indefinitely when CH was
  // slow or the AI API stalled. Node defaults to no socket timeout on POST,
  // so set one explicitly.
  req.setTimeout(180000);
  res.setTimeout(180000);
  try {
    const { companyNumber, companyName, propertyAddress, propertyName } = req.body;
    if (!companyNumber && !companyName) {
      return res.status(400).json({ error: "Provide companyNumber or companyName" });
    }

    console.log(`[kyc-clouseau] Starting property intelligence: ${companyName || companyNumber}`);

    // 1. Resolve company number
    let targetNumber = companyNumber;
    if (!targetNumber && companyName) {
      const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=1`);
      if (searchData.items?.length > 0) {
        targetNumber = searchData.items[0].company_number;
      } else {
        return res.status(404).json({ error: `No company found matching "${companyName}"` });
      }
    }

    // 2. Get full company data
    const companyData = await getCompanyData(targetNumber);
    const activeOfficers = (companyData.officers || []).filter((o: any) => !o.resigned_on);
    const activePscs = (companyData.pscs || []).filter((p: any) => !p.ceased_on);

    // 3. UBO chain trace — depth reduced from 8 → 5 levels. Each extra level
    // costs 3-5 CH calls per entity it finds; 5 is enough for >99% of real
    // ownership chains and keeps the total walk under ~30 API calls.
    let ownershipChain = null;
    try {
      ownershipChain = await discoverUltimateParent(targetNumber, 5);
    } catch {}

    // For each entity in the chain, get officers and PSCs
    const chainDetails: any[] = [];
    if (ownershipChain?.chain) {
      const limit = pLimit(3);
      const chainFetches = ownershipChain.chain.map((link: any) =>
        limit(async () => {
          try {
            const padded = link.number.padStart(8, "0");
            const [profileRes, officerRes, pscRes] = await Promise.allSettled([
              chFetch(`/company/${padded}`),
              chFetch(`/company/${padded}/officers?items_per_page=20`),
              chFetch(`/company/${padded}/persons-with-significant-control`),
            ]);
            return {
              ...link,
              profile: profileRes.status === "fulfilled" ? profileRes.value : null,
              officers: officerRes.status === "fulfilled" ? (officerRes.value.items || []).filter((o: any) => !o.resigned_on) : [],
              pscs: pscRes.status === "fulfilled" ? (pscRes.value.items || []).filter((p: any) => !p.ceased_on) : [],
            };
          } catch { return { ...link, profile: null, officers: [], pscs: [] }; }
        })
      );
      chainDetails.push(...(await Promise.all(chainFetches)));
    }

    // 4. Identify ALL natural persons (UBOs) across the entire chain
    const ubos: any[] = [];
    const uboNames = new Set<string>();

    // From direct PSCs
    for (const psc of activePscs) {
      if (psc.kind === "individual-person-with-significant-control" || !psc.kind?.includes("corporate")) {
        if (psc.name && !uboNames.has(psc.name)) {
          uboNames.add(psc.name);
          ubos.push({
            name: psc.name,
            nationality: psc.nationality,
            level: "direct",
            source: companyData.profile?.company_name || targetNumber,
            controls: psc.natures_of_control,
          });
        }
      }
    }

    // From chain entities
    for (const entity of chainDetails) {
      for (const psc of (entity.pscs || [])) {
        if (psc.kind === "individual-person-with-significant-control" || !psc.kind?.includes("corporate")) {
          if (psc.name && !uboNames.has(psc.name)) {
            uboNames.add(psc.name);
            ubos.push({
              name: psc.name,
              nationality: psc.nationality,
              level: "chain",
              source: entity.name,
              controls: psc.natures_of_control,
            });
          }
        }
      }
      // Also pick up directors at parent level as potential decision makers
      for (const officer of (entity.officers || [])) {
        if (officer.name && !uboNames.has(officer.name) && officer.officer_role === "director") {
          uboNames.add(officer.name);
          ubos.push({
            name: officer.name,
            nationality: officer.nationality,
            level: "chain_director",
            source: entity.name,
            role: officer.officer_role,
            appointedOn: officer.appointed_on,
          });
        }
      }
    }

    // 5. Deep-dive each decision maker — fetch their appointments.
    // Cap at top 6 UBOs (was 10) and 20 appointments each (was 50) — keeps
    // the total CH call count bounded so the endpoint can't exceed its
    // 3-minute ceiling even on large ownership webs.
    const decisionMakers: any[] = [];
    const dmLimit = pLimit(3);
    const dmFetches = ubos.slice(0, 6).map(ubo =>
      dmLimit(async () => {
        try {
          // Search for officer record by name
          const searchData = await chFetch(`/search/officers?q=${encodeURIComponent(ubo.name)}&items_per_page=5`);
          const matchingOfficers = (searchData.items || []).filter((o: any) => {
            const nameMatch = o.title?.toLowerCase() === ubo.name.toLowerCase();
            return nameMatch;
          });
          const bestMatch = matchingOfficers[0] || (searchData.items || [])[0];
          if (!bestMatch) return { ...ubo, appointments: [], companies: [] };

          const officerLink = bestMatch.links?.self || "";
          const officerId = officerLink.replace("/officers/", "");
          if (!officerId) return { ...ubo, appointments: [], companies: [] };

          const appointments = await chFetch(`/officers/${officerId}/appointments?items_per_page=20`);
          const activeAppts = (appointments.items || []).filter((a: any) => !a.resigned_on);
          const companies = activeAppts.map((a: any) => ({
            name: a.appointed_to?.company_name,
            number: a.appointed_to?.company_number,
            role: a.officer_role,
            appointedOn: a.appointed_on,
          }));

          return {
            ...ubo,
            officerId,
            totalAppointments: appointments.total_results || 0,
            activeAppointments: activeAppts.length,
            companies,
            dateOfBirth: bestMatch.date_of_birth,
            address: bestMatch.address_snippet,
          };
        } catch (err: any) {
          return { ...ubo, error: err.message, appointments: [], companies: [] };
        }
      })
    );
    decisionMakers.push(...(await Promise.all(dmFetches)));

    // 6. Sanctions screening on all identified names
    const allNamesToScreen = [
      companyData.profile?.company_name,
      ...ubos.map(u => u.name),
      ...activeOfficers.map((o: any) => o.name),
    ].filter(Boolean);
    const sanctionsResult = await screenSanctions([...new Set(allNamesToScreen)]);

    // 7. Risk assessment
    const risk = assessRisk(companyData, sanctionsResult);

    // 8. Build the AI prompt up front so we can either run it in-line (short
    // answers) or defer it to a background worker after the response has been
    // sent. The raw intelligence in steps 1-7 is what most users actually need
    // to see immediately; the AI analysis is a nice-to-have that previously
    // caused the whole request to time out.
    const profile = companyData.profile || {};

    const chainSummary = chainDetails.length > 0
      ? chainDetails.map((c: any, i: number) => {
          const officers = (c.officers || []).map((o: any) => `${o.name} (${o.officer_role})`).join(", ");
          const pscs = (c.pscs || []).map((p: any) => `${p.name} (${(p.natures_of_control || []).join(", ")})`).join(", ");
          return `  Level ${i + 1}: ${c.name} (${c.number})${c.profile ? ` — ${c.profile.company_status}` : ""}\n    Officers: ${officers || "None"}\n    PSCs: ${pscs || "None"}`;
        }).join("\n")
      : "No corporate ownership chain discovered";

    const uboSummary = decisionMakers.map(dm => {
      const companiesList = (dm.companies || []).slice(0, 10).map((c: any) =>
        `    - ${c.name} (${c.number}) as ${c.role}`
      ).join("\n");
      return `- ${dm.name} (${dm.nationality || "??"}, ${dm.level})${dm.totalAppointments ? ` — ${dm.totalAppointments} total appointments, ${dm.activeAppointments} active` : ""}\n${companiesList || "    No company data"}`;
    }).join("\n");

    const chargesSummary = (companyData.charges || []).map((c: any) =>
      `- ${c.status || "?"}: ${c.classification?.description || "Charge"} — ${(c.persons_entitled || []).map((p: any) => p.name).join(", ") || "Unknown"}${c.created_on ? ` (${c.created_on})` : ""}`
    ).join("\n");

    const aiPrompt = `You are KYC Clouseau — an expert KYC/AML compliance investigator AND commercial property intelligence analyst for a London commercial property agency (Bruce Gillingham Pollard).

You are conducting a FULL PROPERTY INTELLIGENCE investigation. This means going beyond standard KYC — you need to understand who controls the building, who the decision makers are, what managing/leasing agents are involved, and whether there is any availability.

SUBJECT COMPANY:
- Name: ${profile.company_name || "Unknown"}
- Number: ${profile.company_number || "Unknown"}
- Status: ${profile.company_status || "Unknown"}
- Type: ${profile.type || "Unknown"}
- Incorporated: ${profile.date_of_creation || "Unknown"}
- SIC codes: ${(profile.sic_codes || []).join(", ") || "None"}
- Address: ${profile.registered_office_address ? `${profile.registered_office_address.address_line_1 || ""}, ${profile.registered_office_address.locality || ""}, ${profile.registered_office_address.postal_code || ""}` : "Unknown"}
${propertyAddress ? `\nPROPERTY: ${propertyAddress}` : ""}
${propertyName ? `PROPERTY NAME: ${propertyName}` : ""}

FULL OWNERSHIP CHAIN (traced up to 8 levels):
${chainSummary}

ULTIMATE BENEFICIAL OWNERS & DECISION MAKERS:
${uboSummary || "None identified"}

DIRECT OFFICERS (${activeOfficers.length}):
${activeOfficers.map((o: any) => `- ${o.name} (${o.officer_role}${o.nationality ? `, ${o.nationality}` : ""})`).join("\n") || "None"}

DIRECT PSCs (${activePscs.length}):
${activePscs.map((p: any) => `- ${p.name} (${(p.natures_of_control || []).join(", ")})`).join("\n") || "None"}

CHARGES/DEBT (${(companyData.charges || []).length}):
${chargesSummary || "None"}

SANCTIONS SCREENING:
${sanctionsResult ? sanctionsResult.filter((s: any) => s.status !== "clear").map((s: any) => `- ${s.name}: ${s.status} (${s.matches?.map((m: any) => m.sanctionedName).join(", ")})`).join("\n") || "All clear" : "Not available"}

RISK FLAGS:
${risk.flags.map(f => `- ${f}`).join("\n") || "None"}

Please provide a COMPREHENSIVE PROPERTY INTELLIGENCE REPORT:

1. **EXECUTIVE SUMMARY** — Who owns this building/company and what is the risk profile?

2. **ULTIMATE BENEFICIAL OWNERS** — Trace the complete ownership chain to identify the NATURAL PERSONS who ultimately control this entity. For each UBO:
   - Name, nationality, approximate age if DOB available
   - Their role in the chain (direct PSC, parent company director, etc.)
   - Other companies they control — are there property patterns?
   - Any red flags or notable connections

3. **DECISION MAKERS & KEY CONTACTS** — Who would you contact about this building?
   - Identify who has authority over property decisions (disposals, lettings, asset management)
   - Rank from most to least authority
   - Note if they are at SPV level vs parent/fund level
   - Suggest approach strategy (direct, via managing agent, etc.)

4. **MANAGING AGENT INTELLIGENCE** — Based on the company structure, SIC codes, officers, and any available signals:
   - Who is likely to be the managing agent? (Look for property management companies in officer networks or charges)
   - Are there any known property management connections?

5. **LEASING AGENT INTELLIGENCE** — Based on the company type and structure:
   - Who is likely to be the leasing agent? (Look for estate agency connections in the network)
   - What type of leasing activity might this building have?

6. **AVAILABILITY SIGNALS** — Based on the filing patterns, charges, company status:
   - Is the entity likely to have availability (new charges, recent filings, company type)?
   - Is it a multi-let building vs single-tenant?
   - Any signals of disposal interest or financial stress?

7. **ASSOCIATE NETWORK** — Map all connected parties:
   - Other companies controlled by the same individuals
   - Shared directors across the chain
   - Lenders and charge holders
   - Any suspicious patterns or circular ownership

8. **SOCIAL MEDIA & PUBLIC PROFILE** — For each key decision maker:
   - What to search for on LinkedIn, Google
   - Likely professional profile and network
   - Suggested search terms for finding them

9. **RED FLAGS & COMPLIANCE** — AML risk assessment including:
   - PEP indicators
   - Sanctions proximity
   - Jurisdiction concerns
   - Complex structure warnings

10. **RECOMMENDED ACTIONS** — Specific next steps:
    - Who to contact first and how
    - What additional research to conduct
    - Any compliance actions required

Format with clear headers. Be specific — name actual people, companies, and connections. This is used by commercial property agents for business development AND compliance.`;

    // 9. PropertyData — owned properties (fast API call, no AI)
    let propertiesOwned = null;
    if (targetNumber && process.env.PROPERTYDATA_API_KEY) {
      try {
        const pdRes = await fetch(
          `https://api.propertydata.co.uk/freeholds?company_number=${encodeURIComponent(targetNumber)}&key=${process.env.PROPERTYDATA_API_KEY}`
        );
        if (pdRes.ok) propertiesOwned = await pdRes.json();
      } catch {}
    }

    // Assemble the fast portion of the result — all raw intelligence data the
    // user can see immediately. aiAnalysis is deliberately empty here and
    // filled in asynchronously below.
    const result: any = {
      subject: {
        name: companyData.profile?.company_name || companyName || targetNumber,
        companyNumber: targetNumber,
        type: "property_intelligence" as const,
      },
      companyProfile: companyData.profile,
      officers: activeOfficers,
      pscs: activePscs,
      ownershipChain,
      chainDetails,
      ubos,
      decisionMakers,
      filingHistory: (companyData.filings || []).slice(0, 20),
      insolvencyHistory: companyData.insolvency,
      charges: companyData.charges || [],
      sanctionsScreening: sanctionsResult,
      propertiesOwned,
      aiAnalysis: "",
      aiStatus: "pending" as "pending" | "complete" | "failed",
      riskScore: risk.score,
      riskLevel: risk.level,
      flags: risk.flags,
      propertyAddress: propertyAddress || null,
      propertyName: propertyName || null,
      timestamp: new Date().toISOString(),
    };

    // Save investigation first (no AI yet) so we can return an ID the client
    // can poll while the AI step runs in the background.
    const userId = (req as any).user?.id || null;
    const hasSanctionsMatch = sanctionsResult
      ? sanctionsResult.some((s: any) => s.status === "strong_match" || s.status === "potential_match")
      : false;
    let investigationId: number | null = null;
    try {
      const insertResult = await pool.query(
        `INSERT INTO kyc_investigations (subject_type, subject_name, company_number, crm_company_id, risk_level, risk_score, sanctions_match, result, conducted_by, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING id`,
        [
          "property_intelligence",
          result.subject.name,
          targetNumber,
          req.body.crmCompanyId || null,
          risk.level,
          risk.score,
          hasSanctionsMatch,
          JSON.stringify(result),
          userId,
          `Property intelligence: ${propertyAddress || propertyName || result.subject.name}`,
        ]
      );
      investigationId = insertResult.rows[0]?.id || null;
      if (investigationId) {
        await logKycAudit(investigationId, "created", userId, `Property intelligence investigation: ${result.subject.name}`);
      }
    } catch (dbErr: any) {
      console.warn("[kyc-clouseau] Failed to save property intelligence:", dbErr.message);
    }

    (result as any).investigationId = investigationId;

    console.log(`[kyc-clouseau] Property intelligence data ready: ${result.subject.name} — ${ubos.length} UBOs, ${decisionMakers.length} decision makers, risk: ${risk.level} — returning to client, AI deferred`);
    res.json(result);

    // Fire-and-forget AI analysis. The client polls /api/kyc-clouseau/
    // investigation/:id until aiStatus === "complete" (or "failed") and then
    // renders the narrative. If the DB save above failed we still log the AI
    // output to the server console but there's nowhere to persist it.
    if (investigationId) {
      runPropertyIntelligenceAi(investigationId, result, aiPrompt).catch((err: any) => {
        console.warn(`[kyc-clouseau] Background AI task crashed:`, err?.message);
      });
    }
  } catch (err: any) {
    console.error("[kyc-clouseau] Property intelligence error:", err.message);
    const userMessage = sanitizeErrorMessage(err.message, "Property intelligence investigation failed");
    res.status(500).json({ error: userMessage });
  }
});

// Runs the Claude analysis for a property-intelligence investigation that has
// already had its raw data persisted. When it finishes (or fails) it updates
// the `result` JSONB in kyc_investigations so the client poll picks it up.
async function runPropertyIntelligenceAi(investigationId: number, baseResult: any, prompt: string): Promise<void> {
  let aiAnalysis = "";
  let aiStatus: "complete" | "failed" = "complete";
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
      ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
        ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
        : {}),
    });
    const aiPromise = anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 6000,
      messages: [{ role: "user", content: prompt }],
    });
    // The background job can run longer than the request — give it 180s.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("AI analysis timed out after 180s")), 180000)
    );
    const aiRes: any = await Promise.race([aiPromise, timeoutPromise]);
    aiAnalysis = aiRes.content[0].type === "text" ? aiRes.content[0].text : "Analysis unavailable";
  } catch (aiErr: any) {
    console.warn(`[kyc-clouseau] Property intel background AI failed: ${aiErr?.message}`);
    aiAnalysis = `AI analysis unavailable (${aiErr?.message || "unknown error"}). All raw ownership and decision-maker data is still valid.`;
    aiStatus = "failed";
  }

  try {
    const updated = { ...baseResult, aiAnalysis, aiStatus, investigationId };
    await pool.query(
      `UPDATE kyc_investigations SET result = $1 WHERE id = $2`,
      [JSON.stringify(updated), investigationId]
    );
    console.log(`[kyc-clouseau] Property intel AI ${aiStatus} for investigation ${investigationId}`);
  } catch (dbErr: any) {
    console.warn(`[kyc-clouseau] Failed to persist AI analysis for ${investigationId}:`, dbErr.message);
  }
}

// Audit log helper
export async function logKycAudit(investigationId: number, action: string, performedBy: string | null, notes?: string) {
  try {
    await pool.query(
      `INSERT INTO kyc_audit_log (investigation_id, action, performed_by, notes) VALUES ($1, $2, $3, $4)`,
      [investigationId, action, performedBy, notes || null]
    );
  } catch (err: any) {
    console.warn("[kyc-clouseau] Failed to write audit log:", err.message);
  }
}

// Bulk screening endpoint
router.post("/api/kyc-clouseau/bulk-screen", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNames, companyIds } = req.body;
    const names: string[] = companyNames || [];
    const ids: string[] = companyIds || [];

    if (names.length === 0 && ids.length === 0) {
      return res.status(400).json({ error: "Provide companyNames (array) or companyIds (array of CRM company IDs)" });
    }

    // If CRM IDs provided, look up company names/numbers
    const targets: { name?: string; companyNumber?: string; crmCompanyId?: string }[] = [];
    for (const name of names) {
      targets.push({ name: name.trim() });
    }
    if (ids.length > 0) {
      const placeholders = ids.map((_: string, i: number) => `$${i + 1}`).join(",");
      const crmResult = await pool.query(
        `SELECT id, name, companies_house_number FROM crm_companies WHERE id IN (${placeholders})`,
        ids
      );
      for (const row of crmResult.rows) {
        targets.push({
          name: row.name,
          companyNumber: row.companies_house_number || undefined,
          crmCompanyId: row.id,
        });
      }
    }

    if (targets.length === 0) {
      return res.status(400).json({ error: "No valid targets found" });
    }

    if (targets.length > 20) {
      return res.status(400).json({ error: "Maximum 20 companies per bulk screen" });
    }

    const userId = (req as any).user?.id || null;
    const limit = pLimit(3);

    const results = await Promise.allSettled(
      targets.map((target) =>
        limit(async () => {
          try {
            let targetNumber = target.companyNumber;
            if (!targetNumber && target.name) {
              const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(target.name)}&items_per_page=1`);
              if (searchData.items?.length > 0) {
                targetNumber = searchData.items[0].company_number;
              } else {
                return { name: target.name, error: "Company not found", riskLevel: null };
              }
            }

            const companyData = await getCompanyData(targetNumber!);

            const namesToScreen: string[] = [];
            if (companyData.profile?.company_name) namesToScreen.push(companyData.profile.company_name);
            const activeOfficers = (companyData.officers || []).filter((o: any) => !o.resigned_on);
            activeOfficers.forEach((o: any) => { if (o.name) namesToScreen.push(o.name); });

            const sanctionsResult = await screenSanctions(namesToScreen);
            const risk = assessRisk(companyData, sanctionsResult);
            const hasSanctionsMatch = sanctionsResult
              ? sanctionsResult.some((s: any) => s.status === "strong_match" || s.status === "potential_match")
              : false;

            // Save to kyc_investigations
            let investigationId: number | null = null;
            try {
              const insertResult = await pool.query(
                `INSERT INTO kyc_investigations (subject_type, subject_name, company_number, crm_company_id, risk_level, risk_score, sanctions_match, result, conducted_by)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                 RETURNING id`,
                [
                  "company",
                  companyData.profile?.company_name || target.name,
                  targetNumber,
                  target.crmCompanyId || null,
                  risk.level,
                  risk.score,
                  hasSanctionsMatch,
                  JSON.stringify({ subject: { name: companyData.profile?.company_name || target.name, companyNumber: targetNumber }, riskScore: risk.score, riskLevel: risk.level, flags: risk.flags, sanctionsScreening: sanctionsResult }),
                  userId,
                ]
              );
              investigationId = insertResult.rows[0]?.id;
            } catch (dbErr: any) {
              console.warn("[kyc-clouseau] Bulk screen - failed to save investigation:", dbErr.message);
            }

            // Audit log
            if (investigationId) {
              await logKycAudit(investigationId, "created", userId, "Bulk screening");
            }

            return {
              name: companyData.profile?.company_name || target.name,
              companyNumber: targetNumber,
              riskLevel: risk.level,
              riskScore: risk.score,
              flags: risk.flags,
              sanctionsMatch: hasSanctionsMatch,
              investigationId,
            };
          } catch (err: any) {
            return { name: target.name, error: err.message, riskLevel: null };
          }
        })
      )
    );

    const formattedResults = results.map((r, i) => {
      if (r.status === "fulfilled") return r.value;
      return { name: targets[i].name, error: r.reason?.message || "Unknown error", riskLevel: null };
    });

    console.log(`[kyc-clouseau] Bulk screening complete: ${formattedResults.length} companies processed`);
    res.json({ results: formattedResults });
  } catch (err: any) {
    console.error("[kyc-clouseau] Bulk screening error:", err.message);
    const userMessage = sanitizeErrorMessage(err.message, "Bulk screening failed");
    res.status(500).json({ error: userMessage });
  }
});

// Expiring investigations endpoint (older than 12 months)
router.get("/api/kyc-clouseau/expiring", requireAuth, async (req: Request, res: Response) => {
  try {
    const result = await pool.query(
      `SELECT ki.id, ki.subject_type, ki.subject_name, ki.company_number, ki.crm_company_id,
              ki.risk_level, ki.risk_score, ki.sanctions_match, ki.conducted_by, ki.conducted_at,
              d.id as deal_id, d.name as deal_name, d.status as deal_status
       FROM kyc_investigations ki
       LEFT JOIN crm_deals d ON d.landlord_id = ki.crm_company_id
          OR d.tenant_id = ki.crm_company_id
          OR d.vendor_id = ki.crm_company_id
          OR d.purchaser_id = ki.crm_company_id
       WHERE ki.conducted_at < NOW() - INTERVAL '12 months'
       ORDER BY ki.conducted_at ASC
       LIMIT 100`
    );

    // Deduplicate by investigation id (joins may produce multiples)
    const seen = new Set<number>();
    const investigations: any[] = [];
    for (const row of result.rows) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        investigations.push({
          id: row.id,
          subjectType: row.subject_type,
          subjectName: row.subject_name,
          companyNumber: row.company_number,
          crmCompanyId: row.crm_company_id,
          riskLevel: row.risk_level,
          riskScore: row.risk_score,
          sanctionsMatch: row.sanctions_match,
          conductedBy: row.conducted_by,
          conductedAt: row.conducted_at,
          deal: row.deal_id ? { id: row.deal_id, name: row.deal_name, status: row.deal_status } : null,
        });
      }
    }

    res.json({ investigations, count: investigations.length });
  } catch (err: any) {
    console.error("[kyc-clouseau] Expiring investigations error:", err.message);
    res.status(500).json({ error: "Failed to fetch expiring investigations" });
  }
});

// Monthly re-screening function (exported for cron use)
export async function runMonthlyReScreening() {
  console.log("[kyc-clouseau] Starting monthly sanctions re-screening...");
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (company_number) id, company_number, subject_name, result
       FROM kyc_investigations
       WHERE company_number IS NOT NULL
         AND risk_level != 'critical'
         AND conducted_at > NOW() - INTERVAL '6 months'
       ORDER BY company_number, conducted_at DESC`
    );

    let rescreened = 0;
    let newMatches = 0;

    for (const row of result.rows) {
      try {
        const parsedResult = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
        const namesToScreen: string[] = [];
        if (parsedResult?.subject?.name) namesToScreen.push(parsedResult.subject.name);
        if (parsedResult?.officers) {
          parsedResult.officers.forEach((o: any) => { if (o.name) namesToScreen.push(o.name); });
        }
        if (parsedResult?.pscs) {
          parsedResult.pscs.forEach((p: any) => { if (p.name) namesToScreen.push(p.name); });
        }

        if (namesToScreen.length === 0) continue;

        const sanctionsResult = await screenSanctions(namesToScreen);
        rescreened++;

        if (sanctionsResult) {
          const hasMatch = sanctionsResult.some((s: any) => s.status === "strong_match" || s.status === "potential_match");
          if (hasMatch) {
            newMatches++;
            console.warn(`[kyc-clouseau] RE-SCREENING ALERT: New sanctions match for ${row.subject_name} (${row.company_number})`);
            await pool.query(
              `UPDATE kyc_investigations SET sanctions_match = true, notes = COALESCE(notes, '') || $1 WHERE id = $2`,
              [`\n[Re-screened ${new Date().toISOString()}] New sanctions match detected`, row.id]
            );
            await logKycAudit(row.id, "re-screened", null, `Monthly re-screening: new sanctions match detected`);
          } else {
            await logKycAudit(row.id, "re-screened", null, `Monthly re-screening: clear`);
          }
        }
      } catch (err: any) {
        console.warn(`[kyc-clouseau] Re-screening failed for ${row.company_number}:`, err.message);
      }
    }

    console.log(`[kyc-clouseau] Monthly re-screening complete: ${rescreened} screened, ${newMatches} new matches`);
  } catch (err: any) {
    console.error("[kyc-clouseau] Monthly re-screening error:", err.message);
  }
}

export default router;
