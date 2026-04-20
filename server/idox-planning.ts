/**
 * Idox Public Access scraper for LPA planning data.
 *
 * Most London LPAs (Westminster, Camden, K&C, Hackney, Islington,
 * Hammersmith & Fulham, Tower Hamlets, Lambeth) run the same Idox
 * Public Access product, so one parser covers all of them.
 *
 * We hit the "simple search" results page, which accepts a postcode
 * or address string and returns a list of applications. Results HTML
 * follows a stable `<li class="searchresult">` template across councils.
 *
 * No auth, no keys — public site, but we keep the request volume low,
 * throttle between councils, and cache results for 12h.
 */

// Postcode outward code → LPA host. Covers the central-London councils
// most likely to appear in BGP's pipeline. Add more as we expand.
const LPA_REGISTRY: Array<{ prefixes: string[]; name: string; host: string }> = [
  { prefixes: ["W1", "SW1", "WC1", "WC2", "NW1", "NW8"], name: "Westminster", host: "idoxpa.westminster.gov.uk" },
  { prefixes: ["SW3", "SW5", "SW7", "SW10", "W8", "W10", "W11", "W14"], name: "Kensington & Chelsea", host: "www.rbkc.gov.uk" }, // K&C uses a slightly different Idox deployment; may need override
  { prefixes: ["NW3", "NW5", "N6", "N7", "WC1", "WC2"], name: "Camden", host: "accountforms.camden.gov.uk" },
  { prefixes: ["N1", "EC1"], name: "Islington", host: "planning.islington.gov.uk" },
  { prefixes: ["E1", "E2", "E3", "E14"], name: "Tower Hamlets", host: "development.towerhamlets.gov.uk" },
  { prefixes: ["SE1", "SE11", "SW2", "SW4", "SW8", "SW9"], name: "Lambeth", host: "planning.lambeth.gov.uk" },
  { prefixes: ["W6", "SW6", "W12", "W14"], name: "Hammersmith & Fulham", host: "public-access.lbhf.gov.uk" },
  { prefixes: ["E5", "E8", "E9", "N16"], name: "Hackney", host: "developmentandhousing.hackney.gov.uk" },
];

export interface IdoxPlanningApp {
  reference: string;
  address: string;
  description: string;
  status: string;
  type: string;
  receivedAt: string;
  decidedAt: string;
  decision: string;
  documentUrl: string;
  lpa: string;
  source: "idox";
}

function resolveLpa(postcode: string): { name: string; host: string } | null {
  const pc = postcode.toUpperCase().replace(/\s+/g, "");
  // Outward code = letters + digits up to the first digit-then-letter boundary (e.g. SW1Y, W1, EC1A)
  const m = pc.match(/^([A-Z]{1,2}\d{1,2}[A-Z]?)/);
  if (!m) return null;
  const outward = m[1];
  // Try most-specific match first (e.g. SW1Y matches SW1, not SW), so sort by descending prefix length.
  const hit = LPA_REGISTRY
    .flatMap((lpa) => lpa.prefixes.map((p) => ({ ...lpa, prefix: p })))
    .filter((e) => outward.startsWith(e.prefix))
    .sort((a, b) => b.prefix.length - a.prefix.length)[0];
  return hit ? { name: hit.name, host: hit.host } : null;
}

function parseDate(raw: string): string {
  // Idox dates: "Mon 01 Jan 2025" or "Fri 12 Dec 2024"
  const cleaned = raw.trim();
  if (!cleaned) return "";
  const d = new Date(cleaned);
  if (isNaN(d.getTime())) return cleaned;
  return d.toISOString().split("T")[0];
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

function parseResultsHtml(html: string, host: string, lpaName: string): IdoxPlanningApp[] {
  const results: IdoxPlanningApp[] = [];
  // Each result is an <li class="searchresult"> ... </li>
  const itemRe = /<li\b[^>]*class="[^"]*searchresult[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = itemRe.exec(html)) !== null) {
    const block = m[1];
    const linkMatch = block.match(/<a[^>]+href="([^"]*applicationDetails\.do[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const detailUrl = linkMatch ? `https://${host}${linkMatch[1].startsWith("/") ? "" : "/online-applications/"}${linkMatch[1].replace(/^\//, "")}` : "";
    const title = linkMatch ? stripHtml(linkMatch[2]) : "";

    // metaInfo / address paragraph has " | " separated fields. Idox varies:
    // some use <p class="metaInfo">, some use <p class="address">.
    const metaMatch = block.match(/<p\b[^>]*class="[^"]*(?:metaInfo|address)[^"]*"[^>]*>([\s\S]*?)<\/p>/i);
    const meta = metaMatch ? stripHtml(metaMatch[1]) : "";

    const refMatch = meta.match(/Ref(?:erence)?\.?\s*No\.?:?\s*([^|]+?)(?:\||$)/i) || title.match(/^([A-Z0-9/\\\-]+)\s*\|/);
    const statusMatch = meta.match(/Status:?\s*([^|]+?)(?:\||$)/i);
    const receivedMatch = meta.match(/(?:Received|Validated|Registered):?\s*([^|]+?)(?:\||$)/i);
    const decidedMatch = meta.match(/(?:Decided|Decision\s+Date):?\s*([^|]+?)(?:\||$)/i);
    const decisionMatch = meta.match(/Decision:?\s*([^|]+?)(?:\||$)/i);
    const addressMatch = meta.match(/Address:?\s*([^|]+?)(?:\||$)/i);

    const reference = (refMatch ? refMatch[1] : "").trim();
    if (!reference) continue;

    // Description: second <p> inside the li, or everything after the pipe-separated title.
    let description = "";
    const descPara = block.match(/<p\b(?![^>]*class="[^"]*(?:metaInfo|address))[^>]*>([\s\S]*?)<\/p>/i);
    if (descPara) description = stripHtml(descPara[1]);
    if (!description && title.includes("|")) description = title.split("|").slice(1, -1).join("|").trim();
    if (!description) description = title;

    // Address: if meta didn't expose it, try the trailing title segment.
    let address = addressMatch ? addressMatch[1].trim() : "";
    if (!address && title.includes("|")) address = title.split("|").pop()?.trim() || "";

    results.push({
      reference,
      address,
      description,
      status: statusMatch ? statusMatch[1].trim() : "",
      type: "",
      receivedAt: parseDate(receivedMatch?.[1] || ""),
      decidedAt: parseDate(decidedMatch?.[1] || ""),
      decision: decisionMatch ? decisionMatch[1].trim() : "",
      documentUrl: detailUrl,
      lpa: lpaName,
      source: "idox",
    });
  }
  return results;
}

