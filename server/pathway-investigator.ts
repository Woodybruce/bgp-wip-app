// Autonomous property investigator — uses Claude + tool loop to investigate
// a property the way ChatBGP does conversationally. Gets called from
// property-pathway Stage 1 instead of the hardcoded pipeline.
//
// Pattern:
//   1. Build a system prompt with the investigation goal + output JSON schema
//   2. Give Claude access to investigator tools (search emails, Land Reg, etc.)
//   3. Loop: call Claude → execute any tool_use blocks → feed results back
//   4. When Claude returns plain text (no tool_use), parse as JSON and return
//
// Mailbox access: search_emails defaults to mailbox="all" for pathway runs
// so the tool fans out across every BGP mailbox via app-token. Each tool call
// uses the X-AnchorMailbox header for reliable $search routing.

import Anthropic from "@anthropic-ai/sdk";
import type { Request } from "express";
import { pool } from "./db";
import { askPerplexity, isPerplexityConfigured } from "./perplexity";

const MODEL_PRIMARY = "claude-sonnet-4-6";
const MODEL_FALLBACK = "claude-haiku-4-5-20251001";
const MAX_ITERATIONS = 12; // plenty for multi-pass investigation, caps cost

// ---------- Tool definitions ----------
// A curated subset of ChatBGP's tools tuned for property investigation.
const INVESTIGATOR_TOOLS: any[] = [
  {
    name: "web_search",
    description: "Search the web for public information about a property, company or person. Use for: news coverage, planning applications, agent listings, company profiles, sale/let history, press releases.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query, e.g. '18-22 Haymarket London sale' or 'Amsprop Holdings Companies House'" },
      },
      required: ["query"],
    },
  },
  {
    name: "knowledge_base_search",
    description: "Search the BGP knowledge base (archivist-indexed SharePoint docs, Dropbox files, past email content). Returns document excerpts with source path.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search phrase" },
        limit: { type: "number", description: "Max results (default 10, max 25)" },
      },
      required: ["query"],
    },
  },
  {
    name: "sharepoint_search",
    description: "Search SharePoint for folders and files matching a query. Returns name, path, webUrl, modification date.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    name: "land_registry_lookup",
    description: "Look up Land Registry title + ownership data for a postcode. Returns freehold + leasehold titles with proprietor name/category, price paid, date of purchase.",
    input_schema: {
      type: "object",
      properties: {
        postcode: { type: "string" },
        address: { type: "string", description: "Optional — refines the match" },
      },
      required: ["postcode"],
    },
  },
  {
    name: "voa_rates_lookup",
    description: "Look up VOA business rates assessments for a postcode. Pass the street name to filter to the specific building — otherwise all units in the postcode are returned. Returns list of entries with firmName, rateableValue, description (use class).",
    input_schema: {
      type: "object",
      properties: {
        postcode: { type: "string" },
        street: { type: "string", description: "Street name to filter results, e.g. 'Haymarket'. Omit to return all units in the postcode." },
      },
      required: ["postcode"],
    },
  },
  {
    name: "companies_house_lookup",
    description: "Look up a UK company by name or Companies House number. Returns registered address, directors, filing history, accounts.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Company name or Companies House number" },
      },
      required: ["query"],
    },
  },
  {
    name: "crm_lookup",
    description: "Look up BGP CRM records. Returns matching properties, deals, companies. Use for: checking if we already have a record for this address, finding linked deals, finding a tenant's company page.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Name or address to search for" },
        type: { type: "string", enum: ["property", "deal", "company", "all"], description: "What to search (default all)" },
      },
      required: ["query"],
    },
  },
  {
    name: "property_data_lookup",
    description: "Fetch detailed property data: planning applications (last 10 years), EPC/energy efficiency, floor areas, flood risk, listed buildings, conservation area, commercial rents. Provide uprn for exact building data, or postcode for area-level data.",
    input_schema: {
      type: "object",
      properties: {
        postcode: { type: "string", description: "UK postcode, e.g. SW1Y 4DG" },
        uprn: { type: "string", description: "UPRN for exact building lookup — use this if available, more precise than postcode" },
        address: { type: "string", description: "Full address for context" },
        layers: {
          type: "array",
          items: { type: "string", enum: ["core", "planning", "market", "area"] },
          description: "Data layers to fetch. Default: [\"core\",\"planning\"]",
        },
      },
    },
  },
];

