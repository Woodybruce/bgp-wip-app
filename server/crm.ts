import type { Express } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import { storage } from "./storage";
import { requireAuth } from "./auth";
import { db, pool } from "./db";
import { saveFile, getFile, deleteFile as deleteStoredFile } from "./file-storage";
import { resolveCompanyScope, isPropertyInScope, isDealInScope, isContactInScope } from "./company-scope";

const LANDLORD_PACKS_DIR = path.join(process.cwd(), "ChatBGP", "landlord-packs");
if (!fs.existsSync(LANDLORD_PACKS_DIR)) fs.mkdirSync(LANDLORD_PACKS_DIR, { recursive: true });

const landlordPackUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});
import {
  insertCrmCompanySchema, insertCrmContactSchema, insertCrmPropertySchema,
  insertCrmDealSchema, insertCrmRequirementsLeasingSchema as insertCrmReqLeasingSchema,
  insertCrmRequirementsInvestmentSchema as insertCrmReqInvestSchema,
  insertCrmCompSchema, insertCrmLeadSchema,
  crmContactProperties, crmContactDeals, crmContactRequirements,
  crmProperties, crmDeals, crmComps, crmRequirementsLeasing, crmRequirementsInvestment,
  crmPropertyAgents, crmPropertyTenants, crmPropertyClients, crmCompanies, crmCompanyDeals, users, dealFeeAllocations,
  crmContacts, newsArticles, wipEntries, investmentComps, insertInvestmentCompSchema,
  xeroInvoices, availableUnits, investmentTracker,
  dealAuditLog,
} from "@shared/schema";
import { eq, and, or, inArray, isNotNull, sql } from "drizzle-orm";
import { callClaude, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";
import { searchPipnetRequirements } from "./pipnet";
import { xeroApi, refreshXeroToken } from "./xero";
import { scrapeTrlPage, KNOWN_TRL_PAGES, discoverTrlPages, scrapeTrlOccupierDirectory, scrapeTrlAgencyDirectory, scrapeTrlAgencyListing, scrapeTrlAgencyDetailPage, scrapeTrlRequirementSearch } from "./trl";

import { randomUUID } from "crypto";
import type { Pool } from "pg";

function parseAiJson(raw: string): any {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    return JSON.parse(cleaned);
  } catch (e: any) {
    throw new Error(`Failed to parse AI JSON response: ${e.message}. Raw: ${cleaned.slice(0, 200)}`);
  }
}

/**
 * Parse a Sage WIP Excel buffer and import it into wip_entries + sync to
 * crm_deals. Used by:
 *   - the direct file-upload route POST /api/wip/import
 *   - the ChatBGP tool `import_wip_excel` (via chat-media filename)
 *
 * `append: false` (default) wipes wip_entries first, then loads. Use
 * `append: true` only for incremental updates between full Sage exports.
 *
 * Two Sage export layouts are supported:
 *
 * 1) **Legacy layout** ("WIP by deal" report):
 *    Ref, Group, Project, Tenant, Team, Agent, Amt WIP, Amt invoice,
 *    Month, Deal status, Stage, InvoiceNo, ORDER_NUMBER.
 *
 * 2) **Current Sage TransactionsExpo layout** (what BGP actually exports):
 *    TRAN_NUMBER (often blank), HEADER_NUMBER (deal external ref),
 *    Project, Tenant, Client, NAME, ADDRESS_*, Group, Team, Agent,
 *    NetAmount, STOCK_CODE (CON049 = BGP House 10% slice), DealStatus,
 *    MonthYear, DueDate_EOMonth, etc. Each row is a single fee slice;
 *    multiple rows per HEADER_NUMBER sum to the total deal fee.
 *
 * The parser auto-detects which layout the workbook uses by sniffing
 * the first data row's keys, then maps columns into the canonical
 * wip_entries shape. Month strings (`Apr-26` or `2026-04`) are normalised
 * into a fiscal year assuming BGP's FY runs Apr–Mar — Apr-26 → FY 2027.
 *
 * Throws on invalid input (no rows / unreadable file) so callers can
 * surface a clear error.
 */
