import type { Express, Request, Response } from "express";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import {
  propertyPathwayRuns,
  crmProperties,
  crmCompanies,
  crmDeals,
  availableUnits,
  investmentComps,
  unitViewings,
  users,
  imageStudioImages,
  type PropertyPathwayRun,
} from "@shared/schema";
import fs from "fs";
import { inArray } from "drizzle-orm";
import { performPropertyLookup } from "./property-lookup";
import { executeCreateSharePointFolder, executeUploadFileToSharePoint } from "./utils/sharepoint-operations";
import { askPerplexity } from "./perplexity";
import { callClaude } from "./utils/anthropic-client";

/**
 * Property Pathway Orchestrator
 *
 * Deterministic 9-stage state machine that drives a property investigation
 * end-to-end. Each stage is a discrete function that reads current run state,
 * calls the relevant APIs, writes results back, and advances the stage.
 *
 * Stages:
 *   1. Initial Search — emails, SharePoint, CRM, basic land reg, set up folder tree
 *   2. Brand Intelligence — if tenant is known, enrich the brand
 *   3. Detailed Search Summary — summarise, gate for user confirmation
 *   4. Property Intelligence — full titles, planning (floor plans), proprietor KYC
 *   5. Investigation Board — aggregate view ready
 *   6. Business Plan — Claude drafts the plan from all prior stages, agreed via ChatBGP dialogue
 *   7. Excel Model — generate from agreed plan, refined in the Excel add-in, agreed version locks
 *   8. Studio Time — Image Studio (street view, retail context plan, brand/area imagery)
 *   9. Why Buy — generate 4-page PE IM document from agreed plan + agreed model
 */

const STANDARD_FOLDER_TREE = [
  "Brochure & Marketing",
  "Legal & Title",
  "Financial Model",
  "Due Diligence",
  "Correspondence",
  "Images & Photography",
  "Comparables",
  "Surveys & Reports",
  "Why Buy Deck",
  "KYC & AML",
];

type StageStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface BusinessPlan {
  strategy?: string;                 // e.g. "core-plus refurb + re-let", "value-add AST conversion"
  holdPeriodYrs?: number;
  targetPurchasePrice?: number;
  targetNIY?: number;                // as a decimal, e.g. 0.0525
  exitPrice?: number;
  exitYield?: number;
  exitYear?: number;
  capex?: { amount?: number; scope?: string };
  leasing?: { vacantUnits?: string[]; targetRentPsf?: number; reversionNotes?: string };
  equityCheck?: number;
  targetIRR?: number;                // as decimal
  targetMOIC?: number;
  risks?: string[];
  keyMoves?: string[];               // 3–5 bullet summary of the plan
  notes?: string;
}

interface StageResults {
  stage1?: {
    emailHits?: Array<{ subject: string; from: string; date: string; msgId: string; mailboxEmail?: string; preview: string; hasAttachments: boolean; webLink?: string | null }>;
    sharepointHits?: Array<{ name: string; path: string; webUrl: string; modifiedAt?: string; sizeMB?: number; type?: string }>;
    brochureFiles?: Array<{ source: "email" | "sharepoint" | "sharepoint-uploaded"; name: string; ref: string; date?: string; webUrl?: string; sizeMB?: number }>;
    crmHits?: { properties: any[]; deals: any[]; companies: any[] };
    deals?: Array<{ id: string; name: string; stage?: string; status?: string; dealType?: string; team?: string[]; rentPa?: number; fee?: number; createdAt?: string }>;
    tenancy?: { occupier?: string; units?: Array<{ id: string; unitName: string; floor?: string; sqft?: number; askingRent?: number; marketingStatus?: string; useClass?: string; tenantName?: string; passingRentPa?: number; leaseStart?: string; leaseExpiry?: string; source?: "crm" | "sharepoint" | "email" | "ai" }>; status?: "vacant" | "let" | "mixed" | "unknown" };
    engagements?: Array<{ source: "unit_viewing" | "investment_viewing" | "interaction"; contact?: string; company?: string; date?: string; outcome?: string; notes?: string; unitName?: string }>;
    pricePaidHistory?: Array<{ address?: string; price?: number; date?: string; type?: string }>;
    comps?: Array<{
      address: string;
      price?: number;
      yield?: number;
      date?: string;
      type?: string;
      // letting-comp fields (kind === "letting")
      tenant?: string;
      rent?: string;
      area?: string;
      kind?: "investment" | "letting";
    }>;
    initialOwnership?: {
      titleNumber: string;
      proprietorName?: string;
      proprietorCategory?: string;
      pricePaid?: number;
      dateOfPurchase?: string;
      proprietorCompanyId?: string;
      proprietorCompanyNumber?: string;
    } | null;
    tenant?: { name: string; companyNumber?: string; companyId?: string };
    folderTree?: { root: string; webUrl: string; children: string[] };
    summary?: string;
    aiBriefing?: { bullets: string[]; headline: string; keyQuestions: string[] };
    aiFacts?: {
      owner?: string;
      ownerCompanyNumber?: string;
      purchasePrice?: string;
      purchaseDate?: string;
      refurbCost?: string;
      currentUse?: string;
      sizeSqft?: string;
      mainTenants?: string[];
      leaseStatus?: string;
      listedStatus?: string;
      passingRent?: string;
    };
    propertyImage?: { streetViewUrl?: string; googleMapsUrl?: string };
    rates?: {
      totalRateableValue?: number;
      assessmentCount?: number;
      entries: Array<{
        firmName?: string;
        address?: string;
        postcode?: string;
        description?: string;
        rateableValue?: number | null;
        effectiveDate?: string;
      }>;
      voaSearchUrl?: string;
    };
    // PropertyData market tone — aggregate quoting rent / sold £ psf figures
    // for retail, offices, residential in this postcode sector. Not individual
    // transaction comps (PropertyData doesn't expose those for commercial) but
    // anchors the business plan with a defensible market-tone number.
    pdMarket?: import("./propertydata-market").PropertyDataMarketTone;
    // AI-triaged commentary on the emailHits — replaces the raw email list
    // in the UI. Markdown body cites emails inline as `[E5]` tokens (1-based
    // index into emailHits) which the client renders as clickable links to
    // the in-app email viewer. Generated automatically at end of Stage 1;
    // re-run on demand via /api/pathway/email-sort.
    emailCommentary?: {
      markdown: string;
      generatedAt: string;
    };
    // Retail leasing comps extracted from Stage 1 emails by Claude Haiku.
    // Stored in `retail_leasing_comps` (NOT the CRM) so Woody can curate.
    // This field is the trimmed view shown on the Comps card.
    retailComps?: Array<{
      id: string;
      address: string;
      postcode?: string;
      tenant?: string;
      rentPa?: number;
      rentPsf?: number;
      areaSqft?: number;
      leaseDate?: string;
      termYears?: number;
      sourceType?: string;
      sourceRef?: string;
      confidence?: number;
    }>;
  };
  stage2?: {
    companyId?: string;
    enrichedFields?: Record<string, any>;
    // Who to approach to buy this building. First pass built from Stage 1
    // data (emails + LR ownership + CRM). Stage 5 refreshes it once CH
    // officers from Stage 4 KYC are available. See server/pathway-contacts.ts.
    buildingContacts?: import("./pathway-contacts").BuildingContacts;
    company?: {
      id: string;
      name: string;
      domain?: string | null;
      industry?: string | null;
      description?: string | null;
      conceptPitch?: string | null;
      storeCount?: number | null;
      instagramHandle?: string | null;
      companiesHouseNumber?: string | null;
      backers?: string | null;
      backersDetail?: Array<{ name: string; type: string; description: string }>;
      rolloutStatus?: string | null;
    };
    skipped?: boolean;
    reason?: string;
  };
  stage3?: {
    summary: string;
    recommendProceed: boolean;
  };
  stage4?: {
    // Virtual document tree — materialised into SharePoint only when the user
    // clicks "Set up folder tree" on the final stage.
    titleRegisters?: Array<{ titleNumber: string; documentUrl?: string; source?: "infotrack" | "placeholder" }>;
    planningApplications?: Array<{ reference: string; description: string; status: string; date: string; decidedAt?: string; receivedAt?: string; documentUrl?: string; matchTier?: "strict" | "street" | "area" }>;
    planningDocs?: Array<{
      ref: string;
      lpa: string;
      appDate: string;
      description: string;
      docsUrl: string;
      docs: Array<{ url: string; date: string; description: string; type: string; drawingNumber?: string; category: string; label: string }>;
    }>;
    floorPlanUrls?: string[];
    // Companies House KYC — one summary block per resolved proprietor/tenant
    // company. The full investigation (officers, PSCs, UBO chain, sanctions,
    // AI analysis, filings) is written to `kyc_investigations` via
    // runCompanyInvestigation(), and the board only keeps a lightweight
    // summary pointing to that record. Click-through to the full report
    // lives in the Clouseau page (/kyc-clouseau?investigation={id}).
    companyKyc?: Array<{
      companyNumber: string;
      companyName: string;
      role: "proprietor" | "tenant" | "parent" | "ubo";
      investigationId: number | null;
      reusedFromClouseau?: boolean;
      riskLevel?: "low" | "medium" | "high" | "critical";
      riskScore?: number;
      sanctionsMatch?: boolean;
      pepMatch?: boolean;
      adverseMediaMatch?: boolean;
      flags?: string[];
      officerCount?: number;
      pscCount?: number;
      uboCount?: number;
      filingCount?: number;
      status?: string;
      incorporatedOn?: string;
      error?: string;
    }>;
    proprietorKyc?: any;
  };
  stage5?: {
    ready: boolean;
    boardUrl?: string;
  };
  stage6?: {
    // Business Plan — Claude drafts from all prior stages, refined via ChatBGP dialogue, locked on agree.
    draft?: BusinessPlan;
    agreed?: BusinessPlan;
    agreedAt?: string;
    agreedBy?: string;
    chatThreadId?: string;
    summary?: string;              // narrative version Claude produced alongside the structured draft
    revisions?: Array<{ at: string; source: "chat" | "ui"; patch: Partial<BusinessPlan>; note?: string }>;
  };
  stage7?: {
    // Excel Model — generated from stage6.agreed, refined in the add-in, locked on agree.
    modelRunId?: string;
    modelVersionId?: string;
    // Human-readable labels surfaced on the pathway card instead of raw UUIDs.
    // e.g. "18-22 Haymarket · Pathway Model" / "v1 · 20 Apr 2026 · £60m / 4.75% NIY".
    modelRunName?: string;
    modelVersionLabel?: string;
    workbookUrl?: string;
    agreed?: boolean;
    agreedAt?: string;
    agreedBy?: string;
    // The total area + passing rent the model was actually built with.
    // Surfaced so the user can sanity-check before agreeing (Excel defaults
    // to 5,000 sq ft / £500k if extraction misses).
    totalAreaSqFt?: number;
    totalAreaSource?: "tenancy" | "ai" | "manual" | "default";
    currentRentPA?: number;
    currentRentSource?: "tenancy" | "ai" | "plan" | "manual" | "default";
    // Explicit user override — if set, runStage7 uses these instead of any
    // derived values.
    overrideTotalAreaSqFt?: number;
    overrideCurrentRentPA?: number;
  };
  stage8?: {
    // Studio Time — images collected only once plan + model are agreed.
    streetViewImageId?: string;
    retailContextImageId?: string;
    additionalImageIds?: string[];
    collections?: Array<{ id: string; name: string; bucket: "building" | "tenants" | "area"; imageCount: number }>;
  };
  stage9?: {
    // Why Buy — generated from stage6.agreed + stage7.modelVersionId.
    documentUrl?: string;
    sharepointUrl?: string;
    pdfPath?: string;
  };
  marketIntel?: {
    leasingHistory: Array<{ tenant?: string; area?: string; rent?: string; date?: string; term?: string; notes?: string }>;
    currentAvailability: Array<{ address?: string; area?: string; asking?: string; type?: string; agent?: string; url?: string }>;
    comparables: Array<{ address?: string; tenant?: string; rent?: string; area?: string; date?: string; source?: string }>;
    marketContext?: string;
    keyFindings?: string[];
    citations?: Array<{ url: string; title?: string }>;
    generatedAt?: string;
    error?: string;
  };
}

interface StageStatusMap {
  stage1?: StageStatus;
  stage2?: StageStatus;
  stage3?: StageStatus;
  stage4?: StageStatus;
  stage5?: StageStatus;
  stage6?: StageStatus;
  stage7?: StageStatus;
  stage8?: StageStatus;
  stage9?: StageStatus;
}

async function getRun(runId: string): Promise<PropertyPathwayRun | null> {
  const [run] = await db.select().from(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).limit(1);
  return run || null;
}

async function updateRun(runId: string, updates: Partial<PropertyPathwayRun>): Promise<PropertyPathwayRun> {
  const [updated] = await db
    .update(propertyPathwayRuns)
    .set({ ...updates, updatedAt: new Date() })
    .where(eq(propertyPathwayRuns.id, runId))
    .returning();
  return updated;
}

/**
 * Ensure the pathway run is linked to a CRM property. If the run already
 * has a propertyId, returns that property. If Stage 1 found existing
 * matches, links the first one. Otherwise auto-creates a new CRM property
 * from the run's address and links it back onto the run.
 *
 * Returns the linked CRM property (or null if creation failed). Callers
 * should push the returned record into crmHits.properties so Stage 1 UI
 * shows it immediately, and rely on run.propertyId being set for
 * downstream stages (tenancy, valuations, business plan).
 */
async function ensureCrmPropertyLink(
  run: PropertyPathwayRun,
  existingMatches: any[],
): Promise<any | null> {
  if (run.propertyId) {
    const [existing] = await db
      .select()
      .from(crmProperties)
      .where(eq(crmProperties.id, run.propertyId))
      .limit(1);
    if (existing) return existing;
  }
  if (existingMatches && existingMatches.length > 0) {
    const first = existingMatches[0];
    if (first?.id && first.id !== run.propertyId) {
      try {
        await updateRun(run.id, { propertyId: first.id });
      } catch (err: any) {
        console.warn(`[pathway stage1] Could not link run ${run.id} → CRM ${first.id}: ${err?.message}`);
      }
    }
    return first;
  }
  const name = (run.address.split(",")[0] || run.address).trim();
  try {
    const [created] = await db
      .insert(crmProperties)
      .values({
        name,
        address: { formatted: run.address, postcode: run.postcode } as any,
        postcode: run.postcode || null,
        groupName: "Properties",
        status: "Active",
        notes: `Auto-created by Property Pathway on ${new Date().toISOString().slice(0, 10)} — review and enrich.`,
      })
      .returning();
    if (created?.id) {
      try {
        await updateRun(run.id, { propertyId: created.id });
      } catch (err: any) {
        console.warn(`[pathway stage1] Auto-created CRM ${created.id} but failed to link run: ${err?.message}`);
      }
      console.log(`[pathway stage1] Auto-created CRM property ${created.id} (${name}) for run ${run.id}`);
    }
    return created || null;
  } catch (err: any) {
    console.error("[pathway stage1] Auto-create CRM property failed:", err?.message);
    return null;
  }
}

async function setStageStatus(runId: string, stage: keyof StageStatusMap, status: StageStatus, resultsPatch?: Partial<StageResults>): Promise<PropertyPathwayRun> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Pathway run ${runId} not found`);
  const stageStatus = { ...(run.stageStatus as StageStatusMap), [stage]: status };
  const stageResults = { ...(run.stageResults as StageResults), ...(resultsPatch || {}) };
  const stageNumber = parseInt(stage.replace("stage", ""), 10);
  // A skipped stage shouldn't block later stages — advance past it like a completed stage.
  const shouldAdvance = (status === "completed" || status === "skipped") && stageNumber >= run.currentStage;
  const newCurrentStage = shouldAdvance ? Math.min(9, stageNumber + 1) : run.currentStage;
  return updateRun(runId, { stageStatus, stageResults, currentStage: newCurrentStage });
}

// ============================================================================
// MARKET INTEL CRAWL — Perplexity + Exa + Claude synthesis, shared by Stage 1
// and the manual refresh endpoint.
// ============================================================================

async function runMarketIntelCrawl(address: string, postcode: string): Promise<StageResults["marketIntel"] | null> {
  const location = [address, postcode].filter(Boolean).join(", ");
  const area = postcode ? postcode.split(" ")[0] : "central London";
  const exaKey = process.env.EXA_API_KEY;

  console.log(`[market-intel] Starting crawl for ${location}`);

  const [leasingRes, availRes, exaRes] = await Promise.allSettled([
    askPerplexity(
      `What leases have been signed at ${location}? Who are the current and historic tenants/occupiers? Include tenant names, floor areas, rents (headline, zone A, ITZA, net effective), lease dates, lease lengths, and rent-free periods where known.`,
      {
        systemPrompt: "You are a UK commercial property market researcher. Find factual lease transaction data for this specific building. Include specific rents in £ psf or £ pa, areas in sq ft, lease lengths, and dates. Be specific and cite sources like EG, CoStar, PropertyWeek, Estates Gazette, or CBRE/Savills/JLL/BGP press releases.",
        maxTokens: 1500,
        temperature: 0.1,
      }
    ),
    askPerplexity(
      `What commercial property (office, retail, or other) is currently available to let or for sale near ${location}? What are the most recent comparable lease transactions in ${area}? Include asking rents, achieved rents, sizes, use classes, agents, and transaction dates.`,
      {
        systemPrompt: "You are a UK commercial property market researcher. Find current availability listings and recent comparable lease or investment transactions. For availability: address, size, asking rent, agent. For comps: tenant or buyer, rent achieved, size, date, source. Be specific with figures.",
        maxTokens: 1500,
        temperature: 0.1,
      }
    ),
    exaKey
      ? Promise.allSettled([
          fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: { "x-api-key": exaKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `"${address}" ${postcode} commercial property lease tenant`,
              numResults: 6,
              contents: { text: { maxCharacters: 1200 } },
            }),
            signal: AbortSignal.timeout(12000),
          }).then(r => r.json()),
          fetch("https://api.exa.ai/search", {
            method: "POST",
            headers: { "x-api-key": exaKey, "Content-Type": "application/json" },
            body: JSON.stringify({
              query: `${area} commercial property market rent comparable 2024 2025 office retail lease`,
              numResults: 5,
              contents: { text: { maxCharacters: 1200 } },
            }),
            signal: AbortSignal.timeout(12000),
          }).then(r => r.json()),
        ])
      : Promise.resolve(null),
  ]);

  const parts: string[] = [];
  const citations: Array<{ url: string; title?: string }> = [];

  if (leasingRes.status === "fulfilled") {
    parts.push(`=== LEASING HISTORY & HISTORIC TENANTS ===\n${leasingRes.value.answer}`);
    citations.push(...leasingRes.value.citations);
  } else {
    console.warn("[market-intel] Perplexity leasing query failed:", (leasingRes as any).reason?.message);
  }

  if (availRes.status === "fulfilled") {
    parts.push(`=== CURRENT AVAILABILITY & COMPARABLES ===\n${availRes.value.answer}`);
    citations.push(...availRes.value.citations);
  } else {
    console.warn("[market-intel] Perplexity availability query failed:", (availRes as any).reason?.message);
  }

  if (exaRes.status === "fulfilled" && Array.isArray(exaRes.value)) {
    for (const settled of exaRes.value) {
      if (settled.status === "fulfilled" && settled.value?.results) {
        const exaText = (settled.value.results as any[])
          .map((r: any) => `SOURCE: ${r.title || r.url}\nURL: ${r.url}\n${(r.text || "").slice(0, 900)}`)
          .join("\n\n---\n\n");
        if (exaText.trim()) parts.push(`=== WEB SOURCES ===\n${exaText}`);
        for (const r of settled.value.results) {
          if (r.url) citations.push({ url: r.url, title: r.title });
        }
      }
    }
  }

  if (parts.length === 0) {
    console.warn(`[market-intel] All search providers failed for ${location}`);
    return null;
  }

  const rawData = parts.join("\n\n");

  const synthesis = await callClaude({
    model: "claude-opus-4-6",
    messages: [{
      role: "user",
      content: `You are a senior property analyst at BGP (Bruce Gillingham Pollard), a leading London commercial property agency. Synthesise the raw web research below into structured market intelligence for ${location}.

Return a JSON object with exactly this structure (no prose around it):
{
  "leasingHistory": [
    { "tenant": "...", "area": "X,XXX sq ft", "rent": "£XX psf headline / £XXXk pa", "date": "Month YYYY or YYYY", "term": "X years", "notes": "rent-free, break clause, etc." }
  ],
  "currentAvailability": [
    { "address": "...", "area": "X,XXX sq ft", "asking": "£XX psf", "type": "office|retail|industrial|mixed", "agent": "...", "url": "https://..." }
  ],
  "comparables": [
    { "address": "...", "tenant": "...", "rent": "£XX psf", "area": "X,XXX sq ft", "date": "Month YYYY or YYYY", "source": "EG/CoStar/Agent" }
  ],
  "marketContext": "3-5 sentence summary of submarket conditions, rent levels, demand drivers, and any notable trends for ${area}.",
  "keyFindings": [
    "Concise factual finding 1 — include numbers where possible",
    "Concise factual finding 2",
    "Concise factual finding 3",
    "Concise factual finding 4"
  ]
}

RULES:
- Only include entries that have at least two meaningful populated fields — omit sparse entries
- Never invent or hallucinate data. If something is uncertain, mark it "(unconfirmed)" or omit it
- Rents must be in £ psf or £ pa format with actual numbers
- Areas must be in sq ft with actual numbers
- Dates as specific as source allows — "Q1 2024" is fine, "2020s" is not
- leasingHistory = transactions that have completed at this specific building
- comparables = transactions elsewhere in the submarket that serve as rent evidence
- currentAvailability = what is currently on the market nearby