// ---------- Tool executor ----------
// Routes each tool call to the appropriate existing service function.
export async function executeInvestigatorTool(toolName: string, input: any, req: Request): Promise<any> {
  try {
    switch (toolName) {
      case "search_emails": {
        const { graphRequest } = await import("./shared-mailbox");
        const { db } = await import("./db");
        const { users } = await import("@shared/schema");
        const { eq } = await import("drizzle-orm");
        const top = Math.min(input.top || 15, 25);

        // Enumerate all active BGP mailboxes + shared inbox
        const mailboxes: Array<{ email: string; owner: string }> = [
          { email: "chatbgp@brucegillinghampollard.com", owner: "Shared inbox" },
        ];
        try {
          const active = await db.select({ email: users.email, username: users.username, name: users.name })
            .from(users).where(eq(users.isActive, true));
          for (const u of active) {
            const mb = u.email || u.username;
            if (mb && /@brucegillinghampollard\.com$/i.test(mb) && mb.toLowerCase() !== "chatbgp@brucegillinghampollard.com") {
              mailboxes.push({ email: mb, owner: u.name || mb });
            }
          }
        } catch {}

        // Parallel search across all mailboxes
        const CONC = 6;
        const results: any[] = [];
        const seen = new Set<string>();
        let searchErrors = 0;

        // Graph $search with a quoted phrase requires EXACT match — so "18-22 Haymarket"
        // finds almost nothing. A bare word like Haymarket matches anywhere in the email.
        // Rule: wrap in quotes only if the query is a postcode or multi-word name
        // (not a house-number prefix like "18-22 ...").
        // Strip any outer quotes Claude may have already added to avoid double-quoting.
        // Also strip leading house numbers: "18-22 Haymarket" → "Haymarket"
        // (KQL treats "-" as NOT and digits at position 0 are invalid identifiers)
        const rawInput = String(input.query || "").trim().replace(/^"+|"+$/g, "");
        const raw = rawInput.replace(/^\d[\d\-–]*\s+/, "").trim() || rawInput;
        const looksLikePostcode = /^[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}$/i.test(raw);
        const hasSpace = raw.includes(" ");
        const graphQuery = (looksLikePostcode || (hasSpace && !/^\d/.test(raw)))
          ? `"${raw}"`   // postcode or multi-word name like "Dover Street Market" → quoted
          : raw;         // single word or number-prefixed address → unquoted

        const jobs = mailboxes.map((mb) => async () => {
          try {
            const data: any = await graphRequest(
              `/users/${encodeURIComponent(mb.email)}/messages?$search=${encodeURIComponent(graphQuery)}&$top=${top}&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId,webLink`,
              { headers: { "X-AnchorMailbox": mb.email } }
            );
            for (const msg of (data?.value || [])) {
              const key = msg.internetMessageId || msg.id;
              if (seen.has(key)) continue;
              seen.add(key);
              results.push({
                msgId: msg.id,
                subject: msg.subject || "(No subject)",
                from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "unknown",
                fromEmail: msg.from?.emailAddress?.address || "",
                date: msg.receivedDateTime,
                preview: (msg.bodyPreview || "").slice(0, 220),
                hasAttachments: !!msg.hasAttachments,
                mailboxEmail: mb.email,
                owner: mb.owner,
                webLink: msg.webLink || null,
              });
            }
          } catch (err: any) {
            searchErrors++;
            console.warn(`[investigator] search_emails error for ${mb.email}: ${String(err?.message || err).slice(0, 120)}`);
          }
        });
        for (let i = 0; i < jobs.length; i += CONC) {
          await Promise.all(jobs.slice(i, i + CONC).map((j) => j()));
        }
        results.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

        // Filter to emails where the query term appears in subject or preview.
        // Graph $search matches body/attachment content too — across 30 mailboxes
        // that produces hundreds of false positives (signatures, footers, unrelated
        // attachments). We only want emails where the term is prominent.
        const queryTokens = raw.toLowerCase().replace(/\s+/g, " ").split(" ").filter(Boolean);
        const postcodeCompact = raw.toLowerCase().replace(/\s+/g, "");
        const subjectPreviewFiltered = results.filter((msg) => {
          const hay = `${String(msg.subject || "").toLowerCase()} ${String(msg.preview || "").toLowerCase()}`;
          const hayCompact = hay.replace(/\s+/g, "");
          return hayCompact.includes(postcodeCompact) || queryTokens.every((t) => hay.includes(t));
        });

        // If the filter eliminates everything (e.g. company name not in subject),
        // fall back to unfiltered so Claude still gets signal.
        const finalResults = subjectPreviewFiltered.length > 0 ? subjectPreviewFiltered : results;
        console.log(`[investigator] search_emails q=${JSON.stringify(graphQuery)} → ${results.length} raw, ${subjectPreviewFiltered.length} subj/preview, ${finalResults.length} returned, ${searchErrors} errors | sample subjects: ${finalResults.slice(0, 5).map((m: any) => JSON.stringify((m.subject || "").slice(0, 60))).join(", ")}`);
        return { query: input.query, count: finalResults.length, results: finalResults.slice(0, 50), searchErrors: searchErrors > 0 ? searchErrors : undefined };
      }

      case "read_email": {
        const { graphRequest } = await import("./shared-mailbox");
        const msg: any = await graphRequest(
          `/users/${encodeURIComponent(input.mailboxEmail)}/messages/${encodeURIComponent(input.msgId)}?$select=id,subject,from,toRecipients,ccRecipients,receivedDateTime,body,bodyPreview,hasAttachments,webLink`,
          { headers: { "X-AnchorMailbox": input.mailboxEmail } }
        );
        let attachments: any[] = [];
        if (msg.hasAttachments) {
          try {
            const atts: any = await graphRequest(
              `/users/${encodeURIComponent(input.mailboxEmail)}/messages/${encodeURIComponent(input.msgId)}/attachments?$select=id,name,size,contentType,isInline`,
              { headers: { "X-AnchorMailbox": input.mailboxEmail } }
            );
            attachments = (atts?.value || []).filter((a: any) => !a.isInline).map((a: any) => ({
              id: a.id, name: a.name, size: a.size, contentType: a.contentType,
            }));
          } catch {}
        }
        // Strip HTML if body is HTML
        const body = msg.body?.contentType === "html"
          ? String(msg.body?.content || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8000)
          : String(msg.body?.content || msg.bodyPreview || "").slice(0, 8000);
        return {
          msgId: msg.id,
          subject: msg.subject,
          from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address,
          to: (msg.toRecipients || []).map((r: any) => r.emailAddress?.address).join(", "),
          date: msg.receivedDateTime,
          body,
          attachments,
        };
      }

      case "extract_attachment": {
        const { graphRequest } = await import("./shared-mailbox");
        const att: any = await graphRequest(
          `/users/${encodeURIComponent(input.mailboxEmail)}/messages/${encodeURIComponent(input.msgId)}/attachments/${encodeURIComponent(input.attachmentId)}`,
          { headers: { "X-AnchorMailbox": input.mailboxEmail } }
        );
        if (!att.contentBytes) return { error: "No content bytes" };
        const buf = Buffer.from(att.contentBytes, "base64");
        const name = att.name || "attachment";
        let text = "";
        try {
          if (/\.pdf$/i.test(name)) {
            const pdfParseModule: any = await import("pdf-parse");
            const pdfParse = pdfParseModule.default || pdfParseModule;
            const parsed = await pdfParse(buf);
            text = parsed.text;
          } else if (/\.docx?$/i.test(name)) {
            const mammoth = await import("mammoth");
            const r = await mammoth.extractRawText({ buffer: buf });
            text = r.value;
          } else if (/\.xlsx?$/i.test(name)) {
            const XLSX = await import("xlsx");
            const wb = XLSX.read(buf);
            text = wb.SheetNames.map((n) => `Sheet: ${n}\n${XLSX.utils.sheet_to_csv(wb.Sheets[n])}`).join("\n\n");
          } else {
            text = "(binary — cannot extract text)";
          }
        } catch (err: any) {
          return { error: `Extraction failed: ${err?.message}` };
        }
        return {
          name,
          size: att.size,
          contentType: att.contentType,
          content: text.slice(0, 10000),
        };
      }

      case "web_search": {
        const query = String(input.query || "").trim();
        if (!isPerplexityConfigured()) return { error: "Perplexity not configured (set PERPLEXITY_API_KEY)" };
        const r = await askPerplexity(query, {
          systemPrompt: "You are a UK commercial property research assistant. Return factual, concise information with sources. Focus on ownership, planning, tenants, agents, sale/let history, news.",
          maxTokens: 800,
          temperature: 0.1,
        });
        return {
          query,
          answer: r.answer,
          citations: r.citations.map((c) => ({ url: c.url, title: c.title })),
        };
      }

      case "knowledge_base_search": {
        const q = input.query;
        const limit = Math.min(input.limit || 10, 25);
        const res = await pool.query(
          `SELECT id, title, source, content, updated_at
             FROM knowledge_base
            WHERE content ILIKE $1 OR title ILIKE $1
            ORDER BY updated_at DESC NULLS LAST
            LIMIT $2`,
          [`%${q}%`, limit]
        );
        return {
          query: q,
          count: res.rows.length,
          results: res.rows.map((r: any) => ({
            id: r.id,
            title: r.title,
            source: r.source,
            excerpt: String(r.content || "").slice(0, 400),
            updatedAt: r.updated_at,
          })),
        };
      }

      case "sharepoint_search": {
        const { getValidMsToken } = await import("./microsoft");
        const { getSharePointDriveId } = await import("./utils/sharepoint-operations");
        const token = await getValidMsToken(req);
        if (!token) return { error: "Not authenticated to Microsoft" };
        const driveId = await getSharePointDriveId(token);
        if (!driveId) return { error: "No SharePoint drive" };
        const resp = await fetch(
          `https://graph.microsoft.com/v1.0/drives/${driveId}/root/search(q='${encodeURIComponent(input.query)}')`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (!resp.ok) return { error: `SharePoint search failed: ${resp.status}` };
        const data: any = await resp.json();
        return {
          query: input.query,
          results: (data.value || []).slice(0, 30).map((item: any) => ({
            name: item.name,
            path: item.parentReference?.path?.replace(/\/drive\/root:/, "") || "",
            webUrl: item.webUrl,
            modifiedAt: item.lastModifiedDateTime,
            sizeMB: item.size ? Math.round((item.size / 1024 / 1024) * 100) / 100 : undefined,
            type: item.folder ? "folder" : (item.file?.mimeType || "file"),
          })),
        };
      }

      case "land_registry_lookup": {
        const { performPropertyLookup } = await import("./property-lookup");
        const result = await performPropertyLookup({
          address: input.address,
          postcode: input.postcode,
          layers: ["core"],
        });
        const freeholds = result.propertyDataCoUk?.freeholds?.data || [];
        const leaseholds = result.propertyDataCoUk?.leaseholds?.data || [];
        return {
          postcode: input.postcode,
          freeholds: freeholds.slice(0, 5).map((f: any) => ({
            titleNumber: f.title_number || f.title,
            proprietor: f.proprietor_name_1,
            category: f.proprietor_category,
            pricePaid: f.price_paid ? Number(f.price_paid) : null,
            dateOfPurchase: f.date_proprietor_added,
          })),
          leaseholds: leaseholds.slice(0, 5).map((l: any) => ({
            titleNumber: l.title_number || l.title,
            proprietor: l.proprietor_name_1,
          })),
        };
      }

      case "voa_rates_lookup": {
        const pc = String(input.postcode || "").trim();
        const street = input.street ? String(input.street).trim() : undefined;
        const { voaSqliteAvailable, lookupVoaByPostcode } = await import("./voa-sqlite");
        let rows: any[] = [];
        if (voaSqliteAvailable()) {
          rows = lookupVoaByPostcode(pc, street, 30);
        } else {
          const normalisedPc = pc.replace(/\s+/g, "").toUpperCase();
          const res = await pool.query(
            `SELECT firm_name AS "firmName", description_text AS description, rateable_value AS "rateableValue", effective_date AS "effectiveDate"
               FROM voa_ratings WHERE UPPER(REPLACE(postcode, ' ', '')) = $1
               ORDER BY rateable_value DESC NULLS LAST LIMIT 30`,
            [normalisedPc]
          );
          rows = res.rows;
        }
        const normPc = pc.replace(/\s+/g, "").toUpperCase();
        const formattedPc = normPc.length > 3 ? `${normPc.slice(0, -3)} ${normPc.slice(-3)}` : normPc;
        return {
          postcode: formattedPc,
          count: rows.length,
          totalRateableValue: rows.reduce((s: number, r: any) => s + (Number(r.rateableValue ?? r.rateable_value) || 0), 0),
          entries: rows.map((r: any) => ({
            firmName: r.firmName ?? r.firm_name,
            address: [r.numberOrName ?? r.number_or_name, r.street, r.town].filter(Boolean).join(", "),
            description: r.description ?? r.description_text,
            rateableValue: r.rateableValue != null ? Number(r.rateableValue) : (r.rateable_value != null ? Number(r.rateable_value) : null),
            effectiveDate: r.effectiveDate ?? r.effective_date,
          })),
        };
      }

      case "companies_house_lookup": {
        const apiKey = process.env.COMPANIES_HOUSE_API_KEY;
        if (!apiKey) return { error: "Companies House API key not configured" };
        const isNumber = /^\d+$/.test(String(input.query).trim());
        const auth = "Basic " + Buffer.from(`${apiKey}:`).toString("base64");
        if (isNumber) {
          const resp = await fetch(`https://api.company-information.service.gov.uk/company/${input.query}`, { headers: { Authorization: auth } });
          if (!resp.ok) return { error: `Companies House ${resp.status}` };
          return await resp.json();
        } else {
          const resp = await fetch(`https://api.company-information.service.gov.uk/search/companies?q=${encodeURIComponent(input.query)}&items_per_page=5`, { headers: { Authorization: auth } });
          if (!resp.ok) return { error: `Companies House ${resp.status}` };
          const data: any = await resp.json();
          return { items: (data.items || []).map((i: any) => ({ company_number: i.company_number, title: i.title, company_status: i.company_status, date_of_creation: i.date_of_creation, address: i.address_snippet })) };
        }
      }

      case "crm_lookup": {
        const { db } = await import("./db");
        const { crmProperties, crmDeals, crmCompanies } = await import("@shared/schema");
        const { ilike, or } = await import("drizzle-orm");
        const q = String(input.query || "").trim();
        const out: any = {};
        if (input.type === "property" || input.type === "all" || !input.type) {
          const rows = await db.select({ id: crmProperties.id, name: crmProperties.name, status: crmProperties.status, assetClass: crmProperties.assetClass }).from(crmProperties).where(or(ilike(crmProperties.name, `%${q}%`))).limit(10);
          out.properties = rows;
        }
        if (input.type === "deal" || input.type === "all" || !input.type) {
          const rows = await db.select({ id: crmDeals.id, name: crmDeals.name, stage: crmDeals.stage, dealType: crmDeals.dealType }).from(crmDeals).where(or(ilike(crmDeals.name, `%${q}%`))).limit(10);
          out.deals = rows;
        }
        if (input.type === "company" || input.type === "all" || !input.type) {
          const rows = await db.select({ id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType }).from(crmCompanies).where(or(ilike(crmCompanies.name, `%${q}%`))).limit(10);
          out.companies = rows;
        }
        return out;
      }

      case "property_data_lookup": {
        const { performPropertyLookup } = await import("./property-lookup");
        const layers = Array.isArray(input.layers) && input.layers.length > 0 ? input.layers : ["core", "planning"];
        const result = await performPropertyLookup({
          address: input.address,
          postcode: input.postcode,
          uprn: input.uprn,
          layers,
          propertyDataLayers: layers,
        });
        const pd = result.propertyDataCoUk || {};
        const planAppsRaw = pd["planning-applications"]?.data;
        const planApps = Array.isArray(planAppsRaw) ? planAppsRaw : (planAppsRaw?.planning_applications || []);
        const epc = pd["energy-efficiency"]?.data;
        const floorAreas = pd["floor-areas"]?.data;
        const floodRisk = pd["flood-risk"]?.data;
        const listedBuildings = pd["listed-buildings"]?.data;
        const conservationArea = pd["conservation-area"]?.data;
        const rentsCommercial = pd["rents-commercial"]?.data;
        return {
          postcode: input.postcode,
          planningApplications: planApps.slice(0, 20).map((p: any) => ({
            reference: p.application_reference || p.reference,
            description: (p.development || p.description || "").slice(0, 200),
            status: p.decision || p.status,
            date: p.decision_date || p.date_received || p.date,
          })),
          epc: epc ? { rating: epc.current_energy_rating, type: epc.property_type } : null,
          floorAreasSqm: floorAreas?.total_floor_area || null,
          floodRisk: floodRisk?.flood_risk_band || null,
          listedBuilding: listedBuildings?.[0]?.grade || null,
          conservationArea: conservationArea?.area_name || null,
          commercialRent: rentsCommercial ? { avgPsf: rentsCommercial.average_rent, range: `£${rentsCommercial.min_rent}–£${rentsCommercial.max_rent} psf` } : null,
        };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (err: any) {
    return { error: err?.message || String(err) };
  }
}

// ---------- Runner ----------
export interface InvestigativeStage1Result {
  ownership?: {
    owner?: string;
    ownerCompanyNumber?: string;
    titleNumber?: string;
    pricePaid?: string;
    dateOfPurchase?: string;
    refurbCost?: string;
  };
  tenancy?: {
    tenant?: string;
    tenantCompanyNumber?: string;
    leaseStatus?: string;
    mainOccupiers?: string[];
    passingRent?: string;
  };
  property?: {
    sizeSqft?: string;
    listedStatus?: string;
    currentUse?: string;
    heritageNotes?: string;
  };
  keyEmails?: Array<{
    msgId: string;
    mailboxEmail?: string;
    subject: string;
    from: string;
    date: string;
    preview?: string;
    hasAttachments?: boolean;
    webLink?: string | null;
    why?: string;
  }>;
  keyDocs?: Array<{ name: string; source: string; excerpt?: string; webUrl?: string }>;
  brochures?: Array<{ name: string; source: string; ref?: string; date?: string; webUrl?: string }>;
  sharepointMatches?: Array<{ name: string; path: string; webUrl: string; type?: string }>;
  rates?: { totalRV?: number; assessmentCount?: number; entries?: any[] };
  crmMatches?: { properties?: any[]; deals?: any[]; companies?: any[] };
  aiBriefing?: { headline: string; bullets: string[]; keyQuestions: string[] };
  nextSteps?: string[];
  confidence?: "high" | "medium" | "low";
  toolTrace?: Array<{ tool: string; input: any; summary: string }>;
}

export async function runInvestigativeStage1(opts: {
  address: string;
  postcode: string | null;
  req: Request;
  externalPrefetch?: Array<{ tool: string; result: any }>; // caller can supply pre-fetched data to skip the internal pre-fetch
}): Promise<InvestigativeStage1Result> {
  const started = Date.now();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const systemPrompt = `You are BGP's senior property investigator. Given a UK commercial property address you gather comprehensive intelligence by orchestrating calls to the available tools.

APPROACH — follow the step-by-step instructions in the user message. Key rules:
- If pre-fetched data is shown for a tool, DO NOT call that tool again — use what you have.
- If no pre-fetched data is shown for land_registry, voa_rates, or crm — YOU MUST call those tools.
- Always call property_data_lookup for planning history and EPC data.
- Always look up Companies House for any owner/tenant you identify.
- Always search the web, SharePoint, and knowledge base.
- The official Land Registry title number (from land_registry_lookup or property_data_lookup) is the authoritative source — do not guess or use web-sourced title numbers as confirmed.

FINAL OUTPUT: return STRICT JSON only (no prose, no markdown fences):
{
  "ownership": { "owner": "...", "ownerCompanyNumber": "...", "titleNumber": "...", "pricePaid": "£31m", "dateOfPurchase": "Nov 2013", "refurbCost": "£60m" },
  "tenancy": { "tenant": "...", "tenantCompanyNumber": "...", "leaseStatus": "...", "mainOccupiers": [], "passingRent": "£2.57m pa" },
  "property": { "sizeSqft": "31384", "listedStatus": "Grade II", "currentUse": "...", "heritageNotes": "...", "planningHistory": "brief summary of key planning decisions" },
  "keyDocs": [{ "name": "...", "source": "sharepoint|knowledge_base", "excerpt": "...", "webUrl": "..." }],
  "sharepointMatches": [{ "name": "...", "path": "...", "webUrl": "...", "type": "folder|file" }],
  "rates": { "totalRV": 450000, "assessmentCount": 5, "entries": [] },
  "crmMatches": { "properties": [], "deals": [], "companies": [] },
  "webFindings": "2-3 sentence summary of what Perplexity web search found",
  "aiBriefing": { "headline": "1-sentence top-line", "bullets": ["..."], "keyQuestions": ["..."] },
  "nextSteps": ["specific follow-ups for the analyst"],
  "confidence": "high|medium|low"
}

Omit fields you have no data for. Keep sharepointMatches to max 15.`;

  // Use caller-supplied pre-fetch if available, otherwise run it ourselves.
  let prefetch: Array<{ tool: string; result: any }> = opts.externalPrefetch || [];
  if (prefetch.length === 0) {
    await Promise.all([
      executeInvestigatorTool("crm_lookup", { query: opts.address.split(",")[0].trim(), type: "all" }, opts.req)
        .then((r) => prefetch.push({ tool: "crm_lookup", result: r })).catch(() => {}),
      opts.postcode
        ? executeInvestigatorTool("land_registry_lookup", { address: opts.address, postcode: opts.postcode }, opts.req)
            .then((r) => prefetch.push({ tool: "land_registry_lookup", result: r })).catch(() => {})
        : Promise.resolve(),
      opts.postcode
        ? executeInvestigatorTool("voa_rates_lookup", { postcode: opts.postcode }, opts.req)
            .then((r) => prefetch.push({ tool: "voa_rates_lookup", result: r })).catch(() => {})
        : Promise.resolve(),
    ]);
  }
  console.log(`[investigator] prefetch: ${prefetch.map((p) => `${p.tool}=${JSON.stringify(p.result).slice(0, 120)}`).join(" | ")}`);

  const hasLandReg = prefetch.some((p) => p.tool === "land_registry_lookup" && !p.result?.error);
  const hasVoa = prefetch.some((p) => p.tool === "voa_rates_lookup" && (p.result?.count ?? 0) > 0);
  const hasCrm = prefetch.some((p) => p.tool === "crm_lookup");
  const hasPostcode = !!(opts.postcode);

  const prefetchSummary = prefetch.length
    ? `\n\nPre-fetched context (already done — DO NOT repeat these tool calls):\n${prefetch.map((p) => `${p.tool}: ${JSON.stringify(p.result).slice(0, 800)}`).join("\n")}`
    : "";

  const noPostcodeInstructions = !hasPostcode ? `
IMPORTANT: No postcode was provided. Your first step MUST be:
1. Call web_search with query "${opts.address} postcode UK" to find the correct postcode
2. Once you have the postcode, call land_registry_lookup and property_data_lookup with it
3. Then call voa_rates_lookup with the postcode
Do NOT skip these — the official title number, ownership, and rates data depend on them.` : "";

  const userPrompt = `Investigate: ${opts.address}${opts.postcode ? `, ${opts.postcode}` : ""}${prefetchSummary}
${noPostcodeInstructions}
Your investigation steps:
${hasLandReg ? "✓ Land Registry already fetched above" : "→ Call land_registry_lookup to get official title numbers and ownership"}
${hasVoa ? "✓ VOA rates already fetched above" : "→ Call voa_rates_lookup for business rates"}
${hasCrm ? "✓ CRM already searched above" : "→ Call crm_lookup"}
→ Call property_data_lookup for planning history, EPC, floor areas
→ Look up Companies House for the owner and tenant
→ Search the web for this address (tenants, sales, news, planning decisions)
→ Search SharePoint and knowledge base
→ Return the JSON.`;

  const messages: any[] = [{ role: "user", content: userPrompt }];
  const toolTrace: Array<{ tool: string; input: any; summary: string }> = [];
  // Add pre-fetched calls to the trace so they appear in the UI
  for (const p of prefetch) {
    toolTrace.push({ tool: p.tool, input: {}, summary: JSON.stringify(p.result).slice(0, 120) });
  }

  // Accumulate every email returned by search_emails across all iterations.
  // If Claude returns empty keyEmails in its final JSON (over-filtering), we
  // fall back to this pool so the user always sees what was found.
  const emailPool: any[] = [];
  const emailPoolSeen = new Set<string>();

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    let response: any;
    try {
      response = await anthropic.messages.create({
        model: MODEL_PRIMARY,
        max_tokens: 16000,
        system: systemPrompt,
        tools: INVESTIGATOR_TOOLS,
        messages,
      });
    } catch (err: any) {
      console.warn(`[investigator] ${MODEL_PRIMARY} iter ${i} failed: ${err?.message} — falling back to ${MODEL_FALLBACK}`);
      response = await anthropic.messages.create({
        model: MODEL_FALLBACK,
        max_tokens: 8192,
        system: systemPrompt,
        tools: INVESTIGATOR_TOOLS,
        messages,
      });
    }

    const toolUses = (response.content || []).filter((b: any) => b.type === "tool_use");
    const textBlocks = (response.content || []).filter((b: any) => b.type === "text");

    if (toolUses.length === 0) {
      // Final answer — parse JSON
      const txt = textBlocks.map((b: any) => b.text).join("\n");
      console.log(`[investigator] Final response (iter ${i}): ${txt.slice(0, 600)}`);
      const match = txt.match(/\{[\s\S]*\}/);
      if (!match) {
        console.warn(`[investigator] No JSON in final response (iter ${i}): ${txt.slice(0, 300)}`);
        return { toolTrace, confidence: "low" as const };
      }
      let result: InvestigativeStage1Result;
      try {
        result = JSON.parse(match[0]) as InvestigativeStage1Result;
      } catch (parseErr: any) {
        console.warn(`[investigator] JSON.parse failed: ${parseErr?.message} — attempting truncation repair`);
        // Try to salvage truncated JSON by closing open structures
        try {
          let partial = match[0];
          // Count unclosed braces/brackets and add missing closers
          let braces = 0, brackets = 0, inStr = false, escape = false;
          for (const ch of partial) {
            if (escape) { escape = false; continue; }
            if (ch === "\\") { escape = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;
            if (ch === "{") braces++;
            else if (ch === "}") braces--;
            else if (ch === "[") brackets++;
            else if (ch === "]") brackets--;
          }
          // Trim trailing incomplete key/value (cut at last complete comma or colon)
          partial = partial.replace(/,\s*$/, "").replace(/:\s*"[^"]*$/, ": null");
          partial += "]".repeat(Math.max(0, brackets)) + "}".repeat(Math.max(0, braces));
          result = JSON.parse(partial) as InvestigativeStage1Result;
          console.log(`[investigator] Truncated JSON repaired successfully`);
        } catch (repairErr: any) {
          console.warn(`[investigator] JSON repair also failed: ${repairErr?.message} — returning empty`);
          return { toolTrace, confidence: "low" as const };
        }
      }

      // If Claude returned no keyEmails but we accumulated emails from search_emails,
      // use the pool directly — Claude over-filtered.
      if ((!result.keyEmails || result.keyEmails.length === 0) && emailPool.length > 0) {
        console.warn(`[investigator] Claude returned 0 keyEmails but pool has ${emailPool.length} — using pool directly`);
        result.keyEmails = emailPool.slice(0, 15).map((e) => ({ ...e, why: "Found in email search" }));
      }
      console.log(`[investigator] Done in ${((Date.now() - started) / 1000).toFixed(1)}s — ${result.keyEmails?.length || 0} emails, ${i + 1} Claude calls`);

      result.toolTrace = toolTrace;
      return result;
    }

    // Execute tools, feed back
    messages.push({ role: "assistant", content: response.content });
    const toolResults = await Promise.all(
      toolUses.map(async (tu: any) => {
        const toolResult = await executeInvestigatorTool(tu.name, tu.input, opts.req);

        // Accumulate emails from every search_emails call
        if (tu.name === "search_emails" && Array.isArray(toolResult?.results)) {
          for (const e of toolResult.results) {
            const key = e.msgId || e.internetMessageId;
            if (key && !emailPoolSeen.has(key)) {
              emailPoolSeen.add(key);
              emailPool.push(e);
            }
          }
        }

        const summary = (() => {
          if (toolResult?.error) return `error: ${toolResult.error}`;
          if (toolResult?.results) return `${toolResult.results.length || toolResult.count || 0} results`;
          if (toolResult?.entries) return `${toolResult.entries.length} entries`;
          if (toolResult?.count != null) return `${toolResult.count} items`;
          return "ok";
        })();
        toolTrace.push({ tool: tu.name, input: tu.input, summary });
        return {
          type: "tool_result",
          tool_use_id: tu.id,
          content: JSON.stringify(toolResult).slice(0, 30000),
        };
      })
    );
    messages.push({ role: "user", content: toolResults });
  }

  // Hit max iterations — return whatever emails we accumulated
  console.warn(`[investigator] Hit max iterations (${MAX_ITERATIONS}) — pool has ${emailPool.length} emails`);
  return {
    toolTrace,
    confidence: "low" as const,
    keyEmails: emailPool.slice(0, 15).map((e) => ({ ...e, why: "Found in email search" })),
  };
}
