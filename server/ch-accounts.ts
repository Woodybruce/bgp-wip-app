// Auto-fetch the latest annual accounts for a CRM company from Companies House.
//
// Flow per company (must have companies_house_number):
//   1. GET /company/{n} — read the authoritative `accounts.last_accounts.made_up_to`
//      date. This is the period-end CH considers the latest filed accounts for.
//      Going by filing-history alone is unreliable: the most-recent accounts-category
//      item is often a refiling, an amendment ("second filing"), or a
//      change-of-accounting-reference-date with no actual accounts attached.
//   2. GET /company/{n}/filing-history?category=accounts&items_per_page=25
//      and find the filing whose description_values.made_up_date matches the
//      profile date AND whose type is an actual accounts filing (description
//      starts with "accounts-with-accounts-type-..."). If multiple match
//      (a re-file), pick the one filed most recently.
//   3. Extract its document_metadata UUID (last path segment of
//      links.document_metadata).
//   4. If this UUID matches the stored last_accounts_doc_id, no-op.
//   5. Otherwise download the PDF via the document-api subdomain, save it
//      into file_storage under ch-accounts/{companyId}/{docId}.pdf, and
//      write the metadata back to crm_companies.
//
// Failure modes that count as "skip, don't error":
//   - Company has no CH number → nothing to fetch
//   - CH profile has no last_accounts.made_up_to → company hasn't filed yet
//   - Matching filing has no document_metadata (rare — usually means paper-only)
//   - PDF endpoint 404s for a known doc — log + continue rather than abort.
import Anthropic from "@anthropic-ai/sdk";
import { pool } from "./db";
import { chFetch } from "./companies-house";
import { saveFile, getFile } from "./file-storage";
import { rasterisePdfPage } from "./pdf-image-extract";

const CH_API_KEY = process.env.COMPANIES_HOUSE_API_KEY;
const DOC_API_BASE = "https://document-api.company-information.service.gov.uk";

export type FetchAccountsOutcome =
  | { status: "skipped"; reason: string }
  | { status: "up_to_date"; docId: string; madeUpTo: string | null }
  | { status: "downloaded"; docId: string; madeUpTo: string | null; storageKey: string; sizeBytes: number };

interface CrmCompanyRow {
  id: string;
  companies_house_number: string | null;
  last_accounts_doc_id: string | null;
}

function extractDocId(metadataUrl: string | null | undefined): string | null {
  if (!metadataUrl) return null;
  const parts = String(metadataUrl).split("/").filter(Boolean);
  return parts[parts.length - 1] || null;
}

// Description prefixes that signal a real annual accounts filing (as
// opposed to a change-of-reference-date or other accounts-category admin).
const ACCOUNTS_FILING_PREFIXES = [
  "accounts-with-accounts-type-",   // full / micro / small / medium / dormant / total-exemption-*
  "accounts-with-",                  // older variants (e.g. "accounts-with-made-up-date")
];

function isAnnualAccountsFiling(item: any): boolean {
  const desc = String(item?.description || "").toLowerCase();
  if (!desc) return false;
  // Skip explicit non-accounts admin filings.
  if (desc.includes("change-of-accounting-reference-date")) return false;
  if (desc.includes("revised-accounts")) return true; // refiled annual accounts — still valid
  return ACCOUNTS_FILING_PREFIXES.some(p => desc.startsWith(p));
}

