/**
 * Planning Documents scraper — pulls the full PDF list off an Idox Public
 * Access documents tab via ScraperAPI (residential proxy + JS-free render).
 *
 * Why the proxy: Westminster (and some other LPAs) TCP-block Railway's
 * egress IP, so direct fetches fail with UND_ERR_CONNECT_TIMEOUT. ScraperAPI
 * sits in the middle, rotates residential UK IPs, and returns the raw HTML.
 *
 * Shape of an Idox documents page:
 *   <table id="applicationDocumentsTable">
 *     <thead><tr>Date | Description | Type | Drawing No. | View</tr></thead>
 *     <tbody>
 *       <tr>
 *         <td>2024-05-20</td>
 *         <td>Proposed Ground Floor Plan</td>
 *         <td>Plans</td>
 *         <td>A-100 Rev B</td>
 *         <td><a href="/online-applications/files/ABC/plan.pdf">View</a></td>
 *       </tr>
 *       ...
 *     </tbody>
 *   </table>
 *
 * We parse this into categorised PlanningDoc entries (floor plan, elevation,
 * section, site plan, decision notice, statement etc) so the UI can group
 * them and the auto-download path can prioritise what's worth pulling into
 * the SharePoint pathway folder.
 */

const SCRAPERAPI_ENDPOINT = "https://api.scraperapi.com/";

import { webshareF, isProxyConfigured, isConnectionError } from "./proxy-fetch";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface PlanningDoc {
  url: string;
  date: string;           // YYYY-MM-DD (or original raw if unparseable)
  description: string;    // "Proposed Ground Floor Plan"
  type: string;           // "Plans" | "Correspondence" | "Photograph"
  drawingNumber?: string;
  category: string;       // machine: "floor_plan_proposed" | "elevation" | ...
  label: string;          // human-readable badge text
  downloadedUrl?: string; // SharePoint webUrl once auto-downloaded into the pathway folder
  downloadedName?: string;
}

// In-process cache — Idox docs for a decided application are effectively
// immutable, so 7d TTL on the docs-tab URL keeps ScraperAPI spend low.
const docCache = new Map<string, { fetchedAt: number; docs: PlanningDoc[] }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

// Architect drawing-number conventions often encode existing/proposed as a
// prefix or suffix (EX-100 / P-100 / 100(E) / 100 (P)). When a row's
// description is ambiguous ("Ground Floor Plan" with no existing/proposed
// qualifier), the drawing number is usually decisive.
function drawingNumberIntent(dn: string | undefined): "existing" | "proposed" | null {
  if (!dn) return null;
  const s = dn.toUpperCase().trim();
  // Prefix: EX-, E-, PR-, P-, PROP-
  if (/^(?:EX|E)[-_ ]?\d/.test(s)) return "existing";
  if (/^(?:PR|P|PROP)[-_ ]?\d/.test(s)) return "proposed";
  // Mid-token: ...-EX-... or ...-P-...
  if (/[-_ ](?:EX|EXIST|EXISTING)[-_ ]/.test(s)) return "existing";
  if (/[-_ ](?:PR|PROP|PROPOSED)[-_ ]/.test(s)) return "proposed";
  // Suffix markers: (E) / (P) / ends with EX / PR
  if (/\(E\)|[-_ ]E$|[-_ ]EX$/.test(s)) return "existing";
  if (/\(P\)|[-_ ]P$|[-_ ]PR$/.test(s)) return "proposed";
  return null;
}

