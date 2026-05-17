// Landlord-website scraper.
//
// Drills the *right* paths on a landlord's site with JS rendering on, then
// asks Haiku to extract the structured intel BGP actually cares about:
//   - share_ticker (for PLCs) — e.g. "LSE: LAND" for Land Sec
//   - logo_url
//   - investor-relations contact (name, email, phone)
//   - annual report PDF link
//   - board / senior leadership
//   - asset list (name, address, postcode, sector)
//
// The brand-scraper next door only probes /careers /press — useless on a
// landlord site, where the gold sits at /portfolio /our-places /investors.
// This module exists so we can stop pretending landlords are brands.
//
// Each landlord scrape costs ~6 ScraperAPI calls (render:true is paid) +
// 1 Haiku call (~5k input tokens). Findings live in their own table so
// the existing crm_companies row stays clean; the brand-profile endpoint
// pulls the latest snapshot in on read.

import { pool } from "./db";
import { scraperFetch, isScraperApiAvailable } from "./utils/scraperapi";
import { callClaude, safeParseJSON, CHATBGP_HELPER_MODEL } from "./utils/anthropic-client";

// Paths likely to hold landlord-specific intel. Probed in parallel. Each
// path that returns >200 chars of text is fed into the AI prompt. We
// cap at 6 to keep ScraperAPI cost predictable.
const LANDLORD_PATHS = [
  "/",
  "/portfolio",
  "/our-properties",
  "/our-portfolio",
  "/our-places",          // Land Sec's path
  "/assets",
  "/investments",
  "/investors",
  "/investors/investors-overview",
  "/about",
  "/about/board",
  "/media",
  "/media-centre",
  "/sustainability",
];