export async function fetchLatestAccountsForCompany(companyId: string): Promise<FetchAccountsOutcome> {
  if (!CH_API_KEY) return { status: "skipped", reason: "COMPANIES_HOUSE_API_KEY not configured" };

  const { rows } = await pool.query<CrmCompanyRow>(
    `SELECT id, companies_house_number, last_accounts_doc_id
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const row = rows[0];
  if (!row) return { status: "skipped", reason: "company not found" };
  if (!row.companies_house_number) return { status: "skipped", reason: "no companies_house_number" };

  // 1. Ask CH for the authoritative latest-accounts period-end. Going by
  //    filing-history date alone is unreliable — the top item is often a
  //    refile/amendment for a stale period, or a change-of-reference-date.
  const profile = await chFetch(`/company/${encodeURIComponent(row.companies_house_number)}`);
  const targetMadeUpTo: string | null = profile?.accounts?.last_accounts?.made_up_to || null;
  if (!targetMadeUpTo) {
    return { status: "skipped", reason: "CH profile has no last_accounts.made_up_to (no annual accounts filed yet)" };
  }

  // 2. Filing history — wider window so we can scan past refilings.
  const history = await chFetch(
    `/company/${encodeURIComponent(row.companies_house_number)}/filing-history?category=accounts&items_per_page=25`
  );
  const items: any[] = history?.items || [];

  // 3. Find filings that ARE annual accounts AND match the target period.
  //    description_values.made_up_date is the period-end the filing covers.
  const annualAccountsAtTarget = items.filter(i => {
    if (!isAnnualAccountsFiling(i)) return false;
    const filedPeriod = i?.description_values?.made_up_date;
    return filedPeriod === targetMadeUpTo;
  });

  // 4. If multiple match (refile of the same period), prefer the one filed
  //    most recently — the CH 'date' field is the filing date (date-asc'd at
  //    that point), and items already come back date-DESC from CH.
  let target = annualAccountsAtTarget[0];

  // 5. Fallback: if nothing matched targetMadeUpTo exactly but CH said
  //    that's the latest accounts period, take the most recent annual
  //    accounts filing regardless of period match (very rare — usually
  //    indicates CH metadata lag).
  if (!target) {
    target = items.find(isAnnualAccountsFiling);
  }
  if (!target) return { status: "skipped", reason: "no annual accounts filing found in CH history" };

  const docId = extractDocId(target?.links?.document_metadata);
  if (!docId) return { status: "skipped", reason: "matching accounts filing has no document_metadata" };

  const madeUpTo: string | null = target?.description_values?.made_up_date || targetMadeUpTo;

  // 6. Already up to date? Same doc_id → already downloaded.
  if (row.last_accounts_doc_id === docId) {
    return { status: "up_to_date", docId, madeUpTo };
  }

  // 7. Download the PDF via the CH document API.
  const auth = `Basic ${Buffer.from(CH_API_KEY + ":").toString("base64")}`;
  const docRes = await fetch(`${DOC_API_BASE}/document/${encodeURIComponent(docId)}/content`, {
    headers: { Authorization: auth, Accept: "application/pdf" },
    redirect: "follow",
  });
  if (!docRes.ok) {
    throw new Error(`CH document fetch failed (${docRes.status}) for doc ${docId}`);
  }
  const buf = Buffer.from(await docRes.arrayBuffer());
  const storageKey = `ch-accounts/${companyId}/${docId}.pdf`;
  await saveFile(storageKey, buf, "application/pdf", `accounts-${docId}.pdf`);

  await pool.query(
    `UPDATE crm_companies
        SET last_accounts_doc_id = $1,
            last_accounts_made_up_to = $2,
            last_accounts_storage_key = $3,
            last_accounts_fetched_at = NOW()
      WHERE id = $4`,
    [docId, madeUpTo, storageKey, companyId]
  );

  return { status: "downloaded", docId, madeUpTo, storageKey, sizeBytes: buf.length };
}

// ── Weekly + bulk runner ───────────────────────────────────────────────────

interface BulkResult {
  total: number;
  processed: number;
  downloaded: number;
  upToDate: number;
  skipped: number;
  errored: number;
}

const DELAY_MS = 1000; // CH document API: 600 / 5min, so 1 req/sec is well under

export async function runBulkAccountsFetch(opts: { limit?: number } = {}): Promise<BulkResult> {
  const limit = opts.limit ?? 5000;
  const result: BulkResult = { total: 0, processed: 0, downloaded: 0, upToDate: 0, skipped: 0, errored: 0 };

  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT id, name FROM crm_companies
      WHERE merged_into_id IS NULL
        AND companies_house_number IS NOT NULL
        AND companies_house_number <> ''
      ORDER BY is_tracked_brand DESC, name
      LIMIT $1`,
    [limit]
  );
  result.total = rows.length;

  for (const row of rows) {
    try {
      const outcome = await fetchLatestAccountsForCompany(row.id);
      if (outcome.status === "downloaded") result.downloaded++;
      else if (outcome.status === "up_to_date") result.upToDate++;
      else result.skipped++;
    } catch (err: any) {
      result.errored++;
      console.warn(`[ch-accounts] ${row.name}: ${err?.message || err}`);
    }
    result.processed++;
    await new Promise(r => setTimeout(r, DELAY_MS));
  }
  return result;
}