function classifyDoc(desc: string, type: string, drawingNumber?: string): { category: string; label: string } {
  const s = `${desc} ${type}`.toLowerCase();
  if (/existing\b[^,;]*\bfloor\s*plan|existing\s*ground\s*floor|existing\s*first\s*floor|existing\s*plans?\b/.test(s)) return { category: "floor_plan_existing", label: "Floor Plan (Existing)" };
  if (/proposed\b[^,;]*\bfloor\s*plan|proposed\s*ground\s*floor|proposed\s*first\s*floor|proposed\s*plans?\b/.test(s)) return { category: "floor_plan_proposed", label: "Floor Plan (Proposed)" };

  // Promote ambiguous "Floor Plan" / "Elevation" based on drawing-number intent.
  const isFloorPlan = /floor\s*plan|ground\s*floor|first\s*floor|second\s*floor|basement\s*plan|roof\s*plan/.test(s);
  const isElevation = /elevation/.test(s);
  const isSection = /\bsection(s|al)?\b/.test(s) && !/section\s*\d+\s*(agreement|notice)|section\s*73/.test(s);
  if (isFloorPlan) {
    const intent = drawingNumberIntent(drawingNumber);
    if (intent === "existing") return { category: "floor_plan_existing", label: "Floor Plan (Existing)" };
    if (intent === "proposed") return { category: "floor_plan_proposed", label: "Floor Plan (Proposed)" };
    return { category: "floor_plan", label: "Floor Plan" };
  }
  if (isElevation) {
    const intent = drawingNumberIntent(drawingNumber);
    if (intent === "existing") return { category: "elevation_existing", label: "Elevation (Existing)" };
    if (intent === "proposed") return { category: "elevation_proposed", label: "Elevation (Proposed)" };
    return { category: "elevation", label: "Elevation" };
  }
  if (isSection) {
    const intent = drawingNumberIntent(drawingNumber);
    if (intent === "existing") return { category: "section_existing", label: "Section (Existing)" };
    if (intent === "proposed") return { category: "section_proposed", label: "Section (Proposed)" };
    return { category: "section", label: "Section" };
  }

  if (/site\s*(plan|location)|location\s*plan|block\s*plan|boundary\s*plan/.test(s)) return { category: "site_plan", label: "Site Plan" };
  if (/decision\s*notice|decision\s*letter|decision\s*report/.test(s)) return { category: "decision", label: "Decision Notice" };
  if (/officer.?s?\s*report|delegated\s*report/.test(s)) return { category: "officer_report", label: "Officer Report" };
  if (/design\s*and\s*access|d&a\s*statement|\bdas\b/.test(s)) return { category: "das", label: "Design & Access" };
  if (/heritage\s*statement|heritage\s*impact/.test(s)) return { category: "heritage", label: "Heritage Statement" };
  if (/planning\s*statement|supporting\s*statement/.test(s)) return { category: "planning_statement", label: "Planning Statement" };
  if (/application\s*form/.test(s)) return { category: "form", label: "Application Form" };
  if (/photograph|photo\b/.test(s)) return { category: "photo", label: "Photograph" };
  if (/cil\b|community\s*infrastructure/.test(s)) return { category: "cil", label: "CIL" };
  if (/correspondence|letter|email/.test(s)) return { category: "correspondence", label: "Correspondence" };
  return { category: "other", label: type || "Document" };
}

// Split a drawing number into (base, revision) so we can dedupe multiple
// revisions of the same drawing and keep only the latest. Architects encode
// revisions as " Rev A", " Rev.04", "_P02", " P03", trailing single-letter,
// etc. We're conservative — if we can't confidently extract a rev, we treat
// the whole string as the base (no dedup).
function parseRevision(dn: string | undefined): { base: string; rev: string } {
  if (!dn) return { base: "", rev: "" };
  const s = dn.trim();
  const m1 = s.match(/^(.+?)\s*[- _]?rev(?:ision)?\.?\s*([A-Z0-9]+)\s*$/i);
  if (m1) return { base: m1[1].trim(), rev: m1[2].toUpperCase() };
  const m2 = s.match(/^(.+?)[-_ ]P(\d{1,3})\s*$/i);
  if (m2) return { base: m2[1].trim(), rev: `P${m2[2].padStart(2, "0")}` };
  const m3 = s.match(/^(.+\d)([A-Z])\s*$/);
  if (m3) return { base: m3[1].trim(), rev: m3[2] };
  return { base: s, rev: "" };
}

function revOrder(rev: string): number {
  if (!rev) return -1;
  const m = rev.match(/^P(\d+)$/i);
  if (m) return 1000 + parseInt(m[1], 10);
  if (/^[A-Z]$/.test(rev)) return rev.charCodeAt(0) - 64; // A=1, B=2...
  const n = parseInt(rev, 10);
  return isNaN(n) ? 0 : n;
}

