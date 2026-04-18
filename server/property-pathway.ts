import type { Express, Request, Response } from "express";
import { eq, desc, and, or, ilike } from "drizzle-orm";
import { requireAuth } from "./auth";
import { db } from "./db";
import {
  propertyPathwayRuns,
  crmProperties,
  crmCompanies,
  crmDeals,
  availableUnits,
  investmentComps,
  unitViewings,
  users,
  type PropertyPathwayRun,
} from "@shared/schema";
import { inArray } from "drizzle-orm";
import { performPropertyLookup } from "./property-lookup";
import { executeCreateSharePointFolder, executeUploadFileToSharePoint } from "./utils/sharepoint-operations";
import { askPerplexity } from "./perplexity";
import { callClaude } from "./utils/anthropic-client";

/**
 * Property Pathway Orchestrator
 *
 * Deterministic 7-stage state machine that drives a property investigation
 * end-to-end. Each stage is a discrete function that reads current run state,
 * calls the relevant APIs, writes results back, and advances the stage.
 *
 * Stages:
 *   1. Initial Search — emails, SharePoint, CRM, basic land reg, set up folder tree
 *   2. Brand Intelligence — if tenant is known, enrich the brand
 *   3. Detailed Search Summary — summarise, gate for user confirmation
 *   4. Property Intelligence — full titles, planning (floor plans), proprietor KYC
 *   5. Investigation Board — aggregate view ready
 *   6. Studio Time — Image Studio (street view, retail context plan) + Model Studio seed
 *   7. Why Buy — generate 4-page PE IM document
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

interface StageResults {
  stage1?: {
    emailHits?: Array<{ subject: string; from: string; date: string; msgId: string; mailboxEmail?: string; preview: string; hasAttachments: boolean; webLink?: string | null }>;
    sharepointHits?: Array<{ name: string; path: string; webUrl: string; modifiedAt?: string; sizeMB?: number; type?: string }>;
    brochureFiles?: Array<{ source: "email" | "sharepoint" | "sharepoint-uploaded"; name: string; ref: string; date?: string; webUrl?: string; sizeMB?: number }>;
    crmHits?: { properties: any[]; deals: any[]; companies: any[] };
    deals?: Array<{ id: string; name: string; stage?: string; status?: string; dealType?: string; team?: string[]; rentPa?: number; fee?: number; createdAt?: string }>;
    tenancy?: { occupier?: string; units?: Array<{ id: string; unitName: string; floor?: string; sqft?: number; askingRent?: number; marketingStatus?: string; useClass?: string }>; status?: "vacant" | "let" | "mixed" | "unknown" };
    engagements?: Array<{ source: "unit_viewing" | "investment_viewing" | "interaction"; contact?: string; company?: string; date?: string; outcome?: string; notes?: string; unitName?: string }>;
    pricePaidHistory?: Array<{ address?: string; price?: number; date?: string; type?: string }>;
    comps?: Array<{ address: string; price?: number; yield?: number; date?: string; type?: string }>;
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
  };
  stage2?: {
    companyId?: string;
    enrichedFields?: Record<string, any>;
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
    titleRegisters?: Array<{ titleNumber: string; documentUrl?: string }>;
    planningApplications?: Array<{ reference: string; description: string; status: string; date: string }>;
    floorPlanUrls?: string[];
    proprietorKyc?: any;
  };
  stage5?: {
    ready: boolean;
    boardUrl?: string;
  };
  stage6?: {
    modelRunId?: string;
    streetViewImageId?: string;
    retailContextImageId?: string;
    additionalImageIds?: string[];
  };
  stage7?: {
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

async function setStageStatus(runId: string, stage: keyof StageStatusMap, status: StageStatus, resultsPatch?: Partial<StageResults>): Promise<PropertyPathwayRun> {
  const run = await getRun(runId);
  if (!run) throw new Error(`Pathway run ${runId} not found`);
  const stageStatus = { ...(run.stageStatus as StageStatusMap), [stage]: status };
  const stageResults = { ...(run.stageResults as StageResults), ...(resultsPatch || {}) };
  const stageNumber = parseInt(stage.replace("stage", ""), 10);
  // A skipped stage shouldn't block later stages — advance past it like a completed stage.
  const shouldAdvance = (status === "completed" || status === "skipped") && stageNumber >= run.currentStage;
  const newCurrentStage = shouldAdvance ? Math.min(7, stageNumber + 1) : run.currentStage;
  return updateRun(runId, { stageStatus, stageResults, currentStage: newCurrentStage });
}

// ============================================================================
// STAGE 1 — Initial Search
// ============================================================================

// Helper: best-effort tenant name from whatever data has been collected so far
function derivedTenantForFilter(run: any, aiFacts: any, tenancy: any): string | null {
  const existing = run?.stageResults?.stage1?.tenant?.name;
  if (existing) return existing;
  if (aiFacts?.mainTenants && aiFacts.mainTenants.length > 0) return aiFacts.mainTenants[0];
  if (tenancy?.occupier) return tenancy.occupier;
  return null;
}

async function runStage1(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage1", "running");

  const address = run.address;
  const postcode = run.postcode || "";
  const searchTerms = address.split(/[, ]+/).filter((t) => t.length > 2);

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

  // 1b. Ownership — prefer CRM data if we already have it, fall back to PropertyData freeholds lookup
  let initialOwnership: NonNullable<StageResults["stage1"]>["initialOwnership"] = null;
  const crmMatch = crmHits.properties[0];
  if (crmMatch?.proprietorName || crmMatch?.titleNumber) {
    initialOwnership = {
      titleNumber: crmMatch.titleNumber || "unknown",
      proprietorName: crmMatch.proprietorName || undefined,
      proprietorCategory: crmMatch.proprietorType || undefined,
    };
  }
  // Enrich with PropertyData lookup regardless, in case CRM is incomplete.
  // Also picks up VOA rateable-value entries for rates/business-rates surface.
  let voaEntries: Array<{ firmName?: string; address?: string; postcode?: string; description?: string; rateableValue?: number | null; effectiveDate?: string; }> = [];
  try {
    const lookup = await performPropertyLookup({ address, postcode, layers: ["core"] });
    const freeholds = lookup.propertyDataCoUk?.freeholds?.data || [];
    if (freeholds.length > 0) {
      const best = freeholds[0];
      initialOwnership = {
        titleNumber: best.title_number || best.title || initialOwnership?.titleNumber || "unknown",
        proprietorName: best.proprietor_name_1 || initialOwnership?.proprietorName,
        proprietorCategory: best.proprietor_category || initialOwnership?.proprietorCategory,
        pricePaid: best.price_paid ? Number(best.price_paid) : initialOwnership?.pricePaid,
        dateOfPurchase: best.date_proprietor_added || initialOwnership?.dateOfPurchase,
      };
    }
    if (Array.isArray((lookup as any).voaRatings)) {
      voaEntries = (lookup as any).voaRatings;
    }
  } catch (err: any) {
    console.error("[pathway stage1] Land reg / VOA lookup error:", err?.message);
  }

  // Rates fallback: if performPropertyLookup returned no VOA data but we have
  // a postcode, query the voa_ratings table directly. This handles the case
  // where the lookup helper's street filter was too strict OR street wasn't
  // passed through.
  if (voaEntries.length === 0 && postcode) {
    try {
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
      console.log(`[pathway stage1] VOA direct query for ${formattedPc}: ${voaEntries.length} rows`);
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
    const primaryAddressToken = (address.split(",")[0] || "").trim();
    // Pick distinctive words from the address — >=4 chars, skipping common road/type words and pure numbers.
    const STOPWORDS = new Set(["street", "road", "avenue", "lane", "place", "square", "house", "building", "floor", "suite", "unit", "the", "and"]);
    const distinctiveWords = primaryAddressToken
      .toLowerCase()
      .match(/[a-z]+/g) // letters only — skips pure numbers like "18" and "22"
      ?.filter((w) => w.length >= 4 && !STOPWORDS.has(w))
      || [];
    const searchPhrases: string[] = [];
    // Primary phrase: most distinctive word (often the street/building name).
    // Single-word queries work reliably with $search.
    if (distinctiveWords.length > 0) searchPhrases.push(distinctiveWords[0]);
    // Also try the postcode as a separate query (most specific signal)
    if (postcode) searchPhrases.push(`"${postcode}"`);
    // Fallback
    if (searchPhrases.length === 0) searchPhrases.push(`"${primaryAddressToken || address}"`);

    // Relevance filter — tuned to drop newsletter spam but keep genuine hits.
    // Logic:
    //   1. If subject contains a DIFFERENT UK postcode → drop (clearly another property)
    //   2. Drop known newsletter/marketing senders (Propel, CoStar, Estates Gazette, etc.)
    //   3. Keep if postcode or any distinctive address word appears in subject or preview
    //   4. Drop everything else (Haymarket mention was probably in an attachment or
    //      newsletter body — low signal for investigation purposes)
    const postcodeLc = (postcode || "").toLowerCase().replace(/\s+/g, "");
    const POSTCODE_RE = /\b([a-z]{1,2}\d[a-z\d]?)\s*(\d[a-z]{2})\b/gi;
    const addressWords = primaryAddressToken
      .toLowerCase()
      .match(/[a-z0-9-]+/g)
      ?.filter((w: string) => w.length >= 3 && !["the", "and", "for", "with", "from", "street", "road", "avenue", "lane", "place"].includes(w))
      || [];
    const NEWSLETTER_SENDERS = [
      "propelinfo", "propel", "bigpropfirst", "costar", "estatesgazette", "egi", "react news",
      "propertyweek", "property week", "pie mag", "resi mag", "bisnow", "mailchimp",
      "mailerlite", "substack", "newsletter", "no-reply", "noreply", "do-not-reply",
    ];
    const mentionsAddress = (msg: any) => {
      const subject = String(msg.subject || "").toLowerCase();
      const preview = String(msg.bodyPreview || "").toLowerCase();
      const fromAddr = String(msg.from?.emailAddress?.address || "").toLowerCase();
      const fromName = String(msg.from?.emailAddress?.name || "").toLowerCase();
      const hay = `${subject} ${preview}`;
      const hayNoSpaces = hay.replace(/\s+/g, "");

      // 1) Different postcode in subject → drop
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

      // 3) Postcode in subject or preview → keep (strong signal)
      if (postcodeLc && hayNoSpaces.includes(postcodeLc)) return true;
      // 4) Any distinctive address word in subject or preview → keep
      if (addressWords.some((w) => hay.includes(w))) return true;

      // Otherwise, drop — Graph matched but the word was in an attachment or body (low signal)
      return false;
    };

    const seen = new Set<string>();
    let totalReturnedFromGraph = 0;

    const pushMsg = (msg: any, ownerLabel: string, mailboxEmail?: string) => {
      // Dedupe by internetMessageId (same message across mailboxes) AND also
      // by subject+sender (catches newsletters sent as separate messages to
      // each mailbox, which have different internetMessageIds)
      const primaryKey = msg.internetMessageId || msg.id;
      const subjFromKey = `${String(msg.subject || "").trim().toLowerCase()}|${String(msg.from?.emailAddress?.address || "").trim().toLowerCase()}`;
      if (seen.has(primaryKey) || seen.has(subjFromKey)) return;
      if (!mentionsAddress(msg)) return;
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
          for (const msg of messages) pushMsg(msg, "My inbox");
        } catch (err: any) {
          console.warn(`[pathway stage1] /me/messages search error (${phrase}):`, err?.message);
        }
      }
    }

    // Team mailboxes via app-only token — parallelised to avoid Stage 1 timeout.
    // 30 mailboxes × 2 phrases = 60 requests; sequential would take ~2-3 min.
    // Running them concurrently with Promise.all drops total time to ~5 seconds.
    const errorsByMailbox: Record<string, string> = {};
    const successfulMailboxes = new Set<string>();
    const jobs: Array<Promise<void>> = [];
    for (const mb of mailboxes) {
      for (const phrase of searchPhrases) {
        jobs.push((async () => {
          try {
            const searchRes: any = await graphRequest(
              `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(phrase)}&$top=25&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
              { headers: { "X-AnchorMailbox": mb.email } }
            );
            successfulMailboxes.add(mb.email);
            const messages = searchRes?.value || [];
            totalReturnedFromGraph += messages.length;
            for (const msg of messages) pushMsg(msg, mb.owner, mb.email);
          } catch (err: any) {
            if (!errorsByMailbox[mb.email]) {
              errorsByMailbox[mb.email] = String(err?.message || err).slice(0, 200);
            }
          }
        })());
      }
    }
    await Promise.all(jobs);
    if (Object.keys(errorsByMailbox).length > 0) {
      console.warn(`[pathway stage1] Mailboxes that errored:`, JSON.stringify(errorsByMailbox, null, 2));
    }
    console.log(`[pathway stage1] Email search: delegated=${delegatedToken ? "yes" : "no"}, phrases=${searchPhrases.length}, mailboxes tried=${mailboxes.length}, mailboxes OK=${successfulMailboxes.size} -> ${totalReturnedFromGraph} raw hits, ${emailHits.length} kept after regex filter`);
    emailHits.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    emailHits.splice(200);
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
        const sold: any[] = pd?.data?.transactions || pd?.data || [];
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

  // 1c-5. Investment comps nearby — share the same postcode outward code
  const comps: NonNullable<StageResults["stage1"]>["comps"] = [];
  try {
    const outward = postcode ? postcode.toUpperCase().replace(/\s+/g, "").slice(0, -3) : "";
    if (outward) {
      const { pool } = await import("./db");
      const res = await pool.query(
        `SELECT address, price, cap_rate, transaction_date, subtype
           FROM investment_comps
          WHERE UPPER(REPLACE(COALESCE(postal_code, ''), ' ', '')) LIKE $1
          ORDER BY transaction_date DESC NULLS LAST
          LIMIT 15`,
        [`${outward}%`]
      );
      for (const r of res.rows) {
        comps.push({
          address: r.address,
          price: r.price ? Number(r.price) : undefined,
          yield: r.cap_rate ? Number(r.cap_rate) : undefined,
          date: r.transaction_date,
          type: r.subtype,
        });
      }
    }
  } catch (err: any) {
    console.error("[pathway stage1] investment_comps query error:", err?.message);
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
    for (const e of emailHits) {
      if (!e.hasAttachments) continue;
      // Check email relevance specifically — is this email subject ABOUT our property?
      const subjectLc = String(e.subject || "").toLowerCase();
      const previewLc = String(e.preview || "").toLowerCase();
      const subjAboutProperty =
        (!!pcLc && (subjectLc.replace(/\s+/g, "").includes(pcLc) || previewLc.replace(/\s+/g, "").includes(pcLc))) ||
        propertyDistinctiveWords.some((w: string) => subjectLc.includes(w) || previewLc.includes(w));

      // Require either explicit brochure subject, or email clearly about the property
      if (!BROCHURE_SUBJECT_RE.test(e.subject) && !subjAboutProperty) continue;
      if (!e.mailboxEmail) {
        brochureFiles.push({ source: "email", name: e.subject, ref: e.msgId, date: e.date });
        continue;
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

          // === Confidence gate ===
          // A. Filename explicitly names this property → ALWAYS keep
          const filenameMatchesProperty = propertyDistinctiveWords.some((w: string) => filename.toLowerCase().includes(w));
          // B. Filename names a DIFFERENT known property → drop
          if (!filenameMatchesProperty && filenameLooksLikeDifferentProperty(filename)) continue;

          // C. Fallback: brochure-ish filename AND email specifically about property
          const isPdf = /\.pdf$/i.test(filename) || /application\/pdf/i.test(a.contentType || "");
          const filenameBrochurish = BROCHURE_FILENAME_RE.test(filename);
          if (!filenameMatchesProperty) {
            // Only accept if email was specifically about this property AND file looks brochure-y
            if (!subjAboutProperty) continue;
            if (!isPdf && !filenameBrochurish) continue;
          }

          // Fetch raw bytes
          let fileBuffer: Buffer | null = null;
          try {
            const rawRes: any = await graphRequest(
              `/users/${encodeURIComponent(e.mailboxEmail)}/messages/${e.msgId}/attachments/${a.id}`
            );
            if (rawRes?.contentBytes) {
              fileBuffer = Buffer.from(rawRes.contentBytes, "base64");
            }
          } catch (err: any) {
            console.warn("[pathway stage1] attachment fetch failed:", filename, err?.message);
          }

          // If we have a run folder and bytes, upload to SharePoint
          let savedUrl: string | undefined;
          let sizeMB: number | undefined;
          if (fileBuffer && run.sharepointFolderPath) {
            const brochureFolder = `${run.sharepointFolderPath.replace(/^BGP share drive\//, "")}/Brochure & Marketing`;
            try {
              const up = await executeUploadFileToSharePoint(
                { folderPath: brochureFolder, filename, content: fileBuffer, contentType: a.contentType },
                req
              );
              savedUrl = up.file.webUrl;
              sizeMB = up.file.sizeMB;
            } catch (err: any) {
              console.warn("[pathway stage1] brochure upload failed:", filename, err?.message);
            }
          } else if (fileBuffer) {
            sizeMB = +(fileBuffer.length / 1024 / 1024).toFixed(2);
          }

          brochureFiles.push({
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
      };
      const prompt = `You are BGP's head of investment briefing an analyst. From the Stage 1 intelligence pool below, extract KEY FACTS and write a briefing.

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
    "listedStatus": "Listed building status if mentioned — e.g. 'Grade II listed'. Omit if not in data."
  }
}

Intelligence pool:
${JSON.stringify(briefContext, null, 2).slice(0, 14000)}`;

      // Analyst briefing — what humans read and act on. Use Sonnet for better
      // factual accuracy and synthesis than Haiku. Falls back to Haiku on failure.
      let msg: any;
      try {
        msg = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 1500,
          messages: [{ role: "user", content: prompt }],
        });
      } catch (sErr: any) {
        console.warn(`[pathway stage1] Sonnet briefing failed (${sErr?.message}), falling back to Haiku`);
        msg = await anthropic.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1200,
          messages: [{ role: "user", content: prompt }],
        });
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
          };
        }
      }
    }
  } catch (err: any) {
    console.error("[pathway stage1] AI briefing error:", err?.message);
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

      const emailsForFilter = emailHits.map((e, i) => `E${i}. SUBJ: ${(e.subject || "").slice(0, 180)}\n     FROM: ${(e.from || "").slice(0, 80)}\n     PREV: ${(e.preview || "").slice(0, 180)}`);
      const brochuresForFilter = brochureFiles.map((b, i) => `B${i}. ${b.name}${b.sizeMB ? ` (${b.sizeMB}MB)` : ""} — source: ${b.source}`);
      const sharepointsForFilter = sharepointHits.map((s, i) => `S${i}. ${s.name} — path: ${s.path || "/"}`);

      const filterPrompt = `You are curating intelligence for a property investigation. Be thoughtful — keep items that are PLAUSIBLY about the target building, drop only items that are CLEARLY about a different building or are pure noise.

=== TARGET BUILDING IDENTITY ===
${identity}

=== DISTINGUISHING RULES ===
- "${address.split(",")[0]}" is the street name — many other buildings share it. DROP items that clearly name a DIFFERENT specific building (e.g. "Haymarket House", "Haymarket Towers", "11 Haymarket", "11/12 Haymarket", "52 Haymarket", "1-19 Haymarket Leicester").
- DROP items clearly about a different town/area (Leicester, Soho Square, Edinburgh, Warwick Street, Basingstoke, Chelsea, Islington, Mayfair-but-named-specific-building, Glasshouse, etc.) unless they explicitly tie to our target.
- DROP pure marketing noise: newsletters, market roundups, "What's On" emails, restaurant reservations/receipts, "opening announcements", automated notifications.
- KEEP GENEROUSLY when the email mentions: the owner (by name), the tenant/occupier, the agent handling this instruction, the Companies House number, the title number, the size/specs, or just the address without contradiction.
- KEEP brochures/teasers/particulars/memorandums — any marketing material that could plausibly be for THIS building (leasing brochures count). When in doubt on brochures, KEEP rather than drop; user will review.
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

      // Use Opus for the relevance filter — this decision gates every downstream
      // stage (what emails inform the briefing, which brochures to review, etc).
      // Opus distinguishes "18-22 Haymarket" from "11 Haymarket" and "Haymarket
      // House" reliably. Falls back to Sonnet if Opus is unavailable/rate-limited.
      const FILTER_OPUS = "claude-opus-4-7";
      const FILTER_FALLBACK = "claude-sonnet-4-6";
      let msg: any;
      try {
        msg = await anthropic.messages.create({
          model: FILTER_OPUS,
          max_tokens: 1500,
          messages: [{ role: "user", content: filterPrompt }],
        });
      } catch (opusErr: any) {
        console.warn(`[pathway stage1] Opus filter failed (${opusErr?.message}), falling back to Sonnet`);
        msg = await anthropic.messages.create({
          model: FILTER_FALLBACK,
          max_tokens: 1500,
          messages: [{ role: "user", content: filterPrompt }],
        });
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

        const filteredEmails = blendIfOverFiltered(emailHits, keepE, 0.4, 8);
        const filteredBrochures = blendIfOverFiltered(brochureFiles, keepB, 0.5, 3);
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

  // Final safety cap
  emailHits.splice(60);

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

  await setStageStatus(runId, "stage1", "completed", {
    stage1: {
      emailHits,
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
    },
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

  if (!tenantName) {
    await setStageStatus(runId, "stage2", "skipped", {
      stage2: { skipped: true, reason: "No tenant identified in Stage 1" },
    });
    return;
  }

  await setStageStatus(runId, "stage2", "running");

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
  const results = run.stageResults as StageResults;

  const lines: string[] = [];
  lines.push(`**Initial Findings for ${run.address}**`);
  if (results.stage1?.initialOwnership) {
    const o = results.stage1.initialOwnership;
    lines.push(`- Owner: ${o.proprietorName || "unknown"} (title ${o.titleNumber}${o.pricePaid ? `, paid £${o.pricePaid.toLocaleString()} ${o.dateOfPurchase || ""}` : ""})`);
  }
  if (results.stage1?.tenant) lines.push(`- Tenant: ${results.stage1.tenant.name}`);
  if (results.stage1?.crmHits?.properties?.length) lines.push(`- CRM matches: ${results.stage1.crmHits.properties.length} property record(s)`);
  if (results.stage1?.emailHits?.length) lines.push(`- Emails in mailbox: ${results.stage1.emailHits.length}`);
  if (results.stage2?.enrichedFields && Object.keys(results.stage2.enrichedFields).length) {
    lines.push(`- Brand enrichment: ${Object.keys(results.stage2.enrichedFields).join(", ")}`);
  }
  lines.push("");
  lines.push("Ready to run full Property Intelligence (title registers, planning applications, floor plans, proprietor KYC)?");

  await setStageStatus(runId, "stage3", "completed", {
    stage3: { summary: lines.join("\n"), recommendProceed: true },
  });
}

// ============================================================================
// STAGE 4 — Property Intelligence
// ============================================================================

async function runStage4(runId: string, _req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage4", "running");

  const address = run.address;
  const postcode = run.postcode || "";

  try {
    const lookup = await performPropertyLookup({ address, postcode, layers: ["core", "extended"], propertyDataLayers: ["core", "extended"] });

    const planningApplications = (lookup.planningData as any)?.applications?.slice(0, 25)?.map((a: any) => ({
      reference: a.reference || a.ref || "",
      description: a.description || a.proposal || "",
      status: a.status || a.decision || "",
      date: a.date || a.decision_date || "",
    })) || [];

    // Floor plan hints: planning apps often expose document URLs
    const floorPlanUrls: string[] = [];
    for (const app of (lookup.planningData as any)?.applications?.slice(0, 10) || []) {
      if (app.url) floorPlanUrls.push(app.url);
    }

    await setStageStatus(runId, "stage4", "completed", {
      stage4: {
        titleRegisters: [],
        planningApplications,
        floorPlanUrls,
        proprietorKyc: null,
      },
    });
  } catch (err: any) {
    console.error("[pathway stage4] failed:", err?.message);
    await setStageStatus(runId, "stage4", "failed");
  }
}

// ============================================================================
// STAGE 5 — Investigation Board ready
// ============================================================================

async function runStage5(runId: string, _req: Request): Promise<void> {
  await setStageStatus(runId, "stage5", "completed", {
    stage5: { ready: true, boardUrl: `/property-intelligence?tab=board&runId=${runId}` },
  });
}

// ============================================================================
// STAGE 6 — Studio Time (images + model)
// ============================================================================

async function runStage6(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage6", "running");

  const patch: NonNullable<StageResults["stage6"]> = {};

  // 6a. Street View capture
  try {
    const svMod = await import("./image-studio").catch(() => null as any);
    if (svMod?.captureStreetViewForAddress) {
      const image = await svMod.captureStreetViewForAddress({ address: run.address, propertyId: run.propertyId });
      patch.streetViewImageId = image.id;
    }
  } catch (err: any) {
    console.warn("[pathway stage6] street view capture skipped:", err?.message);
  }

  // 6b. Retail Context Plan (custom GOAD-style overlay)
  try {
    const rcpMod = await import("./retail-context-plan").catch(() => null as any);
    if (rcpMod?.renderRetailContextPlan) {
      const image = await rcpMod.renderRetailContextPlan({ address: run.address, postcode: run.postcode || "", propertyId: run.propertyId });
      patch.retailContextImageId = image.id;
    }
  } catch (err: any) {
    console.warn("[pathway stage6] retail context plan skipped:", err?.message);
  }

  // 6c. Seed financial model — defer to /api/models API (stubbed here)
  // Will be filled in by the Excel save-back step

  await setStageStatus(runId, "stage6", "completed", { stage6: patch });
}

// ============================================================================
// STAGE 7 — Why Buy
// ============================================================================

async function runStage7(runId: string, req: Request): Promise<void> {
  const run = await getRun(runId);
  if (!run) throw new Error("Run not found");
  await setStageStatus(runId, "stage7", "running");

  try {
    const wbMod = await import("./why-buy-renderer").catch(() => null as any);
    if (!wbMod?.renderWhyBuy) {
      await setStageStatus(runId, "stage7", "failed", {
        stage7: { documentUrl: undefined },
      });
      return;
    }
    const result = await wbMod.renderWhyBuy({ runId, req });
    await setStageStatus(runId, "stage7", "completed", {
      stage7: {
        documentUrl: result.documentUrl,
        sharepointUrl: result.sharepointUrl,
        pdfPath: result.pdfPath,
      },
    });
    await updateRun(runId, { whyBuyDocumentUrl: result.sharepointUrl || result.documentUrl, completedAt: new Date() });
  } catch (err: any) {
    console.error("[pathway stage7] failed:", err?.message);
    await setStageStatus(runId, "stage7", "failed");
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
  6: runStage6,
  7: runStage7,
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
      const normalisedPostcode = (postcode || "").trim().replace(/\s+/g, "").toUpperCase();

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
      const [run] = await db
        .insert(propertyPathwayRuns)
        .values({
          address,
          postcode: postcode || null,
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
    try {
      const runId = String(req.params.runId);
      const { stage } = req.body as { stage?: number };
      const run = await getRun(runId);
      if (!run) return res.status(404).json({ error: "Run not found" });
      const targetStage = stage ?? run.currentStage;
      const updated = await runStage(runId, targetStage, req);
      res.json({ success: true, run: updated });
    } catch (err: any) {
      console.error("[pathway advance] error:", err?.message);
      res.status(500).json({ error: err?.message || "Failed to advance pathway" });
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

  // ============================================================================
  // MARKET INTEL — on-demand web crawl for comps, availability, leasing history
  // ============================================================================

  app.post("/api/property-pathway/:runId/market-intel", requireAuth, async (req: Request, res: Response) => {
    try {
      const run = await getRun(String(req.params.runId));
      if (!run) return res.status(404).json({ error: "Run not found" });

      const address = run.address;
      const postcode = run.postcode || "";
      const location = [address, postcode].filter(Boolean).join(", ");
      const area = postcode ? postcode.split(" ")[0] : "central London";
      const exaKey = process.env.EXA_API_KEY;

      console.log(`[market-intel] Starting crawl for ${location}`);

      // Run three searches in parallel: leasing history, availability/comps, Exa portal crawl
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
              // Search property portals for this specific building
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
              // Search for area market reports and comps
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

      // Collect raw text for Claude synthesis
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
        return res.status(503).json({ error: "All search providers failed. Check PERPLEXITY_API_KEY and EXA_API_KEY." });
      }

      const rawData = parts.join("\n\n");

      // Claude synthesises into structured JSON
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

      const stageResults = { ...((run.stageResults as StageResults) || {}), marketIntel: intel };
      const updated = await updateRun(run.id, { stageResults });
      console.log(`[market-intel] Done for ${location} — ${intel.leasingHistory.length} leases, ${intel.currentAvailability.length} available, ${intel.comparables.length} comps`);
      res.json({ success: true, marketIntel: intel, run: updated });
    } catch (err: any) {
      console.error("[market-intel]", err?.message || err);
      res.status(500).json({ error: err?.message || "Market intel failed" });
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