RAW RESEARCH:
${rawData.slice(0, 14000)}`,
    }],
    max_completion_tokens: 2500,
    temperature: 0.1,
  });

  const raw = synthesis.choices[0]?.message?.content || "{}";
  let parsed: any = { leasingHistory: [], currentAvailability: [], comparables: [], keyFindings: [], marketContext: "" };
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      parsed = JSON.parse(cleaned.slice(start, end + 1));
    }
  } catch (e: any) {
    console.warn("[market-intel] Claude JSON parse failed:", e?.message);
    parsed.marketContext = raw.slice(0, 600);
  }

  const intel: StageResults["marketIntel"] = {
    leasingHistory: Array.isArray(parsed.leasingHistory) ? parsed.leasingHistory : [],
    currentAvailability: Array.isArray(parsed.currentAvailability) ? parsed.currentAvailability : [],
    comparables: Array.isArray(parsed.comparables) ? parsed.comparables : [],
    marketContext: parsed.marketContext || "",
    keyFindings: Array.isArray(parsed.keyFindings) ? parsed.keyFindings : [],
    citations: citations
      .filter((c, i, arr) => c.url && arr.findIndex((x) => x.url === c.url) === i)
      .slice(0, 20),
    generatedAt: new Date().toISOString(),
  };

  console.log(`[market-intel] Done for ${location} — ${intel.leasingHistory.length} leases, ${intel.currentAvailability.length} available, ${intel.comparables.length} comps`);
  return intel;
}

// ============================================================================
// STAGE 1 — Initial Search
// ============================================================================

// Build Claude-style quoted street-number phrases from a (possibly Google-
// geocoded) address. For "18, 22 Haymarket, London SW1Y 4DG, UK" returns
// ['"22 Haymarket"', '"18 Haymarket"', '"18-22 Haymarket"'] — the exact kind
// of multi-word phrase Graph `$search` matches against full body, and the
// kind Claude picks instinctively in ChatBGP when it runs search_emails.
function buildAddressPhrases(address: string): string[] {
  if (!address) return [];
  const cleaned = address
    .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi, "")
    .replace(/,\s*UK\b/i, "").replace(/,\s*united\s*kingdom\b/i, "")
    .replace(/,\s*london\b/i, "").replace(/,\s*england\b/i, "")
    .trim().replace(/,\s*$/, "");
  const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return [];
  const streetPart = parts[parts.length - 1];
  const m = streetPart.match(/^([\d\-–]+[a-z]?)\s+(.+)$/i);
  if (!m) return streetPart ? [`"${streetPart}"`] : [];
  const street = m[2].trim().replace(/\s+/g, " ");
  if (!street || street.length < 3) return [];
  const nums: string[] = [];
  for (const piece of m[1].split(/[-–]/).map((s) => s.trim()).filter(Boolean)) nums.push(piece);
  for (let i = parts.length - 2; i >= 0; i--) {
    const p = parts[i];
    if (/^\d+[a-z]?$/i.test(p)) nums.push(p);
    else break;
  }
  const unique = Array.from(new Set(nums.map((n) => n.toLowerCase())));
  const phrases: string[] = [];
  for (const n of unique) phrases.push(`"${n} ${street}"`);
  if (unique.length >= 2) {
    const ints = unique.map((n) => parseInt(n, 10)).filter((n) => !Number.isNaN(n)).sort((a, b) => a - b);
    if (ints.length >= 2) phrases.push(`"${ints[0]}-${ints[ints.length - 1]} ${street}"`);
  }
  return phrases;
}

// Helper: best-effort tenant name from whatever data has been collected so far
function derivedTenantForFilter(run: any, aiFacts: any, tenancy: any): string | null {
  const existing = run?.stageResults?.stage1?.tenant?.name;
  if (existing) return existing;
  if (aiFacts?.mainTenants && aiFacts.mainTenants.length > 0) return aiFacts.mainTenants[0];
  if (tenancy?.occupier) return tenancy.occupier;
  return null;
}

// Build CRM-derived seed data for the baseline email sweep. If the address
// matches a CRM deal, we pull counterparty/agent names (which the property
// address often doesn't appear alongside in email threads — e.g. "Dover
// Street Market", "Amsprop", "Goldenberg" for 18-22 Haymarket) and the
// mailboxes of internal agents assigned to that deal (so the sweep searches
// Jack/Nick/Tracey first when they own the deal).
async function buildCrmSweepSeed(crmPF: any): Promise<{ extraTerms: string[]; priorityMailboxes: string[] }> {
  const extraTerms = new Set<string>();
  const priorityMailboxes = new Set<string>();
  try {
    const dealHits: Array<{ id: string; name: string }> = Array.isArray(crmPF?.deals) ? crmPF.deals : [];
    // 1. Deal name tokens — usually contain building name / counterparty.
    for (const d of dealHits) {
      if (d?.name && typeof d.name === "string" && d.name.length >= 4) extraTerms.add(d.name.trim());
    }
    // 2. Company hits from the address-name crm_lookup.
    const companyHits: Array<{ id: string; name: string }> = Array.isArray(crmPF?.companies) ? crmPF.companies : [];
    for (const c of companyHits) {
      if (c?.name && typeof c.name === "string" && c.name.length >= 4) extraTerms.add(c.name.trim());
    }
    // 3. For each matched deal, pull vendor/purchaser/landlord/tenant
    //    company + client contact names, and the internal_agent emails.
    if (dealHits.length > 0) {
      const { crmDeals, crmCompanies, crmContacts } = await import("@shared/schema");
      const { inArray } = await import("drizzle-orm");
      const dealRows = await db.select({
        id: crmDeals.id,
        vendorId: crmDeals.vendorId,
        purchaserId: crmDeals.purchaserId,
        landlordId: crmDeals.landlordId,
        tenantId: crmDeals.tenantId,
        vendorAgentId: crmDeals.vendorAgentId,
        acquisitionAgentId: crmDeals.acquisitionAgentId,
        purchaserAgentId: crmDeals.purchaserAgentId,
        leasingAgentId: crmDeals.leasingAgentId,
        clientContactId: crmDeals.clientContactId,
        internalAgent: crmDeals.internalAgent,
      }).from(crmDeals).where(inArray(crmDeals.id, dealHits.map((d) => d.id))).limit(20);

      const companyIds = new Set<string>();
      const contactIds = new Set<string>();
      const agentNames = new Set<string>();
      for (const d of dealRows) {
        for (const cid of [d.vendorId, d.purchaserId, d.landlordId, d.tenantId, d.vendorAgentId, d.acquisitionAgentId, d.purchaserAgentId, d.leasingAgentId]) {
          if (cid) companyIds.add(cid);
        }
        if (d.clientContactId) contactIds.add(d.clientContactId);
        for (const ag of d.internalAgent || []) {
          if (ag) agentNames.add(String(ag).trim());
        }
      }

      if (companyIds.size > 0) {
        const rows = await db.select({ name: crmCompanies.name }).from(crmCompanies).where(inArray(crmCompanies.id, [...companyIds])).limit(40);
        for (const r of rows) if (r.name && r.name.length >= 4) extraTerms.add(r.name.trim());
      }
      if (contactIds.size > 0) {
        const rows = await db.select({ name: crmContacts.name }).from(crmContacts).where(inArray(crmContacts.id, [...contactIds])).limit(20);
        for (const r of rows) if (r.name && r.name.length >= 4) extraTerms.add(r.name.trim());
      }

      // 4. Internal agents → priority mailboxes. internalAgent stores display
      //    names (e.g. "Jack Barratt"); resolve to bgp email addresses.
      if (agentNames.size > 0) {
        const active = await db.select({ email: users.email, username: users.username, name: users.name })
          .from(users).where(eq(users.isActive, true));
        for (const u of active) {
          const nm = (u.name || "").trim().toLowerCase();
          if (!nm) continue;
          for (const an of agentNames) {
            if (an.toLowerCase() === nm || nm.startsWith(an.toLowerCase()) || an.toLowerCase().startsWith(nm)) {
              const mb = u.email || u.username;
              if (mb && /@brucegillinghampollard\.com$/i.test(mb)) priorityMailboxes.add(mb);
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn(`[pathway baseline-email] CRM seed build failed: ${err?.message}`);
  }
  return { extraTerms: [...extraTerms], priorityMailboxes: [...priorityMailboxes] };
}

// Deterministic email sweep — runs alongside the Claude investigator so that
// even if Claude picks weak search terms, the core emails (address word,
// postcode, owner name, tenant name) are always pulled. Same Graph $search
// fan-out ChatBGP uses; caller merges the result into stage1.emailHits.
async function runBaselineEmailSweep(opts: {
  address: string;
  postcode: string;
  ownerName?: string;
  tenantName?: string;
  // Extra distinctive terms from CRM — deal name tokens, vendor/purchaser/
  // landlord/tenant company names, internal deal code. These catch the
  // "Dover Street Market" / "Goldenberg" / "Amsprop" type emails that
  // never mention the postal address.
  extraTerms?: string[];
  // Mailboxes to fan out to FIRST (before the rest). Usually the team
  // members assigned as internal agents on a linked CRM deal — e.g. Jack,
  // Nick, Tracey. Ensures the goldmine inbox gets searched even when the
  // 30-mailbox fan-out runs long.
  priorityMailboxes?: string[];
  req: Request;
}): Promise<any[]> {
  const { address, postcode, ownerName, tenantName, extraTerms, priorityMailboxes, req } = opts;
  const results: any[] = [];

  // Build term list. Prefer single-word distinctive terms (Graph $search
  // without quotes matches anywhere and tokenises nicely).
  const terms = new Set<string>();
  // Address distinctive word — same parser as the Inner path.
  const addrWithoutPostcode = address
    .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi, "")
    .replace(/,\s*UK\b/i, "").replace(/,\s*united\s*kingdom\b/i, "")
    .replace(/,\s*london\b/i, "").replace(/,\s*england\b/i, "")
    .trim().replace(/,\s*$/, "");
  const STOP = new Set(["street", "road", "avenue", "lane", "place", "square", "house", "building", "floor", "suite", "unit", "the", "and", "london"]);
  const words = (addrWithoutPostcode.toLowerCase().match(/[a-z]+/g) || []).filter((w) => w.length >= 4 && !STOP.has(w));
  if (words.length > 0) terms.add(words[0]); // most distinctive

  // Claude-style quoted street-number phrases ("22 Haymarket", "18-22 Haymarket")
  for (const phrase of buildAddressPhrases(address)) terms.add(phrase);

  if (postcode) terms.add(`"${postcode}"`); // quoted postcode = exact
  if (ownerName) {
    const first = String(ownerName).split(/[,(]/)[0].trim().replace(/\s+(ltd|limited|llp|plc)\b.*$/i, "").trim();
    if (first.length >= 4) terms.add(`"${first}"`);
  }
  if (tenantName) {
    const first = String(tenantName).split(/[,(]/)[0].trim().replace(/\s+(ltd|limited|llp|plc)\b.*$/i, "").trim();
    if (first.length >= 4) terms.add(`"${first}"`);
  }

  // CRM-derived terms (deal name, vendor/purchaser/tenant/landlord names,
  // internal deal code). Quote multi-word; strip corporate suffixes.
  const GENERIC_DEAL_TOKENS = new Set(["acquisition", "disposal", "sale", "letting", "lease", "investment", "retail", "office", "industrial", "haymarket", "street", "road", "square", "london", "the", "and"]);
  for (const raw of extraTerms || []) {
    if (!raw) continue;
    const cleaned = String(raw)
      .replace(/\s+(ltd|limited|llp|plc|partnership)\b.*$/i, "")
      .replace(/[()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (cleaned.length < 4) continue;
    // Multi-word → exact phrase. Single word → drop if it's a generic term
    // we already cover via address/postcode (e.g. "Haymarket").
    if (/\s/.test(cleaned)) {
      terms.add(`"${cleaned}"`);
    } else if (!GENERIC_DEAL_TOKENS.has(cleaned.toLowerCase())) {
      terms.add(`"${cleaned}"`);
    }
  }

  if (terms.size === 0) return [];

  const { graphRequest } = await import("./shared-mailbox");
  const { getValidMsToken } = await import("./microsoft");
  const delegatedToken = await getValidMsToken(req).catch(() => null);

  const prioritySet = new Set((priorityMailboxes || []).map((m) => m.toLowerCase()));
  const mailboxes: Array<{ email: string; owner: string; priority: boolean }> = [
    { email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox", priority: false },
  ];
  try {
    const active = await db.select({ username: users.username, email: users.email, name: users.name })
      .from(users).where(eq(users.isActive, true));
    for (const u of active) {
      const mb = u.email || u.username;
      if (mb && /@brucegillinghampollard\.com$/i.test(mb) && mb.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
        mailboxes.push({ email: mb, owner: u.name || mb, priority: prioritySet.has(mb.toLowerCase()) });
      }
    }
  } catch {}
  // Sort: priority mailboxes first, so in a bounded-time run their jobs
  // actually execute before the 30-mailbox fan-out exhausts its budget.
  mailboxes.sort((a, b) => (b.priority ? 1 : 0) - (a.priority ? 1 : 0));

  const seen = new Set<string>();
  const addrWord = words[0] || "";
  const pcCompact = (postcode || "").toLowerCase().replace(/\s+/g, "");
  const pushMsg = (msg: any, ownerLabel: string, mbEmail: string | undefined, matchedTerm: string) => {
    const key = msg.internetMessageId || msg.id;
    if (!key || seen.has(key)) return;
    // Subject/preview relevance filter — same spirit as Stage 1 Inner
    const hay = `${String(msg.subject || "").toLowerCase()} ${String(msg.bodyPreview || "").toLowerCase()}`;
    const hayCompact = hay.replace(/\s+/g, "");
    const termLc = matchedTerm.replace(/^"+|"+$/g, "").toLowerCase();
    // Trust quoted multi-word phrases (e.g. "22 Haymarket", "Dover Street Market")
    // — Graph $search already matched them against full body, and restricting
    // to subject+preview drops real hits where the address lives below the
    // 255-char preview. Still drop newsletter senders.
    const isQuotedPhrase = /^"[^"]+"$/.test(matchedTerm) && termLc.includes(" ");
    const fromAddr = String(msg.from?.emailAddress?.address || "").toLowerCase();
    const fromName = String(msg.from?.emailAddress?.name || "").toLowerCase();
    const NEWSLETTER = ["propel", "bigpropfirst", "costar", "estatesgazette", "egi", "react news", "propertyweek", "bisnow", "mailchimp", "mailerlite", "substack", "newsletter", "no-reply", "noreply", "do-not-reply"];
    if (NEWSLETTER.some((n) => fromAddr.includes(n) || fromName.includes(n))) return;
    const passes = isQuotedPhrase
      || hay.includes(termLc)
      || (pcCompact && hayCompact.includes(pcCompact))
      || (addrWord && hay.includes(addrWord));
    if (!passes) return;
    seen.add(key);
    results.push({
      subject: msg.subject ? `${msg.subject} · via ${ownerLabel}` : `(no subject) · via ${ownerLabel}`,
      from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
      date: msg.receivedDateTime,
      msgId: msg.id,
      mailboxEmail: mbEmail,
      preview: (msg.bodyPreview || "").slice(0, 200),
      hasAttachments: !!msg.hasAttachments,
      webLink: msg.webLink || null,
      matchedTerm,
    });
  };

  const CONC = 6;
  const jobs: Array<() => Promise<void>> = [];
  for (const mb of mailboxes) {
    for (const term of terms) {
      jobs.push(async () => {
        try {
          const res: any = await graphRequest(
            `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(term)}&$top=15&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
            { headers: { "X-AnchorMailbox": mb.email } }
          );
          for (const msg of (res?.value || [])) pushMsg(msg, mb.owner, mb.email, term);
        } catch {}
      });
    }
  }
  if (delegatedToken) {
    for (const term of terms) {
      jobs.push(async () => {
        try {
          const r = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(term)}&$top=15&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
            { headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" } }
          );
          if (!r.ok) return;
          const data: any = await r.json();
          for (const msg of (data?.value || [])) pushMsg(msg, "My inbox", undefined, term);
        } catch {}
      });
    }
  }
  for (let i = 0; i < jobs.length; i += CONC) {
    await Promise.all(jobs.slice(i, i + CONC).map((j) => j()));
  }

  results.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
  console.log(`[pathway baseline-email] address="${address}" terms=[${[...terms].join(", ")}] mailboxes=${mailboxes.length} (priority=${prioritySet.size}) → ${results.length} hits`);
  return results.slice(0, 80);
}

// Shared: pull investment + letting comps for a given postcode. Used by both
// the deterministic Inner path and the autonomous path so comps always show
// up on the board regardless of which Stage 1 variant runs.
async function fetchStage1Comps(postcode: string): Promise<any[]> {
  const comps: any[] = [];
  try {
    const outward = postcode ? postcode.toUpperCase().replace(/\s+/g, "").slice(0, -3) : "";

    // Submarket clusters — SW1Y (St James's) and W1J (Mayfair) swap comps
    // freely, so a Haymarket retail search should pull Bond Street evidence.
    // These sit between "exact outward" and "all central London" so we widen
    // progressively rather than jumping from SW1Y → London.
    const WEST_END = ["W1", "SW1", "WC1", "WC2"];
    const CITY_FRINGE = ["EC1", "EC2", "EC3", "EC4", "E1"];
    const SOUTH_BANK = ["SE1", "SE11", "SE16"];
    const CENTRAL_LONDON = ["W1", "W2", "SW1", "SW3", "SW5", "SW6", "SW7", "WC1", "WC2", "EC1", "EC2", "EC3", "EC4", "NW1", "SE1"];

    const pickCluster = (o: string): string[] => {
      if (!o) return CENTRAL_LONDON;
      if (WEST_END.some((c) => o.startsWith(c))) return WEST_END;
      if (CITY_FRINGE.some((c) => o.startsWith(c))) return CITY_FRINGE;
      if (SOUTH_BANK.some((c) => o.startsWith(c))) return SOUTH_BANK;
      return CENTRAL_LONDON;
    };
    const cluster = pickCluster(outward);

    const { pool } = await import("./db");
    const tierLog = { inv: { exact: 0, cluster: 0, central: 0 }, let: { exact: 0, cluster: 0, central: 0 } };

    // Investment sales — tier up: exact outward → submarket cluster → central London.
    // Stop widening once we have 8+ comps (enough evidence for the board).
    try {
      const runInvQuery = async (outwards: string[]) => {
        if (outwards.length === 0) return { rows: [] as any[] };
        return await pool.query(
          `SELECT address, price, cap_rate, transaction_date, subtype
             FROM investment_comps
            WHERE (${outwards.map((_, i) => `UPPER(REPLACE(COALESCE(postal_code, ''), ' ', '')) LIKE $${i + 1}`).join(" OR ")})
            ORDER BY transaction_date DESC NULLS LAST
            LIMIT 15`,
          outwards.map((c) => `${c}%`)
        );
      };
      let invRows: any[] = [];
      if (outward) {
        const exact = await runInvQuery([outward]);
        invRows = exact.rows;
        tierLog.inv.exact = invRows.length;
      }
      if (invRows.length < 8) {
        const seen = new Set(invRows.map((r) => (r.address || "").trim().toLowerCase()));
        const clu = await runInvQuery(cluster);
        tierLog.inv.cluster = clu.rows.length;
        for (const r of clu.rows) {
          if (!seen.has((r.address || "").trim().toLowerCase())) invRows.push(r);
          if (invRows.length >= 15) break;
        }
      }
      if (invRows.length < 8) {
        const seen = new Set(invRows.map((r) => (r.address || "").trim().toLowerCase()));
        const cen = await runInvQuery(CENTRAL_LONDON);
        tierLog.inv.central = cen.rows.length;
        for (const r of cen.rows) {
          if (!seen.has((r.address || "").trim().toLowerCase())) invRows.push(r);
          if (invRows.length >= 15) break;
        }
      }
      for (const r of invRows) {
        comps.push({
          address: r.address,
          price: r.price ? Number(r.price) : undefined,
          yield: r.cap_rate ? Number(r.cap_rate) : undefined,
          date: r.transaction_date,
          type: r.subtype,
          kind: "investment",
        });
      }
    } catch (err: any) {
      console.error("[pathway comps] investment_comps query error:", err?.message);
    }

    // Retail letting comps from crm_comps — postcode lives in the JSONB
    // address, so we regex the cast text. Anchor to word boundaries so "W1"
    // matches "W1J 7LA" but NOT "EW1" or "SW10".
    try {
      const runLetQuery = async (outwards: string[]) => {
        if (outwards.length === 0) return { rows: [] as any[] };
        const pattern = `(^|[^A-Z0-9])(${outwards.join("|")})([^A-Z0-9]|$)`;
        return await pool.query(
          `SELECT address, tenant, landlord, area_sqft, headline_rent, zone_a_rate, completion_date, comp_type, deal_type
             FROM crm_comps
            WHERE (address::text) ~* $1
            ORDER BY completion_date DESC NULLS LAST
            LIMIT 15`,
          [pattern]
        );
      };
      let letRows: any[] = [];
      if (outward) {
        const exact = await runLetQuery([outward]);
        letRows = exact.rows;
        tierLog.let.exact = letRows.length;
      }
      if (letRows.length < 8) {
        const seen = new Set(letRows.map((r) => `${r.tenant}|${r.completion_date}`));
        const clu = await runLetQuery(cluster);
        tierLog.let.cluster = clu.rows.length;
        for (const r of clu.rows) {
          const k = `${r.tenant}|${r.completion_date}`;
          if (!seen.has(k)) { letRows.push(r); seen.add(k); }
          if (letRows.length >= 15) break;
        }
      }
      if (letRows.length < 8) {
        const seen = new Set(letRows.map((r) => `${r.tenant}|${r.completion_date}`));
        const cen = await runLetQuery(CENTRAL_LONDON);
        tierLog.let.central = cen.rows.length;
        for (const r of cen.rows) {
          const k = `${r.tenant}|${r.completion_date}`;
          if (!seen.has(k)) { letRows.push(r); seen.add(k); }
          if (letRows.length >= 15) break;
        }
      }
      for (const r of letRows) {
        const addrText = typeof r.address === "object"
          ? [r.address?.line1, r.address?.postcode].filter(Boolean).join(", ")
          : String(r.address || "");
        comps.push({
          address: addrText || r.tenant || "—",
          tenant: r.tenant || undefined,
          rent: r.headline_rent || r.zone_a_rate || undefined,
          area: r.area_sqft || undefined,
          date: r.completion_date || undefined,
          type: r.comp_type || r.deal_type || undefined,
          kind: "letting",
        });
      }
    } catch (err: any) {
      console.error("[pathway comps] crm_comps query error:", err?.message);
    }

    console.log(`[pathway comps] outward=${outward} cluster=[${cluster.join(",")}] inv=${tierLog.inv.exact}+${tierLog.inv.cluster}+${tierLog.inv.central} let=${tierLog.let.exact}+${tierLog.let.cluster}+${tierLog.let.central} total=${comps.length}`);
  } catch (err: any) {
    console.error("[pathway comps] block error:", err?.message);
  }
  return comps;
}

async function runStage1(runId: string, req: Request): Promise<void> {
  try {
    // Autonomous investigator is the default path.
    // Set USE_AUTONOMOUS_STAGE1=0 to fall back to the classic deterministic pipeline.
    if (process.env.USE_AUTONOMOUS_STAGE1 === "0") {
      await runStage1Inner(runId, req);
    } else {
      await runStage1Autonomous(runId, req);
    }
  } catch (err: any) {
    const reason = err?.message || String(err);
    console.error(`[pathway stage1] FATAL — ${reason}`, err?.stack);
    await setStageStatus(runId, "stage1", "failed", { stage1: { summary: `Stage 1 failed: ${reason}`, emailHits: [], sharepointHits: [], crmHits: { properties: [], deals: [], companies: [] }, deals: [], comps: [], brochureFiles: [] } as any }).catch(() => {});
    throw err;
  }
}

/**
 * Auto-run AI email triage on the gathered emailHits. Returns a markdown
 * commentary that cites individual emails using `[E5]` notation (1-based
 * index into the original emailHits array). The client parses these
 * citations and turns them into clickable buttons that open the in-app
 * email viewer for that exact message.
 *
 * Returns null if the AI key isn't configured or there are no emails.
 * Never throws — Stage 1 must complete even if email triage fails.
 */
async function runEmailSort(address: string, emailHits: any[]): Promise<{ markdown: string } | null> {
  if (!emailHits || emailHits.length === 0) return null;
  if (!process.env.ANTHROPIC_API_KEY) return null;

  try {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const list = emailHits.slice(0, 80).map((e: any, i: number) => {
      const date = e.date ? new Date(e.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "?";
      return `E${i + 1}. [${date}] From: ${e.from} | Subject: ${String(e.subject || "").replace(" · via .*", "").trim()} | Preview: ${String(e.preview || "").slice(0, 140)}`;
    }).join("\n");

    const msg = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      messages: [{
        role: "user",
        content: `You are analysing emails found in a property investment firm's (Bruce Gillingham Pollard) inboxes for the property at: ${address || "unknown address"}.

Here are the ${emailHits.length} email hits indexed E1, E2, …:

${list}

Output **clean markdown commentary** for the analyst. Rules:

1. **Filter aggressively.** Most of these will be unrelated noise — newsletters, emails about *other* properties that share a word with this address, generic firm-wide alerts. Mention only emails that are genuinely about THIS property.
2. **Cite emails inline using [E#] notation** (e.g. "[E5]" or "[E12]"), referencing their original index. This is critical — the UI uses these tokens to deep-link to the source email. Cite every email you mention.
3. **Group by topic / thread**, ordered chronologically. Use ## headers for each thread.
4. **Each citation gets a one-line takeaway** — date, who it's from, what it reveals. Don't dump full subject lines.
5. **Note gaps** in passing if obvious (e.g. "no introduction email is in the inbox").
6. **End with 1-2 suggested actions** in a "## Next steps" section.
7. **Be concise — under 350 words total.**

If after filtering NONE of the emails are about this property, just output:
> No emails in the BGP inboxes are about this property.

Don't apologise or hedge — just write the commentary.`
      }],
    });

    const markdown = (msg.content[0] as any)?.text || "";
    if (!markdown.trim()) return null;
    return { markdown: markdown.trim() };
  } catch (err: any) {
    console.warn("[pathway email-sort] auto-run failed:", err?.message);
    return null;
  }
}