export async function importWipFromBuffer(
  buffer: Buffer,
  opts: { append?: boolean } = {},
): Promise<{ success: true; imported: number; layout: "legacy" | "sage_transactionsexpo" | "unknown"; sync: any; enrichment: any; diagnostics?: any }> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const data: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
  if (data.length === 0) throw new Error("No data found in file");

  // Build a case- and punctuation-insensitive key map per row, so column
  // names like "HEADER_NUMBER" / "Header Number" / "headerNumber" all
  // resolve to the same value. Sage exports sometimes change punctuation
  // between report versions and we want the importer to keep working.
  const normaliseKey = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");
  const buildKeyMap = (row: any): Record<string, any> => {
    const out: Record<string, any> = {};
    if (!row) return out;
    for (const k of Object.keys(row)) out[normaliseKey(k)] = row[k];
    return out;
  };
  /** Look up a column value by trying multiple aliases case/punctuation-insensitively. */
  const pick = (row: Record<string, any>, ...aliases: string[]): any => {
    for (const a of aliases) {
      const v = row[normaliseKey(a)];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return null;
  };

  const firstRow = data.find((r: any) => r && Object.values(r).some((v: any) => v !== null && v !== "")) || data[0];
  const rawKeys = Object.keys(firstRow || {});
  const normKeys = new Set(rawKeys.map(normaliseKey));
  const isLegacy = normKeys.has("ref") || normKeys.has("amtwip") || normKeys.has("amtinvoice");
  const isSage = normKeys.has("headernumber") || normKeys.has("netamount");
  const layout: "legacy" | "sage_transactionsexpo" | "unknown" =
    isLegacy ? "legacy" : isSage ? "sage_transactionsexpo" : "unknown";

  if (layout === "unknown") {
    throw new Error(
      `Could not recognise the WIP export format. Saw columns: ${rawKeys.slice(0, 12).join(", ")}. ` +
      `Expected either legacy (Ref, Amt WIP, Amt invoice, …) or Sage TransactionsExpo (HEADER_NUMBER, NetAmount, …).`
    );
  }

  // Diagnostics: how many rows have each critical column populated. Helps
  // diagnose "0 deals created" symptoms when the source layout drifts.
  const diagnostics = {
    layout,
    totalDataRows: data.length,
    rowsWithHeaderNumber: 0,
    rowsWithNetAmount: 0,
    rowsWithProject: 0,
    rowsWithTenant: 0,
    rowsWithName: 0,
    rowsWithAgent: 0,
    rawKeys: rawKeys.slice(0, 30),
    sampleFirstRow: firstRow,
  };

  // Sage rows are fee SLICES — multiple rows per HEADER_NUMBER, each with a
  // different Agent and a slice of the total fee. Aggregate them per deal so
  // we can later upsert billing entity + per-agent allocations + tenant-rep
  // searches in a single post-process step. Empty for legacy layout.
  type SageEnrichment = {
    headerNumber: string;
    billingEntity: {
      name: string;
      addressLine1?: string;
      addressLine2?: string;
      city?: string;
      postcode?: string;
    } | null;
    feeSlices: Array<{ agent: string; amount: number; isBgpHouse: boolean }>;
    status: string | null;
    project: string | null;
    tenant: string | null;
    client: string | null;
  };
  const enrichments = new Map<string, SageEnrichment>();
  // Sage's TransactionsExpo export sometimes leaves HEADER_NUMBER blank and
  // puts the deal reference (4975, 5144, …) in `Document` instead — column
  // drift from Sage. We also see a duplicate `Document*` column at the end
  // of the export. Pick HEADER_NUMBER first, fall back to either Document
  // variant.
  const pickDealRef = (kr: Record<string, any>): string => {
    const raw = pick(kr, "HEADER_NUMBER", "HeaderNumber", "Header Number")
      ?? pick(kr, "Document", "Document*", "DocumentNumber", "Document Number");
    if (raw == null) return "";
    const s = String(raw).trim();
    // Skip totals/footer rows ("Total", empty, etc.) — those aren't deals.
    if (!s || s.toLowerCase() === "total") return "";
    return s;
  };
  const upsertEnrichment = (kr: Record<string, any>) => {
    const headerNum = pickDealRef(kr);
    if (!headerNum) return;
    let e = enrichments.get(headerNum);
    if (!e) {
      e = {
        headerNumber: headerNum,
        billingEntity: null,
        feeSlices: [],
        status: null,
        project: null,
        tenant: null,
        client: null,
      };
      enrichments.set(headerNum, e);
    }
    if (!e.status) {
      const s = pick(kr, "DealStatus", "Deal Status", "Deal status");
      if (s) e.status = String(s).trim();
    }
    if (!e.project) {
      const p = pick(kr, "Project");
      if (p) e.project = String(p).trim();
    }
    if (!e.tenant) {
      const t = pick(kr, "Tenant");
      if (t) e.tenant = String(t).trim();
    }
    if (!e.client) {
      const c = pick(kr, "Client");
      if (c) e.client = String(c).trim();
    }
    if (!e.billingEntity) {
      const name = pick(kr, "NAME", "Name", "BillingName", "ClientName");
      if (name) {
        // Sage 50 stores addresses in ADDRESS_1..ADDRESS_5 (line1, line2, town, county, postcode).
        // Fall back to legacy/long names for older exports.
        e.billingEntity = {
          name: String(name).trim(),
          addressLine1: pick(kr, "ADDRESS_1", "ADDRESS_LINE1", "AddressLine1", "Address Line 1") || undefined,
          addressLine2: pick(kr, "ADDRESS_2", "ADDRESS_LINE2", "AddressLine2", "Address Line 2") || undefined,
          city: pick(kr, "ADDRESS_3", "ADDRESS_CITY", "City", "AddressCity", "Address City") || undefined,
          postcode: pick(kr, "ADDRESS_5", "ADDRESS_4", "ADDRESS_POSTCODE", "Postcode", "PostalCode", "AddressPostcode", "Post Code") || undefined,
        };
      }
    }
    const agent = pick(kr, "Agent");
    const amount = parseFloat(pick(kr, "NetAmount", "Net Amount", "Amount") || 0) || 0;
    if (agent && amount !== 0) {
      const stockCode = String(pick(kr, "STOCK_CODE", "StockCode", "Stock Code") || "").toUpperCase();
      e.feeSlices.push({
        agent: String(agent).trim(),
        amount,
        isBgpHouse: stockCode === "CON049",
      });
    }
  };

  const monthOrder = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  // Convert Excel serial number (e.g. 46357) to a JS Date (UTC).
  // Excel counts from 1900-01-00 with a phantom leap day on 1900-02-29,
  // so the Unix-epoch offset is 25569 days.
  const excelSerialToDate = (serial: number): Date =>
    new Date((serial - 25569) * 86400 * 1000);

  const parseFiscalYear = (raw: any): number | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    const mDash = s.match(/^([A-Za-z]{3})[-/ ]+(\d{2,4})$/);
    if (mDash) {
      const mIdx = monthOrder.indexOf(mDash[1].slice(0, 3));
      const yrRaw = parseInt(mDash[2]);
      const yr = mDash[2].length === 2 ? 2000 + yrRaw : yrRaw;
      if (mIdx >= 0 && !isNaN(yr)) return mIdx >= 3 ? yr + 1 : yr;
    }
    const mYearFirst = s.match(/^(\d{4})[-/](\d{1,2})/);
    if (mYearFirst) {
      const yr = parseInt(mYearFirst[1]);
      const mIdx0 = parseInt(mYearFirst[2]) - 1;
      if (!isNaN(yr) && mIdx0 >= 0 && mIdx0 < 12) return mIdx0 >= 3 ? yr + 1 : yr;
    }
    // Excel serial number exported as a bare integer (e.g. 46357 = 2026-12-31).
    // Range 40000–60000 safely covers 2009–2064 without false-positives.
    if (/^\d+$/.test(s)) {
      const serial = parseInt(s);
      if (serial >= 40000 && serial <= 60000) {
        const d = excelSerialToDate(serial);
        const mIdx0 = d.getUTCMonth();
        const yr = d.getUTCFullYear();
        return mIdx0 >= 3 ? yr + 1 : yr;
      }
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const mIdx0 = d.getUTCMonth();
      const yr = d.getUTCFullYear();
      return mIdx0 >= 3 ? yr + 1 : yr;
    }
    return null;
  };

  // Derive a "Mon-YY" label from any date-like value (MonthYear text, Excel serial,
  // or formatted date string).  Used as a fallback when MonthYear is blank.
  const deriveMonthLabel = (raw: any): string | null => {
    if (!raw) return null;
    const s = String(raw).trim();
    if (/^[A-Za-z]{3}-\d{2,4}$/.test(s)) return s;
    if (/^\d+$/.test(s)) {
      const serial = parseInt(s);
      if (serial >= 40000 && serial <= 60000) {
        const d = excelSerialToDate(serial);
        return `${monthOrder[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
      }
    }
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      return `${monthOrder[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
    }
    return null;
  };

  const rows = data.filter((r: any) => {
    if (!r) return false;
    const kr = buildKeyMap(r);
    if (layout === "legacy") {
      const refRaw = pick(kr, "Ref");
      const ref = refRaw != null ? String(refRaw) : "";
      if (!ref || ref === "Total" || ref.startsWith("Applied filters")) return false;
      if (!pick(kr, "Group") && !pick(kr, "Project") && !pick(kr, "Tenant") && !pick(kr, "Team")) return false;
      return true;
    }
    const headerNum = pickDealRef(kr);
    const net = parseFloat(pick(kr, "NetAmount", "Net Amount", "Amount") || NaN);
    if (headerNum) diagnostics.rowsWithHeaderNumber++;
    if (!isNaN(net)) diagnostics.rowsWithNetAmount++;
    if (pick(kr, "Project")) diagnostics.rowsWithProject++;
    if (pick(kr, "Tenant")) diagnostics.rowsWithTenant++;
    if (pick(kr, "NAME", "Name")) diagnostics.rowsWithName++;
    if (pick(kr, "Agent")) diagnostics.rowsWithAgent++;
    if (!headerNum && !pick(kr, "Project") && !pick(kr, "Tenant")) return false;
    if (String(pick(kr, "Project") || "").toLowerCase() === "total") return false;
    if (!headerNum && (!net || isNaN(net))) return false;
    return true;
  }).map((r: any) => {
    const kr = buildKeyMap(r);
    if (layout === "legacy") {
      return {
        ref: pick(kr, "Ref") ? String(pick(kr, "Ref")) : null,
        groupName: pick(kr, "Group") || null,
        project: pick(kr, "Project") || null,
        tenant: pick(kr, "Tenant") || null,
        team: pick(kr, "Team") || null,
        agent: pick(kr, "Agent") || null,
        amtWip: parseFloat(pick(kr, "Amt WIP", "AmtWIP")) || 0,
        amtInvoice: parseFloat(pick(kr, "Amt invoice", "AmtInvoice")) || 0,
        month: pick(kr, "Month") || null,
        dealStatus: pick(kr, "Deal status", "DealStatus") || null,
        stage: pick(kr, "Stage") || null,
        invoiceNo: pick(kr, "InvoiceNo") ? String(pick(kr, "InvoiceNo")) : null,
        orderNumber: pick(kr, "ORDER_NUMBER", "OrderNumber") ? String(pick(kr, "ORDER_NUMBER", "OrderNumber")) : null,
        fiscalYear: parseFiscalYear(pick(kr, "Month")),
      };
    }
    upsertEnrichment(kr);
    const status = String(pick(kr, "DealStatus", "Deal Status", "Deal status") || "").toUpperCase();
    const isInvoiced = status === "SOL" || status === "SOLD" || status === "INVOICED";
    const net = parseFloat(pick(kr, "NetAmount", "Net Amount", "Amount") || 0) || 0;
    const headerNum = pickDealRef(kr);
    return {
      ref: headerNum || null,
      groupName: pick(kr, "Group") || null,
      project: pick(kr, "Project") || null,
      tenant: pick(kr, "Tenant") || pick(kr, "Client") || null,
      team: pick(kr, "Team") || null,
      agent: pick(kr, "Agent") || null,
      amtWip: isInvoiced ? 0 : net,
      amtInvoice: isInvoiced ? net : 0,
      month: pick(kr, "MonthYear", "Month Year", "Month") || deriveMonthLabel(pick(kr, "DueDate_EOMonth", "DueDate")) || null,
      dealStatus: pick(kr, "DealStatus", "Deal Status", "Deal status") || null,
      stage: pick(kr, "Stage") || pick(kr, "STOCK_CODE", "StockCode") || null,
      invoiceNo: pick(kr, "InvoiceNo") ? String(pick(kr, "InvoiceNo")) : null,
      orderNumber: pick(kr, "ORDER_NUMBER", "OrderNumber") ? String(pick(kr, "ORDER_NUMBER", "OrderNumber")) : null,
      fiscalYear: parseFiscalYear(pick(kr, "MonthYear", "Month Year", "Month") || pick(kr, "DueDate_EOMonth", "DueDate")),
    };
  });

  // Final diagnostic: how many of the rows we'll insert have a non-null
  // ref. If this is 0 the syncWipToCrmDeals step will create no deals,
  // which is the symptom the user was seeing.
  (diagnostics as any).rowsWithRefAfterMap = rows.filter((r: any) => r.ref).length;
  console.log(`[WIP Import] diagnostics: ${JSON.stringify(diagnostics)}`);

  if (rows.length === 0) {
    throw new Error(
      `Recognised layout=${layout} but every row was filtered out. ` +
      `Check that the export contains data rows (not just headers / "Applied filters" rows). ` +
      `Sample first row keys: ${rawKeys.slice(0, 8).join(", ")}.`
    );
  }

  if (layout === "sage_transactionsexpo" && (diagnostics as any).rowsWithRefAfterMap === 0) {
    throw new Error(
      `Imported ${rows.length} rows but every row has a null \`ref\` (neither HEADER_NUMBER nor Document populated). ` +
      `This means syncWipToCrmDeals would create 0 deals. Sample raw column keys we saw: ` +
      `${rawKeys.slice(0, 20).join(", ")}. ` +
      `Parser tries HEADER_NUMBER → Document → Document* (case-insensitive). If the deal ref is in a different column, tell the dev which one.`
    );
  }

  await db.transaction(async (tx) => {
    if (!opts.append) {
      await tx.delete(wipEntries);
    }
    for (let i = 0; i < rows.length; i += 100) {
      await tx.insert(wipEntries).values(rows.slice(i, i + 100));
    }
  });

  const syncResult = await syncWipToCrmDeals(pool);
  const enrichmentResult = layout === "sage_transactionsexpo"
    ? await enrichWipDealsFromSage(pool, enrichments)
    : { skipped: "legacy layout — no per-agent slice / billing entity data in this format" };

  return { success: true, imported: rows.length, layout, sync: syncResult, enrichment: enrichmentResult, diagnostics };
}

/**
 * Post-import enrichment for Sage TransactionsExpo WIP exports.
 *
 * Each Sage row is a single fee slice (Agent + NetAmount); multiple rows per
 * HEADER_NUMBER aggregate to one deal. The basic `syncWipToCrmDeals` step
 * has already created the deal records. This step layers on the
 * billing-entity / fee-split / tenant-rep relationships that Sage carries
 * but the legacy WIP report didn't expose:
 *
 *   - **Billing entity** (`NAME` + `ADDRESS_*`) → upserts a `crm_companies`
 *     row of type "Billing" and stamps it as `crm_deals.invoicing_entity_id`.
 *     Dedup by lower-cased name. The Xero contact sync layer will later
 *     populate `xero_contact_id` on these rows.
 *   - **Per-agent allocations** (`Agent` + `NetAmount`, with `STOCK_CODE`
 *     CON049 tagged as BGP House) → wipes existing `deal_fee_allocations`
 *     for the deal, then inserts one row per slice as `allocationType=fixed`
 *     `fixedAmount=NetAmount`. BGP House slices are name-tagged so the UI
 *     can colour them differently.
 *   - **Tenant-rep searches** for NEG status → upserts a `tenant_rep_searches`
 *     row keyed by dealId so each NEG deal has a kanban entry. Dedup by
 *     dealId so re-runs don't double-up.
 */
async function enrichWipDealsFromSage(
  dbPool: Pool,
  enrichments: Map<string, {
    headerNumber: string;
    billingEntity: { name: string; addressLine1?: string; addressLine2?: string; city?: string; postcode?: string } | null;
    feeSlices: Array<{ agent: string; amount: number; isBgpHouse: boolean }>;
    status: string | null;
    project: string | null;
    tenant: string | null;
    client: string | null;
  }>,
) {
  const result = {
    dealsEnriched: 0,
    billingEntitiesCreated: 0,
    billingEntitiesLinked: 0,
    allocationsCreated: 0,
    tenantRepSearchesCreated: 0,
    skippedNoDeal: 0,
  };
  if (enrichments.size === 0) return result;

  const client = await dbPool.connect();
  try {
    await client.query("BEGIN");

    // Map deals by their WIP Ref (stamped into `comments` by syncWipToCrmDeals).
    const { rows: deals } = await client.query(
      `SELECT id, comments, tenant_id FROM crm_deals WHERE comments LIKE '%WIP Ref:%'`,
    );
    const refToDeal = new Map<string, { id: string; tenantId: string | null }>();
    for (const d of deals) {
      const m = d.comments?.match(/WIP Ref:\s*(\d+)/);
      if (m) refToDeal.set(m[1], { id: d.id, tenantId: d.tenant_id });
    }

    // Cache existing companies for billing-entity dedup.
    const { rows: companies } = await client.query(
      `SELECT id, LOWER(TRIM(name)) AS name_lower FROM crm_companies`,
    );
    const compByName = new Map<string, string>();
    for (const c of companies) compByName.set(c.name_lower, c.id);

    for (const [headerNum, enrich] of enrichments) {
      const deal = refToDeal.get(headerNum);
      if (!deal) {
        result.skippedNoDeal++;
        continue;
      }
      result.dealsEnriched++;

      // 1) Billing entity ----------------------------------------------------
      if (enrich.billingEntity?.name) {
        const billingName = enrich.billingEntity.name;
        const key = billingName.toLowerCase();
        let billingId = compByName.get(key);
        if (!billingId) {
          billingId = randomUUID();
          // crm_companies stores address as a single JSONB blob — there's no
          // top-level postcode column, the postcode goes inside the JSON.
          // Earlier INSERT had `postcode = $4` and crashed every WIP import
          // with `column "postcode" of relation "crm_companies" does not exist`.
          const addressParts = [
            enrich.billingEntity.addressLine1,
            enrich.billingEntity.addressLine2,
            enrich.billingEntity.city,
            enrich.billingEntity.postcode,
          ].filter(Boolean).join(", ");
          const addressBlob = (addressParts || enrich.billingEntity.postcode)
            ? JSON.stringify({
                address: addressParts || null,
                line1: enrich.billingEntity.addressLine1 || null,
                line2: enrich.billingEntity.addressLine2 || null,
                city: enrich.billingEntity.city || null,
                postcode: enrich.billingEntity.postcode || null,
              })
            : null;
          await client.query(
            `INSERT INTO crm_companies (id, name, company_type, head_office_address, created_at, updated_at)
             VALUES ($1, $2, 'Billing', $3, NOW(), NOW())`,
            [billingId, billingName, addressBlob],
          );
          compByName.set(key, billingId);
          result.billingEntitiesCreated++;
        }
        await client.query(
          `UPDATE crm_deals SET invoicing_entity_id = $1, updated_at = NOW() WHERE id = $2`,
          [billingId, deal.id],
        );
        result.billingEntitiesLinked++;
      }

      // 2) Fee allocations ---------------------------------------------------
      // Wipe-and-replace so re-imports don't accumulate duplicates. BGP House
      // CON049 slices are tagged in the agent name so the UI can call them
      // out (the agent decode UI already handles the " (BGP House)" suffix).
      await client.query(`DELETE FROM deal_fee_allocations WHERE deal_id = $1`, [deal.id]);
      for (const slice of enrich.feeSlices) {
        if (!slice.agent || slice.amount === 0) continue;
        await client.query(
          `INSERT INTO deal_fee_allocations (id, deal_id, agent_name, allocation_type, fixed_amount, created_at)
           VALUES (gen_random_uuid(), $1, $2, 'fixed', $3, NOW())`,
          [
            deal.id,
            slice.isBgpHouse ? `${slice.agent} (BGP House)` : slice.agent,
            slice.amount,
          ],
        );
        result.allocationsCreated++;
      }

      // 3) Tenant rep searches for NEG status --------------------------------
      // Only seed once per deal; deal lead can edit downstream without us
      // overwriting on the next import.
      const isNeg = (enrich.status || "").toUpperCase() === "NEG";
      if (isNeg) {
        const { rows: existing } = await client.query(
          `SELECT id FROM tenant_rep_searches WHERE deal_id = $1 LIMIT 1`,
          [deal.id],
        );
        if (existing.length === 0) {
          const clientName = (enrich.tenant || enrich.client || enrich.project || "Unknown").trim();
          await client.query(
            `INSERT INTO tenant_rep_searches (id, client_name, company_id, deal_id, status, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, 'In Progress', NOW(), NOW())`,
            [clientName, deal.tenantId || null, deal.id],
          );
          result.tenantRepSearchesCreated++;
        }
      }
    }

    await client.query("COMMIT");
    console.log(`[WIP Enrich] ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[WIP Enrich] Error:", err);
    throw err;
  } finally {
    client.release();
  }
}

export async function syncWipToCrmDeals(dbPool: Pool) {
  const client = await dbPool.connect();
  try {
    await client.query('BEGIN');

    const { rows: deals } = await client.query(`
      SELECT 
        ref,
        MIN(group_name) as group_name,
        MIN(project) as project,
        MIN(tenant) as tenant,
        ARRAY_AGG(DISTINCT team) FILTER (WHERE team IS NOT NULL AND team != '' AND team != 'BGP') as teams,
        ARRAY_AGG(DISTINCT agent) FILTER (WHERE agent IS NOT NULL AND agent != '' AND agent != 'BGP') as agents,
        SUM(amt_wip) as total_wip,
        SUM(amt_invoice) as total_invoice,
        MIN(stage) as stage,
        MIN(deal_status) as deal_status
      FROM wip_entries
      WHERE ref IS NOT NULL AND ref != ''
      GROUP BY ref
      ORDER BY ref
    `);

    const { rows: existingProperties } = await client.query(`SELECT id, LOWER(TRIM(name)) as name_lower FROM crm_properties`);
    const propMap = new Map<string, string>();
    for (const p of existingProperties) propMap.set(p.name_lower, p.id);

    const { rows: existingCompanies } = await client.query(`SELECT id, LOWER(TRIM(name)) as name_lower FROM crm_companies`);
    const compMap = new Map<string, string>();
    for (const c of existingCompanies) compMap.set(c.name_lower, c.id);

    const { rows: existingDeals } = await client.query(`SELECT id, comments FROM crm_deals`);
    const wipRefToDealId = new Map<string, string>();
    for (const d of existingDeals) {
      const match = d.comments?.match(/WIP Ref: (\d+)/);
      if (match) wipRefToDealId.set(match[1], d.id);
    }

    let created = 0, updated = 0, propertiesCreated = 0, companiesCreated = 0;

    for (const deal of deals) {
      let propertyId: string | null = null;
      if (deal.project?.trim()) {
        const projKey = deal.project.trim().toLowerCase();
        if (propMap.has(projKey)) {
          propertyId = propMap.get(projKey)!;
        } else {
          propertyId = randomUUID();
          await client.query(
            `INSERT INTO crm_properties (id, name, status, created_at, updated_at) VALUES ($1, $2, 'Active', NOW(), NOW())`,
            [propertyId, deal.project.trim()]
          );
          propMap.set(projKey, propertyId);
          propertiesCreated++;
        }
      }

      let landlordId: string | null = null;
      if (deal.group_name?.trim()) {
        const groupKey = deal.group_name.trim().toLowerCase();
        if (compMap.has(groupKey)) {
          landlordId = compMap.get(groupKey)!;
        } else {
          landlordId = randomUUID();
          await client.query(
            `INSERT INTO crm_companies (id, name, company_type, created_at, updated_at) VALUES ($1, $2, 'Client', NOW(), NOW())`,
            [landlordId, deal.group_name.trim()]
          );
          compMap.set(groupKey, landlordId);
          companiesCreated++;
        }
      }

      let tenantId: string | null = null;
      if (deal.tenant?.trim()) {
        const tenantKey = deal.tenant.trim().toLowerCase();
        if (compMap.has(tenantKey)) {
          tenantId = compMap.get(tenantKey)!;
        } else {
          tenantId = randomUUID();
          await client.query(
            `INSERT INTO crm_companies (id, name, company_type, created_at, updated_at) VALUES ($1, $2, 'Tenant', NOW(), NOW())`,
            [tenantId, deal.tenant.trim()]
          );
          compMap.set(tenantKey, tenantId);
          companiesCreated++;
        }
      }

      const teamArr = (deal.teams || []).filter(Boolean);
      const agentArr = (deal.agents || []).filter(Boolean);
      let dealType = 'Leasing';
      if (teamArr.some((t: string) => t === 'Investment')) dealType = 'Investment';
      else if (teamArr.some((t: string) => t === 'Tenant Rep')) dealType = 'Tenant Rep';
      else if (teamArr.some((t: string) => t === 'Lease Advisory')) dealType = 'Lease Advisory';

      let status = 'Live';
      if (deal.stage === 'invoiced') status = 'Invoiced';
      else if (deal.deal_status === 'SOL') status = 'SOLs';
      else if (deal.deal_status === 'NEG') status = 'NEG';
      else if (deal.deal_status === 'EXC') status = 'Exchanged';
      else if (deal.deal_status === 'DRAFT INV' || deal.deal_status === 'DRAFT PO' || deal.deal_status === 'AWAIT PO') status = 'Invoiced';

      const dealName = `${deal.project || ''} - ${deal.tenant || ''}`;
      const fee = (deal.total_wip || 0) + (deal.total_invoice || 0);
      const comments = `WIP Ref: ${deal.ref}. WIP: £${(deal.total_wip || 0).toLocaleString()}. Invoiced: £${(deal.total_invoice || 0).toLocaleString()}. Status: ${deal.deal_status || 'N/A'}.`;
      const teamPg = `{${teamArr.map((t: string) => `"${t}"`).join(',')}}`;
      const agentPg = `{${agentArr.map((a: string) => `"${a}"`).join(',')}}`;

      if (wipRefToDealId.has(deal.ref)) {
        const existingId = wipRefToDealId.get(deal.ref)!;
        await client.query(
          `UPDATE crm_deals SET name=$1, group_name=$2, property_id=$3, landlord_id=$4, tenant_id=$5, deal_type=$6, status=$7, team=$8, internal_agent=$9, fee=$10, comments=$11, updated_at=NOW() WHERE id=$12`,
          [dealName, deal.group_name || '', propertyId, landlordId, tenantId, dealType, status, teamPg, agentPg, fee, comments, existingId]
        );
        updated++;
      } else {
        const dealId = randomUUID();
        await client.query(
          `INSERT INTO crm_deals (id, name, group_name, property_id, landlord_id, tenant_id, deal_type, status, team, internal_agent, fee, comments, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
          [dealId, dealName, deal.group_name || '', propertyId, landlordId, tenantId, dealType, status, teamPg, agentPg, fee, comments]
        );

        if (landlordId) {
          await client.query(`INSERT INTO crm_company_deals (id, company_id, deal_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [randomUUID(), landlordId, dealId]);
        }
        if (tenantId && tenantId !== landlordId) {
          await client.query(`INSERT INTO crm_company_deals (id, company_id, deal_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [randomUUID(), tenantId, dealId]);
        }
        if (propertyId && landlordId) {
          await client.query(`INSERT INTO crm_company_properties (id, company_id, property_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [randomUUID(), landlordId, propertyId]);
        }
        created++;
      }
    }

    await client.query('COMMIT');
    console.log(`[WIP Sync] Created: ${created}, Updated: ${updated}, New properties: ${propertiesCreated}, New companies: ${companiesCreated}`);
    return { created, updated, propertiesCreated, companiesCreated };
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[WIP Sync] Error:', err);
    throw err;
  } finally {
    client.release();
  }
}

export function setupCrmRoutes(app: Express) {
  // Ensure new comp columns exist (safe to re-run)
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS source_url TEXT`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS source_title TEXT`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS source_contact_id VARCHAR`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS contact_id VARCHAR`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS contact_name TEXT`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS contact_company TEXT`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS contact_phone TEXT`).catch(() => {});
  pool.query(`ALTER TABLE crm_comps ADD COLUMN IF NOT EXISTS contact_email TEXT`).catch(() => {});

  app.use("/api/crm", requireAuth);
  app.get("/api/crm/stats", async (_req, res) => {
    try {
      const stats = await storage.getCrmStats();
      res.json(stats);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/enrichment/stats", requireAuth, async (_req, res) => {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const sixMoStr = sixMonthsAgo.toISOString();

      const [contactStats] = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(last_enriched_at)::int AS enriched,
          COUNT(*) FILTER (WHERE last_enriched_at IS NULL)::int AS never_enriched,
          COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL AND last_enriched_at < $1)::int AS stale,
          COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL AND last_enriched_at >= $1)::int AS fresh,
          COUNT(*) FILTER (WHERE email IS NULL OR email = '')::int AS missing_email,
          COUNT(*) FILTER (WHERE role IS NULL OR role = '')::int AS missing_role,
          COUNT(*) FILTER (WHERE phone IS NULL OR phone = '')::int AS missing_phone,
          COUNT(*) FILTER (WHERE linkedin_url IS NULL OR linkedin_url = '')::int AS missing_linkedin
        FROM crm_contacts
      `, [sixMoStr]).then(r => r.rows);

      const [companyStats] = await pool.query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(last_enriched_at)::int AS enriched,
          COUNT(*) FILTER (WHERE last_enriched_at IS NULL)::int AS never_enriched,
          COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL AND last_enriched_at < $1)::int AS stale,
          COUNT(*) FILTER (WHERE last_enriched_at IS NOT NULL AND last_enriched_at >= $1)::int AS fresh,
          COUNT(*) FILTER (WHERE domain IS NULL OR domain = '')::int AS missing_domain,
          COUNT(*) FILTER (WHERE description IS NULL OR description = '')::int AS missing_description,
          COUNT(*) FILTER (WHERE industry IS NULL OR industry = '')::int AS missing_industry,
          COUNT(*) FILTER (WHERE phone IS NULL OR phone = '')::int AS missing_phone
        FROM crm_companies
      `, [sixMoStr]).then(r => r.rows);

      const staleContacts = await pool.query(`
        SELECT id, name, email, role, company_name, last_enriched_at, enrichment_source
        FROM crm_contacts
        WHERE last_enriched_at IS NULL OR last_enriched_at < $1
        ORDER BY last_enriched_at ASC NULLS FIRST
        LIMIT 50
      `, [sixMoStr]).then(r => r.rows);

      const staleCompanies = await pool.query(`
        SELECT id, name, domain, industry, last_enriched_at, enrichment_source
        FROM crm_companies
        WHERE last_enriched_at IS NULL OR last_enriched_at < $1
        ORDER BY last_enriched_at ASC NULLS FIRST
        LIMIT 50
      `, [sixMoStr]).then(r => r.rows);

      res.json({
        contacts: contactStats,
        companies: companyStats,
        staleContacts,
        staleCompanies,
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/duplicates/scan", async (_req, res) => {
    try {
      const [companyRows, contactEmailRows, contactNameRows, propertyRows] = await Promise.all([
        pool.query(`
          SELECT lower(trim(name)) AS key, array_agg(id) AS ids, count(*)::int AS count
          FROM crm_companies WHERE name IS NOT NULL AND trim(name) != ''
          GROUP BY lower(trim(name)) HAVING count(*) > 1
        `),
        pool.query(`
          SELECT lower(trim(email)) AS key, array_agg(id) AS ids, array_agg(name) AS names, count(*)::int AS count
          FROM crm_contacts WHERE email IS NOT NULL AND trim(email) != ''
          GROUP BY lower(trim(email)) HAVING count(*) > 1
        `),
        pool.query(`
          SELECT lower(trim(name)) AS key, array_agg(id) AS ids, array_agg(coalesce(company_name, '—')) AS companies, count(*)::int AS count
          FROM crm_contacts WHERE name IS NOT NULL AND trim(name) != '' AND lower(trim(name)) != '(agent)'
          GROUP BY lower(trim(name)) HAVING count(*) > 1
        `),
        pool.query(`
          SELECT lower(trim(name)) AS key, array_agg(id) AS ids, count(*)::int AS count
          FROM crm_properties WHERE name IS NOT NULL AND trim(name) != ''
          GROUP BY lower(trim(name)) HAVING count(*) > 1
        `),
      ]);

      const companyDupes = companyRows.rows.map((r: any) => ({ name: r.key, ids: r.ids, count: r.count }));
      const contactEmailDupes = contactEmailRows.rows.map((r: any) => ({ email: r.key, ids: r.ids, names: r.names, count: r.count }));
      const contactNameDupesList = contactNameRows.rows.map((r: any) => ({ name: r.key, ids: r.ids, companies: r.companies, count: r.count }));
      const propertyDupes = propertyRows.rows.map((r: any) => ({ name: r.key, ids: r.ids, count: r.count }));

      res.json({
        companies: { duplicates: companyDupes, count: companyDupes.length },
        contacts: {
          emailDuplicates: contactEmailDupes,
          emailCount: contactEmailDupes.length,
          nameDuplicates: contactNameDupesList,
          nameCount: contactNameDupesList.length,
        },
        properties: { duplicates: propertyDupes, count: propertyDupes.length },
        summary: {
          totalDuplicateGroups: companyDupes.length + contactEmailDupes.length + contactNameDupesList.length + propertyDupes.length,
          clean: companyDupes.length === 0 && contactEmailDupes.length === 0 && contactNameDupesList.length === 0 && propertyDupes.length === 0,
        },
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/duplicates/merge", async (req, res) => {
    try {
      const { entity, keepId, deleteIds } = req.body;
      if (!entity || !keepId || !deleteIds?.length) {
        return res.status(400).json({ error: "entity, keepId, and deleteIds required" });
      }

      const merged = await db.transaction(async (tx) => {
        let count = 0;
        for (const deleteId of deleteIds) {
          if (deleteId === keepId) continue;

          if (entity === "company") {
            await tx.update(crmContacts).set({ companyId: keepId }).where(eq(crmContacts.companyId, deleteId));
            await tx.update(crmDeals).set({ landlordId: keepId }).where(eq(crmDeals.landlordId, deleteId));
            await tx.update(crmDeals).set({ tenantId: keepId }).where(eq(crmDeals.tenantId, deleteId));
            await tx.update(crmDeals).set({ invoicingEntityId: keepId }).where(eq(crmDeals.invoicingEntityId, deleteId));
            await tx.update(crmProperties).set({ landlordId: keepId }).where(eq(crmProperties.landlordId, deleteId));
            await tx.execute(sql`UPDATE crm_company_deals SET company_id = ${keepId} WHERE company_id = ${deleteId} AND deal_id NOT IN (SELECT deal_id FROM crm_company_deals WHERE company_id = ${keepId})`);
            await tx.delete(crmCompanyDeals).where(eq(crmCompanyDeals.companyId, deleteId));
            await tx.delete(crmCompanies).where(eq(crmCompanies.id, deleteId));
            count++;
          } else if (entity === "contact") {
            await tx.update(crmRequirementsLeasing).set({ agentContactId: keepId }).where(eq(crmRequirementsLeasing.agentContactId, deleteId));
            await tx.update(crmRequirementsLeasing).set({ principalContactId: keepId }).where(eq(crmRequirementsLeasing.principalContactId, deleteId));
            await tx.update(crmDeals).set({ clientContactId: keepId }).where(eq(crmDeals.clientContactId, deleteId));
            await tx.update(crmDeals).set({ vendorAgentId: keepId }).where(eq(crmDeals.vendorAgentId, deleteId));
            await tx.update(crmDeals).set({ acquisitionAgentId: keepId }).where(eq(crmDeals.acquisitionAgentId, deleteId));
            await tx.update(crmDeals).set({ purchaserAgentId: keepId }).where(eq(crmDeals.purchaserAgentId, deleteId));
            await tx.update(crmDeals).set({ leasingAgentId: keepId }).where(eq(crmDeals.leasingAgentId, deleteId));
            await tx.execute(sql`UPDATE crm_contact_deals SET contact_id = ${keepId} WHERE contact_id = ${deleteId} AND deal_id NOT IN (SELECT deal_id FROM crm_contact_deals WHERE contact_id = ${keepId})`);
            await tx.delete(crmContactDeals).where(eq(crmContactDeals.contactId, deleteId));
            await tx.execute(sql`UPDATE crm_contact_requirements SET contact_id = ${keepId} WHERE contact_id = ${deleteId} AND requirement_id NOT IN (SELECT requirement_id FROM crm_contact_requirements WHERE contact_id = ${keepId})`);
            await tx.delete(crmContactRequirements).where(eq(crmContactRequirements.contactId, deleteId));
            await tx.execute(sql`UPDATE crm_contact_properties SET contact_id = ${keepId} WHERE contact_id = ${deleteId} AND property_id NOT IN (SELECT property_id FROM crm_contact_properties WHERE contact_id = ${keepId})`);
            await tx.delete(crmContactProperties).where(eq(crmContactProperties.contactId, deleteId));
            await tx.delete(crmContacts).where(eq(crmContacts.id, deleteId));
            count++;
          } else if (entity === "property") {
            await tx.update(crmDeals).set({ propertyId: keepId }).where(eq(crmDeals.propertyId, deleteId));
            await tx.execute(sql`UPDATE crm_property_agents SET property_id = ${keepId} WHERE property_id = ${deleteId} AND agent_id NOT IN (SELECT agent_id FROM crm_property_agents WHERE property_id = ${keepId})`);
            await tx.delete(crmPropertyAgents).where(eq(crmPropertyAgents.propertyId, deleteId));
            await tx.execute(sql`UPDATE crm_property_tenants SET property_id = ${keepId} WHERE property_id = ${deleteId} AND tenant_id NOT IN (SELECT tenant_id FROM crm_property_tenants WHERE property_id = ${keepId})`);
            await tx.delete(crmPropertyTenants).where(eq(crmPropertyTenants.propertyId, deleteId));
            await tx.execute(sql`UPDATE crm_property_clients SET property_id = ${keepId} WHERE property_id = ${deleteId} AND contact_id NOT IN (SELECT contact_id FROM crm_property_clients WHERE property_id = ${keepId})`);
            await tx.delete(crmPropertyClients).where(eq(crmPropertyClients.propertyId, deleteId));
            await tx.execute(sql`UPDATE crm_contact_properties SET property_id = ${keepId} WHERE property_id = ${deleteId} AND contact_id NOT IN (SELECT contact_id FROM crm_contact_properties WHERE property_id = ${keepId})`);
            await tx.delete(crmContactProperties).where(eq(crmContactProperties.propertyId, deleteId));
            await tx.delete(crmProperties).where(eq(crmProperties.id, deleteId));
            count++;
          }
        }
        return count;
      });

      res.json({ merged, keepId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/search", async (req, res) => {
    try {
      const q = req.query.q as string;
      if (!q) return res.json([]);
      const results = await storage.crmSearchAll(q);
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/companies", async (req, res) => {
    try {
      const scopeCompanyId = await resolveCompanyScope(req);
      const page = !scopeCompanyId && req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = !scopeCompanyId && req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        companyType: req.query.companyType as string | undefined,
        page,
        limit,
      };
      const result = await storage.getCrmCompanies(filters);
      if (scopeCompanyId) {
        const arr = Array.isArray(result) ? result : result.data;
        res.json(arr.filter((c: any) => c.id === scopeCompanyId));
      } else {
        res.json(result);
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/companies/:id", async (req, res) => {
    try {
      const company = await storage.getCrmCompany(req.params.id);
      if (!company) return res.status(404).json({ error: "Not found" });
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId && req.params.id !== scopeCompanyId) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(company);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/companies", async (req, res) => {
    try {
      const parsed = insertCrmCompanySchema.parse(req.body);
      const company = await storage.createCrmCompany(parsed);
      res.status(201).json(company);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/companies/:id", async (req, res) => {
    try {
      const company = await storage.updateCrmCompany(req.params.id, req.body);
      res.json(company);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/companies/ai-description", async (req, res) => {
    try {
      const { name, companyType, domain } = req.body;
      if (!name) return res.status(400).json({ error: "Company name is required" });

      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          {
            role: "system",
            content: "You are a UK commercial property expert. Write a brief 1-2 sentence company description for a CRM record. Focus on what the company does, their sector, and relevance to commercial property. Be factual and concise. Do not use quotation marks around the description."
          },
          {
            role: "user",
            content: `Write a brief CRM description for: ${name}${companyType ? ` (Type: ${companyType})` : ""}${domain ? ` (Website: ${domain})` : ""}`
          }
        ],
        max_completion_tokens: 150,
      });

      const description = completion.choices[0]?.message?.content?.trim() || "";
      res.json({ description });
    } catch (e: any) {
      console.error("AI description error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/crm/companies/ai-enrich", async (req, res) => {
    try {
      const { batchSize = 10 } = req.body;
      const allCompanies = await db.select().from(crmCompanies);
      const toEnrich = allCompanies.filter(c => {
        const addr = c.headOfficeAddress as { city?: string } | null;
        return !c.domainUrl || !c.description || !addr?.city;
      });

      const batch = toEnrich.slice(0, batchSize);
      if (batch.length === 0) {
        return res.json({ enriched: 0, processed: 0, total: 0, remaining: 0, results: [] });
      }

      const results: Array<{ id: string; name: string; updates: Record<string, any> }> = [];

      for (const company of batch) {
        try {
          const completion = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            messages: [
              {
                role: "system",
                content: `You are a UK commercial property data researcher. Given a company name and optional type, return a JSON object with these fields:
- "website": the company's main website URL (e.g. "https://example.com") or null if unknown
- "description": a brief 1-2 sentence description of what the company does, relevant to UK commercial property. Be factual.
- "headOfficeCity": the city where their head office is located (e.g. "London") or null if unknown

Only return the JSON object, no other text. If you're not confident about a field, set it to null rather than guessing.`
              },
              {
                role: "user",
                content: `Company: "${company.name}"${company.companyType ? ` (Type: ${company.companyType})` : ""}${company.domain ? ` (Known domain: ${company.domain})` : ""}`
              }
            ],
            max_completion_tokens: 200,
          });

          const raw = completion.choices[0]?.message?.content?.trim() || "{}";
          const data = parseAiJson(raw);
          const updates: Record<string, any> = {};

          if (data.website && !company.domainUrl) {
            updates.domainUrl = data.website;
            const domainMatch = data.website.match(/https?:\/\/(?:www\.)?([^\/]+)/);
            if (domainMatch && !company.domain) updates.domain = domainMatch[1];
          }
          if (data.description && !company.description) {
            updates.description = data.description;
          }
          if (data.headOfficeCity && !company.headOfficeAddress) {
            updates.headOfficeAddress = { city: data.headOfficeCity };
          }

          if (Object.keys(updates).length > 0) {
            updates.updatedAt = new Date();
            updates.lastEnrichedAt = new Date();
            updates.enrichmentSource = "ai-openai";
            await db.update(crmCompanies).set(updates).where(eq(crmCompanies.id, company.id));
            results.push({ id: company.id, name: company.name, updates });
          }
        } catch (err: any) {
          console.error(`AI enrich failed for ${company.name}:`, err.message);
        }
      }

      const remaining = Math.max(0, toEnrich.length - batch.length);
      res.json({
        enriched: results.length,
        processed: batch.length,
        total: toEnrich.length,
        remaining,
        results,
      });
    } catch (e: any) {
      console.error("AI enrich error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/crm/contacts/ai-enrich", async (req, res) => {
    try {
      const { batchSize = 10 } = req.body;
      const allContacts = await db.select().from(crmContacts);
      const companies = await db.select().from(crmCompanies);
      const companyMap = new Map(companies.map(c => [c.id, c]));

      const toEnrich = allContacts.filter(c => !c.role && c.name !== "(agent)" && c.companyId);
      const batch = toEnrich.slice(0, batchSize);

      if (batch.length === 0) {
        return res.json({ enriched: 0, processed: 0, total: 0, remaining: 0, results: [] });
      }

      const results: Array<{ id: string; name: string; updates: Record<string, any> }> = [];

      for (const contact of batch) {
        try {
          const company = contact.companyId ? companyMap.get(contact.companyId) : null;
          const completion = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            messages: [
              {
                role: "system",
                content: `You are a UK commercial property data researcher. Given a person's name and their company, suggest their likely job title/role. Return a JSON object with:
- "role": their likely job title (e.g. "Director", "Head of Acquisitions", "Senior Surveyor") or null if you can't determine it

Only return the JSON object. If uncertain, return {"role": null}.`
              },
              {
                role: "user",
                content: `Person: "${contact.name}" at company "${company?.name || contact.companyName || 'Unknown'}"${company?.companyType ? ` (${company.companyType} company)` : ""}${contact.contactType ? ` (Contact type: ${contact.contactType})` : ""}`
              }
            ],
            max_completion_tokens: 50,
            response_format: { type: "json_object" },
          });

          const raw = completion.choices[0]?.message?.content?.trim() || "{}";
          const data = parseAiJson(raw);

          if (data.role) {
            await db.update(crmContacts).set({ role: data.role, updatedAt: new Date(), lastEnrichedAt: new Date(), enrichmentSource: "ai-openai" }).where(eq(crmContacts.id, contact.id));
            results.push({ id: contact.id, name: contact.name, updates: { role: data.role } });
          }
        } catch (err: any) {
          console.error(`AI enrich failed for contact ${contact.name}:`, err.message);
        }
      }

      const remaining = Math.max(0, toEnrich.length - batch.length);
      res.json({
        enriched: results.length,
        processed: batch.length,
        total: toEnrich.length,
        remaining,
        results,
      });
    } catch (e: any) {
      console.error("AI contact enrich error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/crm/companies/:id", async (req, res) => {
    try {
      await storage.deleteCrmCompany(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/contacts", async (req, res) => {
    try {
      const scopeCompanyId = await resolveCompanyScope(req);
      const page = req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        companyId: scopeCompanyId || (req.query.companyId as string | undefined),
        contactType: req.query.contactType as string | undefined,
        bgpAllocation: req.query.bgpAllocation as string | undefined,
        page,
        limit,
      };
      const contacts = await storage.getCrmContacts(filters);
      res.json(contacts);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/contacts/:id", async (req, res) => {
    try {
      const contact = await storage.getCrmContact(req.params.id);
      if (!contact) return res.status(404).json({ error: "Not found" });
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId && !(await isContactInScope(scopeCompanyId, req.params.id))) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(contact);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/contacts", async (req, res) => {
    try {
      const parsed = insertCrmContactSchema.parse(req.body);
      const contact = await storage.createCrmContact(parsed);
      res.status(201).json(contact);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/contacts/:id", async (req, res) => {
    try {
      const contact = await storage.updateCrmContact(req.params.id, req.body);
      res.json(contact);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/contacts/:id", async (req, res) => {
    try {
      await storage.deleteCrmContact(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.patch("/api/crm/contacts/:id/favourite", async (req, res) => {
    try {
      const { isFavourite } = req.body;
      const contact = await storage.updateCrmContact(req.params.id, { isFavourite: !!isFavourite });
      res.json(contact);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/contacts/import-vcf", async (req, res) => {
    try {
      const { vcfText } = req.body;
      if (!vcfText || typeof vcfText !== "string") {
        return res.status(400).json({ error: "vcfText is required" });
      }
      const cards = vcfText.split("END:VCARD").filter(c => c.includes("BEGIN:VCARD")).map(c => c + "END:VCARD");
      const parsed: Array<{ name: string; email: string | null; phone: string | null; company: string | null; role: string | null }> = [];
      for (const card of cards) {
        const lines = card.split(/\r?\n/);
        let fn = "", email = "", phone = "", org = "", title = "";
        for (const line of lines) {
          const upper = line.toUpperCase();
          if (upper.startsWith("FN:") || upper.startsWith("FN;")) {
            fn = line.substring(line.indexOf(":") + 1).trim();
          } else if (upper.startsWith("EMAIL") && line.includes(":")) {
            if (!email) email = line.substring(line.indexOf(":") + 1).trim();
          } else if ((upper.startsWith("TEL") || upper.startsWith("PHONE")) && line.includes(":")) {
            if (!phone) phone = line.substring(line.indexOf(":") + 1).trim();
          } else if (upper.startsWith("ORG") && line.includes(":")) {
            org = line.substring(line.indexOf(":") + 1).replace(/;/g, " ").trim();
          } else if (upper.startsWith("TITLE") && line.includes(":")) {
            title = line.substring(line.indexOf(":") + 1).trim();
          } else if (!fn && upper.startsWith("N:")) {
            const parts = line.substring(2).split(";");
            fn = [parts[1], parts[0]].filter(Boolean).join(" ").trim();
          }
        }
        if (fn) {
          parsed.push({ name: fn, email: email || null, phone: phone || null, company: org || null, role: title || null });
        }
      }
      if (parsed.length === 0) {
        return res.json({ imported: 0, skippedPersonal: 0, skippedDuplicate: 0, totalParsed: 0, contacts: [], personalContacts: [] });
      }

      const personalDomains = ["gmail.com","yahoo.com","hotmail.com","outlook.com","icloud.com","me.com","aol.com","live.com","msn.com","protonmail.com","btinternet.com","sky.com","virginmedia.com","talktalk.net","ntlworld.com","btopenworld.com","blueyonder.co.uk","googlemail.com","mail.com","pm.me","fastmail.com","ymail.com","rocketmail.com"];
      const personalKeywords = ["mum","dad","mom","mother","father","wife","husband","partner","brother","sister","aunt","uncle","nan","grandma","grandpa","cousin","babysitter","nanny","doctor","dentist","physio","plumber","electrician","builder","cleaner","gardener","hairdresser","barber","vet","personal trainer","pt ","gym","yoga","school","nursery"];

      const classified = parsed.map(c => {
        let isPersonal = false;
        if (c.email) {
          const domain = c.email.split("@")[1]?.toLowerCase();
          if (domain && personalDomains.includes(domain) && !c.company) isPersonal = true;
        }
        if (!c.company && !c.role && !c.email) isPersonal = true;
        const nameLower = (c.name + " " + (c.role || "")).toLowerCase();
        if (personalKeywords.some(k => nameLower.includes(k))) isPersonal = true;
        if (c.company && c.company.length > 1) isPersonal = false;
        return { ...c, isPersonal };
      });

      const businessContacts = classified.filter(c => !c.isPersonal);
      const existing = await storage.getCrmContacts({});
      const existingNames = new Set(existing.map((e: any) => e.name?.toLowerCase().trim()));
      const existingEmails = new Set(existing.filter((e: any) => e.email).map((e: any) => e.email!.toLowerCase().trim()));

      const newContacts: typeof businessContacts = [];
      const duplicates: typeof businessContacts = [];
      const seenNames = new Set(existingNames);
      const seenEmails = new Set(existingEmails);
      for (const c of businessContacts) {
        const nameLc = c.name.toLowerCase().trim();
        const emailLc = c.email?.toLowerCase().trim();
        const nameDup = seenNames.has(nameLc);
        const emailDup = emailLc && seenEmails.has(emailLc);
        if (nameDup || emailDup) {
          duplicates.push(c);
        } else {
          newContacts.push(c);
          seenNames.add(nameLc);
          if (emailLc) seenEmails.add(emailLc);
        }
      }

      const imported: any[] = [];
      for (const c of newContacts) {
        const contact = await storage.createCrmContact({
          name: c.name,
          email: c.email,
          phone: c.phone,
          companyName: c.company,
          role: c.role,
          contactType: "Business",
          isFavourite: false,
        });
        imported.push(contact);
      }

      res.json({
        imported: imported.length,
        skippedPersonal: classified.filter(c => c.isPersonal).length,
        skippedDuplicate: duplicates.length,
        totalParsed: parsed.length,
        contacts: imported,
        personalContacts: classified.filter(c => c.isPersonal).map(c => c.name),
      });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties", async (req, res) => {
    try {
      const scopeCompanyId = await resolveCompanyScope(req);
      const page = !scopeCompanyId && req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = !scopeCompanyId && req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        status: req.query.status as string | undefined,
        assetClass: req.query.assetClass as string | undefined,
        bgpEngagement: req.query.bgpEngagement as string | undefined,
        page,
        limit,
      };
      const result = await storage.getCrmProperties(filters);
      if (scopeCompanyId) {
        const linkedResult = await pool.query(
          `SELECT property_id AS pid FROM crm_company_properties WHERE company_id = $1
           UNION
           SELECT id AS pid FROM crm_properties WHERE landlord_id = $1`,
          [scopeCompanyId]
        );
        const linkedPropertyIds = new Set(linkedResult.rows.map((r: any) => r.pid));
        const arr = Array.isArray(result) ? result : result.data;
        res.json(arr.filter((p: any) => linkedPropertyIds.has(p.id)));
      } else {
        res.json(result);
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties/:id", async (req, res) => {
    try {
      const property = await storage.getCrmProperty(req.params.id);
      if (!property) return res.status(404).json({ error: "Not found" });
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId && !(await isPropertyInScope(scopeCompanyId, req.params.id))) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(property);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties", async (req, res) => {
    try {
      const parsed = insertCrmPropertySchema.parse(req.body);
      const property = await storage.createCrmProperty(parsed);
      res.status(201).json(property);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/properties/:id", async (req, res) => {
    try {
      const updates = { ...req.body };
      const dateFields = ["titleSearchDate", "createdAt", "updatedAt", "kycCheckedAt"];
      for (const f of dateFields) {
        if (updates[f] && typeof updates[f] === "string") {
          updates[f] = new Date(updates[f]);
        }
      }
      const property = await storage.updateCrmProperty(req.params.id, updates);
      res.json(property);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/properties/:id", async (req, res) => {
    try {
      await storage.deleteCrmProperty(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties/bulk-update", requireAuth, async (req, res) => {
    try {
      const { ids, field, value } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
      const allowedFields = ["bgpEngagement", "status", "assetClass", "tenure"];
      if (!allowedFields.includes(field)) return res.status(400).json({ error: `Field '${field}' not allowed for bulk update` });
      for (const id of ids) {
        await storage.updateCrmProperty(id, { [field]: value });
      }
      res.json({ ok: true, updated: ids.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
      for (const id of ids) {
        await storage.deleteCrmProperty(id);
      }
      res.json({ ok: true, deleted: ids.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/deals/bulk-update", requireAuth, async (req, res) => {
    try {
      const { ids, field, value } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
      const allowedFields = ["team", "status", "dealType", "assetClass"];
      if (!allowedFields.includes(field)) return res.status(400).json({ error: `Field '${field}' not allowed for bulk update` });
      for (const id of ids) {
        await storage.updateCrmDeal(id, { [field]: value });
      }
      res.json({ ok: true, updated: ids.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/deals/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: "ids array required" });
      for (const id of ids) {
        await storage.deleteCrmDeal(id);
      }
      res.json({ ok: true, deleted: ids.length });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/company-property-links", async (_req, res) => {
    try {
      const links = await storage.getAllCompanyPropertyLinks();
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/companies/:id/properties", async (req, res) => {
    try {
      const properties = await storage.getCompanyProperties(req.params.id);
      res.json(properties);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/companies/:id/properties", async (req, res) => {
    try {
      const { propertyId } = req.body;
      if (!propertyId) return res.status(400).json({ error: "propertyId required" });
      await storage.linkCompanyProperty(req.params.id, propertyId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/companies/:id/properties/:propertyId", async (req, res) => {
    try {
      await storage.unlinkCompanyProperty(req.params.id, req.params.propertyId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/company-deal-links", async (_req, res) => {
    try {
      const links = await storage.getAllCompanyDealLinks();
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/companies/:id/deals", async (req, res) => {
    try {
      const deals = await storage.getCompanyDeals(req.params.id);
      res.json(deals);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/companies/:id/deals", async (req, res) => {
    try {
      const { dealId } = req.body;
      if (!dealId) return res.status(400).json({ error: "dealId required" });
      await storage.linkCompanyDeal(req.params.id, dealId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/companies/:id/deals/:dealId", async (req, res) => {
    try {
      await storage.unlinkCompanyDeal(req.params.id, req.params.dealId);
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties/:id/deals", async (req, res) => {
    try {
      const deals = await storage.getCrmDeals({ propertyId: req.params.id });
      res.json(deals);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/property-deal-links", async (req, res) => {
    try {
      const deals = await db.select({
        id: crmDeals.id,
        name: crmDeals.name,
        propertyId: crmDeals.propertyId,
        status: crmDeals.status,
        groupName: crmDeals.groupName,
      }).from(crmDeals).where(isNotNull(crmDeals.propertyId));
      res.json(deals);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/property-agents", async (req, res) => {
    try {
      const links = await db.select().from(crmPropertyAgents);
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties/:id/agents", async (req, res) => {
    try {
      const links = await db.select().from(crmPropertyAgents).where(eq(crmPropertyAgents.propertyId, req.params.id));
      const userIds = links.map(l => l.userId).filter(Boolean);
      if (userIds.length === 0) return res.json([]);
      const agentUsers = await db.select().from(users).where(inArray(users.id, userIds as any[]));
      res.json(agentUsers);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties/:id/agents", async (req, res) => {
    try {
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: "userId required" });
      const existing = await db.select().from(crmPropertyAgents).where(and(eq(crmPropertyAgents.propertyId, req.params.id), eq(crmPropertyAgents.userId, userId)));
      if (existing.length > 0) return res.json(existing[0]);
      const [link] = await db.insert(crmPropertyAgents).values({ propertyId: req.params.id, userId }).returning();
      res.json(link);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/properties/:id/agents/:userId", async (req, res) => {
    try {
      await db.delete(crmPropertyAgents).where(and(eq(crmPropertyAgents.propertyId, req.params.id), eq(crmPropertyAgents.userId, req.params.userId)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/property-tenants", async (req, res) => {
    try {
      const links = await db.select().from(crmPropertyTenants);
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties/:id/tenants", async (req, res) => {
    try {
      const links = await db.select().from(crmPropertyTenants).where(eq(crmPropertyTenants.propertyId, req.params.id));
      const companyIds = links.map(l => l.companyId).filter(Boolean);
      if (companyIds.length === 0) return res.json([]);
      const companies = await db.select().from(crmCompanies).where(inArray(crmCompanies.id, companyIds));
      res.json(companies);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties/:id/tenants", async (req, res) => {
    try {
      const { companyId } = req.body;
      if (!companyId) return res.status(400).json({ error: "companyId required" });
      const existing = await db.select().from(crmPropertyTenants).where(and(eq(crmPropertyTenants.propertyId, req.params.id), eq(crmPropertyTenants.companyId, companyId)));
      if (existing.length > 0) return res.json(existing[0]);
      const [link] = await db.insert(crmPropertyTenants).values({ propertyId: req.params.id, companyId }).returning();
      res.json(link);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/properties/:id/tenants/:companyId", async (req, res) => {
    try {
      await db.delete(crmPropertyTenants).where(and(eq(crmPropertyTenants.propertyId, req.params.id), eq(crmPropertyTenants.companyId, req.params.companyId)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/properties/:id/clients", async (req, res) => {
    try {
      const links = await db.select().from(crmPropertyClients).where(eq(crmPropertyClients.propertyId, req.params.id));
      const contactIds = links.map(l => l.contactId);
      let contacts: any[] = [];
      if (contactIds.length > 0) {
        contacts = await db.select().from(crmContacts).where(inArray(crmContacts.id, contactIds));
      }
      const result = links.map(l => {
        const contact = contacts.find(c => c.id === l.contactId);
        return { ...l, contact };
      });
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/properties/:id/clients", async (req, res) => {
    try {
      const { contactId, role } = req.body;
      const [link] = await db.insert(crmPropertyClients).values({
        propertyId: req.params.id,
        contactId,
        role: role || null,
      }).onConflictDoNothing().returning();
      res.json(link || { exists: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/crm/properties/:id/clients/:clientId", async (req, res) => {
    try {
      const { role } = req.body;
      const [updated] = await db.update(crmPropertyClients)
        .set({ role })
        .where(eq(crmPropertyClients.id, req.params.clientId))
        .returning();
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/properties/:id/clients/:clientId", async (req, res) => {
    try {
      await db.delete(crmPropertyClients).where(eq(crmPropertyClients.id, req.params.clientId));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/deals", async (req, res) => {
    try {
      const scopeCompanyId = await resolveCompanyScope(req);
      const page = !scopeCompanyId && req.query.page ? parseInt(req.query.page as string) : undefined;
      const limit = !scopeCompanyId && req.query.limit ? parseInt(req.query.limit as string) : undefined;
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        status: req.query.status as string | undefined,
        team: req.query.team as string | undefined,
        dealType: req.query.dealType as string | undefined,
        propertyId: req.query.propertyId as string | undefined,
        excludeTrackerDeals: req.query.excludeTrackerDeals === "true",
        page,
        limit,
      };
      const result = await storage.getCrmDeals(filters);
      if (scopeCompanyId) {
        const linkedResult = await pool.query(
          `SELECT deal_id FROM crm_company_deals WHERE company_id = $1`,
          [scopeCompanyId]
        );
        const linkedDealIds = new Set(linkedResult.rows.map((r: any) => r.deal_id));
        const scopeFilter = (d: any) =>
          d.landlordId === scopeCompanyId ||
          d.tenantId === scopeCompanyId ||
          d.vendorId === scopeCompanyId ||
          d.purchaserId === scopeCompanyId ||
          linkedDealIds.has(d.id);
        const arr = Array.isArray(result) ? result : result.data;
        res.json(arr.filter(scopeFilter));
      } else {
        res.json(result);
      }
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/deals/:id", async (req, res) => {
    try {
      const deal = await storage.getCrmDeal(req.params.id);
      if (!deal) return res.status(404).json({ error: "Not found" });
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId && !(await isDealInScope(scopeCompanyId, req.params.id))) {
        return res.status(403).json({ error: "Access denied" });
      }
      res.json(deal);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/deals", async (req, res) => {
    try {
      const parsed = insertCrmDealSchema.parse(req.body);
      const deal = await storage.createCrmDeal(parsed);

      const ra = calculateRentAnalysis(deal);
      const { pricePsf, priceItza } = calculateDevaluation(deal);
      const updates: string[] = [];
      const vals: any[] = [deal.id];
      let idx = 2;
      if (ra !== null) { updates.push(`rent_analysis = $${idx++}`); vals.push(ra); }
      if (pricePsf !== null) { updates.push(`price_psf = $${idx++}`); vals.push(pricePsf); }
      if (priceItza !== null) { updates.push(`price_itza = $${idx++}`); vals.push(priceItza); }
      if (updates.length > 0) {
        await pool.query(`UPDATE crm_deals SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1`, vals);
        if (ra !== null) (deal as any).rentAnalysis = ra;
        if (pricePsf !== null) (deal as any).pricePsf = pricePsf;
        if (priceItza !== null) (deal as any).priceItza = priceItza;
      }

      res.status(201).json(deal);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  function calculateRentAnalysis(deal: { rentPa?: number | null; rentFree?: number | null; leaseLength?: number | null; capitalContribution?: number | null; totalAreaSqft?: number | null }): number | null {
    const rentPa = deal.rentPa;
    const leaseYears = deal.leaseLength;
    if (!rentPa || rentPa <= 0 || !leaseYears || leaseYears <= 0) return null;

    const totalMonths = leaseYears * 12;
    const rentFreeMonths = deal.rentFree || 0;
    const capContrib = deal.capitalContribution || 0;
    const payingMonths = Math.max(totalMonths - rentFreeMonths, 0);
    const totalRentOverLease = (rentPa / 12) * payingMonths;
    const netRentOverLease = totalRentOverLease - capContrib;
    const nerPa = (netRentOverLease / totalMonths) * 12;

    const area = deal.totalAreaSqft;
    if (area && area > 0) {
      return Math.round((nerPa / area) * 100) / 100;
    }
    return Math.round(nerPa * 100) / 100;
  }

  function calculateDevaluation(deal: { rentPa?: number | null; totalAreaSqft?: number | null; itzaAreaSqft?: number | null }): { pricePsf: number | null; priceItza: number | null } {
    const rentPa = deal.rentPa;
    if (!rentPa || rentPa <= 0) return { pricePsf: null, priceItza: null };

    const totalArea = deal.totalAreaSqft;
    const itza = deal.itzaAreaSqft;
    const pricePsf = totalArea && totalArea > 0 ? Math.round((rentPa / totalArea) * 100) / 100 : null;
    const priceItza = itza && itza > 0 ? Math.round((rentPa / itza) * 100) / 100 : null;
    return { pricePsf, priceItza };
  }

  app.put("/api/crm/deals/:id", async (req, res) => {
    try {
      const oldDeal = await storage.getCrmDeal(req.params.id);

      // --- Resolve current user for audit + approval ---
      const userId = (req as any).session?.userId || (req as any).tokenUserId;
      let changedByName = "Unknown";
      let changedByEmail = "";
      let isUserAdmin = false;
      if (userId) {
        const uRes = await pool.query(`SELECT name, email, username, is_admin FROM users WHERE id = $1 LIMIT 1`, [userId]);
        if (uRes.rows[0]) {
          changedByName = uRes.rows[0].name || uRes.rows[0].email || uRes.rows[0].username;
          changedByEmail = (uRes.rows[0].email || "").toLowerCase();
          isUserAdmin = !!uRes.rows[0].is_admin;
        }
      }

      // --- Approval gate for Invoiced / Completed ---
      const APPROVAL_STATUSES = ["Invoiced", "Completed"];
      const SENIOR_EMAILS = new Set([
        "woody@brucegillinghampollard.com",
        "charlotte@brucegillinghampollard.com",
        "rupert@brucegillinghampollard.com",
        "jack@brucegillinghampollard.com",
      ]);
      const isSenior = isUserAdmin || SENIOR_EMAILS.has(changedByEmail);
      if (req.body.status && oldDeal && oldDeal.status !== req.body.status && APPROVAL_STATUSES.includes(req.body.status)) {
        if (!isSenior) {
          // Log the rejected attempt
          try {
            await db.insert(dealAuditLog).values({
              dealId: req.params.id,
              field: "status",
              oldValue: oldDeal.status || null,
              newValue: req.body.status,
              reason: `Approval rejected — ${changedByName} is not a senior approver`,
              changedBy: userId || null,
              changedByName,
            });
          } catch (_) {}
          return res.status(403).json({ error: `Senior approval required to mark deals as ${req.body.status}` });
        }
      }

      if (req.body.kycApproved === true && !oldDeal?.kycApproved) {
        req.body.kycApprovedAt = new Date();
        req.body.kycApprovedBy = changedByName;
      }

      // Auto-detect EDD requirement based on deal value and risk factors
      if (req.body.pricing !== undefined || req.body.amlPepStatus !== undefined) {
        const pricing = req.body.pricing ?? oldDeal?.pricing ?? 0;
        const pepStatus = req.body.amlPepStatus ?? oldDeal?.amlPepStatus;
        const assetClass = req.body.assetClass ?? oldDeal?.assetClass ?? "";
        const isLondon = (oldDeal?.name || "").toLowerCase().includes("london") || assetClass.toLowerCase().includes("london");
        const superPrimeThreshold = isLondon ? 5_000_000 : 1_000_000;
        const eddReasons: string[] = [];
        if (pricing >= superPrimeThreshold) eddReasons.push("super_prime");
        if (pepStatus && pepStatus !== "clear") eddReasons.push("pep");
        if (eddReasons.length > 0 && !oldDeal?.amlEddRequired) {
          req.body.amlEddRequired = true;
          req.body.amlEddReason = eddReasons.join(",");
        }
      }

      if (req.body.amlEddCompletedAt === undefined && req.body.amlEddNotes && !oldDeal?.amlEddCompletedAt) {
        req.body.amlEddCompletedAt = new Date();
        req.body.amlEddCompletedBy = changedByName;
      }

      // --- Audit: compare fields before applying update ---
      const auditFields = [
        "status", "fee", "internalAgent", "team", "dealType", "name", "pricing",
        "yieldPercent", "feeAgreement", "rentPa", "capitalContribution", "rentFree",
        "leaseLength", "breakOption", "completionDate", "tenureText", "assetClass",
        "comments", "amlCheckCompleted", "totalAreaSqft", "basementAreaSqft",
        "gfAreaSqft", "ffAreaSqft", "itzaAreaSqft", "propertyId", "landlordId",
        "tenantId", "vendorId", "purchaserId", "invoicingEntityId", "kycApproved",
        "feePercentage", "completionTiming", "invoicingNotes", "poNumber",
        "amlRiskLevel", "amlSourceOfFunds", "amlSourceOfWealth", "amlPepStatus",
        "amlEddRequired", "amlIdVerified", "amlAddressVerified", "amlSarFiled",
      ];
      const auditInserts: { dealId: string; field: string; oldValue: string | null; newValue: string | null; reason: string | null; changedBy: string | null; changedByName: string }[] = [];
      if (oldDeal) {
        for (const field of auditFields) {
          if (req.body[field] === undefined) continue;
          const oldVal = (oldDeal as any)[field];
          const newVal = req.body[field];
          const oldStr = oldVal == null ? null : Array.isArray(oldVal) ? oldVal.join(", ") : String(oldVal);
          const newStr = newVal == null ? null : Array.isArray(newVal) ? newVal.join(", ") : String(newVal);
          if (oldStr === newStr) continue;
          auditInserts.push({
            dealId: req.params.id,
            field,
            oldValue: oldStr,
            newValue: newStr,
            reason: field === "status" ? (req.body.changeReason || null) : null,
            changedBy: userId || null,
            changedByName,
          });
        }
      }
      // Insert audit rows (non-blocking)
      if (auditInserts.length > 0) {
        db.insert(dealAuditLog).values(auditInserts).catch((err: any) => {
          console.error("[deal-audit] Error inserting audit log:", err?.message);
        });
      }

      // Knowledge capture — on transition to Completed, if a `learning`
      // note was posted with the update, persist it as a brand_signals row
      // against the tenant so the brand card shows our deal learnings.
      const completing = req.body.status === "Completed" && oldDeal?.status !== "Completed";
      const learning: string | null = typeof req.body?.learning === "string"
        ? req.body.learning.trim().slice(0, 2000) || null
        : null;
      if (completing && learning && oldDeal?.tenantId) {
        try {
          await pool.query(
            `INSERT INTO brand_signals
              (brand_company_id, signal_type, headline, detail, source, signal_date, magnitude, sentiment, ai_generated)
              VALUES ($1, 'news', $2, $3, $4, now(), 'medium', 'positive', false)`,
            [
              oldDeal.tenantId,
              `Deal learning: ${oldDeal.name || req.params.id}`.slice(0, 500),
              learning,
              `bgp-deal:${req.params.id}`,
            ]
          );
        } catch (e: any) {
          console.warn("[deal-learning] capture failed:", e?.message);
        }
      }
      // Strip `learning` from body so it doesn't hit the generic updater
      if ("learning" in req.body) delete req.body.learning;

      const deal = await storage.updateCrmDeal(req.params.id, req.body);

      const rentFields = ["rentPa", "rentFree", "leaseLength", "capitalContribution", "totalAreaSqft"];
      if (rentFields.some(f => req.body[f] !== undefined)) {
        const ra = calculateRentAnalysis(deal);
        if (ra !== null && ra !== deal.rentAnalysis) {
          await pool.query(`UPDATE crm_deals SET rent_analysis = $2, updated_at = NOW() WHERE id = $1`, [deal.id, ra]);
          (deal as any).rentAnalysis = ra;
        }
      }

      const devalFields = ["rentPa", "totalAreaSqft", "basementAreaSqft", "gfAreaSqft", "ffAreaSqft", "itzaAreaSqft"];
      if (devalFields.some(f => req.body[f] !== undefined)) {
        const { pricePsf, priceItza } = calculateDevaluation(deal);
        const updates: string[] = [];
        const vals: any[] = [deal.id];
        let idx = 2;
        if (pricePsf !== deal.pricePsf) {
          updates.push(`price_psf = $${idx++}`);
          vals.push(pricePsf);
        }
        if (priceItza !== deal.priceItza) {
          updates.push(`price_itza = $${idx++}`);
          vals.push(priceItza);
        }
        if (updates.length > 0) {
          await pool.query(`UPDATE crm_deals SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $1`, vals);
          (deal as any).pricePsf = pricePsf;
          (deal as any).priceItza = priceItza;
        }
      }

      if (req.body.team && deal.propertyId) {
        const dealTeams: string[] = Array.isArray(deal.team) ? deal.team : [];
        if (dealTeams.length > 0) {
          const [prop] = await db.select().from(crmProperties).where(eq(crmProperties.id, deal.propertyId)).limit(1);
          if (prop) {
            const existing = new Set(prop.bgpEngagement || []);
            let changed = false;
            for (const t of dealTeams) {
              if (!existing.has(t)) { existing.add(t); changed = true; }
            }
            if (changed) {
              await db.update(crmProperties)
                .set({ bgpEngagement: Array.from(existing), updatedAt: new Date() })
                .where(eq(crmProperties.id, deal.propertyId));
            }
          }
        }
      }

      const isInvestmentTeam = (Array.isArray(deal.team) ? deal.team : []).some(t => t?.toLowerCase() === "investment");
      const completedStatuses = ["Exchanged", "Completed", "Investment Comps"];
      const statusChanged = req.body.status && oldDeal && oldDeal.status !== req.body.status;
      const nowComplete = completedStatuses.includes(deal.status || "");

      const WIP_STATUSES = ["SOLs", "Invoiced", "Exchanged", "Billed", "Completed", "Investment Comps"];
      if (statusChanged && WIP_STATUSES.includes(deal.status || "")) {
        try {
          await db.delete(availableUnits).where(eq(availableUnits.dealId, deal.id));
        } catch (_) {}
      }

      if (statusChanged && nowComplete) {
        if (isInvestmentTeam) {
          try {
            const existing = await db.select().from(investmentComps)
              .where(eq(investmentComps.rcaDealId, `bgp-${deal.id}`)).limit(1);

            if (existing.length === 0) {
              let propertyName = deal.name;
              let address = "";
              let city = "";
              let postalCode = "";

              if (deal.propertyId) {
                const [prop] = await db.select().from(crmProperties).where(eq(crmProperties.id, deal.propertyId)).limit(1);
                if (prop) {
                  propertyName = prop.name || deal.name;
                  const addr = typeof prop.address === "object" && prop.address ? prop.address as Record<string, any> : {};
                  address = addr.street || addr.line1 || addr.address || "";
                  city = addr.city || addr.town || "";
                  postalCode = addr.postcode || addr.postalCode || addr.zip || "";
                }
              }

              let buyerName = "";
              let sellerName = "";
              if (deal.purchaserId) {
                const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, deal.purchaserId)).limit(1);
                if (co) buyerName = co.name;
              }
              if (deal.vendorId) {
                const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, deal.vendorId)).limit(1);
                if (co) sellerName = co.name;
              }

              await db.insert(investmentComps).values({
                rcaDealId: `bgp-${deal.id}`,
                status: "Sale",
                transactionType: deal.dealType || "Sale",
                propertyName,
                address,
                city,
                postalCode,
                price: deal.pricing || null,
                pricePsf: deal.pricePsf || null,
                capRate: deal.yieldPercent ? deal.yieldPercent / 100 : null,
                areaSqft: deal.totalAreaSqft || null,
                transactionDate: deal.completionDate || new Date().toISOString().split("T")[0],
                buyer: buyerName || null,
                seller: sellerName || null,
                comments: deal.comments || null,
                source: "BGP",
              });
              console.log(`Auto-promoted investment deal ${deal.id} to Investment Comps`);
            }
          } catch (compErr: any) {
            console.error("Investment Comps auto-promotion error:", compErr.message);
          }
        }

        if (!isInvestmentTeam) {
          if (deal.groupName !== "Leasing - Invoiced") {
            try {
              await db.update(crmDeals)
                .set({ groupName: "Leasing - Invoiced", updatedAt: new Date() })
                .where(eq(crmDeals.id, deal.id));
              console.log(`Auto-moved deal ${deal.id} to Leasing Comps (Leasing - Invoiced)`);
            } catch (moveErr: any) {
              console.error("Leasing Comps auto-move error:", moveErr.message);
            }
          }

          try {
            const existingComp = await db.select({ id: crmComps.id })
              .from(crmComps)
              .where(eq(crmComps.dealId, deal.id))
              .limit(1);

            if (existingComp.length === 0) {
              let propertyName = deal.name;
              let propPostcode = "";
              let propAreaLocation = "";

              if (deal.propertyId) {
                const [prop] = await db.select().from(crmProperties).where(eq(crmProperties.id, deal.propertyId)).limit(1);
                if (prop) {
                  propertyName = prop.name || deal.name;
                  const addr = typeof prop.address === "object" && prop.address ? prop.address as Record<string, any> : {};
                  propPostcode = addr.postcode || addr.postalCode || "";
                  propAreaLocation = addr.city || addr.area || "";
                }
              }

              let tenantName = "";
              let landlordName = "";
              if (deal.tenantId) {
                const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, deal.tenantId)).limit(1);
                if (co) tenantName = co.name;
              }
              if (deal.landlordId) {
                const [co] = await db.select().from(crmCompanies).where(eq(crmCompanies.id, deal.landlordId)).limit(1);
                if (co) landlordName = co.name;
              }

              const totalArea = deal.totalAreaSqft || null;
              const itza = deal.itzaAreaSqft || null;

              await db.insert(crmComps).values({
                name: propertyName || "Untitled",
                dealId: deal.id,
                propertyId: deal.propertyId || null,
                tenant: tenantName || null,
                landlord: landlordName || null,
                transactionType: deal.dealType || null,
                headlineRent: deal.rentPa ? String(deal.rentPa) : null,
                areaSqft: totalArea ? String(totalArea) : null,
                itzaSqft: itza ? String(itza) : null,
                groundFloorSqft: deal.gfAreaSqft ? String(deal.gfAreaSqft) : null,
                upperFloorSqft: deal.ffAreaSqft ? String(deal.ffAreaSqft) : null,
                basementSqft: deal.basementAreaSqft ? String(deal.basementAreaSqft) : null,
                zoneARate: deal.priceItza ? String(deal.priceItza) : null,
                overallRate: deal.pricePsf ? String(deal.pricePsf) : null,
                rentFree: deal.rentFree ? String(deal.rentFree) : null,
                capex: deal.capitalContribution ? String(deal.capitalContribution) : null,
                term: deal.leaseLength ? `${deal.leaseLength} years` : null,
                breakClause: deal.breakOption ? `${deal.breakOption} years` : null,
                rentAnalysis: deal.rentAnalysis ? String(deal.rentAnalysis) : null,
                completionDate: deal.completionDate || new Date().toISOString().split("T")[0],
                postcode: propPostcode || null,
                areaLocation: propAreaLocation || null,
                comments: deal.comments || null,
                sourceEvidence: "BGP Direct",
                verified: true,
                verifiedBy: "Auto (Deal Completed)",
                verifiedDate: new Date().toISOString().split("T")[0],
                createdBy: "Auto-Promotion",
                useClass: deal.assetClass || null,
              });
              console.log(`Auto-promoted leasing deal ${deal.id} → Leasing Comp: ${propertyName}`);
            }
          } catch (compErr: any) {
            console.error("Leasing Comp auto-promotion error:", compErr.message);
          }
        }

        try {
          const xeroToken = await refreshXeroToken(req.session);
          if (xeroToken) {
            const existingInvoices = await db.select().from(xeroInvoices)
              .where(eq(xeroInvoices.dealId, deal.id)).limit(1);

            const KYC_GATE_DATE = new Date("2025-05-01");
            const kycBlocked = new Date() >= KYC_GATE_DATE && !deal.kycApproved;
            if (kycBlocked) {
              console.log(`Skipped auto-invoice for deal ${deal.id}: KYC not yet approved`);
            }

            if (existingInvoices.length === 0 && (deal.fee || 0) > 0 && !kycBlocked) {
              let contactName = "";
              let contactEmail = "";

              if (deal.invoicingEntityId) {
                const [entity] = await db.select().from(crmCompanies)
                  .where(eq(crmCompanies.id, deal.invoicingEntityId)).limit(1);
                if (entity) {
                  contactName = entity.name;
                  contactEmail = deal.invoicingEmail || entity.email || "";
                }
              }

              if (!contactName && deal.tenantId) {
                const [tenant] = await db.select().from(crmCompanies)
                  .where(eq(crmCompanies.id, deal.tenantId)).limit(1);
                if (tenant) {
                  contactName = tenant.name;
                  contactEmail = deal.invoicingEmail || tenant.email || "";
                }
              }

              if (contactName) {
                let xeroContactId: string | undefined;
                const searchRes = await xeroApi(req.session, `/Contacts?where=Name=="${contactName.replace(/"/g, "")}"`);
                if (searchRes.Contacts?.length > 0) {
                  xeroContactId = searchRes.Contacts[0].ContactID;
                } else {
                  const createContactRes = await xeroApi(req.session, "/Contacts", {
                    method: "POST",
                    body: JSON.stringify({
                      Contacts: [{ Name: contactName, EmailAddress: contactEmail || undefined }],
                    }),
                  });
                  xeroContactId = createContactRes.Contacts?.[0]?.ContactID;
                }

                const invoicePayload = {
                  Invoices: [{
                    Type: "ACCREC",
                    Contact: { ContactID: xeroContactId },
                    LineItems: [{
                      Description: deal.name || "Professional fees",
                      Quantity: 1,
                      UnitAmount: deal.fee || 0,
                      AccountCode: "200",
                      TaxType: "OUTPUT2",
                    }],
                    Date: new Date().toISOString().split("T")[0],
                    DueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
                    Reference: deal.poNumber ? `${deal.name} | PO: ${deal.poNumber}` : deal.name,
                    Status: "DRAFT",
                    CurrencyCode: "GBP",
                    LineAmountTypes: "Exclusive",
                  }],
                };

                const xeroRes = await xeroApi(req.session, "/Invoices", {
                  method: "POST",
                  body: JSON.stringify(invoicePayload),
                });
                const xeroInvoice = xeroRes.Invoices?.[0];

                await db.insert(xeroInvoices).values({
                  dealId: deal.id,
                  xeroInvoiceId: xeroInvoice?.InvoiceID,
                  xeroContactId: xeroContactId || null,
                  invoiceNumber: xeroInvoice?.InvoiceNumber,
                  reference: deal.name,
                  status: xeroInvoice?.Status || "DRAFT",
                  totalAmount: xeroInvoice?.Total || deal.fee || 0,
                  currency: "GBP",
                  dueDate: null,
                  sentToXero: true,
                  xeroUrl: xeroInvoice?.InvoiceID
                    ? `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${xeroInvoice.InvoiceID}`
                    : null,
                  syncedAt: new Date(),
                });
                console.log(`Auto-created draft Xero invoice for deal ${deal.id} (${deal.name})`);
              } else {
                console.log(`Skipped auto-invoice for deal ${deal.id}: no invoicing entity or tenant set`);
              }
            }
          } else {
            console.log(`Skipped auto-invoice for deal ${deal.id}: Xero not connected`);
          }
        } catch (invoiceErr: any) {
          console.error(`Auto-invoice error for deal ${deal.id}:`, invoiceErr.message);
          try {
            await db.insert(xeroInvoices).values({
              dealId: deal.id,
              status: "ERROR",
              errorMessage: `Auto-invoice failed: ${invoiceErr.message}`,
              sentToXero: false,
            }).catch(() => {});
          } catch {}
        }
      }

      res.json(deal);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Deal audit log endpoint
  app.get("/api/crm/deals/:id/audit-log", async (req, res) => {
    try {
      const logs = await db.select().from(dealAuditLog)
        .where(eq(dealAuditLog.dealId, req.params.id))
        .orderBy(sql`created_at DESC`);
      res.json(logs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Related emails for a deal — searches user's Outlook inbox for emails mentioning the deal/property name
  app.get("/api/crm/deals/:id/related-emails", requireAuth, async (req, res) => {
    try {
      const deal = await storage.getCrmDeal(req.params.id);
      if (!deal) return res.status(404).json({ error: "Deal not found" });

      const { getValidMsToken } = await import("./microsoft");
      const token = await getValidMsToken(req);
      if (!token) {
        return res.json({ connected: false, emails: [], message: "Microsoft 365 not connected" });
      }

      // Build search terms from deal name and linked property name
      const searchTerms: string[] = [];
      if (deal.name) searchTerms.push(deal.name);
      if (deal.propertyId) {
        const prop = await storage.getCrmProperty(deal.propertyId);
        if (prop?.name && prop.name !== deal.name) searchTerms.push(prop.name);
      }

      if (searchTerms.length === 0) {
        return res.json({ connected: true, emails: [] });
      }

      // Search for emails matching any of the terms
      const query = searchTerms.map(t => `"${t.replace(/"/g, "")}"`).join(" OR ");
      const url = "https://graph.microsoft.com/v1.0/me/messages?" + new URLSearchParams({
        $search: query,
        $top: "10",
        $select: "id,subject,from,receivedDateTime,bodyPreview",
        $orderby: "receivedDateTime desc",
      });

      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return res.json({ connected: false, emails: [], message: "Microsoft token expired" });
        }
        return res.json({ connected: true, emails: [] });
      }

      const data = await response.json();
      const emails = (data.value || []).map((msg: any) => ({
        id: msg.id,
        subject: msg.subject || "(No subject)",
        from: msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown",
        date: msg.receivedDateTime,
        preview: (msg.bodyPreview || "").slice(0, 120).replace(/\n/g, " "),
      }));

      res.json({ connected: true, emails });
    } catch (e: any) {
      console.error("Related emails error:", e.message);
      res.json({ connected: true, emails: [] });
    }
  });

  // Related calendar events for a deal — searches user's Outlook calendar for events mentioning the deal/property name
  app.get("/api/crm/deals/:id/related-events", requireAuth, async (req, res) => {
    try {
      const deal = await storage.getCrmDeal(req.params.id);
      if (!deal) return res.status(404).json({ error: "Deal not found" });

      const { getValidMsToken } = await import("./microsoft");
      const token = await getValidMsToken(req);
      if (!token) {
        return res.json({ connected: false, events: [], message: "Microsoft 365 not connected" });
      }

      // Build search terms from deal name and linked property name
      const searchTerms: string[] = [];
      if (deal.name) searchTerms.push(deal.name);
      if (deal.propertyId) {
        const prop = await storage.getCrmProperty(deal.propertyId);
        if (prop?.name && prop.name !== deal.name) searchTerms.push(prop.name);
      }

      if (searchTerms.length === 0) {
        return res.json({ connected: true, events: [] });
      }

      // Fetch upcoming calendar events (next 30 days) and filter client-side for matching terms
      const now = new Date();
      const endDate = new Date(now);
      endDate.setDate(endDate.getDate() + 30);

      const url = `https://graph.microsoft.com/v1.0/me/calendarView?startDateTime=${now.toISOString()}&endDateTime=${endDate.toISOString()}&$top=50&$orderby=start/dateTime&$select=subject,start,end,location,organizer,bodyPreview`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Prefer: 'outlook.timezone="Europe/London"',
        },
      });

      if (!response.ok) {
        if (response.status === 401) {
          return res.json({ connected: false, events: [], message: "Microsoft token expired" });
        }
        return res.json({ connected: true, events: [] });
      }

      const data = await response.json();
      const allEvents = data.value || [];

      // Filter events that mention any of the search terms in subject or body preview
      const lowerTerms = searchTerms.map(t => t.toLowerCase());
      const matchingEvents = allEvents.filter((evt: any) => {
        const text = `${evt.subject || ""} ${evt.bodyPreview || ""}`.toLowerCase();
        return lowerTerms.some(term => text.includes(term));
      }).slice(0, 5);

      const events = matchingEvents.map((evt: any) => ({
        id: evt.id,
        subject: evt.subject || "(No title)",
        start: evt.start?.dateTime,
        end: evt.end?.dateTime,
        location: evt.location?.displayName || null,
        organizer: evt.organizer?.emailAddress?.name || null,
      }));

      res.json({ connected: true, events });
    } catch (e: any) {
      console.error("Related events error:", e.message);
      res.json({ connected: true, events: [] });
    }
  });

  app.delete("/api/crm/deals/:id", async (req, res) => {
    try {
      await storage.deleteCrmDeal(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/fee-allocations", async (req, res) => {
    try {
      const all = await db.select().from(dealFeeAllocations).orderBy(dealFeeAllocations.createdAt);
      const grouped: Record<string, any[]> = {};
      for (const a of all) {
        if (!grouped[a.dealId]) grouped[a.dealId] = [];
        grouped[a.dealId].push(a);
      }
      res.json(grouped);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/deals/:id/fee-allocations", async (req, res) => {
    try {
      const allocations = await storage.getDealFeeAllocations(req.params.id);
      res.json(allocations);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.put("/api/crm/deals/:id/fee-allocations", async (req, res) => {
    try {
      const { allocations } = req.body;
      if (!Array.isArray(allocations)) {
        return res.status(400).json({ error: "allocations must be an array" });
      }
      const validated = allocations.map((a: any) => ({
        dealId: req.params.id,
        agentName: String(a.agentName || ""),
        allocationType: a.allocationType === "fixed" ? "fixed" : "percentage",
        percentage: a.allocationType === "percentage" ? Number(a.percentage) || 0 : null,
        fixedAmount: a.allocationType === "fixed" ? Number(a.fixedAmount) || 0 : null,
      })).filter((a: any) => a.agentName.length > 0);
      // Validate percentage allocations don't exceed 100%
      const totalPct = validated
        .filter((a: any) => a.allocationType === "percentage")
        .reduce((sum: number, a: any) => sum + (a.percentage || 0), 0);
      if (totalPct > 100) {
        return res.status(400).json({ error: `Percentage allocations sum to ${totalPct}%, cannot exceed 100%` });
      }
      const result = await storage.setDealFeeAllocations(req.params.id, validated);
      res.json(result);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  const hotsUploadDir = path.join(process.cwd(), "ChatBGP", "hots");
  if (!fs.existsSync(hotsUploadDir)) fs.mkdirSync(hotsUploadDir, { recursive: true });

  const hotsUpload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, hotsUploadDir),
      filename: (_req, file, cb) => {
        const unique = Date.now() + "-" + Math.round(Math.random() * 1e6);
        cb(null, unique + "-" + file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_"));
      },
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
  });

  app.post("/api/crm/deals/bulk-rent-analysis", requireAuth, async (req, res) => {
    try {
      const { rows: deals } = await pool.query(`
        SELECT id, name, deal_type, rent_pa, rent_free, lease_length, capital_contribution, total_area_sqft, rent_analysis, status
        FROM crm_deals
        WHERE deal_type IN ('Leasing', 'Lease Disposal', 'Lease Acquisition', 'Renewal', 'Regear')
          AND rent_pa IS NOT NULL AND rent_pa > 0
          AND lease_length IS NOT NULL AND lease_length > 0
        ORDER BY name
      `);

      let updated = 0;
      const results: { id: string; name: string; type: string; status: string; rentPa: number; rentFree: number; leaseYears: number; capContrib: number; areaSqft: number; nerPsfPa: number | null; oldValue: number | null }[] = [];

      for (const d of deals) {
        const ra = calculateRentAnalysis({
          rentPa: d.rent_pa,
          rentFree: d.rent_free,
          leaseLength: d.lease_length,
          capitalContribution: d.capital_contribution,
          totalAreaSqft: d.total_area_sqft,
        });

        if (ra !== null) {
          results.push({
            id: d.id,
            name: d.name,
            type: d.deal_type,
            status: d.status || "",
            rentPa: d.rent_pa,
            rentFree: d.rent_free || 0,
            leaseYears: d.lease_length,
            capContrib: d.capital_contribution || 0,
            areaSqft: d.total_area_sqft || 0,
            nerPsfPa: ra,
            oldValue: d.rent_analysis,
          });

          if (ra !== d.rent_analysis) {
            await pool.query(`UPDATE crm_deals SET rent_analysis = $2, updated_at = NOW() WHERE id = $1`, [d.id, ra]);
            updated++;
          }
        }
      }

      const sendEmail = req.body.sendEmail !== false;
      let emailSent = false;

      if (sendEmail && results.length > 0) {
        try {
          const { sendSharedMailboxEmail } = await import("./shared-mailbox");
          const fmt = (n: number) => n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
          const fmtCurrency = (n: number) => "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

          const tableRows = results.map(r => `
            <tr>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;">${r.name}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;">${r.type}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;">${r.status}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${fmtCurrency(r.rentPa)}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${r.rentFree}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${r.leaseYears}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${r.capContrib > 0 ? fmtCurrency(r.capContrib) : "-"}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;">${r.areaSqft > 0 ? r.areaSqft.toLocaleString("en-GB") : "-"}</td>
              <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:13px;text-align:right;font-weight:600;">£${fmt(r.nerPsfPa!)}</td>
            </tr>
          `).join("");

          const body = `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:900px;margin:0 auto;">
              <h2 style="color:#111;margin-bottom:4px;">Rent Analysis Report — Lease Deals</h2>
              <p style="color:#666;font-size:14px;margin-top:0;">Generated ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} · ${results.length} deals analysed · ${updated} updated</p>
              <p style="color:#666;font-size:13px;">Net Effective Rent calculated using straight-line amortisation: <em>(Headline Rent × Paying Months − Capital Contribution) ÷ Total Lease Months</em>. Where area is available, the figure is per sq ft p.a.</p>
              <table style="width:100%;border-collapse:collapse;margin:16px 0;">
                <thead>
                  <tr style="background:#f3f4f6;">
                    <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Deal</th>
                    <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Type</th>
                    <th style="padding:8px 10px;text-align:left;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Status</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Rent PA</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Rent Free (mo)</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Lease (yr)</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Cap Contrib</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">Area (sqft)</th>
                    <th style="padding:8px 10px;text-align:right;font-size:12px;font-weight:600;border-bottom:2px solid #d1d5db;">NER${results.some(r => r.areaSqft > 0) ? " psf" : ""} PA</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
              <p style="color:#666;font-size:13px;">Please review and confirm these rent analysis figures are correct. Reply to this email with any corrections needed.</p>
              <p style="color:#999;font-size:11px;margin-top:24px;">Sent from BGP Dashboard · chatbgp@brucegillinghampollard.com</p>
            </div>
          `;

          await sendSharedMailboxEmail({
            to: "tom@brucegillinghampollard.com",
            subject: `Rent Analysis Report — ${results.length} Lease Deals for Review`,
            body,
          });
          emailSent = true;
          console.log(`[rent-analysis] Sent report to Tom Cater: ${results.length} deals, ${updated} updated`);
        } catch (emailErr: any) {
          console.error("[rent-analysis] Email send error:", emailErr.message);
        }
      }

      res.json({
        message: `Rent analysis complete: ${results.length} deals analysed, ${updated} updated`,
        analysed: results.length,
        updated,
        emailSent,
        results: results.map(r => ({ name: r.name, type: r.type, nerPsfPa: r.nerPsfPa })),
      });
    } catch (e: any) {
      console.error("[rent-analysis] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/crm/deals/:id/parse-hots", requireAuth, hotsUpload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });

      const ext = path.extname(req.file.originalname).toLowerCase();
      let text = "";

      if (ext === ".docx") {
        const mammoth = await import("mammoth");
        const result = await mammoth.extractRawText({ path: req.file.path });
        text = result.value;
      } else if (ext === ".pdf") {
        const pdfModule = await import("pdf-parse");
        const PDFParseClass = (pdfModule as any).PDFParse || (pdfModule as any).default;
        const buffer = fs.readFileSync(req.file.path);
        const uint8 = new Uint8Array(buffer);
        const parser = new PDFParseClass(uint8);
        const data = await parser.getText();
        text = typeof data === "string" ? data : (data as any).text || String(data);
      } else if ([".txt", ".doc", ".rtf", ".md"].includes(ext)) {
        text = fs.readFileSync(req.file.path, "utf-8");
      } else {
        try { text = fs.readFileSync(req.file.path, "utf-8"); }
        catch { return res.status(400).json({ error: "Unsupported file type. Upload a PDF, DOCX, or TXT file." }); }
      }

      if (!text || text.trim().length < 20) {
        return res.status(400).json({ error: "Could not extract meaningful text from the uploaded document." });
      }

      const response = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [
          {
            role: "system",
            content: `You are a UK commercial property expert analysing Heads of Terms (HOTs) documents for a property agency called Bruce Gillingham Pollard (BGP). Extract ALL structured deal information from the document.

Return a JSON object with these fields (use null for any field you cannot find):
{
  "propertyAddress": "string - full property address",
  "tenantName": "string - name of the tenant company",
  "landlordName": "string - name of the landlord company",
  "rentPa": number - annual rent in GBP (just the number, no currency symbol),
  "rentPsf": number - rent per square foot if mentioned,
  "totalAreaSqft": number - total area in sq ft,
  "leaseLength": "string - e.g. '10 years'",
  "breakOption": "string - break clause details",
  "rentFree": "string - rent free period",
  "capitalContribution": number - any capital contribution / incentive in GBP,
  "feePercentage": number - agency fee percentage if mentioned,
  "fee": number - total fee amount in GBP if mentioned,
  "feeAgreement": "string - fee basis e.g. 'Standard %', 'Fixed Fee'",
  "completionTiming": "string - expected completion timing",
  "dealType": "string - one of: New Letting, Lease Renewal, Rent Review, Sub-Letting, Assignment, Lease Disposal, Purchase, Sale, Lease Acquisition, Regear",
  "assetClass": "string - one of: Retail, Office, Industrial, Residential, Mixed-Use, F&B, Leisure, Healthcare, Other",
  "serviceCharge": "string - service charge details",
  "useClass": "string - planning use class",
  "repairing": "string - repairing obligations (FRI, IRI etc.)",
  "deposit": "string - any deposit requirements",
  "guarantor": "string - guarantor details",
  "specialConditions": "string - any special conditions or notable terms",
  "invoicingNotes": "string - any notes about invoicing or billing",
  "agentNames": ["string - names of BGP agents involved if mentioned"],
  "vendorAgent": "string - vendor/landlord agent firm if mentioned",
  "summary": "string - 2-3 sentence summary of the key deal terms"
}`
          },
          {
            role: "user",
            content: `Parse this Heads of Terms document and extract all deal information:\n\n${text.substring(0, 15000)}`
          }
        ],
        temperature: 0.1,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return res.status(500).json({ error: "AI could not parse the document" });
      }

      const extracted = parseAiJson(content);
      console.log(`[hots-parser] Extracted deal data from "${req.file.originalname}" for deal ${req.params.id}`);

      res.json({
        success: true,
        extracted,
        fileName: req.file.originalname,
        filePath: req.file.path,
      });
    } catch (err: any) {
      console.error("[hots-parser] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/crm/requirements-leasing", async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        status: req.query.status as string | undefined,
      };
      let reqs = await storage.getCrmRequirementsLeasing(filters);
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId) {
        reqs = reqs.filter((r: any) => r.companyId === scopeCompanyId);
      }
      res.json(reqs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/requirements-leasing/:id", async (req, res) => {
    try {
      const req_ = await storage.getCrmRequirementLeasing(req.params.id);
      if (!req_) return res.status(404).json({ error: "Not found" });
      res.json(req_);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/requirements-leasing", async (req, res) => {
    try {
      const parsed = insertCrmReqLeasingSchema.parse(req.body);
      const created = await storage.createCrmRequirementLeasing(parsed);
      if (created.dealId && created.companyId) {
        await storage.linkCompanyDeal(created.companyId, created.dealId);
      }
      res.status(201).json(created);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/requirements-leasing/:id", async (req, res) => {
    try {
      const updated = await storage.updateCrmRequirementLeasing(req.params.id, req.body);
      const dealId = updated.dealId;
      const companyId = updated.companyId;
      if (dealId && companyId) {
        await storage.linkCompanyDeal(companyId, dealId);
      }
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/requirements-leasing/:id", async (req, res) => {
    try {
      await storage.deleteCrmRequirementLeasing(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/requirements-leasing/:id/landlord-pack", landlordPackUpload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const crypto = await import("crypto");
      const ext = path.extname(req.file.originalname).toLowerCase();
      const uniqueName = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}${ext}`;
      await saveFile(`landlord-packs/${uniqueName}`, req.file.buffer, req.file.mimetype, req.file.originalname);
      const filePath = `/api/crm/landlord-packs/${uniqueName}`;
      const originalName = req.file.originalname;
      const landlordPack = JSON.stringify({ url: filePath, name: originalName, size: req.file.size });
      const updated = await storage.updateCrmRequirementLeasing(req.params.id, { landlordPack });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/requirements-leasing/:id/landlord-pack", async (req, res) => {
    try {
      const item = await storage.getCrmRequirementLeasing(req.params.id);
      if (item?.landlordPack) {
        try {
          const pack = JSON.parse(item.landlordPack);
          const fileName = pack.url?.split("/").pop();
          if (fileName) await deleteStoredFile(`landlord-packs/${fileName}`);
        } catch {}
      }
      const updated = await storage.updateCrmRequirementLeasing(req.params.id, { landlordPack: null });
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/landlord-packs/:filename", async (req, res) => {
    try {
      const sanitized = path.basename(req.params.filename);
      const file = await getFile(`landlord-packs/${sanitized}`);
      if (!file) {
        const diskPath = path.join(LANDLORD_PACKS_DIR, sanitized);
        if (fs.existsSync(diskPath)) return res.download(diskPath);
        return res.status(404).json({ error: "File not found" });
      }
      res.set("Content-Type", file.contentType);
      res.set("Content-Disposition", `attachment; filename="${file.originalName || sanitized}"`);
      res.send(file.data);
    } catch (err: any) { console.error("[crm] File download error:", err?.message); res.status(500).end(); }
  });

  app.post("/api/crm/requirements-investment/bulk-sync", requireAuth, async (req, res) => {
    try {
      const { items } = req.body;
      if (!Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: "Items array required" });
      }
      let inserted = 0;
      let skipped = 0;
      for (const item of items) {
        try {
          const existing = await db.select({ id: crmRequirementsInvestment.id })
            .from(crmRequirementsInvestment)
            .where(eq(crmRequirementsInvestment.id, item.id))
            .limit(1);
          if (existing.length > 0) { skipped++; continue; }
          await db.insert(crmRequirementsInvestment).values({
            id: item.id,
            name: item.name || "Unknown",
            groupName: item.groupName,
            status: item.status,
            companyId: item.companyId,
            use: item.use,
            requirementType: item.requirementType,
            size: item.size,
            requirementLocations: item.requirementLocations,
            locationData: item.locationData,
            locations: item.locations,
            location: item.location,
            principalContactId: item.principalContactId,
            agentContactId: item.agentContactId,
            contactId: item.contactId,
            contactName: item.contactName,
            contactEmail: item.contactEmail,
            contactMobile: item.contactMobile,
            dealId: item.dealId,
            landlordPack: item.landlordPack,
            extract: item.extract,
            comments: item.comments,
            requirementDate: item.requirementDate,
            contacted: item.contacted ?? false,
            detailsSent: item.detailsSent ?? false,
            viewing: item.viewing ?? false,
            shortlisted: item.shortlisted ?? false,
            underOffer: item.underOffer ?? false,
          });
          inserted++;
        } catch (err: any) {
          console.error(`Skipping item ${item.name}:`, err?.message);
          skipped++;
        }
      }
      res.json({ inserted, skipped, total: items.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/crm/requirements-investment", async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
      };
      let reqs = await storage.getCrmRequirementsInvestment(filters);
      const scopeCompanyId = await resolveCompanyScope(req);
      if (scopeCompanyId) {
        reqs = reqs.filter((r: any) => r.companyId === scopeCompanyId);
      }
      res.json(reqs);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/requirements-investment/:id", async (req, res) => {
    try {
      const req_ = await storage.getCrmRequirementInvestment(req.params.id);
      if (!req_) return res.status(404).json({ error: "Not found" });
      res.json(req_);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/requirements-investment", async (req, res) => {
    try {
      const parsed = insertCrmReqInvestSchema.parse(req.body);
      const created = await storage.createCrmRequirementInvestment(parsed);
      res.status(201).json(created);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/requirements-investment/:id", async (req, res) => {
    try {
      const updated = await storage.updateCrmRequirementInvestment(req.params.id, req.body);
      res.json(updated);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/requirements-investment/:id", async (req, res) => {
    try {
      await storage.deleteCrmRequirementInvestment(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/requirements-investment/import", requireAuth,
    multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file"),
    async (req, res) => {
      try {
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const XLSX = (await import("xlsx")).default;
        const wb = XLSX.read(req.file.buffer, { type: "buffer" });

        const reqSheet = wb.Sheets[" "] || wb.Sheets["Requirements"] || wb.Sheets[wb.SheetNames[1]];
        if (!reqSheet) return res.status(400).json({ error: "Requirements sheet not found" });

        const rawData: any[] = XLSX.utils.sheet_to_json(reqSheet, { header: 1 });

        const allCompanies = await db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies);
        const companyMap = new Map<string, string>();
        for (const c of allCompanies) {
          companyMap.set(c.name.toLowerCase().trim(), c.id);
        }

        function findCompanyId(clientName: string): string | null {
          const key = clientName.toLowerCase().trim();
          if (companyMap.has(key)) return companyMap.get(key)!;
          for (const [name, id] of companyMap) {
            if (name.includes(key) || key.includes(name)) return id;
          }
          const keyWords = key.split(/\s+/);
          if (keyWords.length >= 2) {
            for (const [name, id] of companyMap) {
              const matched = keyWords.filter(w => w.length > 2 && name.includes(w));
              if (matched.length >= 2) return id;
            }
          }
          return null;
        }

        const contactSheet = wb.Sheets["Contacts"] || wb.Sheets[wb.SheetNames[0]];
        const contactsByCompany = new Map<string, { name: string; email: string; position?: string }[]>();
        if (contactSheet) {
          const contactData: any[] = XLSX.utils.sheet_to_json(contactSheet, { header: 1 });
          for (let i = 3; i < contactData.length; i++) {
            const row = contactData[i];
            const contactName = row && row[2] ? String(row[2]).trim() : "";
            const clientName = row && row[4] ? String(row[4]).trim() : "";
            const email = row && row[5] ? String(row[5]).trim() : "";
            if (!contactName || !clientName) continue;
            if (!contactsByCompany.has(clientName.toLowerCase())) {
              contactsByCompany.set(clientName.toLowerCase(), []);
            }
            contactsByCompany.get(clientName.toLowerCase())!.push({
              name: contactName,
              email,
              position: row && row[6] ? String(row[6]).trim() : undefined,
            });
          }
        }

        let created = 0;
        let skipped = 0;
        let unmatched: string[] = [];
        const newCompanies: string[] = [];

        for (let i = 3; i < rawData.length; i++) {
          const row = rawData[i];
          const clientName = row && row[1] ? String(row[1]).trim() : "";
          if (!clientName) continue;

          const comment = row[2] ? String(row[2]).trim() : "";
          const contact = row[3] ? String(row[3]).trim() : "";

          const contacts = contactsByCompany.get(clientName.toLowerCase()) || [];
          const primaryContact = contacts[0];

          let companyId = findCompanyId(clientName);

          if (!companyId) {
            const [newCompany] = await db.insert(crmCompanies).values({
              name: clientName,
              companyType: "Investor",
              team: "Investment",
            }).returning();
            companyId = newCompany.id;
            companyMap.set(clientName.toLowerCase().trim(), companyId);
            newCompanies.push(clientName);
          }

          const existing = await db.select({ id: crmRequirementsInvestment.id })
            .from(crmRequirementsInvestment)
            .where(eq(crmRequirementsInvestment.companyId, companyId))
            .limit(1);

          if (existing.length > 0) {
            skipped++;
            continue;
          }

          await db.insert(crmRequirementsInvestment).values({
            name: clientName,
            companyId,
            comments: comment && comment !== " " ? comment : null,
            contactName: primaryContact?.name || contact || null,
            contactEmail: primaryContact?.email || null,
            status: "Active",
            groupName: "Institutional",
          });
          created++;
        }

        res.json({
          created,
          skipped,
          newCompanies: newCompanies.length,
          newCompanyNames: newCompanies.slice(0, 20),
          unmatchedCount: unmatched.length,
        });
      } catch (e: any) {
        console.error("Import requirements error:", e);
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.get("/api/crm/comps", async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        dealType: req.query.dealType as string | undefined,
      };
      const comps = await storage.getCrmComps(filters);
      res.json(comps);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/comps/files/bulk", requireAuth, async (req, res) => {
    try {
      const compIds = (req.query.compIds as string || "").split(",").filter(Boolean);
      if (!compIds.length) return res.json([]);
      const placeholders = compIds.map((_, i) => `$${i + 1}`).join(",");
      const result = await pool.query(
        `SELECT id, comp_id, file_name, file_path, file_size, mime_type, created_at FROM comp_files WHERE comp_id IN (${placeholders}) ORDER BY comp_id, created_at DESC`,
        compIds
      );
      res.json(result.rows.map(r => ({ id: r.id, compId: r.comp_id, fileName: r.file_name, filePath: r.file_path, fileSize: r.file_size, mimeType: r.mime_type, createdAt: r.created_at })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/comps/:id", async (req, res) => {
    try {
      const comp = await storage.getCrmComp(req.params.id);
      if (!comp) return res.status(404).json({ error: "Not found" });
      res.json(comp);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/comps", async (req, res) => {
    try {
      const parsed = insertCrmCompSchema.parse(req.body);
      const comp = await storage.createCrmComp(parsed);
      res.status(201).json(comp);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/comps/:id", async (req, res) => {
    try {
      const comp = await storage.updateCrmComp(req.params.id, req.body);
      res.json(comp);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/comps/:id", async (req, res) => {
    try {
      await storage.deleteCrmComp(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  const compFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

  app.get("/api/crm/comps/:compId/files", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT id, comp_id, file_name, file_path, file_size, mime_type, created_at FROM comp_files WHERE comp_id = $1 ORDER BY created_at DESC`,
        [req.params.compId]
      );
      res.json(result.rows.map(r => ({ id: r.id, compId: r.comp_id, fileName: r.file_name, filePath: r.file_path, fileSize: r.file_size, mimeType: r.mime_type, createdAt: r.created_at })));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/comps/:compId/files", requireAuth, compFileUpload.single("file"), async (req: any, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file provided" });
      const uniqueName = `${Date.now()}-${req.file.originalname}`;
      const storageKey = `comp-files/${req.params.compId}/${uniqueName}`;
      await saveFile(storageKey, req.file.buffer, req.file.mimetype, req.file.originalname);
      const result = await pool.query(
        `INSERT INTO comp_files (id, comp_id, file_name, file_path, file_size, mime_type) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5) RETURNING *`,
        [req.params.compId, req.file.originalname, storageKey, req.file.size, req.file.mimetype]
      );
      const r = result.rows[0];
      res.json({ id: r.id, compId: r.comp_id, fileName: r.file_name, filePath: r.file_path, fileSize: r.file_size, mimeType: r.mime_type, createdAt: r.created_at });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/comp-files/:fileId/download", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(`SELECT file_name, file_path, mime_type FROM comp_files WHERE id = $1`, [req.params.fileId]);
      if (!result.rows[0]) return res.status(404).json({ error: "File not found" });
      const row = result.rows[0];
      const file = await getFile(row.file_path);
      if (!file) return res.status(404).json({ error: "File data not found" });
      res.setHeader("Content-Type", file.contentType || row.mime_type || "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${row.file_name}"`);
      res.send(file.data);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/comp-files/:fileId", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(`SELECT file_path FROM comp_files WHERE id = $1`, [req.params.fileId]);
      if (result.rows[0]) {
        try { await deleteStoredFile(result.rows[0].file_path); } catch {}
      }
      await pool.query(`DELETE FROM comp_files WHERE id = $1`, [req.params.fileId]);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/leads", async (req, res) => {
    try {
      const filters = {
        search: req.query.search as string | undefined,
        groupName: req.query.groupName as string | undefined,
        status: req.query.status as string | undefined,
        leadType: req.query.leadType as string | undefined,
      };
      const leads = await storage.getCrmLeads(filters);
      res.json(leads);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/leads/:id", async (req, res) => {
    try {
      const lead = await storage.getCrmLead(req.params.id);
      if (!lead) return res.status(404).json({ error: "Not found" });
      res.json(lead);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/leads", async (req, res) => {
    try {
      const parsed = insertCrmLeadSchema.parse(req.body);
      const lead = await storage.createCrmLead(parsed);
      res.status(201).json(lead);
    } catch (e: any) { res.status(400).json({ error: e.message }); }
  });

  app.put("/api/crm/leads/:id", async (req, res) => {
    try {
      const lead = await storage.updateCrmLead(req.params.id, req.body);
      res.json(lead);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/crm/leads/:id", async (req, res) => {
    try {
      await storage.deleteCrmLead(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/leads/:id/convert-to-contact", async (req, res) => {
    try {
      const lead = await storage.getCrmLead(req.params.id);
      if (!lead) return res.status(404).json({ error: "Lead not found" });
      const contact = await storage.createCrmContact({
        name: lead.name,
        email: lead.email,
        phone: lead.phone,
        notes: lead.notes,
        groupName: lead.groupName,
        contactType: lead.leadType || "Lead",
      });
      await storage.updateCrmLead(lead.id, { status: "Converted" });
      res.json({ contact, message: "Lead converted to CRM contact" });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/link-contacts-companies", async (req, res) => {
    try {
      const companies = await storage.getCrmCompanies();
      const contacts = await storage.getCrmContacts();

      const domainToCompany = new Map<string, { id: string; name: string }>();
      for (const co of companies) {
        if (!co.domain) continue;
        const domainStr = co.domain.toLowerCase();
        const parts = domainStr.split(/\s+-\s+/);
        for (const part of parts) {
          const cleaned = part.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "").trim();
          if (cleaned && cleaned.includes(".")) {
            domainToCompany.set(cleaned, { id: co.id, name: co.name });
          }
        }
      }

      let linked = 0;
      let alreadyLinked = 0;
      let noMatch = 0;
      const results: { contact: string; company: string; domain: string }[] = [];

      for (const contact of contacts) {
        if (contact.companyId) { alreadyLinked++; continue; }
        if (!contact.email) { noMatch++; continue; }

        const emailDomain = contact.email.toLowerCase().split("@")[1];
        if (!emailDomain) { noMatch++; continue; }

        const match = domainToCompany.get(emailDomain);
        if (match) {
          await storage.updateCrmContact(contact.id, {
            companyId: match.id,
            companyName: match.name,
          });
          linked++;
          results.push({ contact: contact.name, company: match.name, domain: emailDomain });
        } else {
          noMatch++;
        }
      }

      res.json({ linked, alreadyLinked, noMatch, total: contacts.length, results });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Contact-Property links
  app.get("/api/crm/contact-property-links", async (_req, res) => {
    try {
      const links = await db.select().from(crmContactProperties);
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/crm/contacts/:id/properties", async (req, res) => {
    try {
      const links = await db.select().from(crmContactProperties).where(eq(crmContactProperties.contactId, req.params.id));
      if (links.length === 0) return res.json([]);
      const propertyIds = links.map(l => l.propertyId);
      const properties = await db.select().from(crmProperties).where(inArray(crmProperties.id, propertyIds));
      res.json(properties);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/crm/contacts/:id/properties", async (req, res) => {
    try {
      const [link] = await db.insert(crmContactProperties).values({ contactId: req.params.id, propertyId: req.body.propertyId }).returning();
      res.json(link);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/crm/contacts/:id/properties/:propertyId", async (req, res) => {
    try {
      await db.delete(crmContactProperties).where(and(eq(crmContactProperties.contactId, req.params.id), eq(crmContactProperties.propertyId, req.params.propertyId)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Contact-Deal links
  app.get("/api/crm/contact-deal-links", async (_req, res) => {
    try {
      const links = await db.select().from(crmContactDeals);
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/crm/contacts/:id/deals", async (req, res) => {
    try {
      const contactId = req.params.id;
      const links = await db.select().from(crmContactDeals).where(eq(crmContactDeals.contactId, contactId));
      const results: any[] = [];
      const seenIds = new Set<string>();
      if (links.length > 0) {
        const dealIds = links.map(l => l.dealId);
        const linked = await db.select().from(crmDeals).where(inArray(crmDeals.id, dealIds));
        for (const d of linked) { results.push({ ...d, linkSource: "linked" }); seenIds.add(d.id); }
      }
      const agentDeals = await db.select().from(crmDeals).where(
        or(
          eq(crmDeals.vendorAgentId, contactId),
          eq(crmDeals.acquisitionAgentId, contactId),
          eq(crmDeals.purchaserAgentId, contactId),
          eq(crmDeals.leasingAgentId, contactId),
          eq(crmDeals.clientContactId, contactId),
        )
      );
      for (const d of agentDeals) {
        if (!seenIds.has(d.id)) {
          const roles: string[] = [];
          if (d.vendorAgentId === contactId) roles.push("Vendor Agent");
          if (d.acquisitionAgentId === contactId) roles.push("Acquisition Agent");
          if (d.purchaserAgentId === contactId) roles.push("Purchaser Agent");
          if (d.leasingAgentId === contactId) roles.push("Leasing Agent");
          if (d.clientContactId === contactId) roles.push("Client Contact");
          results.push({ ...d, linkSource: "agent", agentRoles: roles });
          seenIds.add(d.id);
        }
      }
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/crm/contacts/:id/deals", async (req, res) => {
    try {
      const [link] = await db.insert(crmContactDeals).values({ contactId: req.params.id, dealId: req.body.dealId }).returning();
      res.json(link);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/crm/contacts/:id/deals/:dealId", async (req, res) => {
    try {
      await db.delete(crmContactDeals).where(and(eq(crmContactDeals.contactId, req.params.id), eq(crmContactDeals.dealId, req.params.dealId)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/crm/contacts/:id/investment-tracker", async (req, res) => {
    try {
      const contactId = req.params.id;
      const items = await db.select().from(investmentTracker).where(
        or(
          eq(investmentTracker.vendorAgentId, contactId),
          eq(investmentTracker.clientContactId, contactId),
        )
      );
      const results = items.map(item => {
        const roles: string[] = [];
        if (item.vendorAgentId === contactId) roles.push("Vendor Agent");
        if (item.clientContactId === contactId) roles.push("Client Contact");
        return { ...item, agentRoles: roles };
      });
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  // Contact-Requirement links
  app.get("/api/crm/contact-requirement-links", async (_req, res) => {
    try {
      const links = await db.select().from(crmContactRequirements);
      res.json(links);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.get("/api/crm/contacts/:id/requirements", async (req, res) => {
    try {
      const contactId = req.params.id;
      const links = await db.select().from(crmContactRequirements).where(eq(crmContactRequirements.contactId, contactId));
      const leasingIds = links.filter(l => l.requirementType === "leasing").map(l => l.requirementId);
      const investmentIds = links.filter(l => l.requirementType === "investment").map(l => l.requirementId);
      const results: any[] = [];
      if (leasingIds.length > 0) {
        const leasing = await db.select().from(crmRequirementsLeasing).where(inArray(crmRequirementsLeasing.id, leasingIds));
        results.push(...leasing.map(r => ({ ...r, requirementType: "leasing", linkSource: "linked" })));
      }
      if (investmentIds.length > 0) {
        const investment = await db.select().from(crmRequirementsInvestment).where(inArray(crmRequirementsInvestment.id, investmentIds));
        results.push(...investment.map(r => ({ ...r, requirementType: "investment", linkSource: "linked" })));
      }
      const seenIds = new Set(results.map(r => r.id));
      const agentLeasing = await db.select().from(crmRequirementsLeasing).where(eq(crmRequirementsLeasing.agentContactId, contactId));
      for (const r of agentLeasing) {
        if (!seenIds.has(r.id)) {
          results.push({ ...r, requirementType: "leasing", linkSource: "agent" });
          seenIds.add(r.id);
        }
      }
      const agentInvestment = await db.select().from(crmRequirementsInvestment).where(eq(crmRequirementsInvestment.agentContactId, contactId));
      for (const r of agentInvestment) {
        if (!seenIds.has(r.id)) {
          results.push({ ...r, requirementType: "investment", linkSource: "agent" });
          seenIds.add(r.id);
        }
      }
      res.json(results);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.post("/api/crm/contacts/:id/requirements", async (req, res) => {
    try {
      const [link] = await db.insert(crmContactRequirements).values({
        contactId: req.params.id,
        requirementId: req.body.requirementId,
        requirementType: req.body.requirementType,
      }).returning();
      res.json(link);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });
  app.delete("/api/crm/contacts/:id/requirements/:requirementId", async (req, res) => {
    try {
      await db.delete(crmContactRequirements).where(and(eq(crmContactRequirements.contactId, req.params.id), eq(crmContactRequirements.requirementId, req.params.requirementId)));
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/crm/ai-match/suggest", async (_req, res) => {
    try {
      const allDeals = await db.select({
        id: crmDeals.id, name: crmDeals.name, groupName: crmDeals.groupName,
        status: crmDeals.status, dealType: crmDeals.dealType,
        landlordId: crmDeals.landlordId, tenantId: crmDeals.tenantId,
        clientContactId: crmDeals.clientContactId, invoicingEntityId: crmDeals.invoicingEntityId,
        comments: crmDeals.comments, internalAgent: crmDeals.internalAgent,
      }).from(crmDeals);

      const unlinkedDeals = allDeals.filter(d =>
        !d.landlordId && !d.tenantId && !d.clientContactId && !d.invoicingEntityId
      );

      if (unlinkedDeals.length === 0) {
        return res.json({ suggestions: [], message: "All deals already have links" });
      }

      const allContacts = await db.select({
        id: crmContacts.id, name: crmContacts.name, email: crmContacts.email,
        phone: crmContacts.phone, company: crmContacts.companyName, role: crmContacts.role,
      }).from(crmContacts);

      const allCompanies = await db.select({
        id: crmCompanies.id, name: crmCompanies.name, companyType: crmCompanies.companyType,
      }).from(crmCompanies);

      const batchSize = 25;
      const allSuggestions: any[] = [];

      for (let i = 0; i < unlinkedDeals.length; i += batchSize) {
        const batch = unlinkedDeals.slice(i, i + batchSize);

        const dealSummaries = batch.map(d => ({
          id: d.id,
          name: d.name,
          group: d.groupName,
          status: d.status,
          type: d.dealType,
          agents: d.internalAgent,
          comments: d.comments?.substring(0, 200),
        }));

        const contactSummaries = allContacts.map(c => ({
          id: c.id, name: c.name, email: c.email, company: c.companyName, role: c.role,
        }));

        const companySummaries = allCompanies.map(c => ({
          id: c.id, name: c.name, type: c.companyType,
        }));

        const prompt = `You are a CRM data analyst for a London commercial property firm (BGP - Bruce Gillingham Pollard).
Given the following deals, contacts, and companies, identify likely matches.

DEALS (unlinked):
${JSON.stringify(dealSummaries, null, 1)}

CONTACTS (${contactSummaries.length} total):
${JSON.stringify(contactSummaries, null, 1)}

COMPANIES (${companySummaries.length} total):
${JSON.stringify(companySummaries, null, 1)}

For each deal, suggest which contacts and/or companies are likely related based on:
- Deal name vs company name overlap (e.g. "Star City" deal -> company with similar name)
- Contact company field matching deal name or company
- Role relevance (landlord, tenant, agent)
- Any contextual clues from comments

Return a JSON object with a "suggestions" key containing an array of objects with this format:
{
  "suggestions": [
    {
      "dealId": "...",
      "dealName": "...",
      "matches": [
        {
          "entityType": "contact" or "company",
          "entityId": "...",
          "entityName": "...",
          "role": "landlord" or "tenant" or "client_contact" or "invoicing_entity" or "related",
          "confidence": "high" or "medium" or "low",
          "reason": "Brief explanation"
        }
      ]
    }
  ]
}

Only suggest matches where there's a genuine connection. Skip deals with no plausible matches. Focus on quality over quantity.`;

        try {
          const response = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            messages: [{ role: "system", content: "Return your response as valid JSON only." }, { role: "user", content: prompt }],
            max_completion_tokens: 4000,
          });

          const content = response.choices[0]?.message?.content;
          if (content) {
            const parsed = parseAiJson(content);
            let suggestions: any[] = [];
            if (Array.isArray(parsed)) {
              suggestions = parsed;
            } else if (Array.isArray(parsed.suggestions)) {
              suggestions = parsed.suggestions;
            } else if (Array.isArray(parsed.matches)) {
              suggestions = parsed.matches;
            } else if (Array.isArray(parsed.results)) {
              suggestions = parsed.results;
            }
            allSuggestions.push(...suggestions.filter((s: any) => s.dealId && Array.isArray(s.matches)));
          }
        } catch (aiErr: any) {
          console.error("AI matching error for batch:", aiErr.message);
        }
      }

      res.json({
        suggestions: allSuggestions,
        totalUnlinked: unlinkedDeals.length,
        totalContacts: allContacts.length,
        totalCompanies: allCompanies.length,
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/crm/ai-match/apply", async (req, res) => {
    try {
      const { matches } = req.body;
      if (!Array.isArray(matches) || matches.length === 0) {
        return res.status(400).json({ error: "matches array required" });
      }

      const validTypes = ["contact", "company"];
      const validRoles = ["landlord", "tenant", "client_contact", "invoicing_entity", "related"];

      let applied = 0;
      const errors: string[] = [];

      for (const match of matches) {
        try {
          const { dealId, entityType, entityId, role } = match;
          if (!dealId || !entityType || !entityId || !role) continue;
          if (!validTypes.includes(entityType) || !validRoles.includes(role)) continue;

          if (entityType === "contact") {
            if (role === "client_contact") {
              await db.update(crmDeals).set({ clientContactId: entityId }).where(eq(crmDeals.id, dealId));
            }
            const existing = await db.select().from(crmContactDeals)
              .where(and(eq(crmContactDeals.contactId, entityId), eq(crmContactDeals.dealId, dealId)));
            if (existing.length === 0) {
              await db.insert(crmContactDeals).values({ contactId: entityId, dealId });
            }
            applied++;
          } else if (entityType === "company") {
            if (role === "landlord") {
              await db.update(crmDeals).set({ landlordId: entityId }).where(eq(crmDeals.id, dealId));
            } else if (role === "tenant") {
              await db.update(crmDeals).set({ tenantId: entityId }).where(eq(crmDeals.id, dealId));
            } else if (role === "invoicing_entity") {
              await db.update(crmDeals).set({ invoicingEntityId: entityId }).where(eq(crmDeals.id, dealId));
            }
            const existing = await db.select().from(crmCompanyDeals)
              .where(and(eq(crmCompanyDeals.companyId, entityId), eq(crmCompanyDeals.dealId, dealId)));
            if (existing.length === 0) {
              await db.insert(crmCompanyDeals).values({ companyId: entityId, dealId });
            }
            applied++;
          }
        } catch (matchErr: any) {
          errors.push(`${match.dealId}: ${matchErr.message}`);
        }
      }

      res.json({ applied, errors, total: matches.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  async function findOrCreateCompany(name: string, opts?: { companyType?: string }): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Company name required");
    const existing = await db.select().from(crmCompanies)
      .where(sql`LOWER(${crmCompanies.name}) = LOWER(${trimmed})`)
      .limit(1);
    if (existing.length > 0) {
      if (opts?.companyType && !existing[0].companyType) {
        await db.update(crmCompanies).set({ companyType: opts.companyType }).where(eq(crmCompanies.id, existing[0].id));
      }
      return existing[0].id;
    }
    const [created] = await db.insert(crmCompanies).values({
      name: trimmed,
      companyType: opts?.companyType || null,
    }).returning({ id: crmCompanies.id });
    return created.id;
  }

  async function findOrCreateContact(
    name: string,
    opts: { email?: string | null; phone?: string | null; role?: string | null; companyId?: string | null; companyName?: string | null; contactType?: string | null; agentSpecialty?: string | null }
  ): Promise<string> {
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Contact name required");
    let existing: typeof crmContacts.$inferSelect | null = null;
    if (opts.email) {
      const byEmail = await db.select().from(crmContacts)
        .where(sql`LOWER(${crmContacts.email}) = LOWER(${opts.email.trim()})`)
        .limit(1);
      if (byEmail.length > 0) existing = byEmail[0];
    }
    if (!existing && opts.companyId) {
      const byNameAndCompany = await db.select().from(crmContacts)
        .where(and(sql`LOWER(${crmContacts.name}) = LOWER(${trimmed})`, eq(crmContacts.companyId, opts.companyId)))
        .limit(1);
      if (byNameAndCompany.length > 0) existing = byNameAndCompany[0];
    }
    if (!existing) {
      const byName = await db.select().from(crmContacts)
        .where(sql`LOWER(${crmContacts.name}) = LOWER(${trimmed})`)
        .limit(1);
      if (byName.length > 0) existing = byName[0];
    }
    if (existing) {
      const updates: Record<string, any> = {};
      if (!existing.phone && opts.phone) updates.phone = opts.phone.trim();
      if (!existing.role && opts.role) updates.role = opts.role.trim();
      if (!existing.companyId && opts.companyId) updates.companyId = opts.companyId;
      if (!existing.companyName && opts.companyName) updates.companyName = opts.companyName.trim();
      if (!existing.contactType && opts.contactType) updates.contactType = opts.contactType;
      if (!existing.agentSpecialty && opts.agentSpecialty) updates.agentSpecialty = opts.agentSpecialty;
      if (!existing.email && opts.email) updates.email = opts.email.trim();
      if (Object.keys(updates).length > 0) {
        await db.update(crmContacts).set(updates).where(eq(crmContacts.id, existing.id));
      }
      return existing.id;
    }
    const [created] = await db.insert(crmContacts).values({
      name: trimmed,
      email: opts.email?.trim() || null,
      phone: opts.phone?.trim() || null,
      role: opts.role?.trim() || null,
      companyId: opts.companyId || null,
      companyName: opts.companyName?.trim() || null,
      contactType: opts.contactType || null,
      agentSpecialty: opts.agentSpecialty || null,
    }).returning({ id: crmContacts.id });
    return created.id;
  }

  async function requirementExists(name: string, companyId: string | null): Promise<boolean> {
    if (!companyId) {
      const existing = await db.select({ id: crmRequirementsLeasing.id }).from(crmRequirementsLeasing)
        .where(sql`LOWER(${crmRequirementsLeasing.name}) = LOWER(${name.trim()})`)
        .limit(1);
      return existing.length > 0;
    }
    const existing = await db.select({ id: crmRequirementsLeasing.id }).from(crmRequirementsLeasing)
      .where(and(
        sql`LOWER(${crmRequirementsLeasing.name}) = LOWER(${name.trim()})`,
        eq(crmRequirementsLeasing.companyId, companyId)
      ))
      .limit(1);
    return existing.length > 0;
  }

  const SIZE_BUCKETS = [
    { label: "Under 500 sq ft", min: 0, max: 500 },
    { label: "500 - 1,000 sq ft", min: 500, max: 1000 },
    { label: "1,000 - 2,000 sq ft", min: 1000, max: 2000 },
    { label: "2,000 - 3,500 sq ft", min: 2000, max: 3500 },
    { label: "3,500 - 5,000 sq ft", min: 3500, max: 5000 },
    { label: "5,000 - 10,000 sq ft", min: 5000, max: 10000 },
    { label: "10,000 - 25,000 sq ft", min: 10000, max: 25000 },
    { label: "25,000 - 50,000 sq ft", min: 25000, max: 50000 },
    { label: "50,000 sq ft +", min: 50000, max: Infinity },
  ];

  function parseNum(s: string): number {
    return parseInt(s.replace(/,/g, ""), 10);
  }

  function mapPitchToRequirementType(pitch: string | null, description: string | null): string[] {
    if (!pitch && !description) return [];
    const text = [pitch, description].filter(Boolean).join(" ").toLowerCase();
    const types: string[] = [];
    if (/shopping\s*centre|mall/i.test(text)) types.push("Shopping Centre");
    if (/high\s*street|town\s*centre|city\s*centre|prime\s*pitch/i.test(text)) types.push("High street");
    if (/retail\s*park|out\s*of\s*town|roadside/i.test(text)) types.push("Retail Park");
    if (/leisure\s*park|leisure\s*scheme/i.test(text)) types.push("Leisure Park");
    return types;
  }

  function mapSizeToBuckets(raw: string): string[] {
    if (!raw || raw === "Area") return [];
    const normalized = raw.toLowerCase().trim();
    if (normalized.includes("acre")) return [];

    let minVal: number | null = null;
    let maxVal: number | null = null;

    const rangeMatch = normalized.match(/([\d,]+)\s*[-–to]+\s*([\d,]+)\s*(ft2|sq\s*ft|sqft|sf)?/);
    if (rangeMatch) {
      minVal = parseNum(rangeMatch[1]);
      maxVal = rangeMatch[2] ? parseNum(rangeMatch[2]) : null;
    }

    if (minVal === null) {
      const plusMatch = normalized.match(/([\d,]+)\s*\+/) || normalized.match(/([\d,]+)\s*(sq\s*ft|sqft|sf)?\s*(?:and\s+)?(?:above|over|upwards|minimum)/);
      if (plusMatch) {
        minVal = parseNum(plusMatch[1]);
        maxVal = null;
      }
    }

    if (minVal === null) {
      const underMatch = normalized.match(/under\s*([\d,]+)|up\s*to\s*([\d,]+)|less\s*than\s*([\d,]+)|max(?:imum)?\s*([\d,]+)/);
      if (underMatch) {
        minVal = 0;
        maxVal = parseNum(underMatch[1] || underMatch[2] || underMatch[3] || underMatch[4]);
      }
    }

    if (minVal === null) {
      const singleMatch = normalized.match(/([\d,]+)\s*(ft2|sq\s*ft|sqft|sf|square\s*f)/);
      if (singleMatch) {
        minVal = parseNum(singleMatch[1]);
        maxVal = null;
      }
    }

    if (minVal === null) {
      const anyNum = normalized.match(/([\d,]{3,})/);
      if (anyNum) {
        minVal = parseNum(anyNum[1]);
        maxVal = null;
      }
    }

    if (minVal === null) return [];
    if (maxVal === null || maxVal <= minVal) maxVal = minVal * 2 || 500;

    const buckets: string[] = [];
    for (const b of SIZE_BUCKETS) {
      if (minVal < b.max && maxVal > b.min) {
        buckets.push(b.label);
      }
    }
    return buckets;
  }

  app.post("/api/crm/bulk-import/:source", async (req, res) => {
    const source = req.params.source.toLowerCase();
    if (source !== "pipnet" && source !== "trl") {
      return res.status(400).json({ error: "Source must be 'pipnet' or 'trl'" });
    }

    try {
      const stats = {
        companies: { created: 0, existing: 0 },
        contacts: { created: 0, existing: 0 },
        requirements: { created: 0, skipped: 0 },
        errors: [] as string[],
      };

      if (source === "pipnet") {
        const twelveMonthsAgoPip = new Date();
        twelveMonthsAgoPip.setMonth(twelveMonthsAgoPip.getMonth() - 12);
        const rows = await searchPipnetRequirements({ allPages: true, maxPages: 50 });

        for (const row of rows) {
          try {
            const clientName = row["Client"] || row["Company"] || row["Name"] || "";
            if (!clientName || clientName === "[No Client Quoted]") continue;

            const docDate = row["Document Date"] || "";
            if (docDate) {
              const parts = docDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
              if (parts) {
                const year = parts[3].length === 2 ? 2000 + parseInt(parts[3]) : parseInt(parts[3]);
                const rowDate = new Date(year, parseInt(parts[2]) - 1, parseInt(parts[1]));
                if (rowDate < twelveMonthsAgoPip) {
                  stats.requirements.skipped++;
                  continue;
                }
              }
            }

            const clientExisted = (await db.select({ id: crmCompanies.id }).from(crmCompanies)
              .where(sql`LOWER(${crmCompanies.name}) = LOWER(${clientName.trim()})`)
              .limit(1)).length > 0;
            const clientCompanyId = await findOrCreateCompany(clientName);
            if (clientExisted) stats.companies.existing++;
            else stats.companies.created++;

            const agentName = row["Agent"] || "";
            const contactName = row["Contact"] || "";
            const contactEmail = row["Email"] || null;
            const contactPhone = row["Tel. No"] || row["Phone"] || row["Telephone"] || null;

            let agentContactId: string | null = null;
            if (agentName) {
              const agentCompanyExisted = (await db.select({ id: crmCompanies.id }).from(crmCompanies)
                .where(sql`LOWER(${crmCompanies.name}) = LOWER(${agentName.trim()})`)
                .limit(1)).length > 0;
              const agentCompanyId = await findOrCreateCompany(agentName, { companyType: "Agent" });
              if (agentCompanyExisted) stats.companies.existing++;
              else stats.companies.created++;

              if (contactName) {
                const agentContactExisted = contactEmail
                  ? (await db.select({ id: crmContacts.id }).from(crmContacts)
                      .where(sql`LOWER(${crmContacts.email}) = LOWER(${contactEmail.trim()})`)
                      .limit(1)).length > 0
                  : (await db.select({ id: crmContacts.id }).from(crmContacts)
                      .where(and(
                        sql`LOWER(${crmContacts.name}) = LOWER(${contactName.trim()})`,
                        eq(crmContacts.companyId, agentCompanyId)
                      ))
                      .limit(1)).length > 0;
                agentContactId = await findOrCreateContact(contactName, {
                  email: contactEmail,
                  phone: contactPhone,
                  companyId: agentCompanyId,
                  companyName: agentName,
                  contactType: "Agent",
                  agentSpecialty: "Leasing",
                });
                if (agentContactExisted) stats.contacts.existing++;
                else stats.contacts.created++;
              }
            } else if (contactName) {
              const contactExisted = contactEmail
                ? (await db.select({ id: crmContacts.id }).from(crmContacts)
                    .where(sql`LOWER(${crmContacts.email}) = LOWER(${contactEmail.trim()})`)
                    .limit(1)).length > 0
                : (await db.select({ id: crmContacts.id }).from(crmContacts)
                    .where(sql`LOWER(${crmContacts.name}) = LOWER(${contactName.trim()})`)
                    .limit(1)).length > 0;
              agentContactId = await findOrCreateContact(contactName, {
                email: contactEmail,
                phone: contactPhone,
                contactType: "Agent",
                agentSpecialty: "Leasing",
              });
              if (contactExisted) stats.contacts.existing++;
              else stats.contacts.created++;
            }

            if (await requirementExists(clientName, clientCompanyId)) {
              stats.requirements.skipped++;
              continue;
            }

            const area = row["Area"] || row["Size"] || row["Sales Area"] || "";
            const sizeBuckets = mapSizeToBuckets(area);
            const location = row["Location"] || "";
            const useClass = row["Use"] || row["Use Class"] || "";
            const tenure = row["Tenure"] || "";

            let requirementDate: string | null = null;
            if (docDate) {
              const parts = docDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
              if (parts) {
                const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3];
                requirementDate = `${year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
              }
            }

            const pipDescription = row["Description"] || row["Notes"] || "";
            const pipPitch = row["Pitch"] || row["Location Type"] || "";
            const pipReqType = mapPitchToRequirementType(pipPitch, pipDescription);
            await db.insert(crmRequirementsLeasing).values({
              name: clientName,
              companyId: clientCompanyId,
              principalContactId: null,
              agentContactId,
              use: useClass ? [useClass] : null,
              requirementType: pipReqType.length > 0 ? pipReqType : null,
              size: sizeBuckets.length > 0 ? sizeBuckets : null,
              requirementLocations: location ? [location] : null,
              requirementDate,
              comments: [
                agentName ? `Agent: ${agentName}` : null,
                area ? `Size: ${area}` : null,
                tenure ? `Tenure: ${tenure}` : null,
                `Source: PIPnet`,
              ].filter(Boolean).join("\n"),
              status: "Active",
            });
            stats.requirements.created++;
          } catch (err: any) {
            stats.errors.push(`PIPnet row: ${err.message}`);
          }
        }
      }

      if (source === "trl") {
        const twelveMonthsAgo = new Date();
        twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

        let pages: string[] = [];
        try {
          const reqSearch = await scrapeTrlRequirementSearch();
          pages = reqSearch.map(r => r.url);
        } catch {
          try {
            pages = await discoverTrlPages();
          } catch {
            pages = [];
          }
        }
        if (pages.length === 0) pages = KNOWN_TRL_PAGES;

        for (const url of pages) {
          try {
            const data = await scrapeTrlPage(url);
            if (!data || !data.companyName) continue;

            const updatedDate = data.lastUpdated ? new Date(data.lastUpdated) : null;
            if (updatedDate && !isNaN(updatedDate.getTime()) && updatedDate < twelveMonthsAgo) {
              stats.requirements.skipped++;
              continue;
            }

            const companyBefore = (await db.select({ id: crmCompanies.id }).from(crmCompanies)
              .where(sql`LOWER(${crmCompanies.name}) = LOWER(${data.companyName.trim()})`)
              .limit(1));
            const companyExisted = companyBefore.length > 0;
            const companyId = await findOrCreateCompany(data.companyName);
            if (companyExisted) stats.companies.existing++;
            else stats.companies.created++;

            let agentContactId: string | null = null;
            let principalContactId: string | null = null;
            if (data.contact.name) {
              const contactBefore = data.contact.email
                ? (await db.select({ id: crmContacts.id }).from(crmContacts)
                    .where(sql`LOWER(${crmContacts.email}) = LOWER(${data.contact.email.trim()})`)
                    .limit(1))
                : (await db.select({ id: crmContacts.id }).from(crmContacts)
                    .where(sql`LOWER(${crmContacts.name}) = LOWER(${data.contact.name.trim()})`)
                    .limit(1));
              const contactExisted = contactBefore.length > 0;

              let isInHouse = false;
              let agentCompanyId: string | null = null;
              if (data.contact.email) {
                const domain = data.contact.email.split("@")[1]?.toLowerCase();
                const companyNameNorm = data.companyName.toLowerCase().replace(/[^a-z0-9]/g, "");
                const domainBase = domain?.split(".")[0]?.replace(/[^a-z0-9]/g, "") || "";
                if (domainBase && companyNameNorm.includes(domainBase)) {
                  isInHouse = true;
                } else if (domain) {
                  const existingAgency = await db.select().from(crmCompanies)
                    .where(and(sql`${crmCompanies.companyType} LIKE 'Agent%'`, sql`LOWER(${crmCompanies.name}) LIKE '%' || ${domainBase} || '%'`))
                    .limit(1);
                  if (existingAgency.length > 0) {
                    agentCompanyId = existingAgency[0].id;
                  } else {
                    const agencyName = domainBase.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, c => c.toUpperCase());
                    agentCompanyId = await findOrCreateCompany(agencyName, { companyType: "Agent" });
                  }
                }
              }

              if (isInHouse) {
                principalContactId = await findOrCreateContact(data.contact.name, {
                  email: data.contact.email,
                  phone: data.contact.phone,
                  role: data.contact.title,
                  companyId,
                  companyName: data.companyName,
                });
              } else {
                agentContactId = await findOrCreateContact(data.contact.name, {
                  email: data.contact.email,
                  phone: data.contact.phone,
                  role: data.contact.title,
                  companyId: agentCompanyId,
                  contactType: "Agent",
                  agentSpecialty: "Leasing",
                });
              }
              if (contactExisted) stats.contacts.existing++;
              else stats.contacts.created++;
            }

            if (await requirementExists(data.companyName, companyId)) {
              stats.requirements.skipped++;
              continue;
            }

            let trlDate: string | null = null;
            if (data.lastUpdated) {
              const parsed = new Date(data.lastUpdated);
              if (!isNaN(parsed.getTime())) {
                trlDate = parsed.toISOString().split("T")[0];
              } else {
                const qMatch = data.lastUpdated.match(/Q(\d),?\s*(\d{4})/);
                if (qMatch) {
                  const quarterMonth = { "1": "01", "2": "04", "3": "07", "4": "10" }[qMatch[1]] || "01";
                  trlDate = `${qMatch[2]}-${quarterMonth}-01`;
                } else {
                  const dateParts = data.lastUpdated.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
                  if (dateParts) {
                    const year = dateParts[3].length === 2 ? `20${dateParts[3]}` : dateParts[3];
                    trlDate = `${year}-${dateParts[2].padStart(2, "0")}-${dateParts[1].padStart(2, "0")}`;
                  }
                }
              }
            }

            const mappedReqType = mapPitchToRequirementType(data.pitch, data.description);
            await db.insert(crmRequirementsLeasing).values({
              name: data.companyName,
              companyId,
              principalContactId,
              agentContactId,
              use: data.mappedUse && data.mappedUse.length > 0 ? data.mappedUse : null,
              requirementType: mappedReqType.length > 0 ? mappedReqType : null,
              size: data.sizeRange ? mapSizeToBuckets(data.sizeRange) : null,
              requirementLocations: data.locations && data.locations.length > 0 ? data.locations : null,
              requirementDate: trlDate,
              comments: [
                data.description,
                data.pitch ? `Pitch: ${data.pitch}` : null,
                data.useClass ? `Use Class: ${data.useClass}` : null,
                data.sizeRange ? `Size: ${data.sizeRange}` : null,
                data.tenure ? `Tenure: ${data.tenure}` : null,
                `Source: TRL`,
              ].filter(Boolean).join("\n"),
              status: "Active",
            });
            stats.requirements.created++;

            await new Promise((r) => setTimeout(r, 300));
          } catch (err: any) {
            stats.errors.push(`TRL ${url}: ${err.message}`);
          }
        }
      }

      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/crm/import-trl-directories", async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    const directory = req.body?.directory as string | undefined;
    if (directory && !["occupier", "agency", "both"].includes(directory)) {
      return res.status(400).json({ error: "directory must be 'occupier', 'agency', or 'both'" });
    }

    try {
      const stats = {
        companies: { created: 0, existing: 0 },
        contacts: { created: 0, existing: 0 },
        errors: [] as string[],
      };

      if (!directory || directory === "occupier" || directory === "both") {
        try {
          const occupiers = await scrapeTrlOccupierDirectory();
          for (const occ of occupiers) {
            try {
              const existed = (await db.select({ id: crmCompanies.id }).from(crmCompanies)
                .where(sql`LOWER(${crmCompanies.name}) = LOWER(${occ.name.trim()})`)
                .limit(1)).length > 0;

              const useMap: Record<string, string> = {
                "restaurant": "Tenant - Restaurant",
                "retail": "Tenant - Retail",
                "leisure": "Tenant - Leisure",
              };
              let companyType = "Tenant - Retail";
              const data = await scrapeTrlPage(occ.url);
              if (data && data.mappedUse && data.mappedUse.length > 0) {
                const firstUse = data.mappedUse[0].toLowerCase();
                companyType = useMap[firstUse] || "Tenant - Retail";
              }

              if (existed) {
                stats.companies.existing++;
              } else {
                await findOrCreateCompany(occ.name, { companyType });
                stats.companies.created++;
              }

              if (data && data.contact.name) {
                const contactExisted = data.contact.email
                  ? (await db.select({ id: crmContacts.id }).from(crmContacts)
                      .where(sql`LOWER(${crmContacts.email}) = LOWER(${data.contact.email.trim()})`)
                      .limit(1)).length > 0
                  : (await db.select({ id: crmContacts.id }).from(crmContacts)
                      .where(sql`LOWER(${crmContacts.name}) = LOWER(${data.contact.name.trim()})`)
                      .limit(1)).length > 0;

                const companyId = await findOrCreateCompany(occ.name);
                await findOrCreateContact(data.contact.name, {
                  email: data.contact.email,
                  phone: data.contact.phone,
                  role: data.contact.title,
                  companyId,
                  companyName: occ.name,
                });
                if (contactExisted) stats.contacts.existing++;
                else stats.contacts.created++;
              }

              await new Promise(r => setTimeout(r, 300));
            } catch (err: any) {
              stats.errors.push(`Occupier ${occ.name}: ${err.message}`);
            }
          }
        } catch (err: any) {
          stats.errors.push(`Occupier directory: ${err.message}`);
        }
      }

      if (!directory || directory === "agency" || directory === "both") {
        try {
          const agencies = await scrapeTrlAgencyListing();
          console.log(`[TRL Import] Found ${agencies.length} agencies in directory listing`);

          for (let i = 0; i < agencies.length; i++) {
            const agency = agencies[i];
            try {
              const detail = await scrapeTrlAgencyDetailPage(agency.slug);
              agency.name = detail.name;

              const existed = (await db.select({ id: crmCompanies.id }).from(crmCompanies)
                .where(sql`LOWER(${crmCompanies.name}) = LOWER(${detail.name.trim()})`)
                .limit(1)).length > 0;

              const agencyCompanyId = await findOrCreateCompany(detail.name, { companyType: "Agent" });
              if (existed) stats.companies.existing++;
              else stats.companies.created++;

              for (const contact of detail.contacts) {
                try {
                  const contactExisted = contact.email
                    ? (await db.select({ id: crmContacts.id }).from(crmContacts)
                        .where(sql`LOWER(${crmContacts.email}) = LOWER(${contact.email.trim()})`)
                        .limit(1)).length > 0
                    : (await db.select({ id: crmContacts.id }).from(crmContacts)
                        .where(sql`LOWER(${crmContacts.name}) = LOWER(${contact.name.trim()})`)
                        .limit(1)).length > 0;

                  await findOrCreateContact(contact.name, {
                    email: contact.email,
                    phone: contact.phone,
                    role: contact.title,
                    companyId: agencyCompanyId,
                    companyName: detail.name,
                    contactType: "Agent",
                    agentSpecialty: "Leasing",
                  });
                  if (contactExisted) stats.contacts.existing++;
                  else stats.contacts.created++;
                } catch (err: any) {
                  stats.errors.push(`Agency contact ${contact.name}: ${err.message}`);
                }
              }

              if ((i + 1) % 25 === 0) console.log(`[TRL Import] Contacts phase: ${i + 1}/${agencies.length} agencies scraped, ${stats.contacts.created} contacts created`);
              await new Promise(r => setTimeout(r, 200));
            } catch (err: any) {
              stats.errors.push(`Agency detail ${agency.slug}: ${err.message}`);
            }
          }
        } catch (err: any) {
          stats.errors.push(`Agency directory: ${err.message}`);
        }
      }

      res.json(stats);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/board-report", requireAuth, async (_req, res) => {
    try {
      const allDeals = await db.select().from(crmDeals);
      const allAllocations = await db.select().from(dealFeeAllocations);
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);

      const statusCounts: Record<string, number> = {};
      const teamCounts: Record<string, number> = {};
      const dealTypeCounts: Record<string, number> = {};
      const assetClassCounts: Record<string, number> = {};

      let totalFeesYTD = 0;
      let completedCount = 0;
      let totalDays = 0;
      let completedWithDays = 0;
      const fees: number[] = [];
      const monthlyFees: Record<string, number> = {};
      const topDeals: Array<{ name: string; fee: number; team: string; status: string; dealType: string }> = [];

      for (const deal of allDeals) {
        const status = deal.status || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        if (deal.team && Array.isArray(deal.team)) {
          for (const t of deal.team) {
            teamCounts[t] = (teamCounts[t] || 0) + 1;
          }
        }

        const dt = deal.dealType || "Unknown";
        dealTypeCounts[dt] = (dealTypeCounts[dt] || 0) + 1;

        const ac = deal.assetClass || "Unknown";
        assetClassCounts[ac] = (assetClassCounts[ac] || 0) + 1;

        if (deal.fee && deal.fee > 0) {
          fees.push(deal.fee);
          topDeals.push({
            name: deal.name || "Unnamed",
            fee: deal.fee,
            team: (deal.team || []).join(", "),
            status: deal.status || "",
            dealType: deal.dealType || "",
          });

          const completionStr = deal.completionDate || deal.updatedAt?.toISOString?.();
          if (completionStr) {
            const completionDate = new Date(completionStr);
            if (completionDate >= yearStart && completionDate <= now) {
              totalFeesYTD += deal.fee;
              const monthKey = `${completionDate.getFullYear()}-${String(completionDate.getMonth() + 1).padStart(2, "0")}`;
              monthlyFees[monthKey] = (monthlyFees[monthKey] || 0) + deal.fee;
            }
          }
        }

        const isComplete = status === "Invoiced" || status === "Exchanged";
        if (isComplete) completedCount++;

        if (isComplete && deal.createdAt) {
          const created = new Date(deal.createdAt);
          const completed = deal.completionDate ? new Date(deal.completionDate) : (deal.updatedAt || now);
          const days = Math.round((new Date(completed).getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          if (days > 0 && days < 1000) {
            totalDays += days;
            completedWithDays++;
          }
        }
      }

      topDeals.sort((a, b) => b.fee - a.fee);

      const conversionRate = allDeals.length > 0 ? Math.round((completedCount / allDeals.length) * 100) : 0;
      const avgDealSize = fees.length > 0 ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : 0;
      const avgTimeToClose = completedWithDays > 0 ? Math.round(totalDays / completedWithDays) : 0;

      const timeToCloseBuckets: Record<string, number> = {
        "0-30": 0, "31-60": 0, "61-90": 0, "91-180": 0, "181-365": 0, "365+": 0,
      };
      for (const deal of allDeals) {
        const isComplete = deal.status === "Invoiced" || deal.status === "Exchanged";
        if (isComplete && deal.createdAt) {
          const created = new Date(deal.createdAt);
          const completed = deal.completionDate ? new Date(deal.completionDate) : (deal.updatedAt || now);
          const days = Math.round((new Date(completed).getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          if (days >= 0 && days < 1000) {
            if (days <= 30) timeToCloseBuckets["0-30"]++;
            else if (days <= 60) timeToCloseBuckets["31-60"]++;
            else if (days <= 90) timeToCloseBuckets["61-90"]++;
            else if (days <= 180) timeToCloseBuckets["91-180"]++;
            else if (days <= 365) timeToCloseBuckets["181-365"]++;
            else timeToCloseBuckets["365+"]++;
          }
        }
      }

      const monthlyFeesArr = Object.entries(monthlyFees)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, total]) => ({ month, total: Math.round(total) }));

      const articles = await db.select().from(newsArticles);
      const tagCounts: Record<string, number> = {};
      const categoryCounts: Record<string, number> = {};
      const recentArticles = articles
        .filter(a => a.publishedAt && new Date(a.publishedAt) >= new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))
        .sort((a, b) => new Date(b.publishedAt!).getTime() - new Date(a.publishedAt!).getTime());

      for (const article of recentArticles) {
        if (article.aiTags) {
          for (const tag of article.aiTags) {
            tagCounts[tag] = (tagCounts[tag] || 0) + 1;
          }
        }
        if (article.category) {
          categoryCounts[article.category] = (categoryCounts[article.category] || 0) + 1;
        }
      }

      const trendingTags = Object.entries(tagCounts)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 15)
        .map(([tag, count]) => ({ tag, count }));

      const categoryBreakdown = Object.entries(categoryCounts)
        .sort(([, a], [, b]) => b - a)
        .map(([category, count]) => ({ category, count }));

      res.json({
        pipeline: {
          byStatus: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
          byTeam: Object.entries(teamCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
          byDealType: Object.entries(dealTypeCounts).map(([name, value]) => ({ name, value })),
          byAssetClass: Object.entries(assetClassCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
        },
        performance: {
          totalFeesYTD,
          conversionRate,
          avgDealSize,
          avgTimeToClose,
          monthlyFees: monthlyFeesArr,
          timeToCloseBuckets: Object.entries(timeToCloseBuckets).map(([range, count]) => ({ range, count })),
        },
        topDeals: topDeals.slice(0, 10),
        marketInsights: {
          trendingTags,
          categoryBreakdown,
          totalArticles: recentArticles.length,
        },
        totalDeals: allDeals.length,
        generatedAt: now.toISOString(),
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  const WIP_SENIOR_EMAILS = new Set([
    "woody@brucegillinghampollard.com",
    "charlotte@brucegillinghampollard.com",
    "rupert@brucegillinghampollard.com",
    "jack@brucegillinghampollard.com",
  ]);
  const WIP_RESTRICTED_AGENTS = new Set([
    "woody bruce", "charlotte roberts", "rupert bentley-smith", "jack barratt",
  ]);
  async function isWipSenior(req: Request): Promise<boolean> {
    const userId = req.session?.userId || (req as any).tokenUserId;
    if (!userId) return false;
    const user = await storage.getUser(userId);
    return !!user?.email && WIP_SENIOR_EMAILS.has(user.email.toLowerCase());
  }

  app.get("/api/wip/agent-summary", requireAuth, async (req, res) => {
    try {
      const senior = await isWipSenior(req);
      const userId = req.session?.userId || (req as any).tokenUserId;
      const currentUser = userId ? await storage.getUser(userId) : null;
      const isAdmin = !!currentUser?.isAdmin;
      const userTeam = currentUser?.team || null;

      const deals = await db.select().from(crmDeals);
      const allocations = await db.select().from(dealFeeAllocations);
      const allocsByDeal = new Map<string, typeof allocations>();
      for (const a of allocations) {
        const existing = allocsByDeal.get(a.dealId);
        if (existing) {
          existing.push(a);
        } else {
          allocsByDeal.set(a.dealId, [a]);
        }
      }

      const INVOICED_STATUSES = ["Invoiced", "Billed"];
      const agentTotals = new Map<string, { invoiced: number; wip: number }>();

      for (const deal of deals) {
        if (!deal.status || deal.fee == null) continue;
        const dealTeamArr = Array.isArray(deal.team) ? deal.team : (deal.team ? [deal.team] : []);
        const dealTeamsLower = dealTeamArr.map(t => (t || "").toLowerCase());
        if (!senior && dealTeamsLower.includes("bgp")) continue;
        if (!isAdmin) {
          if (!userTeam) continue;
          if (!dealTeamsLower.some(t => t === userTeam.toLowerCase())) continue;
        }
        const totalFee = deal.fee;
        const isInvoiced = INVOICED_STATUSES.includes(deal.status);
        const agents = allocsByDeal.get(deal.id);

        if (agents && agents.length > 0) {
          for (const alloc of agents) {
            if (!senior && WIP_RESTRICTED_AGENTS.has(alloc.agentName.toLowerCase())) continue;
            const agentFee = alloc.fixedAmount || Math.round(totalFee * ((alloc.percentage || 0) / 100) * 100) / 100;
            const entry = agentTotals.get(alloc.agentName) || { invoiced: 0, wip: 0 };
            if (isInvoiced) entry.invoiced += agentFee;
            else entry.wip += agentFee;
            agentTotals.set(alloc.agentName, entry);
          }
        } else {
          const agentNames = Array.isArray(deal.internalAgent) ? deal.internalAgent : deal.internalAgent ? [deal.internalAgent] : [];
          if (agentNames.length === 0) continue;
          const filteredNames = senior ? agentNames : agentNames.filter(n => !WIP_RESTRICTED_AGENTS.has(n.toLowerCase()));
          if (filteredNames.length === 0) continue;
          const perAgent = totalFee / filteredNames.length;
          for (const name of filteredNames) {
            const entry = agentTotals.get(name) || { invoiced: 0, wip: 0 };
            if (isInvoiced) entry.invoiced += perAgent;
            else entry.wip += perAgent;
            agentTotals.set(name, entry);
          }
        }
      }

      const result = Array.from(agentTotals.entries())
        .map(([agent, totals]) => ({ agent, invoiced: Math.round(totals.invoiced), wip: Math.round(totals.wip) }))
        .sort((a, b) => (b.invoiced + b.wip) - (a.invoiced + a.wip));

      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/wip/agent-drilldown/:agentName", requireAuth, async (req, res) => {
    try {
      const senior = await isWipSenior(req);
      const agentName = decodeURIComponent(req.params.agentName);

      const deals = await db.select().from(crmDeals);
      const allocations = await db.select().from(dealFeeAllocations);
      const properties = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties);
      const companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies);

      const propMap = new Map(properties.map(p => [p.id, p.name]));
      const compMap = new Map(companies.map(c => [c.id, c.name]));

      const allocsByDeal = new Map<string, typeof allocations>();
      for (const a of allocations) {
        const existing = allocsByDeal.get(a.dealId);
        if (existing) {
          existing.push(a);
        } else {
          allocsByDeal.set(a.dealId, [a]);
        }
      }

      const INVOICED_STATUSES = ["Invoiced", "Billed"];
      const EXCLUDED_STATUSES = ["Dead", "Leasing Comps", "Investment Comps"];
      const result: any[] = [];

      for (const deal of deals) {
        if (EXCLUDED_STATUSES.includes(deal.status || "")) continue;
        const totalFee = deal.fee || 0;
        const isInvoiced = INVOICED_STATUSES.includes(deal.status || "");
        const dealAllocs = allocsByDeal.get(deal.id);
        let allocatedAmount = 0;
        let isRelevant = false;

        if (dealAllocs && dealAllocs.length > 0) {
          const agentAlloc = dealAllocs.find(a => a.agentName.toLowerCase() === agentName.toLowerCase());
          if (agentAlloc) {
            isRelevant = true;
            const pct = (agentAlloc.percentage || 0) / 100;
            allocatedAmount = agentAlloc.fixedAmount || (totalFee * pct);
          }
        } else {
          const agentNames = Array.isArray(deal.internalAgent) ? deal.internalAgent : (deal.internalAgent ? [deal.internalAgent] : []);
          if (agentNames.some(n => n.toLowerCase() === agentName.toLowerCase())) {
            isRelevant = true;
            allocatedAmount = agentNames.length > 0 ? totalFee / agentNames.length : totalFee;
          }
        }

        if (!isRelevant) continue;

        const dealTeamArr = Array.isArray(deal.team) ? deal.team : (deal.team ? [deal.team] : []);
        if (!senior && dealTeamArr.some(t => (t || "").toLowerCase() === "bgp")) continue;

        const propertyName = deal.propertyId ? propMap.get(deal.propertyId) || null : null;
        const tenantName = deal.tenantId ? compMap.get(deal.tenantId) || null : null;

        function drilldownStage(status: string | null): string {
          if (!status) return "pipeline";
          if (INVOICED_STATUSES.includes(status)) return "invoiced";
          if (["SOLs", "Under Negotiation", "HOTs", "NEG", "Live", "Exchanged", "Completed"].includes(status)) return "wip";
          return "pipeline";
        }

        result.push({
          dealId: deal.id,
          name: deal.name,
          property: propertyName,
          tenant: tenantName,
          dealType: deal.dealType || null,
          totalFee: totalFee,
          allocatedAmount: Math.round(allocatedAmount),
          status: deal.status || null,
          stage: drilldownStage(deal.status),
          team: dealTeamArr.join(", "),
          isInvoiced,
          wip: isInvoiced ? 0 : Math.round(allocatedAmount),
          invoiced: isInvoiced ? Math.round(allocatedAmount) : 0,
        });
      }

      result.sort((a, b) => b.allocatedAmount - a.allocatedAmount);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/wip", requireAuth, async (req, res) => {
    try {
      const senior = await isWipSenior(req);
      const userId = req.session?.userId || (req as any).tokenUserId;
      const currentUser = userId ? await storage.getUser(userId) : null;
      const isAdmin = !!currentUser?.isAdmin;
      const userTeam = currentUser?.team || null;

      const INVOICED_STATUSES = ["Invoiced", "Billed"];
      const EXCLUDED_STATUSES = ["Dead", "Leasing Comps", "Investment Comps"];

      const deals = await db.select().from(crmDeals);
      const properties = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties);
      const companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies);
      const invoices = await db.select().from(xeroInvoices);
      const wipRows = await db.select().from(wipEntries);
      const allAllocations = await db.select().from(dealFeeAllocations);
      const allocsByDealId = new Map<string, typeof allAllocations>();
      for (const a of allAllocations) {
        if (!allocsByDealId.has(a.dealId)) allocsByDealId.set(a.dealId, []);
        allocsByDealId.get(a.dealId)!.push(a);
      }

      const propMap = new Map(properties.map(p => [p.id, p.name]));
      const compMap = new Map(companies.map(c => [c.id, c.name]));

      const invoicesByDeal = new Map<string, { totalAmount: number; invoiceNo: string | null; status: string | null }>();
      for (const inv of invoices) {
        const existing = invoicesByDeal.get(inv.dealId);
        if (existing) {
          existing.totalAmount += inv.totalAmount || 0;
          if (inv.invoiceNumber) existing.invoiceNo = inv.invoiceNumber;
        } else {
          invoicesByDeal.set(inv.dealId, {
            totalAmount: inv.totalAmount || 0,
            invoiceNo: inv.invoiceNumber || null,
            status: inv.status || null,
          });
        }
      }

      // Build lookup maps — use separate maps to avoid name/property overwrites
      const dealByName = new Map<string, typeof deals[0]>();
      const dealByProperty = new Map<string, typeof deals[0]>();
      for (const d of deals) {
        if (d.name) dealByName.set(d.name.toLowerCase().trim(), d);
        const propName = d.propertyId ? propMap.get(d.propertyId) : null;
        if (propName) dealByProperty.set(propName.toLowerCase().trim(), d);
      }
      // Combined lookup: check name first, then property
      const findDeal = (key: string) => dealByName.get(key) || dealByProperty.get(key);

      function deriveStage(status: string | null): string {
        if (!status) return "pipeline";
        if (INVOICED_STATUSES.includes(status)) return "invoiced";
        if (["SOLs", "Under Negotiation", "HOTs", "NEG", "Live", "Exchanged", "Completed"].includes(status)) return "wip";
        return "pipeline";
      }

      function deriveFiscalYear(deal: any): number | null {
        if (deal.completionDate) {
          const d = new Date(deal.completionDate);
          if (!isNaN(d.getTime())) {
            const month = d.getMonth() + 1;
            return month >= 4 ? d.getFullYear() + 1 : d.getFullYear();
          }
        }
        if (!deal.createdAt) return null;
        const created = new Date(deal.createdAt);
        const month = created.getMonth() + 1;
        return month >= 4 ? created.getFullYear() + 1 : created.getFullYear();
      }

      function deriveMonth(deal: any): string | null {
        const dateStr = deal.completionDate || (deal.updatedAt ? new Date(deal.updatedAt).toISOString() : null);
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
      }

      const usedDealIds = new Set<string>();

      let entries: any[] = wipRows.map(r => {
        const projectKey = (r.project || "").toLowerCase().trim();
        const refKey = (r.ref || "").toLowerCase().trim();
        const matchedDeal = findDeal(projectKey) || findDeal(refKey);
        if (matchedDeal) usedDealIds.add(matchedDeal.id);
        const tenantName = matchedDeal?.tenantId ? compMap.get(matchedDeal.tenantId) || null : null;

        return {
          id: r.id,
          dealId: matchedDeal?.id || null,
          dealType: matchedDeal?.dealType || null,
          ref: r.ref,
          groupName: r.groupName,
          project: r.project,
          tenant: r.tenant || tenantName,
          team: r.team,
          agent: r.agent,
          assetClass: matchedDeal?.assetClass || null,
          amtWip: r.amtWip || 0,
          amtInvoice: r.amtInvoice || 0,
          month: r.month,
          dealStatus: r.dealStatus,
          stage: r.stage,
          invoiceNo: r.invoiceNo,
          orderNumber: r.orderNumber,
          fiscalYear: r.fiscalYear,
          source: "spreadsheet" as const,
        };
      });

      const unmatchedDeals = deals.filter(d =>
        !EXCLUDED_STATUSES.includes(d.status || "") && !usedDealIds.has(d.id)
      );
      for (const deal of unmatchedDeals) {
        const teamStr = Array.isArray(deal.team) ? deal.team.join(", ") : (deal.team || null);
        const propertyName = deal.propertyId ? propMap.get(deal.propertyId) || null : null;
        const tenantName = deal.tenantId ? compMap.get(deal.tenantId) || null : null;
        const invoice = invoicesByDeal.get(deal.id);
        const stage = deriveStage(deal.status);
        const isInvoiced = stage === "invoiced";
        const totalFee = deal.fee || 0;
        const totalInvoiceAmt = invoice?.totalAmount || (isInvoiced ? totalFee : 0);

        const dealAllocations = allocsByDealId.get(deal.id);

        if (dealAllocations && dealAllocations.length > 0) {
          // Use fee allocations: one WIP entry per allocation
          for (const alloc of dealAllocations) {
            const allocPct = (alloc.percentage || 0) / 100;
            const agentFee = alloc.fixedAmount || Math.round(totalFee * allocPct * 100) / 100;
            const agentInvoiceAmt = alloc.fixedAmount || Math.round(totalInvoiceAmt * allocPct * 100) / 100;
            entries.push({
              id: `${deal.id}_${alloc.agentName}`,
              dealId: deal.id,
              dealType: deal.dealType || null,
              ref: deal.name,
              groupName: deal.groupName || null,
              project: propertyName,
              tenant: tenantName,
              team: teamStr,
              agent: alloc.agentName,
              assetClass: deal.assetClass || null,
              amtWip: isInvoiced ? 0 : agentFee,
              amtInvoice: agentInvoiceAmt,
              month: deriveMonth(deal),
              dealStatus: deal.status || null,
              stage,
              invoiceNo: invoice?.invoiceNo || null,
              orderNumber: null,
              fiscalYear: deriveFiscalYear(deal),
              source: "crm" as const,
            });
          }
        } else {
          // No allocations: split equally among internalAgent array, one row per agent
          const agentNames = Array.isArray(deal.internalAgent) ? deal.internalAgent : (deal.internalAgent ? [deal.internalAgent] : []);
          if (agentNames.length === 0) {
            // No agents at all — still add as a single entry with null agent
            entries.push({
              id: deal.id,
              dealId: deal.id,
              dealType: deal.dealType || null,
              ref: deal.name,
              groupName: deal.groupName || null,
              project: propertyName,
              tenant: tenantName,
              team: teamStr,
              agent: null,
              assetClass: deal.assetClass || null,
              amtWip: isInvoiced ? 0 : totalFee,
              amtInvoice: totalInvoiceAmt,
              month: deriveMonth(deal),
              dealStatus: deal.status || null,
              stage,
              invoiceNo: invoice?.invoiceNo || null,
              orderNumber: null,
              fiscalYear: deriveFiscalYear(deal),
              source: "crm" as const,
            });
          } else {
            const perAgentFee = totalFee / agentNames.length;
            const perAgentInvoice = totalInvoiceAmt / agentNames.length;
            for (const agentName of agentNames) {
              entries.push({
                id: `${deal.id}_${agentName}`,
                dealId: deal.id,
                dealType: deal.dealType || null,
                ref: deal.name,
                groupName: deal.groupName || null,
                project: propertyName,
                tenant: tenantName,
                team: teamStr,
                agent: agentName,
                assetClass: deal.assetClass || null,
                amtWip: isInvoiced ? 0 : perAgentFee,
                amtInvoice: perAgentInvoice,
                month: deriveMonth(deal),
                dealStatus: deal.status || null,
                stage,
                invoiceNo: invoice?.invoiceNo || null,
                orderNumber: null,
                fiscalYear: deriveFiscalYear(deal),
                source: "crm" as const,
              });
            }
          }
        }
      }

      if (!senior) {
        entries = entries.filter(e => {
          if (e.team) {
            const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
            if (teams.some((t: string) => t === "bgp")) return false;
          }
          if (e.agent) {
            const agents = (e.agent as string).split(",").map((a: string) => a.trim().toLowerCase());
            if (agents.some((a: string) => WIP_RESTRICTED_AGENTS.has(a))) return false;
          }
          return true;
        });
      }

      if (!isAdmin) {
        if (!userTeam) {
          entries = [];
        } else {
          const ut = userTeam.toLowerCase();
          entries = entries.filter(e => {
            if (!e.team) return false;
            const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
            return teams.some((t: string) => t === ut);
          });
        }
      }

      res.json({ entries, isAdmin, userTeam });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/wip", requireAuth, async (req, res) => {
    try {
      if (!(await isWipSenior(req))) return res.status(403).json({ error: "Not authorised" });
      await db.delete(wipEntries);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/wip/import", requireAuth,
    multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file"),
    async (req: Request, res: Response) => {
      try {
        if (!(await isWipSenior(req))) return res.status(403).json({ error: "Not authorised" });
        if (!req.file) return res.status(400).json({ error: "No file uploaded" });
        const result = await importWipFromBuffer(req.file.buffer, { append: req.query.append === "true" });
        res.json(result);
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    }
  );

  app.get("/api/investment-comps", requireAuth, async (_req, res) => {
    try {
      const result = await pool.query(`SELECT
        id, rca_deal_id AS "rcaDealId", rca_property_id AS "rcaPropertyId",
        status, transaction_type AS "transactionType", subtype, features, market,
        transaction_date AS "transactionDate", property_name AS "propertyName",
        address, city, region, country, postal_code AS "postalCode",
        units, area_sqft AS "areaSqft", year_built AS "yearBuilt", year_renov AS "yearRenov",
        num_buildings AS "numBuildings", num_floors AS "numFloors", land_area_acres AS "landAreaAcres",
        occupancy, price, currency, price_per_unit AS "pricePerUnit", price_psf AS "pricePsf",
        price_qualifier AS "priceQualifier", partial_interest AS "partialInterest",
        cap_rate AS "capRate", cap_rate_qualifier AS "capRateQualifier",
        buyer, buyer_broker AS "buyerBroker", seller, seller_broker AS "sellerBroker",
        lender, comments, latitude, longitude, submarket,
        property_id AS "propertyId", buyer_company_id AS "buyerCompanyId",
        seller_company_id AS "sellerCompanyId", source,
        created_at AS "createdAt"
        FROM investment_comps ORDER BY created_at DESC`);
      console.log(`[investment-comps] returned ${result.rows.length} rows`);
      res.json(result.rows);
    } catch (e: any) {
      console.error("[investment-comps] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/investment-comps/counts", requireAuth, async (_req, res) => {
    try {
      const result = await pool.query(`
        SELECT COALESCE(source, 'unknown') AS source, COUNT(*)::int AS count
        FROM investment_comps
        GROUP BY COALESCE(source, 'unknown')
        ORDER BY count DESC
      `);
      const total = result.rows.reduce((acc: number, r: any) => acc + r.count, 0);
      res.json({ total, bySource: result.rows });
    } catch (e: any) {
      console.error("[investment-comps/counts] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/investment-comps", requireAuth, async (req, res) => {
    try {
      const [entry] = await db.insert(investmentComps).values(req.body).returning();
      res.json(entry);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.put("/api/investment-comps/:id", requireAuth, async (req, res) => {
    try {
      const [entry] = await db.update(investmentComps).set(req.body).where(eq(investmentComps.id, req.params.id)).returning();
      if (!entry) return res.status(404).json({ error: "Not found" });
      res.json(entry);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.delete("/api/investment-comps/:id", requireAuth, async (req, res) => {
    try {
      await db.delete(investmentComps).where(eq(investmentComps.id, req.params.id));
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/investment-comps/bulk-delete", requireAuth, async (req, res) => {
    try {
      const { ids } = req.body;
      if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
      await db.delete(investmentComps).where(inArray(investmentComps.id, ids));
      res.json({ success: true, deleted: ids.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/investment-comps/import", requireAuth, multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }).single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ error: "No file uploaded" });
      const XLSX = (await import("xlsx")).default;
      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rawData: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });

      let headerIdx = -1;
      for (let i = 0; i < rawData.length; i++) {
        if (rawData[i] && rawData[i].some((c: any) => c === "Deal ID")) { headerIdx = i; break; }
      }
      if (headerIdx === -1) return res.status(400).json({ error: "Could not find header row with 'Deal ID'" });

      const headers = rawData[headerIdx];
      const rows: any[] = [];
      for (let i = headerIdx + 1; i < rawData.length; i++) {
        const row: Record<string, any> = {};
        headers.forEach((h: string, j: number) => { if (h && rawData[i] && rawData[i][j] !== undefined) row[h] = rawData[i][j]; });
        if (Object.keys(row).length > 3) rows.push(row);
      }

      const excelToDate = (serial: number) => {
        const d = new Date((serial - 25569) * 86400 * 1000);
        return d.toISOString().split("T")[0];
      };

      const mapped = rows.map((r: any) => ({
        rcaDealId: r["Deal ID"] ? String(r["Deal ID"]) : null,
        rcaPropertyId: r["Property ID"] ? String(r["Property ID"]) : null,
        status: r.Status || null,
        transactionType: r.Type || null,
        subtype: r.Subtype || null,
        features: r.Features || null,
        market: r.Market || null,
        transactionDate: typeof r.Date === "number" ? excelToDate(r.Date) : (r.Date || null),
        propertyName: r["Property Name"] || null,
        address: r.Address || null,
        city: r.City || null,
        region: r.State || null,
        country: r.Country || null,
        postalCode: r["Postal Code"] ? String(r["Postal Code"]) : null,
        units: typeof r.Units === "number" ? r.Units : null,
        areaSqft: typeof r.sf === "number" ? r.sf : null,
        yearBuilt: typeof r["Yr Built"] === "number" ? r["Yr Built"] : null,
        yearRenov: typeof r["Yr Renov"] === "number" ? r["Yr Renov"] : null,
        numBuildings: typeof r["# Bldgs"] === "number" ? r["# Bldgs"] : null,
        numFloors: typeof r["# Floors"] === "number" ? r["# Floors"] : null,
        landAreaAcres: typeof r["Land Area (acres)"] === "number" ? r["Land Area (acres)"] : null,
        occupancy: typeof r.Occupancy === "number" ? r.Occupancy : null,
        price: typeof r["Price (£)"] === "number" ? r["Price (£)"] : null,
        currency: r.Currency || "£",
        pricePerUnit: typeof r["£/Units"] === "number" ? r["£/Units"] : null,
        pricePsf: typeof r["£/sf"] === "number" ? r["£/sf"] : null,
        priceQualifier: r["Price Qualifier"] || null,
        partialInterest: r["Partial Interest"] || null,
        capRate: typeof r["Cap Rate"] === "number" ? r["Cap Rate"] : null,
        capRateQualifier: r["Cap Rate Qualifier"] || null,
        buyer: r["Owner/Buyer"] || null,
        buyerBroker: r["Buyer's Broker"] || null,
        seller: r.Seller || null,
        sellerBroker: r["Seller's Broker"] || null,
        lender: r.Lender || null,
        comments: r["Comments or Notes"] || null,
        latitude: typeof r.Latitude === "number" ? r.Latitude : null,
        longitude: typeof r.Longitude === "number" ? r.Longitude : null,
        submarket: r.Submarket || null,
        source: "RCA",
      }));

      const existingIds = new Set(
        (await db.select({ rcaDealId: investmentComps.rcaDealId }).from(investmentComps).where(eq(investmentComps.source, "RCA")))
          .map(r => r.rcaDealId)
      );
      const newRecords = mapped.filter(r => r.rcaDealId && !existingIds.has(r.rcaDealId));
      let inserted = 0;
      if (newRecords.length > 0) {
        const batchSize = 50;
        for (let i = 0; i < newRecords.length; i += batchSize) {
          await db.insert(investmentComps).values(newRecords.slice(i, i + batchSize));
        }
        inserted = newRecords.length;
      }

      res.json({ success: true, imported: inserted, skipped: mapped.length - inserted, total: mapped.length });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/investment-comps/enrich", requireAuth, async (req, res) => {
    res.json({ started: true, message: "Enrichment started in background. This will take a few minutes." });

    try {
      const allComps = await db.select().from(investmentComps);
      const allCompanies = await db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies);
      const companyNameMap = new Map<string, string>();
      allCompanies.forEach(c => companyNameMap.set(c.name.toLowerCase().trim(), c.id));

      const uniqueBuyers = [...new Set(allComps.map(c => c.buyer).filter(Boolean))] as string[];
      const uniqueSellers = [...new Set(allComps.map(c => c.seller).filter(Boolean))] as string[];
      const allPartyNames = [...new Set([...uniqueBuyers, ...uniqueSellers])];

      console.log(`[Enrich] Starting: ${allPartyNames.length} unique company names to match against ${allCompanies.length} CRM companies`);

      const companyNameList = allCompanies.map(c => c.name);
      const matchedMap = new Map<string, string>();

      const batchSize = 40;
      for (let i = 0; i < allPartyNames.length; i += batchSize) {
        const batch = allPartyNames.slice(i, i + batchSize);
        const alreadyMatched = batch.filter(name => companyNameMap.has(name.toLowerCase().trim()));
        const needsMatching = batch.filter(name => !companyNameMap.has(name.toLowerCase().trim()));

        for (const name of alreadyMatched) {
          matchedMap.set(name, companyNameMap.get(name.toLowerCase().trim())!);
        }

        if (needsMatching.length === 0) continue;

        try {
          const resp = await callClaude({
            model: CHATBGP_HELPER_MODEL,
            temperature: 0,
            messages: [{
              role: "system",
              content: `You are a company name matcher for a UK commercial real estate CRM. Given a list of company names from RCA transaction data, match each one to an existing CRM company if they refer to the same entity (accounting for abbreviations, legal suffixes like Ltd/Plc/LLP, and common variations). Return ONLY a JSON object with a "matches" key containing an array of objects with "name" (the input name) and "match" (the exact CRM company name that matches, or null if no match found). Be conservative - only match if you're confident they're the same entity.`
            }, {
              role: "user",
              content: `Match these company names:\n${JSON.stringify(needsMatching)}\n\nExisting CRM companies:\n${JSON.stringify(companyNameList)}`
            }],
          });

          const result = parseAiJson(resp.choices[0]?.message?.content || "{}");
          const matches: Array<{ name: string; match: string | null }> = result.matches || result.results || (Array.isArray(result) ? result : []);

          for (const m of matches) {
            if (m.match) {
              const matchId = companyNameMap.get(m.match.toLowerCase().trim());
              if (matchId) {
                matchedMap.set(m.name, matchId);
              }
            }
          }
        } catch (err: any) {
          console.error(`[Enrich] AI matching error for batch ${i}:`, err.message);
        }

        console.log(`[Enrich] Company matching progress: ${Math.min(i + batchSize, allPartyNames.length)}/${allPartyNames.length}`);
      }

      const unmatchedNames = allPartyNames.filter(n => !matchedMap.has(n));
      console.log(`[Enrich] Matched ${matchedMap.size} companies. Creating ${unmatchedNames.length} new companies...`);

      for (const name of unmatchedNames) {
        try {
          const [newCo] = await db.insert(crmCompanies).values({
            name: name.replace(/&amp;/g, "&"),
            groupName: "Investment Comp",
          }).returning({ id: crmCompanies.id });
          matchedMap.set(name, newCo.id);
          companyNameMap.set(name.toLowerCase().trim(), newCo.id);
        } catch (err: any) {
          console.error(`[Enrich] Error creating company "${name}":`, err.message);
        }
      }

      console.log(`[Enrich] All companies processed. Updating investment comps with company links...`);

      for (const comp of allComps) {
        const updates: Record<string, any> = {};
        if (comp.buyer && matchedMap.has(comp.buyer) && !comp.buyerCompanyId) {
          updates.buyerCompanyId = matchedMap.get(comp.buyer)!;
        }
        if (comp.seller && matchedMap.has(comp.seller) && !comp.sellerCompanyId) {
          updates.sellerCompanyId = matchedMap.get(comp.seller)!;
        }
        if (Object.keys(updates).length > 0) {
          await db.update(investmentComps).set(updates).where(eq(investmentComps.id, comp.id));
        }
      }

      console.log(`[Enrich] Company linking complete. Now creating properties...`);

      const existingProps = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties);
      const propNameMap = new Map<string, string>();
      existingProps.forEach(p => propNameMap.set(p.name.toLowerCase().trim(), p.id));
      const compPropKeyMap = new Map<string, string>();

      let propsCreated = 0;
      let propsLinked = 0;

      for (let idx = 0; idx < allComps.length; idx++) {
        const comp = allComps[idx];
        if (comp.propertyId) { propsLinked++; continue; }
        if (!comp.propertyName) continue;

        const propKey = `${comp.propertyName}|${comp.city || ""}|${comp.postalCode || ""}`.toLowerCase().trim();
        let propId = compPropKeyMap.get(propKey) || propNameMap.get(comp.propertyName.toLowerCase().trim());

        if (!propId) {
          const addrObj: Record<string, any> = {};
          if (comp.address) addrObj.street = comp.address.replace(/&amp;/g, "&");
          if (comp.city) addrObj.city = comp.city;
          if (comp.postalCode) addrObj.postcode = comp.postalCode;
          if (comp.region) addrObj.region = comp.region;
          if (comp.country) addrObj.country = comp.country;
          if (comp.latitude) addrObj.lat = comp.latitude;
          if (comp.longitude) addrObj.lng = comp.longitude;

          try {
            const [newProp] = await db.insert(crmProperties).values({
              name: comp.propertyName.replace(/&amp;/g, "&"),
              address: addrObj,
              assetClass: comp.transactionType || null,
              sqft: comp.areaSqft || null,
              status: "Investment Comp",
              groupName: "Investment Comps",
            }).returning({ id: crmProperties.id });
            propId = newProp.id;
            compPropKeyMap.set(propKey, propId);
            propsCreated++;
          } catch (err: any) {
            console.error(`[Enrich] Error creating property "${comp.propertyName}":`, err.message);
            continue;
          }
        } else {
          propsLinked++;
        }

        await db.update(investmentComps).set({ propertyId: propId }).where(eq(investmentComps.id, comp.id));

        if ((idx + 1) % 100 === 0) {
          console.log(`[Enrich] Property progress: ${idx + 1}/${allComps.length}`);
        }
      }

      console.log(`[Enrich] Complete! Companies: ${matchedMap.size} linked. Properties: ${propsCreated} created, ${propsLinked} existing linked.`);

    } catch (err: any) {
      console.error("[Enrich] Fatal error:", err.message);
    }
  });

  app.get("/api/favorite-instructions", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.json([]);
      const rows = await db.execute(sql`SELECT property_id FROM favorite_instructions WHERE user_id = ${String(userId)} ORDER BY created_at DESC`);
      res.json((rows as any).rows.map((r: any) => r.property_id));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.post("/api/favorite-instructions/:propertyId", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { propertyId } = req.params;
      await db.execute(sql`INSERT INTO favorite_instructions (user_id, property_id) VALUES (${String(userId)}, ${propertyId}) ON CONFLICT (user_id, property_id) DO NOTHING`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.delete("/api/favorite-instructions/:propertyId", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const { propertyId } = req.params;
      await db.execute(sql`DELETE FROM favorite_instructions WHERE user_id = ${String(userId)} AND property_id = ${propertyId}`);
      res.json({ ok: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  });

  app.get("/api/enrichment/auto-status", requireAuth, async (_req, res) => {
    res.json({
      enabled: autoEnrichEnabled,
      intervalHours: AUTO_ENRICH_INTERVAL_HOURS,
      batchSize: AUTO_ENRICH_BATCH_SIZE,
      lastRun: autoEnrichLastRun,
      lastResult: autoEnrichLastResult,
      nextRun: autoEnrichEnabled && autoEnrichLastRun
        ? new Date(autoEnrichLastRun.getTime() + AUTO_ENRICH_INTERVAL_HOURS * 60 * 60 * 1000).toISOString()
        : null,
    });
  });

  app.post("/api/enrichment/auto-toggle", requireAuth, async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled === "boolean") {
      if (enabled && !autoEnrichEnabled) {
        startAutoEnrichment();
      } else if (!enabled && autoEnrichEnabled) {
        stopAutoEnrichment();
      }
    }
    res.json({ enabled: autoEnrichEnabled });
  });

  app.post("/api/enrichment/auto-run-now", requireAuth, async (_req, res) => {
    if (autoEnrichRunning) {
      return res.json({ message: "Already running", running: true });
    }
    runAutoEnrichmentCycle().catch(err => console.error("[auto-enrich] Manual trigger error:", err.message));
    res.json({ message: "Enrichment cycle started", running: true });
  });

  app.post("/api/enrichment/classify-company-types", requireAuth, async (_req, res) => {
    const validTypes = [
      "Tenant - Retail", "Tenant - Restaurant", "Tenant - Leisure", "Tenant",
      "Landlord", "Client", "Vendor", "Purchaser", "Investor", "Agent", "Billing Entity"
    ];
    const untyped = await pool.query(`
      SELECT id, name, domain, description FROM crm_companies WHERE company_type IS NULL ORDER BY name LIMIT 50
    `).then(r => r.rows);

    if (untyped.length === 0) {
      return res.json({ message: "All companies already have a type", classified: 0, remaining: 0 });
    }

    let classified = 0;
    for (const co of untyped) {
      try {
        const completion = await callClaude({
          model: CHATBGP_HELPER_MODEL,
          messages: [
            { role: "system", content: `You are a UK commercial property CRM classifier. Given a company name and optional info, classify it into exactly ONE of these types:\n${validTypes.join(", ")}\n\nGuidelines:\n- Restaurants, cafes, bars, pubs → "Tenant - Restaurant"\n- Shops, fashion, retail brands, supermarkets → "Tenant - Retail"\n- Gyms, cinemas, entertainment, hotels → "Tenant - Leisure"\n- Generic/office tenants → "Tenant"\n- Property owners, freeholders, estate companies → "Landlord"\n- Property agents, estate agents, surveyors, brokerages → "Agent"\n- Investment funds, REITs, asset managers → "Investor"\n\nReturn ONLY the type string, nothing else.` },
            { role: "user", content: `"${co.name}"${co.domain ? ` (${co.domain})` : ""}${co.description ? ` — ${co.description}` : ""}` }
          ],
          max_completion_tokens: 30,
        });
        const suggested = completion.choices[0]?.message?.content?.trim() || "";
        if (validTypes.includes(suggested)) {
          await pool.query(`UPDATE crm_companies SET company_type = $2, updated_at = NOW() WHERE id = $1`, [co.id, suggested]);
          classified++;
        }
      } catch (err: any) {
        console.error(`[classify] Error for ${co.name}:`, err.message);
      }
    }

    const remaining = await pool.query(`SELECT COUNT(*) FROM crm_companies WHERE company_type IS NULL`).then(r => parseInt(r.rows[0].count));
    console.log(`[classify] Classified ${classified}/${untyped.length} companies, ${remaining} remaining`);
    res.json({ classified, processed: untyped.length, remaining });
  });

  // ── Brand bible seed endpoint ─────────────────────────────────────────
  app.post("/api/admin/seed-brands", requireAuth, async (_req, res) => {
    const SEED_BRANDS: { name: string; companyType: string }[] = [
      // Luxury
      ...["Acne Studios","Akris","Alaïa","Alberta Ferretti","Alexander McQueen","Aquazzura","Aspinal of London","Asprey","Azzaro","Balenciaga","Bamford","Bell & Ross","Belstaff","Blancpain","Boggi","Boodles","Bottega Veneta","Boucheron","Breitling","Bremont","Browns","Bulgari","Burberry","Canada Goose","Caramel","Carolina Herrera","Cartier","Celine","Coach","Chanel","Chatila","Chaumet","Chloé","Chopard","Christian Louboutin","Christopher Kane","Claudie Pierlot","Clergerie","Crockett & Jones","Damiani","David Morris","De Beers","Delvaux","Dior","Dolce & Gabbana","Douglas Hayward","Emilio Pucci","Emporio Armani","Ermenegildo Zegna","Etro","Fendi","Fenwick","Ferragamo","Fortnum & Mason","Furla","Garrard","Gianvito Rossi","Gieves & Hawkes","Givenchy","Goyard","Graff","Gucci","Harry Winston","Hermès","IWC","Jaeger-LeCoultre","J & M Davidson","Johnston's of Elgin","Joseph","Karl Lagerfeld","Laduree","Lanvin","Loewe","Longchamp","Longines","Loro Piana","Louis Vuitton","Mackintosh","Marc Jacobs","Marni","MaxMara","Me + Em","Melissa Odabash","Michael Kors","Mikimoto","Miu Miu","Moncler","Montblanc","Moussaieff","Moynat","Mulberry","Omega","Panerai","Patek Philippe","Penhaligon's","Piaget","Polo Ralph Lauren","Pomellato","Prada","Pringle of Scotland","Richard Mille","Rimowa","Roberto Cavalli","Roger Dubuis","Rolex","Sandro","Sergio Rossi","Simone Rocha","Smythson","Stella McCartney","Stephen Webster","TAG Heuer","Tasaki","Tateossian","Tiffany & Co","Tod's","Tommy Hilfiger","Tory Burch","Tumi","Vacheron Constantin","Valentino","Valextra","Vashi","Versace","Victoria Beckham","Victorinox","Vivienne Westwood","Wempe","Wolford","Zilli","Zimmermann"].map(n=>({name:n,companyType:"Tenant - Luxury"})),
      // Fashion
      ...["7 For All Mankind","Abercrombie & Fitch","Agent Provocateur","Agnès B","Aldo","All Saints","American Eagle","American Vintage","Anine Bing","Ann Summers","Anthropologie","APC","Apricot","Arket","Armani Exchange","Barbour","Bershka","Beyond Retro","Bimba Y Lola","Boden","Bonpoint","Boss","Boux Avenue","Brandy Melville","Bravissimo","Brora","Calvin Klein","Calzedonia","Cambridge Satchel","Carhartt WIP","Castore","Charles Tyrwhitt","COS","Comptoir des Cotonniers","Dehanche","Deichmann","Derek Rose","Diesel","Dr Martens","Drumohr","END","Eric Bompard","Filippa K","Flannels","Fred Perry","Free People","French Connection","Fusalp","Ganni","GANT","Gap","Golden Goose","H&M","Hackett","Hawes & Curtis","Helmut Lang","Hobbs","Hollister","Honey Birdette","Hugo Boss","Intimissimi","Jack Wills","Jigsaw","JW Anderson","KITH","Kooples","Lacoste","Levi's","LK Bennett","Mango","Massimo Dutti","M&S","Miniso","Mini Rodini","Monki","Monsoon","Moose Knuckles","Moss Bros","New Look","NEXT","Nobody's Child","North Face","Norse Projects","Olivia Rubin","Orlebar Brown","Other Stories","Paul Smith","Petit Bateau","Phase Eight","Primark","Pull & Bear","Puma","Rag & Bone","Ralph Lauren","Reformation","Reiss","River Island","RIXO","Samsoe Samsoe","Scotch & Soda","Seraphine","Sezane","SMCP","Suit Supply","Sunspel","Superdry","Supreme","Ted Baker","Theory","The Little White Company","Timberland","Uniqlo","United Colours of Benetton","Urban Outfitters","Vans","Whistles","Wolf & Badger","YMC","Zadig & Voltaire","Zara","Les Benjamins","Vuori"].map(n=>({name:n,companyType:"Tenant - Fashion"})),
      // Athleisure
      ...["Adidas","ALO","Asics","Gymshark","Jack Wolfskin","JD Sports","Lululemon","New Balance","Nike","ON","Rapha","Sports Direct","Sweaty Betty","Varley","Outdoor Voices","Rei"].map(n=>({name:n,companyType:"Tenant - Athleisure"})),
      // Footwear
      ...["Allbirds","Axel Arigato","Barker","Baudoin et Lange","Birkenstock","Camper","Carvela","Cheaney Shoes","Clarks","Crocs","Dune","FitFlop","Footasylum","Footlocker","Geox","Gina Shoes","Jimmy Choo","Jones Bootmaker","Joseph Cheaney & Sons","Kick Game","Kurt Geiger","Manolo Blahnik","Office","Onitsuka Tiger","Russell & Bromley","Schuh","Skechers","Sole Trader","Sophia Webster","Steve Madden","Superga","UGG","Veja","Sarah Flint"].map(n=>({name:n,companyType:"Tenant - Footwear"})),
      // Accessories
      ...["Accessorize","Ace & Tate","APM Monaco","Apriati Jewels","Astrid & Miyu","Bailey Nelson","Bloobloom","Bottletop","Claire's","Clulows","Cubitts","Dinny Hall","Earnest Jones","Ecco","Finlay & Co","Folli Follie","Furla","Georg Jensen","Goldsmiths","Heidi Klein","H. Samuel","Izipizi","Kate Spade","Links of London","Lovisa","Luxottica","Mappin & Webb","Maya Magal","Mejuri","Monica Vinader","Moscot","Mykita","Oliver Bonas","Optical Express","Pandora","Samsonite","Strathberry","Sunglass Hut","Swarovski","Swatch","Thomas Sabo","Tom Davies","TUMI","Unode50","Vertex","Vision Express","Watchfinder","Watches of Switzerland","William & Son","Gorjana","Karaca"].map(n=>({name:n,companyType:"Tenant - Accessories & Footwear"})),
      // Beauty
      ...["Adam Grooming Atelier","Acqua di Parma","Aesop","Body Shop","Byredo","Caudalie","Charlotte Tilbury","Code 8","Creed","Deciem","Estee Lauder","FaceGym","Forrest Essentials","Fragrance Shop","FRESH","Get A Drip","Glossier","Goop","Holland and Barrett","John Bell & Croyden","Kiehl's","Kiko","Laser Clinics","L'Oreal","Lush","MAC","Malin+Goetz","Margaret Dabbs","Molton Brown","NARS","Neom","Oh My Cream","Onda Beauty","Paul Edmonds","Penhaligons","Revital","Rituals","Rush","Sarah Chapman","Seanhanna","Sephora","sk:n","Smilepod","SpaceNK","Superdrug","Ted's Grooming Room","The Organic Pharmacy","Therapie","Toni & Guy","White & Co.","Winky Lux"].map(n=>({name:n,companyType:"Tenant - Beauty"})),
      // Homewares
      ...["Anthropologie","BON TON","Brissi","Caravane","Cologne & Cotton","David Mellor","Designers Guild","Earl of East","Evoke London","Farrow & Ball","Flying Tiger","Gaggenau","Habitat","Heals","Honest Jon's","India Jane","Jonathan Adler","Kings of Chelsea","Le Creuset","Mamas & Papas","Martin Moore","Muji","Natuzzi","Nespresso","Osborne & Little","Poliform","Royal Selangor","Robert Dyas","Sevenoaks Sound & Vision","Sheridan","Sigmar","Silvera","Smiggle","Sofa Workshop","Stokke","Tempur","The Conran Shop","The White Company","Tiger","TOAST","Tom Dixon","Thomas Goode","West Elm","Waterstones","Loaf","Wayfair"].map(n=>({name:n,companyType:"Tenant - Homewares"})),
      // Gifts & Perfumes
      ...["Adopt Parfum","Alexeeva & Jones","Baobab Collection","Candles & Oud","Cards Galore","Caroline Gardner","Charbonnel et Walker","Clintons","Diptyque","Disney","Endura Roses","Flowers & Plants Co.","Godiva","Hamleys","Hotel Chocolat","Jo Malone","Le Chocolat Alain Ducasse","LEGO","Le Labo","L'Occitane","Menkind","Moyses Stevens","Ortigia","Rococo","Scribbler","Soap & Co","Sook","The Entertainer","The Fragrance Shop","The Perfume Shop","T2 Tea"].map(n=>({name:n,companyType:"Tenant - Gifts & Perfumes"})),
      // Department Stores
      ...["Debenhams","House of Fraser","John Lewis","Marks and Spencer","Matalan","Peter Jones","Selfridges","TK Maxx","Waitrose & Partners"].map(n=>({name:n,companyType:"Tenant - Department Store"})),
      // Technology
      ...["Apple","Carphone Warehouse","Currys","Dyson","EE","Game","iSmash","Jessops","Microsoft","Netflix","Peloton","Razor","Samsung","Situ Live","Snapchat","Snappy Snaps"].map(n=>({name:n,companyType:"Tenant - Technology"})),
      // Automotive
      ...["Genesis","MV Agusta","Polestar","Tesla","Vanmoof","KJ West One"].map(n=>({name:n,companyType:"Tenant - Automotive"})),
      // Telecoms
      ...["O2","Sky","Three","Vodafone","Iqos","Vuse","Wanyoo","Xiaomi"].map(n=>({name:n,companyType:"Tenant - Telecoms"})),
      // Grocery
      ...["Aldi","Bayley & Sage","Daylesford Organic","Lidl","Planet Organic","Sainsbury's","Tesco","Waitrose"].map(n=>({name:n,companyType:"Tenant - Grocery"})),
      // Financial Services
      ...["Barclays","Halifax","HSBC","Lloyd's Bank","Natwest","Santander"].map(n=>({name:n,companyType:"Tenant - Financial Services"})),
      // Fine Dining
      ...["Gaucho","Hawksmoor","Hakkasan","Da Henrietta","Cora Pearl","Barrafina","Darjeeling Express","Dishoom","Ave Mario","Bao","Coal Office","Flesh & Buns","Hoppers","Ibérica","JinJuu","La Goccia","Lina Stores","Roka","Sushi Samba","Yauatcha","Veeraswamy","Scalini","Bar Douro","Balthazar","Brasserie Max","Bluebird","Cheesecake Factory","Chotto Matte"].map(n=>({name:n,companyType:"Tenant - Fine Dining"})),
      // Casual Dining
      ...["Wagamama","Nando's","Wahaca","Cinnamon Kitchen","Cinnamon Bazaar","Masala Zone","Benihana","Big Easy","Brindisa Kitchen","Casa Pastor","Dehesa","Din Tai Fung","Drake & Morgan","Emilia's Crafted Pasta","FarmerJ","Fatto","Flat Iron","Franco Manca","Granger & Co","Imad's","Island Poké","Itsu","Kanada-Ya","Kimchee","Kolamba","Leon","MamaLan","Marugame","Megan's","Monmouth Kitchen","Mon Plaisir","Morty & Bob's","My Old Dutch","Obica","Ole & Steen","Pastaio","Patty & Bun","Paul","Piccolo","Pizza Express","Pizza Pilgrims","Pilpel","Polpo","Pret a Manger","Poke House","Royal China","Roti King","Shake Shack","Shoryu Ramen","Señor Ceviche","Seoul Bird","Slim Chickens","Sticks n Sushi","Tapas Brindisa","The Barbary","The Breakfast Club","The Good Egg","The Indians Next Door","The Ivy","The Real Greek","The Rum Kitchen","The Vurger Co.","Tonkotsu","Truffle Burger","Ugly Dumpling","Urban Greens","Wildwood Kitchen","Wright Brothers","Maxwell's","Eataly","Caravan"].map(n=>({name:n,companyType:"Tenant - Casual Dining"})),
      // Quick Service
      ...["Five Guys","Greggs","GDK","Krispy Kreme","McDonald's","Neat Burger","Wasabi","Chopstix","Gordon Ramsay Street Pizza","Happy Face","Homeslice","Stax","Wafflemeister","Yum Bun","Yolk"].map(n=>({name:n,companyType:"Tenant - Quick Service"})),
      // Café
      ...["Caffe Nero","Costa","Starbucks","Joe & the Juice","Beany Green","Café Brera","Café Volonté","Caffe Concerto","Change Please","Chai Guys","Chez Antoinette","Cojean","Crussh","El & N","Grind","Hagen Coffee","Knoops","Le Pain Quotidien","Notes","Redemption Roasters"].map(n=>({name:n,companyType:"Tenant - Café"})),
      // Bar
      ...["All Bar One","Brewdog","Humble Grape","Vagabond Wines","Revolution","Revolve","Spiritland","Flare","The Alchemist","The Botanist","The Drop","Vinoteca"].map(n=>({name:n,companyType:"Tenant - Bar"})),
      // Bakery
      ...["Ben's Cookies","Buns from Home","Crosstown","Donovan's Bakehouse","Gail's","Lola's Cupcakes","Longboys","Maitre Choux","Ole & Steen"].map(n=>({name:n,companyType:"Tenant - Bakery"})),
      // Cinema
      ...["Everyman Cinema","Vue","Odeon","Cineworld"].map(n=>({name:n,companyType:"Tenant - Cinema"})),
      // Experiential
      ...["Bounce","Capital Karts","Electric Shuffle","Puttshack","Birdies","City Bouldering","DNA VR","Upside Down House","Dreamscape","All Star Lanes","Tank & Paddle"].map(n=>({name:n,companyType:"Tenant - Experiential"})),
      // Immersive
      ...["Kidzania"].map(n=>({name:n,companyType:"Tenant - Immersive Experience"})),
      // Family Entertainment
      ...["Blue Almonds"].map(n=>({name:n,companyType:"Tenant - Family Entertainment"})),
      // Gym
      ...["BoomCycle","BXR","F45","GymBox","Nuffield Health","Pure Sports Medicine","Sweat by BXR","Third Space","Triyoga","Ultimate Performance","Virgin Active","Athlete Lab"].map(n=>({name:n,companyType:"Tenant - Gym"})),
      // Wellness
      ...["111 Cryo","Andrew K Hair","Atherton Cox","Blink Brow Bar","Cubex","Dr Haus Dermatology","Freedom Clinics","Get A Drip","Hari's","London Cryo","London Grace","Mark Glenn","Massage Angels","Melanie Grant","Neil Moodie","Pimps & Pinups","Radio Salon","Regenerative Wellbeing","ReMind","Rys Hair","Stil Salon","Young LDN","Bupa","Lyca Health"].map(n=>({name:n,companyType:"Tenant - Wellness"})),
      // Yoga
      ...["Gym & Coffee"].map(n=>({name:n,companyType:"Tenant - Yoga"})),
    ];

    try {
      const { rows: existing } = await pool.query(`SELECT LOWER(TRIM(name)) AS n FROM crm_companies`);
      const existingNames = new Set(existing.map((r: any) => r.n as string));
      let created = 0, skipped = 0;
      for (const brand of SEED_BRANDS) {
        const key = brand.name.toLowerCase().trim();
        if (existingNames.has(key)) { skipped++; continue; }
        const { nanoid } = await import("nanoid");
        const id = nanoid();
        await pool.query(
          `INSERT INTO crm_companies (id, name, company_type, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW())`,
          [id, brand.name, brand.companyType]
        );
        existingNames.add(key);
        created++;
      }
      console.log(`[seed-brands] Created: ${created}, Skipped: ${skipped}`);
      res.json({ success: true, created, skipped });
    } catch (err: any) {
      console.error("[seed-brands] Error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Brands Hub aggregated data ───────────────────────────────────────
  app.get("/api/brands/hub", requireAuth, async (_req, res) => {
    try {
      const tenantFilter = `company_type ILIKE 'Tenant -%'`;

      // Category counts
      const catRows = await pool.query(
        `SELECT company_type, COUNT(*) as count FROM crm_companies WHERE ${tenantFilter} GROUP BY company_type`
      ).then(r => r.rows);

      // Who's hot — most recently active brands (deals, requirements, contacts updated last 60 days)
      const hotRows = await pool.query(`
        SELECT c.id, c.name, c.company_type, c.domain, c.description,
               MAX(GREATEST(
                 COALESCE(d.updated_at, '1970-01-01'),
                 COALESCE(rl.updated_at, '1970-01-01'),
                 COALESCE(ct.updated_at, '1970-01-01')
               )) AS last_activity,
               COUNT(DISTINCT d.id) AS deal_count,
               COUNT(DISTINCT rl.id) AS req_count,
               COUNT(DISTINCT ct.id) AS contact_count
        FROM crm_companies c
        LEFT JOIN crm_deals d ON (d.tenant_id = c.id) AND d.updated_at > NOW() - INTERVAL '90 days'
        LEFT JOIN crm_requirements_leasing rl ON rl.company_id = c.id AND rl.updated_at > NOW() - INTERVAL '90 days'
        LEFT JOIN crm_contacts ct ON ct.company_id = c.id AND ct.updated_at > NOW() - INTERVAL '90 days'
        WHERE ${tenantFilter}
        GROUP BY c.id, c.name, c.company_type, c.domain, c.description
        HAVING MAX(GREATEST(
          COALESCE(d.updated_at, '1970-01-01'),
          COALESCE(rl.updated_at, '1970-01-01'),
          COALESCE(ct.updated_at, '1970-01-01')
        )) > NOW() - INTERVAL '90 days'
        ORDER BY last_activity DESC
        LIMIT 20
      `).then(r => r.rows);

      // Super brands — Luxury + Flagship Fashion
      const superRows = await pool.query(`
        SELECT id, name, company_type, domain, description
        FROM crm_companies
        WHERE company_type IN ('Tenant - Luxury','Tenant - Flagship Fashion','Tenant - Luxury Accessories')
        ORDER BY name
        LIMIT 60
      `).then(r => r.rows);

      // Top turnover — join with turnover_data, most recent per brand
      const turnoverRows = await pool.query(`
        SELECT DISTINCT ON (t.company_id)
          t.id, t.company_id, t.company_name, t.turnover, t.turnover_per_sqft,
          t.period, t.source, t.confidence, t.category,
          c.company_type, c.domain
        FROM turnover_data t
        LEFT JOIN crm_companies c ON c.id = t.company_id
        WHERE t.turnover IS NOT NULL
        ORDER BY t.company_id, t.period DESC, t.turnover DESC
      `).then(r => r.rows);

      const topTurnover = [...turnoverRows].sort((a: any, b: any) => (b.turnover || 0) - (a.turnover || 0)).slice(0, 20);

      // Active requirements — note size/use/requirement_locations are text[] arrays,
      // not numeric size_min/size_max columns.
      const reqRows = await pool.query(`
        SELECT rl.id, rl.company_id, c.name AS company_name, c.company_type, c.domain,
               rl.size, rl.use, rl.requirement_locations, rl.comments, rl.created_at,
               COUNT(ct.id) AS contact_count
        FROM crm_requirements_leasing rl
        JOIN crm_companies c ON c.id = rl.company_id
        LEFT JOIN crm_contacts ct ON ct.company_id = c.id
        WHERE rl.status = 'Active' AND ${tenantFilter}
        GROUP BY rl.id, rl.company_id, c.name, c.company_type, c.domain, rl.size, rl.use, rl.requirement_locations, rl.comments, rl.created_at
        ORDER BY rl.created_at DESC
        LIMIT 30
      `).then(r => r.rows);

      // Total stats
      const stats = await pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE ${tenantFilter}) AS total_brands,
          COUNT(*) FILTER (WHERE ${tenantFilter} AND id IN (SELECT DISTINCT company_id FROM turnover_data WHERE company_id IS NOT NULL)) AS brands_with_turnover,
          COUNT(*) FILTER (WHERE ${tenantFilter} AND id IN (SELECT DISTINCT company_id FROM crm_requirements_leasing WHERE status = 'Active' AND company_id IS NOT NULL)) AS brands_active_req
        FROM crm_companies
      `).then(r => r.rows[0]);

      res.json({
        stats,
        categoryCounts: catRows,
        hotBrands: hotRows,
        superBrands: superRows,
        topTurnover,
        activeRequirements: reqRows,
      });
    } catch (err: any) {
      console.error("[brands/hub]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Brand Hunter — ranked list of brands most likely to expand into UK ──
  app.get("/api/brands/hunter", requireAuth, async (_req, res) => {
    try {
      const { getStockSnapshots } = await import("./stock-price");

      // Fetch all tracked brands + any manually hunter-flagged brands
      const brands = await pool.query(`
        SELECT
          c.id, c.name, c.company_type, c.domain, c.description,
          c.rollout_status, c.store_count,
          c.backers, c.instagram_handle, c.tiktok_handle,
          c.dept_store_presence, c.franchise_activity,
          c.hunter_flag, c.concept_pitch, c.stock_ticker,
          c.brand_analysis,
          c.created_at
        FROM crm_companies c
        WHERE (c.is_tracked_brand = true OR c.hunter_flag = true)
          AND c.merged_into_id IS NULL
        ORDER BY c.name
      `).then(r => r.rows);

      // Fetch recent brand signals for all these brands (last 365 days)
      const ids = brands.map((b: any) => b.id);
      let signals: any[] = [];
      if (ids.length > 0) {
        signals = await pool.query(`
          SELECT brand_company_id, signal_type, headline, magnitude, sentiment, signal_date
          FROM brand_signals
          WHERE brand_company_id = ANY($1)
            AND signal_date > NOW() - INTERVAL '365 days'
          ORDER BY signal_date DESC
        `, [ids]).then(r => r.rows);
      }

      // Build signal map
      const signalMap = new Map<string, any[]>();
      for (const s of signals) {
        if (!signalMap.has(s.brand_company_id)) signalMap.set(s.brand_company_id, []);
        signalMap.get(s.brand_company_id)!.push(s);
      }

      // Fetch stock snapshots for listed brands in one batch (cached 6h)
      const tickers = Array.from(new Set(
        brands.map((b: any) => b.stock_ticker).filter((t: any) => typeof t === "string" && t.trim())
      ));
      const stockMap = tickers.length > 0 ? await getStockSnapshots(tickers as string[]) : new Map();

      const EUROPE_KEYWORDS = ["paris", "milan", "berlin", "amsterdam", "dubai", "new york", "nyc", "tokyo", "sydney", "los angeles"];
      const DTC_KEYWORDS = ["online only", "dtc", "direct to consumer", "direct-to-consumer", "e-commerce", "ecommerce", "no stores"];

      // Score each brand
      const scored = brands.map((b: any) => {
        let score = 0;
        const flags: string[] = [];

        // Manual signals (highest weight)
        if (b.hunter_flag) { score += 25; flags.push("Hunter Pick"); }

        // Rollout status (strongest structural signal)
        if (b.rollout_status === "entering_uk") { score += 30; flags.push("Entering UK"); }
        else if (b.rollout_status === "scaling") { score += 20; flags.push("Scaling"); }
        else if (b.rollout_status === "rumoured") { score += 10; flags.push("Rumoured"); }

        // Dept store / franchise (strong proof of physical expansion intent)
        if (b.dept_store_presence) { score += 20; flags.push("Dept Store Entry"); }
        if (b.franchise_activity) { score += 15; flags.push("Franchise Abroad"); }

        // Funding (capital to expand)
        if (b.backers) { score += 10; flags.push("Funded"); }

        // Social presence (brand awareness without physical footprint)
        if (b.tiktok_handle) { score += 5; flags.push("TikTok"); }
        if (b.instagram_handle) { score += 5; flags.push("Instagram"); }

        // Has stores elsewhere (proven format, just not in UK yet)
        if (b.store_count && b.store_count > 0) { score += 5; flags.push("Has Stores"); }

        // DTC / online-only brand — strong candidate for first store
        const pitchLower = (b.concept_pitch || "").toLowerCase();
        const descLower = (b.description || "").toLowerCase();
        if (DTC_KEYWORDS.some(k => pitchLower.includes(k) || descLower.includes(k))) {
          score += 10; flags.push("DTC / Online-only");
        }

        // Recent brand signals analysis
        const recentSignals = signalMap.get(b.id) || [];

        // Funding raised — money to expand
        const fundingSignals = recentSignals.filter((s: any) => s.signal_type === "funding");
        if (fundingSignals.length > 0) { score += 15; flags.push("Funding Raised"); }

        // New openings in non-UK markets (opening signals)
        const openingSignals = recentSignals.filter((s: any) => s.signal_type === "opening" && s.sentiment !== "negative");
        if (openingSignals.length > 0) {
          const boost = Math.min(openingSignals.length * 8, 16);
          score += boost;
          flags.push(`${openingSignals.length} New Opening${openingSignals.length > 1 ? "s" : ""}`);
        }

        // Exec change — new CEO/CCO with retail/expansion background
        const execSignals = recentSignals.filter((s: any) => s.signal_type === "exec_change" && s.sentiment === "positive");
        if (execSignals.length > 0) { score += 8; flags.push("New Leadership"); }

        // European city presence mentioned in signals or concept_pitch
        const allText = [b.concept_pitch, b.description, b.franchise_activity, b.dept_store_presence,
          ...recentSignals.map((s: any) => s.headline)].filter(Boolean).join(" ").toLowerCase();
        const euroMatches = EUROPE_KEYWORDS.filter(city => allText.includes(city));
        if (euroMatches.length > 0) {
          score += Math.min(euroMatches.length * 5, 15);
          flags.push("European Presence");
        }

        // Pop-up activity (low commitment physical test before full rollout)
        const popUpSignals = recentSignals.filter((s: any) =>
          (s.headline || "").toLowerCase().includes("pop-up") ||
          (s.headline || "").toLowerCase().includes("popup") ||
          (s.signal_type === "opening" && (s.headline || "").toLowerCase().includes("temporary"))
        );
        if (popUpSignals.length > 0) { score += 10; flags.push("Pop-up Activity"); }

        // Press coverage spike (newsworthy brands attract retail interest)
        const newsSignals = recentSignals.filter((s: any) => s.signal_type === "news" && s.sentiment === "positive");
        if (newsSignals.length >= 3) { score += 8; flags.push("Press Momentum"); }
        else if (newsSignals.length >= 1) { score += 3; }

        // Sector move / concept pivot (entering new format)
        const sectorSignals = recentSignals.filter((s: any) => s.signal_type === "sector_move");
        if (sectorSignals.length > 0) { score += 5; flags.push("Format Pivot"); }

        // Stock market signals (listed brands only)
        const stockTicker = b.stock_ticker ? String(b.stock_ticker).trim().toUpperCase() : null;
        const stock = stockTicker ? stockMap.get(stockTicker) : null;
        if (stock) {
          if (stock.signals.strongMomentum) { score += 15; flags.push("Stock +40% YoY"); }
          else if (stock.signals.stockMomentum) { score += 10; flags.push("Stock Momentum"); }
          if (stock.signals.largeCap) { score += 5; flags.push("Large Cap"); }
          else if (stock.signals.midCap) { score += 3; flags.push("Mid Cap"); }
        }

        return {
          ...b,
          expansionScore: Math.min(score, 100),
          expansionFlags: flags,
          recentSignals: recentSignals.slice(0, 4),
          stock: stock || null,
        };
      });

      // Sort by score desc
      scored.sort((a: any, b: any) => b.expansionScore - a.expansionScore);

      res.json(scored);
    } catch (err: any) {
      console.error("[brands/hunter]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Toggle hunter_flag on a brand ────────────────────────────────────────
  app.post("/api/brands/:id/hunter-flag", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE crm_companies SET hunter_flag = NOT COALESCE(hunter_flag, false), updated_at = NOW()
         WHERE id = $1 RETURNING id, hunter_flag`,
        [id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Not found" });
      res.json(result.rows[0]);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── Research turnover for a brand via AI ──────────────────────────────
  app.post("/api/brands/research-turnover/:id", requireAuth, async (req: any, res) => {
    try {
      const companyId = req.params.id;
      const userId = req.session?.userId || req.tokenUserId;
      const [company] = await pool.query(
        `SELECT id, name, company_type, domain, companies_house_data FROM crm_companies WHERE id = $1`,
        [companyId]
      ).then(r => r.rows);

      if (!company) return res.status(404).json({ error: "Company not found" });

      // Check Companies House data for accounts first
      let chTurnover: number | null = null;
      let chPeriod: string | null = null;
      if (company.companies_house_data?.accounts?.last_accounts?.period_end_on) {
        const accts = company.companies_house_data.accounts;
        chPeriod = accts.last_accounts.period_end_on?.substring(0, 4) || null;
      }

      // Use Claude to research/estimate turnover
      const prompt = `You are a retail and brand finance research assistant with knowledge of major UK and international retail brands up to 2025.

For the brand "${company.name}" (type: ${company.company_type || "Retail"}${company.domain ? `, website: ${company.domain}` : ""}), provide the most recent annual turnover/revenue figure available.

Return ONLY valid JSON in this exact format:
{
  "turnover": <number in GBP, e.g. 5000000 for £5m. Use 0 if unknown>,
  "year": <year as integer, e.g. 2023>,
  "confidence": <"High", "Medium", or "Low">,
  "source": <"Annual Accounts" | "Industry Report" | "News" | "AI Estimate" | "Companies House">,
  "notes": <brief explanation of the figure and its source, max 100 chars>
}

Rules:
- For global brands (Nike, Zara, H&M) report UK revenue if known, otherwise global converted to GBP
- If the brand is primarily UK-based, report UK turnover
- If genuinely unknown, set turnover to 0 and confidence to "Low"
- Do not invent figures — Low confidence with real estimates is better than made-up High confidence`;

      const completion = await callClaude({
        model: CHATBGP_HELPER_MODEL,
        messages: [{ role: "user", content: prompt }],
        max_completion_tokens: 200,
      });

      const raw = completion.choices[0]?.message?.content?.trim() || "{}";
      let parsed: any = {};
      try {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
      } catch { /* leave empty */ }

      const turnover = parsed.turnover && parsed.turnover > 0 ? parsed.turnover : null;
      const period = parsed.year ? String(parsed.year) : new Date().getFullYear().toString();
      const confidence = ["High", "Medium", "Low"].includes(parsed.confidence) ? parsed.confidence : "Low";
      const source = parsed.source || "AI Estimate";
      const notes = parsed.notes || `AI-researched turnover for ${company.name}`;

      // Check if we already have a turnover entry for this company
      const existing = await pool.query(
        `SELECT id FROM turnover_data WHERE company_id = $1 AND source = $2 LIMIT 1`,
        [companyId, source]
      ).then(r => r.rows[0]);

      let entry;
      if (existing) {
        entry = await pool.query(
          `UPDATE turnover_data SET turnover = $1, period = $2, confidence = $3, notes = $4, updated_at = NOW() WHERE id = $5 RETURNING *`,
          [turnover, period, confidence, notes, existing.id]
        ).then(r => r.rows[0]);
      } else {
        const { nanoid } = await import("nanoid");
        entry = await pool.query(
          `INSERT INTO turnover_data (id, company_id, company_name, period, turnover, source, confidence, category, notes, added_by_user_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING *`,
          [nanoid(), companyId, company.name, period, turnover, source, confidence,
           (company.company_type || "").replace("Tenant - ", ""), notes, userId]
        ).then(r => r.rows[0]);
      }

      res.json({ success: true, entry, researched: { turnover, period, confidence, source, notes } });
    } catch (err: any) {
      console.error("[research-turnover]", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── Auto turnover research status / toggle / run-now ─────────────────
  app.get("/api/brands/turnover-research/status", requireAuth, async (_req, res) => {
    res.json({
      enabled: autoTurnoverEnabled,
      running: autoTurnoverRunning,
      intervalHours: AUTO_TURNOVER_INTERVAL_HOURS,
      batchSize: AUTO_TURNOVER_BATCH_SIZE,
      lastRun: autoTurnoverLastRun,
      lastResult: autoTurnoverLastResult,
      nextRun: autoTurnoverEnabled && autoTurnoverLastRun
        ? new Date(autoTurnoverLastRun.getTime() + AUTO_TURNOVER_INTERVAL_HOURS * 60 * 60 * 1000).toISOString()
        : null,
    });
  });

  app.post("/api/brands/turnover-research/toggle", requireAuth, async (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled === "boolean") {
      if (enabled && !autoTurnoverEnabled) {
        startAutoTurnoverResearch();
      } else if (!enabled && autoTurnoverEnabled) {
        stopAutoTurnoverResearch();
      }
    }
    res.json({ enabled: autoTurnoverEnabled });
  });

  app.post("/api/brands/turnover-research/run-now", requireAuth, async (_req, res) => {
    if (autoTurnoverRunning) {
      return res.json({ message: "Already running", running: true });
    }
    runAutoTurnoverCycle().catch(err => console.error("[auto-turnover] Manual trigger error:", err.message));
    res.json({ message: "Turnover research cycle started", running: true });
  });

  // ── My Portfolio dashboard endpoint ──────────────────────────────────
  app.get("/api/dashboard/my-portfolio", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      if (!userId) return res.status(401).json({ error: "Not authenticated" });
      const currentUser = await storage.getUser(userId);
      if (!currentUser) return res.status(401).json({ error: "User not found" });

      const userName = currentUser.name || "";
      const userTeam = currentUser.team || "";

      // Get deals where user is internal_agent OR deal team matches user's team
      const { rows: deals } = await pool.query(`
        SELECT d.id, d.name, d.deal_type, d.status, d.fee, d.property_id, d.landlord_id,
               d.internal_agent, d.team, d.completion_date
        FROM crm_deals d
        WHERE d.status NOT IN ('Dead', 'Draft')
          AND (
            $1 = ANY(d.internal_agent)
            OR $2 = ANY(d.team)
          )
      `, [userName, userTeam]);

      if (deals.length === 0) {
        return res.json([]);
      }

      // Collect unique property IDs
      const propertyIds = [...new Set(deals.filter(d => d.property_id).map(d => d.property_id))];
      if (propertyIds.length === 0) return res.json([]);

      // Get properties
      const { rows: properties } = await pool.query(`
        SELECT id, name, address, asset_class, landlord_id
        FROM crm_properties WHERE id = ANY($1)
      `, [propertyIds]);
      const propMap = new Map(properties.map(p => [p.id, p]));

      // Get landlord names
      const landlordIds = [...new Set(properties.filter(p => p.landlord_id).map(p => p.landlord_id))];
      const landlordMap = new Map<string, string>();
      if (landlordIds.length > 0) {
        const { rows: landlords } = await pool.query(
          `SELECT id, name FROM crm_companies WHERE id = ANY($1)`, [landlordIds]
        );
        landlords.forEach(l => landlordMap.set(l.id, l.name));
      }

      // Get expiring units (lease_expiry within 12 months)
      const { rows: expiringUnits } = await pool.query(`
        SELECT id, property_id, unit_name, lease_expiry, sqft, status
        FROM leasing_schedule_units
        WHERE property_id = ANY($1)
          AND lease_expiry IS NOT NULL
          AND lease_expiry <= NOW() + INTERVAL '12 months'
          AND lease_expiry >= NOW()
        ORDER BY lease_expiry ASC
      `, [propertyIds]);

      // Get contacts linked to properties via crm_contact_properties
      const { rows: propertyContacts } = await pool.query(`
        SELECT cp.property_id, c.id AS contact_id, c.name, c.email, c.job_title
        FROM crm_contact_properties cp
        JOIN crm_contacts c ON c.id = cp.contact_id
        WHERE cp.property_id = ANY($1)
        ORDER BY c.name ASC
      `, [propertyIds]);

      // Group by property
      const grouped = new Map<string, {
        propertyId: string;
        propertyName: string;
        address: any;
        assetClass: string | null;
        landlordName: string | null;
        deals: any[];
        expiringUnits: any[];
        contacts: any[];
      }>();

      for (const prop of properties) {
        grouped.set(prop.id, {
          propertyId: prop.id,
          propertyName: prop.name,
          address: prop.address,
          assetClass: prop.asset_class,
          landlordName: prop.landlord_id ? landlordMap.get(prop.landlord_id) || null : null,
          deals: [],
          expiringUnits: [],
          contacts: [],
        });
      }

      for (const deal of deals) {
        if (deal.property_id && grouped.has(deal.property_id)) {
          grouped.get(deal.property_id)!.deals.push({
            id: deal.id,
            name: deal.name,
            dealType: deal.deal_type,
            status: deal.status,
            fee: deal.fee,
            completionDate: deal.completion_date,
          });
        }
      }

      for (const unit of expiringUnits) {
        if (grouped.has(unit.property_id)) {
          grouped.get(unit.property_id)!.expiringUnits.push({
            id: unit.id,
            unitName: unit.unit_name,
            leaseExpiry: unit.lease_expiry,
            sqft: unit.sqft,
            status: unit.status,
          });
        }
      }

      for (const pc of propertyContacts) {
        if (grouped.has(pc.property_id)) {
          grouped.get(pc.property_id)!.contacts.push({
            id: pc.contact_id,
            name: pc.name || "",
            email: pc.email,
            jobTitle: pc.job_title,
          });
        }
      }

      res.json(Array.from(grouped.values()));
    } catch (e: any) {
      console.error("[my-portfolio] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Deal WIP Badges endpoint ──────────────────────────────────────────
  app.get("/api/crm/deals/wip-badges", requireAuth, async (req: any, res) => {
    try {
      const { rows: deals } = await pool.query(`SELECT id, name FROM crm_deals`);
      const { rows: wips } = await pool.query(`
        SELECT ref, project, amt_wip, amt_invoice, deal_status AS stage, month
        FROM wip_entries
      `);

      const result: Record<string, { amtWip: number; amtInvoice: number; count: number; entries: any[] }> = {};

      for (const d of deals) {
        const matched = wips.filter((w: any) => {
          if (!w.project || !d.name) return false;
          const wp = w.project.toLowerCase();
          const dn = d.name.toLowerCase();
          return wp.includes(dn) || dn.includes(wp);
        });

        if (matched.length > 0) {
          result[d.id] = {
            amtWip: matched.reduce((sum: number, w: any) => sum + (parseFloat(w.amt_wip) || 0), 0),
            amtInvoice: matched.reduce((sum: number, w: any) => sum + (parseFloat(w.amt_invoice) || 0), 0),
            count: matched.length,
            entries: matched.map((w: any) => ({
              ref: w.ref,
              project: w.project,
              amtWip: parseFloat(w.amt_wip) || 0,
              amtInvoice: parseFloat(w.amt_invoice) || 0,
              stage: w.stage,
              month: w.month,
            })),
          };
        }
      }

      res.json(result);
    } catch (e: any) {
      console.error("[wip-badges] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── WIP Reconciliation endpoint ──────────────────────────────────────
  app.get("/api/wip/reconciliation", requireAuth, async (req: any, res) => {
    try {
      const userId = req.session?.userId || req.tokenUserId;
      const currentUser = userId ? await storage.getUser(userId) : null;
      const isAdmin = !!currentUser?.isAdmin;
      const userTeam = currentUser?.team || null;

      // Query 1: Active deals with no matching WIP entry
      // Match by deal name similarity to wip_entries.project or wip_entries.ref
      const { rows: dealsWithoutWip } = await pool.query(`
        SELECT d.id, d.name, d.deal_type, d.status, d.fee, d.team, d.internal_agent,
               d.property_id,
               p.name AS property_name
        FROM crm_deals d
        LEFT JOIN crm_properties p ON d.property_id = p.id
        WHERE d.status NOT IN ('Dead', 'Draft', 'Leasing Comps', 'Investment Comps')
          AND NOT EXISTS (
            SELECT 1 FROM wip_entries w
            WHERE LOWER(TRIM(w.project)) = LOWER(TRIM(p.name))
               OR LOWER(TRIM(w.ref)) = LOWER(TRIM(d.name))
               OR LOWER(TRIM(w.project)) = LOWER(TRIM(d.name))
          )
        ORDER BY d.fee DESC NULLS LAST
      `);

      // Query 2: WIP entries with no matching deal
      const { rows: wipWithoutDeals } = await pool.query(`
        SELECT w.id, w.ref, w.project, w.agent, w.team, w.amt_wip, w.amt_invoice,
               w.group_name, w.deal_status
        FROM wip_entries w
        WHERE NOT EXISTS (
            SELECT 1 FROM crm_deals d
            LEFT JOIN crm_properties p ON d.property_id = p.id
            WHERE LOWER(TRIM(w.project)) = LOWER(TRIM(p.name))
               OR LOWER(TRIM(w.ref)) = LOWER(TRIM(d.name))
               OR LOWER(TRIM(w.project)) = LOWER(TRIM(d.name))
          )
        ORDER BY COALESCE(w.amt_wip, 0) + COALESCE(w.amt_invoice, 0) DESC
      `);

      // Filter by team if not admin
      let filteredDeals = dealsWithoutWip;
      let filteredWip = wipWithoutDeals;

      if (!isAdmin && userTeam) {
        const ut = userTeam.toLowerCase();
        filteredDeals = dealsWithoutWip.filter((d: any) => {
          if (!d.team) return false;
          const teams = (Array.isArray(d.team) ? d.team : [d.team]).map((t: string) => t.toLowerCase());
          return teams.some((t: string) => t === ut);
        });
        filteredWip = wipWithoutDeals.filter((w: any) => {
          if (!w.team) return false;
          const teams = w.team.split(",").map((t: string) => t.trim().toLowerCase());
          return teams.some((t: string) => t === ut);
        });
      }

      res.json({
        dealsWithoutWip: filteredDeals.map((d: any) => ({
          id: d.id,
          name: d.name,
          dealType: d.deal_type,
          status: d.status,
          fee: d.fee,
          team: d.team,
          internalAgent: d.internal_agent,
          propertyName: d.property_name,
        })),
        wipWithoutDeals: filteredWip.map((w: any) => ({
          id: w.id,
          ref: w.ref,
          project: w.project,
          agent: w.agent,
          team: w.team,
          amtWip: w.amt_wip,
          amtInvoice: w.amt_invoice,
          groupName: w.group_name,
          dealStatus: w.deal_status,
        })),
      });
    } catch (e: any) {
      console.error("[wip-reconciliation] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ────────────────────────────────────────────────────────────
  // WIP Report — Excel Export
  // ────────────────────────────────────────────────────────────
  app.get("/api/wip/export-excel", requireAuth, async (req: any, res: any) => {
    try {
      const ExcelJS = await import("exceljs");
      const senior = await isWipSenior(req);
      const userId = req.session?.userId || (req as any).tokenUserId;
      const currentUser = userId ? await storage.getUser(userId) : null;
      const isAdmin = !!currentUser?.isAdmin;
      const userTeam = currentUser?.team || null;

      const INVOICED_STATUSES = ["Invoiced", "Billed"];
      const EXCLUDED_STATUSES = ["Dead", "Leasing Comps", "Investment Comps"];

      const deals = await db.select().from(crmDeals);
      const properties = await db.select({ id: crmProperties.id, name: crmProperties.name }).from(crmProperties);
      const companies = await db.select({ id: crmCompanies.id, name: crmCompanies.name }).from(crmCompanies);
      const invoices = await db.select().from(xeroInvoices);
      const wipRows = await db.select().from(wipEntries);
      const allAllocations = await db.select().from(dealFeeAllocations);
      const allocsByDealId = new Map<string, typeof allAllocations>();
      for (const a of allAllocations) {
        if (!allocsByDealId.has(a.dealId)) allocsByDealId.set(a.dealId, []);
        allocsByDealId.get(a.dealId)!.push(a);
      }

      const propMap = new Map(properties.map(p => [p.id, p.name]));
      const compMap = new Map(companies.map(c => [c.id, c.name]));

      const invoicesByDeal = new Map<string, { totalAmount: number; invoiceNo: string | null; status: string | null }>();
      for (const inv of invoices) {
        const existing = invoicesByDeal.get(inv.dealId);
        if (existing) {
          existing.totalAmount += inv.totalAmount || 0;
          if (inv.invoiceNumber) existing.invoiceNo = inv.invoiceNumber;
        } else {
          invoicesByDeal.set(inv.dealId, {
            totalAmount: inv.totalAmount || 0,
            invoiceNo: inv.invoiceNumber || null,
            status: inv.status || null,
          });
        }
      }

      const dealByName = new Map<string, typeof deals[0]>();
      const dealByProperty = new Map<string, typeof deals[0]>();
      for (const d of deals) {
        if (d.name) dealByName.set(d.name.toLowerCase().trim(), d);
        const propName = d.propertyId ? propMap.get(d.propertyId) : null;
        if (propName) dealByProperty.set(propName.toLowerCase().trim(), d);
      }
      const findDealExcel = (key: string) => dealByName.get(key) || dealByProperty.get(key);

      function deriveStageExcel(status: string | null): string {
        if (!status) return "pipeline";
        if (INVOICED_STATUSES.includes(status)) return "invoiced";
        if (["SOLs", "Under Negotiation", "HOTs", "NEG", "Live", "Exchanged", "Completed"].includes(status)) return "wip";
        return "pipeline";
      }

      function deriveFiscalYearExcel(deal: any): number | null {
        if (deal.completionDate) {
          const d = new Date(deal.completionDate);
          if (!isNaN(d.getTime())) {
            const month = d.getMonth() + 1;
            return month >= 4 ? d.getFullYear() + 1 : d.getFullYear();
          }
        }
        if (!deal.createdAt) return null;
        const created = new Date(deal.createdAt);
        const month = created.getMonth() + 1;
        return month >= 4 ? created.getFullYear() + 1 : created.getFullYear();
      }

      function deriveMonthExcel(deal: any): string | null {
        const dateStr = deal.completionDate || (deal.updatedAt ? new Date(deal.updatedAt).toISOString() : null);
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        return `${months[d.getMonth()]}-${String(d.getFullYear()).slice(2)}`;
      }

      const usedDealIds = new Set<string>();

      let entries: any[] = wipRows.map(r => {
        const projectKey = (r.project || "").toLowerCase().trim();
        const refKey = (r.ref || "").toLowerCase().trim();
        const matchedDeal = findDealExcel(projectKey) || findDealExcel(refKey);
        if (matchedDeal) usedDealIds.add(matchedDeal.id);
        const tenantName = matchedDeal?.tenantId ? compMap.get(matchedDeal.tenantId) || null : null;
        return {
          id: r.id, dealId: matchedDeal?.id || null, dealType: matchedDeal?.dealType || null,
          ref: r.ref, groupName: r.groupName, project: r.project, tenant: r.tenant || tenantName,
          team: r.team, agent: r.agent, assetClass: matchedDeal?.assetClass || null,
          amtWip: r.amtWip || 0, amtInvoice: r.amtInvoice || 0, month: r.month,
          dealStatus: r.dealStatus, stage: r.stage, invoiceNo: r.invoiceNo,
          fiscalYear: r.fiscalYear, source: "spreadsheet" as const,
        };
      });

      const unmatchedDeals = deals.filter(d => !EXCLUDED_STATUSES.includes(d.status || "") && !usedDealIds.has(d.id));
      for (const deal of unmatchedDeals) {
        const teamStr = Array.isArray(deal.team) ? deal.team.join(", ") : (deal.team || null);
        const propertyName = deal.propertyId ? propMap.get(deal.propertyId) || null : null;
        const tenantName = deal.tenantId ? compMap.get(deal.tenantId) || null : null;
        const invoice = invoicesByDeal.get(deal.id);
        const stage = deriveStageExcel(deal.status);
        const isInvoiced = stage === "invoiced";
        const totalFee = deal.fee || 0;
        const totalInvoiceAmt = invoice?.totalAmount || (isInvoiced ? totalFee : 0);
        const dealAllocations = allocsByDealId.get(deal.id);

        if (dealAllocations && dealAllocations.length > 0) {
          for (const alloc of dealAllocations) {
            const allocPct = (alloc.percentage || 0) / 100;
            const agentFee = alloc.fixedAmount || Math.round(totalFee * allocPct * 100) / 100;
            const agentInvoiceAmt = alloc.fixedAmount || Math.round(totalInvoiceAmt * allocPct * 100) / 100;
            entries.push({
              id: `${deal.id}_${alloc.agentName}`, dealId: deal.id, dealType: deal.dealType || null,
              ref: deal.name, groupName: deal.groupName || null, project: propertyName, tenant: tenantName,
              team: teamStr, agent: alloc.agentName, assetClass: deal.assetClass || null,
              amtWip: isInvoiced ? 0 : agentFee, amtInvoice: agentInvoiceAmt,
              month: deriveMonthExcel(deal), dealStatus: deal.status || null, stage,
              invoiceNo: invoice?.invoiceNo || null, fiscalYear: deriveFiscalYearExcel(deal), source: "crm" as const,
            });
          }
        } else {
          const agentNames = Array.isArray(deal.internalAgent) ? deal.internalAgent : (deal.internalAgent ? [deal.internalAgent] : []);
          if (agentNames.length === 0) {
            entries.push({
              id: deal.id, dealId: deal.id, dealType: deal.dealType || null,
              ref: deal.name, groupName: deal.groupName || null, project: propertyName, tenant: tenantName,
              team: teamStr, agent: null, assetClass: deal.assetClass || null,
              amtWip: isInvoiced ? 0 : totalFee, amtInvoice: totalInvoiceAmt,
              month: deriveMonthExcel(deal), dealStatus: deal.status || null, stage,
              invoiceNo: invoice?.invoiceNo || null, fiscalYear: deriveFiscalYearExcel(deal), source: "crm" as const,
            });
          } else {
            const perAgentFee = totalFee / agentNames.length;
            const perAgentInvoice = totalInvoiceAmt / agentNames.length;
            for (const agentName of agentNames) {
              entries.push({
                id: `${deal.id}_${agentName}`, dealId: deal.id, dealType: deal.dealType || null,
                ref: deal.name, groupName: deal.groupName || null, project: propertyName, tenant: tenantName,
                team: teamStr, agent: agentName, assetClass: deal.assetClass || null,
                amtWip: isInvoiced ? 0 : perAgentFee, amtInvoice: perAgentInvoice,
                month: deriveMonthExcel(deal), dealStatus: deal.status || null, stage,
                invoiceNo: invoice?.invoiceNo || null, fiscalYear: deriveFiscalYearExcel(deal), source: "crm" as const,
              });
            }
          }
        }
      }

      // Apply same access control as /api/wip
      if (!senior) {
        entries = entries.filter(e => {
          if (e.team) {
            const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
            if (teams.some((t: string) => t === "bgp")) return false;
          }
          if (e.agent) {
            const agents = (e.agent as string).split(",").map((a: string) => a.trim().toLowerCase());
            if (agents.some((a: string) => WIP_RESTRICTED_AGENTS.has(a))) return false;
          }
          return true;
        });
      }
      if (!isAdmin) {
        if (!userTeam) {
          entries = [];
        } else {
          const ut = userTeam.toLowerCase();
          entries = entries.filter(e => {
            if (!e.team) return false;
            const teams = (e.team as string).split(",").map((t: string) => t.trim().toLowerCase());
            return teams.some((t: string) => t === ut);
          });
        }
      }

      // Build workbook
      const wb = new ExcelJS.default.Workbook();
      wb.creator = "BGP Dashboard";
      wb.created = new Date();

      const BGP_GREEN = "2E5E3F";
      const LIGHT_ROW = "F2F7F4";
      const CURRENCY_FMT = "£#,##0";

      const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${BGP_GREEN}` } };
      const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      const altFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${LIGHT_ROW}` } };

      // Sheet 1 — WIP Report
      const ws1 = wb.addWorksheet("WIP Report");
      const cols = [
        { header: "Ref", key: "ref", width: 28 },
        { header: "Group", key: "groupName", width: 18 },
        { header: "Project", key: "project", width: 28 },
        { header: "Tenant", key: "tenant", width: 22 },
        { header: "Team", key: "team", width: 14 },
        { header: "Agent", key: "agent", width: 20 },
        { header: "Deal Type", key: "dealType", width: 16 },
        { header: "Asset Class", key: "assetClass", width: 16 },
        { header: "WIP Amount", key: "amtWip", width: 16 },
        { header: "Invoice Amount", key: "amtInvoice", width: 16 },
        { header: "Month", key: "month", width: 12 },
        { header: "Status", key: "dealStatus", width: 14 },
        { header: "Stage", key: "stage", width: 12 },
        { header: "Fiscal Year", key: "fiscalYear", width: 12 },
      ];
      ws1.columns = cols;

      // Style header row
      const headerRow1 = ws1.getRow(1);
      headerRow1.eachCell(cell => {
        cell.fill = headerFill;
        cell.font = headerFont;
        cell.alignment = { vertical: "middle", horizontal: "center" };
      });
      headerRow1.height = 28;

      // Add data rows
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const row = ws1.addRow({
          ref: e.ref || "",
          groupName: e.groupName || "",
          project: e.project || "",
          tenant: e.tenant || "",
          team: e.team || "",
          agent: e.agent || "",
          dealType: e.dealType || "",
          assetClass: e.assetClass || "",
          amtWip: e.amtWip || 0,
          amtInvoice: e.amtInvoice || 0,
          month: e.month || "",
          dealStatus: e.dealStatus || "",
          stage: e.stage || "",
          fiscalYear: e.fiscalYear || "",
        });
        row.getCell("amtWip").numFmt = CURRENCY_FMT;
        row.getCell("amtInvoice").numFmt = CURRENCY_FMT;
        if (i % 2 === 1) {
          row.eachCell(cell => { cell.fill = altFill; });
        }
      }

      // Totals footer
      const totalsRow = ws1.addRow({
        ref: "TOTAL",
        amtWip: entries.reduce((s, e) => s + (e.amtWip || 0), 0),
        amtInvoice: entries.reduce((s, e) => s + (e.amtInvoice || 0), 0),
      });
      totalsRow.font = { bold: true, size: 11 };
      totalsRow.getCell("amtWip").numFmt = CURRENCY_FMT;
      totalsRow.getCell("amtInvoice").numFmt = CURRENCY_FMT;
      totalsRow.eachCell(cell => {
        cell.border = { top: { style: "double" } };
      });

      ws1.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
      ws1.autoFilter = { from: "A1", to: `N${entries.length + 1}` };

      // Sheet 2 — Agent Summary
      const ws2 = wb.addWorksheet("Agent Summary");
      const agentMap = new Map<string, { wip: number; invoiced: number }>();
      for (const e of entries) {
        const agent = e.agent || "Unassigned";
        const existing = agentMap.get(agent) || { wip: 0, invoiced: 0 };
        existing.wip += e.amtWip || 0;
        existing.invoiced += e.amtInvoice || 0;
        agentMap.set(agent, existing);
      }
      ws2.columns = [
        { header: "Agent", key: "agent", width: 26 },
        { header: "WIP", key: "wip", width: 18 },
        { header: "Invoiced", key: "invoiced", width: 18 },
        { header: "Total", key: "total", width: 18 },
      ];
      const headerRow2 = ws2.getRow(1);
      headerRow2.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = { vertical: "middle", horizontal: "center" }; });
      headerRow2.height = 28;

      let agentIdx = 0;
      let totalWipSum = 0, totalInvoicedSum = 0;
      for (const [agent, vals] of [...agentMap.entries()].sort((a, b) => (b[1].wip + b[1].invoiced) - (a[1].wip + a[1].invoiced))) {
        const total = vals.wip + vals.invoiced;
        totalWipSum += vals.wip;
        totalInvoicedSum += vals.invoiced;
        const row = ws2.addRow({ agent, wip: vals.wip, invoiced: vals.invoiced, total });
        row.getCell("wip").numFmt = CURRENCY_FMT;
        row.getCell("invoiced").numFmt = CURRENCY_FMT;
        row.getCell("total").numFmt = CURRENCY_FMT;
        if (agentIdx % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
        agentIdx++;
      }
      const agentTotals = ws2.addRow({ agent: "TOTAL", wip: totalWipSum, invoiced: totalInvoicedSum, total: totalWipSum + totalInvoicedSum });
      agentTotals.font = { bold: true, size: 11 };
      agentTotals.getCell("wip").numFmt = CURRENCY_FMT;
      agentTotals.getCell("invoiced").numFmt = CURRENCY_FMT;
      agentTotals.getCell("total").numFmt = CURRENCY_FMT;
      agentTotals.eachCell(cell => { cell.border = { top: { style: "double" } }; });
      ws2.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

      // Sheet 3 — By Status
      const ws3 = wb.addWorksheet("By Status");
      const statusMap = new Map<string, { count: number; wip: number; invoiced: number }>();
      for (const e of entries) {
        const status = e.dealStatus || "Unknown";
        const existing = statusMap.get(status) || { count: 0, wip: 0, invoiced: 0 };
        existing.count++;
        existing.wip += e.amtWip || 0;
        existing.invoiced += e.amtInvoice || 0;
        statusMap.set(status, existing);
      }
      ws3.columns = [
        { header: "Status", key: "status", width: 20 },
        { header: "Count", key: "count", width: 12 },
        { header: "WIP", key: "wip", width: 18 },
        { header: "Invoiced", key: "invoiced", width: 18 },
        { header: "Total", key: "total", width: 18 },
      ];
      const headerRow3 = ws3.getRow(1);
      headerRow3.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = { vertical: "middle", horizontal: "center" }; });
      headerRow3.height = 28;

      let statusIdx = 0;
      for (const [status, vals] of [...statusMap.entries()].sort((a, b) => (b[1].wip + b[1].invoiced) - (a[1].wip + a[1].invoiced))) {
        const row = ws3.addRow({ status, count: vals.count, wip: vals.wip, invoiced: vals.invoiced, total: vals.wip + vals.invoiced });
        row.getCell("wip").numFmt = CURRENCY_FMT;
        row.getCell("invoiced").numFmt = CURRENCY_FMT;
        row.getCell("total").numFmt = CURRENCY_FMT;
        if (statusIdx % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
        statusIdx++;
      }
      ws3.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

      // Send
      const buffer = await wb.xlsx.writeBuffer();
      const dateStr = new Date().toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="BGP_WIP_Report_${dateStr}.xlsx"`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (e: any) {
      console.error("[wip-export-excel] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });

  // ────────────────────────────────────────────────────────────
  // Board Report — Excel Export
  // ────────────────────────────────────────────────────────────
  app.get("/api/board-report/export-excel", requireAuth, async (_req: any, res: any) => {
    try {
      const ExcelJS = await import("exceljs");

      const allDeals = await db.select().from(crmDeals);
      const allAllocations = await db.select().from(dealFeeAllocations);
      const now = new Date();
      const yearStart = new Date(now.getFullYear(), 0, 1);

      const statusCounts: Record<string, number> = {};
      const teamCounts: Record<string, number> = {};
      const dealTypeCounts: Record<string, number> = {};

      let totalFeesYTD = 0;
      let completedCount = 0;
      let totalDays = 0;
      let completedWithDays = 0;
      const fees: number[] = [];
      const topDeals: Array<{ name: string; fee: number; team: string; status: string; dealType: string }> = [];

      for (const deal of allDeals) {
        const status = deal.status || "Unknown";
        statusCounts[status] = (statusCounts[status] || 0) + 1;

        if (deal.team && Array.isArray(deal.team)) {
          for (const t of deal.team) {
            teamCounts[t] = (teamCounts[t] || 0) + 1;
          }
        }

        const dt = deal.dealType || "Unknown";
        dealTypeCounts[dt] = (dealTypeCounts[dt] || 0) + 1;

        if (deal.fee && deal.fee > 0) {
          fees.push(deal.fee);
          topDeals.push({
            name: deal.name || "Unnamed",
            fee: deal.fee,
            team: (deal.team || []).join(", "),
            status: deal.status || "",
            dealType: deal.dealType || "",
          });

          const completionStr = deal.completionDate || deal.updatedAt?.toISOString?.();
          if (completionStr) {
            const completionDate = new Date(completionStr);
            if (completionDate >= yearStart && completionDate <= now) {
              totalFeesYTD += deal.fee;
            }
          }
        }

        const isComplete = status === "Invoiced" || status === "Exchanged";
        if (isComplete) completedCount++;

        if (isComplete && deal.createdAt) {
          const created = new Date(deal.createdAt);
          const completed = deal.completionDate ? new Date(deal.completionDate) : (deal.updatedAt || now);
          const days = Math.round((new Date(completed).getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
          if (days > 0 && days < 1000) {
            totalDays += days;
            completedWithDays++;
          }
        }
      }

      topDeals.sort((a, b) => b.fee - a.fee);

      const conversionRate = allDeals.length > 0 ? Math.round((completedCount / allDeals.length) * 100) : 0;
      const avgDealSize = fees.length > 0 ? Math.round(fees.reduce((a, b) => a + b, 0) / fees.length) : 0;
      const avgTimeToClose = completedWithDays > 0 ? Math.round(totalDays / completedWithDays) : 0;

      // Build workbook
      const wb = new ExcelJS.default.Workbook();
      wb.creator = "BGP Dashboard";
      wb.created = new Date();

      const BGP_GREEN = "2E5E3F";
      const LIGHT_ROW = "F2F7F4";
      const CURRENCY_FMT = "£#,##0";

      const headerFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${BGP_GREEN}` } };
      const headerFont = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      const altFill = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: `FF${LIGHT_ROW}` } };

      // Sheet 1 — Executive Summary
      const ws1 = wb.addWorksheet("Executive Summary");
      ws1.columns = [
        { header: "", key: "label", width: 30 },
        { header: "", key: "value", width: 30 },
      ];

      // Title
      const titleRow = ws1.addRow({ label: "BGP Board Report — Executive Summary" });
      titleRow.font = { bold: true, size: 16, color: { argb: `FF${BGP_GREEN}` } };
      ws1.mergeCells(titleRow.number, 1, titleRow.number, 2);
      ws1.addRow({});

      const dateRow = ws1.addRow({ label: "Generated", value: now.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) });
      dateRow.font = { italic: true, color: { argb: "FF666666" } };
      ws1.addRow({});

      // KPIs
      const kpiHeader = ws1.addRow({ label: "Key Performance Indicators" });
      kpiHeader.font = { bold: true, size: 13, color: { argb: `FF${BGP_GREEN}` } };
      ws1.addRow({});

      const kpis = [
        ["Total Deals in Pipeline", allDeals.length.toString()],
        ["Fees Billed YTD", `£${totalFeesYTD.toLocaleString()}`],
        ["Conversion Rate", `${conversionRate}%`],
        ["Average Deal Size", `£${avgDealSize.toLocaleString()}`],
        ["Average Time to Close", `${avgTimeToClose} days`],
        ["Completed Deals", completedCount.toString()],
      ];
      for (const [label, value] of kpis) {
        const row = ws1.addRow({ label, value });
        row.getCell("label").font = { bold: true };
      }
      ws1.addRow({});

      // Status breakdown
      const statusHeader = ws1.addRow({ label: "Pipeline by Status" });
      statusHeader.font = { bold: true, size: 13, color: { argb: `FF${BGP_GREEN}` } };
      ws1.addRow({});
      const statusTableHeader = ws1.addRow({ label: "Status", value: "Count" });
      statusTableHeader.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; });
      for (const [status, count] of Object.entries(statusCounts).sort((a, b) => b[1] - a[1])) {
        ws1.addRow({ label: status, value: count.toString() });
      }

      // Sheet 2 — Pipeline
      const ws2 = wb.addWorksheet("Pipeline");
      ws2.columns = [
        { header: "Deal Name", key: "name", width: 32 },
        { header: "Status", key: "status", width: 16 },
        { header: "Fee", key: "fee", width: 18 },
        { header: "Team", key: "team", width: 20 },
        { header: "Agent(s)", key: "agent", width: 24 },
        { header: "Deal Type", key: "dealType", width: 16 },
        { header: "Asset Class", key: "assetClass", width: 16 },
      ];
      const pipelineHeader = ws2.getRow(1);
      pipelineHeader.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = { vertical: "middle", horizontal: "center" }; });
      pipelineHeader.height = 28;

      const sortedDeals = [...allDeals].sort((a, b) => (b.fee || 0) - (a.fee || 0));
      for (let i = 0; i < sortedDeals.length; i++) {
        const deal = sortedDeals[i];
        const row = ws2.addRow({
          name: deal.name || "Unnamed",
          status: deal.status || "",
          fee: deal.fee || 0,
          team: Array.isArray(deal.team) ? deal.team.join(", ") : (deal.team || ""),
          agent: Array.isArray(deal.internalAgent) ? deal.internalAgent.join(", ") : (deal.internalAgent || ""),
          dealType: deal.dealType || "",
          assetClass: deal.assetClass || "",
        });
        row.getCell("fee").numFmt = CURRENCY_FMT;
        if (i % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
      }

      // Totals
      const pipelineTotals = ws2.addRow({
        name: "TOTAL",
        fee: allDeals.reduce((s, d) => s + (d.fee || 0), 0),
      });
      pipelineTotals.font = { bold: true, size: 11 };
      pipelineTotals.getCell("fee").numFmt = CURRENCY_FMT;
      pipelineTotals.eachCell(cell => { cell.border = { top: { style: "double" } }; });

      ws2.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];
      ws2.autoFilter = { from: "A1", to: `G${sortedDeals.length + 1}` };

      // Sheet 3 — Fee Analysis
      const ws3 = wb.addWorksheet("Fee Analysis");
      ws3.columns = [
        { header: "Category", key: "category", width: 24 },
        { header: "Name", key: "name", width: 24 },
        { header: "Deal Count", key: "count", width: 14 },
        { header: "Total Fees", key: "totalFees", width: 18 },
      ];
      const feeHeader = ws3.getRow(1);
      feeHeader.eachCell(cell => { cell.fill = headerFill; cell.font = headerFont; cell.alignment = { vertical: "middle", horizontal: "center" }; });
      feeHeader.height = 28;

      // By Team
      const teamFees = new Map<string, { count: number; total: number }>();
      for (const deal of allDeals) {
        if (deal.team && Array.isArray(deal.team)) {
          for (const t of deal.team) {
            const existing = teamFees.get(t) || { count: 0, total: 0 };
            existing.count++;
            existing.total += deal.fee || 0;
            teamFees.set(t, existing);
          }
        }
      }
      let feeRowIdx = 0;
      for (const [name, vals] of [...teamFees.entries()].sort((a, b) => b[1].total - a[1].total)) {
        const row = ws3.addRow({ category: "Team", name, count: vals.count, totalFees: vals.total });
        row.getCell("totalFees").numFmt = CURRENCY_FMT;
        if (feeRowIdx % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
        feeRowIdx++;
      }

      // Separator
      ws3.addRow({});
      feeRowIdx = 0;

      // By Agent
      const agentFees = new Map<string, { count: number; total: number }>();
      for (const deal of allDeals) {
        const agents = Array.isArray(deal.internalAgent) ? deal.internalAgent : (deal.internalAgent ? [deal.internalAgent] : []);
        const perAgent = (deal.fee || 0) / Math.max(agents.length, 1);
        for (const agent of agents) {
          const existing = agentFees.get(agent) || { count: 0, total: 0 };
          existing.count++;
          existing.total += perAgent;
          agentFees.set(agent, existing);
        }
      }
      for (const [name, vals] of [...agentFees.entries()].sort((a, b) => b[1].total - a[1].total)) {
        const row = ws3.addRow({ category: "Agent", name, count: vals.count, totalFees: Math.round(vals.total) });
        row.getCell("totalFees").numFmt = CURRENCY_FMT;
        if (feeRowIdx % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
        feeRowIdx++;
      }

      // Separator
      ws3.addRow({});
      feeRowIdx = 0;

      // By Deal Type
      const dtFees = new Map<string, { count: number; total: number }>();
      for (const deal of allDeals) {
        const dt = deal.dealType || "Unknown";
        const existing = dtFees.get(dt) || { count: 0, total: 0 };
        existing.count++;
        existing.total += deal.fee || 0;
        dtFees.set(dt, existing);
      }
      for (const [name, vals] of [...dtFees.entries()].sort((a, b) => b[1].total - a[1].total)) {
        const row = ws3.addRow({ category: "Deal Type", name, count: vals.count, totalFees: vals.total });
        row.getCell("totalFees").numFmt = CURRENCY_FMT;
        if (feeRowIdx % 2 === 1) row.eachCell(cell => { cell.fill = altFill; });
        feeRowIdx++;
      }

      ws3.views = [{ state: "frozen", ySplit: 1, xSplit: 0 }];

      // Send
      const buffer = await wb.xlsx.writeBuffer();
      const dateStr = now.toISOString().slice(0, 10);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="BGP_Board_Report_${dateStr}.xlsx"`);
      res.send(Buffer.from(buffer as ArrayBuffer));
    } catch (e: any) {
      console.error("[board-report-export-excel] Error:", e);
      res.status(500).json({ error: e.message });
    }
  });
}

const AUTO_ENRICH_INTERVAL_HOURS = 6;
const AUTO_ENRICH_BATCH_SIZE = 5;
let autoEnrichInterval: ReturnType<typeof setInterval> | null = null;
let autoEnrichEnabled = true;
let autoEnrichRunning = false;
let autoEnrichLastRun: Date | null = null;
let autoEnrichLastResult: Record<string, any> | null = null;

async function runAutoEnrichmentCycle() {
  if (autoEnrichRunning) return;
  autoEnrichRunning = true;

  const result: Record<string, any> = { startedAt: new Date().toISOString(), apollo: null, aiCompanies: null, aiContacts: null };

  try {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const apolloKey = process.env.APOLLO_API_KEY;
    if (apolloKey) {
      try {
        const contacts = await pool.query(`
          SELECT c.id, c.name, c.email, c.phone, c.role, c.linkedin_url, c.avatar_url, c.company_id, c.company_name
          FROM crm_contacts c
          WHERE c.email IS NOT NULL AND c.email != ''
            AND (c.last_enriched_at IS NULL OR c.last_enriched_at < $1)
          ORDER BY c.last_enriched_at ASC NULLS FIRST
          LIMIT $2
        `, [sixMonthsAgo.toISOString(), AUTO_ENRICH_BATCH_SIZE]).then(r => r.rows);

        let enriched = 0;
        for (const contact of contacts) {
          try {
            const nameParts = (contact.name || "").trim().split(/\s+/);
            const firstName = nameParts[0] || "";
            const lastName = nameParts.slice(1).join(" ") || "";
            let companyDomain: string | undefined;
            let companyName: string | undefined;
            if (contact.company_id) {
              const [company] = await pool.query(`SELECT name, domain FROM crm_companies WHERE id = $1`, [contact.company_id]).then(r => r.rows);
              if (company) { companyName = company.name; companyDomain = company.domain || undefined; }
            }
            if (!companyDomain && contact.company_name) companyName = contact.company_name;

            // mixed_people/api_search (replaces deprecated mixed_people/search)
            const body: Record<string, any> = { page: 1, per_page: 1 };
            if (contact.email) body.person_emails = [contact.email];
            if (companyDomain) body.q_organization_domains_list = [companyDomain];
            else if (companyName) body.organization_names = [companyName];
            if (firstName || lastName) body.q_keywords = `${firstName} ${lastName}`.trim();

            const apolloRes = await fetch("https://api.apollo.io/api/v1/mixed_people/api_search", {
              method: "POST",
              headers: { "Content-Type": "application/json", "Cache-Control": "no-cache", "X-Api-Key": apolloKey },
              body: JSON.stringify(body),
            });

            if (!apolloRes.ok) {
              if (apolloRes.status === 429) await new Promise(r => setTimeout(r, 3000));
              await new Promise(r => setTimeout(r, 500));
              continue;
            }

            const data = await apolloRes.json() as any;
            const person = (data.people || data.contacts || [])[0];
            if (!person) { await new Promise(r => setTimeout(r, 300)); continue; }

            const updates: Record<string, any> = {};
            if (person.title && !contact.role) updates.role = person.title;
            if (person.linkedin_url && !contact.linkedin_url) updates.linkedin_url = person.linkedin_url;
            const phoneNumber = person.phone_numbers?.[0]?.sanitized_number || person.phone_numbers?.[0]?.raw_number || person.organization?.phone;
            if (phoneNumber && !contact.phone) updates.phone = phoneNumber;
            if (person.photo_url && !contact.avatar_url) updates.avatar_url = person.photo_url;

            updates.last_enriched_at = new Date();
            updates.enrichment_source = "apollo-auto";
            const ALLOWED = new Set(["role", "linkedin_url", "phone", "avatar_url", "last_enriched_at", "enrichment_source"]);
            const safeUpdates = Object.fromEntries(Object.entries(updates).filter(([k]) => ALLOWED.has(k)));

            if (Object.keys(safeUpdates).length > 0) {
              const setClauses = Object.keys(safeUpdates).map((k, i) => `${k} = $${i + 2}`);
              setClauses.push(`updated_at = NOW()`);
              await pool.query(`UPDATE crm_contacts SET ${setClauses.join(", ")} WHERE id = $1`, [contact.id, ...Object.values(safeUpdates)]);
              enriched++;
            }
            await new Promise(r => setTimeout(r, 300));
          } catch (err: any) {
            console.error(`[auto-enrich] Apollo error for ${contact.name}:`, err.message);
          }
        }
        result.apollo = { processed: contacts.length, enriched };
        if (contacts.length > 0) console.log(`[auto-enrich] Apollo: ${enriched}/${contacts.length} contacts enriched`);
      } catch (err: any) {
        result.apollo = { error: err.message };
        console.error("[auto-enrich] Apollo batch error:", err.message);
      }
    }

    {
      try {
        const companies = await pool.query(`
          SELECT id, name, company_type, domain
          FROM crm_companies
          WHERE (description IS NULL OR description = '' OR domain IS NULL OR domain = '')
            AND (last_enriched_at IS NULL OR last_enriched_at < $1)
          ORDER BY last_enriched_at ASC NULLS FIRST
          LIMIT $2
        `, [sixMonthsAgo.toISOString(), AUTO_ENRICH_BATCH_SIZE]).then(r => r.rows);

        let enriched = 0;
        for (const company of companies) {
          try {
            const completion = await callClaude({
              model: CHATBGP_HELPER_MODEL,
              messages: [
                { role: "system", content: `You are a UK commercial property data researcher. Given a company name and optional type, return a JSON object with:\n- "website": the company's main website URL or null\n- "description": a brief 1-2 sentence description\n- "headOfficeCity": city of head office or null\n\nOnly return the JSON object.` },
                { role: "user", content: `Company: "${company.name}"${company.company_type ? ` (Type: ${company.company_type})` : ""}${company.domain ? ` (Website: ${company.domain})` : ""}` }
              ],
              max_completion_tokens: 200,
            });

            const raw = completion.choices[0]?.message?.content?.trim() || "{}";
            const data = parseAiJson(raw);
            const updates: Record<string, any> = {};
            if (data.website && !company.domain) updates.domain = data.website.replace(/\/+$/, "");
            if (data.description) updates.description = data.description;
            if (data.headOfficeCity) updates.head_office_address = JSON.stringify({ city: data.headOfficeCity });

            if (Object.keys(updates).length > 0) {
              updates.last_enriched_at = new Date();
              updates.enrichment_source = "ai-auto";
              updates.updated_at = new Date();
              const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 2}`);
              await pool.query(`UPDATE crm_companies SET ${setClauses.join(", ")} WHERE id = $1`, [company.id, ...Object.values(updates)]);
              enriched++;
            }
          } catch (err: any) {
            console.error(`[auto-enrich] AI company error for ${company.name}:`, err.message);
          }
        }
        result.aiCompanies = { processed: companies.length, enriched };
        if (companies.length > 0) console.log(`[auto-enrich] AI Companies: ${enriched}/${companies.length} enriched`);
      } catch (err: any) {
        result.aiCompanies = { error: err.message };
      }

      try {
        const contacts = await pool.query(`
          SELECT c.id, c.name, c.company_name, c.company_id, c.contact_type
          FROM crm_contacts c
          WHERE (c.role IS NULL OR c.role = '')
            AND c.name != '(agent)' AND c.company_id IS NOT NULL
            AND (c.last_enriched_at IS NULL OR c.last_enriched_at < $1)
          ORDER BY c.last_enriched_at ASC NULLS FIRST
          LIMIT $2
        `, [sixMonthsAgo.toISOString(), AUTO_ENRICH_BATCH_SIZE]).then(r => r.rows);

        let enriched = 0;
        for (const contact of contacts) {
          try {
            let companyInfo = contact.company_name || "Unknown";
            if (contact.company_id) {
              const [co] = await pool.query(`SELECT name, company_type FROM crm_companies WHERE id = $1`, [contact.company_id]).then(r => r.rows);
              if (co) companyInfo = `${co.name}${co.company_type ? ` (${co.company_type})` : ""}`;
            }

            const completion = await callClaude({
              model: CHATBGP_HELPER_MODEL,
              messages: [
                { role: "system", content: `You are a UK commercial property data researcher. Given a person's name and their company, suggest their likely job title/role. Return a JSON object with:\n- "role": their likely job title (e.g. "Director", "Head of Acquisitions", "Senior Surveyor") or null if uncertain\n\nOnly return the JSON object.` },
                { role: "user", content: `Person: "${contact.name}" at company "${companyInfo}"${contact.contact_type ? ` (Contact type: ${contact.contact_type})` : ""}` }
              ],
              max_completion_tokens: 50,
            });

            const raw = completion.choices[0]?.message?.content?.trim() || "{}";
            const data = parseAiJson(raw);
            if (data.role) {
              await pool.query(
                `UPDATE crm_contacts SET role = $2, last_enriched_at = $3, enrichment_source = 'ai-auto', updated_at = NOW() WHERE id = $1`,
                [contact.id, data.role, new Date()]
              );
              enriched++;
            }
          } catch (err: any) {
            console.error(`[auto-enrich] AI contact error for ${contact.name}:`, err.message);
          }
        }
        result.aiContacts = { processed: contacts.length, enriched };
        if (contacts.length > 0) console.log(`[auto-enrich] AI Contacts: ${enriched}/${contacts.length} roles suggested`);
      } catch (err: any) {
        result.aiContacts = { error: err.message };
      }
    }

    {
      try {
        const untyped = await pool.query(`
          SELECT id, name, domain, description
          FROM crm_companies
          WHERE company_type IS NULL
          ORDER BY RANDOM()
          LIMIT $1
        `, [AUTO_ENRICH_BATCH_SIZE]).then(r => r.rows);

        let classified = 0;
        if (untyped.length > 0) {
          const validTypes = [
            "Tenant - Retail", "Tenant - Restaurant", "Tenant - Leisure", "Tenant",
            "Landlord", "Client", "Vendor", "Purchaser", "Investor", "Agent", "Billing Entity"
          ];
          for (const co of untyped) {
            try {
              const completion = await callClaude({
                model: CHATBGP_HELPER_MODEL,
                messages: [
                  { role: "system", content: `You are a UK commercial property CRM classifier. Given a company name and optional info, classify it into exactly ONE of these types:\n${validTypes.join(", ")}\n\nGuidelines:\n- Restaurants, cafes, bars, pubs → "Tenant - Restaurant"\n- Shops, fashion, retail brands, supermarkets → "Tenant - Retail"\n- Gyms, cinemas, entertainment, hotels → "Tenant - Leisure"\n- Generic/office tenants → "Tenant"\n- Property owners, freeholders, estate companies → "Landlord"\n- Property agents, estate agents, surveyors, brokerages → "Agent"\n- Investment funds, REITs, asset managers → "Investor"\n\nReturn ONLY the type string, nothing else.` },
                  { role: "user", content: `"${co.name}"${co.domain ? ` (${co.domain})` : ""}${co.description ? ` — ${co.description}` : ""}` }
                ],
                max_completion_tokens: 30,
              });
              const suggested = completion.choices[0]?.message?.content?.trim() || "";
              if (validTypes.includes(suggested)) {
                await pool.query(`UPDATE crm_companies SET company_type = $2, updated_at = NOW() WHERE id = $1`, [co.id, suggested]);
                classified++;
              }
            } catch (err: any) {
              console.error(`[auto-enrich] Type classify error for ${co.name}:`, err.message);
            }
          }
          console.log(`[auto-enrich] Type classification: ${classified}/${untyped.length} companies classified`);
        }
        result.typeClassify = { processed: untyped.length, classified };
      } catch (err: any) {
        result.typeClassify = { error: err.message };
      }
    }

    // Auto brand analysis — refresh stale AI briefing paragraphs (>14 days).
    try {
      const { refreshStaleBrandAnalyses } = await import("./brand-analysis");
      const out = await refreshStaleBrandAnalyses(3);
      result.brandAnalysis = out;
      if (out.processed > 0) console.log(`[auto-enrich] Brand analyses: refreshed ${out.refreshed}/${out.processed}`);
    } catch (err: any) {
      result.brandAnalysis = { error: err.message };
    }

    // Auto store research — find Google Places stores for tracked brands that
    // either have no stores cached or were last researched >30 days ago.
    // Skip brands with AI disabled.
    if (process.env.GOOGLE_API_KEY) {
      try {
        const brandsNeedingStores = await pool.query(`
          SELECT c.id, c.name
          FROM crm_companies c
          LEFT JOIN (
            SELECT brand_company_id, MAX(researched_at) AS last_researched
            FROM brand_stores
            WHERE source_type = 'google_places'
            GROUP BY brand_company_id
          ) s ON s.brand_company_id = c.id
          WHERE c.is_tracked_brand = true
            AND (c.ai_disabled IS NULL OR c.ai_disabled = FALSE)
            AND c.merged_into_id IS NULL
            AND (s.last_researched IS NULL OR s.last_researched < NOW() - INTERVAL '30 days')
          ORDER BY s.last_researched ASC NULLS FIRST
          LIMIT 3
        `).then(r => r.rows);

        let researched = 0;
        for (const b of brandsNeedingStores) {
          try {
            const { researchBrandStores } = await import("./brand-profile");
            const out = await researchBrandStores(b.id);
            if (out.found > 0) researched++;
          } catch (err: any) {
            console.error(`[auto-enrich] Store research error for ${b.name}:`, err.message);
          }
        }
        result.stores = { processed: brandsNeedingStores.length, researched };
        if (brandsNeedingStores.length > 0) console.log(`[auto-enrich] Stores: researched ${researched}/${brandsNeedingStores.length} brands`);
      } catch (err: any) {
        result.stores = { error: err.message };
      }
    }

    autoEnrichLastRun = new Date();
    autoEnrichLastResult = result;

    const hasActivity = (result.apollo?.processed > 0 || result.aiCompanies?.processed > 0 || result.aiContacts?.processed > 0 || result.typeClassify?.processed > 0 || result.stores?.processed > 0);
    if (hasActivity) {
      console.log(`[auto-enrich] Cycle complete — Apollo: ${result.apollo?.enriched || 0}, AI Companies: ${result.aiCompanies?.enriched || 0}, AI Contacts: ${result.aiContacts?.enriched || 0}, Type Classification: ${result.typeClassify?.classified || 0}, Stores: ${result.stores?.researched || 0}`);
      const totalEnriched = (result.apollo?.enriched || 0) + (result.aiCompanies?.enriched || 0) + (result.aiContacts?.enriched || 0) + (result.typeClassify?.classified || 0) + (result.stores?.researched || 0);
      const { logActivity } = await import("./activity-logger");
      await logActivity("auto-enrich", "enrichment_cycle", `${result.apollo?.enriched || 0} contacts via Apollo, ${result.aiCompanies?.enriched || 0} companies via AI, ${result.aiContacts?.enriched || 0} contact roles via AI, ${result.stores?.researched || 0} brands got stores`, totalEnriched);
    }
  } catch (err: any) {
    console.error("[auto-enrich] Cycle error:", err.message);
    autoEnrichLastResult = { error: err.message };
  } finally {
    autoEnrichRunning = false;
  }
}

export function startAutoEnrichment() {
  if (autoEnrichInterval) return;
  autoEnrichEnabled = true;
  console.log(`[auto-enrich] Started — running every ${AUTO_ENRICH_INTERVAL_HOURS} hours (batch size: ${AUTO_ENRICH_BATCH_SIZE})`);

  setTimeout(() => {
    runAutoEnrichmentCycle().catch(err => console.error("[auto-enrich] Initial run error:", err.message));
  }, 60000);

  autoEnrichInterval = setInterval(() => {
    runAutoEnrichmentCycle().catch(err => console.error("[auto-enrich] Scheduled run error:", err.message));
  }, AUTO_ENRICH_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function stopAutoEnrichment() {
  if (autoEnrichInterval) {
    clearInterval(autoEnrichInterval);
    autoEnrichInterval = null;
  }
  autoEnrichEnabled = false;
  console.log("[auto-enrich] Stopped");
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto Turnover Research
// Periodically finds tenant brands with no turnover data (or data >6 months old)
// and runs Claude research on them in small batches.
// ─────────────────────────────────────────────────────────────────────────────

const AUTO_TURNOVER_INTERVAL_HOURS = 18;
const AUTO_TURNOVER_BATCH_SIZE = 4;
let autoTurnoverInterval: ReturnType<typeof setInterval> | null = null;
let autoTurnoverEnabled = true;
let autoTurnoverRunning = false;
let autoTurnoverLastRun: Date | null = null;
let autoTurnoverLastResult: Record<string, any> | null = null;

async function runAutoTurnoverCycle() {
  if (autoTurnoverRunning) return;
  autoTurnoverRunning = true;

  const result: Record<string, any> = {
    startedAt: new Date().toISOString(),
    processed: 0,
    skipped: 0,
    errors: 0,
    brands: [] as string[],
  };

  try {
    // Pick tenant companies with no turnover data OR last entry > 6 months ago
    const { rows: candidates } = await pool.query(`
      SELECT c.id, c.name, c.company_type, c.domain
      FROM crm_companies c
      WHERE c.company_type ILIKE 'Tenant%'
        AND (
          NOT EXISTS (
            SELECT 1 FROM turnover_data t WHERE t.company_id = c.id
          )
          OR NOT EXISTS (
            SELECT 1 FROM turnover_data t
            WHERE t.company_id = c.id
              AND t.updated_at > NOW() - INTERVAL '6 months'
          )
        )
      ORDER BY RANDOM()
      LIMIT $1
    `, [AUTO_TURNOVER_BATCH_SIZE]);

    if (candidates.length === 0) {
      result.message = "All brands have recent turnover data";
      return;
    }

    const { nanoid } = await import("nanoid");

    for (const company of candidates) {
      try {
        const prompt = `You are a retail and brand finance research assistant with knowledge of major UK and international retail brands up to 2025.

For the brand "${company.name}" (type: ${company.company_type || "Retail"}${company.domain ? `, website: ${company.domain}` : ""}), provide the most recent annual turnover/revenue figure available.

Return ONLY valid JSON in this exact format:
{
  "turnover": <number in GBP, e.g. 5000000 for £5m. Use 0 if unknown>,
  "year": <year as integer, e.g. 2023>,
  "confidence": <"High", "Medium", or "Low">,
  "source": <"Annual Accounts" | "Industry Report" | "News" | "AI Estimate" | "Companies House">,
  "notes": <brief explanation of the figure and its source, max 100 chars>
}

Rules:
- For global brands (Nike, Zara, H&M) report UK revenue if known, otherwise global converted to GBP
- If the brand is primarily UK-based, report UK turnover
- If genuinely unknown, set turnover to 0 and confidence to "Low"
- Do not invent figures — Low confidence with real estimates is better than made-up High confidence`;

        const completion = await callClaude({
          model: CHATBGP_HELPER_MODEL,
          messages: [{ role: "user", content: prompt }],
          max_completion_tokens: 200,
        });

        const raw = completion.choices[0]?.message?.content?.trim() || "{}";
        let parsed: any = {};
        try {
          const jsonMatch = raw.match(/\{[\s\S]*\}/);
          if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
        } catch { /* leave empty */ }

        const turnover = parsed.turnover && parsed.turnover > 0 ? parsed.turnover : null;
        const period = parsed.year ? String(parsed.year) : new Date().getFullYear().toString();
        const confidence = ["High", "Medium", "Low"].includes(parsed.confidence) ? parsed.confidence : "Low";
        const source = parsed.source || "AI Estimate";
        const notes = parsed.notes || `Auto-researched turnover for ${company.name}`;

        const existing = await pool.query(
          `SELECT id FROM turnover_data WHERE company_id = $1 AND source = $2 LIMIT 1`,
          [company.id, source]
        ).then(r => r.rows[0]);

        if (existing) {
          await pool.query(
            `UPDATE turnover_data SET turnover = $1, period = $2, confidence = $3, notes = $4, updated_at = NOW() WHERE id = $5`,
            [turnover, period, confidence, notes, existing.id]
          );
        } else {
          await pool.query(
            `INSERT INTO turnover_data (id, company_id, company_name, period, turnover, source, confidence, category, notes, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
            [nanoid(), company.id, company.name, period, turnover, source, confidence,
             (company.company_type || "").replace("Tenant - ", ""), notes]
          );
        }

        result.processed++;
        result.brands.push(company.name);

        // Small delay between API calls to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err: any) {
        console.error(`[auto-turnover] Error researching ${company.name}:`, err.message);
        result.errors++;
      }
    }

    if (result.processed > 0) {
      console.log(`[auto-turnover] Cycle complete — ${result.processed} brands researched: ${result.brands.join(", ")}`);
    }
  } catch (err: any) {
    console.error("[auto-turnover] Cycle error:", err.message);
    result.error = err.message;
  } finally {
    autoTurnoverLastRun = new Date();
    autoTurnoverLastResult = result;
    autoTurnoverRunning = false;
  }
}

export function startAutoTurnoverResearch() {
  if (autoTurnoverInterval) return;
  autoTurnoverEnabled = true;
  console.log(`[auto-turnover] Started — running every ${AUTO_TURNOVER_INTERVAL_HOURS} hours (batch size: ${AUTO_TURNOVER_BATCH_SIZE})`);

  // Initial run 90 seconds after server start (after auto-enrich has kicked off)
  setTimeout(() => {
    runAutoTurnoverCycle().catch(err => console.error("[auto-turnover] Initial run error:", err.message));
  }, 90000);

  autoTurnoverInterval = setInterval(() => {
    runAutoTurnoverCycle().catch(err => console.error("[auto-turnover] Scheduled run error:", err.message));
  }, AUTO_TURNOVER_INTERVAL_HOURS * 60 * 60 * 1000);
}

export function stopAutoTurnoverResearch() {
  if (autoTurnoverInterval) {
    clearInterval(autoTurnoverInterval);
    autoTurnoverInterval = null;
  }
  autoTurnoverEnabled = false;
  console.log("[auto-turnover] Stopped");
}
