// Data-room enrichment pipeline (Push 2).
//
// For each classified file persisted in data_room_files we:
//   1. Run a specialist analyser based on its primary_type (lease terms,
//      rent roll structured extract, financial model assumptions, pub
//      trade accounts benchmarks, title register parse, premises licence).
//   2. Enrich every extracted entity against live data sources:
//        - Companies House (tenant / landlord / operator company status)
//        - VOA (rateable value for the property)
//        - PropertyData /uprn-title (Land Registry proprietor — is the
//          named landlord actually the registered proprietor?)
//        - FSA Food Hygiene (per pub — critical vacancy / operational signal)
//        - Perplexity web search (recent news / insolvency / distress)
//   3. Write the result to data_room_files.enrichment JSONB.
//
// All of this runs via a queued orchestrator with a modest concurrency
// limit so a 300-pub data room completes in minutes instead of hours
// without hammering any single upstream API.

import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";
import { chFetch } from "./companies-house";
import { osPlacesFind, osPlacesByPostcode } from "./os-data";
import { askPerplexity } from "./perplexity";

function getAnthropicClient() {
  return new Anthropic({
    apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY,
    ...(process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY && process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL
      ? { baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL }
      : {}),
  });
}

// ─── Specialist analysers ──────────────────────────────────────────────

async function runSpecialist(anthropic: Anthropic, system: string, fileName: string, text: string): Promise<any | null> {
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      system,
      messages: [{ role: "user", content: `File: ${fileName}\n\n${text.slice(0, 20000)}` }],
    });
    const raw = resp.content[0]?.type === "text" ? resp.content[0].text : "{}";
    const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    return JSON.parse(cleaned);
  } catch (err: any) {
    console.warn(`[data-room-enrich] specialist failed for ${fileName}:`, err?.message);
    return null;
  }
}

const LEASE_PROMPT = `Extract the commercial lease terms from this document. Return JSON:
{
  "tenant": "string",
  "landlord": "string",
  "guarantor": "string | null",
  "demise": "short property description",
  "termStart": "ISO date or free text",
  "termEnd": "ISO date or free text",
  "termYears": "number | null",
  "passingRent": "number (£ per annum)",
  "breakDates": ["ISO dates"],
  "breakType": "tenant-only | landlord-only | mutual | null",
  "rentReview": "review frequency and basis (e.g. '5-yearly upward-only to open market')",
  "permittedUse": "string",
  "repairStandard": "FRI | IRI | partial | none | unknown",
  "alienation": "string — assignment / subletting terms",
  "serviceCharge": "string | null",
  "insurance": "landlord | tenant | shared | unknown",
  "flags": [{"severity":"red|amber|green","title":"","detail":""}]
}
Return ONLY valid JSON. Use null for unknown fields, not empty strings.`;

const RENT_ROLL_PROMPT = `This document is a tenancy schedule / rent roll. Extract rows as JSON:
{
  "rows": [{
    "unit": "string",
    "tenant": "string",
    "passingRent": "number (£pa)",
    "areaSqFt": "number | null",
    "rentPsfPa": "number | null",
    "leaseStart": "ISO date or null",
    "leaseEnd": "ISO date or null",
    "breakDate": "ISO date or null",
    "reviewDate": "ISO date or null",
    "tenure": "let|managed|tied|free-of-tie|unknown"
  }],
  "totalPassingRent": "number",
  "unitCount": "number",
  "waultYears": "number | null (weighted average unexpired lease term from today)",
  "topTenantName": "string | null",
  "topTenantSharePercent": "number | null"
}
Return ONLY valid JSON. If you cannot parse a value, use null. Numbers with no currency symbols or commas.`;

const MODEL_PROMPT = `This document is a financial / underwriting model for a UK commercial property deal. Extract the headline assumptions as JSON:
{
  "exitYieldPercent": "number | null",
  "entryYieldPercent": "number | null",
  "purchasePrice": "number | null",
  "yearOneIncome": "number | null",
  "rentalGrowthPercent": "number | null",
  "voidAssumptionMonths": "number | null",
  "targetIrrPercent": "number | null",
  "targetEquityMultiple": "number | null",
  "holdPeriodYears": "number | null",
  "capexAllowance": "number | null",
  "debtLtvPercent": "number | null",
  "debtInterestPercent": "number | null",
  "notes": "one-line observation on whether assumptions look aggressive / conservative / standard"
}
Return ONLY valid JSON. Use null for anything not found.`;

