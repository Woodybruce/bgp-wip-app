import { Router, Request, Response } from "express";
import { requireAuth } from "./auth";
import { chFetch, discoverUltimateParent } from "./companies-house";
import { pool } from "./db";

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
  riskScore?: number;
  riskLevel?: "low" | "medium" | "high" | "critical";
  flags?: string[];
  timestamp: string;
}

async function getCompanyData(companyNumber: string) {
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

async function screenSanctions(names: string[]) {
  try {
    const { screenName, loadSanctionsList } = await import("./sanctions-screening");
    await loadSanctionsList();
    const results: any[] = [];
    for (const name of names) {
      const matches = screenName(name, 0.6);
      if (matches.length > 0) {
        results.push({
          name,
          status: matches[0].score >= 0.9 ? "strong_match" : "potential_match",
          matches: matches.slice(0, 3).map(m => ({
            sanctionedName: m.entry.name,
            score: m.score,
            regime: m.entry.regime,
            designation: m.entry.designationType,
          })),
        });
      } else {
        results.push({ name, status: "clear", matches: [] });
      }
    }
    return results;
  } catch (err: any) {
    console.warn("[kyc-clouseau] Sanctions screening error:", err.message);
    return null;
  }
}

function assessRisk(data: any, sanctionsResult: any): { score: number; level: string; flags: string[] } {
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
    const matches = sanctionsResult.filter((s: any) => s.status === "strong_match" || s.status === "potential_match");
    if (matches.length > 0) {
      const strongMatches = matches.filter((m: any) => m.status === "strong_match");
      if (strongMatches.length > 0) {
        flags.push(`🚨 SANCTIONS MATCH: ${strongMatches.length} strong match(es) found`);
        score += 50;
      } else {
        flags.push(`⚠️ Potential sanctions match: ${matches.length} name(s) flagged`);
        score += 25;
      }
    }
  }

  let level = "low";
  if (score >= 60) level = "critical";
  else if (score >= 40) level = "high";
  else if (score >= 20) level = "medium";

  return { score: Math.min(score, 100), level, flags };
}

async function runAiAnalysis(data: any, riskFlags: string[], ownershipChain: any, propertyContext?: any): Promise<string> {
  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const anthropic = new Anthropic({
      apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
      baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
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
      ? ownershipChain.chain.map((c: any, i: number) => `  ${i + 1}. ${c.name} (${c.number})`).join("\n")
      : "No corporate ownership chain discovered";

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

OWNERSHIP CHAIN (PSC corporate trace):
${chainSummary}

CHARGES/MORTGAGES (${(data.charges || []).length}):
${(data.charges || []).map((c: any) => `- ${c.status || "unknown"}: ${c.classification?.description || c.particulars?.description || "Charge"} — ${(c.persons_entitled || []).map((p: any) => p.name).join(", ") || "Unknown lender"}${c.created_on ? ` (created ${c.created_on})` : ""}${c.satisfied_on ? ` (satisfied ${c.satisfied_on})` : ""}`).join("\n") || "None"}

INSOLVENCY RECORDS: ${data.insolvency?.length || 0} case(s)
${data.insolvency?.map((i: any) => `- ${i.status}: ${i.case_type || "Unknown type"}`).join("\n") || "None"}

AUTOMATED RISK FLAGS:
${riskFlags.map(f => `- ${f}`).join("\n") || "None identified"}

RECENT FILINGS (last 10):
${(data.filings || []).slice(0, 10).map((f: any) => `- ${f.date}: ${f.description || f.type}`).join("\n") || "None"}
${propertyContext ? `
PROPERTY ACQUISITION CONTEXT:
This investigation originates from a Land Registry search. The user is exploring whether to acquire a property and needs to identify the best person to contact about purchasing it.
- Property address: ${propertyContext.propertyAddress || "Unknown"}
- Registered owner: ${propertyContext.ownerName || "Unknown"}
- Last price paid: ${propertyContext.pricePaid && !isNaN(Number(propertyContext.pricePaid)) ? `£${Number(propertyContext.pricePaid).toLocaleString()}` : propertyContext.pricePaid || "Unknown"}
- Mortgage lender: ${propertyContext.mortgageLender || "None/Unknown"}
` : ""}
Please provide:

1. **EXECUTIVE SUMMARY** — 2-3 sentence overview of this entity and its risk profile
2. **CONTROLLING INDIVIDUALS** — Who really controls this entity? Follow the ownership chain. Identify the natural persons behind any corporate layers.
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

router.post("/api/kyc-clouseau/investigate", requireAuth, async (req: Request, res: Response) => {
  try {
    const { companyNumber, companyName, type = "company", propertyContext } = req.body;

    if (!companyNumber && !companyName) {
      return res.status(400).json({ error: "Provide companyNumber or companyName" });
    }

    let targetNumber = companyNumber;
    if (!targetNumber && companyName) {
      const searchData = await chFetch(`/search/companies?q=${encodeURIComponent(companyName)}&items_per_page=1`);
      if (searchData.items?.length > 0) {
        targetNumber = searchData.items[0].company_number;
      } else {
        return res.status(404).json({ error: `No company found matching "${companyName}"` });
      }
    }

    console.log(`[kyc-clouseau] Starting investigation: ${targetNumber}`);

    const companyData = await getCompanyData(targetNumber);

    let ownershipChain = null;
    try {
      ownershipChain = await discoverUltimateParent(targetNumber);
    } catch {}

    const namesToScreen: string[] = [];
    if (companyData.profile?.company_name) namesToScreen.push(companyData.profile.company_name);
    const activeOfficers = (companyData.officers || []).filter((o: any) => !o.resigned_on);
    activeOfficers.forEach((o: any) => { if (o.name) namesToScreen.push(o.name); });
    const activePscs = (companyData.pscs || []).filter((p: any) => !p.ceased_on);
    activePscs.forEach((p: any) => { if (p.name) namesToScreen.push(p.name); });

    const sanctionsResult = await screenSanctions(namesToScreen);
    const risk = assessRisk(companyData, sanctionsResult);

    let aiAnalysis = "";
    try {
      const aiPromise = runAiAnalysis(companyData, risk.flags, ownershipChain, propertyContext);
      const timeoutPromise = new Promise<string>((_, reject) => setTimeout(() => reject(new Error("AI analysis timed out")), 90000));
      aiAnalysis = await Promise.race([aiPromise, timeoutPromise]);
    } catch (aiErr: any) {
      aiAnalysis = `AI analysis unavailable (${aiErr.message}). Structured data and risk scoring are shown below.`;
    }

    const result: InvestigationResult = {
      subject: {
        name: companyData.profile?.company_name || companyName || targetNumber,
        companyNumber: targetNumber,
        type: type as "company" | "individual",
      },
      companyProfile: companyData.profile,
      officers: activeOfficers,
      pscs: activePscs,
      ownershipChain,
      filingHistory: (companyData.filings || []).slice(0, 20),
      insolvencyHistory: companyData.insolvency,
      sanctionsScreening: sanctionsResult,
      aiAnalysis,
      riskScore: risk.score,
      riskLevel: risk.level as any,
      flags: risk.flags,
      charges: companyData.charges || [],
      propertyContext: propertyContext || null,
      timestamp: new Date().toISOString(),
    };

    console.log(`[kyc-clouseau] Investigation complete: ${result.subject.name} — risk: ${risk.level} (${risk.score})`);
    res.json(result);
  } catch (err: any) {
    console.error("[kyc-clouseau] Investigation error:", err.message);
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
        apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
        baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
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

export default router;
