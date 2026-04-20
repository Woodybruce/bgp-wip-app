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

export interface PlanningDoc {
  url: string;
  date: string;           // YYYY-MM-DD (or original raw if unparseable)
  description: string;    // "Proposed Ground Floor Plan"
  type: string;           // "Plans" | "Correspondence" | "Photograph"
  drawingNumber?: string;
  category: string;       // machine: "floor_plan_proposed" | "elevation" | ...
  label: string;          // human-readable badge text
}

// In-process cache — Idox docs for a decided application are effectively
// immutable, so 7d TTL on the docs-tab URL keeps ScraperAPI spend low.
const docCache = new Map<string, { fetchedAt: number; docs: PlanningDoc[] }>();
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function classifyDoc(desc: string, type: string): { category: string; label: string } {
  const s = `${desc} ${type}`.toLowerCase();
  if (/existing\b[^,;]*\bfloor\s*plan|existing\s*ground\s*floor|existing\s*first\s*floor|existing\s*plans?\b/.test(s)) return { category: "floor_plan_existing", label: "Floor Plan (Existing)" };
  if (/proposed\b[^,;]*\bfloor\s*plan|proposed\s*ground\s*floor|proposed\s*first\s*floor|proposed\s*plans?\b/.test(s)) return { category: "floor_plan_proposed", label: "Floor Plan (Proposed)" };
  if (/floor\s*plan|ground\s*floor|first\s*floor|second\s*floor|basement\s*plan|roof\s*plan/.test(s)) return { category: "floor_plan", label: "Floor Plan" };
  if (/elevation/.test(s)) return { category: "elevation", label: "Elevation" };
  if (/\bsection(s|al)?\b/.test(s) && !/section\s*\d+\s*(agreement|notice)|section\s*73/.test(s)) return { category: "section", label: "Section" };
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

    const { category, label } = classifyDoc(description, type);
    docs.push({ url, date, description, type, drawingNumber, category, label });
  }

  return docs;
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

export async function fetchPlanningDocs(rawUrl: string): Promise<PlanningDoc[]> {
  const docsUrl = docsTabUrl(rawUrl);
  if (!docsUrl) return [];
  const apiKey = process.env.SCRAPERAPI_KEY;
  if (!apiKey) {
    // First-run diagnostic — only warn once per process
    if (!(globalThis as any).__planningDocsKeyWarned) {
      console.warn("[planning-docs] SCRAPERAPI_KEY not set — per-application PDF scraping disabled");
      (globalThis as any).__planningDocsKeyWarned = true;
    }
    return [];
  }

  const cached = docCache.get(docsUrl);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.docs;
  }

  try {
    const proxied = `${SCRAPERAPI_ENDPOINT}?api_key=${encodeURIComponent(apiKey)}&url=${encodeURIComponent(docsUrl)}&country_code=uk&render=false`;
    const res = await fetch(proxied, { signal: AbortSignal.timeout(45000) });
    if (!res.ok) {
      console.warn(`[planning-docs] ScraperAPI ${res.status} for ${docsUrl}`);
      return [];
    }
    const html = await res.text();
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
  elevation: 80,
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