// Drop superseded rows and fold multi-rev drawings down to the latest rev.
// The Idox "type" column often flags this explicitly; fall back to
// description scan for "superseded".
function dedupeAndFilter(docs: PlanningDoc[]): PlanningDoc[] {
  const live = docs.filter((d) => {
    const hay = `${d.type} ${d.description}`.toLowerCase();
    return !/superseded|withdrawn\s*drawing|not\s*for\s*construction/.test(hay);
  });

  const bestByBase = new Map<string, PlanningDoc>();
  const keep: PlanningDoc[] = [];
  for (const d of live) {
    if (!d.drawingNumber) { keep.push(d); continue; }
    const { base, rev } = parseRevision(d.drawingNumber);
    if (!base || !rev) { keep.push(d); continue; }
    const key = `${d.category}::${base.toLowerCase()}`;
    const existing = bestByBase.get(key);
    if (!existing) {
      bestByBase.set(key, d);
    } else {
      const curRev = parseRevision(existing.drawingNumber).rev;
      if (revOrder(rev) > revOrder(curRev)) bestByBase.set(key, d);
    }
  }
  keep.push(...bestByBase.values());
  return keep;
}

function stripHtml(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDate(raw: string): string {
  const cleaned = (raw || "").trim();
  if (!cleaned) return "";
  // Try ISO first
  const iso = cleaned.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Try DD Mon YYYY / DD/MM/YYYY
  const d = new Date(cleaned);
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0];
  return cleaned;
}

function parseIdoxDocsHtml(html: string, baseUrl: string): PlanningDoc[] {
  const docs: PlanningDoc[] = [];

  // Scope to the documents table if we can find it — catches edge cases
  // where Idox pages include unrelated tables (nav, applicant details).
  const tableMatch = html.match(/<table[^>]*(?:id|class)="[^"]*(?:applicationDocuments|documents?Table|document-list)[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  const scope = tableMatch ? tableMatch[1] : html;

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(scope)) !== null) {
    const row = rowMatch[1];
    const cellMatches = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)];
    if (cellMatches.length < 2) continue;

    // Find a link in any cell — Idox usually puts the "View" link in the last cell.
    const linkMatch = row.match(/<a[^>]+href="([^"]+)"[^>]*>/i);
    if (!linkMatch) continue;
    const href = linkMatch[1].replace(/&amp;/g, "&");
    if (!/\.pdf(\?|$)|getFile|files?\/|documentId=|fileName=/i.test(href)) continue;

    let url: string;
    try {
      url = href.startsWith("http") ? href : new URL(href, baseUrl).toString();
    } catch {
      continue;
    }

    const cells = cellMatches.map((m) => stripHtml(m[1]));
    const [c0, c1, c2, c3] = cells;

    // Cells aren't always in the same order. Heuristics: date cell matches
    // date-like text; description is the longest non-date cell.
    const pickDate = cells.find((c) => /^\s*\d{1,2}[\s\/-][A-Za-z0-9]{2,10}[\s\/-]\d{2,4}\s*$|^\s*\d{4}-\d{2}-\d{2}\s*$/.test(c));
    const date = parseDate(pickDate || c0 || "");
    const descCell = cells.find((c) => c && c !== pickDate && c.length > 3 && !/^view$/i.test(c)) || c1 || "";
    const description = descCell;
    const type = (cells.find((c) => c && c !== description && c !== pickDate && c.length < 40 && !/^view$/i.test(c)) || c2 || "").slice(0, 80);
    const drawingNumber = (c3 && c3 !== description && c3 !== type && c3.length < 40) ? c3 : undefined;

    if (!description) continue;

    const { category, label } = classifyDoc(description, type, drawingNumber);
    docs.push({ url, date, description, type, drawingNumber, category, label });
  }

  return dedupeAndFilter(docs);
}

// The planning apps list gives us a URL pointing at the summary tab (activeTab=summary
// or no activeTab). The documents tab lives at the same endpoint with
// activeTab=documents. Normalise whatever we have into the docs-tab URL.
export function docsTabUrl(urlOrNull: string | null | undefined): string {
  if (!urlOrNull) return "";
  try {
    const u = new URL(urlOrNull);
    if (!/applicationDetails\.do$/i.test(u.pathname)) return urlOrNull;
    u.searchParams.set("activeTab", "documents");
    return u.toString();
  } catch {
    return urlOrNull;
  }
}