let _tableEnsured = false;
async function ensureTable() {
  if (_tableEnsured) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS landlord_website_findings (
      company_id TEXT PRIMARY KEY,
      scraped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      source_urls JSONB,
      logo_url TEXT,
      share_ticker TEXT,
      ir_contact JSONB,
      board_members JSONB,
      annual_report_url TEXT,
      properties JSONB,
      raw_notes TEXT,
      error TEXT
    )
  `);
  _tableEnsured = true;
}

interface LandlordFindings {
  source_urls: Array<{ url: string; status: number; bytes: number }>;
  logo_url: string | null;
  share_ticker: string | null;
  ir_contact: { name?: string; email?: string; phone?: string; role?: string } | null;
  board_members: Array<{ name: string; role?: string }>;
  annual_report_url: string | null;
  properties: Array<{ name: string; address?: string; postcode?: string; sector?: string }>;
  raw_notes: string | null;
}

// Strip an HTML page to clean-ish text + the first 20 links — keeps the
// AI prompt cheap. We don't need the full markup, just the visible text
// + a hint of structure (links survive so the AI can fish out PDF
// downloads / investor pages).
function condenseHtml(html: string, baseUrl: string, maxChars = 12000): string {
  if (!html) return "";
  // 1. Pull og:image early in case the body strip nukes it.
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] || "";
  // 2. Surface up to 30 links so the AI can spot investor PDF / asset
  //    detail pages even if they're nav-only.
  const links: string[] = [];
  const linkRe = /<a\b[^>]*?href=["']([^"']+)["'][^>]*>([^<]{1,80})<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) && links.length < 30) {
    const href = m[1];
    const label = m[2].trim().replace(/\s+/g, " ");
    if (!label) continue;
    if (/^(#|javascript:)/i.test(href)) continue;
    let abs = href;
    try { abs = new URL(href, baseUrl).toString(); } catch { continue; }
    links.push(`${label} → ${abs}`);
  }
  // 3. Strip scripts/styles, collapse markup → text.
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
  return `og:image=${og}\nLinks:\n${links.join("\n")}\n\nVisible text:\n${text}`;
}

function buildPrompt(landlordName: string, domain: string, pages: Array<{ url: string; text: string }>): string {
  const pageBlocks = pages
    .map((p, i) => `--- PAGE ${i + 1}: ${p.url} ---\n${p.text}`)
    .join("\n\n");

  return `You are extracting structured intel from a UK commercial landlord's website for a property brokerage's CRM.

Landlord: ${landlordName}
Domain: ${domain}

I've fetched ${pages.length} pages from their site (rendered with JavaScript). Pull out:

1. **share_ticker** — if they're a listed PLC, the exchange + ticker (e.g. "LSE: LAND" for Land Sec). Null if private.
2. **logo_url** — the absolute URL of their primary logo. Prefer og:image if relevant; otherwise a visible <img>.
3. **ir_contact** — investor-relations contact: { name, email, phone, role }. Only fill in fields you actually see; omit fields not present.
4. **board_members** — array of senior leadership / board members visible on the site: [{ name, role }]. Cap at 12.
5. **annual_report_url** — direct URL to the most recent annual report PDF. Look in the investor section for "annual report" / "results" PDFs.
6. **properties** — array of properties / assets they own, each: { name, address (optional), postcode (optional), sector (retail / office / mixed / residential / industrial / leisure / hotel) }. Pull every named asset you can find; for a big REIT this might be 20-100+ items.
7. **raw_notes** — 1-2 sentence summary of anything else interesting (e.g. "Disposed of Bluewater stake Apr 2025", "Pivoting to BTR").

Return ONLY a JSON object with these exact keys. No markdown, no preamble. Use null for fields you can't find; use [] for empty arrays.

${pageBlocks}`;
}

let progress: Record<string, { state: string; updatedAt: string; result?: any; error?: string }> = {};

export function getLandlordScrapeProgress(companyId: string) {
  return progress[companyId] || { state: "idle", updatedAt: "" };
}

export async function scrapeLandlordWebsite(companyId: string): Promise<{ ok: boolean; findings?: LandlordFindings; error?: string }> {
  await ensureTable();

  const { rows } = await pool.query<{ id: string; name: string; domain: string | null; domain_url: string | null }>(
    `SELECT id, name, domain, domain_url FROM crm_companies WHERE id = $1`,
    [companyId]
  );
  const company = rows[0];
  if (!company) return { ok: false, error: "company not found" };
  if (!isScraperApiAvailable()) return { ok: false, error: "ScraperAPI not configured" };

  // Resolve to a single canonical https:// root for path probing.
  const raw = (company.domain_url || company.domain || "").trim();
  if (!raw) return { ok: false, error: "no domain" };
  let root = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
  if (!root) return { ok: false, error: "domain unparseable" };
  const baseUrl = `https://${root}`;

  progress[companyId] = { state: "fetching", updatedAt: new Date().toISOString() };

  // Probe paths in parallel with render:true. We don't bail early on
  // 404s — landlord sites have idiosyncratic IA (Land Sec uses
  // /our-places, others /portfolio, others /assets). Let the AI sort
  // the wheat from the chaff at the end.
  const fetched: Array<{ url: string; status: number; bytes: number; text: string }> = [];
  await Promise.all(LANDLORD_PATHS.slice(0, 8).map(async (path) => {
    const url = `${baseUrl}${path}`;
    try {
      const res = await scraperFetch(url, { uk: true, render: true, timeoutMs: 45000 });
      if (!res.ok) {
        fetched.push({ url, status: res.status, bytes: 0, text: "" });
        return;
      }
      const html = await res.text().catch(() => "");
      const text = condenseHtml(html, url, 10000);
      fetched.push({ url, status: 200, bytes: html.length, text });
    } catch (err: any) {
      fetched.push({ url, status: 0, bytes: 0, text: "" });
    }
  }));

  const usable = fetched.filter(p => p.text.length > 400);
  if (usable.length === 0) {
    progress[companyId] = { state: "error", updatedAt: new Date().toISOString(), error: "all pages 404'd or empty" };
    await pool.query(
      `INSERT INTO landlord_website_findings (company_id, source_urls, error)
       VALUES ($1, $2, $3)
       ON CONFLICT (company_id) DO UPDATE SET scraped_at = NOW(), source_urls = $2, error = $3`,
      [companyId, JSON.stringify(fetched.map(f => ({ url: f.url, status: f.status, bytes: f.bytes }))), "no usable pages"]
    );
    return { ok: false, error: "no usable pages — site might block scraping or pages don't exist at common paths" };
  }

  progress[companyId] = { state: "extracting", updatedAt: new Date().toISOString() };

  const prompt = buildPrompt(company.name, root, usable.map(p => ({ url: p.url, text: p.text })));

  let aiOut: any = null;
  try {
    const completion = await callClaude({
      model: CHATBGP_HELPER_MODEL,
      max_completion_tokens: 4000,
      messages: [{ role: "user", content: prompt }],
    });
    const text = completion?.choices?.[0]?.message?.content || completion?.text || "";
    aiOut = safeParseJSON(text);
  } catch (err: any) {
    progress[companyId] = { state: "error", updatedAt: new Date().toISOString(), error: `AI extraction failed: ${err?.message}` };
    return { ok: false, error: err?.message || "AI extraction failed" };
  }

  const findings: LandlordFindings = {
    source_urls: fetched.map(f => ({ url: f.url, status: f.status, bytes: f.bytes })),
    logo_url: aiOut?.logo_url || null,
    share_ticker: aiOut?.share_ticker || null,
    ir_contact: aiOut?.ir_contact || null,
    board_members: Array.isArray(aiOut?.board_members) ? aiOut.board_members.slice(0, 12) : [],
    annual_report_url: aiOut?.annual_report_url || null,
    properties: Array.isArray(aiOut?.properties) ? aiOut.properties.slice(0, 200) : [],
    raw_notes: aiOut?.raw_notes || null,
  };

  await pool.query(
    `INSERT INTO landlord_website_findings
       (company_id, source_urls, logo_url, share_ticker, ir_contact,
        board_members, annual_report_url, properties, raw_notes, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL)
     ON CONFLICT (company_id) DO UPDATE SET
       scraped_at = NOW(),
       source_urls = $2,
       logo_url = $3,
       share_ticker = $4,
       ir_contact = $5,
       board_members = $6,
       annual_report_url = $7,
       properties = $8,
       raw_notes = $9,
       error = NULL`,
    [
      companyId,
      JSON.stringify(findings.source_urls),
      findings.logo_url,
      findings.share_ticker,
      JSON.stringify(findings.ir_contact),
      JSON.stringify(findings.board_members),
      findings.annual_report_url,
      JSON.stringify(findings.properties),
      findings.raw_notes,
    ]
  );

  // Side effect: backfill stock_ticker on crm_companies if we don't
  // have one already. Side effects kept minimal — anything more
  // ambitious (auto-creating contacts from board_members, importing
  // properties as CRM rows) needs a human in the loop.
  if (findings.share_ticker) {
    await pool.query(
      `UPDATE crm_companies SET stock_ticker = $1
        WHERE id = $2 AND (stock_ticker IS NULL OR stock_ticker = '')`,
      [findings.share_ticker, companyId]
    ).catch(() => {});
  }

  // Auto-link clear-obvious matches to existing CRM properties. Strict
  // policy: only link on (a) exact normalised-name match or (b) exact
  // postcode match. Anything fuzzier surfaces in the UI as a candidate
  // for human review. The exact-name rule catches Bluewater / Gunwharf
  // Quays / Trinity Kitchen reliably without the false-positive risk
  // we hit on the CH name-search.
  await autoLinkScrapedProperties(companyId, findings.properties);

  progress[companyId] = { state: "done", updatedAt: new Date().toISOString(), result: findings };
  return { ok: true, findings };
}