async function fetchIdoxPage(host: string, searchTerm: string, page: number): Promise<string> {
  const params = new URLSearchParams({
    action: page === 1 ? "firstPage" : "page",
    "searchCriteria.simpleSearchString": searchTerm,
    "searchCriteria.simpleSearch": "true",
    "searchCriteria.resultsPerPage": "100",
  });
  if (page > 1) params.set("searchCriteria.page", String(page));
  const url = `https://${host}/online-applications/simpleSearchResults.do?${params.toString()}`;
  const resp = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; BGPPlanningBot/1.0; +https://brucegillinghampollard.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(20000),
    redirect: "follow",
  });
  if (!resp.ok) {
    throw new Error(`Idox ${host} responded ${resp.status}`);
  }
  return await resp.text();
}

const cache = new Map<string, { at: number; data: IdoxPlanningApp[] }>();
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export async function fetchIdoxPlanning(
  postcode: string,
  address?: string,
  opts?: { maxPages?: number; maxAgeYears?: number },
): Promise<IdoxPlanningApp[]> {
  const lpa = resolveLpa(postcode);
  if (!lpa) {
    console.log(`[idox] No LPA mapping for ${postcode} — skipping scrape`);
    return [];
  }

  // Prefer the full address (narrower results) but fall back to postcode if needed.
  const searchTerm = (address && address.trim().length > 0 ? address : postcode).trim();
  const cacheKey = `${lpa.host}::${searchTerm.toUpperCase()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    console.log(`[idox] cache hit: ${lpa.name} "${searchTerm}" (${cached.data.length})`);
    return cached.data;
  }

  const maxPages = opts?.maxPages ?? 3;
  const minDate = opts?.maxAgeYears
    ? new Date(Date.now() - opts.maxAgeYears * 365 * 24 * 3600 * 1000)
    : null;

  let all: IdoxPlanningApp[] = [];
  try {
    for (let page = 1; page <= maxPages; page++) {
      const html = await fetchIdoxPage(lpa.host, searchTerm, page);
      const parsed = parseResultsHtml(html, lpa.host, lpa.name);
      if (parsed.length === 0) break;
      all.push(...parsed);
      // Stop paginating if the page wasn't full (i.e. last page).
      if (parsed.length < 90) break;
    }
  } catch (err: any) {
    console.error(`[idox] scrape failed for ${lpa.name} "${searchTerm}":`, err?.message);
    // Fallback: if we searched by address and got nothing/errored, retry with postcode only.
    if (address && searchTerm !== postcode) {
      console.log(`[idox] retrying with postcode only: ${postcode}`);
      try {
        const html = await fetchIdoxPage(lpa.host, postcode, 1);
        all = parseResultsHtml(html, lpa.host, lpa.name);
      } catch {}
    }
  }

  // Date filter.
  if (minDate) {
    all = all.filter((a) => {
      const d = a.receivedAt || a.decidedAt;
      if (!d) return true;
      const t = new Date(d);
      return isNaN(t.getTime()) || t >= minDate;
    });
  }

  // Dedupe by reference (Idox sometimes returns duplicates across pages).
  const seen = new Set<string>();
  const deduped = all.filter((a) => {
    if (seen.has(a.reference)) return false;
    seen.add(a.reference);
    return true;
  });

  console.log(`[idox] ${lpa.name} "${searchTerm}" → ${deduped.length} applications`);
  cache.set(cacheKey, { at: Date.now(), data: deduped });
  return deduped;
}