// Autonomous investigator wrapper — delegates Stage 1 to Claude+tools
async function runStage1Autonomous(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage1", "running");

  const { runInvestigativeStage1, executeInvestigatorTool } = await import("./pathway-investigator");
  const runAny = run as any;
  const uprn: string | null = runAny.uprn || null;
  // Extract street name by finding the first address token that contains letters
  // (handles "18, 22 Haymarket, London SW1Y 4DG, UK" where comma splits the number range)
  const streetName = (() => {
    const parts = run.address.split(",").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      // strip leading number/range like "18", "1-5", "18-22"
      const cleaned = p.replace(/^[\d\s\-–&]+/, "").trim();
      // needs at least 3 letters to be a street name (skip postcodes, countries)
      if (cleaned.length >= 3 && /[a-zA-Z]{3,}/.test(cleaned) && !/^(london|uk|united kingdom|england)$/i.test(cleaned) && !/^[a-z]{1,2}\d/i.test(cleaned)) {
        // Drop trailing descriptors like "Street", "Road", "Lane" — keep just the name word
        return cleaned.replace(/\s+(street|road|rd|lane|ln|avenue|ave|place|pl|square|sq|mews|terrace|gardens|hill|way)$/i, "").trim();
      }
    }
    return "";
  })();
  console.log(`[pathway stage1] streetName="${streetName}" from address="${run.address}"`);

  // Phase 1: Run deterministic APIs immediately (~5-10s) and save partial results
  // so the user sees ownership/rates/CRM data while the Claude email loop runs.
  const prefetch: Array<{ tool: string; result: any }> = [];
  await Promise.all([
    executeInvestigatorTool("crm_lookup", { query: run.address.split(",")[0].trim(), type: "all" }, req)
      .then((r) => prefetch.push({ tool: "crm_lookup", result: r })).catch(() => {}),
    run.postcode
      ? executeInvestigatorTool("land_registry_lookup", { address: run.address, postcode: run.postcode }, req)
          .then((r) => prefetch.push({ tool: "land_registry_lookup", result: r })).catch(() => {})
      : Promise.resolve(),
    run.postcode
      ? executeInvestigatorTool("voa_rates_lookup", { postcode: run.postcode, street: streetName }, req)
          .then((r) => prefetch.push({ tool: "voa_rates_lookup", result: r })).catch(() => {})
      : Promise.resolve(),
    run.postcode
      ? executeInvestigatorTool("valuation_lookup", { postcode: run.postcode, property_type: "office" }, req)
          .then((r) => prefetch.push({ tool: "valuation_lookup", result: r })).catch(() => {})
      : Promise.resolve(),
  ]);
  if (uprn) {
    prefetch.push({ tool: "uprn_resolved", result: { uprn, formattedAddress: runAny.formattedAddress, lat: runAny.lat, lng: runAny.lng } });
  }
  const crmPF = prefetch.find((p) => p.tool === "crm_lookup")?.result;
  const landRegPF = prefetch.find((p) => p.tool === "land_registry_lookup")?.result;
  const voaPF = prefetch.find((p) => p.tool === "voa_rates_lookup")?.result;

  // Guarantee the pathway run is linked to a CRM property — matches an
  // existing entry if crm_lookup found one, otherwise auto-creates a stub
  // so downstream stages (tenancy, valuations, business plan) always have
  // somewhere to hang their results.
  const linkedCrm = await ensureCrmPropertyLink(run, crmPF?.properties || []);
  if (linkedCrm) {
    const props = crmPF?.properties || [];
    if (!props.find((p: any) => p?.id === linkedCrm.id)) {
      props.unshift(linkedCrm);
    }
    if (crmPF) crmPF.properties = props;
  }
  const partialPayload: any = {
    emailHits: [], sharepointHits: [], brochureFiles: [],
    tenancy: { status: "unknown", units: [] }, engagements: [], pricePaidHistory: [], comps: [],
    crmHits: { properties: crmPF?.properties || [], deals: crmPF?.deals || [], companies: crmPF?.companies || [] },
    deals: crmPF?.deals || [],
    initialOwnership: (() => {
      const fhs = landRegPF?.freeholds || [];
      // Prefer the first title with an actual proprietor name — postcode-
      // wide LR lookups sometimes return a title with a blank proprietor
      // in position 0, which would blank out the whole ownership card.
      const best = fhs.find((f: any) => f?.proprietor?.trim()) || fhs[0];
      if (!best) return null;
      return {
        titleNumber: best.titleNumber || "unknown",
        proprietorName: best.proprietor,
        proprietorCompanyNumber: null,
        dateOfPurchase: best.dateOfPurchase,
      };
    })(),
    rates: voaPF?.count > 0 ? {
      totalRateableValue: voaPF.totalRateableValue,
      assessmentCount: voaPF.count,
      entries: voaPF.entries || [],
    } : undefined,
    summary: `Investigating ${run.address}…`,
    _partial: true,
  };
  const freshRun = await getRun(runId);
  await updateRun(runId, { stageResults: { ...(freshRun?.stageResults as any || {}), stage1: partialPayload } });
  console.log(`[pathway stage1 autonomous] Partial results saved — landReg=${!!landRegPF?.freeholds?.length}, voa=${voaPF?.count || 0}, crm deals=${crmPF?.deals?.length || 0}`);

  // Phase 2: Claude email + SharePoint investigation (~60-150s)
  const started = Date.now();
  const result = await runInvestigativeStage1({
    address: run.address,
    postcode: run.postcode,
    req,
    externalPrefetch: prefetch,
  });

  // Google Street View + Maps link
  const mapsQuery = encodeURIComponent([run.address, run.postcode].filter(Boolean).join(", "));
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const propertyImage = {
    streetViewUrl: gmapsKey
      ? `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${mapsQuery}&fov=80&key=${gmapsKey}`
      : undefined,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
  };

  // Map investigator result into the existing stage1 shape so the UI works unchanged
  const stage1Payload: any = {
    emailHits: (result.keyEmails || []).map((e) => ({
      subject: e.subject,
      from: e.from,
      date: e.date,
      msgId: e.msgId,
      mailboxEmail: e.mailboxEmail,
      preview: e.preview || "",
      hasAttachments: !!e.hasAttachments,
      webLink: e.webLink || null,
    })),
    sharepointHits: (result.sharepointMatches || []).map((s) => ({
      name: s.name,
      path: s.path,
      webUrl: s.webUrl,
      type: s.type,
    })),
    crmHits: {
      properties: result.crmMatches?.properties || [],
      deals: result.crmMatches?.deals || [],
      companies: result.crmMatches?.companies || [],
    },
    deals: result.crmMatches?.deals || [],
    tenancy: { status: "unknown", units: [] },
    engagements: [],
    pricePaidHistory: [],
    comps: await fetchStage1Comps(run.postcode || ""),
    brochureFiles: (result.brochures || []).map((b) => ({
      source: b.source === "sharepoint" ? "sharepoint" : "email",
      name: b.name,
      ref: b.ref || "",
      date: b.date,
      webUrl: b.webUrl,
    })),
    initialOwnership: result.ownership ? {
      titleNumber: result.ownership.titleNumber || "unknown",
      proprietorName: result.ownership.owner,
      proprietorCompanyNumber: result.ownership.ownerCompanyNumber,
      pricePaid: undefined,
      dateOfPurchase: result.ownership.dateOfPurchase,
    } : null,
    tenant: result.tenancy?.tenant ? {
      name: result.tenancy.tenant,
      companyNumber: result.tenancy.tenantCompanyNumber,
    } : undefined,
    aiBriefing: result.aiBriefing,
    aiFacts: {
      owner: result.ownership?.owner,
      ownerCompanyNumber: result.ownership?.ownerCompanyNumber,
      purchasePrice: result.ownership?.pricePaid,
      purchaseDate: result.ownership?.dateOfPurchase,
      refurbCost: result.ownership?.refurbCost,
      currentUse: result.property?.currentUse
        ? String(result.property.currentUse)
            .replace(/^(not confirmed[^.]*\.|data source[^.]*\.|property_data_lookup[^.]*\.)\s*/i, "")
            .slice(0, 120)
        : undefined,
      sizeSqft: result.property?.sizeSqft,
      mainTenants: result.tenancy?.mainOccupiers || (result.tenancy?.tenant ? [result.tenancy.tenant] : []),
      leaseStatus: result.tenancy?.leaseStatus,
      listedStatus: result.property?.listedStatus
        ? (() => {
            const v = String(result.property.listedStatus).trim();
            // Only accept short, badge-worthy values (e.g. "Grade II", "Not listed")
            if (v.length > 40 || /not confirmed|property_data_lookup|returned null|to be verified/i.test(v)) return undefined;
            return v;
          })()
        : undefined,
      passingRent: result.tenancy?.passingRent,
    },
    propertyImage,
    rates: result.rates ? {
      totalRateableValue: result.rates.totalRV,
      assessmentCount: result.rates.assessmentCount,
      entries: result.rates.entries || [],
    } : undefined,
    valuation: (() => {
      const pfVal = prefetch.find((p) => p.tool === "valuation_lookup")?.result;
      const fromPf = pfVal && !pfVal.error ? {
        marketRentPerSqft: pfVal.marketRent?.averagePerSqft ?? null,
        marketRentMinPerSqft: pfVal.marketRent?.minPerSqft ?? null,
        marketRentMaxPerSqft: pfVal.marketRent?.maxPerSqft ?? null,
        estimatedErvAnnual: pfVal.estimatedRent?.annual ?? null,
        estimatedErvPerSqft: pfVal.estimatedRent?.perSqft ?? null,
        estimatedCapitalValue: pfVal.estimatedCapitalValue?.estimate ?? null,
        estimatedCapValuePerSqft: pfVal.estimatedCapitalValue?.perSqft ?? null,
        propertyType: pfVal.propertyType ?? null,
      } : null;
      const fromClaude = (result as any).valuation || null;
      return fromPf || fromClaude || undefined;
    })(),
    summary: result.aiBriefing?.headline || `Investigation complete for ${run.address}.`,
    toolTrace: result.toolTrace,
  };

  // Cross-validate AI ownership against the UPRN-precise resolver result.
  // The autonomous investigator can hallucinate plausible-but-fictional title
  // numbers (e.g. NGL939200) when it can't find a real one — those then fail
  // when the user clicks "Order Title Register" because PropertyData has no
  // record of them. The verified resolver (resolveBuildingTitles via
  // land_registry_lookup → matched.freeholds) is authoritative; prefer it.
  const verifiedOwnership = partialPayload.initialOwnership as any;
  const verifiedTitle = verifiedOwnership?.titleNumber;
  const aiOwnership = stage1Payload.initialOwnership as any;
  const aiTitle = aiOwnership?.titleNumber;
  if (verifiedTitle && verifiedTitle !== "unknown") {
    if (aiTitle && aiTitle !== "unknown" && aiTitle !== verifiedTitle) {
      console.log(`[pathway stage1] AI proposed title=${aiTitle} but UPRN-resolver returned ${verifiedTitle} — using verified (AI title may have been hallucinated)`);
    }
    // Verified resolver wins. Keep AI-derived enrichment fields (e.g. purchase
    // price, proprietor company number from web research) where the resolver
    // didn't fill them.
    stage1Payload.initialOwnership = {
      ...(aiOwnership || {}),
      ...verifiedOwnership,
      titleNumber: verifiedTitle,
      proprietorName: verifiedOwnership.proprietorName || aiOwnership?.proprietorName,
    };
  } else if (!aiOwnership && verifiedOwnership) {
    // No AI ownership and no verified title (resolver returned only enrichment) —
    // take the prefetch as-is so we still surface what we have.
    stage1Payload.initialOwnership = verifiedOwnership;
  } else if (aiTitle && aiTitle !== "unknown" && !verifiedTitle) {
    // AI gave a title but the resolver couldn't verify any UPRN. Keep the AI's
    // answer (it may still be right — PropertyData/OS coverage isn't complete)
    // but log clearly so we can trace title-not-found errors back to here.
    console.warn(`[pathway stage1] AI title=${aiTitle} is unverified — UPRN resolver returned no matched freeholds for ${run.address} ${run.postcode || ""}. Order failures expected.`);
  }
  if (!stage1Payload.rates && partialPayload.rates) {
    stage1Payload.rates = partialPayload.rates;
  }
  if (!stage1Payload.rates && partialPayload.rates) {
    stage1Payload.rates = partialPayload.rates;
  }
  if ((!stage1Payload.crmHits?.deals?.length) && crmPF?.deals?.length) {
    stage1Payload.crmHits = partialPayload.crmHits;
    stage1Payload.deals = partialPayload.deals;
  }

  // Baseline email sweep — deterministic belt-and-braces so we always get the
  // core hits (address word + postcode + owner + tenant) even if Claude's
  // search_emails calls were light. Merges into emailHits, dedupes.
  try {
    const { extraTerms, priorityMailboxes } = await buildCrmSweepSeed(crmPF);
    const baseline = await runBaselineEmailSweep({
      address: run.address,
      postcode: run.postcode || "",
      ownerName: stage1Payload.initialOwnership?.proprietorName || stage1Payload.aiFacts?.owner,
      tenantName: stage1Payload.tenant?.name || stage1Payload.aiFacts?.mainTenants?.[0],
      extraTerms,
      priorityMailboxes,
      req,
    });
    if (baseline.length > 0) {
      const existingKeys = new Set<string>();
      for (const e of stage1Payload.emailHits) {
        if (e?.msgId) existingKeys.add(String(e.msgId));
        existingKeys.add(`${String(e?.subject || "").trim().toLowerCase()}|${String(e?.from || "").trim().toLowerCase()}`);
      }
      const newHits = baseline.filter((e: any) => {
        const k1 = String(e.msgId || "");
        const k2 = `${String(e.subject || "").trim().toLowerCase()}|${String(e.from || "").trim().toLowerCase()}`;
        return !existingKeys.has(k1) && !existingKeys.has(k2);
      });
      stage1Payload.emailHits = [...stage1Payload.emailHits, ...newHits]
        .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
        .slice(0, 120);
      console.log(`[pathway stage1 autonomous] Baseline sweep added ${newHits.length} emails (total ${stage1Payload.emailHits.length})`);
    }
  } catch (err: any) {
    console.warn(`[pathway stage1 autonomous] baseline email sweep failed: ${err?.message}`);
  }

  // Tenancy extraction: if the SharePoint sweep returned any tenancy
  // schedule / rent roll files, download and parse them so we surface
  // every occupier instead of just the anchor the email extractor found.
  try {
    const { extractTenancyUnitsFromSharePointHits } = await import("./pathway-tenancy-extractor");
    const extracted = await extractTenancyUnitsFromSharePointHits(stage1Payload.sharepointHits || [], req);
    if (extracted.length > 0) {
      const existing = stage1Payload.tenancy?.units || [];
      const existingKeys = new Set(existing.map((u: any) => `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`));
      const merged = [...existing];
      for (const u of extracted) {
        const key = `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        merged.push({
          id: `sp-${merged.length}`,
          unitName: u.unitName,
          floor: u.floor,
          sqft: u.sqft,
          tenantName: u.tenantName,
          passingRentPa: u.passingRentPa,
          useClass: u.useClass,
          marketingStatus: u.marketingStatus,
          leaseStart: u.leaseStart,
          leaseExpiry: u.leaseExpiry,
          source: "sharepoint",
        });
      }
      const vacantCount = merged.filter((u: any) => /vacant/i.test(u.marketingStatus || "")).length;
      const status: "vacant" | "let" | "mixed" | "unknown" =
        merged.length === 0 ? "unknown" : vacantCount === merged.length ? "vacant" : vacantCount === 0 ? "let" : "mixed";
      stage1Payload.tenancy = { ...(stage1Payload.tenancy || {}), status, units: merged };
      console.log(`[pathway stage1 autonomous] SharePoint tenancy extractor merged ${extracted.length} units (total ${merged.length})`);
    }
  } catch (err: any) {
    console.warn(`[pathway stage1 autonomous] tenancy extractor failed: ${err?.message}`);
  }

  // AI email triage — replaces the noisy raw email list in the UI with a
  // narrative grouped/filtered commentary. Cites individual emails inline
  // as [E5] tokens that the client renders as clickable links into the
  // in-app email viewer. Best-effort: never blocks Stage 1 completion.
  try {
    const commentary = await runEmailSort(run.address, stage1Payload.emailHits || []);
    if (commentary) {
      stage1Payload.emailCommentary = {
        markdown: commentary.markdown,
        generatedAt: new Date().toISOString(),
      };
      console.log(`[pathway stage1 autonomous] email commentary generated (${commentary.markdown.length} chars from ${stage1Payload.emailHits?.length || 0} hits)`);
    }
  } catch (err: any) {
    console.warn(`[pathway stage1 autonomous] email commentary failed: ${err?.message}`);
  }

  console.log(`[pathway stage1 autonomous] Completed in ${((Date.now() - started) / 1000).toFixed(1)}s — ${stage1Payload.emailHits.length} emails, ${stage1Payload.brochureFiles.length} brochures, ${stage1Payload.sharepointHits.length} sharepoint`);

  await setStageStatus(runId, "stage1", "completed", { stage1: stage1Payload });

  // Persist the Stage 1 LR snapshot to land_registry_searches so it shows up on
  // the Land Registry board (same table the direct LR page writes to). Matches
  // the runStage1Inner persist path — it was previously only wired there, which
  // meant the default autonomous path never populated the LR history. Re-query
  // PropertyData with layers: ["core"] so we persist the full raw rows the LR
  // board renders (the investigator tool returns a trimmed shape for Claude).
  try {
    const stage1UserId = (run as any).startedBy || null;
    const hasOwnership = !!stage1Payload.initialOwnership;
    if (stage1UserId) {
      // Use the building-title resolver so the persisted snapshot reflects the
      // titles that ACTUALLY belong to this building, not every freehold in
      // the postcode. Falls back to street-number-filtered context if no
      // UPRN match is found.
      const { resolveBuildingTitles } = await import("./land-registry");
      const lr = await resolveBuildingTitles({
        address: run.address,
        postcode: run.postcode || "",
        skipPersist: true,
      }).catch(() => null);
      const matchedFh = lr?.ok ? lr.matched.freeholds : [];
      const matchedLh = lr?.ok ? lr.matched.leaseholds : [];
      const fallbackFh = lr?.ok ? lr.fallback.freeholds : [];
      const contextFh = lr?.ok ? lr.context.freeholds : [];
      const freeholds = matchedFh.length > 0 ? matchedFh : (fallbackFh.length > 0 ? fallbackFh : contextFh);
      const leaseholds = matchedLh;
      const hasLrData = freeholds.length > 0 || leaseholds.length > 0 || hasOwnership;
      console.log(`[pathway stage1 autonomous] persist LR check: userId=set freeholds=${freeholds.length} leaseholds=${leaseholds.length} ownership=${hasOwnership ? "yes" : "no"} source=${lr?.ok ? lr.source : "error"}`);
      if (hasLrData) {
        const { persistLandRegistrySearch } = await import("./land-registry");
        const saved = await persistLandRegistrySearch({
          userId: stage1UserId,
          address: run.address,
          postcode: run.postcode || "",
          freeholds,
          leaseholds,
          ownership: stage1Payload.initialOwnership ?? undefined,
          source: "pathway",
          pathwayRunId: runId,
        });
        console.log(`[pathway stage1 autonomous] persisted LR search id=${(saved as any)?.id || "?"} for runId=${runId}`);
      }
    } else {
      console.warn(`[pathway stage1 autonomous] SKIP persist: run.startedBy is null for runId=${runId}`);
    }
  } catch (err: any) {
    console.warn("[pathway stage1 autonomous] persistLandRegistrySearch failed:", err?.message);
  }

  if (result.sharepointMatches && result.sharepointMatches.length > 0) {
    // Try to find the canonical folder for this property
    const folderMatch = result.sharepointMatches.find((s) => s.type === "folder" && (s.path || "").includes("Investment"));
    if (folderMatch) {
      await updateRun(runId, {
        sharepointFolderPath: folderMatch.path,
        sharepointFolderUrl: folderMatch.webUrl,
      });
    }
  }
}

async function runStage1Inner(runId: string, req: Request): Promise<void> {
  const stage1Start = Date.now();
  const phaseTimer = (label: string, startMs: number) => {
    console.log(`[pathway stage1] ${label} took ${Date.now() - startMs}ms`);
  };
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage1", "running");

  const address = run.address;
  const postcode = run.postcode || "";
  const searchTerms = address.split(/[, ]+/).filter((t) => t.length > 2);

  // Kick off the market-intel crawl in parallel with the rest of Stage 1.
  // We await its result just before the AI briefing so the analyst can
  // weave lease comps / availability / market context into the briefing.
  const marketIntelPromise: Promise<StageResults["marketIntel"] | null> = runMarketIntelCrawl(address, postcode)
    .catch((err: any) => {
      console.error("[pathway stage1] market-intel crawl error:", err?.message || err);
      return null;
    });

  // 1a. Search CRM for existing records
  let crmHits = { properties: [] as any[], deals: [] as any[], companies: [] as any[] };
  try {
    const propertyMatches = await db
      .select()
      .from(crmProperties)
      .where(
        or(
          ilike(crmProperties.name, `%${address}%`),
          postcode ? ilike(crmProperties.name, `%${postcode}%`) : ilike(crmProperties.name, `%__nomatch__%`)
        )
      )
      .limit(10);
    crmHits.properties = propertyMatches;
  } catch (err: any) {
    console.error("[pathway stage1] CRM search error:", err?.message);
  }

  // Auto-link or auto-create so the pathway always has a CRM anchor.
  try {
    const linkedCrm = await ensureCrmPropertyLink(run, crmHits.properties);
    if (linkedCrm && !crmHits.properties.find((p: any) => p?.id === linkedCrm.id)) {
      crmHits.properties.unshift(linkedCrm);
    }
  } catch (err: any) {
    console.error("[pathway stage1] ensureCrmPropertyLink error:", err?.message);
  }

  // 1b. Ownership — prefer CRM data if we already have it, fall back to the
  // shared resolveBuildingTitles helper which does Google geocode → OS Places
  // by lat/lng → PD address-match-uprn → PD uprn-title. Crucially we ONLY
  // assert ownership from the building-matched titles (matched.freeholds) —
  // never from the postcode-wide context list, because postcodes like
  // SW1Y 4DG cover several buildings (e.g. 18-22 Haymarket + 4 Panton St
  // behind it). Picking from the postcode list used to silently misattribute
  // a neighbour's title to the queried building.
  let initialOwnership: NonNullable<StageResults["stage1"]>["initialOwnership"] = null;
  const crmMatch = crmHits.properties[0];
  if (crmMatch?.proprietorName || crmMatch?.titleNumber) {
    initialOwnership = {
      titleNumber: crmMatch.titleNumber || "unknown",
      proprietorName: crmMatch.proprietorName || undefined,
      proprietorCategory: crmMatch.proprietorType || undefined,
    };
  }
  let voaEntries: Array<{ firmName?: string; address?: string; postcode?: string; description?: string; rateableValue?: number | null; effectiveDate?: string; }> = [];
  let stage1FreeholdsData: any[] = [];
  let stage1LeaseholdsData: any[] = [];
  try {
    // Authoritative title resolution — UPRN-precise.
    const { resolveBuildingTitles } = await import("./land-registry");
    const lr = await resolveBuildingTitles({ address, postcode, skipPersist: true });
    if (lr.ok) {
      const matchedFh = lr.matched.freeholds || [];
      const matchedLh = lr.matched.leaseholds || [];
      const fallbackFh = lr.fallback.freeholds || [];
      const contextFh = lr.context.freeholds || [];
      // Persist matched first, then fallback (street-number filter) for
      // visibility on the LR board, but keep context out of "ownership".
      stage1FreeholdsData = matchedFh.length > 0
        ? matchedFh
        : fallbackFh.length > 0 ? fallbackFh : contextFh;
      stage1LeaseholdsData = matchedLh;

      const ownershipPool = matchedFh.length > 0 ? matchedFh : fallbackFh;
      if (ownershipPool.length > 0) {
        const best = ownershipPool.find((f: any) => f?.proprietor_name_1?.trim()) || ownershipPool[0];
        initialOwnership = {
          titleNumber: best.title_number || best.title || initialOwnership?.titleNumber || "unknown",
          proprietorName: best.proprietor_name_1 || initialOwnership?.proprietorName,
          proprietorCategory: best.proprietor_category || initialOwnership?.proprietorCategory,
          pricePaid: best.price_paid ? Number(best.price_paid) : initialOwnership?.pricePaid,
          dateOfPurchase: best.date_proprietor_added || initialOwnership?.dateOfPurchase,
        };
        console.log(`[pathway stage1] ownership resolved via ${lr.source} — title=${initialOwnership.titleNumber} owner=${initialOwnership.proprietorName || "?"}`);
      } else {
        console.log(`[pathway stage1] no UPRN-matched title for "${address}" in ${postcode} — leaving ownership null (postcode had ${contextFh.length} other titles)`);
      }
    } else {
      console.warn(`[pathway stage1] resolveBuildingTitles failed (${lr.status}): ${lr.error}`);
    }

    // Still run performPropertyLookup for non-LR layers (VOA, EPC, planning,
    // market intel). LR responsibilities now sit with resolveBuildingTitles.
    const lookup = await performPropertyLookup({ address, postcode, layers: ["core"] });
    if (Array.isArray((lookup as any).voaRatings)) {
      voaEntries = (lookup as any).voaRatings;
    }
  } catch (err: any) {
    console.error("[pathway stage1] Land reg / VOA lookup error:", err?.message);
  }

  // Persist this Stage 1 LR snapshot to land_registry_searches so it shows up
  // on the Land Registry board the same way a direct LR search would. Tagged
  // source=pathway + the runId so we can link back from the LR page.
  try {
    const stage1UserId = (run as any).startedBy || null;
    const hasLrData = stage1FreeholdsData.length > 0 || stage1LeaseholdsData.length > 0 || !!initialOwnership;
    console.log(`[pathway stage1] persist LR check: userId=${stage1UserId ? "set" : "NULL"} freeholds=${stage1FreeholdsData.length} leaseholds=${stage1LeaseholdsData.length} ownership=${initialOwnership ? "yes" : "no"}`);
    if (stage1UserId && hasLrData) {
      const { persistLandRegistrySearch } = await import("./land-registry");
      const saved = await persistLandRegistrySearch({
        userId: stage1UserId,
        address,
        postcode,
        freeholds: stage1FreeholdsData,
        leaseholds: stage1LeaseholdsData,
        ownership: initialOwnership ?? undefined,
        source: "pathway",
        pathwayRunId: runId,
      });
      console.log(`[pathway stage1] persisted LR search id=${(saved as any)?.id || "?"} for runId=${runId}`);
    } else if (hasLrData && !stage1UserId) {
      console.warn(`[pathway stage1] SKIP persist: have LR data but run.startedBy is null for runId=${runId}`);
    }
  } catch (err: any) {
    console.warn("[pathway stage1] persistLandRegistrySearch failed:", err?.message);
  }

  // Rates fallback: if performPropertyLookup returned no VOA data but we have
  // a postcode, query VOA directly. Prefer the local SQLite snapshot
  // (server/voa-sqlite.ts); if it's not mounted yet, fall back to the legacy
  // Postgres voa_ratings table so we don't regress during rollout.
  if (voaEntries.length === 0 && postcode) {
    try {
      const { voaSqliteAvailable, lookupVoaByPostcode } = await import("./voa-sqlite");
      if (voaSqliteAvailable()) {
        const rows = lookupVoaByPostcode(postcode, undefined, 30);
        for (const r of rows) {
          voaEntries.push({
            firmName: r.firmName || undefined,
            address: r.address,
            postcode: r.postcode,
            description: r.description || undefined,
            rateableValue: r.rateableValue,
            effectiveDate: r.effectiveDate || undefined,
          });
        }
        console.log(`[pathway stage1] VOA SQLite lookup for ${postcode}: ${voaEntries.length} rows`);
      } else {
        const { pool } = await import("./db");
        const normalisedPc = postcode.replace(/\s+/g, "").toUpperCase();
        const formattedPc = normalisedPc.length > 3 ? `${normalisedPc.slice(0, -3)} ${normalisedPc.slice(-3)}` : normalisedPc;
        const res = await pool.query(
          `SELECT firm_name, number_or_name, street, town, postcode, description_text, rateable_value, effective_date
             FROM voa_ratings
            WHERE UPPER(REPLACE(postcode, ' ', '')) = $1
            ORDER BY rateable_value DESC NULLS LAST
            LIMIT 30`,
          [normalisedPc]
        );
        for (const r of res.rows) {
          voaEntries.push({
            firmName: r.firm_name || undefined,
            address: [r.number_or_name, r.street, r.town].filter(Boolean).join(", "),
            postcode: r.postcode || formattedPc,
            description: r.description_text || undefined,
            rateableValue: r.rateable_value != null ? Number(r.rateable_value) : null,
            effectiveDate: r.effective_date || undefined,
          });
        }
        console.log(`[pathway stage1] VOA Postgres fallback for ${formattedPc}: ${voaEntries.length} rows`);
      }
    } catch (err: any) {
      console.warn("[pathway stage1] VOA direct query error:", err?.message);
    }
  }

  // 1b-1. If we have a proprietor name, try to match it to an existing CRM company
  // so the owner cell can link straight through. Also surface Companies House number
  // if the CRM record has one.
  if (initialOwnership?.proprietorName) {
    try {
      const name = initialOwnership.proprietorName.trim();
      const [ownerCompany] = await db
        .select()
        .from(crmCompanies)
        .where(ilike(crmCompanies.name, name))
        .limit(1);
      if (ownerCompany) {
        initialOwnership.proprietorCompanyId = ownerCompany.id;
        const chNum = (ownerCompany as any).companiesHouseNumber || (ownerCompany as any).companies_house_number;
        if (chNum) initialOwnership.proprietorCompanyNumber = String(chNum);
      }
    } catch (err: any) {
      console.warn("[pathway stage1] owner CRM match error:", err?.message);
    }
  }

  // 1b-2. SharePoint folder tree — NEVER auto-create in Stage 1 (would spawn
  // a new folder every search, cluttering SharePoint). Only surface the
  // folder if one already exists (either stored on the run, or discoverable
  // at the expected Investment/{address} path).
  let folderTree: NonNullable<StageResults["stage1"]>["folderTree"] | undefined;
  if (run.sharepointFolderPath && run.sharepointFolderUrl) {
    folderTree = {
      root: run.sharepointFolderPath,
      webUrl: run.sharepointFolderUrl,
      children: STANDARD_FOLDER_TREE,
    };
  } else {
    try {
      const { lookupSharePointFolderIfExists } = await import("./utils/sharepoint-operations");
      const propertyFolderName = address.replace(/[\/\\:*?"<>|]/g, "-").slice(0, 120);
      const existing = await lookupSharePointFolderIfExists(
        { folderName: propertyFolderName, parentPath: "Investment" },
        req
      );
      if (existing) {
        folderTree = {
          root: existing.path,
          webUrl: existing.webUrl,
          children: STANDARD_FOLDER_TREE,
        };
        run.sharepointFolderPath = folderTree.root;
        run.sharepointFolderUrl = folderTree.webUrl;
        await updateRun(run.id, {
          sharepointFolderPath: folderTree.root,
          sharepointFolderUrl: folderTree.webUrl,
        });
      }
    } catch (err: any) {
      console.warn("[pathway stage1] Folder lookup (non-fatal):", err?.message);
    }
  }

  // 1c. Email search via Microsoft Graph.
  //     - PRIMARY: search the current user's OWN inbox using their delegated
  //       token (same path ChatBGP uses — always works for the signed-in user).
  //     - BONUS: also search the shared inbox + team mailboxes using the app
  //       token, IF the Azure app has admin-consented Mail.Read. Silently
  //       skipped on 403 (no permission).
  const emailHits: NonNullable<StageResults["stage1"]>["emailHits"] = [];
  try {
    const { graphRequest } = await import("./shared-mailbox");
    const { getValidMsToken } = await import("./microsoft");
    const delegatedToken = await getValidMsToken(req).catch(() => null);

    // Build the list of mailboxes to search: shared mailbox first, then every active BGP user
    const mailboxes: Array<{ email: string; owner: string }> = [
      { email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" },
    ];
    try {
      const activeUsers = await db
        .select({ username: users.username, email: users.email, name: users.name })
        .from(users)
        .where(eq(users.isActive, true));
      for (const u of activeUsers) {
        const mailbox = u.email || u.username;
        if (mailbox && /@brucegillinghampollard\.com$/i.test(mailbox) && mailbox.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
          mailboxes.push({ email: mailbox, owner: u.name || mailbox });
        }
      }
    } catch (err: any) {
      console.warn("[pathway stage1] team mailbox list error:", err?.message);
    }

    // Build word-based search phrases. Graph's $search treats quoted
    // multi-word strings as EXACT phrase match — so `"18-22 Haymarket"` only
    // matches emails with that literal string, missing emails that just say
    // "Haymarket" or "18 Haymarket House". Instead: pick the most distinctive
    // single word(s) from the address (e.g. "Haymarket"), plus the postcode.
    // Single words aren't treated as phrases, so they match case-insensitively.
    // Google's geocoded address is "18, 22 Haymarket, London SW1Y 4DG, UK".
    // Splitting on the first comma gives "18" — no letters, no distinctive
    // word to search. Strip postcode + ", UK" + ", London" instead and use
    // everything before it as the source for distinctive words. Works for
    // "18 22 Haymarket" AND "Kings House, High Street, Ruislip HA4 0RG".
    const addrWithoutPostcode = address
      .replace(/\b[a-z]{1,2}\d[a-z\d]?\s*\d[a-z]{2}\b/gi, "")
      .replace(/,\s*UK\b/i, "")
      .replace(/,\s*united\s*kingdom\b/i, "")
      .replace(/,\s*london\b/i, "")
      .replace(/,\s*england\b/i, "")
      .trim()
      .replace(/,\s*$/, "");
    const primaryAddressToken = addrWithoutPostcode || (address.split(",")[0] || "").trim();
    // Pick distinctive words from the address — >=4 chars, skipping common road/type words and pure numbers.
    const STOPWORDS = new Set(["street", "road", "avenue", "lane", "place", "square", "house", "building", "floor", "suite", "unit", "the", "and", "london"]);
    const distinctiveWords = primaryAddressToken
      .toLowerCase()
      .match(/[a-z]+/g) // letters only — skips pure numbers like "18" and "22"
      ?.filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      || [];
    const searchPhrases: string[] = [];
    // Primary phrase: most distinctive word (often the street/building name).
    // Single-word queries work reliably with $search.
    if (distinctiveWords.length > 0) searchPhrases.push(distinctiveWords[0]);
    // Claude-style quoted street-number phrases — these match full body in
    // Graph $search and pull the high-quality thread hits ChatBGP finds.
    for (const phrase of buildAddressPhrases(address)) searchPhrases.push(phrase);
    // Also try the postcode as a separate query (most specific signal)
    if (postcode) searchPhrases.push(`"${postcode}"`);
    // Fallback
    if (searchPhrases.length === 0) searchPhrases.push(`"${primaryAddressToken || address}"`);

    // Relevance filter — keep emails where the postcode OR address word
    // appears in subject/preview, plus drop different-postcode subjects and
    // newsletter senders. Graph across 30 mailboxes returns hundreds of hits
    // where "Haymarket" is just in a signature/attachment/footer — trusting
    // Graph blindly produces massive noise.
    const postcodeLc = (postcode || "").toLowerCase().replace(/\s+/g, "");
    const POSTCODE_RE = /\b([a-z]{1,2}\d[a-z\d]?)\s*(\d[a-z]{2})\b/gi;
    const addressWords = primaryAddressToken
      .toLowerCase()
      .match(/[a-z0-9-]+/g)
      ?.filter((w: string) => w.length >= 4 && !["the", "and", "for", "with", "from", "street", "road", "avenue", "lane", "place", "square", "house", "building"].includes(w))
      || [];
    const NEWSLETTER_SENDERS = [
      "propelinfo", "propel", "bigpropfirst", "costar", "estatesgazette", "egi", "react news",
      "propertyweek", "property week", "pie mag", "resi mag", "bisnow", "mailchimp",
      "mailerlite", "substack", "newsletter", "no-reply", "noreply", "do-not-reply",
      "firmdale", "fallow",
    ];
    const mentionsAddress = (msg: any, trustedPhrase: boolean) => {
      const subject = String(msg.subject || "").toLowerCase();
      const preview = String(msg.bodyPreview || "").toLowerCase();
      const fromAddr = String(msg.from?.emailAddress?.address || "").toLowerCase();
      const fromName = String(msg.from?.emailAddress?.name || "").toLowerCase();
      const hay = `${subject} ${preview}`;
      const hayNoSpaces = hay.replace(/\s+/g, "");

      // 1) Different postcode in subject → drop (clearly another property)
      const postcodesInSubject: string[] = [];
      let m: RegExpExecArray | null;
      const re = new RegExp(POSTCODE_RE);
      while ((m = re.exec(subject)) !== null) {
        postcodesInSubject.push((m[1] + m[2]).toLowerCase());
      }
      if (postcodesInSubject.length > 0 && postcodeLc && !postcodesInSubject.includes(postcodeLc)) {
        return false;
      }

      // 2) Newsletter / marketing sender → drop
      for (const n of NEWSLETTER_SENDERS) {
        if (fromAddr.includes(n) || fromName.includes(n)) return false;
      }

      // 3) Trusted phrase match — Graph found the address phrase in the body.
      //    Keep by default (the phrase match is strong evidence), but drop if
      //    the subject explicitly names a DIFFERENT street — that's the
      //    signature-bleed problem (e.g. "22 King Street, Sandwich" matching
      //    because Michelle's sig contains "18-22 Haymarket").
      if (trustedPhrase) {
        // Drop if subject has a different postcode (already handled above, belt+braces)
        if (postcodesInSubject.length > 0 && postcodeLc && !postcodesInSubject.includes(postcodeLc)) {
          return false;
        }
        // Drop if subject contains a road-type word (Street/Road/etc.) but none
        // of our distinctive address words — clear sign it's about a different address.
        const hasStreetWord = /\b(street|road|avenue|lane|gardens?|place|crescent|terrace|close|drive|court|walk)\b/i.test(subject);
        const hasOurWord = addressWords.some((w) => subject.includes(w));
        if (hasStreetWord && !hasOurWord) return false;
        return true;
      }

      // 4) Postcode in subject/preview → keep (strong signal)
      if (postcodeLc && hayNoSpaces.includes(postcodeLc)) return true;
      // 5) Address word in subject/preview → keep
      if (addressWords.some((w) => hay.includes(w))) return true;

      // Otherwise, Graph matched on body/attachment content — too noisy at 30-mailbox scale.
      return false;
    };

    const seen = new Set<string>();
    let totalReturnedFromGraph = 0;

    const pushMsg = (msg: any, ownerLabel: string, mailboxEmail?: string, trustedPhrase = false) => {
      // Dedupe by internetMessageId (same message across mailboxes) AND also
      // by subject+sender (catches newsletters sent as separate messages to
      // each mailbox, which have different internetMessageIds)
      const primaryKey = msg.internetMessageId || msg.id;
      const subjFromKey = `${String(msg.subject || "").trim().toLowerCase()}|${String(msg.from?.emailAddress?.address || "").trim().toLowerCase()}`;
      if (seen.has(primaryKey) || seen.has(subjFromKey)) return;
      if (!mentionsAddress(msg, trustedPhrase)) return;
      seen.add(primaryKey);
      seen.add(subjFromKey);
      emailHits.push({
        subject: msg.subject ? `${msg.subject} · via ${ownerLabel}` : `(no subject) · via ${ownerLabel}`,
        from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
        date: msg.receivedDateTime,
        msgId: msg.id,
        mailboxEmail,
        preview: (msg.bodyPreview || "").slice(0, 200),
        hasAttachments: !!msg.hasAttachments,
        webLink: msg.webLink || null,
      });
    };

    // PRIMARY: current user's OWN inbox via delegated token (always works)
    if (delegatedToken) {
      for (const phrase of searchPhrases) {
        const isQuotedPhrase = /^"[^"]+"$/.test(phrase) && phrase.includes(" ");
        try {
          const url = `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(phrase)}&$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`;
          const resp = await fetch(url, { headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" } });
          if (!resp.ok) {
            console.warn(`[pathway stage1] /me/messages search (${phrase}) failed: ${resp.status}`);
            continue;
          }
          const data: any = await resp.json();
          const messages = data?.value || [];
          totalReturnedFromGraph += messages.length;
          for (const msg of messages) pushMsg(msg, "My inbox", undefined, isQuotedPhrase);
        } catch (err: any) {
          console.warn(`[pathway stage1] /me/messages search error (${phrase}):`, err?.message);
        }
      }
    }

    // Team mailboxes via app-only token — batched to keep memory low.
    // Running all 60 requests concurrently blew Railway's memory budget.
    // Concurrency 6 = ~10 waves, still fast (~30-60s) but peak memory stays reasonable.
    const errorsByMailbox: Record<string, string> = {};
    const successfulMailboxes = new Set<string>();
    const CONC = 6;

    const allJobs: Array<() => Promise<void>> = [];
    for (const mb of mailboxes) {
      for (const phrase of searchPhrases) {
        const isQuotedPhrase = /^"[^"]+"$/.test(phrase) && phrase.includes(" ");
        allJobs.push(async () => {
          try {
            const searchRes: any = await graphRequest(
              `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(phrase)}&$top=15&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
              { headers: { "X-AnchorMailbox": mb.email } }
            );
            successfulMailboxes.add(mb.email);
            const messages = searchRes?.value || [];
            totalReturnedFromGraph += messages.length;
            for (const msg of messages) pushMsg(msg, mb.owner, mb.email, isQuotedPhrase);
          } catch (err: any) {
            if (!errorsByMailbox[mb.email]) {
              errorsByMailbox[mb.email] = String(err?.message || err).slice(0, 200);
            }
          }
        });
      }
    }
    // Run jobs in rolling waves of CONC
    for (let i = 0; i < allJobs.length; i += CONC) {
      await Promise.all(allJobs.slice(i, i + CONC).map((j) => j()));
    }
    if (Object.keys(errorsByMailbox).length > 0) {
      console.warn(`[pathway stage1] Mailboxes that errored:`, JSON.stringify(errorsByMailbox, null, 2));
    }
    console.log(`[pathway stage1] Email search: delegated=${delegatedToken ? "yes" : "no"}, phrases=[${searchPhrases.join(", ")}], addressWords=[${addressWords.join(",")}], mailboxes tried=${mailboxes.length}, mailboxes OK=${successfulMailboxes.size} -> ${totalReturnedFromGraph} raw hits, ${emailHits.length} kept after regex filter`);
    emailHits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    // Cap at 120 — the regex filter is already tight, so this just protects
    // against pathological cases. Older relevant emails (2015, 2023) stay in.
    emailHits.splice(120);
  } catch (err: any) {
    console.error("[pathway stage1] Email search error:", err?.message);
  }

  // 1c-2. Deal history — every crm_deal linked to the matching CRM property
  const deals: NonNullable<StageResults["stage1"]>["deals"] = [];
  if (crmMatch?.id) {
    try {
      const dealRows = await db.select().from(crmDeals).where(eq(crmDeals.propertyId, crmMatch.id)).limit(25);
      for (const d of dealRows) {
        deals.push({
          id: d.id,
          name: d.name,
          stage: d.stage ?? undefined,
          status: d.status ?? undefined,
          dealType: d.dealType ?? undefined,
          team: d.team ?? undefined,
          rentPa: d.rentPa ?? undefined,
          fee: d.fee ?? undefined,
          createdAt: d.createdAt ? new Date(d.createdAt as any).toISOString() : undefined,
        });
      }
    } catch (err: any) {
      console.error("[pathway stage1] crm_deals query error:", err?.message);
    }
  }

  // 1c-3. Tenancy — available_units rows for this CRM property
  let tenancy: NonNullable<StageResults["stage1"]>["tenancy"] | undefined;
  if (crmMatch?.id) {
    try {
      const units = await db.select().from(availableUnits).where(eq(availableUnits.propertyId, crmMatch.id)).limit(50);
      if (units.length) {
        const vacant = units.filter((u) => (u.marketingStatus || "Available").toLowerCase() === "available").length;
        const let_ = units.length - vacant;
        const status: "vacant" | "let" | "mixed" | "unknown" = vacant === units.length ? "vacant" : let_ === units.length ? "let" : "mixed";
        tenancy = {
          status,
          units: units.map((u) => ({
            id: u.id,
            unitName: u.unitName,
            floor: u.floor ?? undefined,
            sqft: u.sqft ?? undefined,
            askingRent: u.askingRent ?? undefined,
            marketingStatus: u.marketingStatus ?? undefined,
            useClass: u.useClass ?? undefined,
          })),
        };
      }
    } catch (err: any) {
      console.error("[pathway stage1] available_units query error:", err?.message);
    }
  }

  // 1c-4. Price paid history — PropertyData sold-prices by postcode (street-filtered client-side)
  const pricePaidHistory: NonNullable<StageResults["stage1"]>["pricePaidHistory"] = [];
  if (postcode && process.env.PROPERTYDATA_API_KEY) {
    try {
      const pdRes = await fetch(`https://api.propertydata.co.uk/sold-prices?key=${process.env.PROPERTYDATA_API_KEY}&postcode=${encodeURIComponent(postcode.replace(/\s+/g, ""))}`, { signal: AbortSignal.timeout(15000) });
      if (pdRes.ok) {
        const pd: any = await pdRes.json();
        // PropertyData's response shape varies: sometimes {data: {transactions: []}},
        // sometimes {data: []}, sometimes {data: {}} when no results. Normalise.
        let sold: any[] = [];
        if (Array.isArray(pd?.data?.transactions)) sold = pd.data.transactions;
        else if (Array.isArray(pd?.data)) sold = pd.data;
        else if (Array.isArray(pd?.transactions)) sold = pd.transactions;
        const streetKey = address.split(",")[0].trim().toLowerCase();
        for (const row of sold.slice(0, 40)) {
          const rowAddr = (row.address || row.full_address || "").toLowerCase();
          if (!streetKey || rowAddr.includes(streetKey.split(/\s+/).slice(-1)[0]?.slice(0, 10) || "")) {
            pricePaidHistory.push({
              address: row.address || row.full_address,
              price: row.price ? Number(row.price) : undefined,
              date: row.date || row.transaction_date,
              type: row.type || row.property_type,
            });
          }
        }
      }
    } catch (err: any) {
      console.error("[pathway stage1] sold-prices lookup error:", err?.message);
    }
  }

  // 1c-4b. PropertyData market-tone — retail/offices quoting rents + resi
  // rent & sold £/sqft for this sector. These are aggregate tone figures,
  // not per-deal comps — surfaced separately on the board so they don't
  // pollute the true-comp tables, but useful as a market anchor.
  let pdMarket: NonNullable<StageResults["stage1"]>["pdMarket"] = undefined;
  if (postcode) {
    try {
      const { fetchPropertyDataMarketTone } = await import("./propertydata-market");
      const tone = await fetchPropertyDataMarketTone(postcode);
      if (tone) pdMarket = tone;
    } catch (err: any) {
      console.error("[pathway stage1] propertydata market-tone error:", err?.message);
    }
  }

  // 1c-5. Comps — both investment (sales) AND letting from CRM. Always include
  // a central-London baseline so the board has something to anchor to even when
  // no comps exist in the exact outward code (e.g. SW1Y has few RCA rows).
  //
  // `kind` distinguishes: "investment" = sale transaction (price, yield),
  //                       "letting"    = retail lease (rent, area, tenant).
  // UI renders them in separate sub-sections under the one Comps card.
  const comps: NonNullable<StageResults["stage1"]>["comps"] = [];
  try {
    const outward = postcode ? postcode.toUpperCase().replace(/\s+/g, "").slice(0, -3) : "";
    const CENTRAL_LONDON_OUTWARDS = ["W1", "W2", "SW1", "SW3", "SW7", "WC1", "WC2", "EC1", "EC2", "EC3", "EC4", "NW1", "SE1"];
    const { pool } = await import("./db");

    // Investment sales — exact outward first, then central-London fallback.
    try {
      const primary = outward ? await pool.query(
        `SELECT address, price, cap_rate, transaction_date, subtype
           FROM investment_comps
          WHERE UPPER(REPLACE(COALESCE(postal_code, ''), ' ', '')) LIKE $1
          ORDER BY transaction_date DESC NULLS LAST
          LIMIT 15`,
        [`${outward}%`]
      ) : { rows: [] };
      let invRows = primary.rows;
      if (invRows.length === 0) {
        const fallback = await pool.query(
          `SELECT address, price, cap_rate, transaction_date, subtype
             FROM investment_comps
            WHERE (${CENTRAL_LONDON_OUTWARDS.map((_, i) => `UPPER(REPLACE(COALESCE(postal_code, ''), ' ', '')) LIKE $${i + 1}`).join(" OR ")})
            ORDER BY transaction_date DESC NULLS LAST
            LIMIT 15`,
          CENTRAL_LONDON_OUTWARDS.map(c => `${c}%`)
        );
        invRows = fallback.rows;
      }
      for (const r of invRows) {
        comps.push({
          address: r.address,
          price: r.price ? Number(r.price) : undefined,
          yield: r.cap_rate ? Number(r.cap_rate) : undefined,
          date: r.transaction_date,
          type: r.subtype,
          kind: "investment",
        } as any);
      }
    } catch (err: any) {
      console.error("[pathway stage1] investment_comps query error:", err?.message);
    }

    // Retail letting comps from crm_comps — postcode lives inside the address
    // JSONB, so we filter by group_name/comp_type as a proxy and rank by
    // recency. Prefers same outward code via text LIKE on the JSONB.
    try {
      const letRes = await pool.query(
        `SELECT address, tenant, landlord, area_sqft, headline_rent, zone_a_rate, completion_date, comp_type, deal_type
           FROM crm_comps
          WHERE (
            (address::text) ~* $1
            OR EXISTS (SELECT 1 FROM unnest($2::text[]) pc WHERE (address::text) ~* pc)
          )
          ORDER BY completion_date DESC NULLS LAST
          LIMIT 15`,
        [outward || "SW1|W1|WC", CENTRAL_LONDON_OUTWARDS]
      );
      for (const r of letRes.rows) {
        const addrText = typeof r.address === "object"
          ? [r.address?.line1, r.address?.postcode].filter(Boolean).join(", ")
          : String(r.address || "");
        comps.push({
          address: addrText || r.tenant || "—",
          tenant: r.tenant || undefined,
          rent: r.headline_rent || r.zone_a_rate || undefined,
          area: r.area_sqft || undefined,
          date: r.completion_date || undefined,
          type: r.comp_type || r.deal_type || undefined,
          kind: "letting",
        } as any);
      }
    } catch (err: any) {
      console.error("[pathway stage1] crm_comps query error:", err?.message);
    }
  } catch (err: any) {
    console.error("[pathway stage1] comps block error:", err?.message);
  }

  // 1c-6. Identify likely brochure attachments from email hits — and actually
  // fetch the attachments, uploading any PDFs to the pathway SharePoint folder
  // so they become clickable links in the board.
  //
  // Matching rules (ordered by confidence):
  //   A. Filename contains the property's distinctive word → DEFINITELY this property
  //   B. Filename contains a DIFFERENT well-known property name → NOT this property, drop
  //   C. Otherwise: only accept if email subject contains property's distinctive
  //      word OR postcode (i.e. email is specifically about this property),
  //      AND filename has brochure-like keywords OR is a reasonably-sized PDF.
  const brochureFiles: NonNullable<StageResults["stage1"]>["brochureFiles"] = [];
  const BROCHURE_SUBJECT_RE = /brochure|particulars|marketing|teaser|flyer|\bom\b|memorandum|information memorandum|investment memo/i;
  const BROCHURE_FILENAME_RE = /brochure|particulars|teaser|flyer|memorandum|investment|marketing|\bim\b|\bom\b/i;
  const NOISE_FILENAME_RE = /^(signature|image|logo|disclaimer|footer)/i;

  // Distinctive words from the subject property (e.g. "haymarket")
  const brochurePrimaryToken = (address.split(",")[0] || "").trim();
  const propertyDistinctiveWords = (brochurePrimaryToken
    .toLowerCase()
    .match(/[a-z]+/g) || [])
    .filter((w: string) => w.length >= 5 && !["street", "road", "avenue", "lane", "place", "square", "house", "building", "floor", "suite", "unit"].includes(w));
  const pcLc = (postcode || "").toLowerCase().replace(/\s+/g, "");

  const filenameLooksLikeDifferentProperty = (fn: string): boolean => {
    // If filename contains OUR property word → it's ours
    const fnLc = fn.toLowerCase();
    if (propertyDistinctiveWords.some((w: string) => fnLc.includes(w))) return false;
    // Otherwise check for well-known London property/street names that would indicate a
    // different property. If the filename leads with one of these, it's almost certainly
    // not about our target.
    // We use filename words >=5 chars as a proxy for "probably a property name".
    const firstWords = fn.replace(/\.\w+$/, "").split(/[\s_\-]+/).filter((w) => /^[A-Za-z]{5,}$/.test(w)).slice(0, 2);
    if (firstWords.length === 0) return false;
    // If our address words don't appear at all AND the filename leads with capitalised
    // property-like words, flag as different property
    const suspiciousPropertyLeadRE = /^(islington|glasshouse|hammersmith|regent|bond|mayfair|soho|pall|kingsway|sloane|fleet|oxford|bank|lombard|fenchurch|cannon|chancery|gracechurch|belgrave|knightsbridge|piccadilly|kensington|chelsea|shoreditch|clerkenwell|farringdon|blackfriars|waterloo|borough|marylebone|victoria|paddington|euston|holborn|covent|russell|bloomsbury|fitzrovia)/i;
    return suspiciousPropertyLeadRE.test(fn);
  };

  try {
    const { graphRequest } = await import("./shared-mailbox");

    // First pass: identify candidate emails fast (no attachment fetches yet)
    const candidateEmails = emailHits.filter((e) => {
      if (!e.hasAttachments) return false;
      const subjectLc = String(e.subject || "").toLowerCase();
      const previewLc = String(e.preview || "").toLowerCase();
      const subjAboutProperty =
        (!!pcLc && (subjectLc.replace(/\s+/g, "").includes(pcLc) || previewLc.replace(/\s+/g, "").includes(pcLc))) ||
        propertyDistinctiveWords.some((w: string) => subjectLc.includes(w) || previewLc.includes(w));
      return BROCHURE_SUBJECT_RE.test(e.subject) || subjAboutProperty;
    });

    // Cap to top 8 candidates to keep memory + time low
    const topCandidates = candidateEmails.slice(0, 8);

    // Per-email attachment processor. Returns brochure records to push.
    const processEmail = async (e: any): Promise<any[]> => {
      const out: any[] = [];
      const subjectLc = String(e.subject || "").toLowerCase();
      const previewLc = String(e.preview || "").toLowerCase();
      const subjAboutProperty =
        (!!pcLc && (subjectLc.replace(/\s+/g, "").includes(pcLc) || previewLc.replace(/\s+/g, "").includes(pcLc))) ||
        propertyDistinctiveWords.some((w: string) => subjectLc.includes(w) || previewLc.includes(w));

      if (!e.mailboxEmail) {
        out.push({ source: "email", name: e.subject, ref: e.msgId, date: e.date });
        return out;
      }
      try {
        const atts: any = await graphRequest(
          `/users/${encodeURIComponent(e.mailboxEmail)}/messages/${e.msgId}/attachments?$select=id,name,size,contentType,isInline`
        ).catch(() => null);
        const attachments = atts?.value || [];
        for (const a of attachments) {
          const filename = String(a.name || "");
          if (a.isInline) continue;
          if (NOISE_FILENAME_RE.test(filename)) continue;

          const filenameMatchesProperty = propertyDistinctiveWords.some((w: string) => filename.toLowerCase().includes(w));
          if (!filenameMatchesProperty && filenameLooksLikeDifferentProperty(filename)) continue;

          const isPdf = /\.pdf$/i.test(filename) || /application\/pdf/i.test(a.contentType || "");
          const filenameBrochurish = BROCHURE_FILENAME_RE.test(filename);
          if (!filenameMatchesProperty) {
            if (!subjAboutProperty) continue;
            if (!isPdf && !filenameBrochurish) continue;
          }

          // Skip large files (>15MB) — not typical brochures, and tight memory
          if (a.size && a.size > 15 * 1024 * 1024) {
            console.warn(`[pathway stage1] skipping oversized attachment: ${filename} (${Math.round(a.size / 1024 / 1024)}MB)`);
            out.push({ source: "email", name: filename, ref: e.msgId, date: e.date, sizeMB: +(a.size / 1024 / 1024).toFixed(2) });
            continue;
          }

          // Fetch + upload with timeout
          let fileBuffer: Buffer | null = null;
          try {
            const rawRes: any = await Promise.race([
              graphRequest(`/users/${encodeURIComponent(e.mailboxEmail)}/messages/${e.msgId}/attachments/${a.id}`),
              new Promise((_, reject) => setTimeout(() => reject(new Error("attachment fetch timeout")), 30000)),
            ]);
            if (rawRes?.contentBytes) {
              fileBuffer = Buffer.from(rawRes.contentBytes, "base64");
            }
          } catch (err: any) {
            console.warn("[pathway stage1] attachment fetch failed:", filename, err?.message);
          }

          let savedUrl: string | undefined;
          let sizeMB: number | undefined;
          if (fileBuffer && run.sharepointFolderPath) {
            const brochureFolder = `${run.sharepointFolderPath.replace(/^BGP share drive\//, "")}/Brochure & Marketing`;
            try {
              const up = await Promise.race([
                executeUploadFileToSharePoint(
                  { folderPath: brochureFolder, filename, content: fileBuffer, contentType: a.contentType },
                  req
                ),
                new Promise<any>((_, reject) => setTimeout(() => reject(new Error("SharePoint upload timeout")), 60000)),
              ]);
              savedUrl = up.file.webUrl;
              sizeMB = up.file.sizeMB;
            } catch (err: any) {
              console.warn("[pathway stage1] brochure upload failed:", filename, err?.message);
            }
          } else if (fileBuffer) {
            sizeMB = +(fileBuffer.length / 1024 / 1024).toFixed(2);
          }

          out.push({
            source: savedUrl ? "sharepoint-uploaded" : "email",
            name: filename,
            ref: e.msgId,
            date: e.date,
            webUrl: savedUrl,
            sizeMB,
          });
        }
      } catch (err: any) {
        console.warn("[pathway stage1] attachment scan failed for", e.msgId, err?.message);
      }
      return out;
    };

    // Process in parallel with concurrency 2 to keep memory low
    // (each brochure can be up to 15MB buffered temporarily)
    const CONCURRENCY = 2;
    for (let i = 0; i < topCandidates.length; i += CONCURRENCY) {
      const slice = topCandidates.slice(i, i + CONCURRENCY);
      const results = await Promise.all(slice.map(processEmail));
      for (const r of results) brochureFiles.push(...r);
    }
  } catch (err: any) {
    console.error("[pathway stage1] brochure attachment scan error:", err?.message);
  }

  // 1c-7. Engagements — unit viewings for units on this property, plus interactions with related deals
  const engagements: NonNullable<StageResults["stage1"]>["engagements"] = [];
  try {
    const unitIds = tenancy?.units?.map((u) => u.id) || [];
    if (unitIds.length) {
      const viewings = await db.select().from(unitViewings).where(inArray(unitViewings.unitId, unitIds)).limit(30);
      for (const v of viewings) {
        engagements.push({
          source: "unit_viewing",
          contact: v.contactName ?? undefined,
          company: v.companyName ?? undefined,
          date: v.viewingDate ?? undefined,
          outcome: v.outcome ?? undefined,
          notes: v.notes ? String(v.notes).slice(0, 200) : undefined,
          unitName: tenancy?.units?.find((u) => u.id === v.unitId)?.unitName,
        });
      }
    }
  } catch (err: any) {
    console.error("[pathway stage1] unit_viewings query error:", err?.message);
  }

  // 1c-8. SharePoint search — find any existing folders/files matching the address
  const sharepointHits: NonNullable<StageResults["stage1"]>["sharepointHits"] = [];
  try {
    const { getValidMsToken } = await import("./microsoft");
    const { getSharePointDriveId } = await import("./utils/sharepoint-operations");
    const token = await getValidMsToken(req);
    if (token) {
      const driveId = await getSharePointDriveId(token);
      if (driveId) {
        // Search terms: the street/building name (first part of address) + postcode
        const streetTerm = address.split(",")[0].trim();
        const queries = [streetTerm, postcode].filter((q) => q && q.length >= 3);
        const seen = new Set<string>();
        for (const q of queries) {
          try {
            const searchUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='${encodeURIComponent(q)}')`;
            const resp = await fetch(searchUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
            if (!resp.ok) continue;
            const data: any = await resp.json();
            for (const item of (data.value || []).slice(0, 40)) {
              if (seen.has(item.id)) continue;
              seen.add(item.id);
              const path = item.parentReference?.path?.replace(/\/drive\/root:/, "") || "";
              const hit = {
                name: item.name,
                path,
                webUrl: item.webUrl,
                modifiedAt: item.lastModifiedDateTime,
                sizeMB: item.size ? Math.round((item.size / 1024 / 1024) * 100) / 100 : undefined,
                type: item.file?.mimeType || (item.folder ? "folder" : "file"),
              };
              sharepointHits.push(hit);
              // Any brochure-like file name also gets surfaced in brochureFiles
              if (item.file && /brochure|particulars|teaser|flyer|memorandum|om\.pdf|pitch/i.test(item.name)) {
                brochureFiles.push({
                  source: "sharepoint",
                  name: item.name,
                  ref: item.id,
                  date: item.lastModifiedDateTime,
                  webUrl: item.webUrl,
                });
              }
            }
          } catch (err: any) {
            console.warn("[pathway stage1] SharePoint search error:", err?.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.error("[pathway stage1] SharePoint search setup error:", err?.message);
  }

  // Tenancy extraction: parse any tenancy-schedule / rent-roll XLSX files
  // found in the SharePoint sweep and merge into the tenancy.units list.
  try {
    const { extractTenancyUnitsFromSharePointHits } = await import("./pathway-tenancy-extractor");
    const extracted = await extractTenancyUnitsFromSharePointHits(sharepointHits, req);
    if (extracted.length > 0) {
      const existing = tenancy?.units || [];
      const existingKeys = new Set(existing.map((u: any) => `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`));
      const merged = [...existing];
      for (const u of extracted) {
        const key = `${(u.unitName || "").toLowerCase()}|${(u.tenantName || "").toLowerCase()}`;
        if (existingKeys.has(key)) continue;
        existingKeys.add(key);
        merged.push({
          id: `sp-${merged.length}`,
          unitName: u.unitName,
          floor: u.floor,
          sqft: u.sqft,
          tenantName: u.tenantName,
          passingRentPa: u.passingRentPa,
          useClass: u.useClass,
          marketingStatus: u.marketingStatus,
          leaseStart: u.leaseStart,
          leaseExpiry: u.leaseExpiry,
          source: "sharepoint" as const,
        });
      }
      const vacantCount = merged.filter((u: any) => /vacant/i.test(u.marketingStatus || "")).length;
      const status: "vacant" | "let" | "mixed" | "unknown" =
        merged.length === 0 ? "unknown" : vacantCount === merged.length ? "vacant" : vacantCount === 0 ? "let" : "mixed";
      tenancy = { ...(tenancy || {}), status, units: merged };
      console.log(`[pathway stage1] SharePoint tenancy extractor merged ${extracted.length} units (total ${merged.length})`);
    }
  } catch (err: any) {
    console.warn(`[pathway stage1] tenancy extractor failed: ${err?.message}`);
  }

  const summary = [
    `Initial search complete for ${address}.`,
    crmHits.properties.length ? `${crmHits.properties.length} CRM property record(s).` : `No existing CRM records.`,
    initialOwnership?.proprietorName ? `Owner: ${initialOwnership.proprietorName} (title ${initialOwnership.titleNumber}).` : `Ownership not resolved.`,
    deals.length ? `${deals.length} deal(s) in pipeline/history.` : null,
    tenancy?.units?.length ? `${tenancy.units.length} unit(s) on file — ${tenancy.status}.` : null,
    engagements.length ? `${engagements.length} viewing(s)/interaction(s) logged.` : null,
    emailHits.length ? `${emailHits.length} email(s) in shared mailbox.` : null,
    sharepointHits.length ? `${sharepointHits.length} existing SharePoint item(s) matching this address.` : null,
    brochureFiles.length ? `${brochureFiles.length} brochure-style file(s) identified.` : null,
    pricePaidHistory.length ? `${pricePaidHistory.length} past transaction(s) on this street.` : null,
    comps.length ? `${comps.length} investment comp(s) in same outward code.` : null,
    folderTree ? `SharePoint folder tree ready.` : null,
  ].filter(Boolean).join(" ");

  // Resolve the parallel market-intel crawl before the briefing so the
  // analyst can reference lease comps, availability and submarket context.
  const marketIntel = await marketIntelPromise;

  // 1e. AI briefing — synthesise everything into a short "what do we know" card
  let aiBriefing: NonNullable<StageResults["stage1"]>["aiBriefing"] | undefined;
  let aiFacts: NonNullable<StageResults["stage1"]>["aiFacts"] | undefined;
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const briefContext = {
        address,
        postcode,
        ownership: initialOwnership,
        crmProperty: crmMatch ? { name: crmMatch.name, status: crmMatch.status, notes: crmMatch.notes, proprietorName: crmMatch.proprietorName, proprietorType: crmMatch.proprietorType } : null,
        deals: deals.slice(0, 10),
        tenancy: tenancy ? { status: tenancy.status, unitCount: tenancy.units?.length } : null,
        engagements: engagements.slice(0, 10),
        pricePaidHistory: pricePaidHistory.slice(0, 8),
        comps: comps.slice(0, 8),
        brochureCount: brochureFiles.length,
        sharepointCount: sharepointHits.length,
        emailCount: emailHits.length,
        // Include VOA rateable value data so briefing can surface unit splits,
        // occupier identities and hint at rent levels.
        voaRates: voaEntries.slice(0, 15).map((e) => ({ firmName: e.firmName, address: e.address, description: e.description, rateableValue: e.rateableValue })),
        // Include email subject + preview for context
        recentEmails: emailHits.slice(0, 15).map((e) => ({ subject: e.subject, from: e.from, date: e.date, preview: e.preview })),
        // Market intel crawled this run — lease history at the building,
        // nearby availability, comparable transactions, submarket context.
        marketIntel: marketIntel
          ? {
              keyFindings: marketIntel.keyFindings || [],
              marketContext: marketIntel.marketContext || "",
              leasingHistory: (marketIntel.leasingHistory || []).slice(0, 8),
              comparables: (marketIntel.comparables || []).slice(0, 8),
              currentAvailability: (marketIntel.currentAvailability || []).slice(0, 6),
            }
          : null,
      };
      const prompt = `You are BGP's head of investment briefing an analyst. From the Stage 1 intelligence pool below, extract KEY FACTS and write a briefing.

The intelligence pool includes a "marketIntel" object with lease comps, submarket context and availability crawled fresh from the web — treat it as first-class evidence alongside CRM, VOA and email data. Weave specific rents, lease terms and comps into the bullets where they're relevant.

Return STRICT JSON only — no prose, no code fences:
{
  "headline": "1-sentence top-line (e.g. 'Trophy Mayfair retail/office, let to Dover Street Market until 2034, last marketed at £65m in 2023 by Goldenberg')",
  "bullets": [
    "4-8 concise bullets — each a specific observation grounded in the data. Lead with what we know, not what's missing.",
    "Weave in lease terms, rents, ownership, tenant covenant, BGP history with the asset, past marketing, comps — anything concrete.",
    "Use British English. No fluff. No 'further investigation required' clichés."
  ],
  "keyQuestions": [
    "2-4 specific follow-ups a senior analyst would ask next. Short and actionable."
  ],
  "facts": {
    "owner": "Registered owner if mentioned — e.g. 'Amsprop Estates Limited'. Omit if not in data.",
    "ownerCompanyNumber": "Companies House number if mentioned — e.g. '02801817'. Omit if not in data.",
    "purchasePrice": "Last recorded acquisition price — e.g. '£31m (Nov 2013)'. Omit if not in data.",
    "purchaseDate": "Date of last acquisition — e.g. 'Nov 2013'. Omit if not in data.",
    "refurbCost": "Capex spent on refurb if mentioned — e.g. '£60m'. Omit if not in data.",
    "currentUse": "Use class / split — e.g. 'Mixed-use retail/offices, 36,500 sq ft'. Omit if not in data.",
    "sizeSqft": "Numeric sqft if mentioned — e.g. '36500'. Omit if not in data.",
    "mainTenants": ["Array of main tenants — e.g. ['Dover Street Market', 'Rose Bakery']. Empty array if none."],
    "leaseStatus": "Lease status summary — e.g. 'Let to Dover Street Market since March 2016'. Omit if not known.",
    "listedStatus": "Listed building status if mentioned — e.g. 'Grade II listed'. Omit if not in data.",
    "passingRent": "Current passing rent with period/rate if available — e.g. '£2,570,612 pa (£99.61/sq ft NIA)' or '£2.57m pa'. Omit if not in data."
  }
}

Intelligence pool:
${JSON.stringify(briefContext, null, 2).slice(0, 14000)}`;

      // Analyst briefing — Haiku primary (5x faster than Sonnet, Railway edge
      // times out at 45s so speed > marginal quality gain here).
      // Sonnet as fallback for cases where Haiku can't structure the JSON.
      const briefingStart = Date.now();
      const withTimeoutB = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);

      let msg: any;
      try {
        msg = await withTimeoutB(anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }), 20000, "Haiku briefing");
        console.log(`[pathway stage1] Briefing Haiku OK in ${Date.now() - briefingStart}ms`);
      } catch (hErr: any) {
        console.warn(`[pathway stage1] Haiku briefing failed (${hErr?.message}), falling back to Sonnet`);
        msg = await withTimeoutB(anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        }), 20000, "Sonnet briefing");
        console.log(`[pathway stage1] Briefing Sonnet OK in ${Date.now() - briefingStart}ms`);
      }
      const txt = (msg.content as any[]).map((b: any) => (b.type === "text" ? b.text : "")).join("");
      const match = txt.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed.bullets)) {
          aiBriefing = {
            headline: String(parsed.headline || "").slice(0, 300),
            bullets: parsed.bullets.map((b: any) => String(b).slice(0, 400)).slice(0, 10),
            keyQuestions: Array.isArray(parsed.keyQuestions) ? parsed.keyQuestions.map((q: any) => String(q).slice(0, 300)).slice(0, 6) : [],
          };
        }
        if (parsed.facts && typeof parsed.facts === "object") {
          aiFacts = {
            owner: parsed.facts.owner ? String(parsed.facts.owner).slice(0, 200) : undefined,
            ownerCompanyNumber: parsed.facts.ownerCompanyNumber ? String(parsed.facts.ownerCompanyNumber).slice(0, 20) : undefined,
            purchasePrice: parsed.facts.purchasePrice ? String(parsed.facts.purchasePrice).slice(0, 60) : undefined,
            purchaseDate: parsed.facts.purchaseDate ? String(parsed.facts.purchaseDate).slice(0, 40) : undefined,
            refurbCost: parsed.facts.refurbCost ? String(parsed.facts.refurbCost).slice(0, 60) : undefined,
            currentUse: parsed.facts.currentUse ? String(parsed.facts.currentUse).slice(0, 200) : undefined,
            sizeSqft: parsed.facts.sizeSqft ? String(parsed.facts.sizeSqft).slice(0, 20) : undefined,
            mainTenants: Array.isArray(parsed.facts.mainTenants) ? parsed.facts.mainTenants.map((t: any) => String(t).slice(0, 100)).slice(0, 10) : [],
            leaseStatus: parsed.facts.leaseStatus ? String(parsed.facts.leaseStatus).slice(0, 300) : undefined,
            listedStatus: parsed.facts.listedStatus ? String(parsed.facts.listedStatus).slice(0, 100) : undefined,
            passingRent: parsed.facts.passingRent ? String(parsed.facts.passingRent).slice(0, 120) : undefined,
          };
        }
      }
    }
  } catch (err: any) {
    console.error("[pathway stage1] AI briefing error:", err?.message);
  }

  // === Investigative secondary email search ===
  // After Stage 1's first pass found the 2015/2024 "Haymarket"-subject emails,
  // the AI briefing has now extracted the deal identity (owner, tenant, agent,
  // Companies House number). Use those as search terms to find the OTHER
  // emails that don't mention the address explicitly but are demonstrably
  // about this deal — like Jack's "London Trophy Requirement", the "TRE
  // Valuation" forwards, the "Albemarle Street" / Goldenberg thread.
  // Searches only user's inbox + shared mailbox (lightweight, not all 30).
  try {
    const { getValidMsToken } = await import("./microsoft");
    const userTok = await getValidMsToken(req).catch(() => null);
    const { graphRequest } = await import("./shared-mailbox");

    // Collect investigative terms from what we've learned so far
    const investigativeTerms = new Set<string>();
    const addTerm = (s: string | undefined | null) => {
      if (!s) return;
      const firstWord = String(s).split(/[\s,]+/)[0]?.replace(/[^\w]/g, "");
      if (firstWord && firstWord.length >= 4) investigativeTerms.add(firstWord);
    };
    addTerm(initialOwnership?.proprietorName);       // e.g. "Amsprop"
    addTerm(aiFacts?.owner);                          // AI-extracted owner
    addTerm(derivedTenantForFilter(run, aiFacts, tenancy));  // e.g. "Dover"
    (aiFacts?.mainTenants || []).forEach(addTerm);
    // Historic Companies House number is a very tight match
    if (initialOwnership?.proprietorCompanyNumber) investigativeTerms.add(initialOwnership.proprietorCompanyNumber);
    if (aiFacts?.ownerCompanyNumber) investigativeTerms.add(aiFacts.ownerCompanyNumber);

    // Remove terms already covered by the primary search
    const primaryToken = (address.split(",")[0] || "").trim().toLowerCase().split(/\s+/)[0];
    if (primaryToken) investigativeTerms.delete(primaryToken);

    const dedupeKeys = new Set(emailHits.map((e) => e.msgId));
    let secondaryAdded = 0;

    // Only run if we have something distinctive to search for
    if (investigativeTerms.size > 0) {
      const inboxes: Array<{ label: string; url: (t: string) => string; headers?: Record<string, string> }> = [];
      if (userTok) {
        inboxes.push({
          label: "my inbox",
          url: (t) => `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(`"${t}"`)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
          headers: { Authorization: `Bearer ${userTok}` },
        });
      }
      inboxes.push({
        label: "Shared inbox",
        url: (t) => `/users/chatbgp@brucegillinghampollard.com/messages?$search=${encodeURIComponent(`"${t}"`)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
      });

      for (const term of investigativeTerms) {
        for (const inbox of inboxes) {
          try {
            const useGraph = !inbox.headers;
            const data: any = useGraph
              ? await graphRequest(inbox.url(term))
              : await fetch(inbox.url(term), { headers: inbox.headers }).then((r) => r.ok ? r.json() : null);
            for (const msg of (data?.value || [])) {
              if (dedupeKeys.has(msg.id)) continue;
              dedupeKeys.add(msg.id);
              emailHits.push({
                subject: msg.subject ? `${msg.subject} · via ${inbox.label}` : `(no subject) · via ${inbox.label}`,
                from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
                date: msg.receivedDateTime,
                msgId: msg.id,
                mailboxEmail: inbox.label === "Shared inbox" ? "chatbgp@brucegillinghampollard.com" : undefined,
                preview: (msg.bodyPreview || "").slice(0, 200),
                hasAttachments: !!msg.hasAttachments,
                webLink: msg.webLink || null,
              });
              secondaryAdded++;
            }
          } catch {}
        }
      }
    }
    if (secondaryAdded > 0) {
      console.log(`[pathway stage1] Secondary investigative search added ${secondaryAdded} emails (terms: ${[...investigativeTerms].join(", ")})`);
      emailHits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  } catch (err: any) {
    console.warn("[pathway stage1] secondary search failed:", err?.message);
  }

  // === Unified AI relevance pass ===
  // Now that we've extracted property identity (owner, tenant, size, listed status),
  // use it to filter emails + brochures + SharePoint hits down to items specifically
  // about THIS building — not other buildings on the same street.
  if (process.env.ANTHROPIC_API_KEY && (emailHits.length > 10 || brochureFiles.length > 2 || sharepointHits.length > 10)) {
    try {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

      // Build property identity from everything we know
      const identity = [
        `Address: ${address}${postcode ? `, ${postcode}` : ""}`,
        initialOwnership?.proprietorName || aiFacts?.owner ? `Owner: ${initialOwnership?.proprietorName || aiFacts?.owner}` : null,
        initialOwnership?.proprietorCompanyNumber || aiFacts?.ownerCompanyNumber ? `Companies House: ${initialOwnership?.proprietorCompanyNumber || aiFacts?.ownerCompanyNumber}` : null,
        derivedTenantForFilter(run, aiFacts, tenancy) ? `Tenant/Occupier: ${derivedTenantForFilter(run, aiFacts, tenancy)}` : null,
        initialOwnership?.titleNumber ? `Title number: ${initialOwnership.titleNumber}` : null,
        aiFacts?.sizeSqft ? `Size: ${aiFacts.sizeSqft} sq ft` : null,
        aiFacts?.listedStatus ? `Heritage: ${aiFacts.listedStatus}` : null,
        aiFacts?.currentUse ? `Use: ${aiFacts.currentUse}` : null,
        aiFacts?.mainTenants && aiFacts.mainTenants.length > 0 ? `Main tenants: ${aiFacts.mainTenants.join(", ")}` : null,
      ].filter(Boolean).join("\n");

      // Truncate aggressively — Opus/Sonnet slow down a lot with huge prompts
      const emailsForFilter = emailHits.slice(0, 80).map((e, i) => `E${i}. ${(e.subject || "").slice(0, 140)} | FROM: ${(e.from || "").slice(0, 50)} | PREV: ${(e.preview || "").slice(0, 100)}`);
      const brochuresForFilter = brochureFiles.slice(0, 40).map((b, i) => `B${i}. ${b.name}${b.sizeMB ? ` (${b.sizeMB}MB)` : ""}`);
      const sharepointsForFilter = sharepointHits.slice(0, 60).map((s, i) => `S${i}. ${s.name} — ${(s.path || "/").slice(0, 80)}`);

      const filterPrompt = `You are curating intelligence for a property investigation. Be thoughtful — keep items that are PLAUSIBLY about the target building, drop only items that are CLEARLY about a different building or are pure noise.

=== TARGET BUILDING IDENTITY ===
${identity}

=== DISTINGUISHING RULES ===
- "${address.split(",")[0]}" is the street name — many other buildings share it. DROP items that clearly name a DIFFERENT specific building (e.g. "Haymarket House", "Haymarket Towers", "11 Haymarket", "11/12 Haymarket", "52 Haymarket", "1-19 Haymarket Leicester").
- DROP items clearly about a different town/area (Leicester, Soho Square, Edinburgh, Warwick Street, Basingstoke, Chelsea, Islington, Mayfair-but-named-specific-building, Glasshouse, etc.) unless they explicitly tie to our target.
- DROP pure marketing noise: newsletters, market roundups, "What's On" emails, restaurant reservations/receipts, "opening announcements", automated notifications.
- KEEP GENEROUSLY when the email mentions: the owner (by name), the tenant/occupier, the agent handling this instruction, the Companies House number, the title number, the size/specs, or just the address without contradiction.
- BROCHURES are special: there should only be 1–4 brochures for a single building (1 investment brochure + maybe a leasing brochure + any historic reprints). Be STRICT: only KEEP a brochure if the filename or source email subject names THIS specific building. Drop generic-sounding ones, drop brochures named for other buildings/streets/towns. If in doubt about a brochure, DROP it — user sees the email 📎 tag if they need to find it manually.
- If an item is ambiguous but could plausibly be about this building, KEEP it. Drop only clear mismatches.

=== EMAILS (index Enn) ===
${emailsForFilter.join("\n\n")}

=== BROCHURES (index Bnn) ===
${brochuresForFilter.join("\n")}

=== SHAREPOINT HITS (index Snn) ===
${sharepointsForFilter.join("\n")}

Return STRICT JSON only, no prose, no code fences:
{
  "keepEmails": [array of E indexes as integers — just the numbers after E],
  "keepBrochures": [array of B indexes],
  "keepSharepoint": [array of S indexes]
}`;

      // Sonnet primary (faster than Opus, still 95%+ as accurate on this task).
      // Opus tended to time out on large prompts. Haiku as last-resort fallback.
      const FILTER_PRIMARY = "claude-sonnet-4-6";
      const FILTER_FALLBACK = "claude-haiku-4-5-20251001";
      const filterStart = Date.now();
      const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
        Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms))]);

      let msg: any;
      try {
        msg = await withTimeout(anthropic.messages.create({
          model: FILTER_PRIMARY,
          max_tokens: 1200,
          messages: [{ role: "user", content: filterPrompt }],
        }), 45000, "Sonnet filter");
        console.log(`[pathway stage1] AI filter Sonnet OK in ${Date.now() - filterStart}ms`);
      } catch (primaryErr: any) {
        console.warn(`[pathway stage1] Sonnet filter failed (${primaryErr?.message}), trying Haiku`);
        msg = await withTimeout(anthropic.messages.create({
          model: FILTER_FALLBACK,
          max_tokens: 1200,
          messages: [{ role: "user", content: filterPrompt }],
        }), 20000, "Haiku filter");
        console.log(`[pathway stage1] AI filter Haiku OK in ${Date.now() - filterStart}ms`);
      }
      const txt = (msg.content as any[]).map((b: any) => (b.type === "text" ? b.text : "")).join("");
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const keepE = new Set<number>((parsed.keepEmails || []).map((n: any) => Number(n)));
        const keepB = new Set<number>((parsed.keepBrochures || []).map((n: any) => Number(n)));
        const keepS = new Set<number>((parsed.keepSharepoint || []).map((n: any) => Number(n)));

        // Safety net — if the AI filter is too aggressive and drops a huge
        // chunk, blend: keep AI's picks PLUS the most recent N from the
        // regex-filtered list. Prevents the UI going empty on ambiguous
        // cases where the AI plays it safe.
        const blendIfOverFiltered = <T>(original: T[], keep: Set<number>, minFraction = 0.4, floor = 5): T[] => {
          const aiPicks = original.filter((_, i) => keep.has(i));
          const minKeep = Math.min(original.length, Math.max(floor, Math.ceil(original.length * minFraction)));
          if (aiPicks.length >= minKeep) return aiPicks;
          // AI was too aggressive — add back the most recent items not in AI picks
          const rest = original.filter((_, i) => !keep.has(i));
          const merged = [...aiPicks, ...rest].slice(0, minKeep);
          return merged;
        };

        // Trust the AI's email picks if it keeps at least 5 items, otherwise
        // blend back recent hits so user has visibility on borderline cases.
        const filteredEmails = keepE.size >= 5
          ? emailHits.filter((_, i) => keepE.has(i))
          : blendIfOverFiltered(emailHits, keepE, 0.3, 8);
        // Brochures: strict cap of 4 — there should realistically only be 1-2
        // brochures for a single building (investment + leasing at most).
        // Trust AI picks here and cap hard; no blend-back, so noise gets dropped.
        const filteredBrochures = brochureFiles.filter((_, i) => keepB.has(i)).slice(0, 4);
        const filteredSharepoint = blendIfOverFiltered(sharepointHits, keepS, 0.3, 8);

        console.log(`[pathway stage1] AI relevance pass: emails ${emailHits.length}->${filteredEmails.length} (AI kept ${keepE.size}), brochures ${brochureFiles.length}->${filteredBrochures.length} (AI kept ${keepB.size}), sharepoint ${sharepointHits.length}->${filteredSharepoint.length} (AI kept ${keepS.size})`);

        emailHits.length = 0;
        emailHits.push(...filteredEmails);
        brochureFiles.length = 0;
        brochureFiles.push(...filteredBrochures);
        sharepointHits.length = 0;
        sharepointHits.push(...filteredSharepoint);
      }
    } catch (err: any) {
      console.warn("[pathway stage1] AI relevance pass failed (keeping regex-filtered lists):", err?.message);
    }
  }

  // Final safety caps
  emailHits.splice(60);
  brochureFiles.splice(4);

  // Build Google Street View thumbnail + Maps link from address + postcode
  const mapsQuery = encodeURIComponent([address, postcode].filter(Boolean).join(", "));
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || "";
  const propertyImage = {
    streetViewUrl: gmapsKey
      ? `https://maps.googleapis.com/maps/api/streetview?size=640x360&location=${mapsQuery}&fov=80&key=${gmapsKey}`
      : undefined,
    googleMapsUrl: `https://www.google.com/maps/search/?api=1&query=${mapsQuery}`,
  };

  // Rateable value / business rates summary.
  // - Filter to entries that look like this address (street-match, not just postcode)
  // - Sum their RVs to give a headline total
  // - Include a VOA search URL so users can cross-check on gov.uk
  let rates: NonNullable<StageResults["stage1"]>["rates"] | undefined;
  if (voaEntries.length > 0) {
    const primaryAddressToken = (address.split(",")[0] || "").toLowerCase();
    const addressTokens = primaryAddressToken.match(/[a-z0-9]+/g)?.filter((w) => w.length >= 3) || [];
    const streetMatch = (e: any) => {
      if (!addressTokens.length) return true;
      const hay = `${e.address || ""} ${e.firmName || ""}`.toLowerCase();
      return addressTokens.some((t) => hay.includes(t));
    };
    const matched = voaEntries.filter(streetMatch);
    const entries = matched.length > 0 ? matched : voaEntries; // if nothing matches street-wise, fall back to all
    const totalRateableValue = entries.reduce((sum, e) => sum + (e.rateableValue || 0), 0);
    const voaSearchUrl = postcode
      ? `https://www.tax.service.gov.uk/business-rates-find/search?postcode=${encodeURIComponent(postcode)}`
      : `https://www.tax.service.gov.uk/business-rates-find/`;
    rates = {
      totalRateableValue: totalRateableValue || undefined,
      assessmentCount: entries.length,
      entries: entries.slice(0, 20),
      voaSearchUrl,
    };
  }

  // Auto-populate `tenant` from AI-extracted main tenant so Stage 2 doesn't
  // skip when we clearly know the occupier. Only set it if the existing run
  // doesn't already have a manually-set tenant.
  const existingTenant = (run.stageResults as StageResults)?.stage1?.tenant;
  let derivedTenant = existingTenant;
  if (!derivedTenant && aiFacts?.mainTenants && aiFacts.mainTenants.length > 0) {
    derivedTenant = { name: aiFacts.mainTenants[0] };
  }
  if (!derivedTenant && tenancy?.occupier) {
    derivedTenant = { name: tenancy.occupier };
  }

  // Enrich tenant with CRM company id + Companies House number if we have them
  if (derivedTenant?.name) {
    try {
      const [tenantCompany] = await db
        .select()
        .from(crmCompanies)
        .where(ilike(crmCompanies.name, derivedTenant.name))
        .limit(1);
      if (tenantCompany) {
        derivedTenant = {
          ...derivedTenant,
          companyId: tenantCompany.id,
          companyNumber: derivedTenant.companyNumber || (tenantCompany as any).companiesHouseNumber || (tenantCompany as any).companies_house_number || undefined,
        };
      }
    } catch (err: any) {
      console.warn("[pathway stage1] tenant CRM match error:", err?.message);
    }
  }

  // Extract retail leasing comps from the email sweep. Writes into the
  // curated `retail_leasing_comps` table (separate from the CRM so Woody can
  // review before promoting) and surfaces a trimmed list on this pathway.
  let retailComps: NonNullable<StageResults["stage1"]>["retailComps"] = undefined;
  try {
    if (emailHits.length > 0 && process.env.ANTHROPIC_API_KEY) {
      const { extractCompsFromEmails, upsertExtractedComps, findNearbyComps } =
        await import("./retail-comps-extractor");
      const extracted = await extractCompsFromEmails(
        emailHits.map((e) => ({
          subject: e.subject,
          from: e.from,
          date: e.date,
          msgId: e.msgId,
          preview: e.preview,
        })),
        { address, postcode },
      );
      const insertedCount = await upsertExtractedComps(extracted, {
        submarket: postcode ? postcode.split(/\s+/)[0] : undefined,
      });
      console.log(`[pathway stage1] Retail comps extracted: ${extracted.length} from AI, ${insertedCount} new rows inserted`);
      const nearby = postcode ? await findNearbyComps(postcode, 20) : [];
      retailComps = nearby.map((r: any) => ({
        id: r.id,
        address: r.address,
        postcode: r.postcode || undefined,
        tenant: r.tenant || undefined,
        rentPa: r.rent_pa ?? undefined,
        rentPsf: r.rent_psf ?? undefined,
        areaSqft: r.area_sqft ?? undefined,
        leaseDate: r.lease_date || undefined,
        termYears: r.term_years ?? undefined,
        sourceType: r.source_type || undefined,
        sourceRef: r.source_ref || undefined,
        confidence: r.confidence ?? undefined,
      }));
    }
  } catch (err: any) {
    console.warn("[pathway stage1] retail comps extraction failed:", err?.message);
  }

  // AI email triage — replaces the raw email list in the UI with grouped,
  // filtered commentary that cites individual emails inline as [E5] tokens.
  // Best-effort; never blocks Stage 1 completion.
  let emailCommentary: { markdown: string; generatedAt: string } | undefined;
  try {
    const commentary = await runEmailSort(run.address, emailHits);
    if (commentary) {
      emailCommentary = { markdown: commentary.markdown, generatedAt: new Date().toISOString() };
      console.log(`[pathway stage1] email commentary generated (${commentary.markdown.length} chars from ${emailHits.length} hits)`);
    }
  } catch (err: any) {
    console.warn(`[pathway stage1] email commentary failed: ${err?.message}`);
  }

  console.log(`[pathway stage1] Completing after ${((Date.now() - stage1Start) / 1000).toFixed(1)}s — ${emailHits.length} emails, ${brochureFiles.length} brochures, ${sharepointHits.length} sharepoint, ${deals.length} deals, ${comps.length} comps, ${retailComps?.length || 0} retail comps, ${rates?.assessmentCount || 0} rates`);

  await setStageStatus(runId, "stage1", "completed", {
    stage1: {
      emailHits,
      emailCommentary,
      sharepointHits,
      crmHits,
      initialOwnership,
      deals,
      tenancy,
      engagements,
      pricePaidHistory,
      comps,
      brochureFiles,
      folderTree,
      summary,
      aiBriefing,
      aiFacts,
      propertyImage,
      rates,
      tenant: derivedTenant,
      pdMarket,
      retailComps,
    },
    // Market intel crawled in parallel during Stage 1 — stored at run level
    // so ChatBGP and later stages can see lease comps / availability / market
    // context without the user having to click anything.
    ...(marketIntel ? { marketIntel } : {}),
  });
  await updateRun(runId, {
    sharepointFolderPath: folderTree?.root,
    sharepointFolderUrl: folderTree?.webUrl,
  });
}

// ============================================================================
// STAGE 2 — Brand Intelligence
// ============================================================================

async function runStage2(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const results = run.stageResults as StageResults;
  const tenantName = results.stage1?.tenant?.name;

  await setStageStatus(runId, "stage2", "running");

  // Building contacts — runs even when there's no tenant (investment-only
  // buildings, vacant properties). Failure here never blocks the stage.
  let buildingContacts: import("./pathway-contacts").BuildingContacts | undefined;
  try {
    const { buildBuildingContacts } = await import("./pathway-contacts");
    buildingContacts = await buildBuildingContacts({
      emailHits: results.stage1?.emailHits || [],
      ownership: results.stage1?.initialOwnership || null,
      stage: "stage2",
    });
    console.log(`[pathway stage2] contacts: agents=${buildingContacts.agents.length} landlord=${buildingContacts.landlord.length} assetMgr=${buildingContacts.assetManager.length} (from ${buildingContacts.sources.emailsAnalysed} emails)`);
  } catch (err: any) {
    console.warn("[pathway stage2] building contacts extraction failed:", err?.message);
  }

  if (!tenantName) {
    await setStageStatus(runId, "stage2", "skipped", {
      stage2: { skipped: true, reason: "No tenant identified in Stage 1", buildingContacts },
    });
    return;
  }

  try {
    // Find or create company
    let [company] = await db.select().from(crmCompanies).where(ilike(crmCompanies.name, tenantName)).limit(1);

    if (!company) {
      const [created] = await db
        .insert(crmCompanies)
        .values({ name: tenantName })
        .returning();
      company = created;
    }

    // Call brand enrichment (lazy — module may be wired during Stage 3 of this build)
    let enrichedFields: Record<string, any> = {};
    try {
      const { enrichBrandById } = await import("./brand-enrichment");
      enrichedFields = await enrichBrandById(company.id);
    } catch (err: any) {
      console.warn("[pathway stage2] brand-enrichment not available yet:", err?.message);
    }

    // Re-fetch the company row so we have the freshly-enriched fields + domain + ai_generated_fields (which holds backers_detail)
    const [enrichedCompany] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, company.id)).limit(1);

    // Pull backers_detail out of ai_generated_fields (it isn't a column, it's stored as JSONB there)
    const aiGen = (enrichedCompany as any)?.aiGeneratedFields || (enrichedCompany as any)?.ai_generated_fields || {};
    const backersDetail = Array.isArray(aiGen.backers_detail) ? aiGen.backers_detail : undefined;

    await setStageStatus(runId, "stage2", "completed", {
      stage2: {
        companyId: company.id,
        enrichedFields,
        buildingContacts,
        company: enrichedCompany
          ? {
              id: enrichedCompany.id,
              name: enrichedCompany.name,
              domain: (enrichedCompany as any).domain || (enrichedCompany as any).domainUrl || null,
              industry: (enrichedCompany as any).industry || null,
              description: (enrichedCompany as any).description || null,
              conceptPitch: (enrichedCompany as any).conceptPitch || (enrichedCompany as any).concept_pitch || null,
              storeCount: (enrichedCompany as any).storeCount ?? (enrichedCompany as any).store_count ?? null,
              instagramHandle: (enrichedCompany as any).instagramHandle || (enrichedCompany as any).instagram_handle || null,
              companiesHouseNumber: (enrichedCompany as any).companiesHouseNumber || (enrichedCompany as any).companies_house_number || null,
              backers: (enrichedCompany as any).backers || null,
              backersDetail,
              rolloutStatus: (enrichedCompany as any).rolloutStatus || (enrichedCompany as any).rollout_status || null,
            }
          : undefined,
      },
    });
  } catch (err: any) {
    console.error("[pathway stage2] failed:", err?.message);
    await setStageStatus(runId, "stage2", "failed", {
      stage2: { reason: err?.message || "Unknown error" },
    });
  }
}