// Normalise a property name for matching. Strips common suffixes
// ("shopping centre", "Limited", "Plc"), punctuation, the/and, and
// collapses whitespace. So "Bluewater Shopping Centre" and "Bluewater"
// both reduce to "bluewater"; "St David's Dewi Sant" reduces to "st
// davids dewi sant" and matches "St. David's Dewi Sant" in CRM.
function normalisePropertyName(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw)
    .toLowerCase()
    .replace(/[''`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(shopping centre|retail park|business park|outlet centre|the|and|plc|limited|ltd|llp)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalisePostcode(raw: string | null | undefined): string {
  if (!raw) return "";
  return String(raw).toUpperCase().replace(/\s+/g, "");
}

// Auto-link scraped properties to existing crm_properties rows when
// there's a clear-obvious match. Two strategies in order:
//   1. Normalised-name exact match — strongest signal, low false-positive
//      rate for big assets ("Bluewater", "Gunwharf Quays", "Trinity Kitchen").
//   2. Exact postcode match — covers the cases where the landlord
//      brands the property differently to the CRM ("St David's Cardiff"
//      vs "St. David's Dewi Sant").
// Only links when the CRM row currently has no landlord_id, so we never
// clobber an existing assignment. Returns the number of links written.
export async function autoLinkScrapedProperties(
  companyId: string,
  scraped: Array<{ name: string; address?: string; postcode?: string; sector?: string }>,
): Promise<number> {
  if (!scraped || scraped.length === 0) return 0;
  // Pull unlinked CRM properties once — cheaper than a per-scrape query.
  const { rows: unlinked } = await pool.query<{ id: string; name: string; postcode: string | null }>(
    `SELECT id, name, postcode FROM crm_properties
      WHERE landlord_id IS NULL OR landlord_id = ''`
  );
  if (unlinked.length === 0) return 0;

  const byName = new Map<string, string>();      // normalised name → CRM id
  const byPostcode = new Map<string, string>();  // normalised postcode → CRM id
  for (const row of unlinked) {
    const n = normalisePropertyName(row.name);
    if (n) byName.set(n, row.id);
    const p = normalisePostcode(row.postcode);
    if (p) byPostcode.set(p, row.id);
  }

  let linked = 0;
  for (const item of scraped) {
    let crmId: string | undefined;
    const nameKey = normalisePropertyName(item.name);
    if (nameKey) crmId = byName.get(nameKey);
    if (!crmId) {
      const pcKey = normalisePostcode(item.postcode);
      if (pcKey) crmId = byPostcode.get(pcKey);
    }
    if (!crmId) continue;
    const { rowCount } = await pool.query(
      `UPDATE crm_properties SET landlord_id = $1
        WHERE id = $2 AND (landlord_id IS NULL OR landlord_id = '')`,
      [companyId, crmId]
    );
    if ((rowCount ?? 0) > 0) {
      linked++;
      // Burn this CRM id from the lookup tables so two scraped names
      // can't both win the same CRM row in a single pass.
      byName.delete(nameKey);
      const pc = normalisePostcode(item.postcode);
      if (pc) byPostcode.delete(pc);
    }
  }
  return linked;
}

// Create a new crm_properties row from a scraped property record,
// pre-linked to this landlord. Address goes in as a JSONB shell so the
// existing property views render it.
export async function createPropertyFromScraped(
  companyId: string,
  item: { name: string; address?: string; postcode?: string; sector?: string },
): Promise<{ id: string }> {
  const addr = item.address || item.postcode ? { formatted: item.address || null, postcode: item.postcode || null } : null;
  const assetClass = item.sector ? item.sector.charAt(0).toUpperCase() + item.sector.slice(1).toLowerCase() : null;
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO crm_properties (name, postcode, address, landlord_id, asset_class)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id`,
    [item.name, item.postcode || null, addr ? JSON.stringify(addr) : null, companyId, assetClass]
  );
  return { id: rows[0].id };
}

