// Auto-fetch the latest set of accounts for a CRM company from Companies House.
//
// Flow per company (must have companies_house_number):
//   1. GET /company/{n}/filing-history?category=accounts&items_per_page=10
//      and take the most recent item.
//   2. Extract its document_metadata UUID (last path segment of links.document_metadata).
//   3. If this UUID matches the stored last_accounts_doc_id, no-op — we
//      already have it.
//   4. Otherwise GET the PDF via the document-api subdomain, save it into
//      file_storage under ch-accounts/{companyId}/{docId}.pdf, and write
//      the metadata back to crm_companies.
//
// Failure modes that count as "skip, don't error":
//   - Company has no CH number → there's nothing to fetch
//   - Most recent accounts filing has no document_metadata (rare —
//     usually means the filing was paper-only and CH never digitised it)
//   - PDF endpoint 404s for a known doc — happens for very old filings;
//     log + continue rather than aborting the bulk run.
import { pool } from "./db";
import { chFetch } from "./companies-house";
import { saveFile } from "./file-storage";

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

  // 1. Filing history filtered to accounts. CH returns items date-desc.
  const history = await chFetch(
    `/company/${encodeURIComponent(row.companies_house_number)}/filing-history?category=accounts&items_per_page=10`
  );
  const items: any[] = history?.items || [];
  if (items.length === 0) return { status: "skipped", reason: "no accounts filings on CH" };

  const latest = items[0];
  const docId = extractDocId(latest?.links?.document_metadata);
  if (!docId) return { status: "skipped", reason: "latest filing has no document_metadata" };

  // 2. Already up to date? Same doc_id → already downloaded.
  if (row.last_accounts_doc_id === docId) {
    return { status: "up_to_date", docId, madeUpTo: latest?.description_values?.made_up_date || null };
  }

  // 3. Download the PDF via the CH document API.
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

  const madeUpTo: string | null = latest?.description_values?.made_up_date || null;

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