async function fetchDocsHtml(docsUrl: string): Promise<string | null> {
  const baseInit = {
    headers: {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-GB,en;q=0.9",
    },
    redirect: "follow" as const,
  };

  // Tier 1: direct fetch (works for most non-Westminster Idox portals)
  try {
    const res = await fetch(docsUrl, {
      ...baseInit,
      signal: AbortSignal.timeout(isProxyConfigured() ? 8000 : 15000),
    });
    if (res.ok) return await res.text();
    if (res.status >= 400 && res.status < 500) return null; // auth/not-found — proxy won't help
    console.warn(`[planning-docs] direct ${res.status} for ${docsUrl}`);
  } catch (err: unknown) {
    if (!isConnectionError(err)) {
      console.warn(`[planning-docs] direct error: ${(err as any)?.message}`);
    } else {
      console.log(`[planning-docs] direct blocked — escalating`);
    }
  }

  // Tier 2: Webshare residential proxy
  if (isProxyConfigured()) {
    try {
      const res = await webshareF(docsUrl, {
        ...baseInit,
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) {
        console.log(`[planning-docs] via proxy: ${docsUrl.replace(/^https?:\/\//, "").split("?")[0]}`);
        return await res.text();
      }
      console.warn(`[planning-docs] proxy ${res.status}`);
    } catch (err: unknown) {
      console.warn(`[planning-docs] proxy failed: ${(err as any)?.message}`);
    }
  }

  // Tier 3: ScraperAPI (if key configured)
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) return null;
  try {
    const proxied = `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(docsUrl)}&country_code=uk&render=false`;
    const res = await fetch(proxied, { signal: AbortSignal.timeout(45000) });
    if (res.ok) {
      console.log(`[planning-docs] via ScraperAPI: ${docsUrl.replace(/^https?:\/\//, "").split("?")[0]}`);
      return await res.text();
    }
    console.warn(`[planning-docs] ScraperAPI ${res.status}`);
    return null;
  } catch (err: unknown) {
    console.warn(`[planning-docs] ScraperAPI failed: ${(err as any)?.message}`);
    return null;
  }
}

export async function fetchPlanningDocs(rawUrl: string): Promise<PlanningDoc[]> {
  const docsUrl = docsTabUrl(rawUrl);
  if (!docsUrl) return [];

  const cached = docCache.get(docsUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.docs;
  }

  if (!process.env.SCRAPERAPI_KEY && !isProxyConfigured()) {
    if (!(globalThis as any).__planningDocsKeyWarned) {
      console.warn("[planning-docs] No SCRAPERAPI_KEY and no Webshare proxy — document scraping limited to non-blocked portals");
      (globalThis as any).__planningDocsKeyWarned = true;
    }
  }

  try {
    const html = await fetchDocsHtml(docsUrl);
    if (!html) return [];
    const docs = parseIdoxDocsHtml(html, docsUrl);
    docCache.set(docsUrl, { fetchedAt: Date.now(), docs });
    console.log(`[planning-docs] ${docsUrl.replace(/^https?:\/\//, "").split("?")[0]} → ${docs.length} docs`);
    return docs;
  } catch (err: any) {
    console.warn(`[planning-docs] fetch failed for ${docsUrl}: ${err?.message}`);
    return [];
  }
}

// Priority order for auto-download into the pathway SharePoint folder.
export const DOC_PRIORITY: Record<string, number> = {
  floor_plan_proposed: 100,
  floor_plan_existing: 95,
  floor_plan: 90,
  elevation_proposed: 85,
  elevation_existing: 82,
  elevation: 80,
  section_proposed: 75,
  section_existing: 72,
  section: 70,
  site_plan: 60,
  decision: 50,
  officer_report: 45,
  das: 30,
  heritage: 25,
  planning_statement: 20,
  form: 10,
  photo: 5,
  correspondence: 3,
  cil: 3,
  other: 1,
};

export function sortDocsByPriority(docs: PlanningDoc[]): PlanningDoc[] {
  return [...docs].sort((a, b) => (DOC_PRIORITY[b.category] || 0) - (DOC_PRIORITY[a.category] || 0));
}