export async function getLandlordFindings(companyId: string): Promise<LandlordFindings & { scraped_at: string } | null> {
  await ensureTable();
  const { rows } = await pool.query(
    `SELECT scraped_at, source_urls, logo_url, share_ticker, ir_contact,
            board_members, annual_report_url, properties, raw_notes, error
       FROM landlord_website_findings WHERE company_id = $1`,
    [companyId]
  );
  if (rows.length === 0) return null;
  return rows[0] as any;
}

// Weekly cron entry: scrape every landlord-shaped company that has a
// domain and either no findings yet OR findings older than 14 days.
// Throttled to 1 brand every 30s so an unlucky day doesn't blow
// through the ScraperAPI render budget.
export async function runWeeklyLandlordScrape(opts: { limit?: number } = {}): Promise<{ attempted: number; succeeded: number; failed: number }> {
  await ensureTable();
  const limit = opts.limit ?? 50;
  const { rows } = await pool.query<{ id: string; name: string }>(
    `SELECT c.id, c.name
       FROM crm_companies c
       LEFT JOIN landlord_website_findings f ON f.company_id = c.id
      WHERE c.merged_into_id IS NULL
        AND (c.domain IS NOT NULL OR c.domain_url IS NOT NULL)
        AND (
          LOWER(COALESCE(c.company_type, '')) ~ '(landlord|investor|developer|reit|fund)'
        )
        AND (f.scraped_at IS NULL OR f.scraped_at < NOW() - INTERVAL '14 days')
      ORDER BY f.scraped_at ASC NULLS FIRST
      LIMIT $1`,
    [limit]
  );
  let succeeded = 0, failed = 0;
  for (const row of rows) {
    try {
      const r = await scrapeLandlordWebsite(row.id);
      if (r.ok) succeeded++; else failed++;
    } catch {
      failed++;
    }
    await new Promise(r => setTimeout(r, 30_000));
  }
  return { attempted: rows.length, succeeded, failed };
}