// ============================================================================
// STAGE 3 — Detailed Search Summary (gate)
// ============================================================================

async function runStage3(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage3", "running");
  const results = run.stageResults as StageResults;

  // Build a data digest for Claude to summarise
  const s1 = results.stage1 || {};
  const s2 = results.stage2 || {};
  const mi = (results as any).marketIntel;

  const digest: Record<string, any> = { address: run.address };
  if (s1.initialOwnership) digest.ownership = s1.initialOwnership;
  if (s1.aiFacts) digest.aiFacts = s1.aiFacts;
  if (s1.tenant) digest.tenant = s1.tenant;
  if (s1.rates) digest.rates = { totalRV: s1.rates.totalRateableValue, assessments: s1.rates.assessmentCount, entries: (s1.rates.entries || []).slice(0, 5) };
  if (s1.crmHits) digest.crmHits = { properties: s1.crmHits.properties?.length || 0, deals: s1.crmHits.deals?.length || 0 };
  if (s1.emailHits?.length) digest.emailCount = s1.emailHits.length;
  if (s1.sharepointHits?.length) digest.sharepointFiles = s1.sharepointHits.length;
  if (s1.aiBriefing) digest.investigatorBriefing = s1.aiBriefing;
  if ((s1 as any).webFindings) digest.webFindings = (s1 as any).webFindings;
  if (s2.company) digest.tenantProfile = { name: s2.company.name, industry: s2.company.industry, conceptPitch: s2.company.conceptPitch, storeCount: s2.company.storeCount, rolloutStatus: s2.company.rolloutStatus, backers: s2.company.backers };
  if (mi) digest.marketIntel = { leasingHistory: mi.leasingHistory?.slice(0, 5), marketContext: mi.marketContext };

  let summary = "";
  let recommendProceed = true;

  try {
    const prompt = `You are a senior BGP property analyst writing a gate-review summary before committing the team to full due diligence.

Property: ${run.address}

Gathered intelligence:
${JSON.stringify(digest, null, 2)}

Write a concise markdown summary (max 400 words) covering:
1. **Ownership** — who owns it, when they bought it, price paid if known
2. **Occupancy** — current tenant(s), use class, lease status, passing rent
3. **Rates** — total rateable value, key tenants by rates
4. **What we found** — CRM records, SharePoint files, web intelligence, market context
5. **Key questions / risks** — what we don't know yet
6. **Recommendation** — one sentence: proceed to full diligence or flag a reason to pause

End with a line: RECOMMEND: PROCEED or RECOMMEND: PAUSE (with brief reason if pausing).`;

    const resp = await callClaude({ messages: [{ role: "user", content: prompt }], max_completion_tokens: 800, temperature: 0.2 });
    summary = resp?.choices?.[0]?.message?.content || "";
    recommendProceed = !summary.includes("RECOMMEND: PAUSE");
  } catch (err: any) {
    console.error("[pathway stage3] Claude summary failed:", err?.message);
    // Fallback to simple text
    const lines = [`**Initial Findings for ${run.address}**`];
    if (s1.initialOwnership) lines.push(`- Owner: ${s1.initialOwnership.proprietorName || "unknown"}`);
    if (s1.tenant) lines.push(`- Tenant: ${s1.tenant.name}`);
    if (s1.rates) lines.push(`- Total rateable value: £${(s1.rates.totalRateableValue || 0).toLocaleString()}`);
    lines.push("", "Ready to run full Property Intelligence?");
    summary = lines.join("\n");
  }

  await setStageStatus(runId, "stage3", "completed", {
    stage3: { summary, recommendProceed },
  });
}