// ── Vision-based accounts extraction ───────────────────────────────────────
// Rasterises the stored accounts PDF and asks Claude to read off the key P&L /
// balance-sheet figures. Results are cached on
// crm_companies.companies_house_data under "latestAccountsExtracted" so we only
// run vision once per filed period.

export interface AccountsExtracted {
  period: string | null;           // e.g. "2024-12-31"
  turnover: string | null;         // e.g. "£84.2m"
  grossProfit: string | null;
  operatingProfit: string | null;
  profitBeforeTax: string | null;
  netAssets: string | null;
  cash: string | null;
  employees: string | null;
  rawText: string;
}

function getAnthropic(): Anthropic {
  const apiKey = process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("No Anthropic API key configured");
  const opts: any = { apiKey };
  if (process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL && process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY) {
    opts.baseURL = process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL;
  }
  return new Anthropic(opts);
}

export async function extractAccountsFigures(companyId: string): Promise<AccountsExtracted | null> {
  // 1. Get the stored PDF's storage key + period.
  const { rows } = await pool.query<{
    last_accounts_storage_key: string | null;
    last_accounts_made_up_to: string | null;
    companies_house_data: any;
  }>(
    `SELECT last_accounts_storage_key, last_accounts_made_up_to, companies_house_data
       FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const row = rows[0];
  if (!row?.last_accounts_storage_key) return null;

  const period = row.last_accounts_made_up_to
    ? String(row.last_accounts_made_up_to).substring(0, 10)
    : null;

  // 2. Cache hit — don't re-run vision for a period we've already read.
  const cached = row.companies_house_data?.latestAccountsExtracted as AccountsExtracted | undefined;
  if (cached && cached.period === period) return cached;

  // 3. Load the PDF bytes from file_storage.
  const file = await getFile(row.last_accounts_storage_key);
  if (!file) return null;

  // 4. Rasterise pages 1..12 (cover + P&L + balance sheet for most CH filings).
  //    rasterisePdfPage returns null past the last page, so we stop at the
  //    first null.
  const pageImages: { media_type: "image/jpeg"; data: string }[] = [];
  for (let p = 1; p <= 12; p++) {
    const jpeg = await rasterisePdfPage({ pdfBuffer: file.data, page: p });
    if (!jpeg) break;
    pageImages.push({ media_type: "image/jpeg", data: jpeg.toString("base64") });
  }
  if (!pageImages.length) return null;

  // 5. Ask Claude to read off the figures.
  const anthropic = getAnthropic();
  const content: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text: `These are pages from a UK Companies House annual accounts PDF for a company.
Extract the following figures (use "not found" if absent):
- Accounting period end date
- Turnover / Revenue (£)
- Gross profit (£)
- Operating profit (£)
- Profit before tax (£)
- Net assets / shareholders' funds (£)
- Cash & cash equivalents (£)
- Average number of employees

Return ONLY a JSON object with keys: period, turnover, grossProfit, operatingProfit, profitBeforeTax, netAssets, cash, employees.
Use human-readable strings like "£84.2m" or "£1,234,567". No markdown fences.`,
    },
    ...pageImages.map(img => ({
      type: "image" as const,
      source: { type: "base64" as const, media_type: img.media_type, data: img.data },
    })),
  ];

  const resp = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 512,
    messages: [{ role: "user", content }],
  });

  const textBlock = resp.content.find(b => b.type === "text") as { type: "text"; text: string } | undefined;
  const rawText = textBlock?.text?.trim() || "";
  let parsed: Record<string, string> = {};
  try {
    parsed = JSON.parse(rawText.replace(/^```json\s*/i, "").replace(/```$/, "").trim());
  } catch {
    // best-effort — leave figures null, keep rawText for debugging
  }

  const result: AccountsExtracted = {
    period: parsed.period || period,
    turnover: parsed.turnover || null,
    grossProfit: parsed.grossProfit || null,
    operatingProfit: parsed.operatingProfit || null,
    profitBeforeTax: parsed.profitBeforeTax || null,
    netAssets: parsed.netAssets || null,
    cash: parsed.cash || null,
    employees: parsed.employees || null,
    rawText,
  };

  // 6. Cache on the CRM company record.
  const existingData = row.companies_house_data || {};
  await pool.query(
    `UPDATE crm_companies SET companies_house_data = $1 WHERE id = $2`,
    [JSON.stringify({ ...existingData, latestAccountsExtracted: result }), companyId]
  );

  return result;
}