/**
 * Download a single planning-application PDF via ScraperAPI.
 * Idox instances block Railway IPs directly and often serve an HTML viewer
 * page, a login wall, or an error page rather than the raw PDF bytes. We
 * try four strategies in order, returning the first that yields PDF magic
 * bytes. Writes a short `lastError` so callers can surface what happened.
 *
 * Returns the PDF bytes, or null with details written to result.lastError.
 */
let lastDownloadError = "";
export function getPlanningDownloadLastError(): string { return lastDownloadError; }

export async function downloadPlanningPdf(url: string, refererUrl?: string): Promise<Buffer | null> {
  lastDownloadError = "";

  const isPdfBuffer = (buf: Buffer): boolean =>
    buf.length >= 1024 && buf.slice(0, 4).toString("latin1") === "%PDF";

  // Strategy 0: Webshare two-step session — establish JSESSIONID by browsing
  // the app documents tab first, then fetch the PDF with that cookie.
  // This mirrors what a human browser does and is required by Westminster Idox.
  if (isProxyConfigured() && refererUrl) {
    try {
      // Step 1: GET the documents tab page via Webshare — Idox sets JSESSIONID
      const sessionRes = await webshareF(refererUrl, {
        headers: {
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-GB,en;q=0.9",
        },
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });
      // undici uses getSetCookie() for multiple Set-Cookie headers (not .get())
      const rawHeaders = (sessionRes as any).headers;
      let sessionCookie = "";
      if (typeof rawHeaders?.getSetCookie === "function") {
        sessionCookie = rawHeaders.getSetCookie()
          .map((h: string) => h.split(";")[0].trim()).filter(Boolean).join("; ");
      } else {
        const combined = rawHeaders?.get?.("set-cookie") || "";
        sessionCookie = combined.split(/,(?=\s*[A-Za-z0-9_-]+=)/)
          .map((p: string) => p.split(";")[0].trim()).filter(Boolean).join("; ");
      }

      if (sessionCookie) {
        // Step 2: GET the PDF with the session cookie + Referer
        const pdfRes = await webshareF(url, {
          headers: {
            "User-Agent": BROWSER_UA,
            Accept: "application/pdf,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
            Referer: refererUrl,
            Cookie: sessionCookie,
          },
          signal: AbortSignal.timeout(30000),
          redirect: "follow",
        });
        if (pdfRes.ok) {
          const buf = Buffer.from(await pdfRes.arrayBuffer());
          if (isPdfBuffer(buf)) {
            console.log(`[planning-docs] Webshare session download OK: ${url}`);
            return buf;
          }
          console.warn(`[planning-docs] Webshare session got non-PDF (${buf.length}B)`);
        } else {
          console.warn(`[planning-docs] Webshare session PDF fetch ${pdfRes.status}`);
        }
      } else {
        console.warn(`[planning-docs] Webshare session: no JSESSIONID in Set-Cookie`);
      }
    } catch (err: any) {
      console.warn(`[planning-docs] Webshare session strategy failed: ${err?.message}`);
    }
  }

  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) {
    lastDownloadError = "SCRAPERAPI_KEY not configured and Webshare session failed";
    return null;
  }

  const tryFetch = async (label: string, scraperUrl: string, timeoutMs: number): Promise<Buffer | null> => {
    try {
      const res = await fetch(scraperUrl, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (!res.ok) {
        lastDownloadError = `${label} returned HTTP ${res.status}`;
        console.warn(`[planning-docs] ${label} ${res.status} for ${url}`);
        return null;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (isPdfBuffer(buf)) return buf;
      // If HTML, look for an embedded PDF URL (iframe, object, meta refresh,
      // or window.location.href =) that we can retry on.
      const head = buf.slice(0, 32768).toString("utf8");
      const embedded = extractEmbeddedPdfUrl(head, url);
      if (embedded && embedded !== url) {
        console.log(`[planning-docs] ${label} returned HTML — retrying embedded URL ${embedded}`);
        const retryUrl = `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(embedded)}&country_code=uk&render=false`;
        const retryRes = await fetch(retryUrl, { signal: AbortSignal.timeout(25000), redirect: "follow" });
        if (retryRes.ok) {
          const retryBuf = Buffer.from(await retryRes.arrayBuffer());
          if (isPdfBuffer(retryBuf)) return retryBuf;
        }
      }
      lastDownloadError = `${label} returned non-PDF (${buf.length}B, content looked like HTML)`;
      console.warn(`[planning-docs] ${label} ${url} returned non-PDF (${buf.length}B)`);
      return null;
    } catch (err: any) {
      lastDownloadError = `${label} threw: ${err?.message || "unknown"}`;
      console.warn(`[planning-docs] ${label} failed ${url}: ${err?.message}`);
      return null;
    }
  };

  // Strategy 1: cheapest — no JS rendering. Works for direct .pdf URLs.
  const s1 = await tryFetch("no-render", `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}&country_code=uk&render=false`, 25000);
  if (s1) return s1;

  // Strategy 2: premium proxy (residential IPs).
  const s2 = await tryFetch("premium", `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}&country_code=uk&premium=true&render=false`, 30000);
  if (s2) return s2;

  // Strategy 3: JS rendering for viewer-page redirects.
  const s3 = await tryFetch("render", `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}&country_code=uk&render=true`, 45000);
  if (s3) return s3;

  // Strategy 4: premium + render. Slow but handles JS-gated + IP-gated Idox.
  const s4 = await tryFetch("premium+render", `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(url)}&country_code=uk&premium=true&render=true`, 60000);
  if (s4) return s4;

  return null;
}

// Given an HTML head snippet and the original URL we were asked to fetch,
// look for an embedded PDF URL (common Idox patterns). Resolved relative
// to the original URL if relative.
function extractEmbeddedPdfUrl(html: string, baseUrl: string): string | null {
  const patterns = [
    /<iframe[^>]+src=["']([^"']+\.pdf[^"']*)["']/i,
    /<object[^>]+data=["']([^"']+\.pdf[^"']*)["']/i,
    /<embed[^>]+src=["']([^"']+\.pdf[^"']*)["']/i,
    /window\.location(?:\.href)?\s*=\s*["']([^"']+\.pdf[^"']*)["']/i,
    /<meta[^>]+http-equiv=["']refresh["'][^>]+url=([^"'>\s]+\.pdf[^"'>\s]*)/i,
    /href=["']([^"']+\/documents\.do\?[^"']+)["']/i,  // Idox doc proxy URL
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) {
      try { return new URL(m[1], baseUrl).toString(); } catch {}
    }
  }
  return null;
}

/**
 * Shortlist the highest-value drawings across recent applications.
 * Picks proposed floor plans + elevations first, then existing, then
 * sections — up to `maxPerApp` per app and `totalCap` overall.
 */
export function pickDrawingsToDownload(
  apps: Array<{ ref: string; docs: PlanningDoc[] }>,
  opts: { maxPerApp?: number; totalCap?: number } = {},
): Array<{ ref: string; doc: PlanningDoc }> {
  const maxPerApp = opts.maxPerApp ?? 6;
  const totalCap = opts.totalCap ?? 15;
  const drawingCats = new Set([
    "floor_plan_proposed", "floor_plan_existing", "floor_plan",
    "elevation_proposed", "elevation_existing", "elevation",
    "section_proposed", "section_existing", "section",
    "site_plan",
  ]);
  const out: Array<{ ref: string; doc: PlanningDoc }> = [];
  for (const app of apps) {
    const sorted = sortDocsByPriority(app.docs).filter(d => drawingCats.has(d.category));
    // Dedupe by base drawing number within an app — the latest revision
    // wins (we already took the most-recent-first ordering from parse step).
    const seen = new Set<string>();
    let added = 0;
    for (const d of sorted) {
      const base = (d.drawingNumber || d.description).replace(/\s*\(?\s*(rev|r)\s*[a-z0-9]+\)?\s*$/i, "").toLowerCase().trim();
      if (seen.has(base)) continue;
      seen.add(base);
      out.push({ ref: app.ref, doc: d });
      added++;
      if (added >= maxPerApp) break;
      if (out.length >= totalCap) break;
    }
    if (out.length >= totalCap) break;
  }
  return out;
}