const TRADE_ACCOUNTS_PROMPT = `This document contains operating/trading accounts for a UK pub (P&L, management accounts, FMT assessment, BDM report). Extract:
{
  "pubName": "string",
  "period": "e.g. FY24, YTD Mar-25",
  "wetSales": "number",
  "drySales": "number",
  "accommodationSales": "number | null",
  "gamingIncome": "number | null",
  "totalRevenue": "number",
  "gpPercent": "number",
  "labourPercent": "number",
  "utilitiesPercent": "number",
  "ebitda": "number",
  "ebitdar": "number",
  "fmtEstimate": "number | null",
  "awtWeekly": "number | null (average weekly takings)",
  "barrelage": "number | null",
  "tenure": "managed | tied | free-of-tie | let | unknown",
  "flags": [{"severity":"red|amber|green","title":"","detail":""}]
}
Traffic light guide: flag wet:dry ratio <50% red for wet-led pub; flag GP% <55% for food-led red; flag labour >32% red; flag positive trends green.
Return ONLY valid JSON.`;

const TITLE_REGISTER_PROMPT = `This is a UK Land Registry Title Register (official copy). Extract:
{
  "titleNumber": "string",
  "tenure": "Freehold | Leasehold",
  "property": "property description from the register",
  "proprietors": [{"name":"string","address":"string | null"}],
  "charges": [{"dateRegistered":"date","in favour of":"string","summary":"string"}],
  "restrictions": ["verbatim restriction text"],
  "notices": ["any notices on the register"],
  "pricePaid": "number | null",
  "datePurchased": "ISO date | null"
}
Return ONLY valid JSON.`;

const PREMISES_LICENCE_PROMPT = `This is a UK Premises Licence (Licensing Act 2003). Extract:
{
  "licenceNumber": "string | null",
  "premisesName": "string",
  "premisesAddress": "string",
  "licenceHolder": "string",
  "dps": "string | null (Designated Premises Supervisor)",
  "grantedDate": "ISO date | null",
  "licensableActivities": ["alcohol on-sales","late-night refreshment","regulated entertainment","etc"],
  "hoursByActivity": [{"activity":"string","mon_thu":"","fri":"","sat":"","sun":""}],
  "conditions": ["verbatim licence condition text"],
  "flags": [{"severity":"red|amber|green","title":"","detail":""}]
}
Flag RED if there are recent reviews, unusual restrictions, or short opening hours (< 10pm close for a city pub).
Return ONLY valid JSON.`;

// ─── Enrichment helpers ────────────────────────────────────────────────

// CH name search — the existing codebase does this inline. Wrap it once.
interface CompaniesHouseMatch {
  number: string;
  name: string;
  status: string;
  kind?: string;
  address?: string;
  lastAccountsDate?: string;
  sicCodes?: string[];
}

async function searchCompaniesHouseByName(name: string): Promise<CompaniesHouseMatch | null> {
  if (!name || name.length < 3) return null;
  try {
    const q = encodeURIComponent(name);
    const results = await chFetch(`/search/companies?q=${q}&items_per_page=3`);
    const top = results?.items?.[0];
    if (!top) return null;
    // Fetch full profile for status + SIC
    let profile: any = null;
    try { profile = await chFetch(`/company/${top.company_number}`); } catch {}
    return {
      number: top.company_number,
      name: top.title || profile?.company_name || name,
      status: profile?.company_status || top.company_status || "unknown",
      kind: profile?.type || top.company_type,
      address: typeof top.address_snippet === "string" ? top.address_snippet : (profile?.registered_office_address ? `${profile.registered_office_address.address_line_1 || ""}, ${profile.registered_office_address.postal_code || ""}`.trim() : undefined),
      lastAccountsDate: profile?.accounts?.last_accounts?.made_up_to || undefined,
      sicCodes: profile?.sic_codes || [],
    };
  } catch (err: any) {
    console.warn(`[data-room-enrich] CH search failed for "${name}":`, err?.message);
    return null;
  }
}

// VOA lookup by postcode outward code (reads our local voa_ratings table).
async function lookupVoaByPostcode(postcode: string): Promise<any[]> {
  if (!postcode) return [];
  const clean = postcode.replace(/\s+/g, "").toUpperCase();
  try {
    const r = await pool.query(
      `SELECT firm_name, full_address, rateable_value, description, ba_code, effective_date
       FROM voa_ratings
       WHERE REPLACE(UPPER(postcode), ' ', '') = $1
       LIMIT 30`,
      [clean]
    );
    return r.rows;
  } catch { return []; }
}