// ============================================================================
// STAGE 4 — Property Intelligence
// ============================================================================

async function runStage4(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage4", "running");

  const address = run.address;
  const postcode = run.postcode || "";

  try {
    // Run property lookup (planning history) and Companies House KYC in parallel.
    const lookupPromise = performPropertyLookup({
      address,
      postcode,
      uprn: run.uprn || undefined,
      layers: ["core", "extended"],
      propertyDataLayers: ["core", "extended"],
    });

    // Pull resolved company numbers from Stage 1 payload.
    // Stage 1 scatters company numbers across several fields: initialOwnership
    // (Land Registry/CRM), aiFacts (extracted by the AI from the briefing),
    // and tenant (tenancy resolution). Check all of them; if still empty,
    // fall back to a Companies House name search so we don't silently
    // lose a proprietor the AI clearly identified.
    const stage1 = (run as any).stageResults?.stage1 || {};
    const companyTargets: Array<{ companyNumber: string; companyName: string; role: "proprietor" | "tenant" }> = [];

    // Stage 1's autonomous AI sometimes returns a multi-sentence commentary
    // in proprietorName/owner instead of a bare company name (e.g. "Amsprop
    // Estates Limited (Lord Sugar / Daniel Sugar) — freehold. Land Registry
    // also shows THE GAINESVILLE PARTNERSHIP LLP ..."). Pushing that down to
    // Clouseau produces garbage display headers and poisons the 30-day reuse
    // cache. Trim to the first clean clause so CH lookups and saved records
    // stay sane.
    const cleanCompanyName = (raw: string | null | undefined): string => {
      if (!raw) return "";
      let s = String(raw).trim();
      s = s.split(/\s*[;—]\s*|\s*\.\s+(?=[A-Z])|\n/)[0];
      s = s.replace(/\s*\([^)]*\)\s*$/g, "").trim();
      s = s.replace(/[.\s)]+$/, "").trim();
      if (s.length > 120) s = s.slice(0, 120).trim();
      return s;
    };

    const propName = cleanCompanyName(stage1.initialOwnership?.proprietorName || stage1.aiFacts?.owner) || null;
    const propCo = stage1.initialOwnership?.proprietorCompanyNumber
      || stage1.aiFacts?.ownerCompanyNumber
      || null;
    if (propCo) {
      companyTargets.push({
        companyNumber: String(propCo).trim(),
        companyName: propName || "Proprietor",
        role: "proprietor",
      });
    } else if (propName) {
      try {
        const { chFetch } = await import("./companies-house");
        const search = await chFetch(`/search/companies?q=${encodeURIComponent(propName)}&items_per_page=1`);
        const hit = search?.items?.[0];
        if (hit?.company_number) {
          console.log(`[pathway stage4] resolved proprietor "${propName}" → ${hit.company_number} via CH name search`);
          companyTargets.push({ companyNumber: hit.company_number, companyName: hit.title || propName, role: "proprietor" });
        }
      } catch (e: any) {
        console.warn(`[pathway stage4] proprietor name-search failed for "${propName}":`, e?.message);
      }
    }

    const tenantCo = stage1.tenant?.companyNumber || null;
    const tenantName = cleanCompanyName(stage1.tenant?.name || stage1.aiFacts?.mainTenants?.[0]) || null;
    const existingNumbers = new Set(companyTargets.map((c) => c.companyNumber));
    if (tenantCo && !existingNumbers.has(String(tenantCo).trim())) {
      companyTargets.push({
        companyNumber: String(tenantCo).trim(),
        companyName: tenantName || "Tenant",
        role: "tenant",
      });
    } else if (!tenantCo && tenantName && tenantName !== propName) {
      try {
        const { chFetch } = await import("./companies-house");
        const search = await chFetch(`/search/companies?q=${encodeURIComponent(tenantName)}&items_per_page=1`);
        const hit = search?.items?.[0];
        if (hit?.company_number && !existingNumbers.has(hit.company_number)) {
          console.log(`[pathway stage4] resolved tenant "${tenantName}" → ${hit.company_number} via CH name search`);
          companyTargets.push({ companyNumber: hit.company_number, companyName: hit.title || tenantName, role: "tenant" });
        }
      } catch (e: any) {
        console.warn(`[pathway stage4] tenant name-search failed for "${tenantName}":`, e?.message);
      }
    }

    console.log(`[pathway stage4] companyTargets resolved: ${companyTargets.map((c) => `${c.role}=${c.companyNumber}(${c.companyName})`).join(", ") || "NONE"}`);

    // Reuse-first: if Clouseau already has a recent investigation for this
    // company, read it from kyc_investigations and surface the existing
    // record — including the AI narrative and UBO walk — instead of
    // running a parallel stripped-down investigation. Only run a fresh
    // one if no record exists within the reuse window.
    const { runCompanyInvestigation } = await import("./kyc-clouseau");
    const { pool: _pool } = await import("./db");
    const userId = (run as any).startedBy || null;
    const REUSE_WINDOW_DAYS = 30;

    const summariseInvestigation = (t: { companyNumber: string; companyName: string; role: "proprietor" | "tenant" }, payload: any, investigationId: number | null, reused: boolean) => {
      const uboCount = Array.isArray(payload?.ownershipChain?.chain) ? payload.ownershipChain.chain.length : 0;
      const screening = payload?.sanctionsScreening || [];
      return {
        companyNumber: t.companyNumber,
        companyName: payload?.subject?.name || t.companyName,
        role: t.role,
        investigationId,
        reusedFromClouseau: reused,
        riskLevel: payload?.riskLevel,
        riskScore: payload?.riskScore,
        sanctionsMatch: screening.some((s: any) => s.hasSanctions ?? (s.status !== "clear")),
        pepMatch: screening.some((s: any) => s.hasPep),
        adverseMediaMatch: screening.some((s: any) => s.hasAdverse),
        flags: payload?.flags || [],
        officerCount: (payload?.officers || []).length,
        pscCount: (payload?.pscs || []).length,
        uboCount,
        filingCount: (payload?.filingHistory || []).length,
        status: payload?.companyProfile?.company_status,
        incorporatedOn: payload?.companyProfile?.date_of_creation,
      };
    };

    const companyKycPromise = Promise.all(
      companyTargets.map(async (t) => {
        try {
          // Check for an existing Clouseau record first.
          const existing = await _pool.query(
            `SELECT id, result, conducted_at
               FROM kyc_investigations
              WHERE company_number = $1
                AND conducted_at > NOW() - ($2 || ' days')::interval
              ORDER BY conducted_at DESC
              LIMIT 1`,
            [t.companyNumber, REUSE_WINDOW_DAYS]
          );

          if (existing.rows.length > 0) {
            const row = existing.rows[0];
            const payload = typeof row.result === "string" ? JSON.parse(row.result) : row.result;
            // Reject poisoned cache entries produced by the earlier garbled-name
            // bug: if the saved record has a commentary-style name (semicolons,
            // em-dashes, or >80 chars) OR totally empty officer+PSC+filing data,
            // run a fresh investigation instead of recycling the broken one.
            const savedName: string = payload?.subject?.name || "";
            const looksGarbled = /[;—]/.test(savedName) || savedName.length > 80;
            const hasNoData =
              (payload?.officers || []).length === 0 &&
              (payload?.pscs || []).length === 0 &&
              (payload?.filingHistory || []).length === 0;
            if (looksGarbled || hasNoData) {
              console.log(`[pathway stage4] Skipping poisoned cache ${row.id} for ${t.companyNumber} (garbled=${looksGarbled} empty=${hasNoData}) — will re-investigate`);
            } else {
              console.log(`[pathway stage4] Reusing Clouseau investigation ${row.id} for ${t.companyNumber} (${Math.round((Date.now() - new Date(row.conducted_at).getTime()) / 86400000)}d old)`);
              return summariseInvestigation(t, payload, row.id, true);
            }
          }

          // No recent record — run a fresh, full-fidelity Clouseau investigation
          // (AI narrative included) so the saved record is identical to one
          // produced by the /kyc-clouseau page. Stage 4 only keeps a summary;
          // the full report is reachable via /kyc-clouseau?investigation={id}.
          const { result, investigationId } = await runCompanyInvestigation({
            companyNumber: t.companyNumber,
            companyName: t.companyName,
            propertyContext: { address, postcode, source: "property-pathway", runId },
            userId,
          });
          return summariseInvestigation(t, result, investigationId, false);
        } catch (err: any) {
          console.error(`[pathway stage4] investigation failed for ${t.companyNumber}:`, err?.message);
          return {
            companyNumber: t.companyNumber,
            companyName: t.companyName,
            role: t.role,
            investigationId: null,
            reusedFromClouseau: false,
            error: err?.message || "Companies House lookup failed",
          };
        }
      })
    );

    const [lookup, companyKyc] = await Promise.all([lookupPromise, companyKycPromise]);

    // Planning comes from THREE sources: planning.data.gov.uk (radius search),
    // PropertyData's /planning-applications (postcode-scoped), and the LPA's own
    // Idox Public Access portal (scraped — authoritative but slower).
    // Merge all three, dedupe by reference. Field names differ so handle each shape.
    const govApps = (lookup.planningData as any)?.planningApplications || [];
    const pdRaw = (lookup.propertyDataCoUk as any)?.["planning-applications"];
    // PropertyData's shape for /planning-applications isn't consistent across
    // postcodes — sometimes {data: [...]}, sometimes {data: {planning_applications: [...]}},
    // sometimes {data: {}} when nothing is found. Dig through everything the API
    // might reasonably hand us and fall back to [] so bad shape != silent blank.
    let pdAppsArr: any[] = [];
    if (pdRaw) {
      const d = pdRaw.data;
      if (Array.isArray(d)) pdAppsArr = d;
      else if (Array.isArray(d?.planning_applications)) pdAppsArr = d.planning_applications;
      else if (Array.isArray(d?.applications)) pdAppsArr = d.applications;
      else if (Array.isArray((pdRaw as any).planning_applications)) pdAppsArr = (pdRaw as any).planning_applications;
    }
    // Diagnostic: surface exactly what PropertyData handed us so we can tell
    // "zero applications near this postcode" from "shape changed / our parser missed it".
    if (!pdAppsArr.length) {
      const status = pdRaw?.status;
      const dataKeys = pdRaw?.data && typeof pdRaw.data === "object" && !Array.isArray(pdRaw.data)
        ? Object.keys(pdRaw.data).slice(0, 10).join(",")
        : "(none)";
      const topKeys = pdRaw ? Object.keys(pdRaw).slice(0, 10).join(",") : "(null response)";
      console.log(`[pathway stage4] PropertyData /planning-applications → 0 apps (status=${status || "?"}, top-level keys=[${topKeys}], data keys=[${dataKeys}])`);
    }

    // Idox direct scrape + PlanIt aggregator in parallel. PlanIt covers
    // Westminster (blocked at TCP level from Railway egress) and acts as a
    // safety net for any LPA where the direct scrape fails.
    let idoxApps: any[] = [];
    let planitApps: any[] = [];
    const [idoxResult, planitResult] = await Promise.allSettled([
      (async () => {
        const { fetchIdoxPlanning } = await import("./idox-planning");
        return fetchIdoxPlanning(postcode, address, { maxAgeYears: 20 });
      })(),
      (async () => {
        const { fetchPlanitPlanning } = await import("./planit-planning");
        return fetchPlanitPlanning(postcode, address, { maxAgeYears: 20 });
      })(),
    ]);
    if (idoxResult.status === "fulfilled") idoxApps = idoxResult.value;
    else console.warn("[pathway stage4] Idox scrape skipped:", idoxResult.reason?.message);
    if (planitResult.status === "fulfilled") planitApps = planitResult.value;
    else console.warn("[pathway stage4] PlanIt skipped:", planitResult.reason?.message);

    const normalise = (a: any) => ({
      reference: a.reference || a.ref || a.application_number || "",
      address: a.address || a.site_address || "",
      description: a.description || a.proposal || a.development_description || "",
      status: a.status || a.decision || a.application_status || "",
      date: a.decidedAt || a.decided_at || a.decision_date || a.receivedAt || a.received_at || a.date || "",
      decidedAt: a.decidedAt || a.decided_at || a.decision_date || null,
      receivedAt: a.receivedAt || a.received_at || a.received_date || null,
      documentUrl: a.documentUrl || a.document_url || a.url || null,
      source: a.source || (a.reference ? "gov" : ""),
      lpa: a.lpa || "",
    });

    const seen = new Set<string>();
    const merged: any[] = [];
    // Idox (direct) first so its authoritative records win on dedupe.
    // PlanIt is Idox data via an aggregator — same quality, useful when
    // the direct scrape is blocked (e.g. Westminster from Railway).
    for (const a of [...idoxApps, ...planitApps, ...govApps, ...pdAppsArr].map(normalise)) {
      const key = (a.reference || "").toUpperCase().replace(/\s+/g, "") || `${a.date}|${a.description.slice(0, 60)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (a.reference || a.description) merged.push(a);
    }
    merged.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    // Tier applications by proximity to the subject building. Same
    // exact→cluster→wider pattern as comps: prefer strict (this building),
    // widen to same-street if thin, fall back to full radius if still thin.
    // Each app carries a `matchTier` label so the UI can badge them.
    //   strict → this building (number range + street, or building name)
    //   street → same street, different numbers
    //   area   → postcode + 300m radius (the PlanIt/Idox default)
    const { strict, street: streetApps, area, parseLog } = (() => {
      const addr = (address || "").trim();
      const rangeMatch = addr.match(/^\s*(\d+)\s*(?:-|to|–|—)\s*(\d+)/i);
      const singleMatch = addr.match(/^\s*(\d+)[A-Za-z]?\b/);
      const nameMatch = addr.match(/^([A-Za-z][A-Za-z'&\s]+?(?:House|Court|Building|Chambers|Tower|Place|Centre|Plaza|Mansions|Works|Studios|Wharf|Mews|Hall))\b/i);
      const streetMatch = addr.match(/\d[\s-]*\d*\s+([A-Z][A-Za-z'&\s]+?)(?:,|\s+London|\s+SW|\s+W\d|\s+WC|\s+EC|\s+NW|\s+N\d|\s+E\d|\s+SE|$)/);

      let numbers: number[] = [];
      if (rangeMatch) {
        const a = parseInt(rangeMatch[1], 10);
        const b = parseInt(rangeMatch[2], 10);
        if (!Number.isNaN(a) && !Number.isNaN(b)) {
          const lo = Math.min(a, b), hi = Math.max(a, b);
          for (let n = lo; n <= hi; n++) numbers.push(n);
        }
      } else if (singleMatch) {
        numbers = [parseInt(singleMatch[1], 10)].filter((n) => !Number.isNaN(n));
      }
      const buildingName = nameMatch?.[1]?.trim().toLowerCase();
      const streetName = streetMatch?.[1]?.trim().toLowerCase();
      const parseLog = `numbers=[${numbers.join(",")}] street="${streetName || ""}" name="${buildingName || ""}"`;

      // Couldn't parse anything — treat everything as area-level.
      if (numbers.length === 0 && !buildingName) {
        return { strict: [] as any[], street: [] as any[], area: merged.map((a: any) => ({ ...a, matchTier: "area" })), parseLog };
      }

      const strict: any[] = [];
      const street: any[] = [];
      const area: any[] = [];
      for (const a of merged) {
        const hay = `${a.address || ""} ${a.description || ""}`.toLowerCase();
        if (!hay.trim()) { area.push({ ...a, matchTier: "area" }); continue; }
        const nameHit = !!(buildingName && hay.includes(buildingName));
        const streetHit = !!(streetName && hay.includes(streetName));
        let numberHit = false;
        if (numbers.length > 0) {
          for (const n of numbers) {
            const re = new RegExp(`(^|[^\\d])${n}(?:\\s*(?:-|to|–|—)\\s*\\d+)?\\b`);
            if (re.test(hay)) { numberHit = true; break; }
          }
        }
        if (nameHit || (numberHit && (streetHit || !streetName))) {
          strict.push({ ...a, matchTier: "strict" });
        } else if (streetHit) {
          street.push({ ...a, matchTier: "street" });
        } else {
          area.push({ ...a, matchTier: "area" });
        }
      }
      return { strict, street, area, parseLog };
    })();

    // Progressive widening: prefer strict, fill with street then area if thin.
    // Target ~12+ results so the board has something to say when the building
    // itself is quiet. Always keep all strict hits even if the total is big —
    // those are the ones that actually describe the subject property.
    const TARGET = 12;
    const planningApplications: any[] = [...strict];
    if (planningApplications.length < TARGET) {
      planningApplications.push(...streetApps.slice(0, TARGET - planningApplications.length));
    }
    if (planningApplications.length < TARGET) {
      planningApplications.push(...area.slice(0, TARGET - planningApplications.length));
    }
    // Cap at 100 but preserve order (strict first, then street, then area).
    planningApplications.splice(100);

    console.log(`[pathway stage4] planning: idox=${idoxApps.length} planit=${planitApps.length} gov=${govApps.length} pd=${pdAppsArr.length} merged=${merged.length} strict=${strict.length} street=${streetApps.length} area=${area.length} shown=${planningApplications.length} (${parseLog})`);

    // Pull the full PDF list off each application's Idox documents tab, via
    // ScraperAPI so Westminster's Railway IP block doesn't matter. We
    // prioritise SUBSTANTIVE applications (FULL/OUTLINE/LBC/REM/COU/HSE)
    // over technical changes (NMA/MIN/S96/S106/VAR) over signage and
    // highway furniture (ADV/TCH/TELCOM/HWY). Within each band, apps stay
    // most-recent-first. Cap is configurable via PLANNING_DOCS_SCRAPE_CAP
    // (default 20). PDF results are cached for 30 days so repeat opens
    // hit zero ScraperAPI cost.
    const APP_TYPE_PRIORITY = (ref: string): number => {
      const r = (ref || "").toUpperCase();
      // 0 = substantive change of use / new build / listed building consent
      if (/\b(FULL|OUT|OUTLINE|LBC|REM|COU|HSE|MAJ)\b/.test(r)) return 0;
      // 1 = technical / amendment / discharge of conditions
      if (/\b(NMA|MIN|S96|S96A|S106|VAR|VOC|CND|EU|PA|PD|PRI|DOC)\b/.test(r)) return 1;
      // 2 = signage, tables/chairs, telecoms, highway furniture
      if (/\b(ADV|TCH|TELCOM|HWY|TPN|XRAYS|PN)\b/.test(r)) return 2;
      // 3 = anything else (unknown suffix) — sort to end so substantive wins
      return 3;
    };
    const SCRAPE_CAP = Number(process.env.PLANNING_DOCS_SCRAPE_CAP) || 20;
    const planningDocs: Array<{
      ref: string;
      lpa: string;
      appDate: string;
      description: string;
      docsUrl: string;
      docs: any[];
    }> = [];
    try {
      const { fetchPlanningDocs, docsTabUrl, sortDocsByPriority } = await import("./planning-docs");
      const candidates = planningApplications.filter((a: any) => a.documentUrl);
      const toScrape = candidates
        .map((a: any, idx: number) => ({ app: a, originalIdx: idx, prio: APP_TYPE_PRIORITY(a.reference || "") }))
        .sort((a, b) => a.prio !== b.prio ? a.prio - b.prio : a.originalIdx - b.originalIdx)
        .slice(0, SCRAPE_CAP)
        .map(x => x.app);
      console.log(`[pathway stage4] planning-docs scrape: ${candidates.length} candidates → ${toScrape.length} selected (cap ${SCRAPE_CAP}, priority-sorted): ${toScrape.map((a: any) => a.reference).join(", ")}`);
      const results = await Promise.allSettled(
        toScrape.map(async (app: any) => {
          const url = docsTabUrl(app.documentUrl);
          const docs = await fetchPlanningDocs(url);
          return {
            ref: app.reference,
            lpa: app.lpa || "",
            appDate: app.decidedAt || app.receivedAt || app.date || "",
            description: app.description || "",
            docsUrl: url,
            docs: sortDocsByPriority(docs),
          };
        }),
      );
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.docs.length > 0) planningDocs.push(r.value);
      }
      const totalDocs = planningDocs.reduce((acc, a) => acc + a.docs.length, 0);
      console.log(`[pathway stage4] planning docs: scraped=${toScrape.length} with-docs=${planningDocs.length} total-pdfs=${totalDocs}`);
    } catch (err: any) {
      console.warn(`[pathway stage4] planning docs scrape failed: ${err?.message}`);
    }

    // Auto-download top-priority drawings (proposed/existing floor plans,
    // elevations, sections, site plans) from the 3 most-recent apps into
    // the pathway SharePoint folder. Capped at 15 PDFs per run so
    // ScraperAPI spend stays predictable (~15 credits).
    try {
      const { downloadPlanningPdf, pickDrawingsToDownload } = await import("./planning-docs");
      const spRoot = run.sharepointFolderPath || (run.stageResults as StageResults)?.stage1?.folderTree?.root;
      if (spRoot && planningDocs.length) {
        const drawingsFolder = `${spRoot.replace(/^BGP share drive\//, "")}/05 Planning/Drawings`;
        const shortlist = pickDrawingsToDownload(
          planningDocs.slice(0, 3).map(a => ({ ref: a.ref, docs: a.docs })),
          { maxPerApp: 6, totalCap: 15 },
        );
        console.log(`[pathway stage4] auto-download drawings: ${shortlist.length} shortlisted`);

        let downloaded = 0;
        for (const item of shortlist) {
          const buf = await downloadPlanningPdf(item.doc.url);
          if (!buf) continue;
          const safeRef = item.ref.replace(/[^a-zA-Z0-9/-]/g, "_");
          const labelPart = item.doc.label.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "-").slice(0, 40);
          const drawPart = (item.doc.drawingNumber || "").replace(/[^a-zA-Z0-9-]/g, "").slice(0, 20);
          const filename = `${safeRef}__${drawPart || labelPart || "drawing"}.pdf`.replace(/\/+/g, "-");
          try {
            const up = await Promise.race([
              executeUploadFileToSharePoint(
                { folderPath: drawingsFolder, filename, content: buf, contentType: "application/pdf" },
                req,
              ),
              new Promise<any>((_, reject) => setTimeout(() => reject(new Error("SP upload timeout")), 60_000)),
            ]);
            const webUrl = up?.file?.webUrl;
            if (webUrl) {
              item.doc.downloadedUrl = webUrl;
              item.doc.downloadedName = filename;
              downloaded++;
            }
          } catch (err: any) {
            console.warn(`[pathway stage4] drawing upload failed ${filename}:`, err?.message);
          }
        }
        console.log(`[pathway stage4] auto-download drawings: uploaded=${downloaded}/${shortlist.length}`);
      } else if (!spRoot) {
        console.log("[pathway stage4] auto-download drawings skipped — no SharePoint folder on run");
      }
    } catch (err: any) {
      console.warn(`[pathway stage4] drawings auto-download failed: ${err?.message}`);
    }

    // Legacy: keep floorPlanUrls populated (links to application summary pages)
    // for back-compat with any UI that still reads it.
    const floorPlanUrls: string[] = [];
    for (const app of planningApplications.slice(0, 30)) {
      if (app.documentUrl) floorPlanUrls.push(app.documentUrl);
    }

    console.log(`[pathway stage4] runId=${runId} planning=${planningApplications.length} companyKyc=${companyKyc.length} (${companyKyc.filter((c: any) => !c.error).length} resolved)`);

    await setStageStatus(runId, "stage4", "completed", {
      stage4: {
        titleRegisters: [], // InfoTrack-sourced later
        planningApplications,
        planningDocs,
        floorPlanUrls,
        companyKyc,
        proprietorKyc: null,
      },
    });

    // Informed email sweep — run AFTER Stage 4 so we can use Clouseau's full
    // investigation (officers, PSCs, UBOs, title numbers, company number) as
    // search terms. These catch emails that never mention the street/postcode
    // (e.g. "Re: 03292489 accounts", "Sugar disposal", "Daulan – LN59572").
    // Additive — merges into stage1.emailHits, doesn't replace existing hits.
    runInformedEmailSearchPostStage4(runId, req).catch((err: any) => {
      console.warn(`[pathway informed-email] background task failed: ${err?.message}`);
    });
  } catch (err: any) {
    console.error("[pathway stage4] failed:", err?.message);
    await setStageStatus(runId, "stage4", "failed");
  }
}