// Find the VOA row that best matches a free-text address.
async function lookupVoaByAddress(address: string, postcode: string): Promise<any | null> {
  const rows = await lookupVoaByPostcode(postcode);
  if (rows.length === 0) return null;
  const lc = address.toLowerCase();
  // Prefer a row whose full_address contains a number from the input.
  const numMatch = lc.match(/\b(\d{1,4}[a-z]?(?:\s*-\s*\d{1,4}[a-z]?)?)\b/);
  const num = numMatch ? numMatch[1].replace(/\s*-\s*/g, "-") : null;
  if (num) {
    const exact = rows.find(r => (r.full_address || "").toLowerCase().includes(num));
    if (exact) return exact;
  }
  // Fallback: highest-RV row in the postcode (usually the dominant unit).
  rows.sort((a, b) => (b.rateable_value || 0) - (a.rateable_value || 0));
  return rows[0] || null;
}

// PropertyData uprn-title — authoritative Land Registry proprietor from a UPRN.
async function lookupPropertyDataUprnTitle(uprn: string): Promise<any | null> {
  const key = process.env.PROPERTYDATA_API_KEY;
  if (!key || !uprn) return null;
  try {
    const url = `https://api.propertydata.co.uk/uprn-title?key=${key}&uprn=${encodeURIComponent(uprn)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) return null;
    const data = await r.json();
    return data?.data ?? data;
  } catch { return null; }
}

// FSA Food Hygiene — free API. Match an establishment by address + postcode.
async function lookupFsaHygiene(address: string, postcode: string): Promise<any | null> {
  if (!address || !postcode) return null;
  try {
    const clean = postcode.replace(/\s+/g, "%20");
    const url = `https://api.ratings.food.gov.uk/Establishments?address=${encodeURIComponent(address)}&postalCode=${clean}&pageNumber=1&pageSize=5`;
    const r = await fetch(url, {
      headers: { "x-api-version": "2", Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const data = await r.json();
    const top = data?.establishments?.[0];
    if (!top) return null;
    return {
      name: top.BusinessName,
      address: [top.AddressLine1, top.AddressLine2, top.AddressLine3].filter(Boolean).join(", "),
      rating: top.RatingValue,          // "5", "4", ..., "0", "Exempt", "Awaiting Inspection"
      ratingDate: top.RatingDate,
      scores: top.scores,
      businessType: top.BusinessType,
      fsaId: top.FHRSID,
    };
  } catch (err: any) {
    console.warn(`[data-room-enrich] FSA lookup failed:`, err?.message);
    return null;
  }
}

// Web-search a named counterparty for recent news — distress, administration,
// rebrand, etc. Uses the existing Perplexity wrapper so we share rate limits
// and cost monitoring.
async function webSearchParty(name: string, context: string): Promise<{ summary: string; citations: any[] } | null> {
  if (!name || name.length < 3) return null;
  try {
    const resp = await askPerplexity(
      `Any recent news about "${name}" (UK ${context}) in the last 12 months? Focus on: administration, insolvency, restructuring, rebrand, acquisition, major closures, material litigation. 2-3 sentence summary with dates. If nothing material, say "no material news found".`,
      { maxTokens: 400 }
    );
    return { summary: resp.answer, citations: resp.citations || [] };
  } catch (err: any) {
    console.warn(`[data-room-enrich] web search failed for ${name}:`, err?.message);
    return null;
  }
}

// ─── Orchestrator ──────────────────────────────────────────────────────

export interface FileEnrichment {
  status: "pending" | "running" | "done" | "error";
  startedAt?: string;
  completedAt?: string;
  error?: string;
  specialist?: any | null;
  enrichment?: {
    landlord?: CompaniesHouseMatch | null;
    tenant?: CompaniesHouseMatch | null;
    voa?: any | null;
    landRegistry?: any | null;
    uprn?: string | null;
    fsaHygiene?: any | null;
    partyWebSearch?: Record<string, { summary: string; citations: any[] } | null>;
  };
}

function extractPostcode(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = s.match(/\b([A-Z]{1,2}[0-9][A-Z0-9]?)\s*([0-9][A-Z]{2})\b/i);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

async function enrichOneFile(fileRow: any): Promise<FileEnrichment> {
  const started = new Date().toISOString();
  const anthropic = getAnthropicClient();
  const classification = fileRow.classification || {};
  const primaryType = fileRow.primary_type || classification.primaryType || "Other";
  const text = fileRow.extracted_text || "";

  let specialist: any = null;
  try {
    if (primaryType === "Lease" || primaryType === "Licence" || primaryType === "Tied Lease") {
      specialist = await runSpecialist(anthropic, LEASE_PROMPT, fileRow.file_name, text);
    } else if (primaryType === "Rent Roll") {
      specialist = await runSpecialist(anthropic, RENT_ROLL_PROMPT, fileRow.file_name, text);
    } else if (primaryType === "Financial Model") {
      specialist = await runSpecialist(anthropic, MODEL_PROMPT, fileRow.file_name, text);
    } else if (primaryType === "Trade Accounts" || primaryType === "Management Accounts" || primaryType === "BDM Report") {
      specialist = await runSpecialist(anthropic, TRADE_ACCOUNTS_PROMPT, fileRow.file_name, text);
    } else if (primaryType === "Title Register") {
      specialist = await runSpecialist(anthropic, TITLE_REGISTER_PROMPT, fileRow.file_name, text);
    } else if (primaryType === "Premises Licence") {
      specialist = await runSpecialist(anthropic, PREMISES_LICENCE_PROMPT, fileRow.file_name, text);
    }
  } catch (err: any) {
    console.warn(`[data-room-enrich] specialist threw:`, err?.message);
  }

  // Entities to enrich come from whichever source has them.
  const address = (specialist?.demise || specialist?.property || specialist?.premisesAddress || classification.propertyAddress || "").trim();
  const tenantName = (specialist?.tenant || classification.tenantName || "").trim();
  const landlordName = (specialist?.landlord || specialist?.licenceHolder || classification.landlordName || "").trim();
  const postcode = extractPostcode(address) || extractPostcode(classification.propertyAddress);

  // Enrich in parallel — these all use different upstreams.
  const [tenantCh, landlordCh, voaRow, fsaRow, placesLookup] = await Promise.all([
    tenantName ? searchCompaniesHouseByName(tenantName) : Promise.resolve(null),
    landlordName ? searchCompaniesHouseByName(landlordName) : Promise.resolve(null),
    postcode && address ? lookupVoaByAddress(address, postcode) : Promise.resolve(null),
    postcode && address ? lookupFsaHygiene(address, postcode) : Promise.resolve(null),
    address ? osPlacesFind(address, 1).catch(() => []) : Promise.resolve([]),
  ]);

  const uprn = placesLookup?.[0]?.uprn || null;
  const landRegistry = uprn ? await lookupPropertyDataUprnTitle(uprn) : null;

  // Web search for material counterparty news — only if CH reported active.
  const partyWebSearch: Record<string, any> = {};
  if (tenantCh?.status === "active" && tenantName) {
    partyWebSearch[tenantName] = await webSearchParty(tenantName, primaryType === "Premises Licence" || primaryType === "Trade Accounts" ? "pub operator" : "commercial property tenant");
  }
  if (landlordCh?.status === "active" && landlordName) {
    partyWebSearch[landlordName] = await webSearchParty(landlordName, "property investor / landlord");
  }

  return {
    status: "done",
    startedAt: started,
    completedAt: new Date().toISOString(),
    specialist,
    enrichment: {
      tenant: tenantCh,
      landlord: landlordCh,
      voa: voaRow,
      landRegistry,
      uprn,
      fsaHygiene: fsaRow,
      partyWebSearch,
    },
  };
}

// Process a data_room_analyses record in-place with bounded concurrency.
// Updates each data_room_files.enrichment column as it completes, so the
// client can poll /api/legal-dd/analyses/:id/files to show live progress.
export async function enrichAnalysis(analysisId: string, opts: { concurrency?: number } = {}): Promise<{ processed: number; errors: number }> {
  const concurrency = Math.max(1, Math.min(8, opts.concurrency ?? 4));
  const r = await pool.query(
    `SELECT id, file_name, display_name, primary_type, classification, extracted_text FROM data_room_files WHERE analysis_id = $1 ORDER BY created_at ASC`,
    [analysisId]
  );
  const files = r.rows;
  let cursor = 0;
  let processed = 0;
  let errors = 0;

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= files.length) return;
      const f = files[idx];
      try {
        await pool.query(
          `UPDATE data_room_files SET enrichment = $1 WHERE id = $2`,
          [JSON.stringify({ status: "running", startedAt: new Date().toISOString() }), f.id]
        );
        const result = await enrichOneFile(f);
        await pool.query(
          `UPDATE data_room_files SET enrichment = $1 WHERE id = $2`,
          [JSON.stringify(result), f.id]
        );
        processed++;
      } catch (err: any) {
        errors++;
        await pool.query(
          `UPDATE data_room_files SET enrichment = $1 WHERE id = $2`,
          [JSON.stringify({ status: "error", error: err?.message || "enrichment failed", completedAt: new Date().toISOString() }), f.id]
        );
      }
    }
  }));

  return { processed, errors };
}