// ----------------------------------------------------------------------------
// Informed email sweep — runs after Stage 4 completes.
// Uses company numbers, officer / PSC / UBO surnames, and title numbers from
// Clouseau's stored investigations to search the full BGP mailbox set with
// high-signal terms. Merges new hits into stage1.emailHits so the UI picks
// them up on its next poll.
// ----------------------------------------------------------------------------
async function runInformedEmailSearchPostStage4(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) return;
  const results = run.stageResults as StageResults;
  const s1 = results.stage1 || {};
  const s4 = results.stage4 || {};

  const terms = new Set<string>();
  const addTerm = (raw: string | null | undefined) => {
    if (!raw) return;
    const t = String(raw).trim();
    if (t.length >= 4 && !/^\d{1,3}$/.test(t)) terms.add(t);
  };
  const addSurname = (raw: string | null | undefined) => {
    if (!raw) return;
    // "SUGAR, Daniel Alan" → "SUGAR"; "Daniel Sugar" → "Sugar"
    const first = String(raw).split(",")[0]?.trim() || "";
    const surname = first.includes(",") ? first : first.split(/\s+/).pop() || "";
    if (surname && surname.length >= 4) addTerm(surname);
  };

  const invIds = (s4.companyKyc || [])
    .map((c: any) => c.investigationId)
    .filter((id: any) => Number.isFinite(id)) as number[];

  const { pool } = await import("./db");
  for (const invId of invIds) {
    try {
      const row = await pool.query(`SELECT result FROM kyc_investigations WHERE id = $1`, [invId]);
      const raw = row.rows[0]?.result;
      if (!raw) continue;
      const r = typeof raw === "string" ? JSON.parse(raw) : raw;
      // Company name — first clause before comma/semicolon
      const companyName = String(r?.subject?.name || "").split(/[,;—]/)[0]?.trim();
      if (companyName) addTerm(companyName);
      // Company number (very high signal)
      if (r?.subject?.companyNumber) addTerm(r.subject.companyNumber);
      // Active officers — surname only
      for (const o of (r?.officers || []).filter((o: any) => !o.resigned_on).slice(0, 8)) {
        addSurname(o?.name);
      }
      // Active PSCs
      for (const p of (r?.pscs || []).filter((p: any) => !p.ceased_on).slice(0, 8)) {
        addSurname(p?.name);
      }
      // UBOs from the ownership chain
      for (const u of (r?.ownershipChain?.ubos || []).slice(0, 8)) {
        addSurname(u?.name);
      }
      // Charge-holders (lenders)
      for (const c of (r?.charges || []).slice(0, 8)) {
        for (const p of (c?.persons_entitled || [])) {
          const lender = String(p?.name || "").split(/[,(]/)[0]?.trim();
          if (lender) addTerm(lender);
        }
      }
    } catch (err: any) {
      console.warn(`[pathway informed-email] fetch inv ${invId} failed: ${err?.message}`);
    }
  }

  // Title numbers from Stage 1 Land Registry
  if ((s1 as any)?.initialOwnership?.titleNumber) addTerm((s1 as any).initialOwnership.titleNumber);
  // Title numbers from freeholds/leaseholds data if present
  const lrFree = (s1 as any)?.rawFreeholds || [];
  for (const f of lrFree.slice(0, 10)) if (f?.title_number) addTerm(f.title_number);

  // Skip terms already covered by Stage 1's primary search — those were already scanned.
  const primaryToken = (run.address?.split(",")[0] || "").trim().toLowerCase().split(/\s+/)[0];
  for (const t of [...terms]) {
    if (t.toLowerCase() === primaryToken) terms.delete(t);
  }

  if (terms.size === 0) {
    console.log(`[pathway informed-email] runId=${runId} no usable terms — skipping`);
    return;
  }
  console.log(`[pathway informed-email] runId=${runId} terms=[${[...terms].map((t) => JSON.stringify(t)).join(", ")}]`);

  // Build mailbox list (shared + every active BGP user)
  const mailboxes: Array<{ email: string; owner: string }> = [
    { email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" },
  ];
  try {
    const activeUsers = await db
      .select({ username: users.username, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.isActive, true));
    for (const u of activeUsers) {
      const mb = u.email || u.username;
      if (mb && /@brucegillinghampollard\.com$/i.test(mb) && mb.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
        mailboxes.push({ email: mb, owner: u.name || mb });
      }
    }
  } catch (err: any) {
    console.warn(`[pathway informed-email] team mailbox list error: ${err?.message}`);
  }

  const { graphRequest } = await import("./shared-mailbox");
  const { getValidMsToken } = await import("./microsoft");
  const delegatedToken = await getValidMsToken(req).catch(() => null);

  // Seed dedupe set from existing emailHits so we only add genuinely new rows
  const existing: any[] = (s1 as any).emailHits || [];
  const seen = new Set<string>();
  for (const e of existing) {
    if (e?.msgId) seen.add(String(e.msgId));
    const subj = String(e?.subject || "").trim().toLowerCase();
    const from = String(e?.from || "").trim().toLowerCase();
    if (subj || from) seen.add(`${subj}|${from}`);
  }

  const added: any[] = [];
  const pushMsg = (msg: any, ownerLabel: string, mailboxEmail: string | undefined, matchedTerm: string) => {
    const primary = String(msg.internetMessageId || msg.id || "");
    const subjFromKey = `${String(msg.subject || "").trim().toLowerCase()}|${String(msg.from?.emailAddress?.address || "").trim().toLowerCase()}`;
    if (seen.has(primary) || seen.has(subjFromKey)) return;
    seen.add(primary);
    seen.add(subjFromKey);
    added.push({
      subject: msg.subject ? `${msg.subject} · via ${ownerLabel}` : `(no subject) · via ${ownerLabel}`,
      from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
      date: msg.receivedDateTime,
      msgId: msg.id,
      mailboxEmail,
      preview: (msg.bodyPreview || "").slice(0, 200),
      hasAttachments: !!msg.hasAttachments,
      webLink: msg.webLink || null,
      matchedTerm,
    });
  };

  // Build jobs: every (mailbox × term) pair, app-only via graphRequest.
  // Keep terms quoted so Graph does phrase match — at this point the terms
  // are distinctive enough (Co#, surnames) that exact match is what we want.
  const CONC = 6;
  const jobs: Array<() => Promise<void>> = [];
  for (const mb of mailboxes) {
    for (const term of terms) {
      jobs.push(async () => {
        try {
          const q = `"${term}"`;
          const res: any = await graphRequest(
            `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(q)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
            { headers: { "X-AnchorMailbox": mb.email } }
          );
          for (const msg of (res?.value || [])) pushMsg(msg, mb.owner, mb.email, term);
        } catch {}
      });
    }
  }
  // Also delegated /me if we have a user token
  if (delegatedToken) {
    for (const term of terms) {
      jobs.push(async () => {
        try {
          const q = `"${term}"`;
          const resp = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages?$search=${encodeURIComponent(q)}&$top=10&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
            { headers: { Authorization: `Bearer ${delegatedToken}`, "Content-Type": "application/json" } }
          );
          if (!resp.ok) return;
          const data: any = await resp.json();
          for (const msg of (data?.value || [])) pushMsg(msg, "My inbox", undefined, term);
        } catch {}
      });
    }
  }

  for (let i = 0; i < jobs.length; i += CONC) {
    await Promise.all(jobs.slice(i, i + CONC).map((j) => j()));
  }

  if (added.length === 0) {
    console.log(`[pathway informed-email] runId=${runId} no new emails (${existing.length} existing, ${mailboxes.length} mailboxes × ${terms.size} terms)`);
    return;
  }

  // Merge into stage1.emailHits and persist. Re-read the run so we don't
  // clobber a concurrent update.
  const fresh = await getRun(runId);
  const freshResults = (fresh?.stageResults as any) || {};
  const freshS1 = freshResults.stage1 || {};
  const merged = [...(freshS1.emailHits || []), ...added]
    .sort((a: any, b: any) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime())
    .slice(0, 200);
  freshS1.emailHits = merged;
  freshS1.informedEmailCount = added.length;
  freshResults.stage1 = freshS1;
  await updateRun(runId, { stageResults: freshResults });
  console.log(`[pathway informed-email] runId=${runId} +${added.length} emails (${existing.length} → ${merged.length}) across ${mailboxes.length} mailboxes × ${terms.size} terms`);
}

// ============================================================================
// STAGE 5 — Investigation Board ready
// ============================================================================

async function runStage5(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  const results = run.stageResults as StageResults;

  // Refresh building contacts with the fuller picture — by Stage 5 we have
  // Stage 4 CH officers cached in kyc_investigations, plus any new CRM hits
  // the user's added during review. Overwrites stage2.buildingContacts in
  // place so the UI just reads the latest.
  try {
    const { buildBuildingContacts } = await import("./pathway-contacts");
    // Pull officers from the proprietor's KYC record if Stage 4 ran one
    const proprietorKyc = (results.stage4?.companyKyc || []).find((c: any) => c.role === "proprietor");
    let existingOfficers: Array<{ name: string; officerRole?: string; appointedOn?: string; resignedOn?: string }> = [];
    if (proprietorKyc?.investigationId) {
      try {
        const { kycInvestigations } = await import("@shared/schema");
        const rows = await db
          .select()
          .from(kycInvestigations)
          .where(eq(kycInvestigations.id, proprietorKyc.investigationId))
          .limit(1);
        const result = (rows[0] as any)?.result || {};
        const officers = result.officers || result.profileData?.officers || [];
        if (Array.isArray(officers)) {
          existingOfficers = officers.map((o: any) => ({
            name: o.name,
            officerRole: o.officer_role || o.officerRole || o.role,
            appointedOn: o.appointed_on || o.appointedOn,
            resignedOn: o.resigned_on || o.resignedOn,
          }));
        }
      } catch (err: any) {
        console.warn("[pathway stage5] KYC officers lookup failed:", err?.message);
      }
    }
    const refreshed = await buildBuildingContacts({
      emailHits: results.stage1?.emailHits || [],
      ownership: results.stage1?.initialOwnership || null,
      existingOfficers,
      stage: "stage5",
    });
    const stage2 = (results.stage2 || {}) as any;
    await setStageStatus(runId, "stage2", results.stage2?.skipped ? "skipped" : "completed", {
      stage2: { ...stage2, buildingContacts: refreshed },
    });
    console.log(`[pathway stage5] contacts refreshed: agents=${refreshed.agents.length} landlord=${refreshed.landlord.length} assetMgr=${refreshed.assetManager.length}`);
  } catch (err: any) {
    console.warn("[pathway stage5] contacts refresh failed:", err?.message);
  }

  await setStageStatus(runId, "stage5", "completed", {
    stage5: { ready: true, boardUrl: `/property-intelligence?tab=board&runId=${runId}` },
  });
}

// ============================================================================
// STAGE 6 — Business Plan
// ============================================================================
// Claude sweeps everything gathered in stages 1–5 and proposes a structured
// business plan plus a conversational summary. The user (and ChatBGP) can
// push back on any field via `update_business_plan`; once they click Agree,
// `stage6.agreed` is locked and Stage 7 (Excel Model) can run.

async function runStage6(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage6", "running");

  try {
    const draft = await draftBusinessPlan(run);
    const existing = (run.stageResults as StageResults)?.stage6 || {};
    await setStageStatus(runId, "stage6", "completed", {
      stage6: {
        ...existing,
        draft: draft.plan,
        summary: draft.summary,
      },
    });
  } catch (err: any) {
    const msg = err?.message || String(err);
    const status = err?.status || err?.response?.status;
    const body = err?.response?.data || err?.error || undefined;
    console.error("[pathway stage6] draft failed:", { status, msg, body });
    const existing = (run.stageResults as StageResults)?.stage6 || {};
    await setStageStatus(runId, "stage6", "failed", {
      stage6: {
        ...existing,
        summary: `Stage 6 failed: ${msg}${status ? ` (HTTP ${status})` : ""}`,
      } as any,
    }).catch(() => {});
  }
}

async function draftBusinessPlan(run: PropertyPathwayRun): Promise<{ plan: BusinessPlan; summary: string }> {
  const sr = (run.stageResults as StageResults) || {};
  const context = {
    address: run.address,
    postcode: run.postcode,
    stage1: sr.stage1 ? {
      owner: sr.stage1.initialOwnership?.proprietorName,
      purchasePrice: sr.stage1.initialOwnership?.pricePaid,
      purchaseDate: sr.stage1.initialOwnership?.dateOfPurchase,
      tenancy: sr.stage1.tenancy,
      comps: (sr.stage1.comps || []).slice(0, 12),
      aiFacts: sr.stage1.aiFacts,
      summary: sr.stage1.summary,
    } : undefined,
    stage2: sr.stage2 || undefined,
    stage4: sr.stage4 ? { companyKyc: sr.stage4.companyKyc } : undefined,
    marketIntel: sr.marketIntel ? {
      marketContext: sr.marketIntel.marketContext,
      keyFindings: sr.marketIntel.keyFindings,
      leasingHistory: (sr.marketIntel.leasingHistory || []).slice(0, 8),
      comparables: (sr.marketIntel.comparables || []).slice(0, 8),
    } : undefined,
  };

  const resp = await callClaude({
    model: "claude-opus-4-6",
    messages: [{
      role: "user",
      content: `You are a senior director at BGP (Bruce Gillingham Pollard) sitting down with Woody to agree a business plan for a live investment opportunity. You have done a final sweep of everything the pathway has gathered. Propose a concrete, opinionated plan — don't hedge, don't list options. Pick a strategy.

Return a JSON object with exactly this shape (no prose around it):
{
  "plan": {
    "strategy": "string — one sentence naming the play (e.g. 'Buy vacant, refurb to A-grade, re-let at market to a covenant tenant, exit year 5')",
    "holdPeriodYrs": number,
    "targetPurchasePrice": number,
    "targetNIY": number (decimal, e.g. 0.0525),
    "exitPrice": number,
    "exitYield": number (decimal),
    "exitYear": number,
    "capex": { "amount": number, "scope": "string — one line" },
    "leasing": { "vacantUnits": ["..."], "targetRentPsf": number, "reversionNotes": "string" },
    "equityCheck": number,
    "targetIRR": number (decimal),
    "targetMOIC": number,
    "risks": ["3-5 concise risks"],
    "keyMoves": ["3-5 concise bullets describing what we do, in order"]
  },
  "summary": "A 4-6 sentence plain-English pitch of the plan, as if you're standing in front of Woody. Lead with the strategy and the number that matters most. Finish with 'Agree, or tell me what to change.'"
}

Use only numbers you can ground in the context. Where you have to estimate (e.g. ERV, exit yield), say so in the summary. If key data is missing, still pick a plan — note the assumption in risks.

Context:
${JSON.stringify(context, null, 2).slice(0, 18000)}`,
    }],
    max_completion_tokens: 3000,
    temperature: 0.2,
  });

  const raw = resp.choices[0]?.message?.content || "{}";
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  let parsed: any = {};
  try {
    parsed = start >= 0 && end > start ? JSON.parse(cleaned.slice(start, end + 1)) : {};
  } catch (e: any) {
    console.warn("[stage6] plan JSON parse failed:", e?.message);
  }

  return {
    plan: (parsed.plan || {}) as BusinessPlan,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

// ============================================================================
// STAGE 7 — Excel Model
// ============================================================================
// Generate an Excel model pre-populated from stage6.agreed. The Excel add-in
// then continues the ChatBGP conversation inside the workbook so Woody and
// Claude can iterate on assumptions. On agree, the current version is locked.

async function runStage7(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");

  const sr = (run.stageResults as StageResults) || {};
  const agreed = sr.stage6?.agreed;
  if (!agreed) {
    throw new Error("Cannot generate Excel model — business plan has not been agreed yet. Agree Stage 6 first.");
  }

  await setStageStatus(runId, "stage7", "running");

  try {
    const patch: NonNullable<StageResults["stage7"]> = {};

    // Seed an Excel model run tied to this pathway run. The actual workbook
    // generation + add-in handoff is wired through /api/models — here we just
    // record the link so the UI knows where to send the user.
    try {
      const eb = await import("./excel-builder").catch(() => null as any);
      if (eb?.createPathwayModelRun) {
        // Derive total area + passing rent from Stage 1 so the model isn't
        // built off the 5,000 sq ft / £500k default. Priority order:
        //   1. Sum of tenancy.units[].sqft (most precise)
        //   2. Parsed aiFacts.sizeSqft ("31,384 sq ft" / "8500")
        //   3. CRM property totalAreaSqft (if propertyId is linked)
        const s1 = sr.stage1 || {};
        const existingStage7 = sr.stage7 || {};
        let totalAreaSqFt: number | undefined;
        let totalAreaSource: "tenancy" | "ai" | "manual" | "default" = "default";
        if (typeof existingStage7.overrideTotalAreaSqFt === "number" && existingStage7.overrideTotalAreaSqFt > 0) {
          totalAreaSqFt = Math.round(existingStage7.overrideTotalAreaSqFt);
          totalAreaSource = "manual";
        }
        if (!totalAreaSqFt) {
          const unitSqfts = (s1.tenancy?.units || [])
            .map((u: any) => Number(u.sqft))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          if (unitSqfts.length) {
            totalAreaSqFt = unitSqfts.reduce((a: number, b: number) => a + b, 0);
            totalAreaSource = "tenancy";
          }
        }
        if (!totalAreaSqFt && s1.aiFacts?.sizeSqft) {
          const parsed = parseFloat(String(s1.aiFacts.sizeSqft).replace(/[^0-9.]/g, ""));
          if (Number.isFinite(parsed) && parsed > 0) {
            totalAreaSqFt = Math.round(parsed);
            totalAreaSource = "ai";
          }
        }

        let currentRentPA: number | undefined;
        let currentRentSource: "tenancy" | "ai" | "plan" | "manual" | "default" = "default";
        if (typeof existingStage7.overrideCurrentRentPA === "number" && existingStage7.overrideCurrentRentPA > 0) {
          currentRentPA = Math.round(existingStage7.overrideCurrentRentPA);
          currentRentSource = "manual";
        }
        if (!currentRentPA) {
          const askingRents = (s1.tenancy?.units || [])
            .map((u: any) => Number(u.askingRent))
            .filter((n: number) => Number.isFinite(n) && n > 0);
          if (askingRents.length) {
            currentRentPA = askingRents.reduce((a: number, b: number) => a + b, 0);
            currentRentSource = "tenancy";
          }
        }
        if (!currentRentPA && s1.aiFacts?.passingRent) {
          const parsed = parseFloat(String(s1.aiFacts.passingRent).replace(/[^0-9.]/g, ""));
          if (Number.isFinite(parsed) && parsed > 0) {
            currentRentPA = Math.round(parsed);
            currentRentSource = "ai";
          }
        }
        if (!currentRentPA && typeof agreed.targetPurchasePrice === "number" && typeof agreed.targetNIY === "number") {
          currentRentPA = Math.round(agreed.targetPurchasePrice * agreed.targetNIY);
          currentRentSource = "plan";
        }

        console.log(`[pathway stage7] derived totalAreaSqFt=${totalAreaSqFt || "(default)"} (source=${totalAreaSource}), currentRentPA=${currentRentPA || "(default)"} (source=${currentRentSource})`);
        patch.totalAreaSqFt = totalAreaSqFt;
        patch.totalAreaSource = totalAreaSource;
        patch.currentRentPA = currentRentPA;
        patch.currentRentSource = currentRentSource;
        const seed = await eb.createPathwayModelRun({
          runId,
          address: run.address,
          plan: agreed,
          totalAreaSqFt,
          currentRentPA,
        });
        patch.modelRunId = seed.modelRunId;
        patch.modelVersionId = seed.modelVersionId;
        patch.modelRunName = seed.modelRunName;
        patch.modelVersionLabel = seed.modelVersionLabel;
        patch.workbookUrl = seed.workbookUrl;
      }
    } catch (err: any) {
      console.warn("[pathway stage7] model seed skipped:", err?.message);
    }

    // Stage 7 does NOT auto-complete — it stays "running" until Woody clicks
    // Agree on the model (setting stage7.agreed = true). That flips it to
    // "completed" and unlocks Stage 8.
    const existing = sr.stage7 || {};
    await updateRun(runId, {
      stageResults: { ...sr, stage7: { ...existing, ...patch } },
      stageStatus: { ...(run.stageStatus as StageStatusMap), stage7: "running" },
    });
  } catch (err: any) {
    console.error("[pathway stage7] failed:", err?.message);
    await setStageStatus(runId, "stage7", "failed");
  }
}

// ============================================================================
// STAGE 8 — Studio Time (images)
// ============================================================================

async function runStage8(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage8", "running");

  const patch: NonNullable<StageResults["stage8"]> = {};
  const sr = (run.stageResults || {}) as StageResults;

  // Collect tenant names from every upstream stage Claude has touched.
  const tenantNames: string[] = [];
  const s1 = sr.stage1 || {};
  if (s1.tenant?.name) tenantNames.push(s1.tenant.name);
  if (s1.tenancy?.occupier) tenantNames.push(s1.tenancy.occupier);
  for (const m of s1.aiFacts?.mainTenants || []) tenantNames.push(m);
  const s2 = sr.stage2 || {};
  if (s2.company?.name) tenantNames.push(s2.company.name);

  // Download SharePoint brochures so the sweep can extract embedded images.
  // Email-sourced brochures aren't downloaded here (attachment fetch is a
  // separate Graph call we don't need for v1 — SharePoint covers most).
  const brochurePdfs: Array<{ name: string; buffer: Buffer; webUrl?: string }> = [];
  try {
    const spBrochures = (s1.brochureFiles || [])
      .filter(b => (b.source === "sharepoint" || b.source === "sharepoint-uploaded") && /\.pdf$/i.test(b.name))
      .slice(0, 6);
    if (spBrochures.length) {
      const { getValidMsToken } = await import("./microsoft");
      const token = await getValidMsToken(req).catch(() => null);
      const { getSharePointDriveId } = await import("./utils/sharepoint-operations");
      const driveId = token ? await getSharePointDriveId(token) : null;
      if (token && driveId) {
        for (const bro of spBrochures) {
          try {
            const resp = await fetch(
              `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${bro.ref}/content`,
              { headers: { Authorization: `Bearer ${token}` }, redirect: "follow" },
            );
            if (!resp.ok) {
              console.warn(`[pathway stage8] brochure download ${bro.name} failed: ${resp.status}`);
              continue;
            }
            const buf = Buffer.from(await resp.arrayBuffer());
            brochurePdfs.push({ name: bro.name, buffer: buf, webUrl: bro.webUrl });
          } catch (err: any) {
            console.warn(`[pathway stage8] brochure download error (${bro.name}):`, err?.message);
          }
        }
      }
    }
  } catch (err: any) {
    console.warn("[pathway stage8] brochure prefetch skipped:", err?.message);
  }

  // 8a. Bulk image sweep — SV 4 headings + area offsets, Places photos,
  // Clearbit logos, brochure-extracted images — filed into
  // Building / Tenants / Area collections.
  try {
    const { sweepStage8ImagesForRun } = await import("./image-studio");
    const sweep = await sweepStage8ImagesForRun({
      runId,
      address: run.address,
      postcode: run.postcode || undefined,
      propertyId: run.propertyId,
      tenantNames,
      userId: (run as any).startedBy || undefined,
      brochurePdfs,
    });
    patch.streetViewImageId = sweep.streetViewImageId;
    patch.collections = sweep.collections;
  } catch (err: any) {
    console.warn("[pathway stage8] image sweep failed:", err?.message);
  }

  // 8b. Retail Context Plan (custom GOAD-style overlay) — filed to the Area
  // collection so it shows up alongside the other area imagery.
  try {
    const rcpMod = await import("./retail-context-plan").catch(() => null as any);
    if (rcpMod?.renderRetailContextPlan) {
      const image = await rcpMod.renderRetailContextPlan({ address: run.address, postcode: run.postcode || "", propertyId: run.propertyId });
      patch.retailContextImageId = image.id;
      const areaCol = patch.collections?.find(c => c.bucket === "area");
      if (areaCol?.id && image?.id) {
        try {
          await pool.query(
            `INSERT INTO image_studio_collection_images (collection_id, image_id) VALUES ($1, $2) ON CONFLICT (collection_id, image_id) DO NOTHING`,
            [areaCol.id, image.id],
          );
          areaCol.imageCount = (areaCol.imageCount || 0) + 1;
        } catch {}
      }
    }
  } catch (err: any) {
    console.warn("[pathway stage8] retail context plan skipped:", err?.message);
  }

  await setStageStatus(runId, "stage8", "completed", { stage8: patch });
}

// ============================================================================
// STAGE 9 — Why Buy
// ============================================================================

async function runStage9(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage9", "running");

  try {
    const wbMod = await import("./why-buy-renderer").catch(() => null as any);
    if (!wbMod?.renderWhyBuy) {
      await setStageStatus(runId, "stage9", "failed", {
        stage9: { documentUrl: undefined },
      });
      return;
    }
    const result = await wbMod.renderWhyBuy({ runId, req });
    await setStageStatus(runId, "stage9", "completed", {
      stage9: {
        documentUrl: result.documentUrl,
        sharepointUrl: result.sharepointUrl,
        pdfPath: result.pdfPath,
      },
    });
    await updateRun(runId, { whyBuyDocumentUrl: result.sharepointUrl || result.documentUrl, completedAt: new Date() });
  } catch (err: any) {
    console.error("[pathway stage9] failed:", err?.message);
    await setStageStatus(runId, "stage9", "failed");
  }
}

// ============================================================================
// Stage dispatcher
// ============================================================================

const STAGE_FUNCTIONS: Record<number, (runId: string, req: Request) => Promise<void>> = {
  1: runStage1,
  2: runStage2,
  3: runStage3,
  4: runStage4,
  5: runStage5,
  6: runStage6,  // Business Plan
  7: runStage7,  // Excel Model
  8: runStage8,  // Studio Time
  9: runStage9,  // Why Buy
};

export async function runStage(runId: string, stageNumber: number, req: Request): Promise<PropertyPathwayRun> {
  const fn = STAGE_FUNCTIONS[stageNumber];
  if (!fn) throw new Error(`No stage ${stageNumber}`);
  await fn(runId, req);
  const updated = await getRun(runId);
  if (!updated) throw new Error("Run vanished");
  return updated;
}

// ============================================================================
// Routes
// ============================================================================

export function registerPropertyPathwayRoutes(app: Express) {
  // Bootstrap the retail_leasing_comps table (curated store, separate from CRM).
  (async () => {
    try {
      const { ensureRetailLeasingCompsTable } = await import("./retail-comps-extractor");
      await ensureRetailLeasingCompsTable();
    } catch (err: any) {
      console.warn("[pathway] retail_leasing_comps bootstrap failed:", err?.message);
    }
  })();

  // Fetch a single email's full details + attachment list from any BGP mailbox.
  // Used by the pathway's in-app email viewer so users don't have to open Outlook.
  app.get("/api/pathway/email/:mailboxEmail/:msgId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const mailboxEmail = String(req.params.mailboxEmail);
      const msgId = String(req.params.msgId);

      const [msg, atts]: [any, any] = await Promise.all([
        graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(msgId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments,webLink`,
          { headers: { "X-AnchorMailbox": mailboxEmail } }
        ),
        graphRequest(
          `/users/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(msgId)}/attachments?$select=id,name,size,contentType,isInline`,
          { headers: { "X-AnchorMailbox": mailboxEmail } }
        ).catch(() => ({ value: [] })),
      ]);

      res.json({
        id: msg.id,
        subject: msg.subject || "(No subject)",
        from: {
          name: msg.from?.emailAddress?.name,
          email: msg.from?.emailAddress?.address,
        },
        to: (msg.toRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
        cc: (msg.ccRecipients || []).map((r: any) => ({ name: r.emailAddress?.name, email: r.emailAddress?.address })),
        date: msg.receivedDateTime,
        bodyContentType: msg.body?.contentType || "text",
        bodyHtml: msg.body?.contentType === "html" ? (msg.body?.content || "") : "",
        bodyText: msg.body?.contentType === "text" ? (msg.body?.content || "") : (msg.bodyPreview || ""),
        hasAttachments: !!msg.hasAttachments,
        webLink: msg.webLink || null,
        attachments: (atts?.value || [])
          .filter((a: any) => !a.isInline)
          .map((a: any) => ({ id: a.id, name: a.name, size: a.size, contentType: a.contentType })),
      });
    } catch (err: any) {
      console.error("[pathway email fetch] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to fetch email" });
    }
  });

  // Download a specific attachment from a specific email. Streams the raw bytes.
  app.get("/api/pathway/email/:mailboxEmail/:msgId/attachment/:attachmentId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const mailboxEmail = String(req.params.mailboxEmail);
      const msgId = String(req.params.msgId);
      const attachmentId = String(req.params.attachmentId);

      const att: any = await graphRequest(
        `/users/${encodeURIComponent(mailboxEmail)}/messages/${encodeURIComponent(msgId)}/attachments/${encodeURIComponent(attachmentId)}`,
        { headers: { "X-AnchorMailbox": mailboxEmail } }
      );

      if (!att || !att.contentBytes) {
        return res.status(404).json({ error: "Attachment content not available" });
      }

      const buffer = Buffer.from(att.contentBytes, "base64");
      const filename = String(att.name || "attachment").replace(/"/g, "");
      res.setHeader("Content-Type", att.contentType || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", String(buffer.length));
      res.end(buffer);
    } catch (err: any) {
      console.error("[pathway attachment download] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to download attachment" });
    }
  });

  // Diagnostic: which mailboxes can the app actually search?
  // Tries a harmless "test" $search per mailbox, reports which work / which error.
  app.get("/api/pathway/email-access-check", requireAuth, async (req: Request, res: Response) => {
    try {
      const { graphRequest } = await import("./shared-mailbox");
      const { getValidMsToken } = await import("./microsoft");

      // Enumerate team mailboxes (same logic as runStage1)
      const mailboxes: Array<{ email: string; owner: string }> = [
        { email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" },
      ];
      try {
        const activeUsers = await db
          .select({ username: users.username, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.isActive, true));
        for (const u of activeUsers) {
          const mailbox = u.email || u.username;
          if (mailbox && /@brucegillinghampollard\.com$/i.test(mailbox) && mailbox.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
            mailboxes.push({ email: mailbox, owner: u.name || mailbox });
          }
        }
      } catch {}

      // Test delegated token
      const delegatedToken = await getValidMsToken(req).catch(() => null);
      let delegatedStatus: any = { available: false };
      if (delegatedToken) {
        try {
          const resp = await fetch(
            `https://graph.microsoft.com/v1.0/me/messages?$top=1&$select=id`,
            { headers: { Authorization: `Bearer ${delegatedToken}` } }
          );
          delegatedStatus = {
            available: true,
            me_messages: resp.ok ? "OK" : `${resp.status}: ${(await resp.text()).slice(0, 150)}`,
          };
        } catch (err: any) {
          delegatedStatus = { available: true, me_messages: `error: ${err?.message}` };
        }
      }

      // Test app-token on every team mailbox — tries BOTH a plain list AND a $search
      // so we can tell whether Graph's search index itself is the problem.
      const searchTerm = String(req.query.search || "Haymarket");
      const mailboxResults: Array<{ email: string; owner: string; status: string; listCount?: number; searchCount?: number; error?: string }> = [];
      for (const mb of mailboxes) {
        try {
          // 1) Plain list — does permission work at all
          const listRes: any = await graphRequest(`/users/${encodeURIComponent(mb.email)}/messages?$top=3&$select=id,subject`);
          const listCount = listRes?.value?.length || 0;

          // 2) $search — does the search index work on this mailbox
          let searchCount = 0;
          try {
            const searchRes: any = await graphRequest(
              `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(`"${searchTerm}"`)}&$top=5&$select=id,subject,from`,
              { headers: { "X-AnchorMailbox": mb.email } }
            );
            searchCount = searchRes?.value?.length || 0;
          } catch (searchErr: any) {
            // Record but don't fail the whole check
            mailboxResults.push({ email: mb.email, owner: mb.owner, status: "SEARCH_ERROR", listCount, error: String(searchErr?.message || searchErr).slice(0, 200) });
            continue;
          }
          mailboxResults.push({ email: mb.email, owner: mb.owner, status: "OK", listCount, searchCount });
        } catch (err: any) {
          const errMsg = String(err?.message || err).slice(0, 250);
          let hint = "";
          if (/403/.test(errMsg)) {
            if (/ApplicationAccessPolicy/i.test(errMsg)) hint = "Blocked by ApplicationAccessPolicy — scope restriction";
            else hint = "Forbidden — Mail.Read Application permission not effective (maybe token still cached)";
          } else if (/MailboxNotEnabledForRESTAPI/i.test(errMsg)) {
            hint = "User has no Exchange Online mailbox / not licensed";
          } else if (/ResourceNotFound|404/.test(errMsg)) {
            hint = "Mailbox not found — email address doesn't match a real user";
          }
          mailboxResults.push({ email: mb.email, owner: mb.owner, status: "ERROR", error: errMsg + (hint ? ` — ${hint}` : "") });
        }
      }
      const totalSearchHits = mailboxResults.reduce((sum, m) => sum + (m.searchCount || 0), 0);

      const okCount = mailboxResults.filter((m) => m.status === "OK").length;
      const searchErrorCount = mailboxResults.filter((m) => m.status === "SEARCH_ERROR").length;
      let verdict: string;
      if (okCount === mailboxes.length) {
        verdict = totalSearchHits > 0
          ? `✅ All team mailboxes accessible AND $search works (${totalSearchHits} total matches for "${searchTerm}" across all boxes). Pathway email search should work.`
          : `⚠️ All team mailboxes accessible but $search returned 0 results across all ${mailboxes.length} boxes for "${searchTerm}". This suggests the Graph search index isn't finding matches even when emails exist — might need ConsistencyLevel header or a different search approach.`;
      } else if (searchErrorCount > 0) {
        verdict = `⚠️ ${searchErrorCount}/${mailboxes.length} mailboxes could be listed but $search errored. Permission works but search doesn't.`;
      } else if (okCount === 0) {
        verdict = "❌ NO team mailboxes accessible — app-only Mail.Read permission is not effective. Restart Railway or re-consent.";
      } else {
        verdict = `${okCount}/${mailboxes.length} mailboxes accessible. See failures below.`;
      }
      res.json({
        summary: {
          delegatedToken: delegatedStatus,
          appTokenMailboxes: {
            total: mailboxes.length,
            ok: okCount,
            searchErrored: searchErrorCount,
            failing: mailboxes.length - okCount - searchErrorCount,
            totalSearchHits,
            searchTerm,
          },
          verdict,
        },
        mailboxes: mailboxResults,
      });
    } catch (err: any) {
      res.status(500).json({ error: err?.message || "Unknown error" });
    }
  });

  // AI email organiser — takes the email hit list from stage 1 and returns
  // a Claude-organised summary: chronological threads, filtered noise, gaps.
  app.post("/api/pathway/email-sort", requireAuth, async (req: Request, res: Response) => {
    try {
      const { address, emailHits } = req.body as { address?: string; emailHits?: any[] };
      if (!emailHits?.length) return res.json({ summary: "No emails to analyse.", markdown: "No emails to analyse." });
      const result = await runEmailSort(address || "", emailHits);
      // Keep `summary` for legacy callers; new callers should read `markdown`.
      res.json({ summary: result.markdown, markdown: result.markdown });
    } catch (err: any) {
      console.error("[pathway/email-sort]", err?.message);
      res.status(500).json({ error: err?.message || "AI analysis failed" });
    }
  });

  // Start a new pathway run — returns existing run for the same address+postcode if one exists (unless force=true)
  app.post("/api/property-pathway/start", requireAuth, async (req: Request, res: Response) => {
    try {
      const { address, postcode, propertyId, force } = req.body as { address?: string; postcode?: string; propertyId?: string; force?: boolean };
      if (!address || typeof address !== "string") {
        return res.status(400).json({ error: "address required" });
      }
      // Normalise aggressively: lowercase, collapse whitespace, strip spaces
      // around hyphens, remove punctuation — so "18-22 Haymarket",
      // "18 - 22 Haymarket", and "18—22 haymarket." all match.
      const normaliseAddr = (s: string) =>
        s.trim()
          .toLowerCase()
          .replace(/[—–]/g, "-")
          .replace(/\s*-\s*/g, "-")
          .replace(/[.,]/g, "")
          .replace(/\s+/g, " ");
      const normalisedAddr = normaliseAddr(address);
      // Extract postcode from address if not provided separately
      const UK_POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
      const resolvedPostcode = postcode || address.match(UK_POSTCODE_RE)?.[1] || "";
      const normalisedPostcode = resolvedPostcode.trim().replace(/\s+/g, "").toUpperCase();

      // Dedupe: look for an existing (non-deleted) run matching address±postcode
      if (!force) {
        const existing = await db
          .select()
          .from(propertyPathwayRuns)
          .orderBy(desc(propertyPathwayRuns.updatedAt))
          .limit(200);
        const match = existing.find((r) => {
          const rAddr = normaliseAddr(r.address || "");
          const rPostcode = (r.postcode || "").trim().replace(/\s+/g, "").toUpperCase();
          if (normalisedPostcode && rPostcode) {
            return rPostcode === normalisedPostcode;
          }
          return rAddr === normalisedAddr;
        });
        if (match) {
          return res.json({ success: true, run: match, existing: true });
        }
      }

      const userId = req.session.userId || req.tokenUserId || null;

      // Two-step address resolution: Google Geocoding → confirmed postcode + coords,
      // then PropertyData address-match-uprn → UPRN for exact building
      let resolvedFormattedAddress: string | null = null;
      let resolvedLat: number | null = null;
      let resolvedLng: number | null = null;
      let resolvedUprn: string | null = null;
      let finalPostcode = resolvedPostcode || null;

      const googleKey = process.env.GOOGLE_API_KEY || process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY;
      if (googleKey) {
        try {
          const geoUrl = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${googleKey}&region=uk&components=country:GB`;
          const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(8000) });
          if (geoRes.ok) {
            const geoData: any = await geoRes.json();
            const result = geoData?.results?.[0];
            if (result) {
              resolvedFormattedAddress = result.formatted_address || null;
              resolvedLat = result.geometry?.location?.lat ?? null;
              resolvedLng = result.geometry?.location?.lng ?? null;
              const pcComponent = result.address_components?.find((c: any) => c.types?.includes("postal_code"));
              if (pcComponent?.long_name && !finalPostcode) {
                finalPostcode = pcComponent.long_name.trim().toUpperCase();
              }
              console.log(`[pathway start] Google geocoded "${address}" → "${resolvedFormattedAddress}", postcode=${finalPostcode}`);
            }
          }
        } catch (err: any) {
          console.warn("[pathway start] Google geocoding failed (non-fatal):", err?.message);
        }
      }

      // PropertyData UPRN lookup — requires postcode
      const pdKey = process.env.PROPERTYDATA_API_KEY;
      if (pdKey && finalPostcode) {
        try {
          const streetPart = address.split(",")[0].trim();
          const uprnUrl = `https://api.propertydata.co.uk/address-match-uprn?key=${pdKey}&address=${encodeURIComponent(streetPart)}&postcode=${encodeURIComponent(finalPostcode)}`;
          const uprnRes = await fetch(uprnUrl, { signal: AbortSignal.timeout(8000) });
          if (uprnRes.ok) {
            const uprnData: any = await uprnRes.json();
            const match = uprnData?.data?.[0] || uprnData?.results?.[0] || uprnData?.data;
            if (match?.uprn || uprnData?.uprn) {
              resolvedUprn = String(match?.uprn || uprnData?.uprn);
              console.log(`[pathway start] PropertyData UPRN for "${address}" = ${resolvedUprn}`);
            }
          }
        } catch (err: any) {
          console.warn("[pathway start] PropertyData UPRN lookup failed (non-fatal):", err?.message);
        }
      }

      const [run] = await db
        .insert(propertyPathwayRuns)
        .values({
          address: resolvedFormattedAddress || address,
          postcode: finalPostcode || null,
          formattedAddress: resolvedFormattedAddress,
          uprn: resolvedUprn,
          lat: resolvedLat,
          lng: resolvedLng,
          propertyId: propertyId || null,
          currentStage: 1,
          stageStatus: {},
          stageResults: {},
          startedBy: userId,
        })
        .returning();
      res.json({ success: true, run, existing: false });
    } catch (err: any) {
      console.error("[pathway start] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to start pathway" });
    }
  });

  // Delete a pathway run (removes the row — SharePoint folder + CRM records untouched)
  app.delete("/api/property-pathway/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const deleted = await db.delete(propertyPathwayRuns).where(eq(propertyPathwayRuns.id, runId)).returning();
      if (!deleted.length) return res.status(404).json({ error: "Run not found" });
      res.json({ success: true });
    } catch (err: any) {
      console.error("[pathway delete] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to delete pathway" });
    }
  });

  // Advance to / run a specific stage
  app.post("/api/property-pathway/:runId/advance", requireAuth, async (req: Request, res: Response) => {
    const runId = String(req.params.runId);
    try {
      const { stage, async: asyncMode } = req.body as { stage?: number; async?: boolean };
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const targetStage = stage ?? run.currentStage;

      // Back-fill startedBy if null — older runs were created before startedBy
      // was reliably set, and downstream writes (Stage 1 LR history, Stage 4
      // Clouseau userId) silently skip without it. Grab the current session
      // user on first advance and persist so every subsequent re-run sees it.
      if (!(run as any).startedBy) {
        const sessUser = (req as any).session?.userId || (req as any).tokenUserId || null;
        if (sessUser) {
          await db
            .update(propertyPathwayRuns)
            .set({ startedBy: sessUser })
            .where(eq(propertyPathwayRuns.id, runId));
          (run as any).startedBy = sessUser;
          console.log(`[pathway advance] back-filled startedBy=${sessUser} on run ${runId}`);
        }
      }

      // Async mode: kick off stage in background, return immediately.
      // Client polls /api/property-pathway/:runId to watch for completion.
      // Avoids Railway's 45s edge timeout for heavy stages.
      if (asyncMode || targetStage === 1) {
        runStage(runId, targetStage, req).catch((err: any) => {
          console.error(`[pathway advance async] stage ${targetStage} error:`, err?.message);
        });
        return res.status(202).json({ success: true, async: true, runId, targetStage });
      }

      const updated = await runStage(runId, targetStage, req);
      if (res.headersSent) return; // guard against edge-timed-out responses
      res.json({ success: true, run: updated });
    } catch (err: any) {
      console.error("[pathway advance] error:", err?.message, err?.stack);
      if (res.headersSent) return;
      const currentRun = await getRun(runId).catch(() => null);
      res.status(500).json({
        error: err?.message || "Failed to advance pathway",
        run: currentRun,
      });
    }
  });

  // Fetch current state of a run
  app.get("/api/property-pathway/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      res.json(run);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Latest pathway run for a property id or address — used by property/deal detail
  // pages to show an intelligence summary without re-running paid lookups.
  app.get("/api/property-pathway/latest", requireAuth, async (req: Request, res: Response) => {
    try {
      const propertyId = (req.query.propertyId as string) || "";
      const address = ((req.query.address as string) || "").trim().toLowerCase();
      const postcode = ((req.query.postcode as string) || "").toUpperCase().replace(/\s/g, "");
      if (!propertyId && !address && !postcode) {
        return res.status(400).json({ error: "propertyId, address or postcode required" });
      }
      const recent = await db
        .select()
        .from(propertyPathwayRuns)
        .orderBy(desc(propertyPathwayRuns.updatedAt))
        .limit(300);
      const match = recent.find((r: any) => {
        if (propertyId && r.propertyId === propertyId) return true;
        if (postcode) {
          const rp = (r.postcode || "").toUpperCase().replace(/\s/g, "");
          if (rp && rp === postcode) return true;
        }
        if (address) {
          const ra = (r.address || "").toLowerCase();
          if (ra && (ra.includes(address) || address.includes(ra))) return true;
        }
        return false;
      });
      if (!match) return res.json(null);
      res.json(match);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // List recent pathway runs
  app.get("/api/property-pathway", requireAuth, async (_req: Request, res: Response) => {
    try {
      const runs = await db
        .select()
        .from(propertyPathwayRuns)
        .orderBy(desc(propertyPathwayRuns.updatedAt))
        .limit(50);
      res.json(runs);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // ─── Retail leasing comps (curated, separate from CRM) ──────────────────
  // List comps, optionally filtered by postcode / outward code. Used by the
  // Comps card on the pathway and by the admin review screen.
  app.get("/api/retail-comps", requireAuth, async (req: Request, res: Response) => {
    try {
      const postcode = String(req.query.postcode || "").trim();
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      if (postcode) {
        const { findNearbyComps } = await import("./retail-comps-extractor");
        const rows = await findNearbyComps(postcode, limit);
        return res.json(rows);
      }
      const { rows } = await pool.query(
        `SELECT * FROM retail_leasing_comps
           ORDER BY COALESCE(lease_date, source_date) DESC NULLS LAST, created_at DESC
           LIMIT $1`,
        [limit],
      );
      res.json(rows);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Delete a curated retail comp (reviewer thinks it's bogus).
  app.delete("/api/retail-comps/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      await pool.query(`DELETE FROM retail_leasing_comps WHERE id = $1`, [req.params.id]);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Proxy planning PDFs through ScraperAPI. Idox (Westminster especially)
  // can block direct browser downloads by IP, referer or session — and the
  // raw URL often returns an HTML viewer rather than the PDF bytes. Running
  // the download through our residential-proxy path gets the actual PDF back
  // to the user's browser reliably.
  app.get("/api/planning-docs/download", requireAuth, async (req: Request, res: Response) => {
    const url = String(req.query.url || "");
    const referer = String(req.query.referer || "");
    if (!/^https?:\/\//i.test(url)) return res.status(400).send("invalid url");
    try {
      const { downloadPlanningPdf, getPlanningDownloadLastError } = await import("./planning-docs");
      const buf = await downloadPlanningPdf(url, referer || undefined);
      if (!buf) {
        const detail = getPlanningDownloadLastError();
        console.warn(`[planning-docs/download] all strategies failed for ${url}: ${detail}`);
        // Opening this endpoint as a direct link (target="_blank") means the
        // browser will render whatever we return. A JSON 502 shows as a blank
        // page. Return a small HTML error page with a clickable link to the
        // original LPA URL so the user can try it in their own browser
        // session.
        const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
        res.status(200).setHeader("Content-Type", "text/html; charset=utf-8").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Planning PDF — download failed</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif; max-width: 620px; margin: 60px auto; padding: 0 24px; color: #1a1a1a; line-height: 1.5; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .sub { color: #666; font-size: 14px; margin: 0 0 24px; }
  .card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 16px; background: #fafafa; }
  code { font-size: 12px; background: #f0f0f0; padding: 2px 6px; border-radius: 3px; word-break: break-all; }
  a.btn { display: inline-block; background: #000; color: #fff; text-decoration: none; padding: 10px 20px; border-radius: 6px; font-weight: 500; margin-top: 8px; }
  a.btn:hover { background: #333; }
  .detail { font-size: 12px; color: #999; margin-top: 16px; font-family: monospace; }
</style></head>
<body>
  <h1>Couldn't download this planning PDF</h1>
  <p class="sub">The LPA portal blocked all four proxy strategies we tried. Try the link below to open it directly in this browser session — LPA portals often only serve PDFs to the same session that browsed to the document list.</p>
  <div class="card">
    <a class="btn" href="${escHtml(url)}" target="_blank" rel="noopener">Open directly on LPA site ↗</a>
    <p style="font-size: 12px; color: #666; margin: 12px 0 0;">Source URL:<br/><code>${escHtml(url)}</code></p>
  </div>
  <p class="detail">Last strategy error: ${escHtml(detail || "unknown")}<br/>Strategies tried: no-render, render, premium, premium+render</p>
</body></html>`);
        return;
      }
      const filename = (url.split("/").pop() || "plan.pdf").split("?")[0].replace(/[^a-zA-Z0-9._-]/g, "_");
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `inline; filename="${filename.endsWith(".pdf") ? filename : filename + ".pdf"}"`);
      res.setHeader("Cache-Control", "private, max-age=86400");
      res.send(buf);
    } catch (err: any) {
      res.status(500).send(`Download failed: ${err?.message || "unknown error"}`);
    }
  });

  // ============================================================================
  // MARKET INTEL — on-demand web crawl for comps, availability, leasing history
  // ============================================================================

  // ─── Stage 8 image access (pathway-scoped, no admin required) ────────────
  // The main /api/image-studio endpoints require admin. To surface Stage 8
  // thumbnails + full images on the pathway board without giving every
  // authenticated user admin, we expose them scoped to a specific runId —
  // you can only fetch images that are actually referenced by that run.
  app.get("/api/property-pathway/:runId/image/:imageId", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      const stage8 = (run.stageResults as StageResults)?.stage8;
      const allowedIds = new Set<string>([
        stage8?.streetViewImageId,
        stage8?.retailContextImageId,
        ...(stage8?.additionalImageIds || []),
      ].filter(Boolean) as string[]);
      // Also allow any image currently sitting in this run's stage8 collections.
      if (stage8?.collections?.length) {
        const collIds = stage8.collections.map((c) => c.id);
        const { rows } = await pool.query(
          `SELECT image_id FROM image_studio_collection_images WHERE collection_id = ANY($1::varchar[])`,
          [collIds],
        );
        for (const r of rows) allowedIds.add(r.image_id);
      }
      const imageId = String(req.params.imageId);
      if (!allowedIds.has(imageId)) return res.status(403).json({ error: "Image not in this run" });

      const [image] = await db
        .select()
        .from(imageStudioImages)
        .where(eq(imageStudioImages.id, imageId));
      if (!image) return res.status(404).json({ error: "Image not found" });

      const thumbOnly = req.query.thumb === "1";
      if (thumbOnly && image.thumbnailData) {
        // Stored as either raw base64 or a full data URL; handle both.
        const raw = String(image.thumbnailData);
        const b64 = raw.startsWith("data:") ? raw.split(",")[1] : raw;
        const buf = Buffer.from(b64, "base64");
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "private, max-age=86400");
        return res.send(buf);
      }
      if (image.localPath && fs.existsSync(image.localPath)) {
        res.setHeader("Content-Type", image.mimeType || "image/png");
        res.setHeader("Cache-Control", "private, max-age=86400");
        return res.sendFile(image.localPath);
      }
      // Fall back to the thumbnail if the full file has been evicted.
      if (image.thumbnailData) {
        const raw = String(image.thumbnailData);
        const b64 = raw.startsWith("data:") ? raw.split(",")[1] : raw;
        const buf = Buffer.from(b64, "base64");
        res.setHeader("Content-Type", "image/jpeg");
        return res.send(buf);
      }
      return res.status(404).json({ error: "Image file missing on disk" });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Override area + passing rent for the Excel model and regenerate. The
  // only two inputs that really matter for initial yield — we never want
  // the model falling back to 5,000 sq ft / £500k silently.
  app.post("/api/property-pathway/:runId/stage7/override", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      const { totalAreaSqFt, currentRentPA, regenerate } = req.body || {};
      const sr = (run.stageResults as StageResults) || {};
      const stage7 = { ...(sr.stage7 || {}) };
      if (typeof totalAreaSqFt === "number" && totalAreaSqFt > 0) stage7.overrideTotalAreaSqFt = Math.round(totalAreaSqFt);
      if (totalAreaSqFt === null) delete stage7.overrideTotalAreaSqFt;
      if (typeof currentRentPA === "number" && currentRentPA > 0) stage7.overrideCurrentRentPA = Math.round(currentRentPA);
      if (currentRentPA === null) delete stage7.overrideCurrentRentPA;
      await updateRun(run.id, { stageResults: { ...sr, stage7 } });
      if (regenerate) {
        runStage(run.id, 7, req).catch((err: any) => {
          console.error(`[pathway stage7 regenerate] error:`, err?.message);
        });
        return res.status(202).json({ success: true, async: true });
      }
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Manual re-render / re-sweep of Stage 8 (when it returned empty). Useful
  // while iterating and after config changes (GOOGLE_API_KEY rotation etc).
  app.post("/api/property-pathway/:runId/stage8/retry", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      runStage(run.id, 8, req).catch((err: any) => {
        console.error(`[pathway stage8 retry] error:`, err?.message);
      });
      res.status(202).json({ success: true, async: true });
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });

  // Generate a Gamma-powered Why Buy (parallel to the pdfkit renderer).
  // Returns 202 immediately; client polls the run record for stage9.gamma.* fields.
  app.post("/api/property-pathway/:runId/why-buy-gamma/generate", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });
      if (!process.env.GAMMA_API_KEY) return res.status(400).json({ error: "GAMMA_API_KEY not configured" });

      const exportAs = (req.body?.exportAs === "pptx" ? "pptx" : "pdf") as "pdf" | "pptx";
      const themeName: string | undefined = req.body?.themeName;

      // Mark stage9.gamma as running
      const sr = (run.stageResults as StageResults) || {};
      const stage9 = { ...((sr as any).stage9 || {}) };
      stage9.gamma = { status: "running", startedAt: new Date().toISOString(), exportAs };
      await updateRun(run.id, { stageResults: { ...sr, stage9 } as any });

      (async () => {
        try {
          const { renderWhyBuyGamma } = await import("./why-buy-gamma");
          const result = await renderWhyBuyGamma({ runId: run.id, exportAs, themeName });
          const latest = await getRun(run.id);
          const lsr = (latest?.stageResults as any) || {};
          const lstage9 = { ...(lsr.stage9 || {}) };
          lstage9.gamma = {
            status: "completed",
            completedAt: new Date().toISOString(),
            exportAs,
            documentUrl: result.documentUrl,
            sharepointUrl: result.sharepointUrl,
            gammaUrl: result.gammaUrl,
            generationId: result.generationId,
            imageStudioId: result.imageStudioId,
          };
          await updateRun(run.id, { stageResults: { ...lsr, stage9: lstage9 } });
        } catch (err: any) {
          console.error("[why-buy-gamma] error:", err?.message);
          const latest = await getRun(run.id);
          const lsr = (latest?.stageResults as any) || {};
          const lstage9 = { ...(lsr.stage9 || {}) };
          lstage9.gamma = { status: "failed", error: err?.message || String(err), exportAs };
          await updateRun(run.id, { stageResults: { ...lsr, stage9: lstage9 } });
        }
      })();

      res.status(202).json({ success: true, async: true });
    } catch (err: any) {
      console.error("[why-buy-gamma route] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to start Gamma render" });
    }
  });

  app.post("/api/property-pathway/:runId/market-intel", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });

      const intel = await runMarketIntelCrawl(run.address, run.postcode || "");
      if (!intel) {
        return res.status(503).json({ error: "All search providers failed. Check PERPLEXITY_API_KEY and EXA_API_KEY." });
      }

      const stageResults = { ...((run.stageResults as StageResults) || {}), marketIntel: intel };
      const updated = await updateRun(run.id, { stageResults });
      return res.json({ success: true, marketIntel: intel, run: updated });
    } catch (err: any) {
      console.error("[market-intel]", err?.message || err);
      return res.status(500).json({ error: err?.message || "Market intel failed" });
    }
  });


  // Stage 6 — apply a patch to the draft business plan (from UI or from ChatBGP tools)
  app.post("/api/property-pathway/:runId/business-plan/patch", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const { patch, source, note } = req.body || {};
      if (!patch || typeof patch !== "object") return res.status(400).json({ error: "patch (object) required" });

      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });

      const sr = (run.stageResults as StageResults) || {};
      const stage6 = sr.stage6 || {};
      const base = stage6.agreed ? { ...stage6.agreed } : { ...(stage6.draft || {}) };
      const merged: BusinessPlan = { ...base, ...patch };
      const revisions = [
        ...(stage6.revisions || []),
        { at: new Date().toISOString(), source: (source === "chat" ? "chat" : "ui") as "chat" | "ui", patch, note },
      ].slice(-50);

      // If already agreed, the patch bumps the agreed version. Otherwise it updates the draft.
      const nextStage6 = stage6.agreed
        ? { ...stage6, agreed: merged, revisions }
        : { ...stage6, draft: merged, revisions };

      const updated = await updateRun(runId, {
        stageResults: { ...sr, stage6: nextStage6 },
      });
      res.json({ ok: true, stage6: (updated.stageResults as StageResults).stage6 });
    } catch (err: any) {
      console.error("[business-plan/patch] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // Stage 6 — Agree the business plan (single-user gate). Locks stage6.agreed
  // and moves currentStage to 7.
  app.post("/api/property-pathway/:runId/business-plan/agree", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const sr = (run.stageResults as StageResults) || {};
      const stage6 = sr.stage6 || {};
      if (!stage6.draft) return res.status(400).json({ error: "No draft to agree. Run Stage 6 first." });

      const agreed: BusinessPlan = { ...(stage6.draft) };
      const user = (req as any).user;
      const agreedBy = user?.username || user?.email || "unknown";
      const nextStage6 = {
        ...stage6,
        agreed,
        agreedAt: new Date().toISOString(),
        agreedBy,
      };
      const nextStatus = { ...(run.stageStatus as StageStatusMap), stage6: "completed" as StageStatus };
      await updateRun(runId, {
        stageResults: { ...sr, stage6: nextStage6 },
        stageStatus: nextStatus,
        currentStage: Math.max(run.currentStage, 7),
      });
      res.json({ ok: true, stage6: nextStage6 });
    } catch (err: any) {
      console.error("[business-plan/agree] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // Stage 7 — Agree the Excel model (locks model version, moves to Stage 8).
  app.post("/api/property-pathway/:runId/excel-model/agree", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const { modelVersionId } = req.body || {};
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const sr = (run.stageResults as StageResults) || {};
      const stage7 = sr.stage7 || {};
      if (!stage7.modelRunId && !modelVersionId) return res.status(400).json({ error: "No model to agree. Generate the Excel model first." });

      const user = (req as any).user;
      const nextStage7 = {
        ...stage7,
        modelVersionId: modelVersionId || stage7.modelVersionId,
        agreed: true,
        agreedAt: new Date().toISOString(),
        agreedBy: user?.username || user?.email || "unknown",
      };
      const nextStatus = { ...(run.stageStatus as StageStatusMap), stage7: "completed" as StageStatus };
      await updateRun(runId, {
        stageResults: { ...sr, stage7: nextStage7 },
        stageStatus: nextStatus,
        currentStage: Math.max(run.currentStage, 8),
      });
      res.json({ ok: true, stage7: nextStage7 });
    } catch (err: any) {
      console.error("[excel-model/agree] error:", err?.message);
      res.status(500).json({ error: err?.message });
    }
  });

  // Patch run (for manually setting tenant, propertyId, etc.)
  app.patch("/api/property-pathway/:runId", requireAuth, async (req: Request, res: Response) => {
    try {
      const runId = String(req.params.runId);
      const allowed = ["propertyId", "stageResults", "modelRunId"] as const;
      const patch: any = {};
      for (const key of allowed) {
        if (req.body[key] !== undefined) patch[key] = req.body[key];
      }
      const updated = await updateRun(runId, patch);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err?.message });
    }
  });
}
